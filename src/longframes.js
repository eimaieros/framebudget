/**
 * @file Long animation frames.
 *
 * Long Tasks tell us when one task monopolised the main thread. The Long
 * Animation Frames API measures the user-facing unit instead: a frame whose
 * task and rendering work together exceeded 50 ms. It also exposes blocking
 * time and forced style/layout attribution, which are the difference between
 * "the frame was slow" and "layout work in a script made it slow".
 *
 * This is optional by design. The API is still not implemented in every
 * browser, so absence is a zeroed report rather than an exception.
 */

export class LongAnimationFrames {
  constructor() {
    /** @type {any} */
    this._obs = null;
    this.count = 0;
    this.totalMs = 0;
    this.longestMs = 0;
    this.blockingMs = 0;
    this.longestBlockingMs = 0;
    this.forcedStyleAndLayoutMs = 0;
    this.supported = false;

    const g = /** @type {any} */ (globalThis);
    const PO = g.PerformanceObserver;
    if (!PO) return;
    const types = PO.supportedEntryTypes;
    if (Array.isArray(types) && !types.includes('long-animation-frame')) return;
    this.supported = true;
  }

  start() {
    if (!this.supported || this._obs) return;
    const g = /** @type {any} */ (globalThis);
    try {
      this._obs = new g.PerformanceObserver((/** @type {any} */ list) => {
        for (const entry of list.getEntries()) this._record(entry);
      });
      // No `buffered`: report() promises observations since start(), not work
      // that happened before this instance existed.
      this._obs.observe({ type: 'long-animation-frame' });
    } catch {
      // A browser may advertise an entry type and still reject observation.
      this.supported = false;
      this._obs = null;
    }
  }

  /** @param {any} entry */
  _record(entry) {
    const duration = finiteNonNegative(entry?.duration);
    if (duration === null) return;

    const blocking = finiteNonNegative(entry?.blockingDuration) ?? 0;
    let forced = 0;
    if (Array.isArray(entry?.scripts)) {
      for (const script of entry.scripts) {
        forced += finiteNonNegative(script?.forcedStyleAndLayoutDuration) ?? 0;
      }
    }

    this.count++;
    this.totalMs += duration;
    this.longestMs = Math.max(this.longestMs, duration);
    this.blockingMs += blocking;
    this.longestBlockingMs = Math.max(this.longestBlockingMs, blocking);
    this.forcedStyleAndLayoutMs += forced;
  }

  stop() {
    this._obs?.disconnect?.();
    this._obs = null;
  }

  reset() {
    this.count = 0;
    this.totalMs = 0;
    this.longestMs = 0;
    this.blockingMs = 0;
    this.longestBlockingMs = 0;
    this.forcedStyleAndLayoutMs = 0;
  }
}

/** @param {unknown} value @returns {number|null} */
function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
