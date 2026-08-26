/**
 * @file framebudget — a runtime frame budget for animated websites.
 *
 * Why this exists.
 *
 * Most award-winning websites score around 40 on Lighthouse. That is not
 * incompetence: it is that nobody measures animation *after* it ships. Every
 * performance tool we have measures **loading** — LCP, CLS, TTFB, INP — and
 * then stops. What happens over the next ninety seconds, while someone scrolls
 * through the work, is measured by nothing at all.
 *
 * `framebudget` measures that part, and does something with the result: when
 * the device cannot keep up, it turns the animation down before the user feels
 * the stutter, and turns it back up when there is headroom again.
 *
 * No dependencies. Touches the DOM only if you ask for the HUD.
 */

import { Clock } from './clock.js';
import { Sampler } from './sampler.js';
import { TierController, TIERS } from './tiers.js';
import { LongTasks } from './longtasks.js';
import { watchLayoutThrash } from './thrash.js';
import { Hud } from './hud.js';
import { readDevice } from './device.js';

/** @typedef {import('./tiers.js').Tier} Tier */

/**
 * @typedef {object} Report
 * @property {number} fps        Derived from the median.
 * @property {number} medianMs   The typical frame.
 * @property {number} p95Ms      The bad frame. This is the one people feel.
 * @property {number} missRate   Fraction of dropped frames, 0–1.
 * @property {number} samples    Frames in the window.
 * @property {number} discarded  Intervals discarded as pauses.
 * @property {Tier}   tier       Current quality tier.
 * @property {number} longTasks  Long tasks since start.
 * @property {number} longestTaskMs
 * @property {boolean} reducedMotion The user asked for less motion.
 * @property {string} startedAt The tier the device signals suggested at boot,
 *   which is not the same as the tier now. Useful when a report looks odd:
 *   'minimal' here and 'full' now means the guess was wrong and measurement
 *   corrected it, which is the system working.
 */

export class FrameBudget {
  /**
   * @param {object} [opts]
   * @param {number} [opts.target] Desired frames per second.
   * @param {(tier: Tier, report: Report) => void} [opts.onTierChange]
   * @param {(report: Report) => void} [opts.onReport]
   * @param {number} [opts.reportEveryMs]
   * @param {boolean} [opts.respectReducedMotion] Start at minimal if the user
   *   has asked for less motion. Defaults to true.
   * @param {boolean} [opts.adaptToDevice] Start in the tier the device's own
   *   signals suggest instead of always starting at `full`. Defaults to true.
   *   See `device.js` for why those signals are only trusted this far.
   * @param {any} [opts.navigator] Injectable, for tests.
   * @param {number} [opts.window] Frames in the sliding window.
   */
  constructor(opts = {}) {
    const target = opts.target ?? 60;
    if (!(target > 0)) throw new RangeError('FrameBudget: target must be > 0');

    this.budgetMs = 1000 / target;

    /**
     * The threshold at which a frame counts as dropped.
     *
     * This is NOT the budget. It was a bug in the first version: at 60 fps the
     * budget is 16.667 ms, and real displays deliver frames at 16.7 ms because
     * of vsync rounding. Compared directly against the budget, *every* frame
     * failed, the miss rate read 100%, and the controller degraded a site that
     * was perfect.
     *
     * A frame is only genuinely lost when it takes long enough to miss the
     * next vsync. Hence 1.5×: 25 ms at 60 fps, which is unambiguous, and which
     * leaves normal jitter alone.
     */
    this.dropMs = this.budgetMs * 1.5;

    this.clock = new Clock();
    this.sampler = new Sampler(opts.window ?? 120);
    this.longTasks = new LongTasks();
    this.controller = new TierController({ budgetMs: this.dropMs });

    this._onTierChange = opts.onTierChange;
    this._onReport = opts.onReport;
    this._reportEvery = opts.reportEveryMs ?? 1000;
    this._ultimoReport = 0;
    this._raf = 0;
    this._running = false;

    /**
     * What the device admits about itself, read once, before the first frame.
     *
     * The controller is measurement-driven and cannot react to a frame that
     * has not happened yet, so without this every page starts at `full` and
     * spends its first second discovering the hardware. On a small phone that
     * is the second in which the visitor decides whether to stay.
     *
     * This only moves the *starting* tier. Measurement takes over on the very
     * next frame and can climb straight back to `full`, which is what happens
     * on a device this guesses wrong about.
     */
    this.device = readDevice(opts.navigator);

    /**
     * Only act on the guess where there is something being drawn.
     *
     * Node 22 ships a `navigator` with a real `hardwareConcurrency`, and CI
     * runners are small — two cores is normal. Without this check, importing
     * the library in a test runner started every instance in `reduced`, which
     * is both wrong and invisible until a test that had nothing to do with
     * tiers starts failing on one machine and not another. It did.
     *
     * A device with no `document` is not a device we are animating on.
     */
    const temEcra = typeof document !== 'undefined';
    if ((opts.adaptToDevice ?? true) && (temEcra || opts.navigator) && this.device.tier !== 'full') {
      this.controller.tier = this.device.tier;
    }

    this.reducedMotion = this._prefersReducedMotion();
    if (this.reducedMotion && (opts.respectReducedMotion ?? true)) {
      // Someone who asked for less motion should not have to wait for the
      // controller to "discover" the device is slow. Start at minimal.
      this.controller.tier = 'minimal';
    }
  }

  /** @returns {boolean} */
  _prefersReducedMotion() {
    const g = /** @type {any} */ (globalThis);
    try {
      return g.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
      return false;
    }
  }

  /** @returns {Tier} */
  get tier() {
    return this.controller.tier;
  }

  /** @returns {Report} */
  report() {
    return {
      fps: this.sampler.fps,
      medianMs: this.sampler.median,
      p95Ms: this.sampler.p95,
      missRate: this.sampler.missRate(this.dropMs),
      samples: this.sampler.count,
      discarded: this.clock.discarded,
      tier: this.controller.tier,
      longTasks: this.longTasks.count,
      longestTaskMs: this.longTasks.longestMs,
      reducedMotion: this.reducedMotion,
      startedAt: this.device.tier,
    };
  }

  /**
   * Feed a frame manually. Useful when an animation loop already exists
   * (GSAP, Three.js) and you do not want a second `requestAnimationFrame`
   * competing with it.
   * @param {number} [t]
   */
  frame(t) {
    const delta = this.clock.tick(t);
    if (delta !== null) this.sampler.push(delta);

    const agora = t ?? (/** @type {any} */ (globalThis).performance?.now?.() ?? Date.now());

    if (this.sampler.ready) {
      const novo = this.controller.update(this.sampler.missRate(this.dropMs), agora);
      if (novo && this._onTierChange) this._onTierChange(novo, this.report());
    }
    if (this._onReport && agora - this._ultimoReport >= this._reportEvery) {
      this._ultimoReport = agora;
      this._onReport(this.report());
    }
  }

  /** Start measuring with an internal loop. */
  start() {
    if (this._running) return this;
    this._running = true;
    this.clock.reset();
    this.longTasks.start();

    const g = /** @type {any} */ (globalThis);
    const raf = g.requestAnimationFrame;
    if (typeof raf !== 'function') {
      // Without rAF there is nothing to measure. Stay in manual mode, quietly.
      return this;
    }
    const loop = (/** @type {number} */ t) => {
      if (!this._running) return;
      this.frame(t);
      this._raf = raf(loop);
    };
    this._raf = raf(loop);
    return this;
  }

  stop() {
    this._running = false;
    const g = /** @type {any} */ (globalThis);
    if (this._raf) g.cancelAnimationFrame?.(this._raf);
    this._raf = 0;
    this.longTasks.stop();
    return this;
  }
}

export { Clock, Sampler, TierController, TIERS, LongTasks, watchLayoutThrash, Hud };
export { readDevice, classify } from './device.js';
