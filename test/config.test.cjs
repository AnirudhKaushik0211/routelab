'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/config.js');
const S = require('../js/scenarios.js');
const P = require('../js/prng.js');

const ids = S.ids;
const preset = (id) => S.getScenario(id || 'peak-outage');

// Validates a mutated copy of peak-outage; returns the errors.
function errs(mut, id) {
  const c = JSON.parse(JSON.stringify(preset(id)));
  mut(c);
  return C.validateConfig(c).errors;
}
function expectErr(mut, path, message, id) {
  const e = errs(mut, id);
  assert.ok(e.some((x) => x.path === path && x.message === message), path + ' / ' + message + ' not in ' + JSON.stringify(e));
}

test('every preset validates and normalisation round-trips unchanged', () => {
  for (const id of ids) {
    const c = preset(id);
    const v = C.validateConfig(c);
    assert.ok(v.ok, id);
    assert.equal(C.canonicalJson(v.config), C.canonicalJson(c));
  }
});

test('7.2 rows: exact path and message', () => {
  expectErr((c) => { c.v = 2; }, '(root)', 'must be a RouteLab configuration object (v: 1)');
  expectErr((c) => { c.run.seeds = 0; }, 'run.seeds', 'must be a whole number from 1 to 100');
  expectErr((c) => { c.run.seedStart = -1; }, 'run.seedStart', 'must be a whole number from 0 to 4294967275');
  expectErr((c) => { c.run.txnPerDay = 99; }, 'run.txnPerDay', 'must be a whole number from 100 to 50,000');
  expectErr((c) => { c.traffic.hourly = [1]; }, 'traffic.hourly', 'must be 24 numbers from 0 to 10, not all 0');
  expectErr((c) => { c.traffic.hourly = c.traffic.hourly.map(() => 0); }, 'traffic.hourly', 'must be 24 numbers from 0 to 10, not all 0');
  expectErr((c) => { c.traffic.mix.card = 101; }, 'traffic.mix.card', 'must be a number from 0 to 100');
  expectErr((c) => { for (const k of Object.keys(c.traffic.mix)) c.traffic.mix[k] = 0; }, 'traffic.mix', 'traffic.mix: at least one method needs a share above 0');
  expectErr((c) => { c.traffic.customerDecline.card = 0.95; }, 'traffic.customerDecline.card', 'must be a number from 0 to 0.9');
  expectErr((c) => { c.traffic.amount.card.p50 = 0; }, 'traffic.amount.card.p50', 'must be a number from 1 to 1,000,000');
  expectErr((c) => { c.traffic.amount.card.p95 = 1; }, 'traffic.amount.card.p95', 'must be above p50 and at most 50 times p50');
  expectErr((c) => { c.traffic.banks = c.traffic.banks.slice(0, 2); }, 'traffic.banks', 'must list Bank X, Bank Y and Bank Z');
  expectErr((c) => { c.traffic.banks[0].share = 101; }, 'traffic.banks[0].share', 'must be a number from 0 to 100');
  expectErr((c) => { c.traffic.banks.forEach((b) => { b.share = 0; }); }, 'traffic.banks', 'traffic.banks: at least one bank needs a share above 0');
  expectErr((c) => { c.traffic.banks[1].srFactor = 2; }, 'traffic.banks[1].srFactor', 'must be a number from 0 to 1');
  expectErr((c) => { c.gateways = c.gateways.slice(0, 1); }, 'gateways', 'must be 2 to 5 gateways named A, B, C, D, E in order');
  expectErr((c) => { c.gateways[0].activeFrom = 1440; }, 'gateways[0].activeFrom', 'must be a whole minute from 0 to 1439');
  expectErr((c) => { c.gateways[0].capacityTpm = 0; }, 'gateways[0].capacityTpm', 'must be empty or a whole number from 1 to 100,000');
  expectErr((c) => { c.gateways[0].methods.card = 5; }, 'gateways[0].methods.card', 'must be null (not supported) or a method object');
  expectErr((c) => { c.gateways[0].methods.card.sr = 1.5; }, 'gateways[0].methods.card.sr', 'must be a number from 0 to 1');
  expectErr((c) => { c.gateways[0].methods.card.p50 = 50; }, 'gateways[0].methods.card.p50', 'must be from 100 ms to 600,000 ms');
  expectErr((c) => { c.gateways[0].methods.card.p95 = 4000; }, 'gateways[0].methods.card.p95', 'must be above p50, at most 50 times p50 and at most 600,000 ms');
  expectErr((c) => { c.gateways[0].methods.card.fixedFee = 1001; }, 'gateways[0].methods.card.fixedFee', 'must be a number from 0 to 1,000');
  expectErr((c) => { c.gateways[0].methods.card.pctFee = 11; }, 'gateways[0].methods.card.pctFee', 'must be a number from 0 to 10');
  expectErr((c) => { c.gateways.forEach((g) => { g.methods.card = null; }); }, 'gateways', 'gateways: no gateway available at 00:00 supports Card');
  expectErr((c) => { c.events = new Array(21).fill(c.events[0]); }, 'events', 'must have at most 20 events');
  expectErr((c) => { c.events[0].id = 'Q'; }, 'events[0].target', 'must name an existing gateway or bank');
  expectErr((c) => { c.events[0].methods = ['card', 'card']; }, 'events[0].methods', 'must be a list of payment methods');
  expectErr((c) => { c.events[0].start = 1440; }, 'events[0].start', 'must be a whole minute from 0 to 1439');
  expectErr((c) => { c.events[0].duration = 0; }, 'events[0].duration', 'must be from 1 to 1,440 minutes');
  expectErr((c) => { c.events[0].srFactor = 2; }, 'events[0].srFactor', 'must be a number from 0 to 1');
  expectErr((c) => { c.events[0].latencyFactor = 11; }, 'events[0].latencyFactor', 'must be from 1 to 10');
  expectErr((c) => { c.events[0].target = 'bank'; c.events[0].id = 'X'; c.events[0].latencyFactor = 2; }, 'events[0].latencyFactor', 'must be 1 for a bank event');
  expectErr((c) => { c.events[0].recovery = 241; }, 'events[0].recovery', 'must be from 0 to 240 minutes');
  expectErr((c) => { c.events[0].repeatEvery = 10; }, 'events[0].repeatEvery', 'must be 0 or at least duration + recovery (and at most 1,440)');
  expectErr((c) => { c.events[0].repeatCount = 3; }, 'events[0].repeatCount', 'must be from 1 to 48 (1 when the event does not repeat)');
  expectErr((c) => { c.retry.maxRetries = 4; }, 'retry.maxRetries', 'must be 0, 1, 2 or 3');
  expectErr((c) => { c.retry.mode = 'x'; }, 'retry.mode', 'must be "other" or "same"');
  expectErr((c) => { c.retry.delaySec = 61; }, 'retry.delaySec', 'must be from 0 to 60 seconds');
  expectErr((c) => { c.dropoff.base = 2; }, 'dropoff.base', 'must be from 0 to 1');
  expectErr((c) => { c.dropoff.base = 0.5; c.dropoff.max = 0.4; }, 'dropoff.base', 'dropoff.base must not exceed dropoff.max');
  expectErr((c) => { c.dropoff.perSec = 0.2; }, 'dropoff.perSec', 'must be from 0 to 0.1');
  expectErr((c) => { for (const k of C.STRATEGY_IDS) c.strategies[k].enabled = false; c.compare.baseline = 'static'; }, 'strategies', 'strategies: switch on at least one strategy');
  expectErr((c) => { c.strategies.static.priority = ['A', 'A', 'B']; }, 'strategies.static.priority', 'must list every gateway exactly once');
  expectErr((c) => { c.strategies.weighted.weights.A = 101; }, 'strategies.weighted.weights.A', 'must be from 0 to 100');
  expectErr((c) => { c.strategies.weighted.weights = { A: 0, B: 0, C: 0 }; }, 'strategies.weighted', 'strategies.weighted: at least one weight above 0');
  expectErr((c) => { c.strategies.rules.rules[0].method = 'x'; }, 'strategies.rules.rules[0].method', 'must be a payment method or "any"');
  expectErr((c) => { c.strategies.rules.rules[0].minAmount = -1; }, 'strategies.rules.rules[0].minAmount', 'must be a number from 0 to 1,000,000');
  expectErr((c) => { c.strategies.rules.rules[0].maxAmount = 0; }, 'strategies.rules.rules[0].maxAmount', 'must be empty or above minAmount (at most 1,000,000)');
  expectErr((c) => { c.strategies.rules.rules[0].gateway = 'Z'; }, 'strategies.rules.rules[0].gateway', 'must name an existing gateway');
  expectErr((c) => { c.strategies.egreedy.epsilon = 2; }, 'strategies.egreedy.epsilon', 'must be from 0 to 1');
  expectErr((c) => { c.strategies.thompson.memory.kind = 'x'; }, 'strategies.thompson.memory.kind', 'must be none, window or discount');
  expectErr((c) => { c.strategies.thompson.memory.minutes = 0; }, 'strategies.thompson.memory.minutes', 'must be from 1 to 1,440 minutes');
  expectErr((c) => { c.strategies.thompson_cost.lambda = 2; }, 'strategies.thompson_cost.lambda', 'must be from 0 to 1');
  expectErr((c) => { c.strategies.static.enabled = false; }, 'compare.baseline', 'must be a strategy that is switched on');
  expectErr((c) => { c.focus = { start: 7, end: 60 }; }, 'focus', 'must be empty or a 15-minute-aligned window inside the day');
});

test('strings for numbers are rejected; unknown keys dropped', () => {
  expectErr((c) => { c.gateways[0].methods.card.sr = '0.97'; }, 'gateways[0].methods.card.sr', 'must be a number from 0 to 1');
  const c = preset();
  c.extra = 1;
  c.run.other = 2;
  const v = C.validateConfig(c);
  assert.ok(v.ok);
  assert.equal(v.config.extra, undefined);
  assert.equal(v.config.run.other, undefined);
});

test('prototype keys are not copied and Object.prototype is untouched', () => {
  const c = JSON.parse(JSON.stringify(preset()).replace('"v":1', '"v":1,"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":1}'));
  const v = C.validateConfig(c);
  assert.ok(v.ok);
  assert.equal(Object.prototype.hasOwnProperty.call(v.config, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(v.config, 'prototype'), false);
  assert.equal(({}).polluted, undefined);
  assert.equal(v.config.polluted, undefined);
});

test('normalised key order and hash do not depend on input key order', () => {
  const c = preset('steady');
  const rev = (o) => {
    if (Array.isArray(o)) return o.map(rev);
    if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o).reverse()) r[k] = rev(o[k]); return r; }
    return o;
  };
  const v = C.validateConfig(rev(c));
  assert.ok(v.ok);
  assert.deepEqual(Object.keys(v.config), ['v', 'run', 'traffic', 'gateways', 'events', 'retry', 'dropoff', 'strategies', 'compare', 'focus']);
  assert.equal(C.canonicalJson(v.config), C.canonicalJson(c));
  assert.equal(C.configHash(v.config), C.configHash(c));
  assert.match(C.configHash(c), /^[0-9a-f]{8}$/);
  const c2 = preset('steady'); c2.run.seeds = 3;
  assert.equal(C.configHash(c2), C.configHash(c), 'hash ignores run');
});

test('codec helpers and every-preset round trip', () => {
  const k = C.codec;
  assert.equal(k.toPercent(0.07), 7);
  assert.equal(k.fromPercent(7), 0.07);
  assert.equal(k.toSeconds(2500), 2.5);
  assert.equal(k.fromSeconds(2.5), 2500);
  assert.equal(k.fromHHMM('24:00', true), 1440);
  assert.equal(k.fromHHMM('24:00', false), null);
  assert.equal(k.fromHHMM('9:00', true), null);
  assert.equal(k.fromHHMM('25:00', true), null);
  assert.equal(k.toHHMM(1440), '24:00');
  assert.equal(k.toHHMM(570), '09:30');
  for (const id of ids) {
    const c = preset(id);
    const d = JSON.parse(JSON.stringify(c));
    for (const g of d.gateways) for (const m of C.METHODS) {
      const mm = g.methods[m];
      if (!mm) continue;
      mm.sr = k.fromPercent(k.toPercent(mm.sr));
      mm.p50 = k.fromSeconds(k.toSeconds(mm.p50));
      mm.p95 = k.fromSeconds(k.toSeconds(mm.p95));
    }
    for (const m of C.METHODS) d.traffic.customerDecline[m] = k.fromPercent(k.toPercent(d.traffic.customerDecline[m]));
    for (const b of d.traffic.banks) b.srFactor = k.fromPercent(k.toPercent(b.srFactor));
    for (const e of d.events) e.srFactor = k.fromPercent(k.toPercent(e.srFactor));
    for (const key of ['base', 'perSec', 'max']) d.dropoff[key] = k.fromPercent(k.toPercent(d.dropoff[key]));
    d.strategies.egreedy.epsilon = k.fromPercent(k.toPercent(d.strategies.egreedy.epsilon));
    assert.equal(C.canonicalJson(d), C.canonicalJson(c), id);
  }
});

test('displayMessage translations', () => {
  const d = C.codec.displayMessage;
  assert.equal(d('gateways[0].methods.card.sr', 'must be a number from 0 to 1'), 'must be a number from 0 to 100');
  assert.equal(d('traffic.banks[0].srFactor', 'must be a number from 0 to 1'), 'must be a number from 0 to 100');
  assert.equal(d('events[0].srFactor', 'must be a number from 0 to 1'), 'must be a number from 0 to 100');
  assert.equal(d('dropoff.max', 'must be from 0 to 1'), 'must be from 0 to 100');
  assert.equal(d('strategies.egreedy.epsilon', 'must be from 0 to 1'), 'must be from 0 to 100');
  assert.equal(d('traffic.customerDecline.card', 'must be a number from 0 to 0.9'), 'must be a number from 0 to 90');
  assert.equal(d('dropoff.perSec', 'must be from 0 to 0.1'), 'must be from 0 to 10');
  assert.equal(d('dropoff.base', 'dropoff.base must not exceed dropoff.max'), 'Drop-off at the start must not exceed the maximum drop-off.');
  assert.equal(d('gateways[1].methods.card.p50', 'must be from 100 ms to 600,000 ms'), 'must be from 0.1 s to 600 s');
  assert.equal(d('gateways[1].methods.card.p95', 'must be above p50, at most 50 times p50 and at most 600,000 ms'), 'must be above p50, at most 50 times p50 and at most 600 s');
  assert.equal(d('traffic.mix.card', 'must be a number from 0 to 100'), 'must be a number from 0 to 100');
});

test('isRenderable: true cases', () => {
  for (const id of ids) assert.equal(C.isRenderable(preset(id)), true, id);
  const a = preset(); a.gateways[0].methods.card.sr = 1.5;
  assert.equal(C.isRenderable(a), true);
  const b = preset(); b.gateways[0].methods.card.sr = '0.97';
  assert.equal(C.isRenderable(b), true);
});

test('isRenderable: false cases (including finding 31)', () => {
  const f = (mut) => { const c = preset(); mut(c); return C.isRenderable(c); };
  assert.equal(C.isRenderable(null), false);
  assert.equal(C.isRenderable('x'), false);
  assert.equal(C.isRenderable([]), false);
  assert.equal(f((c) => { delete c.traffic; }), false);
  assert.equal(f((c) => { c.gateways = 'abc'; }), false);
  assert.equal(f((c) => { c.gateways = c.gateways.slice(0, 1); }), false);
  assert.equal(f((c) => { while (c.gateways.length < 6) c.gateways.push(JSON.parse(JSON.stringify(c.gateways[0]))); }), false);
  assert.equal(f((c) => { delete c.gateways[0].methods.card; }), false);
  assert.equal(f((c) => { c.gateways[0].methods.card = '0.97'; }), false);
  assert.equal(f((c) => { c.traffic.hourly = c.traffic.hourly.slice(0, 23); }), false);
  assert.equal(f((c) => { c.traffic.hourly = c.traffic.hourly.concat([1, 1, 1, 1, 1, 1]); }), false);
  assert.equal(f((c) => { c.traffic.banks = c.traffic.banks.slice(0, 2); }), false);
  assert.equal(f((c) => { c.strategies.static.priority = ['A', 'B']; }), false);
  assert.equal(f((c) => { c.events = new Array(21).fill(c.events[0]); }), false);
  assert.equal(f((c) => { c.strategies.rules.rules = new Array(21).fill(c.strategies.rules.rules[0]); }), false);
  assert.equal(f((c) => { c.gateways[1].id = 'A'; }), false);
  assert.equal(f((c) => { c.gateways[1].id = 'C'; }), false);
  assert.equal(f((c) => { c.gateways[0].id = 5; }), false);
  assert.equal(f((c) => { c.traffic.banks = [c.traffic.banks[1], c.traffic.banks[0], c.traffic.banks[2]]; }), false);
  assert.equal(f((c) => { c.strategies.thompson.memory = 3; }), false);
});

test('isRenderable and validateConfig never throw on 1,000 seeded random JSON values', () => {
  const rng = P.stream(99, 'random-json');
  function gen(d) {
    const r = rng();
    if (d > 3 || r < 0.3) return [null, true, 0, 1.5, 'x', '', -1, 1e9][Math.floor(rng() * 8)];
    if (r < 0.6) { const a = []; const n = Math.floor(rng() * 4); for (let i = 0; i < n; i++) a.push(gen(d + 1)); return a; }
    const o = {}; const keys = ['v', 'run', 'traffic', 'gateways', 'events', 'id', 'methods', 'strategies', 'focus', 'compare'];
    const n = Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) o[keys[Math.floor(rng() * keys.length)]] = gen(d + 1);
    return o;
  }
  for (let i = 0; i < 1000; i++) {
    const x = gen(0);
    assert.doesNotThrow(() => { C.isRenderable(x); C.validateConfig(x); });
  }
  // and mutated presets
  for (let i = 0; i < 200; i++) {
    const c = preset(ids[i % ids.length]);
    const path = ['run', 'traffic', 'gateways', 'events', 'retry', 'dropoff', 'strategies', 'compare', 'focus'][Math.floor(rng() * 9)];
    c[path] = gen(1);
    assert.doesNotThrow(() => { C.isRenderable(c); C.validateConfig(c); });
  }
});
