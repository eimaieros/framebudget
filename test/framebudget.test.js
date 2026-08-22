import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudget } from '../src/index.js';

/** Feeds n frames of ms each, returning the final timestamp. */
function run(fb, ms, n, t0 = 0) {
  let t = t0;
  for (let i = 0; i < n; i++) { t += ms; fb.frame(t); }
  return t;
}

test('healthy 60 fps is not degraded', () => {
  const fb = new FrameBudget({ target: 60 });
  run(fb, 16.7, 300);
  const r = fb.report();
  assert.equal(fb.tier, 'full', '16.7 ms at 60 fps is perfect, not a failure');
  assert.equal(r.missRate, 0);
  assert.ok(r.fps > 59 && r.fps < 61);
});

test('the threshold tolerates vsync jitter', () => {
  // This test exists because of a real bug: comparing 16.7 against 16.667
  // gave a 100% miss rate and degraded a site that was perfect.
  const fb = new FrameBudget({ target: 60 });
  run(fb, 20, 300);
  assert.equal(fb.report().missRate, 0, '20 ms has not yet missed the next vsync');
  const fb2 = new FrameBudget({ target: 60 });
  run(fb2, 30, 300);
  assert.ok(fb2.report().missRate > 0.9, '30 ms has');
});

test('it degrades under load and recovers slowly', () => {
  const changes = [];
  const fb = new FrameBudget({ target: 60, onTierChange: (t) => changes.push(t) });
  let t = run(fb, 16.7, 200);
  assert.equal(fb.tier, 'full');

  t = run(fb, 40, 800, t);
  assert.equal(fb.tier, 'minimal', 'sustained load reaches minimal');

  t = run(fb, 16.7, 2000, t);
  assert.ok(fb.tier !== 'minimal', 'it recovers');
  assert.deepEqual(changes.slice(0, 2), ['reduced', 'minimal']);
});

test('it decides nothing without enough samples', () => {
  const fb = new FrameBudget({ target: 60 });
  run(fb, 100, 5);
  assert.equal(fb.tier, 'full', 'five bad frames are not a verdict');
});

test('the report invents nothing before it starts', () => {
  const r = new FrameBudget().report();
  assert.equal(r.samples, 0);
  assert.equal(r.fps, 0);
  assert.equal(r.tier, 'full');
});

test('an invalid target is rejected up front', () => {
  assert.throws(() => new FrameBudget({ target: 0 }), RangeError);
  assert.throws(() => new FrameBudget({ target: -1 }), RangeError);
});

test('start() without requestAnimationFrame does not throw', () => {
  const fb = new FrameBudget();
  assert.doesNotThrow(() => fb.start().stop());
});
