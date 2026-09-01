import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { LongAnimationFrames } from '../src/longframes.js';

const original = globalThis.PerformanceObserver;
afterEach(() => {
  if (original) globalThis.PerformanceObserver = original;
  else delete globalThis.PerformanceObserver;
});

function fakeObserver(entries = []) {
  const calls = { observe: [], disconnect: 0 };
  class Observer {
    static supportedEntryTypes = ['long-animation-frame'];
    constructor(callback) { this.callback = callback; }
    observe(options) {
      calls.observe.push(options);
      this.callback({ getEntries: () => entries });
    }
    disconnect() { calls.disconnect++; }
  }
  globalThis.PerformanceObserver = Observer;
  return calls;
}

test('absence is an optional zeroed measurement', () => {
  delete globalThis.PerformanceObserver;
  const loaf = new LongAnimationFrames();
  assert.equal(loaf.supported, false);
  assert.doesNotThrow(() => loaf.start());
  assert.equal(loaf.count, 0);
});

test('it observes frames from start, never buffered history', () => {
  const calls = fakeObserver([]);
  const loaf = new LongAnimationFrames();
  loaf.start();
  assert.deepEqual(calls.observe, [{ type: 'long-animation-frame' }]);
  loaf.stop();
  assert.equal(calls.disconnect, 1);
});

test('it records duration, blocking and forced-layout attribution', () => {
  fakeObserver([
    {
      duration: 81,
      blockingDuration: 27,
      scripts: [
        { forcedStyleAndLayoutDuration: 6 },
        { forcedStyleAndLayoutDuration: 2.5 },
      ],
    },
    { duration: 140, blockingDuration: 64, scripts: [] },
  ]);
  const loaf = new LongAnimationFrames();
  loaf.start();
  assert.equal(loaf.count, 2);
  assert.equal(loaf.totalMs, 221);
  assert.equal(loaf.longestMs, 140);
  assert.equal(loaf.blockingMs, 91);
  assert.equal(loaf.longestBlockingMs, 64);
  assert.equal(loaf.forcedStyleAndLayoutMs, 8.5);
});

test('malformed browser entries cannot poison the report', () => {
  fakeObserver([
    { duration: Number.NaN, blockingDuration: 9 },
    { duration: 60, blockingDuration: -1, scripts: [
      { forcedStyleAndLayoutDuration: Infinity },
    ] },
  ]);
  const loaf = new LongAnimationFrames();
  loaf.start();
  assert.equal(loaf.count, 1);
  assert.equal(loaf.totalMs, 60);
  assert.equal(loaf.blockingMs, 0);
  assert.equal(loaf.forcedStyleAndLayoutMs, 0);
});

test('start is idempotent and reset clears every aggregate', () => {
  const calls = fakeObserver([{ duration: 70, blockingDuration: 5 }]);
  const loaf = new LongAnimationFrames();
  loaf.start();
  loaf.start();
  assert.equal(calls.observe.length, 1);
  loaf.reset();
  assert.equal(loaf.count, 0);
  assert.equal(loaf.totalMs, 0);
  assert.equal(loaf.longestMs, 0);
  assert.equal(loaf.blockingMs, 0);
  assert.equal(loaf.longestBlockingMs, 0);
  assert.equal(loaf.forcedStyleAndLayoutMs, 0);
});

test('advertised support that throws degrades to unsupported', () => {
  class RefusingObserver {
    static supportedEntryTypes = ['long-animation-frame'];
    observe() { throw new Error('disabled by policy'); }
  }
  globalThis.PerformanceObserver = RefusingObserver;
  const loaf = new LongAnimationFrames();
  assert.doesNotThrow(() => loaf.start());
  assert.equal(loaf.supported, false);
});
