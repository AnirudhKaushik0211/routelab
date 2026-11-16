'use strict';
// SPEC 10.1 distributions.test.cjs: D1-D3 on the engine's output.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const T = require('../js/traffic.js');
const S = require('../js/scenarios.js');
const C = require('../js/config.js');
const MT = require('../js/metrics.js');

function build(decline) {
  const c = S.getScenario('steady');
  c.gateways = c.gateways.slice(0, 2);
  for (const g of c.gateways) {
    for (const m of C.METHODS) if (m !== 'card') g.methods[m] = null;
    g.methods.card = { sr: 0.9, p50: 4000, p95: 15000, fixedFee: 0, pctFee: 1.7 };
  }
  c.traffic.mix = { upi_intent: 0, upi_collect: 0, card: 100, netbanking: 0 };
  for (const m of C.METHODS) c.traffic.customerDecline[m] = decline;
  c.strategies.static.priority = ['A', 'B'];
  c.strategies.weighted.weights = { A: 50, B: 50 };
  c.strategies.rules.rules = [{ method: 'card', minAmount: 0, maxAmount: null, gateway: 'A' }];
  for (const k of ['weighted', 'rules', 'egreedy', 'thompson', 'thompson_cost']) c.strategies[k].enabled = false;
  c.retry.maxRetries = 0;
  c.run.txnPerDay = 50000;
  c.focus = null;
  const v = C.validateConfig(c);
  assert.ok(v.ok, JSON.stringify(v.errors));
  return v.config;
}

function runs(cfg) {
  const out = [];
  for (let seed = 1; seed <= 4; seed++) out.push(E.runPolicy(cfg, T.generate(cfg, seed), 'static', seed));
  return out;
}

test('D1: attempt success rate within 0.004 of 0.9; D2: time to success quantiles', () => {
  const rs = runs(build(0));
  let succ = 0; let att = 0; const tts = [];
  for (const r of rs) { succ += r.successfulAttempts; att += r.attempts; for (const x of r.tts) tts.push(x); }
  assert.ok(Math.abs(succ / att - 0.9) < 0.004, 'attempt SR ' + succ / att);
  tts.sort((a, b) => a - b);
  const p50 = tts[Math.ceil(0.5 * tts.length) - 1];
  const p95 = tts[Math.ceil(0.95 * tts.length) - 1];
  assert.ok(Math.abs(p50 - 4) / 4 < 0.02, 'p50 ' + p50);
  assert.ok(Math.abs(p95 - 15) / 15 < 0.03, 'p95 ' + p95);
});

test('D3: customer decline 0.2 gives a 0.2 share of customer endings', () => {
  const rs = runs(build(0.2));
  let cust = 0; let n = 0;
  for (const r of rs) { cust += r.reasons.customer; n += r.n; }
  assert.ok(Math.abs(cust / n - 0.2) < 0.004, 'share ' + cust / n);
  assert.ok(MT.dayMetrics(rs[0]).orderSr > 0);
});
