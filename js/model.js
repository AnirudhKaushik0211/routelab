(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { config: require('./config.js') } : { config: root.RouteLab.config };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.model = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var config = deps.config;
  var METHODS = config.METHODS;

  // Severity of one event at time t: the maximum over its occurrences.
  function severity(event, t) {
    var n = event.repeatEvery > 0 ? event.repeatCount : 1;
    // Outside the span of all occurrences the severity is 0 (fast path; same result as the loop below).
    if (t < event.start || t >= event.start + (n - 1) * event.repeatEvery + event.duration + event.recovery) return 0;
    var best = 0;
    for (var k = 0; k < n; k++) {
      var s = event.start + k * event.repeatEvery;
      var end = s + event.duration;
      var v = 0;
      if (t >= s && t < end) v = 1;
      else if (event.recovery > 0 && t >= end && t < end + event.recovery) v = 1 - (t - end) / event.recovery;
      if (v > best) best = v;
    }
    return best;
  }

  function matching(cfg, kind, id, methodIndex) {
    var out = [];
    for (var i = 0; i < cfg.events.length; i++) {
      var e = cfg.events[i];
      if (e.target !== kind || e.id !== id) continue;
      if (e.methods.length > 0 && e.methods.indexOf(METHODS[methodIndex]) < 0) continue;
      out.push(e);
    }
    return out;
  }

  function srMultOf(list, t) {
    var m = 1;
    for (var i = 0; i < list.length; i++) m *= 1 - severity(list[i], t) * (1 - list[i].srFactor);
    return m;
  }

  function latMultOf(list, t) {
    var m = 1;
    for (var i = 0; i < list.length; i++) m *= 1 + severity(list[i], t) * (list[i].latencyFactor - 1);
    return m;
  }

  function gatewaySrMult(cfg, gi, mi, t) { return srMultOf(matching(cfg, 'gateway', cfg.gateways[gi].id, mi), t); }
  function gatewayLatMult(cfg, gi, mi, t) { return latMultOf(matching(cfg, 'gateway', cfg.gateways[gi].id, mi), t); }
  function bankSrMult(cfg, bi, mi, t) { return srMultOf(matching(cfg, 'bank', cfg.traffic.banks[bi].id, mi), t); }

  function q(cfg, gi, mi, t) {
    var mm = cfg.gateways[gi].methods[METHODS[mi]];
    if (!mm) return -1;
    return mm.sr * gatewaySrMult(cfg, gi, mi, t);
  }

  function fee(cfg, gi, mi, amount) {
    var mm = cfg.gateways[gi].methods[METHODS[mi]];
    return mm.fixedFee + mm.pctFee / 100 * amount;
  }

  function lognormalParams(p50, p95) {
    var mu = Math.log(p50);
    return { mu: mu, sigma: (Math.log(p95) - mu) / config.Z95 };
  }

  // Precomputes matching event lists once per run (speed). Returned functions use indices.
  function prepare(cfg) {
    var G = cfg.gateways.length;
    var gEvents = [];
    var bEvents = [];
    var lat = [];
    var sr = [];
    var feeFixed = [];
    var feePct = [];
    var g;
    var m;
    for (g = 0; g < G; g++) {
      gEvents.push([]); lat.push([]); sr.push([]); feeFixed.push([]); feePct.push([]);
      for (m = 0; m < METHODS.length; m++) {
        gEvents[g].push(matching(cfg, 'gateway', cfg.gateways[g].id, m));
        var mm = cfg.gateways[g].methods[METHODS[m]];
        if (mm) {
          lat[g].push(lognormalParams(mm.p50, mm.p95));
          sr[g].push(mm.sr); feeFixed[g].push(mm.fixedFee); feePct[g].push(mm.pctFee);
        } else { lat[g].push(null); sr[g].push(-1); feeFixed[g].push(0); feePct[g].push(0); }
      }
    }
    for (var b = 0; b < cfg.traffic.banks.length; b++) {
      bEvents.push([]);
      for (m = 0; m < METHODS.length; m++) bEvents[b].push(matching(cfg, 'bank', cfg.traffic.banks[b].id, m));
    }
    var hasLat = gEvents.map(function (row) {
      return row.map(function (list) { return list.some(function (e) { return e.latencyFactor !== 1; }); });
    });
    return {
      G: G,
      q: function (gi, mi, t) {
        var s = sr[gi][mi];
        if (s < 0) return -1;
        var list = gEvents[gi][mi];
        return list.length === 0 ? s : s * srMultOf(list, t);
      },
      latMult: function (gi, mi, t) { return hasLat[gi][mi] ? latMultOf(gEvents[gi][mi], t) : 1; },
      bankMult: function (bi, mi, t) {
        var f = cfg.traffic.banks[bi].srFactor;
        var list = bEvents[bi][mi];
        return list.length === 0 ? f : f * srMultOf(list, t);
      },
      lat: function (gi, mi) { return lat[gi][mi]; },
      fee: function (gi, mi, amount) { return feeFixed[gi][mi] + feePct[gi][mi] / 100 * amount; }
    };
  }

  return { severity: severity, matching: matching, gatewaySrMult: gatewaySrMult, gatewayLatMult: gatewayLatMult,
    bankSrMult: bankSrMult, q: q, fee: fee, lognormalParams: lognormalParams, prepare: prepare };
});
