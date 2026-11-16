'use strict';
// Node performance measurement (SPEC 9, P3): simulate(getScenario('peak-outage'), { seeds: 20, seedStart: 1 }).
// One warm-up run, then 10 measured runs with process.hrtime.bigint(); p95 is the nearest rank (the slowest of 10).
// Writes dist/logs/perf-node.json. Exit 0 if the budget is met, 1 if missed.
const fs = require('fs');
const path = require('path');
const R = require('../js/routelab.js');
const pkg = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const BUDGET_MS = 1500;

function once() {
  const t = process.hrtime.bigint();
  R.simulate(R.getScenario('peak-outage'), { seeds: 20, seedStart: 1 });
  return Number(process.hrtime.bigint() - t) / 1e6;
}

function main() {
  once();
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push(once());
  const sorted = runs.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  const r1 = (x) => Math.round(x * 10) / 10;
  const out = { version: pkg.version, node: process.version, runsMs: runs.map(r1), p50: r1(q(0.5)), p95: r1(q(0.95)), budgetMs: BUDGET_MS, pass: q(0.95) <= BUDGET_MS };
  fs.mkdirSync(path.join(ROOT, 'dist', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'logs', 'perf-node.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('P3 (Node ' + process.version + '): 10 runs, p50 ' + out.p50 + ' ms, p95 ' + out.p95 + ' ms, budget ' + BUDGET_MS + ' ms: ' + (out.pass ? 'PASS' : 'MISS'));
  return out.pass ? 0 : 1;
}

process.exitCode = main();
