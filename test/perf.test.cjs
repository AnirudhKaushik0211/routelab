'use strict';
// SPEC 9, P3: simulate(getScenario('peak-outage'), { seeds: 20, seedStart: 1 }), 1 warm-up and 5 runs, slowest <= 1,500 ms.
// Calibrated on the author's machine; skipped with ROUTELAB_SKIP_PERF=1.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/routelab.js');

const skip = process.env.ROUTELAB_SKIP_PERF === '1' ? 'skipped: ROUTELAB_SKIP_PERF=1' : false;

test('P3: default run in Node stays within 1,500 ms', { skip: skip }, () => {
  const once = () => {
    const t = process.hrtime.bigint();
    R.simulate(R.getScenario('peak-outage'), { seeds: 20, seedStart: 1 });
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  once();
  const runs = [];
  for (let i = 0; i < 5; i++) runs.push(once());
  const slowest = Math.max.apply(null, runs);
  assert.ok(slowest <= 1500, 'slowest run ' + slowest.toFixed(0) + ' ms: ' + runs.map((x) => x.toFixed(0)).join(', '));
});
