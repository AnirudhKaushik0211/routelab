(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { prng: require('./prng.js') } : { prng: root.RouteLab.prng };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.config = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  var METHODS = ['upi_intent', 'upi_collect', 'card', 'netbanking'];
  var METHOD_LABELS = { upi_intent: 'UPI intent', upi_collect: 'UPI collect', card: 'Card', netbanking: 'Netbanking' };
  var GATEWAY_IDS = ['A', 'B', 'C', 'D', 'E'];
  var BANK_IDS = ['X', 'Y', 'Z'];
  var STRATEGY_IDS = ['static', 'weighted', 'rules', 'egreedy', 'thompson', 'thompson_cost'];
  var POLICY_IDS = STRATEGY_IDS.concat(['oracle']);
  var POLICY_LABELS = { static: 'Static priority', weighted: 'Weighted split', rules: 'Rule-based',
    egreedy: 'Epsilon-greedy', thompson: 'Thompson sampling', thompson_cost: 'Cost-aware Thompson',
    oracle: 'Oracle (reference)' };
  var REASONS = ['success', 'customer', 'technical', 'rate_limited', 'no_route', 'dropped'];
  var REASON_LABELS = { success: 'Paid', customer: 'Customer-side decline', technical: 'Technical decline',
    rate_limited: 'Rate limited', no_route: 'No gateway left', dropped: 'Gave up before retry' };
  var MAX_ATTEMPTS = 4;
  var BUCKET_MINUTES = 15;
  var BUCKETS = 96;
  var DAY_MINUTES = 1440;
  var Z95 = 1.6448536269514722;
  var MAX_HASH_LENGTH = 64000;
  var LEARNING = ['egreedy', 'thompson', 'thompson_cost'];

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }
  function inRange(v, lo, hi) { return isNum(v) && v >= lo && v <= hi; }
  function get(o, k) { return isPlain(o) && own(o, k) ? o[k] : undefined; }
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // ------------------------------------------------------------------ validation and normalisation
  function validateConfig(input) {
    var errors = [];
    function err(path, message) { errors.push({ path: path, message: message }); }
    if (!isPlain(input) || input.v !== 1) {
      return { ok: false, config: null, errors: [{ path: '(root)', message: 'must be a RouteLab configuration object (v: 1)' }] };
    }
    var out = { v: 1 };
    var i, j, m, k;

    // run
    var run = get(input, 'run');
    out.run = {};
    if (!isPlain(run)) { err('run', 'must be an object'); run = {}; }
    var seeds = get(run, 'seeds');
    if (!(isInt(seeds) && seeds >= 1 && seeds <= 100)) err('run.seeds', 'must be a whole number from 1 to 100');
    var maxStart = 4294967295 - (isInt(seeds) && seeds >= 1 && seeds <= 100 ? seeds : 1);
    var seedStart = get(run, 'seedStart');
    if (!(isInt(seedStart) && seedStart >= 0 && seedStart <= maxStart)) err('run.seedStart', 'must be a whole number from 0 to ' + maxStart);
    var tpd = get(run, 'txnPerDay');
    if (!(isInt(tpd) && tpd >= 100 && tpd <= 50000)) err('run.txnPerDay', 'must be a whole number from 100 to 50,000');
    out.run = { seeds: seeds, seedStart: seedStart, txnPerDay: tpd };

    // traffic
    var tr = get(input, 'traffic');
    if (!isPlain(tr)) { err('traffic', 'must be an object'); tr = {}; }
    out.traffic = {};
    var hourly = get(tr, 'hourly');
    var hok = Array.isArray(hourly) && hourly.length === 24;
    var hsum = 0;
    if (hok) for (i = 0; i < 24; i++) { if (!inRange(hourly[i], 0, 10)) hok = false; else hsum += hourly[i]; }
    if (!hok || !(hsum > 0)) err('traffic.hourly', 'must be 24 numbers from 0 to 10, not all 0');
    out.traffic.hourly = hok ? hourly.slice() : [];

    function methodMap(section, pathPrefix, lo, hi, msg, sumMsg) {
      var o = get(tr, section);
      var res = {};
      if (!isPlain(o)) { err(pathPrefix, 'must be an object'); o = {}; }
      var sum = 0;
      for (i = 0; i < METHODS.length; i++) {
        m = METHODS[i];
        var v = get(o, m);
        if (!inRange(v, lo, hi)) err(pathPrefix + '.' + m, msg); else sum += v;
        res[m] = v;
      }
      if (sumMsg && !(sum > 0)) err(pathPrefix, sumMsg);
      return res;
    }
    out.traffic.mix = methodMap('mix', 'traffic.mix', 0, 100, 'must be a number from 0 to 100',
      'traffic.mix: at least one method needs a share above 0');
    out.traffic.customerDecline = methodMap('customerDecline', 'traffic.customerDecline', 0, 0.9, 'must be a number from 0 to 0.9');

    var amt = get(tr, 'amount');
    if (!isPlain(amt)) { err('traffic.amount', 'must be an object'); amt = {}; }
    out.traffic.amount = {};
    for (i = 0; i < METHODS.length; i++) {
      m = METHODS[i];
      var am = get(amt, m);
      if (!isPlain(am)) { err('traffic.amount.' + m, 'must be an object'); am = {}; }
      var ap50 = get(am, 'p50');
      var ap95 = get(am, 'p95');
      var p50ok = inRange(ap50, 1, 1000000);
      if (!p50ok) err('traffic.amount.' + m + '.p50', 'must be a number from 1 to 1,000,000');
      if (!(isNum(ap95) && (!p50ok || (ap95 > ap50 && ap95 <= 50 * ap50)))) err('traffic.amount.' + m + '.p95', 'must be above p50 and at most 50 times p50');
      out.traffic.amount[m] = { p50: ap50, p95: ap95 };
    }

    var banks = get(tr, 'banks');
    out.traffic.banks = [];
    var banksOk = Array.isArray(banks) && banks.length === 3;
    if (banksOk) for (i = 0; i < 3; i++) if (!isPlain(banks[i]) || banks[i].id !== BANK_IDS[i]) banksOk = false;
    if (!banksOk) err('traffic.banks', 'must list Bank X, Bank Y and Bank Z');
    else {
      var bsum = 0;
      for (i = 0; i < 3; i++) {
        var bs = get(banks[i], 'share');
        var bf = get(banks[i], 'srFactor');
        if (!inRange(bs, 0, 100)) err('traffic.banks[' + i + '].share', 'must be a number from 0 to 100'); else bsum += bs;
        if (!inRange(bf, 0, 1)) err('traffic.banks[' + i + '].srFactor', 'must be a number from 0 to 1');
        out.traffic.banks.push({ id: BANK_IDS[i], share: bs, srFactor: bf });
      }
      if (!(bsum > 0)) err('traffic.banks', 'traffic.banks: at least one bank needs a share above 0');
    }

    // gateways
    var gws = get(input, 'gateways');
    var gwOk = Array.isArray(gws) && gws.length >= 2 && gws.length <= 5;
    if (gwOk) for (i = 0; i < gws.length; i++) if (!isPlain(gws[i]) || gws[i].id !== GATEWAY_IDS[i]) gwOk = false;
    out.gateways = [];
    var gwIds = [];
    if (!gwOk) err('gateways', 'must be 2 to 5 gateways named A, B, C, D, E in order');
    else {
      for (i = 0; i < gws.length; i++) {
        var g = gws[i];
        var gp = 'gateways[' + i + ']';
        gwIds.push(g.id);
        var af = get(g, 'activeFrom');
        if (!(isInt(af) && af >= 0 && af <= 1439)) err(gp + '.activeFrom', 'must be a whole minute from 0 to 1439');
        var cap = get(g, 'capacityTpm');
        if (!(cap === null || (isInt(cap) && cap >= 1 && cap <= 100000))) err(gp + '.capacityTpm', 'must be empty or a whole number from 1 to 100,000');
        var gm = get(g, 'methods');
        if (!isPlain(gm)) { err(gp + '.methods', 'must be an object'); gm = {}; }
        var mo = {};
        for (j = 0; j < METHODS.length; j++) {
          m = METHODS[j];
          var mp = gp + '.methods.' + m;
          var mv = get(gm, m);
          if (mv === null) { mo[m] = null; continue; }
          if (!isPlain(mv)) { err(mp, 'must be null (not supported) or a method object'); mo[m] = null; continue; }
          var sr = get(mv, 'sr');
          var p50 = get(mv, 'p50');
          var p95 = get(mv, 'p95');
          var ff = get(mv, 'fixedFee');
          var pf = get(mv, 'pctFee');
          if (!inRange(sr, 0, 1)) err(mp + '.sr', 'must be a number from 0 to 1');
          var lp50 = inRange(p50, 100, 600000);
          if (!lp50) err(mp + '.p50', 'must be from 100 ms to 600,000 ms');
          if (!(isNum(p95) && (!lp50 || (p95 > p50 && p95 <= Math.min(600000, 50 * p50))))) err(mp + '.p95', 'must be above p50, at most 50 times p50 and at most 600,000 ms');
          if (!inRange(ff, 0, 1000)) err(mp + '.fixedFee', 'must be a number from 0 to 1,000');
          if (!inRange(pf, 0, 10)) err(mp + '.pctFee', 'must be a number from 0 to 10');
          mo[m] = { sr: sr, p50: p50, p95: p95, fixedFee: ff, pctFee: pf };
        }
        out.gateways.push({ id: g.id, activeFrom: af, capacityTpm: cap, methods: mo });
      }
      // coverage
      var mixOk = isPlain(out.traffic.mix);
      for (j = 0; j < METHODS.length; j++) {
        m = METHODS[j];
        if (!mixOk || !(out.traffic.mix[m] > 0)) continue;
        var covered = false;
        for (i = 0; i < out.gateways.length; i++) if (out.gateways[i].activeFrom === 0 && out.gateways[i].methods[m]) covered = true;
        if (!covered) err('gateways', 'gateways: no gateway available at 00:00 supports ' + METHOD_LABELS[m]);
      }
    }

    // events
    var evs = get(input, 'events');
    out.events = [];
    if (!Array.isArray(evs) || evs.length > 20) err('events', 'must have at most 20 events');
    else {
      for (j = 0; j < evs.length; j++) {
        var e = evs[j];
        var ep = 'events[' + j + ']';
        if (!isPlain(e)) { err(ep, 'must be an event object'); continue; }
        var tg = get(e, 'target');
        var eid = get(e, 'id');
        var okT = (tg === 'gateway' && gwIds.indexOf(eid) >= 0) || (tg === 'bank' && BANK_IDS.indexOf(eid) >= 0);
        if (!okT) err(ep + '.target', 'must name an existing gateway or bank');
        var em = get(e, 'methods');
        var emOk = Array.isArray(em);
        if (emOk) for (i = 0; i < em.length; i++) if (METHODS.indexOf(em[i]) < 0 || em.indexOf(em[i]) !== i) emOk = false;
        if (!emOk) err(ep + '.methods', 'must be a list of payment methods');
        var es = get(e, 'start');
        var ed = get(e, 'duration');
        var esr = get(e, 'srFactor');
        var el = get(e, 'latencyFactor');
        var erc = get(e, 'recovery');
        var ere = get(e, 'repeatEvery');
        var erk = get(e, 'repeatCount');
        if (!(isInt(es) && es >= 0 && es <= 1439)) err(ep + '.start', 'must be a whole minute from 0 to 1439');
        if (!(isInt(ed) && ed >= 1 && ed <= 1440)) err(ep + '.duration', 'must be from 1 to 1,440 minutes');
        if (!inRange(esr, 0, 1)) err(ep + '.srFactor', 'must be a number from 0 to 1');
        if (!inRange(el, 1, 10)) err(ep + '.latencyFactor', 'must be from 1 to 10');
        else if (tg === 'bank' && el !== 1) err(ep + '.latencyFactor', 'must be 1 for a bank event');
        if (!(isInt(erc) && erc >= 0 && erc <= 240)) err(ep + '.recovery', 'must be from 0 to 240 minutes');
        var minEvery = (isInt(ed) ? ed : 0) + (isInt(erc) ? erc : 0);
        if (!(isInt(ere) && (ere === 0 || (ere >= minEvery && ere <= 1440)))) err(ep + '.repeatEvery', 'must be 0 or at least duration + recovery (and at most 1,440)');
        if (!(isInt(erk) && erk >= 1 && erk <= 48 && (ere !== 0 || erk === 1))) err(ep + '.repeatCount', 'must be from 1 to 48 (1 when the event does not repeat)');
        out.events.push({ target: tg, id: eid, methods: emOk ? em.slice() : [], start: es, duration: ed, srFactor: esr,
          latencyFactor: el, recovery: erc, repeatEvery: ere, repeatCount: erk });
      }
    }

    // retry, dropoff
    var rt = get(input, 'retry');
    if (!isPlain(rt)) { err('retry', 'must be an object'); rt = {}; }
    var mr = get(rt, 'maxRetries');
    var rmode = get(rt, 'mode');
    var rd = get(rt, 'delaySec');
    if (!(isInt(mr) && mr >= 0 && mr <= 3)) err('retry.maxRetries', 'must be 0, 1, 2 or 3');
    if (rmode !== 'other' && rmode !== 'same') err('retry.mode', 'must be "other" or "same"');
    if (!inRange(rd, 0, 60)) err('retry.delaySec', 'must be from 0 to 60 seconds');
    out.retry = { maxRetries: mr, mode: rmode, delaySec: rd };
    var dp = get(input, 'dropoff');
    if (!isPlain(dp)) { err('dropoff', 'must be an object'); dp = {}; }
    var db = get(dp, 'base');
    var dps = get(dp, 'perSec');
    var dm = get(dp, 'max');
    if (!inRange(db, 0, 1)) err('dropoff.base', 'must be from 0 to 1');
    if (!inRange(dps, 0, 0.1)) err('dropoff.perSec', 'must be from 0 to 0.1');
    if (!inRange(dm, 0, 1)) err('dropoff.max', 'must be from 0 to 1');
    if (inRange(db, 0, 1) && inRange(dm, 0, 1) && db > dm) err('dropoff.base', 'dropoff.base must not exceed dropoff.max');
    out.dropoff = { base: db, perSec: dps, max: dm };

    // strategies
    var st = get(input, 'strategies');
    if (!isPlain(st)) { err('strategies', 'must be an object'); st = {}; }
    out.strategies = {};
    var anyOn = false;
    var enabled = {};
    function sect(id) {
      var s = get(st, id);
      if (!isPlain(s)) { err('strategies.' + id, 'must be an object'); s = {}; }
      var en = get(s, 'enabled');
      if (typeof en !== 'boolean') err('strategies.' + id + '.enabled', 'must be true or false');
      enabled[id] = en === true;
      if (en === true) anyOn = true;
      return { s: s, en: en };
    }
    function memory(id, s) {
      var mm = get(s, 'memory');
      var p = 'strategies.' + id + '.memory';
      if (!isPlain(mm)) { err(p, 'must be an object'); mm = {}; }
      var kind = get(mm, 'kind');
      var mins = get(mm, 'minutes');
      if (kind !== 'none' && kind !== 'window' && kind !== 'discount') err(p + '.kind', 'must be none, window or discount');
      if (!(isInt(mins) && mins >= 1 && mins <= 1440)) err(p + '.minutes', 'must be from 1 to 1,440 minutes');
      return { kind: kind, minutes: mins };
    }
    var r = sect('static');
    var pri = get(r.s, 'priority');
    var priOk = Array.isArray(pri) && pri.length === gwIds.length && gwIds.length > 0;
    if (priOk) for (i = 0; i < pri.length; i++) if (gwIds.indexOf(pri[i]) < 0 || pri.indexOf(pri[i]) !== i) priOk = false;
    if (!priOk) err('strategies.static.priority', 'must list every gateway exactly once');
    out.strategies.static = { enabled: r.en, priority: Array.isArray(pri) ? pri.slice() : [] };

    r = sect('weighted');
    var wts = get(r.s, 'weights');
    if (!isPlain(wts)) { err('strategies.weighted.weights', 'must be an object'); wts = {}; }
    var wout = {};
    var wsum = 0;
    for (i = 0; i < gwIds.length; i++) {
      var wv = get(wts, gwIds[i]);
      if (!inRange(wv, 0, 100)) err('strategies.weighted.weights.' + gwIds[i], 'must be from 0 to 100'); else wsum += wv;
      wout[gwIds[i]] = wv;
    }
    if (r.en === true && gwIds.length && !(wsum > 0)) err('strategies.weighted', 'strategies.weighted: at least one weight above 0');
    out.strategies.weighted = { enabled: r.en, weights: wout };

    r = sect('rules');
    var rl = get(r.s, 'rules');
    var rout = [];
    if (!Array.isArray(rl) || rl.length > 20) err('strategies.rules.rules', 'must have at most 20 rules');
    else {
      for (k = 0; k < rl.length; k++) {
        var ru = rl[k];
        var rp = 'strategies.rules.rules[' + k + ']';
        if (!isPlain(ru)) { err(rp, 'must be a rule object'); continue; }
        var rmeth = get(ru, 'method');
        var rmin = get(ru, 'minAmount');
        var rmax = get(ru, 'maxAmount');
        var rg = get(ru, 'gateway');
        if (!(rmeth === 'any' || METHODS.indexOf(rmeth) >= 0)) err(rp + '.method', 'must be a payment method or "any"');
        var minOk = inRange(rmin, 0, 1000000);
        if (!minOk) err(rp + '.minAmount', 'must be a number from 0 to 1,000,000');
        if (!(rmax === null || (isNum(rmax) && rmax <= 1000000 && (!minOk || rmax > rmin)))) err(rp + '.maxAmount', 'must be empty or above minAmount (at most 1,000,000)');
        if (gwIds.indexOf(rg) < 0) err(rp + '.gateway', 'must name an existing gateway');
        rout.push({ method: rmeth, minAmount: rmin, maxAmount: rmax, gateway: rg });
      }
    }
    out.strategies.rules = { enabled: r.en, rules: rout };

    r = sect('egreedy');
    var eps = get(r.s, 'epsilon');
    if (!inRange(eps, 0, 1)) err('strategies.egreedy.epsilon', 'must be from 0 to 1');
    out.strategies.egreedy = { enabled: r.en, epsilon: eps, memory: memory('egreedy', r.s) };
    r = sect('thompson');
    out.strategies.thompson = { enabled: r.en, memory: memory('thompson', r.s) };
    r = sect('thompson_cost');
    var lam = get(r.s, 'lambda');
    if (!inRange(lam, 0, 1)) err('strategies.thompson_cost.lambda', 'must be from 0 to 1');
    out.strategies.thompson_cost = { enabled: r.en, lambda: lam, memory: memory('thompson_cost', r.s) };
    if (!anyOn) err('strategies', 'strategies: switch on at least one strategy');

    // compare, focus
    var cmp = get(input, 'compare');
    if (!isPlain(cmp)) { err('compare', 'must be an object'); cmp = {}; }
    var bl = get(cmp, 'baseline');
    if (!(STRATEGY_IDS.indexOf(bl) >= 0 && enabled[bl] === true)) err('compare.baseline', 'must be a strategy that is switched on');
    out.compare = { baseline: bl };
    var fo = get(input, 'focus');
    if (fo === null) out.focus = null;
    else {
      var fs = get(fo, 'start');
      var fe = get(fo, 'end');
      if (!(isPlain(fo) && isInt(fs) && isInt(fe) && fs % 15 === 0 && fe % 15 === 0 && fs >= 0 && fs < fe && fe <= 1440)) {
        err('focus', 'must be empty or a 15-minute-aligned window inside the day');
        out.focus = null;
      } else out.focus = { start: fs, end: fe };
    }

    if (errors.length) return { ok: false, config: null, errors: errors };
    return { ok: true, config: out, errors: [] };
  }

  function canonicalJson(config) { return JSON.stringify(config); }

  function withoutRun(config) {
    var o = {};
    var keys = Object.keys(config);
    for (var i = 0; i < keys.length; i++) if (keys[i] !== 'run') o[keys[i]] = config[keys[i]];
    return o;
  }

  function hex8(n) { var s = (n >>> 0).toString(16); while (s.length < 8) s = '0' + s; return s; }
  function configHash(config) { return hex8(deps.prng.fnv1a(canonicalJson(withoutRun(config)))); }

  // JSON of the configuration without run.seeds and run.seedStart (for the preset test).
  function presetKey(config) {
    var c = JSON.parse(JSON.stringify(config));
    delete c.run.seeds;
    delete c.run.seedStart;
    return JSON.stringify(c);
  }

  function clone(config) { return JSON.parse(JSON.stringify(config)); }

  // ------------------------------------------------------------------ renderability
  function isRenderable(input) {
    try {
      if (!isPlain(input)) return false;
      var i, m, s;
      var plainKeys = ['run', 'traffic', 'retry', 'dropoff', 'strategies', 'compare'];
      for (i = 0; i < plainKeys.length; i++) if (!isPlain(input[plainKeys[i]])) return false;
      if (!Array.isArray(input.gateways) || !Array.isArray(input.events)) return false;
      if (!(input.focus === null || isPlain(input.focus))) return false;
      var t = input.traffic;
      if (!isPlain(t.mix) || !isPlain(t.customerDecline) || !isPlain(t.amount)) return false;
      for (i = 0; i < METHODS.length; i++) if (!isPlain(t.amount[METHODS[i]])) return false;
      if (!Array.isArray(t.hourly) || t.hourly.length !== 24) return false;
      if (!Array.isArray(t.banks) || t.banks.length !== 3) return false;
      for (i = 0; i < 3; i++) if (!isPlain(t.banks[i]) || t.banks[i].id !== BANK_IDS[i]) return false;
      var gws = input.gateways;
      if (gws.length < 2 || gws.length > 5) return false;
      for (i = 0; i < gws.length; i++) {
        if (!isPlain(gws[i]) || gws[i].id !== GATEWAY_IDS[i] || !isPlain(gws[i].methods)) return false;
        for (m = 0; m < METHODS.length; m++) {
          var mv = gws[i].methods[METHODS[m]];
          if (mv !== null && !isPlain(mv)) return false;
        }
      }
      var st = input.strategies;
      var names = ['static', 'weighted', 'rules', 'egreedy', 'thompson', 'thompson_cost'];
      for (i = 0; i < names.length; i++) if (!isPlain(st[names[i]])) return false;
      if (!Array.isArray(st.static.priority) || st.static.priority.length !== gws.length) return false;
      if (!isPlain(st.weighted.weights)) return false;
      if (!Array.isArray(st.rules.rules) || st.rules.rules.length > 20) return false;
      for (i = 0; i < st.rules.rules.length; i++) if (!isPlain(st.rules.rules[i])) return false;
      if (input.events.length > 20) return false;
      for (i = 0; i < input.events.length; i++) if (!isPlain(input.events[i])) return false;
      for (i = 0; i < LEARNING.length; i++) { s = st[LEARNING[i]]; if (!isPlain(s.memory)) return false; }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ field codecs
  function toPercent(v) { return Number((v * 100).toPrecision(12)); }
  function fromPercent(x) { return Number((x / 100).toPrecision(12)); }
  function toSeconds(ms) { return Number((ms / 1000).toPrecision(12)); }
  function fromSeconds(s) { return Math.round(s * 1000); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toHHMM(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
  function fromHHMM(text, allow2400) {
    var s = String(text);
    if (allow2400 && s === '24:00') return 1440;
    var mt = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(s);
    return mt ? Number(mt[1]) * 60 + Number(mt[2]) : null;
  }

  var PCT_PATH = /(^gateways\[\d+\]\.methods\.[a-z_]+\.sr$)|(srFactor$)|(^dropoff\.(base|max)$)|(\.epsilon$)/;
  function displayMessage(path, message) {
    var p = String(path);
    var msg = String(message);
    if (p === 'dropoff.base' && msg === 'dropoff.base must not exceed dropoff.max') return 'Drop-off at the start must not exceed the maximum drop-off.';
    if (PCT_PATH.test(p)) {
      if (msg === 'must be a number from 0 to 1') return 'must be a number from 0 to 100';
      if (msg === 'must be from 0 to 1') return 'must be from 0 to 100';
    }
    if (/^traffic\.customerDecline\./.test(p) && msg === 'must be a number from 0 to 0.9') return 'must be a number from 0 to 90';
    if (p === 'dropoff.perSec' && msg === 'must be from 0 to 0.1') return 'must be from 0 to 10';
    if (/^gateways\[\d+\]\.methods\.[a-z_]+\.p50$/.test(p) && msg === 'must be from 100 ms to 600,000 ms') return 'must be from 0.1 s to 600 s';
    if (/^gateways\[\d+\]\.methods\.[a-z_]+\.p95$/.test(p) && msg === 'must be above p50, at most 50 times p50 and at most 600,000 ms') return 'must be above p50, at most 50 times p50 and at most 600 s';
    return msg;
  }

  return {
    METHODS: METHODS, METHOD_LABELS: METHOD_LABELS, GATEWAY_IDS: GATEWAY_IDS, BANK_IDS: BANK_IDS,
    STRATEGY_IDS: STRATEGY_IDS, POLICY_IDS: POLICY_IDS, POLICY_LABELS: POLICY_LABELS, REASONS: REASONS,
    REASON_LABELS: REASON_LABELS, MAX_ATTEMPTS: MAX_ATTEMPTS, BUCKET_MINUTES: BUCKET_MINUTES, BUCKETS: BUCKETS,
    DAY_MINUTES: DAY_MINUTES, Z95: Z95, MAX_HASH_LENGTH: MAX_HASH_LENGTH, LEARNING: LEARNING,
    validateConfig: validateConfig, canonicalJson: canonicalJson, configHash: configHash, presetKey: presetKey,
    clone: clone, isRenderable: isRenderable, fmtInt: fmtInt, toHHMM: toHHMM, fromHHMM: fromHHMM,
    codec: { toPercent: toPercent, fromPercent: fromPercent, toSeconds: toSeconds, fromSeconds: fromSeconds,
      toHHMM: toHHMM, fromHHMM: fromHHMM, displayMessage: displayMessage }
  };
});
