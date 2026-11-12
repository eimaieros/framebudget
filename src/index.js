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
import { LongAnimationFrames } from './longframes.js';
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
 * @property {number} longFrames Long animation frames observed since start.
 * @property {number} longestFrameMs
 * @property {number} blockingDurationMs Total LoAF blocking duration.
 * @property {number} longestBlockingDurationMs Worst LoAF blocking duration.
 * @property {number} forcedStyleAndLayoutMs Forced style/layout attributed by LoAF.
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
   * @param {boolean} [opts.respectReducedMotion] Hold the tier at minimal for
   *   as long as the user asks for less motion, following the setting if it
   *   changes while the page is open. Defaults to true.
   * @param {boolean} [opts.adaptToDevice] Start in the tier the device's own
   *   signals suggest instead of always starting at `full`. Defaults to true.
   *   See `device.js` for why those signals are only trusted this far.
   * @param {any} [opts.navigator] Injectable, for tests.
   * @param {number} [opts.window] Frames in the sliding window.
   */
  constructor(opts = {}) {
    const target = opts.target ?? 60;
    if (!Number.isFinite(target) || !(target > 0)) {
      throw new RangeError('FrameBudget: target must be a finite number > 0');
    }

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
    this.longFrames = new LongAnimationFrames();
    this.controller = new TierController({ budgetMs: this.dropMs });

    this._onTierChange = opts.onTierChange;
    this._onReport = opts.onReport;
    this._reportEvery = opts.reportEveryMs ?? 1000;
    if (!Number.isFinite(this._reportEvery) || this._reportEvery <= 0) {
      throw new RangeError('FrameBudget: reportEveryMs must be a finite number > 0');
    }
    this._ultimoReport = 0;
    this._raf = 0;
    this._running = false;
    this._observing = false;

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

    /**
     * Less motion is something the user asked for, not something measurement
     * can overrule. This used to set only the starting tier: on a fast device
     * the controller then climbed back to `full` within seconds, and the
     * visitor who had asked for less motion got all of it.
     */
    this._respectReducedMotion = opts.respectReducedMotion ?? true;
    this.reducedMotion = this._prefersReducedMotion();
    if (this._holdingForMotion) this.controller.tier = 'minimal';
    /** @type {{ removeEventListener: Function } | null} */
    this._motionQuery = null;
    /** @type {((e: { matches?: boolean }) => void) | null} */
    this._onMotionChange = null;
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
      longFrames: this.longFrames.count,
      longestFrameMs: this.longFrames.longestMs,
      blockingDurationMs: this.longFrames.blockingMs,
      longestBlockingDurationMs: this.longFrames.longestBlockingMs,
      forcedStyleAndLayoutMs: this.longFrames.forcedStyleAndLayoutMs,
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
    this._startObservers();
    const delta = this.clock.tick(t);
    if (delta !== null) this.sampler.push(delta);

    const agora = t ?? (/** @type {any} */ (globalThis).performance?.now?.() ?? Date.now());

    // While the user asks for less motion the tier stays where it is; frames
    // are still measured, so the report keeps telling the truth.
    if (this.sampler.ready && !this._holdingForMotion) {
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
    const g = /** @type {any} */ (globalThis);
    const raf = g.requestAnimationFrame;
    if (typeof raf !== 'function') {
      // Without rAF there is nothing to measure. Stay in manual mode, quietly.
      return this;
    }
    this._running = true;
    this.clock.reset();
    this._startObservers();
    const loop = (/** @type {number} */ t) => {
      if (!this._running) return;
      this.frame(t);
      this._raf = raf.call(g, loop);
    };
    this._raf = raf.call(g, loop);
    return this;
  }

  stop() {
    this._running = false;
    const g = /** @type {any} */ (globalThis);
    if (this._raf) g.cancelAnimationFrame?.(this._raf);
    this._raf = 0;
    this.longTasks.stop();
    this.longFrames.stop();
    this._motionQuery?.removeEventListener('change', this._onMotionChange);
    this._motionQuery = null;
    this._onMotionChange = null;
    this._observing = false;
    return this;
  }

  /** @returns {boolean} */
  get _holdingForMotion() {
    return this.reducedMotion && this._respectReducedMotion;
  }

  /**
   * Follow prefers-reduced-motion if it changes while the page is open: turned
   * on, the tier drops to minimal at once; turned off, measurement takes over
   * again from where it is.
   */
  _watchMotion() {
    const g = /** @type {any} */ (globalThis);
    let query = null;
    try {
      query = g.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    } catch {
      query = null;
    }
    if (!query || typeof query.addEventListener !== 'function') return;
    this._motionQuery = query;
    this._onMotionChange = (e) => this._setReducedMotion(e?.matches === true);
    query.addEventListener('change', this._onMotionChange);
  }

  /** @param {boolean} on */
  _setReducedMotion(on) {
    if (on === this.reducedMotion) return;
    this.reducedMotion = on;
    if (!this._respectReducedMotion) return;
    this.controller.forget();
    if (on && this.controller.tier !== 'minimal') {
      this.controller.tier = 'minimal';
      if (this._onTierChange) this._onTierChange('minimal', this.report());
    }
  }

  /** Start optional diagnostic observers in rAF and caller-driven modes. */
  _startObservers() {
    if (this._observing) return;
    this._observing = true;
    this.longTasks.start();
    this.longFrames.start();
    this._watchMotion();
  }
}

export {
  Clock, Sampler, TierController, TIERS, LongTasks, LongAnimationFrames,
  watchLayoutThrash, Hud,
};
export { readDevice, classify } from './device.js';
