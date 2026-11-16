(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { config: require('./config.js'), model: require('./model.js'), strategies: require('./strategies.js') }
    : { config: root.RouteLab.config, model: root.RouteLab.model, strategies: root.RouteLab.strategies };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.engine = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var model = deps.model;
  var strategies = deps.strategies;

  var METHOD_NAMES = deps.config.METHODS;
  var OUT_SUCCESS = 1;
  var OUT_CUSTOMER = 2;
  var OUT_TECHNICAL = 3;
  var OUT_RATE = 4;

  // Binary min-heap of events ordered by (t, seq).
  function Heap() { this.a = []; this.seq = 0; }
  Heap.prototype.push = function (e) {
    e.seq = this.seq++;
    var a = this.a;
    var i = a.length;
    a.push(e);
    while (i > 0) {
      var p = (i - 1) >> 1;
      var x = a[p];
      if (x.t < e.t || (x.t === e.t && x.seq < e.seq)) break;
      a[i] = x;
      i = p;
    }
    a[i] = e;
  };
  Heap.prototype.pop = function () {
    var a = this.a;
    var top = a[0];
    var last = a.pop();
    var n = a.length;
    if (n > 0) {
      var i = 0;
      for (;;) {
        var l = 2 * i + 1;
        if (l >= n) break;
        var r = l + 1;
        var c = (r < n && (a[r].t < a[l].t || (a[r].t === a[l].t && a[r].seq < a[l].seq))) ? r : l;
        if (last.t < a[c].t || (last.t === a[c].t && last.seq < a[c].seq)) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  };

  // engine.runPolicy(config, traffic, policyId, seed) -> run record (SPEC 3.7). `config` must be normalised.
  function runPolicy(cfg, traffic, policyId, seed) {
    var G = cfg.gateways.length;
    var n = traffic.n;
    var pm = model.prepare(cfg);
    var policy = strategies.create(cfg, policyId, seed);
    var retry = cfg.retry;
    var drop = cfg.dropoff;
    var sameMode = retry.mode === 'same';
    var gw = cfg.gateways;
    var heap = new Heap();
    var tried = new Uint8Array(n);
    var capCount = [];
    var g;
    for (g = 0; g < G; g++) capCount.push(gw[g].capacityTpm !== null ? new Map() : null);

    var bN = new Float64Array(96 * 4);
    var bS = new Float64Array(96 * 4);
    var bF = new Float64Array(96 * 4);
    var bFirst = new Float64Array(96 * G);
    var bAtt = new Float64Array(96 * G);
    var bAttS = new Float64Array(96 * G);
    var bFees = new Float64Array(96);
    var reasons = { success: 0, customer: 0, technical: 0, rate_limited: 0, no_route: 0, dropped: 0 };
    var tts = [];
    var attempts = 0;
    var successfulAttempts = 0;
    var firstSuccess = 0;
    var fees = 0;
    var successAmount = 0;
    var regretSum = 0;

    var T = traffic.t;
    var Mth = traffic.method;
    var AMT = traffic.amount;
    var BANK = traffic.bank;
    var CUST = traffic.customer;
    var US = traffic.uS;
    var ZZ = traffic.z;
    var UD = traffic.uD;

    function finish(i, reason) {
      var b = Math.floor(T[i] / 15);
      bN[b * 4 + Mth[i]]++;
      reasons[reason]++;
    }

    // Precomputed eligibility inputs; `el` and `ctx` are reused (policies never keep them after choose returns).
    var supports = new Uint8Array(G * 4);
    var activeFrom = new Float64Array(G);
    for (g = 0; g < G; g++) {
      activeFrom[g] = gw[g].activeFrom;
      for (var mm = 0; mm < 4; mm++) supports[g * 4 + mm] = gw[g].methods[METHOD_NAMES[mm]] === null ? 0 : 1;
    }
    var el = [];
    var ctx = { t: 0, method: 0, amount: 0, attempt: 0 };

    function startAttempt(i, k, t, prevG) {
      var m = Mth[i];
      var gi;
      var qChosen = null;
      if (k > 0 && sameMode) gi = prevG;
      else {
        el.length = 0;
        var mask = tried[i];
        for (var h = 0; h < G; h++) {
          if (activeFrom[h] > t) continue;
          if (supports[h * 4 + m] === 0) continue;
          if (!sameMode && (mask & (1 << h))) continue;
          el.push(h);
        }
        if (el.length === 0) { finish(i, 'no_route'); return; }
        ctx.t = t; ctx.method = m; ctx.amount = AMT[i]; ctx.attempt = k;
        gi = policy.choose(ctx, el);
      }
      var bucket = Math.floor(T[i] / 15);
      if (k === 0) {
        bFirst[bucket * G + gi]++;
        if (CUST[i] === 0) {
          var bq = -Infinity;
          for (var j = 0; j < el.length; j++) {
            var qq = pm.q(el[j], m, t);
            if (el[j] === gi) qChosen = qq;
            if (qq > bq) bq = qq;
          }
          regretSum += bq - qChosen;
        }
      }
      tried[i] |= (1 << gi);
      attempts++;
      bAtt[bucket * G + gi]++;
      var outcome;
      var latMs;
      var cm = capCount[gi];
      var minute = Math.floor(t);
      if (cm !== null && (cm.get(minute) || 0) >= gw[gi].capacityTpm) {
        outcome = OUT_RATE;
        latMs = 200;
      } else {
        if (cm !== null) cm.set(minute, (cm.get(minute) || 0) + 1);
        var lp = pm.lat(gi, m);
        latMs = Math.exp(lp.mu + lp.sigma * ZZ[4 * i + k]) * pm.latMult(gi, m, t);
        if (CUST[i] === 1) outcome = OUT_CUSTOMER;
        else {
          var p = (qChosen !== null ? qChosen : pm.q(gi, m, t)) * pm.bankMult(BANK[i], m, t);
          p = p < 0 ? 0 : (p > 1 ? 1 : p);
          outcome = US[4 * i + k] < p ? OUT_SUCCESS : OUT_TECHNICAL;
        }
      }
      heap.push({ t: t + latMs / 60000, kind: 0, i: i, k: k, g: gi, o: outcome });
    }

    function complete(e) {
      var i = e.i;
      var k = e.k;
      var gi = e.g;
      var m = Mth[i];
      var tc = e.t;
      var o = e.o;
      var bucket = Math.floor(T[i] / 15);
      if (o !== OUT_CUSTOMER) policy.update(m, gi, o === OUT_SUCCESS ? 1 : 0, tc);
      if (o === OUT_SUCCESS) {
        var f = pm.fee(gi, m, AMT[i]);
        fees += f;
        bFees[bucket] += f;
        successAmount += AMT[i];
        successfulAttempts++;
        bAttS[bucket * G + gi]++;
        if (k === 0) { firstSuccess++; bF[bucket * 4 + m]++; }
        bS[bucket * 4 + m]++;
        tts.push((tc - T[i]) * 60);
        finish(i, 'success');
        return;
      }
      if (o === OUT_CUSTOMER) { finish(i, 'customer'); return; }
      var reason = o === OUT_RATE ? 'rate_limited' : 'technical';
      if (k >= retry.maxRetries) { finish(i, reason); return; }
      var elapsed = (tc - T[i]) * 60;
      var pDrop = drop.base + drop.perSec * elapsed;
      if (pDrop > drop.max) pDrop = drop.max;
      if (UD[4 * i + k] < pDrop) { finish(i, 'dropped'); return; }
      heap.push({ t: tc + retry.delaySec / 60, kind: 1, i: i, k: k + 1, g: gi, o: 0 });
    }

    var next = 0;
    while (next < n || heap.a.length > 0) {
      if (heap.a.length > 0 && (next >= n || heap.a[0].t <= T[next])) {
        var e = heap.pop();
        if (e.kind === 0) complete(e); else startAttempt(e.i, e.k, e.t, e.g);
      } else {
        startAttempt(next, 0, T[next], -1);
        next++;
      }
    }

    var ttsArr = Float64Array.from(tts);
    ttsArr.sort();
    var failed = reasons.customer + reasons.technical + reasons.rate_limited + reasons.no_route;
    return {
      policy: policyId, seed: seed, n: n, G: G,
      success: reasons.success, failed: failed, dropped: reasons.dropped, firstSuccess: firstSuccess,
      attempts: attempts, successfulAttempts: successfulAttempts, fees: fees, successAmount: successAmount,
      regretSum: regretSum, reasons: reasons, tts: ttsArr,
      buckets: { n: bN, success: bS, firstSuccess: bF, first: bFirst, attempts: bAtt, attemptSuccess: bAttS, fees: bFees }
    };
  }

  return { runPolicy: runPolicy, Heap: Heap };
});
