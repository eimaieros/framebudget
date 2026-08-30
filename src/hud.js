/**
 * @file Read-out panel, for development.
 *
 * Rules the HUD follows, which are rather the point:
 *
 * 1. **It never reads layout.** No `getBoundingClientRect`, no `offsetHeight`.
 *    A performance meter that forces layout recalculations in order to draw
 *    itself changes the thing it is measuring.
 * 2. **It writes at most four times per second.** The eye cannot read numbers
 *    at 60 fps and the DOM would rather not.
 * 3. **It only writes what changed.** Comparing a string is cheaper than
 *    dirtying the DOM.
 * 4. **`pointer-events: none`.** It does not steal clicks from the site it is
 *    measuring.
 */

/** @typedef {import('./index.js').FrameBudget} FrameBudget */

const CSS = `
position:fixed;right:12px;bottom:12px;z-index:2147483647;
font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
color:#e8e8ea;background:rgba(10,10,12,.88);
border:1px solid rgba(255,255,255,.12);border-radius:8px;
padding:9px 11px;min-width:172px;pointer-events:none;
backdrop-filter:blur(8px);white-space:pre;letter-spacing:.02em;
`.replace(/\s+/g, ' ');

const COLOUR = { full: '#4ad08a', reduced: '#ffb020', minimal: '#ff3d1f' };

export class Hud {
  /**
   * @param {FrameBudget} fb
   * @param {object} [opts]
   * @param {number} [opts.hz] Updates per second.
   */
  constructor(fb, opts = {}) {
    this.fb = fb;
    this.interval = 1000 / (opts.hz ?? 4);
    this._el = null;
    this._timer = 0;
    this._last = '';
  }

  mount() {
    const g = /** @type {any} */ (globalThis);
    if (this._el || !g.document?.body) return this;

    const el = g.document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = CSS;
    g.document.body.appendChild(el);
    this._el = el;

    this._timer = g.setInterval(() => this._paint(), this.interval);
    return this;
  }

  _paint() {
    if (!this._el) return;
    const r = this.fb.report();
    const colour = COLOUR[r.tier] ?? '#e8e8ea';
    const txt =
      `${r.fps.toFixed(0).padStart(3)} fps   ${r.tier}\n` +
      `p50 ${r.medianMs.toFixed(1).padStart(5)} ms\n` +
      `p95 ${r.p95Ms.toFixed(1).padStart(5)} ms\n` +
      `dropped ${(r.missRate * 100).toFixed(0).padStart(3)} %\n` +
      `long tasks ${r.longTasks}`;

    if (txt === this._last) return;
    this._last = txt;
    this._el.textContent = txt;
    this._el.style.borderLeft = `2px solid ${colour}`;
  }

  unmount() {
    const g = /** @type {any} */ (globalThis);
    if (this._timer) g.clearInterval(this._timer);
    this._timer = 0;
    this._el?.remove?.();
    this._el = null;
    // A remount starts with a blank element. Keeping the previous text would
    // make _paint() skip the first write whenever the metrics had not changed.
    this._last = '';
    return this;
  }
}
