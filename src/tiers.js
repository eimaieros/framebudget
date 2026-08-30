/**
 * @file Adaptive quality degradation, with hysteresis.
 *
 * The idea is simple: if the device cannot sustain the full animation, turn the
 * quality down before the user feels the stutter. The hard part is not deciding
 * *when* to drop — it is stopping the decision from oscillating.
 *
 * A naive controller with a single threshold gets stuck flip-flopping: quality
 * drops, performance improves, quality rises, performance degrades again. The
 * result is an animation that pulses between two states, and that is worse to
 * look at than either state on its own.
 *
 * The fix is three things at once:
 *
 * 1. **Asymmetric thresholds.** Degrade easily, recover reluctantly. Being
 *    wrong while protecting costs little; being wrong while recovering costs a
 *    visible stutter.
 * 2. **Dwell time.** A tier never changes unless the condition holds for a
 *    minimum interval.
 * 3. **Regret.** If a tier is raised and immediately fails, that upgrade is
 *    recorded, and the next attempt at the same tier costs proportionally more.
 */

/** @typedef {'full'|'reduced'|'minimal'} Tier */

/** @type {Tier[]} Best to worst. */
export const TIERS = ['full', 'reduced', 'minimal'];

export class TierController {
  /**
   * @param {object} [opts]
   * @param {number} [opts.budgetMs] Per-frame threshold. 16.7 = 60 fps.
   * @param {number} [opts.downMissRate] Misses above this → degrade.
   * @param {number} [opts.upMissRate] Misses below this → consider recovering.
   * @param {number} [opts.dwellDownMs] Time spent failing before degrading.
   * @param {number} [opts.dwellUpMs] Time spent healthy before recovering.
   * @param {Tier} [opts.start]
   */
  constructor(opts = {}) {
    this.budgetMs = opts.budgetMs ?? 1000 / 60;
    this.downMissRate = opts.downMissRate ?? 0.2;
    this.upMissRate = opts.upMissRate ?? 0.02;
    this.dwellDownMs = opts.dwellDownMs ?? 600;
    this.dwellUpMs = opts.dwellUpMs ?? 4000;

    if (!Number.isFinite(this.budgetMs) || this.budgetMs <= 0) {
      throw new RangeError('TierController: budgetMs must be a finite number > 0');
    }
    if (
      !Number.isFinite(this.downMissRate) || this.downMissRate < 0 || this.downMissRate > 1 ||
      !Number.isFinite(this.upMissRate) || this.upMissRate < 0 || this.upMissRate > 1
    ) {
      throw new RangeError('TierController: miss rates must be between 0 and 1');
    }
    if (
      !Number.isFinite(this.dwellDownMs) || this.dwellDownMs < 0 ||
      !Number.isFinite(this.dwellUpMs) || this.dwellUpMs < 0
    ) {
      throw new RangeError('TierController: dwell times must be finite numbers >= 0');
    }
    if (this.upMissRate >= this.downMissRate) {
      // Without this asymmetry there is no hysteresis, and the controller is
      // guaranteed to oscillate. Fail loudly at construction, not at runtime.
      throw new RangeError('TierController: upMissRate must be < downMissRate');
    }

    /** @type {Tier} */
    const start = opts.start ?? 'full';
    if (!TIERS.includes(start)) {
      throw new RangeError(`TierController: start must be one of ${TIERS.join(', ')}`);
    }
    this.tier = start;

    /**
     * When the current condition started.
     *
     * `null`, not `0`. In the first version this was `0` as a "not started"
     * sentinel, and the tests caught the problem: `0` is a perfectly valid
     * timestamp. With a clock that starts at zero — which is the case in tests
     * and in any freshly created monotonic clock — the condition reset on every
     * call and the controller never changed tier.
     *
     * Never use a value from the domain as the sentinel for that domain.
     *
     * @type {number|null}
     */
    this._since = null;

    /** @type {'down'|'up'|null} Which condition the dwell timer belongs to. */
    this._condition = null;

    /** Upgrades that went wrong, per tier. Makes the next attempt costlier. */
    this._regret = new Map();
  }

  /** @returns {number} index into TIERS */
  get index() {
    return TIERS.indexOf(this.tier);
  }

  /**
   * Feed the controller the current state.
   *
   * @param {number} missRate Fraction of frames over threshold (0–1).
   * @param {number} now Monotonic ms.
   * @returns {Tier|null} The new tier, or `null` if nothing changed.
   */
  update(missRate, now) {
    if (!Number.isFinite(missRate) || missRate < 0 || missRate > 1) {
      throw new RangeError('TierController: missRate must be between 0 and 1');
    }
    if (!Number.isFinite(now)) {
      throw new RangeError('TierController: now must be finite');
    }
    /** @type {'down'|'up'|null} */
    let condition = null;
    if (missRate > this.downMissRate && this.index < TIERS.length - 1) condition = 'down';
    else if (missRate < this.upMissRate && this.index > 0) condition = 'up';

    // A recovery interval cannot pay for a degradation (or vice versa). The
    // earlier implementation reused one timestamp for both directions, so a
    // long healthy run followed by one bad sample could degrade immediately.
    if (condition !== this._condition) {
      this._condition = condition;
      this._since = condition === null ? null : now;
      return null;
    }
    if (condition === null || this._since === null) return null;

    const elapsed = now - this._since;

    // Down: fast, because the cost of waiting is the user seeing the stutter.
    if (missRate > this.downMissRate && this.index < TIERS.length - 1) {
      if (elapsed >= this.dwellDownMs) {
        const previous = this.tier;
        this.tier = TIERS[this.index + 1];
        this._since = now;
        // If we had just climbed into that tier and it already failed, note it.
        const n = this._regret.get(previous) ?? 0;
        this._regret.set(previous, n + 1);
        return this.tier;
      }
      return null;
    }

    // Up: slow, and slower still if this tier has burned us before.
    if (missRate < this.upMissRate && this.index > 0) {
      const target = TIERS[this.index - 1];
      const penalty = this._regret.get(target) ?? 0;
      const required = this.dwellUpMs * (1 + penalty);
      if (elapsed >= required) {
        this.tier = target;
        this._since = now;
        return this.tier;
      }
      return null;
    }

    // Neither: the timer restarts. A condition only counts if it persists —
    // brushing past a threshold on the way through is not a signal.
    this._condition = null;
    this._since = null;
    return null;
  }
}
