import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud.js';

test('the HUD rejects update rates that cannot schedule safely', () => {
  const fb = { report: () => ({}) };
  for (const hz of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => new Hud(fb, { hz }), RangeError);
  }
});
