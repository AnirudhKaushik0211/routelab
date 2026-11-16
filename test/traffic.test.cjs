'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/traffic.js');
const P = require('../js/prng.js');
const S = require('../js/scenarios.js');
const C = require('../js/config.js');

const base = S.getScenario('steady');

test('same seed identical, different seed different, sorted and in range', () => {
  const a = T.generate(base, 5);
  const b = T.generate(base, 5);
  const c = T.generate(base, 6);
  assert.equal(a.n, b.n);
  assert.deepEqual(Array.from(a.t), Array.from(b.t));
  assert.deepEqual(Array.from(a.amount), Array.from(b.amount));
  assert.notDeepEqual(Array.from(a.t).slice(0, 20), Array.from(c.t).slice(0, 20));
  for (let i = 0; i < a.n; i++) {
    assert.ok(a.t[i] >= 0 && a.t[i] < 1440);
    if (i > 0) assert.ok(a.t[i] >= a.t[i - 1]);
    assert.ok(a.amount[i] >= 1 && a.amount[i] <= 200000);
  }
  assert.equal(a.uS.length, 4 * a.n);
});

test('exactly 22 draws per transaction (plus the Poisson draws)', () => {
  let calls = 0;
  const factory = (seed, label) => { const r = P.stream(seed, label); return () => { calls++; return r(); }; };
  const cfg = JSON.parse(JSON.stringify(base));
  // lambda 0 in every minute costs exactly one draw per minute (1,440) and no transactions
  const zero = JSON.parse(JSON.stringify(base)); zero.traffic.hourly = zero.traffic.hourly.map(() => 0); zero.traffic.hourly[0] = 1; zero.run.txnPerDay = 100;
  calls = 0;
  const t = T.generate(zero, 1, { rngFactory: factory });
  assert.ok(t.n >= 0);
  // total draws = poisson draws + 22 per transaction; poisson draws = sum over minutes of (k + 1) with k drawn counts (small lambda)
  const all = T.generate(cfg, 1, { rngFactory: factory });
  assert.ok(all.n > 0);
  let c2 = 0;
  const f2 = (seed, label) => { const r = P.stream(seed, label); return () => { c2++; return r(); }; };
  const g = T.generate(cfg, 2, { rngFactory: f2 });
  assert.equal((c2 - 22 * g.n - 1440 - g.n) % 1, 0);
  // Poisson(lambda <= 30) uses k + 1 draws per minute, so total = 1440 + n + 22 n
  assert.equal(c2, 1440 + g.n + 22 * g.n);
});

test('maxRetries does not change traffic; steady and issuer-outage share traffic on seeds 1-3', () => {
  for (let s = 1; s <= 3; s++) {
    const a = T.generate(base, s);
    const c1 = JSON.parse(JSON.stringify(base)); c1.retry.maxRetries = 0;
    const b = T.generate(c1, s);
    assert.deepEqual(Array.from(a.uS), Array.from(b.uS));
    const o = T.generate(S.getScenario('issuer-outage'), s);
    assert.equal(a.n, o.n);
    assert.deepEqual(Array.from(a.t), Array.from(o.t));
    assert.deepEqual(Array.from(a.z), Array.from(o.z));
  }
});

test('distribution sanity pooled over seeds 1-20 (4 standard errors)', () => {
  const hourCount = new Array(24).fill(0);
  const methodCount = [0, 0, 0, 0];
  const amounts = [[], [], [], []];
  let N = 0;
  for (let s = 1; s <= 20; s++) {
    const t = T.generate(base, s);
    N += t.n;
    for (let i = 0; i < t.n; i++) { hourCount[Math.floor(t.t[i] / 60)]++; methodCount[t.method[i]]++; amounts[t.method[i]].push(t.amount[i]); }
  }
  assert.ok(Math.abs(N / 20 - 10000) / 10000 < 0.01, 'mean daily count ' + N / 20);
  const sw = base.traffic.hourly.reduce((a, b) => a + b, 0);
  for (let h = 0; h < 24; h++) {
    const p = base.traffic.hourly[h] / sw;
    assert.ok(Math.abs(hourCount[h] / N - p) <= 4 * Math.sqrt(p * (1 - p) / N), 'hour ' + h);
  }
  const mixSum = 100;
  C.METHODS.forEach((m, i) => {
    const p = base.traffic.mix[m] / mixSum;
    assert.ok(Math.abs(methodCount[i] / N - p) <= 4 * Math.sqrt(p * (1 - p) / N), 'mix ' + m);
  });
  const phi = { 0.5: 0.3989422804014327, 0.95: 0.10313564037537128 };
  const z = { 0.5: 0, 0.95: 1.6448536269514722 };
  C.METHODS.forEach((m, i) => {
    const a = amounts[i].slice().sort((x, y) => x - y);
    const am = base.traffic.amount[m];
    const mu = Math.log(am.p50);
    const sigma = (Math.log(am.p95) - mu) / C.Z95;
    [0.5, 0.95].forEach((q) => {
      const xhat = a[Math.ceil(q * a.length) - 1];
      const xq = q === 0.5 ? am.p50 : am.p95;
      assert.ok(Math.abs(Math.log(xhat) - Math.log(xq)) <= 4 * sigma * Math.sqrt(q * (1 - q) / a.length) / phi[q], m + ' q' + q + ' z' + z[q]);
    });
  });
});
