(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var api = factory();
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.stats = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var T_TABLE = [12.7062, 4.3027, 3.1824, 2.7764, 2.5706, 2.4469, 2.3646, 2.3060, 2.2622, 2.2281, 2.2010, 2.1788,
    2.1604, 2.1448, 2.1314, 2.1199, 2.1098, 2.1009, 2.0930, 2.0860, 2.0796, 2.0739, 2.0687, 2.0639, 2.0595, 2.0555,
    2.0518, 2.0484, 2.0452, 2.0423];
  var Z975 = 1.959963984540054;

  function tExpansion(df) {
    var z = Z975;
    var z3 = z * z * z;
    var z5 = z3 * z * z;
    var z7 = z5 * z * z;
    var z9 = z7 * z * z;
    var g1 = (z3 + z) / 4;
    var g2 = (5 * z5 + 16 * z3 + 3 * z) / 96;
    var g3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / 384;
    var g4 = (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / 92160;
    return z + g1 / df + g2 / (df * df) + g3 / (df * df * df) + g4 / (df * df * df * df);
  }

  function t975(df) {
    if (df >= 1 && df <= 30) return T_TABLE[df - 1];
    return tExpansion(df);
  }

  function mean(x) {
    var s = 0;
    for (var i = 0; i < x.length; i++) s += x[i];
    return s / x.length;
  }

  function sd(x) {
    if (x.length < 2) return null;
    var m = mean(x);
    var s = 0;
    for (var i = 0; i < x.length; i++) s += (x[i] - m) * (x[i] - m);
    return Math.sqrt(s / (x.length - 1));
  }

  function summarise(values) {
    var x = [];
    for (var i = 0; i < values.length; i++) if (values[i] !== null && values[i] !== undefined) x.push(values[i]);
    var n = x.length;
    if (n === 0) return { mean: null, sd: null, ciLow: null, ciHigh: null, n: 0 };
    var m = mean(x);
    if (n < 2) return { mean: m, sd: null, ciLow: null, ciHigh: null, n: n };
    var s = sd(x);
    var half = t975(n - 1) * s / Math.sqrt(n);
    return { mean: m, sd: s, ciLow: m - half, ciHigh: m + half, n: n };
  }

  function tInterval(values) { return summarise(values); }

  // d_i = a_i - b_i over indices where both are non-null.
  function differences(a, b) {
    var d = [];
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) {
      if (a[i] === null || a[i] === undefined || b[i] === null || b[i] === undefined) continue;
      d.push(a[i] - b[i]);
    }
    return d;
  }

  function paired(a, b) { return summarise(differences(a, b)); }

  function percentile(sorted, p) {
    var n = sorted.length;
    if (n === 0) return null;
    var idx = Math.ceil(p * n) - 1;
    if (idx < 0) idx = 0;
    if (idx > n - 1) idx = n - 1;
    return sorted[idx];
  }

  return { t975: t975, mean: mean, sd: sd, summarise: summarise, tInterval: tInterval, differences: differences,
    paired: paired, percentile: percentile };
});
