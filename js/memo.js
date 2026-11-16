(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { config: require('./config.js'), metrics: require('./metrics.js') }
    : { config: root.RouteLab.config, metrics: root.RouteLab.metrics };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.memo = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var config = deps.config;
  var metrics = deps.metrics;
  var METHODS = config.METHODS;

  // ------------------------------------------------------------------ number formats (shared with the UI)
  var format = {
    pct: function (x) { return x === null || x === undefined ? 'n/a' : (x * 100).toFixed(2) + '%'; },
    pctNum: function (x) { return x === null || x === undefined ? 'n/a' : (x * 100).toFixed(2); },
    pp: function (x) {
      if (x === null || x === undefined) return 'n/a';
      var n = (Math.abs(x) * 100).toFixed(2);
      return (x >= 0 || parseFloat(n) === 0 ? '+' : '-') + n;
    },
    rs: function (x) { return x === null || x === undefined ? 'n/a' : 'Rs ' + x.toFixed(2); },
    rsNum: function (x) { return x === null || x === undefined ? 'n/a' : x.toFixed(2); },
    rsDiff: function (x) {
      if (x === null || x === undefined) return 'n/a';
      var n = Math.abs(x).toFixed(2);
      return (x >= 0 || parseFloat(n) === 0 ? '+' : '-') + n;
    },
    sec: function (x) { return x === null || x === undefined ? 'n/a' : x.toFixed(1) + ' s'; },
    secNum: function (x) { return x === null || x === undefined ? 'n/a' : x.toFixed(1); },
    one: function (x) { return x === null || x === undefined ? 'n/a' : x.toFixed(1); },
    oneDiff: function (x) {
      if (x === null || x === undefined) return 'n/a';
      var n = Math.abs(x).toFixed(1);
      return (x >= 0 || parseFloat(n) === 0 ? '+' : '-') + n;
    },
    three: function (x) { return x === null || x === undefined ? 'n/a' : x.toFixed(3); },
    two: function (x) { return x === null || x === undefined ? 'n/a' : x.toFixed(2) + '%'; },
    int: function (n) { return config.fmtInt(n); }
  };

  // "mean (low-high)" style cell. fmt formats the mean (with unit), fmtNum the interval ends (no unit).
  function cell(stat, fmt, fmtNum) {
    if (!stat || stat.mean === null) return 'n/a';
    if (stat.ciLow === null) return fmt(stat.mean);
    return fmt(stat.mean) + ' (' + fmtNum(stat.ciLow) + '-' + fmtNum(stat.ciHigh) + ')';
  }

  function pairedCell(stat, fmtDiff) {
    if (!stat || stat.mean === null) return 'n/a';
    if (stat.ciLow === null) return fmtDiff(stat.mean);
    return fmtDiff(stat.mean) + ' (' + fmtDiff(stat.ciLow) + ' to ' + fmtDiff(stat.ciHigh) + ')';
  }

  function toJson(results) { return JSON.stringify(results, null, 2) + '\n'; }

  function num(v) { return v === null || v === undefined ? '' : String(v); }

  function toCsv(results) {
    var lines = ['scenario,policy,metric,mean,ci_low,ci_high,sd,n'];
    function row(policy, metric, s) {
      lines.push([results.scenarioId, policy, metric, num(s.mean), num(s.ciLow), num(s.ciHigh), num(s.sd), String(s.n)].join(','));
    }
    results.policies.forEach(function (p) {
      metrics.DAY_KEYS.forEach(function (k) { row(p.id, k, results.summary[p.id][k]); });
    });
    results.policies.forEach(function (p) {
      if (p.id === results.baseline) return;
      metrics.DAY_KEYS.forEach(function (k) { row(p.id + '-minus-' + results.baseline, k, results.paired[p.id][k]); });
    });
    if (results.focusSummary) {
      results.policies.forEach(function (p) {
        var f = results.focusSummary[p.id];
        row(p.id, 'focus_orderSr', f.orderSr);
        row(p.id, 'focus_firstSr', f.firstSr);
        METHODS.forEach(function (m) { row(p.id, 'focus_orderSr_' + m, f.orderSrByMethod[m]); });
        Object.keys(f.share).forEach(function (g) { row(p.id, 'focus_share_' + g, f.share[g]); });
      });
    }
    return lines.join('\n') + '\n';
  }

  function trimNum(x) { return String(Math.round(x * 10) / 10); }

  function feeText(mm) {
    var parts = [];
    if (mm.fixedFee > 0) parts.push('Rs ' + mm.fixedFee);
    if (mm.pctFee > 0) parts.push(mm.pctFee + '%');
    return parts.length ? parts.join(' + ') : 'none';
  }

  function eventText(e) {
    var who = e.target === 'gateway' ? 'Gateway ' + e.id : 'Bank ' + e.id;
    var meths = e.methods.length === 0 ? 'all methods' : e.methods.map(function (m) { return config.METHOD_LABELS[m]; }).join(' and ');
    var s = who + ', ' + meths + ', ' + config.toHHMM(e.start) + ' for ' + e.duration + ' min at ' +
      trimNum(e.srFactor * 100) + '% of normal SR';
    if (e.latencyFactor !== 1) s += ', latency x' + e.latencyFactor;
    if (e.recovery > 0) s += ', recovery ' + e.recovery + ' min';
    if (e.repeatEvery > 0) s += ', repeating every ' + e.repeatEvery + ' min (' + e.repeatCount + ' times)';
    return s;
  }

  function buildMemo(results, options) {
    var generatedOn = options && options.generatedOn;
    if (typeof generatedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(generatedOn)) throw new TypeError('generatedOn must be a YYYY-MM-DD string');
    var cfg = results.config;
    var L = [];
    var labels = config.POLICY_LABELS;
    var seeds = results.seeds;
    L.push('# Routing decision memo: ' + results.title);
    L.push('');
    L.push('Generated by RouteLab ' + results.version + ' on ' + generatedOn + '. Synthetic data and illustrative assumptions; this memo shows how routing strategies behave under the stated model, not what any real gateway would achieve. Not financial advice.');
    L.push('');
    L.push('## Setup');
    L.push(results.preset ? '- Scenario: ' + results.title + ' (' + results.scenarioId + ').' : '- Scenario: custom settings (not an unmodified preset).');
    var mixSum = 0;
    METHODS.forEach(function (m) { mixSum += cfg.traffic.mix[m]; });
    var mix = METHODS.map(function (m) { return config.METHOD_LABELS[m] + ' ' + trimNum(cfg.traffic.mix[m] / mixSum * 100) + '%'; }).join(', ');
    L.push('- Traffic: about ' + format.int(cfg.run.txnPerDay) + ' transactions per simulated day; method mix ' + mix + '; seeds ' +
      seeds[0] + '-' + seeds[seeds.length - 1] + ' (' + seeds.length + ').');
    var gw = cfg.gateways.map(function (g) {
      var sr = [];
      var fees = [];
      METHODS.forEach(function (m) {
        var mm = g.methods[m];
        if (mm) { sr.push(config.METHOD_LABELS[m] + ' ' + format.pct(mm.sr)); fees.push(config.METHOD_LABELS[m] + ' ' + feeText(mm)); }
      });
      return 'Gateway ' + g.id + ' (technical SR: ' + sr.join(', ') + '; fees: ' + fees.join(', ') +
        (g.activeFrom > 0 ? '; live from ' + config.toHHMM(g.activeFrom) : '') + ')';
    });
    L.push('- Gateways: ' + gw.join('; ') + '.');
    L.push('- Events: ' + (cfg.events.length ? cfg.events.map(eventText).join('; ') + '.' : 'none.'));
    L.push('- Retries: up to ' + cfg.retry.maxRetries + ' on ' + (cfg.retry.mode === 'other' ? 'another' : 'the same') + ' gateway after ' +
      cfg.retry.delaySec + ' s; illustrative drop-off model (' + trimNum(cfg.dropoff.base * 100) + '% plus ' +
      trimNum(cfg.dropoff.perSec * 100) + '% per second waited, at most ' + trimNum(cfg.dropoff.max * 100) + '%).');
    L.push('');
    L.push('## Results (mean across seeds, 95% interval)');
    L.push('| Strategy | Order SR | First-attempt SR | Cost per success | Effective fee rate | Time to success p95 | Drop-off | Regret per 1,000 |');
    L.push('|---|---|---|---|---|---|---|---|');
    results.policies.forEach(function (p) {
      var s = results.summary[p.id];
      L.push('| ' + p.label + ' | ' + [
        cell(s.orderSr, format.pct, format.pctNum), cell(s.firstSr, format.pct, format.pctNum),
        cell(s.costPerSuccess, format.rs, format.rsNum), cell(s.feeRatePct, format.two, function (x) { return x.toFixed(2); }),
        cell(s.ttsP95, format.sec, format.secNum), cell(s.dropRate, format.pct, format.pctNum),
        cell(s.regretPer1000, format.one, format.one)].join(' | ') + ' |');
    });
    L.push('');
    var baseLabel = labels[results.baseline];
    L.push('## Compared with ' + baseLabel + ' (paired by seed)');
    L.push('| Strategy | Order SR (pp) | Cost per success (Rs) |');
    L.push('|---|---|---|');
    results.policies.forEach(function (p) {
      if (p.id === results.baseline) return;
      var d = results.paired[p.id];
      L.push('| ' + p.label + ' | ' + [pairedCell(d.orderSr, format.pp), pairedCell(d.costPerSuccess, format.rsDiff)].join(' | ') + ' |');
    });
    L.push('');
    L.push('## Reading');
    var cand = results.policies.filter(function (p) { return !p.reference; });
    var hi = null;
    var lo = null;
    cand.forEach(function (p) {
      var s = results.summary[p.id];
      if (s.orderSr.mean !== null && (hi === null || s.orderSr.mean > results.summary[hi].orderSr.mean)) hi = p.id;
      if (s.costPerSuccess.mean !== null && (lo === null || s.costPerSuccess.mean < results.summary[lo].costPerSuccess.mean)) lo = p.id;
    });
    if (hi !== null) {
      var line = '- Highest order SR: ' + labels[hi] + ' (' + (results.summary[hi].orderSr.mean * 100).toFixed(2) + '%).';
      if (hi === results.baseline) line += ' It is the baseline.';
      else {
        var pd = results.paired[hi] && results.paired[hi].orderSr;
        if (pd && pd.ciLow !== null && pd.ciLow > 0) line += ' Its gain over ' + baseLabel + ' is ' + format.pp(pd.mean) + ' pp (95% CI ' + format.pp(pd.ciLow) + ' to ' + format.pp(pd.ciHigh) + ').';
        else line += ' On these seeds it cannot be told apart from ' + baseLabel + '.';
      }
      L.push(line);
    }
    if (lo !== null) L.push('- Lowest cost per success: ' + labels[lo] + ' (Rs ' + results.summary[lo].costPerSuccess.mean.toFixed(2) + ').');
    if (hi !== null && lo !== null) {
      if (hi !== lo) {
        L.push('- Trade-off: ' + labels[hi] + ' has ' + ((results.summary[hi].orderSr.mean - results.summary[lo].orderSr.mean) * 100).toFixed(2) +
          ' pp higher order SR and Rs ' + (results.summary[hi].costPerSuccess.mean - results.summary[lo].costPerSuccess.mean).toFixed(2) +
          ' higher cost per success than ' + labels[lo] + '.');
      } else L.push('- The same strategy is best on both.');
    }
    if (results.preset) {
      var held = results.expectations ? results.expectations.filter(function (e) { return e.held === true; }).length : 0;
      var all = results.expectations ? results.expectations.length : 0;
      L.push('- Expected for this scenario: ' + results.expectationText + ' On these seeds ' + held + ' of ' + all + ' checks held.');
    } else L.push('- Custom settings: no documented expectation applies.');
    L.push('');
    L.push('## Caveats');
    L.push('- Synthetic traffic and illustrative parameters (docs/MODEL.md lists every assumption and its source).');
    L.push('- Each strategy ran in its own simulated world on identical traffic; in production, strategies tested side by side share gateways, so validate a routing change with a controlled experiment such as a switchback test, with guardrails on cost, latency and duplicate charges.');
    L.push('- Intervals describe simulation noise under these assumptions only.');
    L.push('- Not financial advice.');
    return L.join('\n') + '\n';
  }

  return { format: format, cell: cell, pairedCell: pairedCell, toJson: toJson, toCsv: toCsv, buildMemo: buildMemo };
});
