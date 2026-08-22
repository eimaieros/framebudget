/**
 * @file Forced synchronous layout detector. Development only.
 *
 * The pattern that kills animation without leaving a trace:
 *
 * ```js
 * for (const el of elementos) {
 *   const y = el.getBoundingClientRect().top;  // read  → forces layout
 *   el.style.transform = `translateY(${y}px)`; // write → invalidates it
 * }
 * ```
 *
 * Each read forces the browser to recompute the layout the previous write just
 * invalidated. Ten elements means ten full layout recalculations per frame. The
 * profile looks innocent — no single function is slow — and the site crawls.
 *
 * This wraps the properties and methods that force layout, counts read↔write
 * alternations inside a function, and warns. Opt-in only, because the wrapping
 * has a cost and has no business being in production.
 */

/** Geometry properties whose reads force the browser to recompute layout. */
const READS = [
  'offsetTop', 'offsetLeft', 'offsetWidth', 'offsetHeight',
  'clientTop', 'clientLeft', 'clientWidth', 'clientHeight',
  'scrollTop', 'scrollLeft', 'scrollWidth', 'scrollHeight',
];

/**
 * Runs `fn` while watching for layout read↔write alternations.
 *
 * @param {() => void} fn
 * @param {object} [opts]
 * @param {number} [opts.warnAt] Alternations at which to warn.
 * @returns {{ reads: number, writes: number, alternations: number }}
 */
export function watchLayoutThrash(fn, opts = {}) {
  const warnAt = opts.warnAt ?? 2;
  const g = /** @type {any} */ (globalThis);
  const Elem = g.Element;
  const HTMLEl = g.HTMLElement;

  if (!Elem || !HTMLEl) {
    fn();
    return { reads: 0, writes: 0, alternations: 0 };
  }

  let reads = 0;
  let writes = 0;
  let alternations = 0;
  /** @type {'r'|'w'|null} */
  let last = null;

  const markRead = () => {
    reads++;
    if (last === 'w') alternations++;
    last = 'r';
  };
  const markWrite = () => {
    writes++;
    last = 'w';
  };

  /** @type {Array<() => void>} */
  const restore = [];

  for (const name of READS) {
    const target = Object.getOwnPropertyDescriptor(HTMLEl.prototype, name)
      ? HTMLEl.prototype
      : Elem.prototype;
    const d = Object.getOwnPropertyDescriptor(target, name);
    if (!d?.get) continue;
    const original = d.get;
    Object.defineProperty(target, name, {
      ...d,
      get() {
        markRead();
        return original.call(this);
      },
    });
    restore.push(() => Object.defineProperty(target, name, d));
  }

  const rectD = Object.getOwnPropertyDescriptor(Elem.prototype, 'getBoundingClientRect');
  if (rectD?.value) {
    const original = rectD.value;
    Elem.prototype.getBoundingClientRect = function () {
      markRead();
      return original.call(this);
    };
    restore.push(() => Object.defineProperty(Elem.prototype, 'getBoundingClientRect', rectD));
  }

  const styleD = Object.getOwnPropertyDescriptor(HTMLEl.prototype, 'style');
  if (styleD?.get) {
    const original = styleD.get;
    Object.defineProperty(HTMLEl.prototype, 'style', {
      ...styleD,
      get() {
        markWrite();
        return original.call(this);
      },
    });
    restore.push(() => Object.defineProperty(HTMLEl.prototype, 'style', styleD));
  }

  try {
    fn();
  } finally {
    for (const r of restore) r();
  }

  if (alternations >= warnAt && g.console?.warn) {
    g.console.warn(
      `[framebudget] ${alternations} layout read/write alternations ` +
      `(${reads} reads, ${writes} writes). Each one forces a recalculation. ` +
      `Batch all reads first, then write.`
    );
  }

  return { reads, writes, alternations };
}
