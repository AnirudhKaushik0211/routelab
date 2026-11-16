'use strict';
// SPEC 6.1, 6.2, 6.4, 6.5: preset spot checks, expectation rows, and every expectation on both fixed seed sets.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/routelab.js');
const S = require('../js/scenarios.js');

const FOCUS = { 'steady': [1080, 1440], 'peak-outage': [1170, 1230], 'collect-degradation': [600, 990], 'cost-vs-sr': null,
  'cold-start': [840, 1440], 'flapping': [540, 1260], 'issuer-outage': [1200, 1260] };
const ROW_COUNTS = { 'steady': 8, 'peak-outage': 6, 'collect-degradation': 3, 'cost-vs-sr': 6, 'cold-start': 6, 'flapping': 5, 'issuer-outage': 4 };

test('presets: order, meta fields and focus', () => {
  assert.deepEqual(S.ids, Object.keys(FOCUS));
  for (const s of R.scenarios) {
    assert.ok(s.story && s.changes && s.expectationText, s.id);
    assert.ok(s.expectationText.startsWith(s.story), 'story is the first sentence: ' + s.id);
    assert.equal(s.story.indexOf('. '), -1, 'single sentence story: ' + s.id);
    const c = R.getScenario(s.id);
    const f = FOCUS[s.id];
    assert.deepEqual(c.focus, f ? { start: f[0], end: f[1] } : null);
    assert.deepEqual(s.focus, c.focus);
  }
  assert.equal(R.scenarios[0].changes, 'none');
  assert.equal(R.scenarios[6].changes, 'event: bank X, all methods, start 1200 (20:00), duration 60, srFactor 0.20, latencyFactor 1, recovery 0');
});

test('6.1 and 6.2 spot checks', () => {
  const b = R.getScenario('steady');
  assert.deepEqual(b.run, { seeds: 20, seedStart: 1, txnPerDay: 10000 });
  assert.equal(b.gateways.length, 3);
  assert.equal(b.gateways[0].methods.upi_intent.sr, 0.97);
  assert.equal(b.gateways[2].methods.netbanking.fixedFee, 12);
  assert.deepEqual(b.retry, { maxRetries: 2, mode: 'other', delaySec: 3 });
  assert.equal(b.strategies.rules.rules.length, 5);
  const p = R.getScenario('peak-outage');
  assert.deepEqual(p.events[0], { target: 'gateway', id: 'A', methods: [], start: 1170, duration: 45, srFactor: 0.1, latencyFactor: 1, recovery: 15, repeatEvery: 0, repeatCount: 1 });
  const c = R.getScenario('collect-degradation').events[0];
  assert.deepEqual([c.methods, c.start, c.duration, c.srFactor, c.latencyFactor, c.recovery], [['upi_collect'], 600, 360, 0.5, 2, 30]);
  const k = R.getScenario('cost-vs-sr');
  assert.equal(k.gateways.length, 2);
  assert.deepEqual(k.strategies.static.priority, ['B', 'A']);
  assert.equal(k.gateways[1].methods.card.sr, 0.88);
  assert.equal(k.gateways[0].methods.card.pctFee, 2.1);
  const w = R.getScenario('cold-start');
  assert.equal(w.gateways[3].id, 'D'); assert.equal(w.gateways[3].activeFrom, 720); assert.equal(w.gateways[3].methods.upi_intent.sr, 0.99);
  assert.deepEqual(w.strategies.weighted.weights, { A: 50, B: 30, C: 20, D: 0 });
  const f = R.getScenario('flapping').events[0];
  assert.deepEqual([f.start, f.duration, f.srFactor, f.recovery, f.repeatEvery, f.repeatCount], [540, 10, 0.2, 0, 30, 24]);
  const i = R.getScenario('issuer-outage').events[0];
  assert.deepEqual([i.target, i.id, i.start, i.duration, i.srFactor], ['bank', 'X', 1200, 60, 0.2]);
});

test('every 6.4 row is present with its threshold', () => {
  const T = { ST2: [-0.001, 0.01], ST3: 0, ST4: 0.02, ST5: 0.008, ST6: 0.55, ST7: 5, ST8: 0.003, PO1: 0.05, PO2: 0.05, PO3: 0.003, PO4: 20, PO5: 0.1, PO6: 1,
    CD1: 0.05, CD2: 0.05, CD3: [-0.01, 0.01], CS1: 0.006, CS2: 0, CS3: 0.015, CS4: 0.1, CS5: 0, CS6: 0.002, CO1: 0.5, CO2: 0.003, CO3: 0, CO4: 0, CO5: 1,
    CO6: 0.08, FL1: 0.015, FL2: 0.015, FL3: 50, FL4: 15, FL5: 15, IO2: [-0.02, 0.005], IO3: 0.1, IO4: 0.1 };
  let count = 0;
  for (const s of S.scenarios) {
    assert.equal(s.expectations.length, ROW_COUNTS[s.id], s.id);
    for (const r of s.expectations) {
      count++;
      if (r.id === 'ST1' || r.id === 'IO1') { assert.equal(r.op, 'exactlyEqual'); continue; }
      const t = T[r.id];
      if (Array.isArray(t)) assert.deepEqual([r.threshold, r.threshold2], t, r.id);
      else assert.equal(r.threshold, t, r.id);
    }
  }
  assert.equal(count, 38);
});

for (const [name, seeds] of [['RESULTS_SEEDS (101-130)', R.RESULTS_SEEDS], ['ROBUST_SEEDS (1-20)', R.ROBUST_SEEDS]]) {
  test('every expectation holds on ' + name, () => {
    const failed = [];
    for (const s of R.scenarios) {
      const res = R.simulate(R.getScenario(s.id), { scenarioId: s.id, seeds: seeds.seeds, seedStart: seeds.seedStart });
      assert.equal(res.expectations.length, ROW_COUNTS[s.id]);
      for (const e of res.expectations) if (e.held !== true) failed.push(e.id + ': ' + e.detail);
    }
    assert.deepEqual(failed, []);
  });
}
