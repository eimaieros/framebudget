# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- TypeScript 5 → 7 for the declaration build, with `rootDir` now explicit in
  `tsconfig.json`. TypeScript 7 stops with `TS5011` rather than inferring the
  common source directory the way 5 did, so the bump alone would have turned CI
  red. One line, and it means the same thing under both majors.

  Worth knowing if you generate types the same way: 7 emits
  `export declare class` where 5 emitted `export class`, and orders the
  re-exports differently. Both are valid `.d.ts`; the diff is noise, not a
  behaviour change.

## [0.1.0] — 2026-08-23

First public version.

### Added

- `FrameBudget` — samples real frame timing in production and degrades
  animation quality before the stutter becomes visible, then climbs back when
  there is headroom.
- Three tiers (`full`, `reduced`, `minimal`) driven by **percentiles**, not
  means. Fifty-nine frames at 16ms and one at 400ms averages to 19ms, which
  looks healthy; nobody perceives an average. Smoothness lives in the tail, so
  the controller works in p50 and p95.
- Long-task detection via `PerformanceObserver`, where the browser has it.
- A layout-thrash detector: alternating reads and writes force a full layout
  pass per iteration, which never looks slow in a profile and makes the page
  crawl.
- `fb.frame(t)` for pages that already have an animation loop — GSAP's ticker,
  a Three.js loop — so the library never starts a second one.
- TypeScript declarations generated from JSDoc.

### Decisions worth knowing

- **`requestAnimationFrame` lies in background tabs.** It is throttled or
  suspended, so the gaps it reports are not the gaps the user experienced.
  Samples taken while the document is hidden are discarded rather than averaged
  in, which would otherwise make every restored tab look like a stutter.
- **A dropped frame is not simply "over budget."** At 60Hz a frame that takes
  17ms is fine and one that takes 33ms cost the user a frame. The controller
  counts missed *deadlines*, not milliseconds over an average.
- **Adaptive quality oscillates unless you fight it.** Asymmetric thresholds, a
  dwell time, and a regret counter that makes a tier costlier to re-enter after
  it has failed once. The constructor refuses parameter combinations that would
  guarantee oscillation, rather than shipping a plausible-looking flicker.

### Fixed after first publication

- The install instruction in the README pointed at `npm install framebudget`, a
  package that does not exist — anyone following it got a 404. It installs from
  the repository now, and that was verified by packing the tarball and
  installing it into a scratch project.
- `types/` was gitignored while `package.json` listed it in `files` and
  `types`, so a fresh install had no declarations. A `prepare` script builds
  them on install.
- The demo wrote its status label only when the tier changed, so during
  recovery — which is deliberately slow — it sat showing a p95 from ten seconds
  earlier and looked frozen. It now says what it is waiting for.

[Unreleased]: https://github.com/eimaieros/framebudget/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/eimaieros/framebudget/releases/tag/v0.1.0
