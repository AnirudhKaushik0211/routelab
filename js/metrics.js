(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { stats: require('./stats.js'), config: require('./config.js') }
    : { stats: root.RouteLab.stats, config: root.RouteLab.config };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.metrics = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var stats = deps.stats;
  var config = deps.config;
  var METHODS = config.METHODS;
  var REASONS = config.REASONS;
  var VERSION = '1.0.0';

  var DAY_KEYS = ['n', 'orderSr', 'firstSr', 'attemptSr', 'retriesPerTxn', 'dropRate', 'failRate', 'costPerSuccess',
    'feeRatePct', 'ttsP50', 'ttsP95', 'regretPer1000'];

  function ratio(a, b) { return b > 0 ? a / b : null; }

  function dayMetrics(run) {
    var n = run.n;
    var ok = run.success > 0;
    return {
      n: n,
      orderSr: ratio(run.success, n),
      firstSr: ratio(run.firstSuccess, n),
      attemptSr: ratio(run.successfulAttempts, run.attempts),
      retriesPerTxn: n > 0 ? (run.attempts - n) / n : null,
      dropRate: ratio(run.dropped, n),
      failRate: ratio(run.failed, n),
      costPerSuccess: ok ? run.fees / run.success : null,
      feeRatePct: run.successAmount > 0 ? 100 * run.fees / run.successAmount : null,
      ttsP50: ok ? stats.percentile(run.tts, 0.5) : null,
      ttsP95: ok ? stats.percentile(run.tts, 0.95) : null,
      regretPer1000: n > 0 ? 1000 * run.regretSum / n : null
    };
  }

  function statusFractions(run) {
    var o = {};
    for (var i = 0; i < REASONS.length; i++) o[REASONS[i]] = run.n > 0 ? run.reasons[REASONS[i]] / run.n : null;
    return o;
  }

  // Window [s, e) over 15-minute buckets. kind: 'orderSr' or 'firstSr'; mi: method index or undefined.
  function windowSr(run, s, e, kind, mi) {
    var num = 0;
    var den = 0;
    var arr = kind === 'firstSr' ? run.buckets.firstSuccess : run.buckets.success;
    for (var b = s / 15; b < e / 15; b++) {
      for (var m = 0; m < 4; m++) {
        if (mi !== undefined && m !== mi) continue;
        den += run.buckets.n[b * 4 + m];
        num += arr[b * 4 + m];
      }
    }
    return den > 0 ? num / den : null;
  }

  function windowShare(run, s, e, g) {
    var G = run.G;
    var num = 0;
    var den = 0;
    for (var b = s / 15; b < e / 15; b++) {
      for (var k = 0; k < G; k++) den += run.buckets.first[b * G + k];
      num += run.buckets.first[b * G + g];
    }
    return den > 0 ? num / den : null;
  }

  // ------------------------------------------------------------------ labels and formats (SPEC 6.3)
  var SR_METRICS = { orderSr: 1, firstSr: 1, attemptSr: 1, dropRate: 1, failRate: 1 };
  var METRIC_LABELS = { orderSr: 'order SR', firstSr: 'first-attempt SR', attemptSr: 'attempt SR',
    retriesPerTxn: 'retries per transaction', dropRate: 'drop-off rate', failRate: 'failed rate',
    costPerSuccess: 'cost per success', feeRatePct: 'effective fee rate', ttsP50: 'time to success p50',
    ttsP95: 'time to success p95', regretPer1000: 'regret per 1,000', all: 'all day metrics and final statuses' };

  function isSr(metric) { return SR_METRICS[metric] === 1 || String(metric).indexOf('share:') === 0; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
  function windowLabel(w) { return hhmm(w[0]) + '-' + hhmm(w[1]); }

  function policyLabel(p) { return p === '*' ? 'Every policy' : config.POLICY_LABELS[p]; }

  function metricLabel(row) {
    var base;
    if (String(row.metric).indexOf('share:') === 0) base = 'share of first attempts on Gateway ' + row.metric.slice(6);
    else base = METRIC_LABELS[row.metric];
    if (row.method) base += ' (' + config.METHOD_LABELS[row.method] + ')';
    return base;
  }

  function scopeLabelOf(scope, focus) {
    if (scope === 'day') return 'day';
    if (scope === 'focus') return focus ? windowLabel([focus.start, focus.end]) : 'focus window';
    return windowLabel(scope);
  }

  function fmtLevel(metric, x) {
    if (x === null || x === undefined) return 'n/a';
    if (isSr(metric)) return (x * 100).toFixed(2) + '%';
    if (metric === 'costPerSuccess') return 'Rs ' + x.toFixed(2);
    if (metric === 'feeRatePct') return x.toFixed(2) + '%';
    if (metric === 'regretPer1000') return x.toFixed(1);
    if (metric === 'retriesPerTxn') return x.toFixed(3);
    if (metric === 'ttsP50' || metric === 'ttsP95') return x.toFixed(1) + ' s';
    return String(x);
  }

  function fmtDiff(metric, x) {
    if (x === null || x === undefined) return 'n/a';
    var abs = Math.abs(x);
    var num;
    var pre = '';
    var suf = '';
    if (isSr(metric)) { num = (abs * 100).toFixed(2); suf = ' pp'; }
    else if (metric === 'feeRatePct') { num = abs.toFixed(2); suf = ' pp'; }
    else if (metric === 'costPerSuccess') { num = abs.toFixed(2); pre = 'Rs '; }
    else if (metric === 'regretPer1000') num = abs.toFixed(1);
    else if (metric === 'retriesPerTxn') num = abs.toFixed(3);
    else if (metric === 'ttsP50' || metric === 'ttsP95') { num = abs.toFixed(1); suf = ' s'; }
    else num = String(abs);
    var plus = x >= 0 || parseFloat(num) === 0;
    return (plus ? '+' : '-') + pre + num + suf;
  }

  // Interval ends of a difference drop the " pp" unit, as in the SPEC 6.3 examples.
  function noPp(s) { return String(s).replace(/ pp$/, ''); }

  function fmtRel(x) {
    if (x === null || x === undefined) return 'n/a';
    var num = (Math.abs(x) * 100).toFixed(2);
    return (x >= 0 || parseFloat(num) === 0 ? '+' : '-') + num + '%';
  }

  function fmtThr(row, x) {
    if (row.op === 'relDiffAtLeast') return fmtRel(x);
    if (row.op === 'diffAtLeast' || row.op === 'diffAtLeastCi' || row.op === 'diffWithin' || row.op === 'windowDropAtLeast') return fmtDiff(row.metric, x);
    return fmtLevel(row.metric, x);
  }

  function requirement(row, focus) {
    switch (row.op) {
      case 'diffAtLeast': return 'at least ' + fmtThr(row, row.threshold);
      case 'diffAtLeastCi': return 'at least ' + fmtThr(row, row.threshold) + ' and CI above 0';
      case 'diffWithin': return 'between ' + fmtThr(row, row.threshold) + ' and ' + fmtThr(row, row.threshold2);
      case 'relDiffAtLeast': return 'relatively at least ' + fmtThr(row, row.threshold);
      case 'atLeast': return 'at least ' + fmtThr(row, row.threshold);
      case 'atMost': return 'at most ' + fmtThr(row, row.threshold);
      case 'exactlyEqual': return 'identical on every seed';
      case 'exactlyValue': return 'exactly ' + fmtThr(row, row.threshold) + ' on every seed';
      case 'windowDropAtLeast': return 'a drop of at least ' + fmtThr(row, row.threshold) + ' compared with ' + scopeLabelOf(row.before, focus);
      default: return '';
    }
  }

  function subjectOf(row) {
    if (row.op === 'exactlyEqual') return policyLabel(row.a) + ' and ' + policyLabel(row.b);
    if (row.b && (row.op === 'diffAtLeast' || row.op === 'diffAtLeastCi' || row.op === 'diffWithin' || row.op === 'relDiffAtLeast')) {
      return policyLabel(row.a) + ' - ' + policyLabel(row.b);
    }
    return policyLabel(row.a);
  }

  function head(row, focus) {
    var s = subjectOf(row) + ', ' + metricLabel(row);
    if (row.op !== 'exactlyEqual') s += ' ' + scopeLabelOf(row.scope, focus);
    return s;
  }

  function expectationText(row, focus) { return head(row, focus) + ': ' + requirement(row, focus) + '.'; }

  // Observed value formatted for the row (level, difference or relative).
  function formatObserved(row, x) {
    if (row.op === 'relDiffAtLeast') return fmtRel(x);
    if (row.op === 'diffAtLeast' || row.op === 'diffAtLeastCi' || row.op === 'diffWithin' || row.op === 'windowDropAtLeast') return fmtDiff(row.metric, x);
    return fmtLevel(row.metric, x);
  }

  // ------------------------------------------------------------------ per-seed values
  function windowOf(scope, focus) {
    if (scope === 'day') return [0, 1440];
    if (scope === 'focus') return focus ? [focus.start, focus.end] : [0, 1440];
    return scope;
  }

  function seedValues(runs, metric, scope, method, focus, gwIds) {
    var out = [];
    var mi = method ? METHODS.indexOf(method) : undefined;
    var w = windowOf(scope, focus);
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i];
      var v;
      if (String(metric).indexOf('share:') === 0) v = windowShare(run, w[0], w[1], gwIds.indexOf(metric.slice(6)));
      else if ((metric === 'orderSr' || metric === 'firstSr') && (scope !== 'day' || mi !== undefined)) v = windowSr(run, w[0], w[1], metric, mi);
      else v = dayMetrics(run)[metric];
      out.push(v === undefined ? null : v);
    }
    return out;
  }

  function evalRow(row, runsBy, focus, gwIds) {
    var res = { id: row.id, text: expectationText(row, focus), held: null, value: null, ciLow: null, ciHigh: null, detail: '' };
    var names = [row.a];
    if (row.b) names.push(row.b);
    for (var q = 0; q < names.length; q++) {
      if (names[q] !== '*' && !runsBy[names[q]]) {
        res.detail = 'Not checked: ' + policyLabel(names[q]) + ' is switched off.';
        return res;
      }
    }
    var h = head(row, focus);
    var req = requirement(row, focus);
    var i;
    if (row.op === 'exactlyEqual') {
      var ra = runsBy[row.a];
      var rb = runsBy[row.b];
      var matched = 0;
      for (i = 0; i < ra.length; i++) {
        var da = dayMetrics(ra[i]);
        var db = dayMetrics(rb[i]);
        var sa = statusFractions(ra[i]);
        var sb = statusFractions(rb[i]);
        var same = true;
        DAY_KEYS.forEach(function (k) { if (da[k] !== db[k]) same = false; });
        REASONS.forEach(function (k) { if (sa[k] !== sb[k]) same = false; });
        if (same) matched++;
      }
      res.held = ra.length > 0 && matched === ra.length;
      res.value = matched;
      res.detail = h + ': ' + matched + ' of ' + ra.length + ' seeds matched; required ' + req + '.';
      return res;
    }
    if (row.op === 'exactlyValue') {
      var pols = row.a === '*' ? Object.keys(runsBy) : [row.a];
      var nSeeds = runsBy[pols[0]].length;
      var ok = [];
      for (i = 0; i < nSeeds; i++) ok.push(true);
      pols.forEach(function (p) {
        var xs = seedValues(runsBy[p], row.metric, row.scope, row.method, focus, gwIds);
        for (var s = 0; s < xs.length; s++) if (xs[s] === null || xs[s] !== row.threshold) ok[s] = false;
      });
      var cnt = ok.filter(function (b) { return b; }).length;
      res.held = nSeeds > 0 && cnt === nSeeds;
      res.value = cnt;
      res.detail = h + ': ' + cnt + ' of ' + nSeeds + ' seeds matched; required ' + req + '.';
      return res;
    }
    var xa = seedValues(runsBy[row.a], row.metric, row.scope, row.method, focus, gwIds);
    var xb = row.b ? seedValues(runsBy[row.b], row.metric, row.scope, row.method, focus, gwIds) : null;
    var S = null;
    var many = true;
    var note = '';
    if (row.op === 'diffAtLeast' || row.op === 'diffAtLeastCi' || row.op === 'diffWithin') {
      S = stats.summarise(stats.differences(xa, xb));
      var m = S.mean;
      if (m === null) res.held = false;
      else if (row.op === 'diffWithin') res.held = m >= row.threshold && m <= row.threshold2;
      else if (row.op === 'diffAtLeast') res.held = m >= row.threshold;
      else res.held = m >= row.threshold && S.ciLow !== null && S.ciLow > 0;
      res.value = m;
      if (S.ciLow === null && row.op === 'diffAtLeastCi') note = '; needs at least 2 seeds for an interval';
    } else if (row.op === 'relDiffAtLeast') {
      var ma = stats.summarise(xa).mean;
      var mb = stats.summarise(xb).mean;
      var rel = (ma !== null && mb !== null && mb !== 0) ? (ma - mb) / mb : null;
      res.held = rel !== null && rel >= row.threshold;
      res.value = rel;
    } else if (row.op === 'atLeast' || row.op === 'atMost') {
      S = stats.summarise(xa);
      res.held = S.mean !== null && (row.op === 'atLeast' ? S.mean >= row.threshold : S.mean <= row.threshold);
      res.value = S.mean;
    } else if (row.op === 'windowDropAtLeast') {
      var before = seedValues(runsBy[row.a], row.metric, row.before, row.method, focus, gwIds);
      S = stats.summarise(stats.differences(before, xa));
      res.held = S.mean !== null && S.mean >= row.threshold;
      res.value = S.mean;
    }
    if (S && S.ciLow !== null) { res.ciLow = S.ciLow; res.ciHigh = S.ciHigh; }
    var obs = formatObserved(row, res.value);
    var detail = h + ': ' + obs;
    if (res.ciLow !== null) detail += ' (95% CI ' + noPp(formatObserved(row, res.ciLow)) + ' to ' + noPp(formatObserved(row, res.ciHigh)) + ')';
    detail += note + '; required ' + req + '.';
    res.detail = detail;
    return res;
  }

  // Headline (SPEC 6.4): returns { text, mean, ciLow, ciHigh }.
  function headline(hl, runsBy, focus, gwIds) {
    var xa = seedValues(runsBy[hl.a], hl.metric, hl.scope, hl.method, focus, gwIds);
    var S;
    var fmt;
    var subject;
    if (hl.b) {
      var xb = seedValues(runsBy[hl.b], hl.metric, hl.scope, hl.method, focus, gwIds);
      S = stats.summarise(stats.differences(xa, xb));
      fmt = function (x) { return fmtDiff(hl.metric, x); };
      subject = policyLabel(hl.a) + ' - ' + policyLabel(hl.b);
    } else {
      S = stats.summarise(xa);
      fmt = function (x) { return fmtLevel(hl.metric, x); };
      subject = policyLabel(hl.a);
    }
    var text = subject + ', ' + metricLabel(hl) + ' (' + scopeLabelOf(hl.scope, focus) + '): ' + fmt(S.mean);
    if (S.ciLow !== null) text += ' (95% CI ' + noPp(fmt(S.ciLow)) + ' to ' + noPp(fmt(S.ciHigh)) + ')';
    return { text: text, mean: S.mean, ciLow: S.ciLow, ciHigh: S.ciHigh };
  }

  // ------------------------------------------------------------------ aggregation
  function round6(x) {
    if (typeof x !== 'number') return x;
    var r = Math.round(x * 1e6) / 1e6;
    return r === 0 ? 0 : r;
  }
  function roundDeep(v) {
    if (typeof v === 'number') return round6(v);
    if (Array.isArray(v)) return v.map(roundDeep);
    if (v !== null && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = roundDeep(v[k]); });
      return o;
    }
    return v;
  }

  function series(runs, G, group) {
    var nb = 96 / group;
    var n = []; var succ = []; var first = []; var fs = []; var fa = []; var att = []; var attS = [];
    var b; var m; var g; var r;
    for (b = 0; b < nb; b++) {
      n.push([0, 0, 0, 0]); succ.push([0, 0, 0, 0]); first.push([0, 0, 0, 0]);
      fs.push(new Array(G).fill(0)); att.push(new Array(G).fill(0)); attS.push(new Array(G).fill(0));
    }
    for (r = 0; r < runs.length; r++) {
      var B = runs[r].buckets;
      for (b = 0; b < 96; b++) {
        var gi = Math.floor(b / group);
        for (m = 0; m < 4; m++) { n[gi][m] += B.n[b * 4 + m]; succ[gi][m] += B.success[b * 4 + m]; first[gi][m] += B.firstSuccess[b * 4 + m]; }
        for (g = 0; g < G; g++) { fs[gi][g] += B.first[b * G + g]; att[gi][g] += B.attempts[b * G + g]; attS[gi][g] += B.attemptSuccess[b * G + g]; }
      }
    }
    function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
    var out = { orderSr: [], firstSr: [], orderSrByMethod: {}, share: {}, gatewayAttemptSr: {} };
    METHODS.forEach(function (mm) { out.orderSrByMethod[mm] = []; });
    for (b = 0; b < nb; b++) {
      out.orderSr.push(ratio(sum(succ[b]), sum(n[b])));
      out.firstSr.push(ratio(sum(first[b]), sum(n[b])));
      for (m = 0; m < 4; m++) out.orderSrByMethod[METHODS[m]].push(ratio(succ[b][m], n[b][m]));
    }
    return { out: out, fs: fs, att: att, attS: attS, nb: nb, sum: sum };
  }

  function buildSeries(runs, gwIds, group) {
    var G = gwIds.length;
    var s = series(runs, G, group);
    gwIds.forEach(function (id, g) {
      s.out.share[id] = [];
      s.out.gatewayAttemptSr[id] = [];
      for (var b = 0; b < s.nb; b++) {
        s.out.share[id].push(ratio(s.fs[b][g], s.sum(s.fs[b])));
        s.out.gatewayAttemptSr[id].push(ratio(s.attS[b][g], s.att[b][g]));
      }
    });
    return s.out;
  }

  function aggregate(cfg, runsBy, seeds, meta) {
    var gwIds = cfg.gateways.map(function (g) { return g.id; });
    var polIds = config.POLICY_IDS.filter(function (p) { return p === 'oracle' || cfg.strategies[p].enabled; });
    var baseline = cfg.compare.baseline;
    var perSeedRaw = {};
    var statusRaw = {};
    polIds.forEach(function (p) {
      perSeedRaw[p] = runsBy[p].map(dayMetrics);
      statusRaw[p] = runsBy[p].map(statusFractions);
    });
    function col(p, k) { return perSeedRaw[p].map(function (d) { return d[k]; }); }
    var summary = {};
    var status = {};
    var paired = {};
    var perSeed = {};
    polIds.forEach(function (p) {
      summary[p] = {};
      DAY_KEYS.forEach(function (k) { summary[p][k] = stats.summarise(col(p, k)); });
      status[p] = {};
      REASONS.forEach(function (r) { status[p][r] = stats.summarise(statusRaw[p].map(function (d) { return d[r]; })); });
      if (p !== baseline) {
        paired[p] = {};
        DAY_KEYS.forEach(function (k) { paired[p][k] = stats.paired(col(p, k), col(baseline, k)); });
      }
      perSeed[p] = perSeedRaw[p].map(function (d, i) {
        var o = { seed: seeds[i] };
        DAY_KEYS.forEach(function (k) { o[k] = d[k]; });
        return o;
      });
    });
    var focus = cfg.focus;
    var focusSummary = null;
    if (focus) {
      focusSummary = {};
      polIds.forEach(function (p) {
        var runs = runsBy[p];
        var fsum = {
          orderSr: stats.summarise(runs.map(function (r) { return windowSr(r, focus.start, focus.end, 'orderSr'); })),
          firstSr: stats.summarise(runs.map(function (r) { return windowSr(r, focus.start, focus.end, 'firstSr'); })),
          orderSrByMethod: {}, share: {}
        };
        METHODS.forEach(function (m, mi) {
          fsum.orderSrByMethod[m] = stats.summarise(runs.map(function (r) { return windowSr(r, focus.start, focus.end, 'orderSr', mi); }));
        });
        gwIds.forEach(function (id, g) {
          fsum.share[id] = stats.summarise(runs.map(function (r) { return windowShare(r, focus.start, focus.end, g); }));
        });
        focusSummary[p] = fsum;
      });
    }
    var ser = { bucketMinutes: 15, orderSr: {}, firstSr: {}, orderSrByMethod: {}, share: {}, gatewayAttemptSr: {},
      hourly: { orderSr: {}, firstSr: {}, orderSrByMethod: {}, share: {}, gatewayAttemptSr: {} } };
    polIds.forEach(function (p) {
      var a = buildSeries(runsBy[p], gwIds, 1);
      var h = buildSeries(runsBy[p], gwIds, 4);
      ['orderSr', 'firstSr', 'orderSrByMethod', 'share', 'gatewayAttemptSr'].forEach(function (k) {
        ser[k][p] = a[k];
        ser.hourly[k][p] = h[k];
      });
    });
    var expectations = null;
    if (meta.preset && meta.expectations) {
      expectations = meta.expectations.map(function (row) { return evalRow(row, runsBy, focus, gwIds); });
    }
    var cfgOut = config.clone(cfg);
    var res = {
      schema: 'routelab.results.v1',
      version: VERSION,
      scenarioId: meta.scenarioId,
      preset: !!meta.preset,
      title: meta.preset ? meta.title : 'Custom settings',
      expectationText: meta.preset ? meta.expectationText : null,
      configHash: config.configHash(cfgOut),
      config: cfgOut,
      seeds: seeds.slice(),
      policies: polIds.map(function (p) { return { id: p, label: config.POLICY_LABELS[p], reference: p === 'oracle' }; }),
      baseline: baseline,
      focus: focus ? { start: focus.start, end: focus.end } : null,
      summary: roundDeep(summary),
      status: roundDeep(status),
      paired: roundDeep(paired),
      focusSummary: focusSummary ? roundDeep(focusSummary) : null,
      series: roundDeep(ser),
      perSeed: roundDeep(perSeed),
      expectations: expectations ? roundDeep(expectations) : null
    };
    return res;
  }

  return { DAY_KEYS: DAY_KEYS, dayMetrics: dayMetrics, statusFractions: statusFractions, windowSr: windowSr,
    windowShare: windowShare, aggregate: aggregate, evalRow: evalRow, headline: headline, seedValues: seedValues,
    expectationText: expectationText, formatObserved: formatObserved, fmtLevel: fmtLevel, fmtDiff: fmtDiff, fmtRel: fmtRel,
    metricLabel: metricLabel, scopeLabel: scopeLabelOf, windowLabel: windowLabel, round6: round6, roundDeep: roundDeep,
    VERSION: VERSION };
});
