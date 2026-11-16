'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/strategies.js');
const S = require('../js/scenarios.js');

const cfg = () => S.getScenario('steady');
const ctx = (method, amount, t) => ({ t: t || 0, method, amount, attempt: 0 });

test('memory examples (4.5)', () => {
  const d = ST.createMemory('discount', 20);
  d.update('k', 1, 0);
  d.update('k', 0, 10);
  const r = d.read('k', 30);
  assert.ok(Math.abs(r.a - 0.3535533905932738) < 1e-12);
  assert.ok(Math.abs(r.b - 0.5) < 1e-12);
  const w = ST.createMemory('window', 30);
  w.update('k', 1, 0); w.update('k', 0, 10); w.update('k', 1, 25); w.update('k', 1, 35);
  assert.deepEqual(w.read('k', 40), { a: 2, b: 0 });
  const n = ST.createMemory('none', 5);
  n.update('k', 1, 0); n.update('k', 0, 1000);
  assert.deepEqual(n.read('k', 5000), { a: 1, b: 1 });
});

test('static, eligibility and fallbacks', () => {
  const p = ST.create(cfg(), 'static', 1);
  assert.equal(p.choose(ctx(0, 10), [0, 1, 2]), 0);
  assert.equal(p.choose(ctx(0, 10), [1, 2]), 1);
  assert.equal(p.choose(ctx(0, 10), [2]), 2);
});

test('rules: boundaries, any, fallbacks', () => {
  const c = cfg();
  c.strategies.rules.rules = [
    { method: 'card', minAmount: 1000, maxAmount: 5000, gateway: 'C' },
    { method: 'any', minAmount: 0, maxAmount: null, gateway: 'B' }];
  const p = ST.create(c, 'rules', 1);
  assert.equal(p.choose(ctx(2, 999.99), [0, 1, 2]), 1);
  assert.equal(p.choose(ctx(2, 1000), [0, 1, 2]), 2);
  assert.equal(p.choose(ctx(2, 4999.99), [0, 1, 2]), 2);
  assert.equal(p.choose(ctx(2, 5000), [0, 1, 2]), 1);
  assert.equal(p.choose(ctx(0, 1000), [0, 1, 2]), 1);
  assert.equal(p.choose(ctx(2, 2000), [0, 1]), 1, 'ineligible gateway falls to the next rule');
  assert.equal(p.choose(ctx(0, 10), [0, 2]), 0, 'no rule matches: static priority');
});

test('weighted frequencies over 200,000 decisions', () => {
  const p = ST.create(cfg(), 'weighted', 3);
  const cnt = [0, 0, 0]; const N = 200000;
  for (let i = 0; i < N; i++) cnt[p.choose(ctx(0, 10), [0, 1, 2])]++;
  [0.5, 0.3, 0.2].forEach((x, i) => assert.ok(Math.abs(cnt[i] / N - x) < 0.005));
  const c = cfg(); c.strategies.weighted.weights = { A: 0, B: 0, C: 5 };
  const q = ST.create(c, 'weighted', 1);
  assert.equal(q.choose(ctx(0, 1), [0, 1]), 0, 'zero total weight behaves as static');
});

test('epsilon-greedy: greedy with optimistic empty cells, uniform at epsilon 1, draw counts', () => {
  const c = cfg(); c.strategies.egreedy.epsilon = 0;
  const p = ST.create(c, 'egreedy', 1);
  assert.equal(p.choose(ctx(0, 1, 0), [0, 1, 2]), 0);
  p.update(0, 0, 0, 1); p.update(0, 0, 0, 2);
  assert.equal(p.choose(ctx(0, 1, 3), [0, 1, 2]), 1, 'A looks bad, B is untried (optimistic) and ranks before C');
  const c1 = cfg(); c1.strategies.egreedy.epsilon = 1;
  const u = ST.create(c1, 'egreedy', 2);
  const cnt = [0, 0, 0]; const N = 100000;
  for (let i = 0; i < N; i++) cnt[u.choose(ctx(0, 1, 0), [0, 1, 2])]++;
  cnt.forEach((x) => assert.ok(Math.abs(x / N - 1 / 3) < 0.01));
});

test('Thompson prefers the clearly better cell', () => {
  const p = ST.create(cfg(), 'thompson', 4);
  for (let i = 0; i < 10; i++) { p.update(0, 0, 1, 0); p.update(0, 1, 0, 0); }
  let a = 0; const N = 10000;
  for (let i = 0; i < N; i++) if (p.choose(ctx(0, 1, 0), [0, 1]) === 0) a++;
  assert.ok(a / N >= 0.999, 'share ' + a / N);
});

test('scoreThompson example and cost-aware choice', () => {
  const r = ST.scoreThompson([0.95, 0.90], [20, 14], 0.01);
  assert.ok(Math.abs(r.scores[0] - 0.75) < 1e-12 && Math.abs(r.scores[1] - 0.76) < 1e-12);
  assert.equal(r.index, 1);
  const c = cfg(); c.strategies.thompson_cost.lambda = 1;
  const p = ST.create(c, 'thompson_cost', 5);
  // Gateway A card fee is 1.7% of 100 = 1.7; gateway B 1.9: A cheaper. With lambda 1, a fee gap of 0.2 outweighs close thetas.
  let a = 0; const N = 2000;
  for (let i = 0; i < N; i++) if (p.choose(ctx(0, 100, 0), [0, 2]) === 0) a++;
  assert.ok(a / N > 0.7, 'cheap gateway share ' + a / N);
});

test('rank', () => { assert.equal(ST.rank(cfg(), 0), 0); assert.equal(ST.rank(cfg(), 2), 2); });
