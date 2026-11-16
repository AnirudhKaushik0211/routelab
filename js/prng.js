(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var api = factory();
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.prng = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }

  function deriveSeed(seed, label) { return fnv1a(String(seed) + ':' + label); }
  function stream(seed, label) { return mulberry32(deriveSeed(seed, label)); }

  function normal(rng) {
    var u1 = rng();
    var u2 = rng();
    return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
  }

  function weightedIndex(rng, weights) {
    var total = 0;
    var i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var u = rng() * total;
    var c = 0;
    for (i = 0; i < weights.length; i++) {
      c += weights[i];
      if (u < c) return i;
    }
    return weights.length - 1;
  }

  function poissonSmall(rng, lambda) {
    var L = Math.exp(-lambda);
    var k = 0;
    var p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }

  function poisson(rng, lambda) {
    var k = 0;
    while (lambda > 30) { k += poissonSmall(rng, 30); lambda -= 30; }
    return k + poissonSmall(rng, lambda);
  }

  function gamma(rng, a) {
    if (!(a >= 1)) throw new RangeError('gamma shape must be >= 1');
    var d = a - 1 / 3;
    var c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var z = normal(rng);
      var v = 1 + c * z;
      if (v <= 0) continue;
      v = v * v * v;
      var u = rng();
      if (u < 1 - 0.0331 * z * z * z * z) return d * v;
      if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  function beta(rng, a, b) {
    var x = gamma(rng, a);
    var y = gamma(rng, b);
    return x / (x + y);
  }

  return {
    mulberry32: mulberry32, fnv1a: fnv1a, deriveSeed: deriveSeed, stream: stream, normal: normal,
    weightedIndex: weightedIndex, poissonSmall: poissonSmall, poisson: poisson, gamma: gamma, beta: beta
  };
});
