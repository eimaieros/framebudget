# Security

## Reporting

Email **eimaieros@gmail.com**, or open a
[private advisory](https://github.com/eimaieros/framebudget/security/advisories/new).
I will reply within a week. If you have not heard back in two, assume the mail
went astray and open a normal issue saying only that you are waiting.

## What this library touches

Worth knowing before you look, because it narrows the surface a lot:

- **No network.** It makes no requests of any kind, and reports nothing
  anywhere. The numbers it collects stay in the page.
- **No storage.** No cookies, no `localStorage`, no `IndexedDB`.
- **No dependencies at runtime.** Nothing to inherit a vulnerability from; the
  only devDependency is TypeScript, and it does not ship.
- **No `eval`, no `Function`, no `innerHTML`.** Nothing is built from a string
  and executed.

What it does read:

- `performance.now()` and frame timestamps, to measure frame duration.
- `PerformanceObserver` with `longtask`, when the browser supports it.
- The rects of elements you hand to the layout-thrash detector, and only those.

All of it is timing about your own page. None of it identifies anyone, and none
of it leaves the tab.

One thing worth saying plainly: **timing data is a side channel.** This library
exposes frame durations to your own JavaScript, which your own JavaScript could
already measure. It does not widen what the page can observe — but if you are
in a threat model where high-resolution timing matters, that is a property of
the platform, not of this library, and the mitigations belong at the header
level (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`).

## Supported versions

The `main` branch. There is no release train to backport to yet, so a fix goes
out as a new commit and, when there is one, a new tag.
