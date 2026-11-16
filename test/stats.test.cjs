'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/stats.js');

test('t975 table and expansion vectors', () => {
  assert.equal(S.t975(4), 2.7764);
  assert.equal(S.t975(19), 2.0930);
  assert.ok(Math.abs(S.t975(31) - 2.0395) < 1e-4);
  assert.ok(Math.abs(S.t975(40) - 2.0211) < 1e-4);
  assert.ok(Math.abs(S.t975(60) - 2.0003) < 1e-4);
  assert.ok(Math.abs(S.t975(99) - 1.9842) < 1e-4);
});

test('worked interval (5.3)', () => {
  const s = S.summarise([0.95, 0.97, 0.96, 0.94, 0.98]);
  assert.ok(Math.abs(s.mean - 0.96) < 1e-12);
  assert.ok(Math.abs(s.sd - 0.01581138830084191) < 1e-12);
  assert.ok(Math.abs(s.ciLow - 0.9403678873271366) < 1e-12);
  assert.ok(Math.abs(s.ciHigh - 0.9796321126728633) < 1e-12);
  assert.equal(s.n, 5);
});

test('paired example (5.4)', () => {
  const p = S.paired([0.95, 0.96, 0.97], [0.94, 0.94, 0.96]);
  assert.ok(Math.abs(p.mean - 0.0133333333) < 1e-9);
  assert.ok(Math.abs(p.sd - 0.0057735027) < 1e-9);
  assert.ok(Math.abs(p.ciLow - -0.001009) < 1e-9);
  assert.ok(Math.abs(p.ciHigh - 0.0276756667) < 1e-9);
});

test('paired skips nulls on either side', () => {
  const p = S.paired([1, null, 3, 4], [0, 1, null, 2]);
  assert.equal(p.n, 2);
  assert.equal(p.mean, 1.5);
});

test('percentiles (5.5)', () => {
  const a = []; for (let i = 1; i <= 100; i++) a.push(i);
  assert.equal(S.percentile(a, 0.5), 50);
  assert.equal(S.percentile(a, 0.95), 95);
  assert.equal(S.percentile([1, 2, 3], 0.95), 3);
  assert.equal(S.percentile([7], 0.5), 7);
  assert.equal(S.percentile([], 0.5), null);
});

test('null forms for n < 2 and empty input', () => {
  assert.deepEqual(S.summarise([]), { mean: null, sd: null, ciLow: null, ciHigh: null, n: 0 });
  assert.deepEqual(S.summarise([3]), { mean: 3, sd: null, ciLow: null, ciHigh: null, n: 1 });
  assert.deepEqual(S.summarise([null, 3, undefined]), { mean: 3, sd: null, ciLow: null, ciHigh: null, n: 1 });
});
