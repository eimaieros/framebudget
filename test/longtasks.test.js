import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { LongTasks } from '../src/longtasks.js';

const original = globalThis.PerformanceObserver;
afterEach(() => {
  if (original) globalThis.PerformanceObserver = original;
  else delete globalThis.PerformanceObserver;
});

function fakeObserver(entries = []) {
  const calls = { observe: [], disconnect: 0 };
  class Observer {
    static supportedEntryTypes = ['longtask'];
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

test('long tasks are optional when PerformanceObserver is absent', () => {
  delete globalThis.PerformanceObserver;
  const tasks = new LongTasks();
  assert.equal(tasks.supported, false);
  assert.doesNotThrow(() => tasks.start());
  assert.equal(tasks.count, 0);
});

test('malformed long-task entries cannot poison the report', () => {
  fakeObserver([
    { duration: 80 },
    { duration: Number.NaN },
    { duration: -1 },
    { duration: Infinity },
  ]);
  const tasks = new LongTasks();
  tasks.start();
  assert.equal(tasks.count, 1);
  assert.equal(tasks.totalMs, 80);
  assert.equal(tasks.longestMs, 80);
});

test('start is idempotent; stop disconnects and reset clears aggregates', () => {
  const calls = fakeObserver([{ duration: 70 }]);
  const tasks = new LongTasks();
  tasks.start();
  tasks.start();
  assert.equal(calls.observe.length, 1);
  tasks.stop();
  assert.equal(calls.disconnect, 1);
  tasks.reset();
  assert.equal(tasks.count, 0);
  assert.equal(tasks.totalMs, 0);
  assert.equal(tasks.longestMs, 0);
});
