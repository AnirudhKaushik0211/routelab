'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/routelab.js');
const pkg = require('../package.json');

test('7.1 surface', () => {
  assert.equal(R.VERSION, pkg.version);
  assert.equal(R.CSP_META, true);
  for (const k of ['METHODS', 'METHOD_LABELS', 'STRATEGY_IDS', 'POLICY_IDS', 'POLICY_LABELS', 'REASONS', 'REASON_LABELS', 'GATEWAY_IDS', 'BANK_IDS',
    'scenarios', 'RESULTS_SEEDS', 'ROBUST_SEEDS', 'getScenario', 'validateConfig', 'createRunner', 'simulate', 'toJson', 'toCsv', 'buildMemo',
    'encodeState', 'decodeState', 'charts', 'prng', 'stats', 'config', 'model', 'strategies', 'engine', 'metrics', 'traffic']) {
    assert.ok(R[k] !== undefined, k);
  }
  assert.equal(R.scenarios.length, 7);
  assert.deepEqual(Object.keys(R.scenarios[0]), ['id', 'title', 'story', 'changes', 'expectationText', 'focus']);
  assert.deepEqual(R.RESULTS_SEEDS, { seedStart: 101, seeds: 30 });
  assert.deepEqual(R.ROBUST_SEEDS, { seedStart: 1, seeds: 20 });
  assert.throws(() => R.getScenario('nope'), (e) => e instanceof RangeError && e.message === 'unknown scenario: nope');
});

test('runner: total, unit order, result before completion, step after completion', () => {
  const c = R.getScenario('steady');
  const r = R.createRunner(c, { seeds: 2, seedStart: 5 });
  assert.equal(r.total, 14);
  assert.equal(r.done, 0);
  assert.throws(() => r.result(), (e) => e.message === 'runner not finished');
  let i = 0;
  while (!r.isDone()) { const d = r.step(); i++; assert.equal(d, i === 14); }
  assert.equal(r.done, 14);
  assert.equal(r.step(), true);
  assert.equal(r.done, 14);
  const res = r.result();
  assert.deepEqual(res.seeds, [5, 6]);
  assert.deepEqual(res.perSeed.static.map((x) => x.seed), [5, 6]);
});

test('option and config errors', () => {
  const c = R.getScenario('steady');
  assert.throws(() => R.createRunner(c, { seeds: 0 }), RangeError);
  assert.throws(() => R.createRunner(c, { seeds: 101 }), RangeError);
  assert.throws(() => R.createRunner(c, { seeds: 2, seedStart: 4294967295 }), RangeError);
  assert.throws(() => R.createRunner(c, { seedStart: -1 }), RangeError);
  const bad = JSON.parse(JSON.stringify(c)); bad.run.seeds = 0;
  assert.throws(() => R.createRunner(bad), (e) => e instanceof TypeError && e.message === 'invalid config: run.seeds: must be a whole number from 1 to 100');
  assert.equal(R.validateConfig({}).ok, false);
});

test('same configuration and seeds give identical JSON', () => {
  const c = R.getScenario('peak-outage');
  const a = R.toJson(R.simulate(c, { scenarioId: 'peak-outage', seeds: 2 }));
  const b = R.toJson(R.simulate(c, { scenarioId: 'peak-outage', seeds: 2 }));
  assert.equal(a, b);
  assert.ok(a.endsWith('\n'));
});

test('README Node example', () => {
  const RouteLab = require('../js/routelab.js');
  const config = RouteLab.getScenario('peak-outage');
  const results = RouteLab.simulate(config, { scenarioId: 'peak-outage', seeds: 20, seedStart: 1 });
  const line = results.summary.thompson.orderSr.mean + ' ' + results.expectations.map((e) => e.id + ' ' + e.held).join(',');
  assert.match(line, /^0\.9\d+ PO1 true/);
});

test('encodeState and decodeState are exposed and round-trip', () => {
  const c = R.getScenario('flapping');
  const d = R.decodeState(R.encodeState(c));
  assert.equal(d.ok, true);
  assert.deepEqual(d.config, c);
});
