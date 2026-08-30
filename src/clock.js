/**
 * @file The clock.
 *
 * Everything in this module exists because of one bug that took hours to find
 * on a real site: **`requestAnimationFrame` is suspended in background tabs,
 * unfocused windows and power-saving mode.**
 *
 * A naive frame timer measures the interval between frames and, when the tab
 * comes back, sees a 40-second gap. It concludes the site catastrophically
 * stalled, drops animation quality to minimum, and the user — who has just
 * returned — is shown a degraded site for no reason at all.
 *
 * The clock fixes that by explicitly discarding time spent hidden. This is not
 * a robustness detail: it is the difference between the measurement meaning
 * something and being noise.
 */

/** Above this, the gap was not a slow frame — it was a pause. */
const PAUSE_MS = 250;

export class Clock {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now] Time source. Injectable for tests.
   * @param {() => boolean} [opts.hidden] Whether the document is hidden.
   */
  constructor(opts = {}) {
    const g = /** @type {any} */ (globalThis);
    this._now = opts.now ?? (() => (g.performance?.now?.() ?? Date.now()));
    this._hidden = opts.hidden ?? (() => g.document?.hidden === true);
    /** @type {number|null} */
    this._last = null;
    /** Frames discarded for being pauses rather than slowness. */
    this.discarded = 0;
  }

  /** Marks the start of a measurement session. */
  reset() {
    this._last = null;
  }

  /**
   * Records a frame and returns the delta in ms, or `null` when the interval
   * cannot be trusted (first frame, hidden tab, or a pause).
   *
   * Returning `null` instead of a number is deliberate: it forces the caller
   * to decide what to do with a missing measurement, rather than letting a
   * zero or a huge value slide silently into the statistics.
   *
   * @param {number} [t] Frame timestamp. Defaults to now.
   * @returns {number|null}
   */
  tick(t) {
    const now = t ?? this._now();

    // A bad timestamp must not turn every later delta into NaN. Manual loops
    // are public API, so distrust their clock at the boundary.
    if (!Number.isFinite(now)) return null;

    if (this._hidden()) {
      // Hidden: there is nothing to measure, and rAF may not even be running.
      this._last = null;
      return null;
    }
    if (this._last === null) {
      this._last = now;
      return null;
    }

    const delta = now - this._last;
    this._last = now;

    if (delta > PAUSE_MS) {
      // We came back from a suspension. The gap is real, but it is not jank.
      this.discarded++;
      return null;
    }
    if (delta <= 0) {
      // Non-monotonic clocks and tests. Does not count.
      return null;
    }
    return delta;
  }
}

export { PAUSE_MS };
