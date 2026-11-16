'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MT = require('../js/metrics.js');
const C = require('../js/config.js');
const R = require('../js/routelab.js');
const S = require('../js/scenarios.js');

function mkRun(rec, G) {
  G = G || 3;
  const b = { n: new Float64Array(384), success: new Float64Array(384), firstSuccess: new Float64Array(384), first: new Float64Array(96 * G),
    attempts: new Float64Array(96 * G), attemptSuccess: new Float64Array(96 * G), fees: new Float64Array(96) };
  return Object.assign({ policy: 'x', seed: 1, n: 0, G, success: 0, failed: 0, dropped: 0, firstSuccess: 0, attempts: 0, successfulAttempts: 0,
    fees: 0, successAmount: 0, regretSum: 0, reasons: { success: 0, customer: 0, technical: 0, rate_limited: 0, no_route: 0, dropped: 0 },
    tts: new Float64Array(0), buckets: b }, rec || {});
}

test('window metrics: bucket ranges, method filter, shares, null denominators', () => {
  const r = mkRun({}, 3);
  // bucket 2 (00:30-00:45): 10 txns, method 0: 6 of 10 ok ... use methods 0 and 1
  r.buckets.n[2 * 4 + 0] = 10; r.buckets.success[2 * 4 + 0] = 6; r.buckets.firstSuccess[2 * 4 + 0] = 5;
  r.buckets.n[2 * 4 + 1] = 10; r.buckets.success[2 * 4 + 1] = 9; r.buckets.firstSuccess[2 * 4 + 1] = 8;
  r.buckets.first[2 * 3 + 0] = 15; r.buckets.first[2 * 3 + 1] = 5;
  assert.equal(MT.windowSr(r, 30, 45, 'orderSr'), 15 / 20);
  assert.equal(MT.windowSr(r, 30, 45, 'firstSr'), 13 / 20);
  assert.equal(MT.windowSr(r, 30, 45, 'orderSr', 1), 0.9);
  assert.equal(MT.windowSr(r, 0, 30, 'orderSr'), null);
  assert.equal(MT.windowShare(r, 30, 45, 0), 0.75);
  assert.equal(MT.windowShare(r, 30, 45, 2), 0);
  assert.equal(MT.windowShare(r, 45, 60, 0), null);
  assert.equal(MT.windowSr(r, 0, 1440, 'orderSr'), 15 / 20);
});

test('dayMetrics: formulas and null forms', () => {
  const r = mkRun({ n: 100, success: 90, firstSuccess: 80, attempts: 120, successfulAttempts: 95, dropped: 4, failed: 6, fees: 180, successAmount: 9000,
    regretSum: 2, tts: Float64Array.from([1, 2, 3, 4]) });
  const d = MT.dayMetrics(r);
  assert.deepEqual(Object.keys(d), MT.DAY_KEYS);
  assert.equal(d.orderSr, 0.9); assert.equal(d.firstSr, 0.8); assert.equal(d.attemptSr, 95 / 120);
  assert.equal(d.retriesPerTxn, 0.2); assert.equal(d.costPerSuccess, 2); assert.equal(d.feeRatePct, 2);
  assert.equal(d.regretPer1000, 20); assert.equal(d.ttsP50, 2); assert.equal(d.ttsP95, 4);
  const z = MT.dayMetrics(mkRun({}));
  assert.equal(z.orderSr, null); assert.equal(z.costPerSuccess, null); assert.equal(z.ttsP95, null);
});

test('6.3 normative strings: text of PO1 and IO3, detail of CS4 and CO3', () => {
  const focus = { start: 1170, end: 1230 };
  const po1 = S.byId['peak-outage'].expectations[0];
  assert.equal(MT.expectationText(po1, focus), 'Thompson sampling - Static priority, order SR 19:30-20:30: at least +5.00 pp and CI above 0.');
  const io3 = S.byId['issuer-outage'].expectations[2];
  assert.equal(MT.expectationText(io3, { start: 1200, end: 1260 }), 'Static priority, order SR 20:00-21:00: a drop of at least +10.00 pp compared with 18:00-20:00.');
  // CS4 detail: relative difference 0.304 on 10 identical seeds
  const mk = (fees) => Array.from({ length: 10 }, () => mkRun({ n: 100, success: 100, fees }));
  const cs4 = S.byId['cost-vs-sr'].expectations[3];
  const e = MT.evalRow(cs4, { thompson: mk(130.4), thompson_cost: mk(100) }, null, ['A', 'B']);
  assert.equal(e.detail, 'Thompson sampling - Cost-aware Thompson, cost per success day: +30.40%; required relatively at least +10.00%.');
  assert.equal(e.held, true);
  // CO3 detail on 20 seeds
  const co3 = S.byId['cold-start'].expectations[2];
  const mk4 = () => Array.from({ length: 20 }, () => { const r = mkRun({}, 4); r.buckets.first[0 * 4 + 0] = 10; r.buckets.n[0] = 10; return r; });
  const e3 = MT.evalRow(co3, { static: mk4(), oracle: mk4() }, { start: 840, end: 1440 }, ['A', 'B', 'C', 'D']);
  assert.equal(e3.detail, 'Every policy, share of first attempts on Gateway D 00:00-12:00: 20 of 20 seeds matched; required exactly 0.00% on every seed.');
  assert.equal(e3.held, true);
  assert.equal(e3.value, 20);
});

test('expectation ops true and false on hand-built per-seed values', () => {
  const seeds = (arr) => arr.map((sr) => mkRun({ n: 1000, success: Math.round(sr * 1000), firstSuccess: Math.round(sr * 1000), fees: 100 }));
  const a = seeds([0.95, 0.96, 0.97, 0.955, 0.965]);
  const b = seeds([0.90, 0.91, 0.92, 0.905, 0.915]);
  const row = (op, th, extra) => Object.assign({ id: 'T', metric: 'orderSr', scope: 'day', a: 'x', b: 'y', op, threshold: th }, extra || {});
  const by = { x: a, y: b };
  assert.equal(MT.evalRow(row('diffAtLeast', 0.04), by, null, []).held, true);
  assert.equal(MT.evalRow(row('diffAtLeast', 0.06), by, null, []).held, false);
  assert.equal(MT.evalRow(row('diffAtLeastCi', 0.04), by, null, []).held, true);
  assert.equal(MT.evalRow(row('diffWithin', 0.04, { threshold2: 0.06 }), by, null, []).held, true);
  assert.equal(MT.evalRow(row('diffWithin', 0.00, { threshold2: 0.02 }), by, null, []).held, false);
  assert.equal(MT.evalRow(row('atLeast', 0.9, { b: undefined }), by, null, []).held, true);
  assert.equal(MT.evalRow(row('atMost', 0.9, { b: undefined }), by, null, []).held, false);
  const rel = MT.evalRow(Object.assign(row('relDiffAtLeast', 0.05), { metric: 'orderSr' }), by, null, []);
  assert.equal(rel.held, true); assert.equal(rel.ciLow, null);
  assert.equal(MT.evalRow(row('exactlyEqual'), { x: a, y: a }, null, []).held, true);
  assert.equal(MT.evalRow(row('exactlyEqual'), by, null, []).held, false);
  const win = MT.evalRow({ id: 'W', metric: 'orderSr', scope: [60, 120], before: [0, 60], a: 'x', op: 'windowDropAtLeast', threshold: 0.1 }, { x: a.map((r) => { const q = mkRun({ n: 100, success: 90 }); q.buckets.n[0] = 100; q.buckets.success[0] = 100; q.buckets.n[16] = 100; q.buckets.success[16] = 80; return q; }) }, null, []);
  assert.equal(win.held, true);
  assert.ok(Math.abs(win.value - 0.2) < 1e-12);
});

test('diffAtLeastCi with one seed: held false, null interval, explanatory detail; switched-off policy', () => {
  const one = { x: [mkRun({ n: 100, success: 95 })], y: [mkRun({ n: 100, success: 90 })] };
  const e = MT.evalRow({ id: 'T', metric: 'orderSr', scope: 'day', a: 'x', b: 'y', op: 'diffAtLeastCi', threshold: 0.01 }, one, null, []);
  assert.equal(e.held, false); assert.equal(e.ciLow, null);
  assert.ok(e.detail.indexOf('; needs at least 2 seeds for an interval; required') > 0, e.detail);
  const off = MT.evalRow({ id: 'T', metric: 'orderSr', scope: 'day', a: 'thompson', b: 'static', op: 'diffAtLeastCi', threshold: 0.01 }, { static: one.x }, null, []);
  assert.equal(off.held, null); assert.equal(off.value, null);
  assert.equal(off.detail, 'Not checked: Thompson sampling is switched off.');
});

test('results object: key order, rounding, title and expectationText placement', () => {
  const r = R.simulate(R.getScenario('steady'), { scenarioId: 'steady', seeds: 2, seedStart: 1 });
  assert.deepEqual(Object.keys(r), ['schema', 'version', 'scenarioId', 'preset', 'title', 'expectationText', 'configHash', 'config', 'seeds', 'policies',
    'baseline', 'focus', 'summary', 'status', 'paired', 'focusSummary', 'series', 'perSeed', 'expectations']);
  assert.equal(r.title, 'Steady state');
  assert.equal(r.preset, true);
  assert.equal(r.series.hourly.orderSr.static.length, 24);
  assert.equal(r.series.orderSr.static.length, 96);
  assert.equal(r.series.share.static.A.length, 96);
  assert.equal(r.series.hourly.gatewayAttemptSr.static.A.length, 24);
  assert.equal(MT.round6(-0.0000001), 0);
  assert.ok(Object.is(MT.round6(-0.0000001), 0));
  assert.equal(MT.round6(0.12345678), 0.123457);
  const c = R.simulate(R.getScenario('steady'), { seeds: 2 });
  assert.equal(c.preset, false); assert.equal(c.title, 'Custom settings'); assert.equal(c.expectationText, null); assert.equal(c.expectations, null);
  assert.equal(c.scenarioId, 'custom');
});

test('shares in a bucket sum to 1', () => {
  const r = R.simulate(R.getScenario('cold-start'), { seeds: 2 });
  for (let b = 0; b < 96; b++) {
    let s = 0; let any = false;
    for (const g of Object.keys(r.series.share.thompson)) { const v = r.series.share.thompson[g][b]; if (v !== null) { s += v; any = true; } }
    if (any) assert.ok(Math.abs(s - 1) < 1e-4);
  }
});
