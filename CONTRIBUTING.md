# Contributing

Issues and pull requests are welcome. This is a small library maintained by one
person, so a short issue describing what you saw beats a long one speculating
about why.

## Running it

```bash
npm install
npm test          # 24 tests, no browser needed
npm run check     # types as well
```

The demo needs a static server, because it loads ES modules:

```bash
python3 -m http.server 5500
# → http://localhost:5500/demo/
```

Press **add load** and watch the tier fall and climb back. Recovery is
deliberately slow — about eight seconds a step — so give it time before
concluding it is stuck.

## The thing that makes this library hard to test

It measures time, and it decides things based on the *shape* of a distribution
rather than on any single value. That means a test which feeds it a clean
sequence of 16.7ms frames proves almost nothing: the interesting behaviour only
appears in the tail.

So the tests feed it deliberately awkward input — one 400ms frame among sixty
good ones, alternating good and bad runs, a background tab where
`requestAnimationFrame` stops entirely — and assert on p50 and p95 rather than
on the mean. If you add a behaviour, add the input that would have caught it
being wrong.

## The controller has a rule that is easy to break by accident

Adaptive quality oscillates unless you fight it: drop, improve, raise, degrade,
drop again. Three things stop that here — asymmetric thresholds, a dwell time,
and a regret counter that makes a tier costlier to re-enter after it has failed
once. The constructor refuses parameters that would guarantee oscillation.

If you change any of those three, the tests that matter are the ones that run a
long synthetic session and assert the tier changed fewer than N times. Loosen
those and the library will look fine and feel terrible.

## What a good pull request looks like

- Tests that fail before the change and pass after it.
- Comments that say *why*, not *what*. Nearly every decision in this library
  came out of a bug that shipped first, and the comment recording that is worth
  more than the line it sits above.

## Conduct

Be decent. Assume the other person is doing their best with what they know.
Anything that would be unwelcome in a shared office is unwelcome here — mail
eimaieros@gmail.com if something needs handling privately.
