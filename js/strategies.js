(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { prng: require('./prng.js'), config: require('./config.js'), model: require('./model.js') }
    : { prng: root.RouteLab.prng, config: root.RouteLab.config, model: root.RouteLab.model };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.strategies = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var prng = deps.prng;
  var config = deps.config;
  var model = deps.model;
  var METHODS = config.METHODS;

  // ------------------------------------------------------------------ memories (SPEC 4.5)
  function createMemory(kind, minutes) {
    var cells = {};
    function cell(key) {
      var c = cells[key];
      if (!c) { c = { a: 0, b: 0, tLast: undefined, q: [], head: 0 }; cells[key] = c; }
      return c;
    }
    function read(key, t) {
      var c = cell(key);
      if (kind === 'discount') {
        if (c.tLast === undefined) c.tLast = t;
        var f = Math.pow(2, -(t - c.tLast) / minutes);
        c.a *= f;
        c.b *= f;
        c.tLast = t;
      } else if (kind === 'window') {
        var q = c.q;
        while (c.head < q.length && q[c.head][0] <= t - minutes) {
          var o = q[c.head++];
          c.a -= o[1];
          c.b -= 1 - o[1];
        }
        if (c.head > 64 && c.head * 2 > q.length) { c.q = q.slice(c.head); c.head = 0; }
      }
      return { a: c.a, b: c.b };
    }
    function update(key, r, t) {
      read(key, t);
      var c = cell(key);
      c.a += r;
      c.b += 1 - r;
      if (kind === 'window') c.q.push([t, r]);
    }
    return { read: read, update: update };
  }

  function scoreThompson(thetas, fees, lambda) {
    var scores = [];
    var best = 0;
    for (var i = 0; i < thetas.length; i++) {
      scores.push(thetas[i] - lambda * fees[i]);
      if (scores[i] > scores[best]) best = i;
    }
    return { scores: scores, index: best };
  }

  function rankOf(cfg) {
    var pri = cfg.strategies.static.priority;
    var byIndex = [];
    for (var g = 0; g < cfg.gateways.length; g++) byIndex.push(pri.indexOf(cfg.gateways[g].id));
    return function (g) { return byIndex[g]; };
  }

  function rank(cfg, g) { return rankOf(cfg)(g); }

  function create(cfg, policyId, seed) {
    var rk = rankOf(cfg);
    var gid = cfg.gateways.map(function (g) { return g.id; });
    var S = cfg.strategies;
    var pri = S.static.priority.map(function (id) { return gid.indexOf(id); });

    function staticChoose(el) {
      for (var i = 0; i < pri.length; i++) if (el.indexOf(pri[i]) >= 0) return pri[i];
      return el[0];
    }

    if (policyId === 'static') return { choose: function (ctx, el) { return staticChoose(el); }, update: function () {} };

    if (policyId === 'oracle') {
      var pm = model.prepare(cfg);
      return {
        choose: function (ctx, el) {
          var best = -1;
          var bq = -Infinity;
          for (var i = 0; i < el.length; i++) {
            var qq = pm.q(el[i], ctx.method, ctx.t);
            if (qq > bq || (qq === bq && rk(el[i]) < rk(best))) { bq = qq; best = el[i]; }
          }
          return best;
        },
        update: function () {}
      };
    }

    var rng = prng.stream(seed, 'strategy:' + policyId);

    if (policyId === 'weighted') {
      var W = cfg.gateways.map(function (g) { return S.weighted.weights[g.id] || 0; });
      return {
        choose: function (ctx, el) {
          var ws = [];
          var tot = 0;
          for (var i = 0; i < el.length; i++) { ws.push(W[el[i]]); tot += W[el[i]]; }
          if (tot <= 0) return staticChoose(el);
          return el[prng.weightedIndex(rng, ws)];
        },
        update: function () {}
      };
    }

    if (policyId === 'rules') {
      var rules = S.rules.rules.map(function (r) {
        return { method: r.method, min: r.minAmount, max: r.maxAmount, g: gid.indexOf(r.gateway) };
      });
      return {
        choose: function (ctx, el) {
          var mname = METHODS[ctx.method];
          for (var i = 0; i < rules.length; i++) {
            var r = rules[i];
            if ((r.method === 'any' || r.method === mname) && ctx.amount >= r.min && (r.max === null || ctx.amount < r.max) && el.indexOf(r.g) >= 0) return r.g;
          }
          return staticChoose(el);
        },
        update: function () {}
      };
    }

    var conf = S[policyId];
    var mem = createMemory(conf.memory.kind, conf.memory.minutes);
    function key(m, g) { return m * 8 + g; }
    var upd = function (m, g, r, t) { mem.update(key(m, g), r, t); };

    if (policyId === 'egreedy') {
      return {
        choose: function (ctx, el) {
          var u = rng();
          if (u < conf.epsilon) return el[Math.floor(rng() * el.length)];
          var best = -1;
          var be = -Infinity;
          for (var i = 0; i < el.length; i++) {
            var s = mem.read(key(ctx.method, el[i]), ctx.t);
            var n = s.a + s.b;
            var est = n > 1e-12 ? s.a / n : 1.0;
            if (est > be || (est === be && rk(el[i]) < rk(best))) { be = est; best = el[i]; }
          }
          return best;
        },
        update: upd
      };
    }

    if (policyId === 'thompson' || policyId === 'thompson_cost') {
      var lam = policyId === 'thompson_cost' ? conf.lambda : 0;
      var cost = policyId === 'thompson_cost';
      var pm2 = cost ? model.prepare(cfg) : null;
      return {
        choose: function (ctx, el) {
          var best = -1;
          var bs = -Infinity;
          for (var i = 0; i < el.length; i++) {
            var g = el[i];
            var s = mem.read(key(ctx.method, g), ctx.t);
            var theta = prng.beta(rng, 1 + s.a, 1 + s.b);
            var score = cost ? theta - lam * pm2.fee(g, ctx.method, ctx.amount) : theta;
            if (best < 0 || score > bs || (score === bs && rk(g) < rk(best))) { bs = score; best = g; }
          }
          return best;
        },
        update: upd
      };
    }
    throw new RangeError('unknown policy: ' + policyId);
  }

  return { create: create, createMemory: createMemory, scoreThompson: scoreThompson, rank: rank };
});
