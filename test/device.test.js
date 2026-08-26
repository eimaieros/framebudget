import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDevice, classify } from '../src/device.js';
import { FrameBudget } from '../src/index.js';

/**
 * These signals decide what the first second of a page looks like on a cheap
 * phone, so the thresholds are worth pinning. Every case here is a real device
 * class, not a made-up number.
 */

test('a laptop starts at full', () => {
  const d = readDevice({ hardwareConcurrency: 8, deviceMemory: 8 });
  assert.equal(d.tier, 'full');
});

test('a two-core phone with 2GB starts at minimal', () => {
  const d = readDevice({ hardwareConcurrency: 2, deviceMemory: 2 });
  assert.equal(d.tier, 'minimal');
  assert.match(d.reason, /2 cores/);
});

test('one weak signal alone only reaches reduced', () => {
  // Two signals agreeing is worth more than either on its own, because each
  // one is noisy enough to be misleading by itself.
  assert.equal(readDevice({ hardwareConcurrency: 2, deviceMemory: 8 }).tier, 'reduced');
  assert.equal(readDevice({ hardwareConcurrency: 8, deviceMemory: 2 }).tier, 'reduced');
});

test('a mid-range phone is not held back', () => {
  // 4 cores and 4GB is a device that will probably cope. Guessing on the
  // margin is how you end up degrading machines that were fine.
  assert.equal(readDevice({ hardwareConcurrency: 4, deviceMemory: 4 }).tier, 'full');
});

test('saveData is an instruction, not a hint', () => {
  const d = readDevice({
    hardwareConcurrency: 16,
    deviceMemory: 8,
    connection: { saveData: true, effectiveType: '4g' },
  });
  assert.equal(d.tier, 'minimal', 'a fast machine still gets minimal if asked');
  assert.equal(d.saveData, true);
});

test('a slow connection alone does not degrade anything', () => {
  // effectiveType describes the network. A fast phone on a train is not a
  // slow phone, and drawing is not downloading.
  const d = readDevice({
    hardwareConcurrency: 8,
    deviceMemory: 8,
    connection: { saveData: false, effectiveType: 'slow-2g' },
  });
  assert.equal(d.tier, 'full');
  assert.equal(d.effectiveType, 'slow-2g', 'still reported, just not acted on');
});

test('a browser that reports nothing gets no guess', () => {
  // Safari does not implement deviceMemory and pins hardwareConcurrency. A
  // device we cannot read is a device we do not guess about.
  const d = readDevice({});
  assert.equal(d.tier, 'full');
  assert.equal(d.cores, null);
  assert.equal(d.memory, null);
});

test('a navigator that throws on access does not take the page down', () => {
  const hostil = {
    get hardwareConcurrency() { throw new Error('no'); },
    get deviceMemory() { throw new Error('no'); },
  };
  const d = readDevice(hostil);
  assert.equal(d.tier, 'full');
});

test('nonsense values are ignored rather than believed', () => {
  assert.equal(readDevice({ hardwareConcurrency: 0, deviceMemory: -1 }).tier, 'full');
  assert.equal(readDevice({ hardwareConcurrency: NaN, deviceMemory: 'lots' }).tier, 'full');
});

// ── wiring ───────────────────────────────────────────────────────────────────

test('FrameBudget starts in the tier the device suggests', () => {
  const fb = new FrameBudget({ navigator: { hardwareConcurrency: 2, deviceMemory: 2 } });
  assert.equal(fb.tier, 'minimal');
  assert.equal(fb.report().startedAt, 'minimal');
});

test('adaptToDevice:false restores the old behaviour', () => {
  const fb = new FrameBudget({
    navigator: { hardwareConcurrency: 2, deviceMemory: 2 },
    adaptToDevice: false,
  });
  assert.equal(fb.tier, 'full');
  assert.equal(fb.report().startedAt, 'minimal', 'still measured, just not applied');
});

test('the guess is a floor to start from, not a ceiling', () => {
  // The whole design rests on this: a device we guessed wrong about must be
  // able to climb straight back to full. If this ever fails, the module has
  // stopped being a hint and become a cap.
  const fb = new FrameBudget({ navigator: { hardwareConcurrency: 2, deviceMemory: 2 } });
  assert.equal(fb.tier, 'minimal');

  // Feed it a perfectly healthy device: no misses, long enough to satisfy the
  // upward dwell time twice over.
  let t = 0;
  for (let i = 0; i < 1200; i++) {
    t += 16.6;
    fb.frame(t);
  }
  assert.equal(fb.tier, 'full', 'measurement overrides the guess');
});

test('a runtime with no document gets no guess applied', () => {
  // Node 22 ships a navigator with a real hardwareConcurrency, and CI runners
  // are small. Without the document check, importing this library in a test
  // runner started every instance in `reduced` — wrong, and invisible until an
  // unrelated test failed on one machine and not another.
  assert.equal(typeof document, 'undefined', 'this test only means anything in Node');
  const fb = new FrameBudget();
  assert.equal(fb.tier, 'full');
});
