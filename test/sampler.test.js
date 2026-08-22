import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sampler } from '../src/sampler.js';

test('the mean hides what the user feels; p95 does not', () => {
  const s = new Sampler(100);
  for (let i = 0; i < 99; i++) s.push(16);
  s.push(400);

  // Mean ≈ 19.8 ms. Looks healthy. It is not.
  const mean = (99 * 16 + 400) / 100;
  assert.ok(mean < 20, 'the mean disguises the problem');

  assert.equal(s.median, 16, 'the typical frame is fine');
  assert.equal(s.p95, 16, 'at 1 in 100, p95 does not see it yet');
  assert.equal(s.percentile(1), 400, 'p100 does');
});

test('percentiles with a real tail', () => {
  const s = new Sampler(100);
  for (let i = 0; i < 90; i++) s.push(16);
  for (let i = 0; i < 10; i++) s.push(120);
  assert.equal(s.median, 16);
  assert.equal(s.p95, 120, 'p95 catches a 10% tail');
});

test('the window slides — the past falls out', () => {
  const s = new Sampler(10);
  for (let i = 0; i < 10; i++) s.push(100);
  assert.equal(s.median, 100);
  for (let i = 0; i < 10; i++) s.push(16);
  assert.equal(s.median, 16, 'old samples were overwritten');
  assert.equal(s.count, 10, 'the window does not grow');
});

test('missRate counts what crosses the threshold', () => {
  const s = new Sampler(10);
  for (let i = 0; i < 5; i++) s.push(10);
  for (let i = 0; i < 5; i++) s.push(30);
  assert.equal(s.missRate(25), 0.5);
  assert.equal(s.missRate(100), 0);
});

test('with no samples it does not invent numbers', () => {
  const s = new Sampler(16);
  assert.equal(s.median, 0);
  assert.equal(s.fps, 0);
  assert.equal(s.missRate(16), 0);
  assert.equal(s.ready, false);
});

test('an absurd window is rejected', () => {
  assert.throws(() => new Sampler(2), RangeError);
  assert.throws(() => new Sampler(1.5), RangeError);
});
