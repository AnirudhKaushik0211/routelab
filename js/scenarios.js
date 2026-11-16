(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { config: require('./config.js') } : { config: root.RouteLab.config };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.scenarios = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var config = deps.config;

  var RESULTS_SEEDS = { seedStart: 101, seeds: 30 };
  var ROBUST_SEEDS = { seedStart: 1, seeds: 20 };
  var PILOT_SEEDS = { seedStart: 501, seeds: 20 };

  function gateway(id, sr, fixed, pct, nb) {
    function mm(srv, p50, p95, ff, pf) { return { sr: srv, p50: p50, p95: p95, fixedFee: ff, pctFee: pf }; }
    return { id: id, activeFrom: 0, capacityTpm: null, methods: {
      upi_intent: mm(sr[0], 2500, 9000, fixed, 0),
      upi_collect: mm(sr[1], 20000, 90000, fixed, 0),
      card: mm(sr[2], 4000, 15000, 0, pct),
      netbanking: mm(sr[3], 15000, 60000, nb, 0) } };
  }

  function ev(o) {
    var d = { target: 'gateway', id: 'A', methods: [], start: 0, duration: 1, srFactor: 0, latencyFactor: 1,
      recovery: 0, repeatEvery: 0, repeatCount: 1 };
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) d[keys[i]] = o[keys[i]];
    return d;
  }

  function base() {
    return {
      v: 1,
      run: { seeds: 20, seedStart: 1, txnPerDay: 10000 },
      traffic: {
        hourly: [0.25, 0.15, 0.1, 0.1, 0.1, 0.15, 0.3, 0.55, 0.8, 1, 1.1, 1.15, 1.25, 1.2, 1.1, 1.05, 1.05, 1.15, 1.4, 1.8, 2, 1.9, 1.4, 0.7],
        mix: { upi_intent: 55, upi_collect: 10, card: 25, netbanking: 10 },
        customerDecline: { upi_intent: 0.05, upi_collect: 0.18, card: 0.07, netbanking: 0.1 },
        amount: { upi_intent: { p50: 300, p95: 3000 }, upi_collect: { p50: 500, p95: 5000 },
          card: { p50: 1500, p95: 10000 }, netbanking: { p50: 2000, p95: 15000 } },
        banks: [{ id: 'X', share: 40, srFactor: 1 }, { id: 'Y', share: 35, srFactor: 1 }, { id: 'Z', share: 25, srFactor: 1 }]
      },
      gateways: [gateway('A', [0.97, 0.93, 0.96, 0.94], 0.5, 1.7, 8), gateway('B', [0.94, 0.9, 0.93, 0.91], 0.75, 1.9, 10),
        gateway('C', [0.92, 0.87, 0.92, 0.9], 1, 2, 12)],
      events: [],
      retry: { maxRetries: 2, mode: 'other', delaySec: 3 },
      dropoff: { base: 0.15, perSec: 0.003, max: 0.9 },
      strategies: {
        static: { enabled: true, priority: ['A', 'B', 'C'] },
        weighted: { enabled: true, weights: { A: 50, B: 30, C: 20 } },
        rules: { enabled: true, rules: [
          { method: 'upi_intent', minAmount: 0, maxAmount: null, gateway: 'A' },
          { method: 'upi_collect', minAmount: 0, maxAmount: null, gateway: 'B' },
          { method: 'card', minAmount: 5000, maxAmount: null, gateway: 'C' },
          { method: 'card', minAmount: 0, maxAmount: null, gateway: 'A' },
          { method: 'netbanking', minAmount: 0, maxAmount: null, gateway: 'A' }] },
        egreedy: { enabled: true, epsilon: 0.1, memory: { kind: 'window', minutes: 30 } },
        thompson: { enabled: true, memory: { kind: 'discount', minutes: 20 } },
        thompson_cost: { enabled: true, lambda: 0.01, memory: { kind: 'discount', minutes: 20 } }
      },
      compare: { baseline: 'static' },
      focus: null
    };
  }

  var BUILDERS = {
    'steady': function (c) { c.focus = { start: 1080, end: 1440 }; },
    'peak-outage': function (c) {
      c.events = [ev({ start: 1170, duration: 45, srFactor: 0.1, recovery: 15 })];
      c.focus = { start: 1170, end: 1230 };
    },
    'collect-degradation': function (c) {
      c.events = [ev({ methods: ['upi_collect'], start: 600, duration: 360, srFactor: 0.5, latencyFactor: 2, recovery: 30 })];
      c.focus = { start: 600, end: 990 };
    },
    'cost-vs-sr': function (c) {
      var a = c.gateways[0];
      var b = c.gateways[1];
      a.methods.upi_intent.fixedFee = 1.5; a.methods.upi_collect.fixedFee = 1.5; a.methods.card.pctFee = 2.1; a.methods.netbanking.fixedFee = 15;
      b.methods.upi_intent.sr = 0.91; b.methods.upi_collect.sr = 0.85; b.methods.card.sr = 0.88; b.methods.netbanking.sr = 0.86;
      b.methods.upi_intent.fixedFee = 0.25; b.methods.upi_collect.fixedFee = 0.25; b.methods.card.pctFee = 1.4; b.methods.netbanking.fixedFee = 6;
      c.gateways = [a, b];
      c.strategies.static.priority = ['B', 'A'];
      c.strategies.weighted.weights = { A: 50, B: 50 };
      c.strategies.rules.rules = [
        { method: 'card', minAmount: 2000, maxAmount: null, gateway: 'B' },
        { method: 'netbanking', minAmount: 0, maxAmount: null, gateway: 'B' },
        { method: 'any', minAmount: 0, maxAmount: null, gateway: 'A' }];
      c.focus = null;
    },
    'cold-start': function (c) {
      var d = JSON.parse(JSON.stringify(c.gateways[1]));
      d.id = 'D'; d.activeFrom = 720;
      d.methods.upi_intent.sr = 0.99; d.methods.upi_collect.sr = 0.95; d.methods.card.sr = 0.98; d.methods.netbanking.sr = 0.96;
      c.gateways.push(d);
      c.strategies.static.priority = ['A', 'B', 'C', 'D'];
      c.strategies.weighted.weights = { A: 50, B: 30, C: 20, D: 0 };
      c.focus = { start: 840, end: 1440 };
    },
    'flapping': function (c) {
      c.events = [ev({ start: 540, duration: 10, srFactor: 0.2, repeatEvery: 30, repeatCount: 24 })];
      c.focus = { start: 540, end: 1260 };
    },
    'issuer-outage': function (c) {
      c.events = [ev({ target: 'bank', id: 'X', start: 1200, duration: 60, srFactor: 0.2 })];
      c.focus = { start: 1200, end: 1260 };
    }
  };

  var TEXTS = {
    'steady': ['Steady state', 'none',
      'Nothing goes wrong all day, and Gateway A is both the most reliable and the cheapest. Static priority on A is already what the oracle would do, so it matches the oracle exactly. Thompson sampling keeps exploring the other gateways, so it pays a measurable price in first-attempt success, cost per success and regret; at the order level, after retries, the gap stays within one percentage point. A 50/30/20 split costs more and succeeds less often on the first attempt.'],
    'peak-outage': ['Evening-peak outage on the best gateway',
      'event: gateway A, all methods, start 1170 (19:30), duration 45, srFactor 0.10, latencyFactor 1, recovery 15',
      'Gateway A, the best one, almost stops working for 45 minutes in the evening peak and recovers over 15 minutes. Static priority keeps sending every first attempt to A, so customers depend on retries. Within 15 minutes of the start, Thompson sampling sends almost no first attempts to A. Thompson sampling and epsilon-greedy both keep the order success rate far higher than static during the outage hour; Thompson sampling\'s lead also lifts its whole-day order success rate above static\'s, and static\'s regret is much higher than Thompson sampling\'s.'],
    'collect-degradation': ['UPI collect degradation',
      'event: gateway A, methods [\'upi_collect\'], start 600 (10:00), duration 360, srFactor 0.5, latencyFactor 2, recovery 30',
      'Gateway A\'s UPI collect flow degrades to half its normal success rate for six hours and slows down; its other methods are fine. Thompson sampling keeps separate estimates per payment method, so during the degradation its UPI collect order success rate is at least 5 points above static\'s, while its UPI intent order success rate stays within one point of static\'s. The rule-based router, which already sends collect to B, is at least 5 points above static on collect too.'],
    'cost-vs-sr': ['Cheap-but-flaky vs expensive-but-reliable',
      'gateways A and B only. A: SR as base; fees UPI Rs 1.50, card 2.10%, netbanking Rs 15. B: SR intent 0.91, collect 0.85, card 0.88, netbanking 0.86; fees UPI Rs 0.25, card 1.40%, netbanking Rs 6. static.priority [\'B\',\'A\'] (cheapest first); weighted {A: 50, B: 50}; rules: card, minAmount 2000 -> B; netbanking -> B; any -> A',
      'Two gateways: A is reliable but expensive, B is cheap but fails more. Of the three strategies compared here, static \'cheapest first\' has the lowest cost and the lowest success rate, the success-rate-only Thompson router has the highest success rate and the highest cost, and the cost-aware Thompson router sits in between on both.'],
    'cold-start': ['New gateway joins at noon',
      'add gateway D: activeFrom 720, SR intent 0.99, collect 0.95, card 0.98, netbanking 0.96, fees and latency as B; static.priority [\'A\',\'B\',\'C\',\'D\']; weighted {A: 50, B: 30, C: 20, D: 0}; rules unchanged',
      'A new, better Gateway D goes live at noon. The configured strategies do not know about it until someone edits them: from 14:00, static priority sends it no first attempts, while the oracle uses it for every first attempt. Thompson sampling discovers it and sends it at least half of the first attempts from 14:00; epsilon-greedy with a 30-minute window sends it clearly less. Nobody can use D before noon.'],
    'flapping': ['Flapping gateway',
      'event: gateway A, all methods, start 540 (09:00), duration 10, srFactor 0.2, latencyFactor 1, recovery 0, repeatEvery 30, repeatCount 24 (last flap 20:30-20:40)',
      'Gateway A fails for 10 minutes every half hour from 09:00 to 21:00. Both learning routers beat static priority clearly during those hours, and static\'s regret is far higher. The learning routers are not free either: both Thompson sampling and epsilon-greedy keep a clearly positive regret of their own, because each flap has to be detected and each recovery rediscovered.'],
    'issuer-outage': ['Issuer bank outage (not routable)',
      'event: bank X, all methods, start 1200 (20:00), duration 60, srFactor 0.20, latencyFactor 1, recovery 0',
      'Bank X, which issues 40% of customers\' cards and accounts, has a one-hour outage at 20:00. Every gateway is equally affected, so routing cannot help: static priority and Thompson sampling both lose more than 10 points of order success during the hour compared with the two hours before, static priority still equals the oracle, and Thompson sampling does no better than static.']
  };
  var ORDER = ['steady', 'peak-outage', 'collect-degradation', 'cost-vs-sr', 'cold-start', 'flapping', 'issuer-outage'];

  function row(id, metric, scope, a, b, op, threshold, extra) {
    var r = { id: id, metric: metric, scope: scope, a: a, op: op };
    if (b) r.b = b;
    if (threshold !== undefined) r.threshold = threshold;
    if (extra) { var ks = Object.keys(extra); for (var i = 0; i < ks.length; i++) r[ks[i]] = extra[ks[i]]; }
    return r;
  }

  var EXPECT = {
    'steady': [
      row('ST1', 'all', 'day', 'static', 'oracle', 'exactlyEqual'),
      row('ST2', 'orderSr', 'day', 'static', 'thompson', 'diffWithin', -0.001, { threshold2: 0.01 }),
      row('ST3', 'costPerSuccess', 'day', 'thompson', 'static', 'diffAtLeastCi', 0),
      row('ST4', 'costPerSuccess', 'day', 'weighted', 'static', 'relDiffAtLeast', 0.02),
      row('ST5', 'firstSr', 'day', 'static', 'weighted', 'diffAtLeastCi', 0.008),
      row('ST6', 'share:A', 'focus', 'thompson', null, 'atLeast', 0.55),
      row('ST7', 'regretPer1000', 'day', 'thompson', null, 'atLeast', 5),
      row('ST8', 'firstSr', 'day', 'static', 'thompson', 'diffAtLeastCi', 0.003)],
    'peak-outage': [
      row('PO1', 'orderSr', 'focus', 'thompson', 'static', 'diffAtLeastCi', 0.05),
      row('PO2', 'orderSr', 'focus', 'egreedy', 'static', 'diffAtLeastCi', 0.05),
      row('PO3', 'orderSr', 'day', 'thompson', 'static', 'diffAtLeastCi', 0.003),
      row('PO4', 'regretPer1000', 'day', 'static', 'thompson', 'diffAtLeastCi', 20),
      row('PO5', 'share:A', [1185, 1215], 'thompson', null, 'atMost', 0.1),
      row('PO6', 'share:A', [1170, 1215], 'static', null, 'exactlyValue', 1)],
    'collect-degradation': [
      row('CD1', 'orderSr', 'focus', 'thompson', 'static', 'diffAtLeastCi', 0.05, { method: 'upi_collect' }),
      row('CD2', 'orderSr', 'focus', 'rules', 'static', 'diffAtLeastCi', 0.05, { method: 'upi_collect' }),
      row('CD3', 'orderSr', 'focus', 'thompson', 'static', 'diffWithin', -0.01, { method: 'upi_intent', threshold2: 0.01 })],
    'cost-vs-sr': [
      row('CS1', 'firstSr', 'day', 'thompson', 'thompson_cost', 'diffAtLeastCi', 0.006),
      row('CS2', 'orderSr', 'day', 'thompson', 'thompson_cost', 'diffAtLeastCi', 0),
      row('CS3', 'firstSr', 'day', 'thompson_cost', 'static', 'diffAtLeastCi', 0.015),
      row('CS4', 'costPerSuccess', 'day', 'thompson', 'thompson_cost', 'relDiffAtLeast', 0.1),
      row('CS5', 'costPerSuccess', 'day', 'thompson_cost', 'static', 'diffAtLeastCi', 0),
      row('CS6', 'orderSr', 'day', 'thompson_cost', 'static', 'diffAtLeastCi', 0.002)],
    'cold-start': [
      row('CO1', 'share:D', 'focus', 'thompson', null, 'atLeast', 0.5),
      row('CO2', 'firstSr', 'focus', 'thompson', 'static', 'diffAtLeastCi', 0.003),
      row('CO3', 'share:D', [0, 720], '*', null, 'exactlyValue', 0),
      row('CO4', 'share:D', 'focus', 'static', null, 'exactlyValue', 0),
      row('CO5', 'share:D', 'focus', 'oracle', null, 'exactlyValue', 1),
      row('CO6', 'share:D', 'focus', 'thompson', 'egreedy', 'diffAtLeastCi', 0.08)],
    'flapping': [
      row('FL1', 'orderSr', 'focus', 'thompson', 'static', 'diffAtLeastCi', 0.015),
      row('FL2', 'orderSr', 'focus', 'egreedy', 'static', 'diffAtLeastCi', 0.015),
      row('FL3', 'regretPer1000', 'day', 'static', 'thompson', 'diffAtLeastCi', 50),
      row('FL4', 'regretPer1000', 'day', 'thompson', null, 'atLeast', 15),
      row('FL5', 'regretPer1000', 'day', 'egreedy', null, 'atLeast', 15)],
    'issuer-outage': [
      row('IO1', 'all', 'day', 'static', 'oracle', 'exactlyEqual'),
      row('IO2', 'orderSr', 'focus', 'thompson', 'static', 'diffWithin', -0.02, { threshold2: 0.005 }),
      row('IO3', 'orderSr', 'focus', 'static', null, 'windowDropAtLeast', 0.1, { before: [1080, 1200] }),
      row('IO4', 'orderSr', 'focus', 'thompson', null, 'windowDropAtLeast', 0.1, { before: [1080, 1200] })]
  };

  function hl(metric, scope, a, b, method) {
    var r = { metric: metric, scope: scope, a: a };
    if (b) r.b = b;
    if (method) r.method = method;
    return r;
  }
  var HEADLINES = {
    'steady': [hl('orderSr', 'day', 'static', 'thompson'), hl('firstSr', 'day', 'static', 'thompson')],
    'peak-outage': [hl('orderSr', 'focus', 'thompson', 'static')],
    'collect-degradation': [hl('orderSr', 'focus', 'thompson', 'static', 'upi_collect')],
    'cost-vs-sr': [hl('orderSr', 'day', 'thompson', 'thompson_cost'), hl('costPerSuccess', 'day', 'thompson', 'thompson_cost')],
    'cold-start': [hl('share:D', 'focus', 'thompson')],
    'flapping': [hl('orderSr', 'focus', 'thompson', 'static')],
    'issuer-outage': [hl('orderSr', 'focus', 'thompson', 'static')]
  };

  var scenarios = [];
  var byId = {};
  ORDER.forEach(function (id) {
    var t = TEXTS[id];
    var text = t[2];
    var story = text.slice(0, text.indexOf('. ') + 1);
    var focusCfg = null;
    var tmp = base();
    BUILDERS[id](tmp);
    focusCfg = tmp.focus ? { start: tmp.focus.start, end: tmp.focus.end } : null;
    var s = { id: id, title: t[0], story: story, changes: t[1], expectationText: text, focus: focusCfg,
      expectations: EXPECT[id], headlines: HEADLINES[id] };
    scenarios.push(s);
    byId[id] = s;
  });

  function getScenario(id) {
    if (!Object.prototype.hasOwnProperty.call(byId, id)) throw new RangeError('unknown scenario: ' + id);
    var c = base();
    BUILDERS[id](c);
    var v = config.validateConfig(c);
    if (!v.ok) throw new Error('preset ' + id + ' is invalid: ' + v.errors[0].path + ': ' + v.errors[0].message);
    return v.config;
  }

  function publicList() {
    return scenarios.map(function (s) {
      return { id: s.id, title: s.title, story: s.story, changes: s.changes, expectationText: s.expectationText,
        focus: s.focus ? { start: s.focus.start, end: s.focus.end } : null };
    });
  }

  return { scenarios: scenarios, list: publicList, byId: byId, ids: ORDER.slice(), getScenario: getScenario,
    RESULTS_SEEDS: RESULTS_SEEDS, ROBUST_SEEDS: ROBUST_SEEDS, PILOT_SEEDS: PILOT_SEEDS };
});
