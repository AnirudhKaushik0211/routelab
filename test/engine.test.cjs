'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const T = require('../js/traffic.js');
const S = require('../js/scenarios.js');
const C = require('../js/config.js');
const MT = require('../js/metrics.js');
const R = require('../js/routelab.js');

// Hand-built traffic: txns = [{t, method, amount, bank, customer, uS, z, uD}] with defaults uS 0.5, z 0, uD 0.99.
function traffic(txns) {
  const n = txns.length;
  const o = { n, t: new Float64Array(n), method: new Uint8Array(n), amount: new Float64Array(n), bank: new Uint8Array(n),
    customer: new Uint8Array(n), uS: new Float64Array(4 * n).fill(0.5), z: new Float64Array(4 * n), uD: new Float64Array(4 * n).fill(0.99) };
  txns.forEach((x, i) => {
    o.t[i] = x.t; o.method[i] = x.method === undefined ? 2 : x.method; o.amount[i] = x.amount || 1000;
    o.bank[i] = x.bank || 0; o.customer[i] = x.customer ? 1 : 0;
    for (let k = 0; k < 4; k++) {
      if (x.uS && x.uS[k] !== undefined) o.uS[4 * i + k] = x.uS[k];
      if (x.uD && x.uD[k] !== undefined) o.uD[4 * i + k] = x.uD[k];
    }
  });
  return o;
}
function cfgWith(mut) {
  const c = S.getScenario('steady');
  mut(c);
  const v = C.validateConfig(c);
  assert.ok(v.ok, JSON.stringify(v.errors));
  return v.config;
}
const card = (g, sr) => { g.methods.card.sr = sr; };

test('E1: success on the first attempt with fee and time to success', () => {
  const c = cfgWith((c) => { card(c.gateways[0], 1); });
  const run = E.runPolicy(c, traffic([{ t: 10, amount: 2000 }]), 'static', 1);
  assert.equal(run.success, 1); assert.equal(run.firstSuccess, 1); assert.equal(run.attempts, 1);
  assert.ok(Math.abs(run.fees - 0.017 * 2000) < 1e-9);
  assert.ok(Math.abs(run.tts[0] - 4) < 1e-9, 'latency from z = 0 is p50 4000 ms: ' + run.tts[0]);
});

test('E2: A fails, B succeeds on retry', () => {
  const c = cfgWith((c) => { card(c.gateways[0], 0); card(c.gateways[1], 1); });
  const run = E.runPolicy(c, traffic([{ t: 10 }]), 'static', 1);
  assert.equal(run.success, 1); assert.equal(run.firstSuccess, 0); assert.equal(run.attempts, 2);
  assert.ok(Math.abs(run.tts[0] - (4 + 3 + 4)) < 1e-6, 'tts ' + run.tts[0]);
});

test('E3: drop-off ends the transaction after one attempt', () => {
  const c = cfgWith((c) => { card(c.gateways[0], 0); card(c.gateways[1], 1); });
  const run = E.runPolicy(c, traffic([{ t: 10, uD: [0] }]), 'static', 1);
  assert.equal(run.reasons.dropped, 1); assert.equal(run.attempts, 1); assert.equal(run.success, 0);
});

test('E4: customer decline ends with customer and does not train memory', () => {
  const c = cfgWith(() => {});
  const run = E.runPolicy(c, traffic([{ t: 10, customer: 1 }]), 'static', 1);
  assert.equal(run.reasons.customer, 1); assert.equal(run.attempts, 1);
  const S2 = require('../js/strategies.js');
  const spy = S2.createMemory('discount', 20);
  let updates = 0;
  const orig = spy.update;
  spy.update = function () { updates++; return orig.apply(this, arguments); };
  assert.equal(updates, 0);
  const run2 = E.runPolicy(c, traffic([{ t: 10, customer: 1 }]), 'thompson', 1);
  assert.equal(run2.reasons.customer, 1);
});

test('E5: same-gateway retries end technical after three attempts', () => {
  const c = cfgWith((c) => { c.retry.mode = 'same'; card(c.gateways[0], 0); });
  const run = E.runPolicy(c, traffic([{ t: 10 }]), 'static', 1);
  assert.equal(run.attempts, 3); assert.equal(run.reasons.technical, 1);
});

test('E6: capacity limit gives rate_limited and the retry goes to B', () => {
  const c = cfgWith((c) => { c.gateways[0].capacityTpm = 1; card(c.gateways[1], 1); });
  const run = E.runPolicy(c, traffic([{ t: 10.1, uS: [0] }, { t: 10.2 }]), 'static', 1);
  assert.equal(run.success, 2);
  assert.equal(run.attempts, 3, 'second transaction needed a retry after being rate limited');
});

test('E7: no information from the future (decision before completion)', () => {
  const c = cfgWith((c) => { card(c.gateways[0], 0); });
  // Two transactions 0.001 minutes apart: A's first attempt (4 s latency) has not completed at the second decision.
  const tr = traffic([{ t: 10 }, { t: 10.001 }]);
  const calls = [];
  const S2 = require('../js/strategies.js');
  const orig = S2.create;
  S2.create = function (cfg, id, seed) {
    const p = orig(cfg, id, seed);
    return { choose: function (ctx, el) { calls.push({ t: ctx.t, updates: updates }); return p.choose(ctx, el); }, update: function () { updates++; return p.update.apply(p, arguments); } };
  };
  let updates = 0;
  try { E.runPolicy(c, tr, 'thompson', 1); } finally { S2.create = orig; }
  assert.equal(calls[0].updates, 0);
  assert.equal(calls[1].t, 10.001);
  assert.equal(calls[1].updates, 0, 'no update before the first completion');
});

test('E8: no gateway left ends no_route', () => {
  const c = cfgWith((c) => { card(c.gateways[0], 0); card(c.gateways[1], 0); card(c.gateways[2], 0); c.retry.maxRetries = 3; });
  const run = E.runPolicy(c, traffic([{ t: 10 }]), 'static', 1);
  assert.equal(run.attempts, 3);
  assert.equal(run.reasons.no_route, 1);
});

test('invariants for every preset, every policy, seeds 1-3; determinism', () => {
  for (const id of S.ids) {
    const c = S.getScenario(id);
    for (let seed = 1; seed <= 3; seed++) {
      const tr = T.generate(c, seed);
      for (const p of C.POLICY_IDS) {
        const r = E.runPolicy(c, tr, p, seed);
        const sum = C.REASONS.reduce((a, k) => a + r.reasons[k], 0);
        assert.equal(sum, r.n, id + ' ' + p);
        assert.ok(r.attempts <= r.n * (1 + c.retry.maxRetries));
        assert.ok(r.success >= r.firstSuccess);
        assert.ok(r.regretSum >= -1e-9);
        assert.ok(r.fees >= 0);
        if (p === 'oracle') assert.equal(r.regretSum, 0);
        const G = r.G;
        for (let b = 0; b < 96; b++) {
          let s = 0; for (let g = 0; g < G; g++) s += r.buckets.first[b * G + g];
          let n = 0; for (let m = 0; m < 4; m++) n += r.buckets.n[b * 4 + m];
          if (s > 0) {
            let ss = 0; for (let g = 0; g < G; g++) ss += r.buckets.first[b * G + g] / s;
            assert.ok(Math.abs(ss - 1) < 1e-9);
          }
          assert.ok(n >= 0);
        }
        if (seed === 1 && p === 'thompson') {
          const again = E.runPolicy(c, tr, p, seed);
          assert.equal(JSON.stringify(MT.dayMetrics(again)), JSON.stringify(MT.dayMetrics(r)));
          assert.equal(again.attempts, r.attempts);
        }
      }
    }
  }
});

test('pairing: switching epsilon-greedy off leaves the other policies unchanged', () => {
  const c = S.getScenario('peak-outage');
  const d = JSON.parse(JSON.stringify(c)); d.strategies.egreedy.enabled = false;
  const a = R.simulate(c, { seeds: 2, seedStart: 1 });
  const b = R.simulate(d, { seeds: 2, seedStart: 1 });
  for (const p of ['static', 'weighted', 'rules', 'thompson', 'thompson_cost', 'oracle']) {
    assert.deepEqual(a.perSeed[p], b.perSeed[p], p);
  }
  assert.equal(b.perSeed.egreedy, undefined);
});
