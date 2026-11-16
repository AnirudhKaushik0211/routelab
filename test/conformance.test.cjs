'use strict';
// SPEC 6.6: 84 pilot cells (3 scenarios x 7 policies x 4 values) on the pilot seeds 501-520.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/routelab.js');

const POLICIES = ['static', 'weighted', 'rules', 'egreedy', 'thompson', 'thompson_cost', 'oracle'];
const PILOT = {
  'steady': [[91.90, 88.98, 13.572, 0.00], [91.59, 87.28, 14.626, 17.20], [91.83, 88.59, 14.649, 3.83], [91.66, 87.69, 14.517, 12.98],
    [91.66, 87.71, 14.548, 12.85], [91.73, 88.06, 13.839, 9.11], [91.90, 88.98, 13.572, 0.00]],
  'peak-outage': [[90.72, 82.87, 13.683, 58.30], [90.98, 84.30, 14.709, 44.62], [90.82, 83.25, 14.778, 54.30], [91.50, 87.08, 14.667, 16.53],
    [91.47, 87.00, 14.793, 17.39], [91.51, 87.17, 14.031, 15.44], [91.82, 88.73, 13.721, 0.00]],
  'cost-vs-sr': [[90.53, 82.65, 11.565, 63.64], [91.08, 85.82, 14.581, 31.93], [91.35, 87.55, 13.038, 14.65], [91.41, 87.78, 16.311, 12.33],
    [91.46, 88.03, 16.646, 9.41], [91.19, 86.61, 12.769, 24.10], [91.63, 88.98, 17.569, 0.00]]
};
const UNIT = [0.01, 0.01, 0.001, 0.01];
const NAMES = ['order SR %', 'first SR %', 'cost per success', 'regret per 1,000'];

for (const id of Object.keys(PILOT)) {
  test('conformance with the design prototype: ' + id + ' (28 cells)', () => {
    const cfg = R.getScenario(id);
    const sums = POLICIES.map(() => [0, 0, 0, 0]);
    for (let seed = 501; seed <= 520; seed++) {
      const tr = R.traffic.generate(cfg, seed);
      POLICIES.forEach((p, pi) => {
        const m = R.metrics.dayMetrics(R.engine.runPolicy(cfg, tr, p, seed));
        sums[pi][0] += m.orderSr * 100; sums[pi][1] += m.firstSr * 100; sums[pi][2] += m.costPerSuccess; sums[pi][3] += m.regretPer1000;
      });
    }
    POLICIES.forEach((p, pi) => {
      for (let v = 0; v < 4; v++) {
        const x = sums[pi][v] / 20;
        const cell = PILOT[id][pi][v];
        assert.ok(Math.abs(x - cell) <= 0.5 * UNIT[v] + 1e-9, id + ' ' + p + ' ' + NAMES[v] + ': ' + x + ' vs ' + cell);
      }
    });
  });
}
