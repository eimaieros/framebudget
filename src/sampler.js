/**
 * @file Frame statistics over a sliding window.
 *
 * The mean is the wrong metric for animation, and it is worth saying why.
 *
 * A site that delivers 59 frames at 16 ms and one at 200 ms has a mean of
 * 19 ms — which looks healthy. But nobody perceives a mean: they perceive the
 * 200 ms frame, and they call it "the site is stuttering". Perceived smoothness
 * lives in the tail of the distribution, not at its centre.
 *
 * So we keep a window of the last N deltas and work in percentiles. **p95
 * answers the question that matters: how bad is this when it goes bad?**
 */

export class Sampler {
  /** @param {number} [size] Frames in the window. ~2 s at 60 fps. */
  constructor(size = 120) {
    if (!Number.isInteger(size) || size < 8) {
      throw new RangeError('Sampler: size must be an integer >= 8');
    }
    this.size = size;
    /** Ring buffer. Avoids reallocating an array at 60 fps. @type {Float64Array} */
    this._buf = new Float64Array(size);
    this._i = 0;
    this._n = 0;
    /** @type {Float64Array} */
    this._sorted = new Float64Array(size);
  }

  /** @param {number} delta ms between frames */
  push(delta) {
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new RangeError('Sampler: delta must be a finite number > 0');
    }
    this._buf[this._i] = delta;
    this._i = (this._i + 1) % this.size;
    if (this._n < this.size) this._n++;
  }

  clear() {
    this._i = 0;
    this._n = 0;
  }

  get count() {
    return this._n;
  }

  /** Enough samples for the statistics to mean anything? */
  get ready() {
    return this._n >= Math.min(30, this.size);
  }

  /**
   * Percentile of frame deltas, in ms.
   * @param {number} p Between 0 and 1.
   * @returns {number} 0 when there are no samples yet.
   */
  percentile(p) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new RangeError('Sampler: percentile must be between 0 and 1');
    }
    if (this._n === 0) return 0;
    const view = this._sorted.subarray(0, this._n);
    view.set(this._buf.subarray(0, this._n));
    view.sort();
    const idx = Math.min(this._n - 1, Math.max(0, Math.ceil(p * this._n) - 1));
    return view[idx];
  }

  /** @returns {number} ms */
  get median() {
    return this.percentile(0.5);
  }

  /** @returns {number} ms — the number that decides whether the site feels smooth */
  get p95() {
    return this.percentile(0.95);
  }

  /** @returns {number} frames per second, derived from the median */
  get fps() {
    const m = this.median;
    return m > 0 ? 1000 / m : 0;
  }

  /**
   * Fraction of frames that blew the threshold.
   * @param {number} thresholdMs
   * @returns {number} between 0 and 1
   */
  missRate(thresholdMs) {
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
      throw new RangeError('Sampler: threshold must be a finite number > 0');
    }
    if (this._n === 0) return 0;
    let bad = 0;
    for (let k = 0; k < this._n; k++) {
      if (this._buf[k] > thresholdMs) bad++;
    }
    return bad / this._n;
  }
}
