/**
 * @file Long tasks.
 *
 * `requestAnimationFrame` tells us *that* a frame was slow. It does not tell us
 * *why*. The Long Tasks API does: any block of work occupying the main thread
 * for more than 50 ms is recorded, with rough attribution.
 *
 * The two measurements complement each other. Slow frames without long tasks
 * are usually graphics work — too many pixels, too many layers, an expensive
 * shader. Slow frames *with* long tasks are JavaScript blocking the thread, and
 * the fix is a different one.
 *
 * The whole API is optional by design: on Safari, and on any browser without
 * PerformanceObserver, this switches itself off silently rather than throwing.
 */

export class LongTasks {
  constructor() {
    /** @type {any} */
    this._obs = null;
    this.count = 0;
    this.totalMs = 0;
    this.longestMs = 0;
    /** @type {boolean} Does this browser have the API? */
    this.supported = false;

    const g = /** @type {any} */ (globalThis);
    const PO = g.PerformanceObserver;
    if (!PO) return;
    const types = PO.supportedEntryTypes;
    if (Array.isArray(types) && !types.includes('longtask')) return;
    this.supported = true;
  }

  start() {
    if (!this.supported || this._obs) return;
    const g = /** @type {any} */ (globalThis);
    try {
      this._obs = new g.PerformanceObserver((/** @type {any} */ list) => {
        for (const e of list.getEntries()) {
          const duration = finiteNonNegative(e?.duration);
          if (duration === null) continue;
          this.count++;
          this.totalMs += duration;
          if (duration > this.longestMs) this.longestMs = duration;
        }
      });
      // Reports promise "since start". `buffered: true` also replays entries
      // from before start(), making that claim false on a late-mounted meter.
      this._obs.observe({ type: 'longtask' });
    } catch {
      // Some browsers advertise the type and then refuse the subscription.
      this.supported = false;
      this._obs = null;
    }
  }

  stop() {
    this._obs?.disconnect?.();
    this._obs = null;
  }

  reset() {
    this.count = 0;
    this.totalMs = 0;
    this.longestMs = 0;
  }
}

/** @param {unknown} value @returns {number|null} */
function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
