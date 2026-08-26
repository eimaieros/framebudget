# framebudget

**A runtime frame budget for animated websites.** It measures what the user
actually feels, and turns the animation down before they feel it.

[![CI](https://github.com/eimaieros/framebudget/actions/workflows/ci.yml/badge.svg)](https://github.com/eimaieros/framebudget/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![No dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![8.3 KB minified](https://img.shields.io/badge/minified-8.3%20KB-informational)

No dependencies. 8.3 KB minified, 3.3 KB gzipped. Ships TypeScript types.

---

## Why this exists

Most award-winning websites score around 40 on Lighthouse. That isn't
incompetence — it's that nobody measures animation *after* it ships.

Every performance tool we have measures **loading**: LCP, CLS, TTFB, INP. Then
it stops. What happens over the next ninety seconds, while someone scrolls
through the work, is measured by nothing at all.

I built a portfolio with a WebGL background, a fluid simulation, 84 instanced
meshes and a 144-tile image mosaic, and held Lighthouse above 90. The
techniques that made that possible are folklore scattered across blog posts.
This library is those techniques, made measurable and automatic.

---

## Install

Straight from the repository — no npm release yet:

```bash
npm install github:eimaieros/framebudget
```

Or copy `src/` into your project. It's ES modules with no dependencies, so
there is nothing to build.

## Use

```js
import { FrameBudget } from 'framebudget';

const fb = new FrameBudget({
  target: 60,
  onTierChange(tier) {
    // 'full' | 'reduced' | 'minimal'
    renderer.setPixelRatio(tier === 'full' ? 2 : 1);
    particles.count = { full: 5000, reduced: 1500, minimal: 0 }[tier];
  },
}).start();
```

Already have an animation loop? Don't start a second one:

```js
gsap.ticker.add((time) => fb.frame(time * 1000));
```

Read the numbers whenever you want:

```js
fb.report();
// { fps: 58.9, medianMs: 17.0, p95Ms: 41.2, missRate: 0.08,
//   samples: 120, discarded: 2, tier: 'reduced',
//   longTasks: 3, longestTaskMs: 214, reducedMotion: false }
```

Development overlay:

```js
import { Hud } from 'framebudget';
if (import.meta.env.DEV) new Hud(fb).mount();
```

---

## The four decisions worth explaining

Everything here came out of a bug I actually shipped.

### 1. `requestAnimationFrame` lies in background tabs

rAF is suspended in background tabs, unfocused windows and power-saving mode.
A naive frame timer sees a 40-second gap when the tab comes back, concludes the
site catastrophically stalled, and drops quality to minimum — for a user who
just returned to a site that was fine.

`Clock` discards any interval over 250 ms as a *pause*, not slowness, and
returns `null` rather than a number. Returning `null` is deliberate: it forces
the caller to handle the absence of a measurement instead of letting a zero or
a huge value slide silently into the statistics.

### 2. The mean hides exactly what the user feels

59 frames at 16 ms and one at 200 ms averages to 19 ms. Looks healthy. But
nobody perceives an average — they perceive the 200 ms frame, and they call it
"the site is stuttering". Smoothness lives in the tail of the distribution.

`Sampler` keeps a sliding window and works in percentiles. **p95 answers the
question that matters: how bad is this when it goes bad?**

### 3. A dropped frame is not "over budget"

This one was a bug in my own first version. At 60 fps the budget is 16.667 ms,
and real displays deliver frames at 16.7 ms because of vsync rounding. Compared
directly against the budget, *every* frame failed, the miss rate read 100%, and
the controller degraded a site that was perfect.

A frame is only genuinely lost when it takes long enough to miss the **next**
vsync. Hence a 1.5× threshold — 25 ms at 60 fps, which is unambiguous, and
leaves normal jitter alone.

### 4. Adaptive quality oscillates unless you fight it

Drop quality → performance improves → raise quality → performance degrades →
drop again. The animation pulses between two states, which is worse to look at
than either state on its own.

`TierController` uses three defences at once:

- **Asymmetric thresholds.** Degrade at 20% miss rate, recover at 2%. Being
  wrong while protecting costs little; being wrong while recovering costs a
  visible stutter.
- **Dwell time.** A condition must hold for a minimum interval to count.
  A single spike changes nothing.
- **Regret.** If a tier is raised and immediately fails, that upgrade is
  recorded, and the next attempt at the same tier costs proportionally longer.

The constructor throws if `upMissRate >= downMissRate`, because without that
asymmetry there is no hysteresis and the controller is guaranteed to oscillate.

---

## Layout thrash detector

Development only. Wraps the properties that force synchronous layout and counts
read↔write alternations:

```js
import { watchLayoutThrash } from 'framebudget';

watchLayoutThrash(() => {
  for (const el of items) {
    const y = el.getBoundingClientRect().top;   // read  → forces layout
    el.style.transform = `translateY(${y}px)`;  // write → invalidates it
  }
});
// [framebudget] 9 layout read/write alternations (10 reads, 10 writes).
// Each one forces a recalculation. Batch all reads first, then write.
```

Ten elements, ten full layout recalculations per frame. No individual function
looks slow in a profile, and the site crawls.

---

## API

| | |
|---|---|
| `new FrameBudget(opts)` | `target`, `window`, `onTierChange`, `onReport`, `reportEveryMs`, `respectReducedMotion` |
| `.start()` / `.stop()` | Self-driven rAF loop |
| `.frame(t)` | Feed a frame from your own loop |
| `.report()` | Current statistics |
| `.tier` | `'full' \| 'reduced' \| 'minimal'` |
| `new Hud(fb).mount()` | Development overlay |
| `watchLayoutThrash(fn)` | Forced-layout detector |

Building blocks are exported individually: `Clock`, `Sampler`, `TierController`,
`LongTasks`.

---

## Behaviour under absence

Every browser API used here is optional, and every one of them is missing
somewhere:

| Missing | What happens |
|---|---|
| `PerformanceObserver` / `longtask` | Long-task counters stay at zero. Nothing else changes. |
| `requestAnimationFrame` | `start()` becomes a no-op. `frame()` still works. |
| `matchMedia` | `reducedMotion` reads `false`. |
| `document` | The HUD refuses to mount. The library still measures. |

Nothing throws because a browser is old. The only things that throw are
programming errors, at construction time, where you can still fix them:
a `target` of zero, a window of two frames, thresholds that guarantee
oscillation.

---

## Tests

```bash
npm test      # node:test, no framework
npm run types # tsc --strict --checkJs over the JavaScript source
npm run check # both
```

37 tests. The suite is written around the failure modes, not the happy path —
vsync jitter, background suspension, single spikes, oscillation, and the
sentinel bug where `0` was used to mean "not started" on a clock that legally
starts at zero.

The source is JavaScript; the `.d.ts` files are generated from its JSDoc by
`tsc --emitDeclarationOnly` and are not committed — generated output kept
beside its source is how the two end up disagreeing. `prepare` runs the
generation on install, so a git dependency gets its types built on the way in.

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers how to run it and what a good pull
request looks like. [CHANGELOG.md](CHANGELOG.md) records what changed and, more
usefully, what was wrong before. Security reports go to
[SECURITY.md](SECURITY.md).

## Licence

MIT © [Rodrigo Figueiredo](https://rodrigofigueiredo.dev)
