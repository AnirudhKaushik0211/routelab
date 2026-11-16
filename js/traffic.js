(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { prng: require('./prng.js'), config: require('./config.js') }
    : { prng: root.RouteLab.prng, config: root.RouteLab.config };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.traffic = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var prng = deps.prng;
  var config = deps.config;
  var METHODS = config.METHODS;

  function lnParams(p50, p95) {
    var mu = Math.log(p50);
    return { mu: mu, sigma: (Math.log(p95) - mu) / config.Z95 };
  }

  // generate(config, seed, { rngFactory }) -> traffic object (SPEC 3.4). 22 draws per transaction.
  function generate(cfg, seed, options) {
    var factory = (options && options.rngFactory) || prng.stream;
    var rng = factory(seed, 'traffic');
    var hourly = cfg.traffic.hourly;
    var sw = 0;
    var i;
    for (i = 0; i < 24; i++) sw += hourly[i];
    var mix = METHODS.map(function (m) { return cfg.traffic.mix[m]; });
    var am = METHODS.map(function (m) { return lnParams(cfg.traffic.amount[m].p50, cfg.traffic.amount[m].p95); });
    var bankShares = cfg.traffic.banks.map(function (b) { return b.share; });
    var decline = METHODS.map(function (m) { return cfg.traffic.customerDecline[m]; });
    var perDay = cfg.run.txnPerDay;

    var cap = Math.ceil(perDay * 1.3) + 1000;
    var T = new Float64Array(cap);
    var M = new Uint8Array(cap);
    var A = new Float64Array(cap);
    var B = new Uint8Array(cap);
    var C = new Uint8Array(cap);
    var US = new Float64Array(4 * cap);
    var Z = new Float64Array(4 * cap);
    var UD = new Float64Array(4 * cap);
    var n = 0;

    function grow() {
      var c2 = cap * 2;
      function g64(a, k) { var b = new Float64Array(c2 * k); b.set(a); return b; }
      function g8(a) { var b = new Uint8Array(c2); b.set(a); return b; }
      T = g64(T, 1); A = g64(A, 1); US = g64(US, 4); Z = g64(Z, 4); UD = g64(UD, 4); M = g8(M); B = g8(B); C = g8(C);
      cap = c2;
    }
    function swapRows(a, b) {
      var x = T[a]; T[a] = T[b]; T[b] = x;
      var y = M[a]; M[a] = M[b]; M[b] = y;
      x = A[a]; A[a] = A[b]; A[b] = x;
      y = B[a]; B[a] = B[b]; B[b] = y;
      y = C[a]; C[a] = C[b]; C[b] = y;
      for (var k = 0; k < 4; k++) {
        x = US[4 * a + k]; US[4 * a + k] = US[4 * b + k]; US[4 * b + k] = x;
        x = Z[4 * a + k]; Z[4 * a + k] = Z[4 * b + k]; Z[4 * b + k] = x;
        x = UD[4 * a + k]; UD[4 * a + k] = UD[4 * b + k]; UD[4 * b + k] = x;
      }
    }

    for (var minute = 0; minute < 1440; minute++) {
      var lambda = perDay * hourly[Math.floor(minute / 60)] / (60 * sw);
      var count = prng.poisson(rng, lambda);
      var s0 = n;
      for (var c = 0; c < count; c++) {
        if (n >= cap) grow();
        T[n] = minute + rng();
        var mi = prng.weightedIndex(rng, mix);
        M[n] = mi;
        var zAmt = prng.normal(rng);
        var amt = Math.round(Math.exp(am[mi].mu + am[mi].sigma * zAmt) * 100) / 100;
        A[n] = amt < 1 ? 1 : (amt > 200000 ? 200000 : amt);
        B[n] = prng.weightedIndex(rng, bankShares);
        C[n] = rng() < decline[mi] ? 1 : 0;
        for (var k = 0; k < 4; k++) {
          US[4 * n + k] = rng();
          Z[4 * n + k] = prng.normal(rng);
          UD[4 * n + k] = rng();
        }
        n++;
      }
      // stable insertion sort of this minute's batch by arrival time
      for (var a = s0 + 1; a < n; a++) {
        for (var b = a; b > s0 && T[b - 1] > T[b]; b--) swapRows(b - 1, b);
      }
    }
    return { n: n, t: T.slice(0, n), method: M.slice(0, n), amount: A.slice(0, n), bank: B.slice(0, n),
      customer: C.slice(0, n), uS: US.slice(0, 4 * n), z: Z.slice(0, 4 * n), uD: UD.slice(0, 4 * n) };
  }

  return { generate: generate };
});
