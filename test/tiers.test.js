import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TierController } from '../src/tiers.js';

test('without asymmetry there is no hysteresis, and the constructor refuses', () => {
  assert.throws(() => new TierController({ downMissRate: 0.2, upMissRate: 0.2 }), RangeError);
  assert.throws(() => new TierController({ downMissRate: 0.1, upMissRate: 0.3 }), RangeError);
});

test('it does not degrade unless the condition persists', () => {
  const c = new TierController({ dwellDownMs: 600 });
  assert.equal(c.update(0.9, 0), null);
  assert.equal(c.update(0.9, 300), null, 'dwell time not yet met');
  assert.equal(c.update(0.9, 700), 'reduced', 'met');
});

test('an isolated spike changes nothing', () => {
  const c = new TierController({ dwellDownMs: 600 });
  c.update(0.0, 0);
  c.update(0.9, 100);      // one bad sample
  c.update(0.0, 200);      // back to normal — the timer restarts
  assert.equal(c.update(0.9, 500), null, 'the clock started over');
  assert.equal(c.tier, 'full');
});

test('it cascades down while the problem lasts', () => {
  const c = new TierController({ dwellDownMs: 100 });
  assert.equal(c.update(0.9, 0), null);
  assert.equal(c.update(0.9, 200), 'reduced');
  assert.equal(c.update(0.9, 400), 'minimal');
  assert.equal(c.update(0.9, 600), null, 'there is nothing below minimal');
});

test('recovering costs far more time than degrading', () => {
  const c = new TierController({ dwellDownMs: 100, dwellUpMs: 4000, start: 'minimal' });
  c.update(0.0, 0);
  assert.equal(c.update(0.0, 2000), null, 'two good seconds are not enough');
  assert.equal(c.update(0.0, 4100), 'reduced');
});

test('an upgrade that goes wrong makes the next one costlier', () => {
  const c = new TierController({ dwellDownMs: 100, dwellUpMs: 1000, start: 'reduced' });

  // Climbs to full once the dwell time is served.
  c.update(0.0, 0);
  assert.equal(c.update(0.0, 1100), 'full');

  // And immediately blows up. Back to reduced, and the upgrade is recorded.
  c.update(0.9, 1150);
  assert.equal(c.update(0.9, 1300), 'reduced');

  // The same climb now demands twice the time: 1000 x (1 + 1 regret).
  c.update(0.0, 1400);
  assert.equal(c.update(0.0, 2500), null, 'with regret, 1.1 s no longer suffices');
  assert.equal(c.update(0.0, 3500), 'full', 'it wants 2 s');
});

test('the dead zone between thresholds does nothing — that is its job', () => {
  const c = new TierController({ downMissRate: 0.2, upMissRate: 0.02, dwellDownMs: 10, dwellUpMs: 10, start: 'reduced' });
  for (let t = 0; t < 5000; t += 100) {
    assert.equal(c.update(0.1, t), null, 'between 0.02 and 0.2 it stays put');
  }
  assert.equal(c.tier, 'reduced');
});
