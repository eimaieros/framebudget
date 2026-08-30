import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '../src/clock.js';

test('the first frame has no delta', () => {
  const c = new Clock({ now: () => 0, hidden: () => false });
  assert.equal(c.tick(1000), null);
  assert.equal(c.tick(1016), 16);
});

test('a hidden tab produces no measurements', () => {
  let hidden = false;
  const c = new Clock({ now: () => 0, hidden: () => hidden });
  c.tick(0);
  assert.equal(c.tick(16), 16);

  hidden = true;
  assert.equal(c.tick(32), null, 'hidden: nothing is measured');

  hidden = false;
  assert.equal(c.tick(48), null, 'on return it restarts rather than inventing a delta');
  assert.equal(c.tick(64), 16);
});

test('rAF suspension is not mistaken for jank', () => {
  const c = new Clock({ now: () => 0, hidden: () => false });
  c.tick(0);
  c.tick(16);

  // The tab spent 40 s in the background without `hidden` being observed.
  // This is the real bug that motivated the module: without this, 40000.
  assert.equal(c.tick(40016), null, 'the pause is discarded, not measured');
  assert.equal(c.discarded, 1);
  assert.equal(c.tick(40032), 16, 'and it carries on normally afterwards');
});

test('non-monotonic clocks do not poison the statistics', () => {
  const c = new Clock({ now: () => 0, hidden: () => false });
  c.tick(1000);
  assert.equal(c.tick(900), null, 'a negative delta is discarded');
});

test('a non-finite timestamp is ignored without poisoning the next frame', () => {
  const c = new Clock({ hidden: () => false });
  c.tick(1000);
  assert.equal(c.tick(Number.NaN), null);
  assert.equal(c.tick(1016), 16);
});
