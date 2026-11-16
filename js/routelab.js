(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? {
    prng: require('./prng.js'), stats: require('./stats.js'), config: require('./config.js'),
    scenarios: require('./scenarios.js'), traffic: require('./traffic.js'), model: require('./model.js'),
    strategies: require('./strategies.js'), engine: require('./engine.js'), metrics: require('./metrics.js'),
    memo: require('./memo.js'), state: require('./state.js'), charts: require('./charts.js')
  } : {
    prng: root.RouteLab.prng, stats: root.RouteLab.stats, config: root.RouteLab.config,
    scenarios: root.RouteLab.scenarios, traffic: root.RouteLab.traffic, model: root.RouteLab.model,
    strategies: root.RouteLab.strategies, engine: root.RouteLab.engine, metrics: root.RouteLab.metrics,
    memo: root.RouteLab.memo, state: root.RouteLab.state, charts: root.RouteLab.charts
  };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else {
    root.RouteLab = root.RouteLab || {};
    root.RouteLab.api = api;
    Object.keys(api).forEach(function (k) { root.RouteLab[k] = api[k]; });
  }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var config = deps.config;
  var scn = deps.scenarios;
  var metrics = deps.metrics;
  var VERSION = '1.0.0';
  var CSP_META = true;

  function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }

  function validateConfig(input) { return config.validateConfig(input); }

  function getScenario(id) { return scn.getScenario(id); }

  function createRunner(input, options) {
    options = options || {};
    var v = config.validateConfig(input);
    if (!v.ok) throw new TypeError('invalid config: ' + v.errors[0].path + ': ' + v.errors[0].message);
    var cfg = v.config;
    if (options.seeds !== undefined) {
      if (!(isInt(options.seeds) && options.seeds >= 1 && options.seeds <= 100)) throw new RangeError('seeds must be a whole number from 1 to 100');
      cfg.run.seeds = options.seeds;
    }
    if (options.seedStart !== undefined) {
      if (!(isInt(options.seedStart) && options.seedStart >= 0 && options.seedStart <= 4294967295 - cfg.run.seeds)) throw new RangeError('seedStart must be a whole number from 0 to ' + (4294967295 - cfg.run.seeds));
      cfg.run.seedStart = options.seedStart;
    }
    if (cfg.run.seedStart > 4294967295 - cfg.run.seeds) throw new RangeError('seedStart is too large for the number of seeds');
    var polIds = config.POLICY_IDS.filter(function (p) { return p === 'oracle' || cfg.strategies[p].enabled; });
    var seeds = [];
    for (var s = 0; s < cfg.run.seeds; s++) seeds.push(cfg.run.seedStart + s);
    var total = seeds.length * polIds.length;
    var runsBy = {};
    polIds.forEach(function (p) { runsBy[p] = []; });
    var done = 0;
    var tr = null;
    var meta = { scenarioId: 'custom', preset: false, title: 'Custom settings', expectationText: null, expectations: null };
    var sid = options.scenarioId;
    if (typeof sid === 'string' && Object.prototype.hasOwnProperty.call(scn.byId, sid)) {
      var preset = scn.getScenario(sid);
      if (config.presetKey(preset) === config.presetKey(cfg)) {
        var sc = scn.byId[sid];
        meta = { scenarioId: sid, preset: true, title: sc.title, expectationText: sc.expectationText, expectations: sc.expectations };
      }
    }
    return {
      total: total,
      get done() { return done; },
      isDone: function () { return done >= total; },
      step: function () {
        if (done >= total) return true;
        var si = Math.floor(done / polIds.length);
        var pi = done % polIds.length;
        if (pi === 0) tr = deps.traffic.generate(cfg, seeds[si]);
        runsBy[polIds[pi]].push(deps.engine.runPolicy(cfg, tr, polIds[pi], seeds[si]));
        done++;
        if (pi === polIds.length - 1) tr = null;
        return done >= total;
      },
      result: function () {
        if (done < total) throw new Error('runner not finished');
        return metrics.aggregate(cfg, runsBy, seeds, meta);
      },
      runs: function () { return runsBy; },
      config: function () { return config.clone(cfg); }
    };
  }

  function simulate(input, options) {
    var r = createRunner(input, options);
    while (!r.isDone()) r.step();
    return r.result();
  }

  var api = {
    VERSION: VERSION, CSP_META: CSP_META,
    METHODS: config.METHODS, METHOD_LABELS: config.METHOD_LABELS, STRATEGY_IDS: config.STRATEGY_IDS,
    POLICY_IDS: config.POLICY_IDS, POLICY_LABELS: config.POLICY_LABELS, REASONS: config.REASONS,
    REASON_LABELS: config.REASON_LABELS, GATEWAY_IDS: config.GATEWAY_IDS, BANK_IDS: config.BANK_IDS,
    scenarios: scn.list(), RESULTS_SEEDS: scn.RESULTS_SEEDS, ROBUST_SEEDS: scn.ROBUST_SEEDS,
    getScenario: getScenario, validateConfig: validateConfig, createRunner: createRunner, simulate: simulate,
    toJson: deps.memo.toJson, toCsv: deps.memo.toCsv, buildMemo: deps.memo.buildMemo,
    encodeState: deps.state.encodeState, decodeState: deps.state.decodeState, charts: deps.charts,
    prng: deps.prng, stats: deps.stats, config: config, model: deps.model, strategies: deps.strategies,
    engine: deps.engine, metrics: metrics, traffic: deps.traffic, memo: deps.memo, state: deps.state,
    scenariosData: scn
  };
  return api;
});
