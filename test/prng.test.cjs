'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/prng.js');

function counting(rng) { const f = () => { f.n++; return rng(); }; f.n = 0; return f; }

test('SPEC 3.4 vectors', () => {
  const r = P.mulberry32(1);
  assert.equal(r(), 0.6270739405881613);
  assert.equal(r(), 0.002735721180215478);
  assert.equal(r(), 0.5274470399599522);
  assert.equal(P.fnv1a(''), 2166136261);
  assert.equal(P.fnv1a('a'), 0xe40c292c);
  assert.equal(P.deriveSeed(1, 'traffic'), 2816405663);
  assert.equal(P.deriveSeed(1, 'strategy:thompson'), 2752781027);
});

test('draw counts of every helper', () => {
  const c = () => counting(P.stream(7, 'count'));
  let r = c(); P.normal(r); assert.equal(r.n, 2);
  r = c(); P.weightedIndex(r, [1, 2, 3]); assert.equal(r.n, 1);
  r = c(); assert.equal(P.poissonSmall(r, 0), 0); assert.equal(r.n, 1);
  r = c(); const k = P.poissonSmall(r, 4); assert.equal(r.n, k + 1);
  r = c(); P.poisson(r, 0); assert.equal(r.n, 1);
  r = c(); P.poisson(r, 75); assert.ok(r.n >= 3);
});

test('normal: mean 0 and variance 1 within 0.01 (400,000 draws)', () => {
  const r = P.stream(1, 'test:normal');
  let s = 0; let s2 = 0; const N = 400000;
  for (let i = 0; i < N; i++) { const x = P.normal(r); s += x; s2 += x * x; }
  const m = s / N;
  assert.ok(Math.abs(m) < 0.01, 'mean ' + m);
  assert.ok(Math.abs(s2 / N - m * m - 1) < 0.01, 'variance');
});

test('gamma means within 1% relative (200,000 draws per shape)', () => {
  for (const a of [1, 2.5, 30]) {
    const r = P.stream(2, 'test:gamma:' + a);
    let s = 0; const N = 200000;
    for (let i = 0; i < N; i++) s += P.gamma(r, a);
    assert.ok(Math.abs(s / N - a) / a < 0.01, 'shape ' + a + ' mean ' + s / N);
  }
  assert.throws(() => P.gamma(P.stream(1, 'x'), 0.5), RangeError);
});

test('beta means within 0.005 (200,000 draws each)', () => {
  for (const [a, b] of [[2, 5], [30, 3], [1, 1]]) {
    const r = P.stream(3, 'test:beta:' + a + ':' + b);
    let s = 0; const N = 200000;
    for (let i = 0; i < N; i++) s += P.beta(r, a, b);
    assert.ok(Math.abs(s / N - a / (a + b)) < 0.005, a + ',' + b + ' mean ' + s / N);
  }
});

test('poisson mean and variance within 2% relative (400,000 draws each)', () => {
  for (const l of [0.5, 5, 29.9, 30, 75]) {
    const r = P.stream(4, 'test:poisson:' + l);
    let s = 0; let s2 = 0; const N = 400000;
    for (let i = 0; i < N; i++) { const x = P.poisson(r, l); s += x; s2 += x * x; }
    const m = s / N;
    assert.ok(Math.abs(m - l) / l < 0.02, 'lambda ' + l + ' mean ' + m);
    assert.ok(Math.abs(s2 / N - m * m - l) / l < 0.02, 'lambda ' + l + ' variance');
  }
});

test('weightedIndex frequencies within 0.005 (200,000 draws)', () => {
  const r = P.stream(5, 'test:wi');
  const cnt = [0, 0, 0]; const N = 200000;
  for (let i = 0; i < N; i++) cnt[P.weightedIndex(r, [5, 3, 2])]++;
  [0.5, 0.3, 0.2].forEach((p, i) => assert.ok(Math.abs(cnt[i] / N - p) < 0.005, 'index ' + i));
});
