'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model.js');
const S = require('../js/scenarios.js');

const ev = (o) => Object.assign({ target: 'gateway', id: 'A', methods: [], start: 100, duration: 50, srFactor: 0.2, latencyFactor: 1, recovery: 20, repeatEvery: 0, repeatCount: 1 }, o);
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 1e-12), a + ' vs ' + b);

test('severity: inside, edges, recovery, repeats', () => {
  const e = ev({});
  assert.equal(M.severity(e, 99.9), 0);
  assert.equal(M.severity(e, 100), 1);
  assert.equal(M.severity(e, 149.9), 1);
  assert.equal(M.severity(e, 150), 1);
  near(M.severity(e, 160), 0.5);
  assert.equal(M.severity(e, 170), 0);
  assert.equal(M.severity(e, 400), 0);
  const r = ev({ recovery: 0, repeatEvery: 100, repeatCount: 3 });
  assert.equal(M.severity(r, 120), 1);
  assert.equal(M.severity(r, 180), 0);
  assert.equal(M.severity(r, 220), 1);
  assert.equal(M.severity(r, 320), 1);
  assert.equal(M.severity(r, 420), 0);
});

test('3.3 worked values for the peak-outage preset', () => {
  const c = S.getScenario('peak-outage');
  near(M.q(c, 0, 0, 1222.5), 0.5335);
  near(M.q(c, 0, 0, 1200), 0.097);
  near(M.q(c, 0, 0, 1230), 0.97);
  near(M.q(c, 1, 0, 1200), 0.94);
  const p = M.prepare(c);
  near(p.q(0, 0, 1222.5), 0.5335);
});

test('lognormalParams vector', () => {
  const p = M.lognormalParams(2500, 9000);
  near(p.mu, 7.824046010856292);
  near(p.sigma, 0.7787524825756766);
});

test('several events multiply; bank events and latency', () => {
  const c = S.getScenario('steady');
  c.events = [ev({ srFactor: 0.5, recovery: 0 }), ev({ srFactor: 0.5, recovery: 0, latencyFactor: 3 }), ev({ target: 'bank', id: 'X', srFactor: 0.4, recovery: 0 }),
    ev({ methods: ['card'], srFactor: 0, recovery: 0 })];
  near(M.gatewaySrMult(c, 0, 0, 120), 0.25);
  assert.equal(M.gatewaySrMult(c, 0, 2, 120), 0);
  near(M.gatewayLatMult(c, 0, 0, 120), 3);
  near(M.bankSrMult(c, 0, 0, 120), 0.4);
  near(M.bankSrMult(c, 1, 0, 120), 1);
  near(M.gatewaySrMult(c, 1, 0, 120), 1);
});

test('fee', () => {
  const c = S.getScenario('steady');
  near(M.fee(c, 0, 0, 1000), 0.5);
  near(M.fee(c, 0, 2, 1000), 17);
  near(M.fee(c, 1, 3, 5), 10);
});
