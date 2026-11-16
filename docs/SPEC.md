# RouteLab: clean-room build spec

Version 1.0 for app version 1.0.0. Companions: [PRD.md](PRD.md) (what and why) and [MODEL.md](MODEL.md) (assumptions, formulas, sources, limitations).

This is a clean-room functional and technical description. Everything in it comes from public descriptions of payments concepts and routing approaches, standard statistics and simulation practice (section 13) and general web-platform knowledge. All gateways, banks, merchants and transactions are synthetic. An implementer should be able to build the app, library, CLI, tests, scripts and documents from this document alone, without making architectural decisions. MUST means required. Where a value is given, use that value.

Fixed before any measurement, and never changed to fit a result: the performance budget (section 9), the scenario expectations and their thresholds (section 6.4) and the seed sets (section 6.5). If an expectation does not hold after the implementation has been checked against this document, that is reported as a finding in the build report; the threshold is not loosened.

Design-phase pilot. While writing this document, a throwaway prototype of sections 3 and 4 was run on the pilot seeds 501-520 (section 6.5), which are disjoint from the results and robustness seeds, only to check that each expectation is a robust effect and to choose thresholds with a margin (each threshold is at most about half of the pilot effect, or a sign check). The prototype was not timed. Its outputs are listed in section 6.6 as reference values. The prototype is kept in the owner's private task folder and is not part of the repository.

## 1. Goals and constraints

- A static, browser-only single page: `index.html` + CSS + plain JavaScript. No server, no build step, zero runtime dependencies, no network requests, no analytics, no cookies, no external fonts or CDNs.
- Works from GitHub Pages (https) and offline by double-clicking `index.html` (file://) in current Edge, Chrome and Firefox.
- The simulation core is pure JavaScript shared by the browser, the Node library, the CLI, the tests and the results generator (same files, no copies).
- Node.js 22 or newer for development tooling and the CLI. Node built-ins only. No npm packages, ever.
- Reproducibility: the same normalised configuration and seeds give byte-identical results JSON (section 5.7).
- Synthetic only: gateways "Gateway A" to "Gateway E", banks "Bank X", "Bank Y", "Bank Z"; names are fixed and cannot be edited. No real company is a simulated entity. Real names appear only in citations in README, PRD, SPEC and MODEL (enforced by the brand self-scan, section 11.4).
- Honesty: every default is sourced or labelled illustrative (MODEL.md section 9); the app, README and memo state that results show mechanisms under assumptions, not real-world success rates, and are not financial advice. No usage claims in the README.
- Clean room: no personal names, no employers, no internal tool names, no absolute local paths in any repository file. Enforced by the deny-list scan (section 11.3).

## 2. Architecture

### 2.1 File layout (project root `routelab/`)

```
index.html                 the app (static markup for all tabs)
.nojekyll                  empty; stops GitHub Pages running Jekyll
.gitignore
LICENSE                    MIT, holder "<your name>"
README.md
package.json               private, no dependencies, npm-script aliases only
css/app.css
js/prng.js                 mulberry32, FNV-1a, seed derivation, normal, gamma, beta, Poisson (UMD, pure)
js/stats.js                mean, sd, t quantile, t interval, paired differences, nearest-rank percentile (UMD, pure)
js/config.js               constants, labels, defaults, validation and normalisation, canonical JSON, config hash (UMD, pure)
js/scenarios.js            the 7 presets, their stories, focus windows, expectations and headlines (UMD, data)
js/traffic.js              seeded traffic generation (UMD, pure)
js/model.js                event severity, effective probabilities, latency, fees (UMD, pure)
js/strategies.js           routing strategies and memories (UMD, pure)
js/engine.js               discrete-event simulation of one policy on one traffic (UMD, pure)
js/metrics.js              per-run metrics, aggregation across seeds, windows, expectations (UMD, pure)
js/memo.js                 Markdown memo, CSV, JSON (UMD, pure)
js/state.js                URL-hash encode and decode (UMD, pure)
js/charts.js               SVG chart trees as plain objects (UMD, pure)
js/routelab.js             public API (UMD, pure)
js/ui.js                   DOM wiring, rendering, run loop, storage, downloads, clipboard (browser only)
scripts/simulate.cjs       CLI (section 7.4)
scripts/results.cjs        RESULTS.md + results.json generator (section 7.5)
scripts/bench.cjs          Node performance measurement (section 9)
scripts/bench-browser.cjs  browser performance measurement (section 9)
scripts/serve.cjs          static file server for tests (127.0.0.1 only)
scripts/browser.cjs        headless drivers: Edge via CDP, Firefox via WebDriver BiDi
scripts/ui-smoke.cjs       browser smoke test (section 10.3)
scripts/capture-screenshots.cjs  README screenshots (section 10.5)
scripts/denylist.cjs       deny-list scanner (module + CLI)
scripts/selfscan.cjs       brand and identifier self-scan (module + CLI, section 11.4)
scripts/brands.json        real payments brand names that must not appear outside citation files
scripts/zip.cjs            minimal zip writer and reader (zlib deflate-raw, own CRC-32)
scripts/package-public.cjs public package builder (section 11)
test/*.test.cjs            Node built-in test runner files (section 10.1)
docs/PRD.md  docs/SPEC.md  docs/MODEL.md  docs/RESULTS.md  docs/CASE-STUDY.md
docs/results.json          generated, deterministic (section 7.5)
docs/screenshot-*.png      generated by capture-screenshots.cjs
```

Not in the repository: `dist/` (packages, logs, benchmark outputs) and `.denylist.local` (the owner's private terms). Both are in `.gitignore`.

### 2.2 package.json (exact content apart from formatting)

```json
{
  "name": "routelab",
  "version": "1.0.0",
  "private": true,
  "description": "Browser-only payment-routing and success-rate simulator for UPI and card traffic on synthetic data: static, weighted, rule-based and bandit routers compared on the same seeded traffic.",
  "license": "MIT",
  "type": "commonjs",
  "scripts": {
    "test": "node --test \"test/**/*.test.cjs\"",
    "simulate": "node scripts/simulate.cjs",
    "results": "node scripts/results.cjs",
    "bench": "node scripts/bench.cjs",
    "bench:browser": "node scripts/bench-browser.cjs",
    "smoke": "node scripts/ui-smoke.cjs",
    "screenshots": "node scripts/capture-screenshots.cjs",
    "package": "node scripts/package-public.cjs --require-local"
  }
}
```

`"type": "commonjs"` is required so Node loads `js/*.js` as CommonJS. Never add `"type": "module"`.

### 2.3 Decision: classic scripts with a UMD wrapper, not ES modules

Browsers load ES modules in CORS mode; from a file:// page the origin is opaque, so Chromium-based browsers refuse module scripts loaded from disk, which breaks double-click use. Web Workers have the same problem (a worker script from file:// does not start in Chromium), so the simulation runs on the main thread in time slices (section 8.12). Classic `<script src>` files load from file:// in Edge, Chrome and Firefox. So:

- `index.html` loads, in this order, each with `defer`: `js/prng.js`, `js/stats.js`, `js/config.js`, `js/scenarios.js`, `js/traffic.js`, `js/model.js`, `js/strategies.js`, `js/engine.js`, `js/metrics.js`, `js/memo.js`, `js/state.js`, `js/charts.js`, `js/routelab.js`, `js/ui.js`.
- No `type="module"`, no `import`/`export`, no dynamic `import()`, no `fetch`/`XMLHttpRequest`, no `Worker`.
- Each shared file uses this wrapper (dependencies from `require` in Node, from the global namespace in the browser):

```js
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode
    ? { prng: require('./prng.js'), config: require('./config.js') }
    : { prng: root.RouteLab.prng, config: root.RouteLab.config };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.traffic = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  // pure functions only; no DOM, no clock, no Math.random
  return { /* public API */ };
});
```

Namespaces and dependencies (a module may use only the ones listed; `deps` lists exactly these):

| Module | Namespace | Depends on |
|---|---|---|
| prng | `RouteLab.prng` | none |
| stats | `RouteLab.stats` | none |
| config | `RouteLab.config` | prng (FNV-1a for the config hash) |
| scenarios | `RouteLab.scenarios` | config |
| traffic | `RouteLab.traffic` | prng, config |
| model | `RouteLab.model` | config |
| strategies | `RouteLab.strategies` | prng, config, model |
| engine | `RouteLab.engine` | config, model, strategies |
| metrics | `RouteLab.metrics` | stats, config |
| memo | `RouteLab.memo` | config, metrics |
| state | `RouteLab.state` | config |
| charts | `RouteLab.charts` | config |
| routelab | `RouteLab.api`; its members are also copied onto `RouteLab` itself (section 7.1) | all of the above |
| ui | (none exported) | `RouteLab` |

- Syntax: ES2018. Do not use optional chaining `?.`, nullish coalescing `??`, optional catch binding (`catch {`), `String.prototype.matchAll`, BigInt literals, class fields, top-level await or template literals (string concatenation only in `js/`). Node-only scripts under `scripts/` may use newer syntax.
- Pure modules (everything except `ui.js`) MUST NOT use `Math.random`, `Date`, `performance`, `console`, `window`, `document` or `localStorage` in code (checked by `static.test.cjs`, section 10.1). All randomness comes from `prng.js` streams; all timing is done by `ui.js` and the scripts.
- Typed arrays (`Float64Array`, `Int32Array`, `Uint8Array`) are allowed and recommended for traffic and counters.

### 2.4 Content Security Policy

`index.html` has this meta tag as the first element in `<head>` after `<meta charset="utf-8">`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' file:; style-src 'self' file:; img-src 'self' data: blob: file:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
```

- No inline `<script>`, no `on*=` attributes, no `style="..."` attributes (setting styles via CSSOM and SVG presentation attributes such as `stroke` and `fill` set with `setAttribute` is fine).
- Downloads use `Blob` + `URL.createObjectURL` + a temporary `<a download>` click (section 8.10); this is not a network request.
- Deterministic fallback: if, and only if, the smoke test shows that this CSP blocks the app's own scripts or stylesheet under file:// in either browser, remove the meta tag and set `CSP_META = false` in `js/routelab.js` in the same change; record it in the report. Do not try other variants.
- `CSP_META = true` exported from `js/routelab.js`. `static.test.cjs`: if true, the tag is present and equals the one above exactly; otherwise no CSP meta tag exists.
- Privacy sentence (README "Privacy" and Help "Privacy"): if `CSP_META`, "No network requests (blocked by a Content Security Policy and checked by automated tests)."; otherwise "No network requests (the code makes none, which automated tests check)." `static.test.cjs` asserts `index.html` contains the matching sentence and not the other.

### 2.5 Data flow in the page

1. The UI holds one in-memory configuration object (section 3.2), the id of the last loaded preset, and the last results object.
2. Every user edit in Configure updates the configuration, runs `validateConfig` and shows field errors (section 8.7). The URL hash is rewritten (debounced 400 ms) with the configuration, valid or not, so a link never loses edits; an invalid configuration in a link is reported when the link is opened.
3. Run (section 8.12) validates, snapshots the normalised configuration, creates a runner (section 7.1) and steps it in time slices, then aggregates, renders the Results tab and rewrites the hash.
4. Nothing is stored except the help-seen flag (section 8.11).

### 2.6 Determinism rules

- Only `prng.js` generates random numbers. Each stream is created from `deriveSeed(seed, label)` (section 3.4) and consumed in the order this document defines. A stream is never shared between policies.
- Iteration over gateways is always in configuration order (A, B, C, ...); over methods in `METHODS` order; over policies in `POLICY_IDS` order (section 3.2).
- No `Object.keys` order dependence on user-supplied keys: normalisation rebuilds every object with keys in the order of section 3.2.
- Floating-point: all arithmetic in IEEE double; no `Math.fround`; `Math.round(x * 1e6) / 1e6` only when writing results (section 5.7).

## 3. Simulation model (normative)

MODEL.md explains the reasoning; this section is the contract.

### 3.1 Time and units

- Simulated time `t` is a float in minutes since 00:00 of the simulated day. Arrivals are in `[0, 1440)`. Attempts and completions may run past 1440; the run continues until every transaction has ended.
- Latency is in milliseconds; elapsed customer time in seconds; amounts and fees in rupees (floats); success rates and probabilities as fractions in `[0, 1]` (the UI shows percent).
- Buckets: 96 buckets of 15 minutes by arrival time, `bucket = floor(arrivalT / 15)`.

### 3.2 Configuration (normalised form)

Constants in `config.js`:

```js
METHODS = ['upi_intent', 'upi_collect', 'card', 'netbanking'];
METHOD_LABELS = { upi_intent: 'UPI intent', upi_collect: 'UPI collect', card: 'Card', netbanking: 'Netbanking' };
GATEWAY_IDS = ['A', 'B', 'C', 'D', 'E'];            // label 'Gateway ' + id
BANK_IDS = ['X', 'Y', 'Z'];                           // label 'Bank ' + id
STRATEGY_IDS = ['static', 'weighted', 'rules', 'egreedy', 'thompson', 'thompson_cost'];
POLICY_IDS = STRATEGY_IDS.concat(['oracle']);
POLICY_LABELS = { static: 'Static priority', weighted: 'Weighted split', rules: 'Rule-based',
  egreedy: 'Epsilon-greedy', thompson: 'Thompson sampling', thompson_cost: 'Cost-aware Thompson',
  oracle: 'Oracle (reference)' };
REASONS = ['success', 'customer', 'technical', 'rate_limited', 'no_route', 'dropped'];
REASON_LABELS = { success: 'Paid', customer: 'Customer-side decline', technical: 'Technical decline',
  rate_limited: 'Rate limited', no_route: 'No gateway left', dropped: 'Gave up before retry' };
MAX_ATTEMPTS = 4;  BUCKET_MINUTES = 15;  BUCKETS = 96;  DAY_MINUTES = 1440;
Z95 = 1.6448536269514722;
```

Normalised configuration, keys in exactly this order (the example is the `peak-outage` preset, abbreviated with `...`):

```json
{
  "v": 1,
  "run": { "seeds": 20, "seedStart": 1, "txnPerDay": 10000 },
  "traffic": {
    "hourly": [0.25, 0.15, 0.1, 0.1, 0.1, 0.15, 0.3, 0.55, 0.8, 1, 1.1, 1.15, 1.25, 1.2, 1.1, 1.05, 1.05, 1.15, 1.4, 1.8, 2, 1.9, 1.4, 0.7],
    "mix": { "upi_intent": 55, "upi_collect": 10, "card": 25, "netbanking": 10 },
    "customerDecline": { "upi_intent": 0.05, "upi_collect": 0.18, "card": 0.07, "netbanking": 0.1 },
    "amount": { "upi_intent": { "p50": 300, "p95": 3000 }, "upi_collect": { "p50": 500, "p95": 5000 },
                "card": { "p50": 1500, "p95": 10000 }, "netbanking": { "p50": 2000, "p95": 15000 } },
    "banks": [ { "id": "X", "share": 40, "srFactor": 1 }, { "id": "Y", "share": 35, "srFactor": 1 }, { "id": "Z", "share": 25, "srFactor": 1 } ]
  },
  "gateways": [
    { "id": "A", "activeFrom": 0, "capacityTpm": null,
      "methods": {
        "upi_intent":  { "sr": 0.97, "p50": 2500,  "p95": 9000,  "fixedFee": 0.5, "pctFee": 0 },
        "upi_collect": { "sr": 0.93, "p50": 20000, "p95": 90000, "fixedFee": 0.5, "pctFee": 0 },
        "card":        { "sr": 0.96, "p50": 4000,  "p95": 15000, "fixedFee": 0,   "pctFee": 1.7 },
        "netbanking":  { "sr": 0.94, "p50": 15000, "p95": 60000, "fixedFee": 8,   "pctFee": 0 } } },
    "..."
  ],
  "events": [
    { "target": "gateway", "id": "A", "methods": [], "start": 1170, "duration": 45, "srFactor": 0.1,
      "latencyFactor": 1, "recovery": 15, "repeatEvery": 0, "repeatCount": 1 }
  ],
  "retry": { "maxRetries": 2, "mode": "other", "delaySec": 3 },
  "dropoff": { "base": 0.15, "perSec": 0.003, "max": 0.9 },
  "strategies": {
    "static": { "enabled": true, "priority": ["A", "B", "C"] },
    "weighted": { "enabled": true, "weights": { "A": 50, "B": 30, "C": 20 } },
    "rules": { "enabled": true, "rules": [ { "method": "upi_intent", "minAmount": 0, "maxAmount": null, "gateway": "A" }, "..." ] },
    "egreedy": { "enabled": true, "epsilon": 0.1, "memory": { "kind": "window", "minutes": 30 } },
    "thompson": { "enabled": true, "memory": { "kind": "discount", "minutes": 20 } },
    "thompson_cost": { "enabled": true, "lambda": 0.01, "memory": { "kind": "discount", "minutes": 20 } }
  },
  "compare": { "baseline": "static" },
  "focus": { "start": 1170, "end": 1230 }
}
```

Field meanings: `mix` and bank `share` are relative weights (normalised by their sum); `customerDecline` is a probability per transaction; `sr` is the technical success probability; `p50`/`p95` are milliseconds for gateways and rupees for amounts; `fixedFee` rupees, `pctFee` percent of amount; a method key whose value is `null` means the gateway does not support that method; `capacityTpm` is accepted attempts per integer minute or `null` (unlimited); `activeFrom` is the minute from which the gateway is eligible; event `methods: []` means all methods; `focus` is the scenario's window of interest or `null`. Validation rules and limits are in section 7.2.

### 3.3 Effective probabilities, latency and fees (`model.js`)

For an event `e` and time `t`, the severity is the maximum over its occurrences `k = 0 .. n-1` (`n = repeatEvery > 0 ? repeatCount : 1`) with `s_k = start + k * repeatEvery`, `end_k = s_k + duration`:

```
occ_k(t) = 1                              if s_k <= t < end_k
         = 1 - (t - end_k) / recovery      if recovery > 0 and end_k <= t < end_k + recovery
         = 0                              otherwise
sev_e(t) = max_k occ_k(t)
```

An event matches gateway `g` and method `m` when `target === 'gateway'`, `id === g.id` and (`methods` is empty or contains `m`); bank events match the same way with `target === 'bank'`. With `E` the matching events:

```
srMult(t)  = prod_{e in E} (1 - sev_e(t) * (1 - e.srFactor))
latMult(t) = prod_{e in E} (1 + sev_e(t) * (e.latencyFactor - 1))     (gateway events only; bank events must have latencyFactor 1)
q(g, m, t) = g.methods[m].sr * srMult_gateway(g, m, t)
b(bank, m, t) = bank.srFactor * srMult_bank(bank, m, t)
pSuccess  = min(1, max(0, q(g, m, t) * b(bank, m, t)))
fee(g, m, amount) = g.methods[m].fixedFee + g.methods[m].pctFee / 100 * amount
lognormal params: mu = ln(p50), sigma = (ln(p95) - ln(p50)) / Z95
```

Worked values (normative, tested): `p50 2500, p95 9000` gives `mu = 7.824046010856292`, `sigma = 0.7787524825756766`. For the `peak-outage` event, `q(A, upi_intent, 1222.5) = 0.97 * (1 - 0.5 * 0.9) = 0.5335`, `q(A, upi_intent, 1200) = 0.097`, `q(A, upi_intent, 1230) = 0.97`.

`model.js` exports `severity(event, t)`, `gatewaySrMult(config, gatewayIndex, methodIndex, t)`, `gatewayLatMult(config, gatewayIndex, methodIndex, t)`, `bankSrMult(config, bankIndex, methodIndex, t)`, `q(config, gatewayIndex, methodIndex, t)`, `fee(config, gatewayIndex, methodIndex, amount)`, `lognormalParams(p50, p95)`. For speed, `engine.js` precomputes per (gateway, method) the matching event lists once per run.

### 3.4 Random streams and traffic generation (`prng.js`, `traffic.js`)

PRNG (exact):

```js
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
function fnv1a(str) {               // over UTF-16 code units; all labels are ASCII
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function deriveSeed(seed, label) { return fnv1a(String(seed) + ':' + label); }
function stream(seed, label) { return mulberry32(deriveSeed(seed, label)); }
```

Vectors (tested): `mulberry32(1)` yields `0.6270739405881613`, `0.002735721180215478`, `0.5274470399599522`; `fnv1a('') = 2166136261`; `fnv1a('a') = 0xe40c292c`; `deriveSeed(1, 'traffic') = 2816405663`; `deriveSeed(1, 'strategy:thompson') = 2752781027`.

Helpers (each consumes exactly the draws stated, in this order):

- `normal(rng)`: `u1 = rng(); u2 = rng(); return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);` (2 draws; Box-Muller cosine branch only).
- `weightedIndex(rng, weights)`: `total = sum(weights)`; `u = rng() * total`; walk the cumulative sum in index order and return the first `i` with `u < cumulative`; if none (rounding), the last index (1 draw). Precondition: `total > 0`.
- `poissonSmall(rng, lambda)` (Knuth): `L = Math.exp(-lambda); k = 0; p = 1; do { k++; p *= rng(); } while (p > L); return k - 1;`
- `poisson(rng, lambda)`: `k = 0; while (lambda > 30) { k += poissonSmall(rng, 30); lambda -= 30; } return k + poissonSmall(rng, lambda);` (`lambda = 0` returns 0 after one draw).
- `gamma(rng, a)` (Marsaglia-Tsang, `a >= 1`, else `RangeError('gamma shape must be >= 1')`): `d = a - 1/3; c = 1 / Math.sqrt(9 * d);` loop: `z = normal(rng); v = 1 + c * z; if (v <= 0) continue; v = v * v * v; u = rng(); if (u < 1 - 0.0331 * z*z*z*z) return d * v; if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;`
- `beta(rng, a, b)`: `x = gamma(rng, a); y = gamma(rng, b); return x / (x + y);`

Traffic for one seed (`traffic.generate(config, seed)`), stream `stream(seed, 'traffic')`:

```
sw = sum(hourly)
for m = 0 .. 1439:
  lambda = txnPerDay * hourly[floor(m / 60)] / (60 * sw)
  count = poisson(rng, lambda)
  batch = []
  repeat count times, drawing in exactly this order:
    t        = m + rng()
    method   = weightedIndex(rng, mix in METHODS order)
    zAmt     = normal(rng)
    amount   = clamp(round2(exp(muAmt[method] + sigmaAmt[method] * zAmt)), 1, 200000)   round2(x) = Math.round(x * 100) / 100
    bank     = weightedIndex(rng, bank shares in BANK_IDS order)
    customer = rng() < customerDecline[method] ? 1 : 0
    for k = 0 .. 3:  uS[k] = rng();  z[k] = normal(rng);  uD[k] = rng()
    push to batch
  stable-sort batch by t ascending; append to the output
```

That is 22 draws per transaction. All four attempt slots are always drawn (independent of `maxRetries`), so changing retries never shifts the stream. Output (`traffic` object, also built by hand in tests):

```
{ n, t: Float64Array(n), method: Uint8Array(n), amount: Float64Array(n), bank: Uint8Array(n),
  customer: Uint8Array(n), uS: Float64Array(4n), z: Float64Array(4n), uD: Float64Array(4n) }   // slot k of txn i at index 4i + k
```

Traffic depends only on `run.txnPerDay` and `traffic`; scenarios with equal values share traffic for the same seed (tested for `steady` and `issuer-outage`).

### 3.5 Discrete-event engine (`engine.js`)

`engine.runPolicy(config, traffic, policyId, seed)` simulates one policy in its own world and returns a run record (section 3.7). State per run: the policy object (section 4), a binary min-heap of pending events ordered by `(t, seq)` where `seq` is a counter incremented on every push, per-gateway capacity counters (only for gateways with `capacityTpm !== null`: a `Map` from the integer minute `floor(t)` to the count of attempts started in that minute, so attempts that start after minute 1440, possibly much later because latency has an unbounded lognormal tail, each get their own minute; no preset sets a capacity, so this choice does not change any preset result), and per-transaction tried-gateway bitmasks.

`runPolicy` expects a normalised configuration (the `config` returned by `validateConfig` with `ok: true`); it does not validate. Engine and distribution tests build their configurations through `validateConfig` (asserting `ok`) and build `traffic` objects by hand where a case needs exact uniforms and normals.

Main loop (arrivals are already sorted; heap events win ties):

```
i = 0
while i < n or heap not empty:
  if heap not empty and (i >= n or heap.top.t <= traffic.t[i]): process(heap.pop())
  else: startAttempt(i, 0, traffic.t[i], -1); i++
```

`startAttempt(i, k, t, prevGateway)`:

1. If `k > 0` and `retry.mode === 'same'`: `g = prevGateway` (the strategy is not consulted).
2. Otherwise build the eligible list: gateways in configuration order with `activeFrom <= t`, `methods[m] !== null`, and, when `retry.mode === 'other'`, not yet tried for this transaction. If it is empty, end the transaction with reason `no_route` at time `t` (only possible for `k > 0`, because validation guarantees coverage at minute 0 and gateways never become inactive). Else `g = policy.choose({ t, method: m, amount, attempt: k }, eligible)`.
3. If `k === 0`: count the first attempt in its bucket for gateway `g`; if `customer[i] === 0`, add `max_{h in eligible} q(h, m, t) - q(g, m, t)` to the regret sum.
4. Mark `g` tried; count an attempt on `g` (per bucket and total).
5. Capacity: with `minute = floor(t)`, if `capacityTpm !== null` and `count[g].get(minute) (0 when absent) >= capacityTpm`, the outcome is `rate_limited` with latency 200 ms (no draws used). Otherwise: if `capacityTpm !== null`, set `count[g]` at `minute` to its value plus 1; then compute `latencyMs = exp(mu + sigma * z[4i + k]) * gatewayLatMult(g, m, t)`, and the outcome is `customer` if `customer[i] === 1`, else `success` if `uS[4i + k] < pSuccess(g, m, bank, t)`, else `technical`.
6. Push a completion event at `t + latencyMs / 60000` with `(i, k, g, outcome)`.

`process(completion)` at time `tc`:

1. If the outcome is not `customer`: `policy.update(m, g, outcome === 'success' ? 1 : 0, tc)`.
2. `success`: add `fee(g, m, amount)` to fees and to the bucket's fee sum; if `k === 0` count a first-attempt success; end the transaction as `success` with time to success `(tc - arrival) * 60` seconds.
3. `customer`: end as `customer`.
4. `technical` or `rate_limited`: if `k >= retry.maxRetries`, end with that reason. Else `elapsedSec = (tc - arrival) * 60`, `pDrop = min(dropoff.max, dropoff.base + dropoff.perSec * elapsedSec)`; if `uD[4i + k] < pDrop` end as `dropped`; else push an attempt event `(i, k + 1, g)` at `tc + retry.delaySec / 60`.

Attempt events popped from the heap call `startAttempt(i, k, t, g)`. Ending a transaction records its final reason in its arrival bucket and method. Every transaction ends exactly once (an invariant asserted in tests by counting).

### 3.6 Oracle

`policyId === 'oracle'` uses the same engine with `choose` = the eligible gateway with the largest `q(g, m, t)` (ties: earlier in `strategies.static.priority`), no randomness and a no-op `update`. Its regret is 0 by construction.

### 3.7 Run record (output of `runPolicy`)

```
{ policy, seed, n,
  success, failed, dropped, firstSuccess, attempts, successfulAttempts,
  fees, successAmount, regretSum,
  reasons: { success, customer, technical, rate_limited, no_route, dropped },     // final reasons; sum = n
  tts: Float64Array of successful transactions' time to success (seconds), sorted ascending,
  buckets: {
    n:            Float64Array(96 * 4)   // transactions by arrival bucket and method
    success:      Float64Array(96 * 4)
    firstSuccess: Float64Array(96 * 4)
    first:        Float64Array(96 * G)   // first attempts by bucket and chosen gateway
    attempts:     Float64Array(96 * G)   // all attempts by the transaction's arrival bucket and gateway
    attemptSuccess: Float64Array(96 * G)
    fees:         Float64Array(96)
  } }
```

`failed = customer + technical + rate_limited + no_route`.

## 4. Strategies (`strategies.js`)

### 4.1 Interface

`strategies.create(config, policyId, seed)` returns `{ choose(ctx, eligible), update(methodIndex, gatewayIndex, reward, t) }`. `eligible` is a non-empty array of gateway indices in configuration order. Each policy that uses randomness owns the stream `stream(seed, 'strategy:' + policyId)`. `rank(g)` is the position of gateway `g` in `strategies.static.priority` (used for ties by every strategy, even when static is disabled).

### 4.2 Static priority

Return the first gateway of `priority` that is in `eligible`. No draws.

### 4.3 Weighted split

`w = eligible.map(g => weights[id(g)] || 0)`. If `sum(w) <= 0`, behave as static. Else return `eligible[weightedIndex(rng, w)]` (1 draw).

### 4.4 Rule-based

For each rule in order: it matches when (`rule.method === 'any'` or `rule.method === method`) and `amount >= rule.minAmount` and (`rule.maxAmount === null` or `amount < rule.maxAmount`) and its gateway is in `eligible`; return the first match. If none matches, behave as static. No draws. Retries in mode "other" therefore fall through to the next matching rule, then the priority list.

### 4.5 Memories

One memory per learning policy, with one cell per (method, gateway) pair, `cell = { a, b }` (successes and failures), plus:

- `none`: plain sums. `read(cell, t)` returns `{a, b}`; `update` adds `r` to `a` and `1 - r` to `b`.
- `window` (`W = memory.minutes`): the cell keeps a FIFO of `(tObs, r)` and running sums. `read(cell, t)` first removes entries with `tObs <= t - W` (subtracting them), then returns the sums. So an observation counts while `t - W < tObs`. `update(cell, r, t)` calls `read(cell, t)`, then appends and adds.
- `discount` (`H = memory.minutes`): the cell keeps `a, b, tLast` (`tLast` undefined at start). `read(cell, t)`: if `tLast` is undefined set `tLast = t`; `f = Math.pow(2, -(t - tLast) / H)`; `a *= f; b *= f; tLast = t`; return `{a, b}`. `update(cell, r, t)`: `read(cell, t)`, then `a += r; b += 1 - r`.

Reads mutate state (lazy decay and eviction), which is deterministic because the engine visits times in order. Time never decreases between calls on the same memory.

Normative examples (tested): discount `H = 20`, update `r=1` at `t=0`, update `r=0` at `t=10`, read at `t=30` gives `a = 0.3535533905932738`, `b = 0.5`. Window `W = 30`, updates `(0,1)`, `(10,0)`, `(25,1)`, `(35,1)`, read at `t=40` gives `a = 2`, `b = 0` (the `t=10` failure is out because `10 <= 40 - 30`).

### 4.6 Epsilon-greedy

```
u = rng()                                     // always drawn
if u < epsilon: return eligible[floor(rng() * eligible.length)]   // second draw only when exploring
for g in eligible: s = read(cell(method, g), t); est_g = (s.a + s.b) > 1e-12 ? s.a / (s.a + s.b) : 1.0
return argmax est_g (ties: smaller rank(g))
```

`update(m, g, r, t)` = memory update.

### 4.7 Thompson sampling

```
best = none
for g in eligible (configuration order):
  s = read(cell(method, g), t)
  theta = beta(rng, 1 + s.a, 1 + s.b)
  score = theta                         (thompson)
        = theta - lambda * fee(g, method, amount)   (thompson_cost)
  if best is none or score > bestScore or (score === bestScore and rank(g) < rank(best)): best = g
return best
```

Every eligible gateway gets exactly one Beta draw per decision, also on retries. `update` = memory update. Normative example (tested with a stubbed sampler, `strategies.scoreThompson(thetas, fees, lambda)`): thetas `[0.95, 0.90]`, fees `[20, 14]`, `lambda = 0.01` gives scores `[0.75, 0.76]` and chooses index 1.

### 4.8 Exports for tests

`strategies.create`, `strategies.createMemory(kind, minutes)` (with `read(key, t)` and `update(key, r, t)` over string or integer keys), `strategies.scoreThompson`, `strategies.rank`.

## 5. Metrics and statistics (`metrics.js`, `stats.js`)

### 5.1 Day metrics per run

| Key | Formula | Null when |
|---|---|---|
| `n` | `n` | never |
| `orderSr` | `success / n` | `n = 0` |
| `firstSr` | `firstSuccess / n` | `n = 0` |
| `attemptSr` | `successfulAttempts / attempts` | `attempts = 0` |
| `retriesPerTxn` | `(attempts - n) / n` | `n = 0` |
| `dropRate` | `dropped / n` | `n = 0` |
| `failRate` | `failed / n` | `n = 0` |
| `costPerSuccess` | `fees / success` | `success = 0` |
| `feeRatePct` | `100 * fees / successAmount` | `successAmount = 0` |
| `ttsP50`, `ttsP95` | nearest-rank percentile of `tts` (seconds) | `success = 0` |
| `regretPer1000` | `1000 * regretSum / n` | `n = 0` |

Status fractions per run: `reasons[r] / n` for each of `REASONS`.

`metrics.dayMetrics(run)` returns these day metrics of one run record as an object in the table's key order, unrounded (rounding happens only in 5.7). `metrics.statusFractions(run)` returns the status fractions, unrounded. Both are exported for `metrics.aggregate` and for tests that need unrounded values (`conformance.test.cjs`, 6.6).

### 5.2 Window metrics per run

A window `[s, e)` with `s` and `e` multiples of 15 covers buckets `s/15 .. e/15 - 1`. With sums over those buckets (and over all methods, or one method):

- `orderSr = sum(success) / sum(n)`; `firstSr = sum(firstSuccess) / sum(n)`; `orderSrByMethod[m]` with method `m` only;
- `share[g] = sum(first[., g]) / sum(first[., all gateways])`;
- null when the denominator is 0 (excluded from aggregation).

### 5.3 Aggregation across seeds

For each metric, the per-seed values `x_1..x_n` (nulls removed; `n` is the count left):

```
mean = sum(x) / n
sd   = sqrt( sum((x - mean)^2) / (n - 1) )          (null if n < 2)
half = t975(n - 1) * sd / sqrt(n)
ciLow = mean - half,  ciHigh = mean + half            (null if n < 2)
```

`stats.summarise(values)` returns `{ mean, sd, ciLow, ciHigh, n }` (all null and `n: 0` for an empty list).

`t975(df)`: for `df` 1 to 30, the table `[12.7062, 4.3027, 3.1824, 2.7764, 2.5706, 2.4469, 2.3646, 2.3060, 2.2622, 2.2281, 2.2010, 2.1788, 2.1604, 2.1448, 2.1314, 2.1199, 2.1098, 2.1009, 2.0930, 2.0860, 2.0796, 2.0739, 2.0687, 2.0639, 2.0595, 2.0555, 2.0518, 2.0484, 2.0452, 2.0423]`; for `df >= 31`, the Cornish-Fisher expansion (Abramowitz and Stegun 26.7.5) with `z = 1.959963984540054`:

```
g1 = (z^3 + z) / 4
g2 = (5 z^5 + 16 z^3 + 3 z) / 96
g3 = (3 z^7 + 19 z^5 + 17 z^3 - 15 z) / 384
g4 = (79 z^9 + 776 z^7 + 1482 z^5 - 1920 z^3 - 945 z) / 92160
t  = z + g1/df + g2/df^2 + g3/df^3 + g4/df^4
```

Vectors (tested, tolerance 1e-4 against published tables): `t975(31) = 2.0395`, `t975(40) = 2.0211`, `t975(60) = 2.0003`, `t975(99) = 1.9842`; and the expansion at 30 gives `2.0423` (consistency with the table).

Worked example (tested): `[0.95, 0.97, 0.96, 0.94, 0.98]` gives `mean 0.96`, `sd 0.01581138830084191`, `half 0.01963211267286332` with `t975(4) = 2.7764`, interval `[0.9403678873271366, 0.9796321126728633]` (tolerance 1e-12).

### 5.4 Paired differences

For policies `a` and `b` on the same seeds: `d_i = x_a,i - x_b,i` over seeds where both are non-null; summarised by 5.3. `results.paired[p]` holds `p - baseline` for every policy `p` other than the baseline, for every day metric. Worked example (tested): `a = [0.95, 0.96, 0.97]`, `b = [0.94, 0.94, 0.96]` gives `d = [0.01, 0.02, 0.01]`, mean `0.0133333333` (exact value 1/75), sd `0.0057735027` (exact value sqrt(1/30000)), `t975(2) = 4.3027`, interval `[-0.001009, 0.0276756667]`. Tolerance 1e-9 for the mean, the sd and both interval ends: the differences are computed in IEEE doubles (`0.95 - 0.94` is not exactly `0.01`), so the computed mean is about `0.013333333333333345`, not the exact-math value.

### 5.5 Percentiles

Nearest rank on an ascending array `x` of length `n >= 1`: `x[ceil(p * n) - 1]` with `p` in `(0, 1]`. Vectors: `[1..100]` p50 = 50, p95 = 95; `[3, 1, 2]` sorted p95 = 3; one element returns it.

### 5.6 Time series (pooled across seeds)

Per policy and bucket: `orderSr = sum over seeds of success / sum of n`; likewise `firstSr`, `orderSrByMethod[m]`, `share[g]` (first attempts), `gatewayAttemptSr[g] = attemptSuccess / attempts`. Null where the denominator is 0. Pooled, not averaged, and without intervals (charts show shape over time; intervals are in tables). The same five series are also computed per hour (24 values, pooling the counts of buckets `4h .. 4h + 3` before dividing) under `series.hourly`; the "Show the data" tables of 8.8 use only `series.hourly`, so `ui.js` never re-pools ratios.

### 5.7 Results object and rounding

`metrics.aggregate(config, runsByPolicy, seeds, scenarioMeta)` builds the results object with keys in exactly this order:

```
{
  "schema": "routelab.results.v1",
  "version": "1.0.0",
  "scenarioId": "<preset id or 'custom'>",
  "preset": true | false,
  "title": "<preset title when preset is true, else 'Custom settings'>",
  "expectationText": "<preset expectationText when preset is true>" | null,
  "configHash": "<8 lower-case hex>",
  "config": <normalised config>,
  "seeds": [ ... ],
  "policies": [ { "id": "static", "label": "Static priority", "reference": false }, ..., { "id": "oracle", "label": "Oracle (reference)", "reference": true } ],
  "baseline": "static",
  "focus": { "start": s, "end": e } | null,
  "summary": { "<policy>": { "<day metric>": <stat>, ... } },
  "status": { "<policy>": { "<reason>": <stat>, ... } },
  "paired": { "<policy other than baseline>": { "<day metric>": <stat>, ... } },
  "focusSummary": { "<policy>": { "orderSr": <stat>, "firstSr": <stat>, "orderSrByMethod": { "<method>": <stat> }, "share": { "<gateway>": <stat> } } } | null,
  "series": { "bucketMinutes": 15, "orderSr": { "<policy>": [96] }, "firstSr": {...}, "orderSrByMethod": { "<policy>": { "<method>": [96] } }, "share": { "<policy>": { "<gateway>": [96] } }, "gatewayAttemptSr": { "<policy>": { "<gateway>": [96] } }, "hourly": { "orderSr": {...[24]}, "firstSr": {...}, "orderSrByMethod": {...}, "share": {...}, "gatewayAttemptSr": {...} } },
  "perSeed": { "<policy>": [ { "seed": s, "<day metric>": v, ... } ] },
  "expectations": [ { "id": "PO1", "text": "...", "held": true, "value": v | null, "ciLow": l | null, "ciHigh": h | null, "detail": "..." } ] | null
}
```

`scenarioMeta` is `{ scenarioId, preset, title, expectationText, expectations }` (the last is the preset's 6.4 rows, or `null`), built by `routelab.js` from `scenarios.js` and the 5.7 `preset` rule, so `metrics.js` keeps its 2.3 dependencies (stats, config) and never imports `scenarios.js`. `aggregate` copies `scenarioId`, `preset`, `title` and `expectationText` into the results object unchanged and evaluates `expectations` only when `preset` is true. Every consumer that shows a scenario's title or expected outcome (the memo, `#rl-res-summary`, `#rl-res-expect`, the CLI header) reads `results.title` and `results.expectationText`, never `scenarios.js`.

`<stat>` is `{ "mean", "sd", "ciLow", "ciHigh", "n" }`. Policies are those enabled, in `POLICY_IDS` order, plus the oracle (always). Every number written to the results object (stats, series, perSeed, expectation values) is rounded with `Math.round(x * 1e6) / 1e6` (and `-0` written as `0`); counts are integers. Expectations are evaluated on unrounded values before rounding. `toJson(results)` = `JSON.stringify(results, null, 2) + '\n'`. The same configuration and seeds always give the same string (tested); no timestamps, host names or paths appear in it.

`configHash` = 8-digit lower-case hex of `fnv1a(canonicalJson(config without run))`, where `canonicalJson` is `JSON.stringify` of the normalised object (key order fixed by normalisation). `preset` is true when `canonicalJson(config with run.seeds and run.seedStart removed)` equals that of the preset named by the UI's last loaded preset (or the CLI's `--scenario`), with the preset's own `seeds` and `seedStart` removed too; `scenarioId` is then the preset id, else `'custom'`. Changing `txnPerDay` makes a configuration custom.

## 6. Scenarios (`scenarios.js`)

### 6.1 Base configuration

Every preset starts from this base and applies only the changes listed in 6.2. `run`: 20 seeds from 1, 10,000 transactions per day. `traffic`: as in the 3.2 example (hourly weights, mix 55/10/25/10, customer declines 0.05/0.18/0.07/0.10, amounts, banks X 40, Y 35, Z 25 with factor 1). `retry`: 2, `other`, 3 s. `dropoff`: 0.15, 0.003, 0.9. `compare.baseline`: `static`.

Gateways (all `activeFrom 0`, `capacityTpm null`; latency for every gateway: UPI intent 2500/9000 ms, UPI collect 20000/90000, card 4000/15000, netbanking 15000/60000):

| Gateway | SR intent | SR collect | SR card | SR netbanking | UPI fee (both) | Card fee | Netbanking fee |
|---|---|---|---|---|---|---|---|
| A | 0.97 | 0.93 | 0.96 | 0.94 | Rs 0.50 | 1.70% | Rs 8 |
| B | 0.94 | 0.90 | 0.93 | 0.91 | Rs 0.75 | 1.90% | Rs 10 |
| C | 0.92 | 0.87 | 0.92 | 0.90 | Rs 1.00 | 2.00% | Rs 12 |

(Fees: UPI and netbanking are `fixedFee` with `pctFee 0`; cards are `pctFee` with `fixedFee 0`.) A is best and cheapest on every method, and B beats C on every method, so in the base the oracle's preference order equals the static priority A, B, C.

Strategies: `static.priority ['A','B','C']`; `weighted.weights {A: 50, B: 30, C: 20}`; `rules`, in order: `upi_intent -> A`; `upi_collect -> B`; `card, minAmount 5000 -> C` (a deliberately stale belief: C is not better for large card payments in this model); `card -> A`; `netbanking -> A` (all others `minAmount 0`, `maxAmount null`); `egreedy` epsilon 0.10, window 30; `thompson` discount 20; `thompson_cost` lambda 0.01, discount 20. All enabled.

### 6.2 Presets

| Id | Title | Changes from the base | Focus |
|---|---|---|---|
| `steady` | Steady state | none | 18:00-24:00 (1080-1440) |
| `peak-outage` | Evening-peak outage on the best gateway | event: gateway A, all methods, start 1170 (19:30), duration 45, srFactor 0.10, latencyFactor 1, recovery 15 | 19:30-20:30 (1170-1230) |
| `collect-degradation` | UPI collect degradation | event: gateway A, methods `['upi_collect']`, start 600 (10:00), duration 360, srFactor 0.5, latencyFactor 2, recovery 30 | 10:00-16:30 (600-990) |
| `cost-vs-sr` | Cheap-but-flaky vs expensive-but-reliable | gateways A and B only. A: SR as base; fees UPI Rs 1.50, card 2.10%, netbanking Rs 15. B: SR intent 0.91, collect 0.85, card 0.88, netbanking 0.86; fees UPI Rs 0.25, card 1.40%, netbanking Rs 6. `static.priority ['B','A']` (cheapest first); `weighted {A: 50, B: 50}`; rules: `card, minAmount 2000 -> B`; `netbanking -> B`; `any -> A` | none (whole day) |
| `cold-start` | New gateway joins at noon | add gateway D: `activeFrom 720`, SR intent 0.99, collect 0.95, card 0.98, netbanking 0.96, fees and latency as B; `static.priority ['A','B','C','D']`; `weighted {A: 50, B: 30, C: 20, D: 0}`; rules unchanged | 14:00-24:00 (840-1440) |
| `flapping` | Flapping gateway | event: gateway A, all methods, start 540 (09:00), duration 10, srFactor 0.2, latencyFactor 1, recovery 0, repeatEvery 30, repeatCount 24 (last flap 20:30-20:40) | 09:00-21:00 (540-1260) |
| `issuer-outage` | Issuer bank outage (not routable) | event: bank X, all methods, start 1200 (20:00), duration 60, srFactor 0.2, latencyFactor 1, recovery 0 | 20:00-21:00 (1200-1260) |

Each preset in `scenarios.js` also has a `changes` string, which is the "Changes from the base" cell of the table above, verbatim (with `none` for `steady`; RESULTS.md shows it, 7.5). Each preset also has an `expectationText` (one paragraph, the user-facing summary of its 6.4 rows, which never claims more than the rows check) and a `story`, which is exactly the first sentence of its `expectationText` (shown in the Scenarios tab, the README table and RESULTS):

- `steady`: "Nothing goes wrong all day, and Gateway A is both the most reliable and the cheapest. Static priority on A is already what the oracle would do, so it matches the oracle exactly. Thompson sampling keeps exploring the other gateways, so it pays a measurable price in first-attempt success, cost per success and regret; at the order level, after retries, the gap stays within one percentage point. A 50/30/20 split costs more and succeeds less often on the first attempt."
- `peak-outage`: "Gateway A, the best one, almost stops working for 45 minutes in the evening peak and recovers over 15 minutes. Static priority keeps sending every first attempt to A, so customers depend on retries. Within 15 minutes of the start, Thompson sampling sends almost no first attempts to A. Thompson sampling and epsilon-greedy both keep the order success rate far higher than static during the outage hour; Thompson sampling's lead also lifts its whole-day order success rate above static's, and static's regret is much higher than Thompson sampling's."
- `collect-degradation`: "Gateway A's UPI collect flow degrades to half its normal success rate for six hours and slows down; its other methods are fine. Thompson sampling keeps separate estimates per payment method, so during the degradation its UPI collect order success rate is at least 5 points above static's, while its UPI intent order success rate stays within one point of static's. The rule-based router, which already sends collect to B, is at least 5 points above static on collect too."
- `cost-vs-sr`: "Two gateways: A is reliable but expensive, B is cheap but fails more. Of the three strategies compared here, static 'cheapest first' has the lowest cost and the lowest success rate, the success-rate-only Thompson router has the highest success rate and the highest cost, and the cost-aware Thompson router sits in between on both."
- `cold-start`: "A new, better Gateway D goes live at noon. The configured strategies do not know about it until someone edits them: from 14:00, static priority sends it no first attempts, while the oracle uses it for every first attempt. Thompson sampling discovers it and sends it at least half of the first attempts from 14:00; epsilon-greedy with a 30-minute window sends it clearly less. Nobody can use D before noon."
- `flapping`: "Gateway A fails for 10 minutes every half hour from 09:00 to 21:00. Both learning routers beat static priority clearly during those hours, and static's regret is far higher. The learning routers are not free either: both Thompson sampling and epsilon-greedy keep a clearly positive regret of their own, because each flap has to be detected and each recovery rediscovered."
- `issuer-outage`: "Bank X, which issues 40% of customers' cards and accounts, has a one-hour outage at 20:00. Every gateway is equally affected, so routing cannot help: static priority and Thompson sampling both lose more than 10 points of order success during the hour compared with the two hours before, static priority still equals the oracle, and Thompson sampling does no better than static."

### 6.3 Expectation language

An expectation row (data in `scenarios.js`) is `{ id, metric, scope, method?, a, b?, op, threshold?, threshold2?, before? }`, evaluated per run from the unrounded per-seed values of the results' seeds. Rows never use a field called `value`; `value` exists only in the stored (evaluated) expectation, where it is the observed statistic.

- `metric`: a day metric of 5.1 (scope `day`), or `orderSr`, `firstSr`, `share:<G>` over a window (scope `focus` = the preset's focus window, or an explicit `[s, e]`); `method` restricts `orderSr`/`firstSr` to one method. `exactlyEqual` rows have `metric: 'all'`.
- Ops (with `x_a,i` the per-seed values of policy `a`, `d_i = x_a,i - x_b,i` and its 5.3 summary `D`):
  - `diffAtLeast`: `D.mean >= threshold`.
  - `diffAtLeastCi`: `D.mean >= threshold` and `D.ciLow > 0` (with fewer than 2 seeds `D.ciLow` is null and the row does not hold).
  - `diffWithin`: `threshold <= D.mean <= threshold2`.
  - `relDiffAtLeast`: `(mean_a - mean_b) / mean_b >= threshold`.
  - `atLeast` / `atMost`: `mean_a >= threshold` / `mean_a <= threshold` (no `b`).
  - `exactlyEqual`: for every seed, every day metric of 5.1 and every status fraction of `a` equals that of `b` (`===`, nulls equal only to nulls).
  - `exactlyValue`: for every seed, `x_a,i === threshold` (`a` may be `'*'` = every policy in the run, the oracle included; a seed then matches only when every policy matches). A null `x_a,i` does not match.
  - `windowDropAtLeast`: with `x_a,i` over window `scope` and `y_a,i` over window `before` (the earlier window, `[s, e]`), `W = summarise(y - x)` and `W.mean >= threshold`.
- Stored expectation `{ id, text, held, value, ciLow, ciHigh, detail }`:
  - `held`: `true` / `false`, or `null` when a policy named by the row is switched off.
  - `value`: the observed statistic: `D.mean` (the three `diff...` ops), the relative difference (`relDiffAtLeast`), `mean_a` (`atLeast`, `atMost`), `W.mean` (`windowDropAtLeast`), the number of seeds that matched (`exactlyEqual`, `exactlyValue`); `null` when not checked.
  - `ciLow`, `ciHigh`: the 5.3 interval of `D` (the three `diff...` ops), of `x_a` (`atLeast`, `atMost`) or of `W` (`windowDropAtLeast`); `null` for `relDiffAtLeast`, the exact ops, fewer than 2 seeds and rows not checked.
  - `text` and `detail`: from the templates below.

Labels, units and templates (implemented once in `metrics.js` as `metrics.expectationText(row, scenarioFocus)` and `metrics.formatObserved`, reused by RESULTS, the README block, the UI and the CLI):

| Item | Rule |
|---|---|
| Policy label | `POLICY_LABELS[a]`; `'*'` is "Every policy" |
| Subject | diff ops and `relDiffAtLeast`: `<label a> - <label b>`; `exactlyEqual`: `<label a> and <label b>`; others: `<label a>` |
| Metric label | `orderSr` "order SR"; `firstSr` "first-attempt SR"; `attemptSr` "attempt SR"; `retriesPerTxn` "retries per transaction"; `dropRate` "drop-off rate"; `failRate` "failed rate"; `costPerSuccess` "cost per success"; `feeRatePct` "effective fee rate"; `ttsP50` "time to success p50"; `ttsP95` "time to success p95"; `regretPer1000` "regret per 1,000"; `share:<G>` "share of first attempts on Gateway <G>"; `all` "all day metrics and final statuses". With `method`, append ` (<METHOD_LABELS[method]>)`, for example "order SR (UPI collect)" |
| Scope label | `day` is "day"; a window `[s, e)` is `HH:MM-HH:MM` with zero-padded hours and minutes and 1440 written `24:00`; `focus` uses the preset's focus window; for `exactlyEqual` (metric `all`) the scope label and the space before it are omitted ("Static priority and Oracle (reference), all day metrics and final statuses: identical on every seed.") |
| Level format (single values) | SR-type metrics (`orderSr`, `firstSr`, `attemptSr`, `dropRate`, `failRate`, `share:*`): `(x * 100).toFixed(2) + '%'` ("65.30%"); `costPerSuccess`: `'Rs ' + x.toFixed(2)` ("Rs 0.98"); `feeRatePct`: `x.toFixed(2) + '%'`; `regretPer1000`: `x.toFixed(1)`; `retriesPerTxn`: `x.toFixed(3)`; `ttsP50`/`ttsP95`: `x.toFixed(1) + ' s'` |
| Difference format (diff ops, windowDrop) | sign `+` when `x >= 0` (also for `-0` and values that round to 0) else `-`, then the absolute value: SR-type metrics and `feeRatePct` `(abs * 100).toFixed(2) + ' pp'` (`feeRatePct` without the `* 100`), for example "+11.56 pp"; `costPerSuccess` `'Rs ' + abs.toFixed(2)` ("+Rs 0.98"); `regretPer1000` `abs.toFixed(1)` ("+40.9"); `retriesPerTxn` `abs.toFixed(3)`; times `abs.toFixed(1) + ' s'` |
| Relative format | signed as above, `(abs * 100).toFixed(2) + '%'` ("+7.77%") |
| Requirement phrase | `diffAtLeast` "at least <thr>"; `diffAtLeastCi` "at least <thr> and CI above 0"; `diffWithin` "between <thr> and <thr2>"; `relDiffAtLeast` "relatively at least <thr>"; `atLeast` "at least <thr>"; `atMost` "at most <thr>"; `exactlyEqual` "identical on every seed"; `exactlyValue` "exactly <thr> on every seed"; `windowDropAtLeast` "a drop of at least <thr> compared with <before scope label>". Thresholds use the difference format for diff ops and windowDrop, the relative format for `relDiffAtLeast` and the level format otherwise |
| `text` | `<subject>, <metric label> <scope label>: <requirement phrase>.` |
| `detail` | Checked, with an interval: `<subject>, <metric label> <scope label>: <observed> (95% CI <low> to <high>); required <requirement phrase>.` Without an interval (`relDiffAtLeast`, fewer than 2 seeds): the same without the parenthesis, plus `; needs at least 2 seeds for an interval` before `; required` when the op is `diffAtLeastCi` and fewer than 2 seeds were run. Exact ops: `<subject>, <metric label> <scope label>: <k> of <n> seeds matched; required <requirement phrase>.` Not checked: `Not checked: <label> is switched off.` (the first switched-off label in `a`, `b` order) |

`<observed>`, `<low>` and `<high>` use the same format as the row's threshold. Examples (normative, tested in `metrics.test.cjs` with hand-built values):

- PO1 `text`: `Thompson sampling - Static priority, order SR 19:30-20:30: at least +5.00 pp and CI above 0.`
- PO1 `detail` with `D = { mean 0.1156, ciLow 0.1095, ciHigh 0.1217 }`: `Thompson sampling - Static priority, order SR 19:30-20:30: +11.56 pp (95% CI +10.95 to +12.17); required at least +5.00 pp and CI above 0.`
- CS4 `detail` with relative difference 0.304: `Thompson sampling - Cost-aware Thompson, cost per success day: +30.40%; required relatively at least +10.00%.`
- IO3 `text`: `Static priority, order SR 20:00-21:00: a drop of at least +10.00 pp compared with 18:00-20:00.`
- CO3 `detail` on 20 seeds: `Every policy, share of first attempts on Gateway D 00:00-12:00: 20 of 20 seeds matched; required exactly 0.00% on every seed.`

### 6.4 Expectations (fixed before measurement)

Units: SR and share differences are fractions (0.05 = 5 percentage points); cost in rupees; regret per 1,000 transactions. The Threshold column is the row's `threshold`; for `diffWithin` it reads `<threshold> to <threshold2>`; for `windowDropAtLeast` the "vs" window in the scope column is the row's `before`.

| Id | Scenario | Metric and scope | a | b | Op | Threshold | Pilot (6.6) |
|---|---|---|---|---|---|---|---|
| ST1 | steady | all day metrics | static | oracle | exactlyEqual | | equal |
| ST2 | steady | orderSr, day | static | thompson | diffWithin | -0.001 to 0.010 | 0.0024 |
| ST3 | steady | costPerSuccess, day | thompson | static | diffAtLeastCi | 0 | 0.976 |
| ST4 | steady | costPerSuccess, day | weighted | static | relDiffAtLeast | 0.02 | 0.078 |
| ST5 | steady | firstSr, day | static | weighted | diffAtLeastCi | 0.008 | 0.0170 |
| ST6 | steady | share:A, focus | thompson | | atLeast | 0.55 | 0.653 |
| ST7 | steady | regretPer1000, day | thompson | | atLeast | 5 | 12.85 |
| ST8 | steady | firstSr, day | static | thompson | diffAtLeastCi | 0.003 | 0.0127 |
| PO1 | peak-outage | orderSr, focus | thompson | static | diffAtLeastCi | 0.05 | 0.1156 |
| PO2 | peak-outage | orderSr, focus | egreedy | static | diffAtLeastCi | 0.05 | 0.1156 |
| PO3 | peak-outage | orderSr, day | thompson | static | diffAtLeastCi | 0.003 | 0.0075 |
| PO4 | peak-outage | regretPer1000, day | static | thompson | diffAtLeastCi | 20 | 40.91 |
| PO5 | peak-outage | share:A, [1185, 1215) | thompson | | atMost | 0.10 | 0.018 |
| PO6 | peak-outage | share:A, [1170, 1215) | static | | exactlyValue | 1 | 1 |
| CD1 | collect-degradation | orderSr upi_collect, focus | thompson | static | diffAtLeastCi | 0.05 | 0.1074 |
| CD2 | collect-degradation | orderSr upi_collect, focus | rules | static | diffAtLeastCi | 0.05 | 0.1091 |
| CD3 | collect-degradation | orderSr upi_intent, focus | thompson | static | diffWithin | -0.01 to 0.01 | -0.0015 |
| CS1 | cost-vs-sr | firstSr, day | thompson | thompson_cost | diffAtLeastCi | 0.006 | 0.0142 |
| CS2 | cost-vs-sr | orderSr, day | thompson | thompson_cost | diffAtLeastCi | 0 | 0.0027 |
| CS3 | cost-vs-sr | firstSr, day | thompson_cost | static | diffAtLeastCi | 0.015 | 0.0395 |
| CS4 | cost-vs-sr | costPerSuccess, day | thompson | thompson_cost | relDiffAtLeast | 0.10 | 0.304 |
| CS5 | cost-vs-sr | costPerSuccess, day | thompson_cost | static | diffAtLeastCi | 0 | 1.20 |
| CS6 | cost-vs-sr | orderSr, day | thompson_cost | static | diffAtLeastCi | 0.002 | 0.0066 |
| CO1 | cold-start | share:D, focus | thompson | | atLeast | 0.50 | 0.664 |
| CO2 | cold-start | firstSr, focus | thompson | static | diffAtLeastCi | 0.003 | 0.0066 |
| CO3 | cold-start | share:D, [0, 720) | * | | exactlyValue | 0 | 0 |
| CO4 | cold-start | share:D, focus | static | | exactlyValue | 0 | 0 |
| CO5 | cold-start | share:D, focus | oracle | | exactlyValue | 1 | 1 |
| CO6 | cold-start | share:D, focus | thompson | egreedy | diffAtLeastCi | 0.08 | 0.205 |
| FL1 | flapping | orderSr, focus | thompson | static | diffAtLeastCi | 0.015 | 0.0356 |
| FL2 | flapping | orderSr, focus | egreedy | static | diffAtLeastCi | 0.015 | 0.0345 |
| FL3 | flapping | regretPer1000, day | static | thompson | diffAtLeastCi | 50 | 129.3 |
| FL4 | flapping | regretPer1000, day | thompson | | atLeast | 15 | 29.98 |
| FL5 | flapping | regretPer1000, day | egreedy | | atLeast | 15 | 31.51 |
| IO1 | issuer-outage | all day metrics | static | oracle | exactlyEqual | | equal |
| IO2 | issuer-outage | orderSr, focus | thompson | static | diffWithin | -0.02 to 0.005 | -0.0009 |
| IO3 | issuer-outage | orderSr, focus vs [1080, 1200) | static | | windowDropAtLeast | 0.10 | 0.220 |
| IO4 | issuer-outage | orderSr, focus vs [1080, 1200) | thompson | | windowDropAtLeast | 0.10 | 0.219 |

`exactlyEqual` and `exactlyValue` rows are structural: they follow from the model (static's choices coincide with the oracle's when the true ranking equals the priority list; a gateway that is not yet active is never eligible; static never reaches D on a first attempt; the oracle always picks the best active gateway) and must hold for every seed.

FL5 was added in the design revision that answered the design review, before any run on `RESULTS_SEEDS` or `ROBUST_SEEDS`; its threshold is at most half of the pilot value, like every other row.

Headlines (README scenarios table and RESULTS), each rendered as `<subject>, <metric label> (<scope label>): <observed> (95% CI <low> to <high>)` with the 6.3 labels; a two-policy headline is the paired difference `a - b` (from `paired` for day metrics, or the per-seed window differences for focus metrics) in the difference format, a single-policy headline is the level of `a` in the level format. Example: `Thompson sampling - Static priority, order SR (19:30-20:30): +11.56 pp (95% CI +10.95 to +12.17)`. The rows are:

| Scenario | Headline rows |
|---|---|
| steady | orderSr day static - thompson; firstSr day static - thompson |
| peak-outage | orderSr focus thompson - static |
| collect-degradation | orderSr upi_collect focus thompson - static |
| cost-vs-sr | orderSr day thompson - thompson_cost; costPerSuccess day thompson - thompson_cost |
| cold-start | share:D focus thompson |
| flapping | orderSr focus thompson - static |
| issuer-outage | orderSr focus thompson - static |

### 6.5 Seed sets (fixed)

| Name | Seeds | Used for |
|---|---|---|
| `RESULTS_SEEDS` | 101 to 130 (30 seeds) | `docs/RESULTS.md`, `docs/results.json`, the README results block; every expectation must hold |
| `ROBUST_SEEDS` | 1 to 20 (20 seeds) | the UI and CLI default (so the first run a visitor sees is a tested one); every expectation must hold |
| `PILOT_SEEDS` | 501 to 520 | design-phase pilot (6.6) and the conformance test only; never used for RESULTS or for choosing thresholds after this document is approved |

`scenarios.test.cjs` runs every preset on `RESULTS_SEEDS` and on `ROBUST_SEEDS` and requires `held === true` for every row in both. Exported from `scenarios.js` as `RESULTS_SEEDS`, `ROBUST_SEEDS` (`{ seedStart, seeds }` objects).

### 6.6 Pilot reference values (design prototype, seeds 501-520)

Day means across the 20 pilot seeds, as printed by the prototype: order SR %, first-attempt SR %, cost per success (Rs), regret per 1,000.

| Scenario | static | weighted | rules | egreedy | thompson | thompson_cost | oracle |
|---|---|---|---|---|---|---|---|
| steady | 91.90 / 88.98 / 13.572 / 0.00 | 91.59 / 87.28 / 14.626 / 17.20 | 91.83 / 88.59 / 14.649 / 3.83 | 91.66 / 87.69 / 14.517 / 12.98 | 91.66 / 87.71 / 14.548 / 12.85 | 91.73 / 88.06 / 13.839 / 9.11 | 91.90 / 88.98 / 13.572 / 0.00 |
| peak-outage | 90.72 / 82.87 / 13.683 / 58.30 | 90.98 / 84.30 / 14.709 / 44.62 | 90.82 / 83.25 / 14.778 / 54.30 | 91.50 / 87.08 / 14.667 / 16.53 | 91.47 / 87.00 / 14.793 / 17.39 | 91.51 / 87.17 / 14.031 / 15.44 | 91.82 / 88.73 / 13.721 / 0.00 |
| collect-degradation | 91.47 / 87.77 / 13.636 / 11.41 | 91.36 / 86.65 / 14.652 / 22.42 | 91.78 / 88.59 / 14.657 / 3.01 | 91.57 / 87.50 / 14.555 / 14.15 | 91.61 / 87.61 / 14.524 / 13.50 | 91.65 / 87.92 / 13.854 / 10.02 | 91.86 / 88.90 / 13.584 / 0.00 |
| cost-vs-sr | 90.53 / 82.65 / 11.565 / 63.64 | 91.08 / 85.82 / 14.581 / 31.93 | 91.35 / 87.55 / 13.038 / 14.65 | 91.41 / 87.78 / 16.311 / 12.33 | 91.46 / 88.03 / 16.646 / 9.41 | 91.19 / 86.61 / 12.769 / 24.10 | 91.63 / 88.98 / 17.569 / 0.00 |
| cold-start | 91.90 / 88.98 / 13.572 / 13.62 | 91.59 / 87.28 / 14.626 / 30.82 | 91.83 / 88.59 / 14.649 / 17.44 | 91.85 / 88.65 / 14.744 / 17.13 | 91.91 / 89.02 / 14.911 / 13.23 | 91.92 / 89.05 / 13.957 / 12.99 | 92.16 / 90.36 / 14.846 / 0.00 |
| flapping | 88.72 / 72.42 / 13.841 / 159.25 | 89.94 / 79.07 / 14.817 / 92.88 | 89.08 / 74.02 / 15.005 / 142.81 | 91.06 / 85.20 / 15.270 / 31.51 | 91.12 / 85.41 / 15.381 / 29.98 | 91.06 / 85.20 / 14.655 / 31.62 | 91.71 / 88.33 / 13.980 / 0.00 |
| issuer-outage | 89.83 / 86.33 / 13.583 / 0.00 | 89.54 / 84.68 / 14.623 / 17.18 | 89.77 / 85.95 / 14.650 / 3.83 | 89.61 / 85.09 / 14.521 / 12.80 | 89.62 / 85.23 / 14.496 / 11.38 | 89.69 / 85.55 / 13.827 / 7.77 | 89.83 / 86.33 / 13.583 / 0.00 |

The prototype implements sections 3 and 4 as written (same streams, draw order, event ordering and memories). `conformance.test.cjs` runs `steady`, `peak-outage` and `cost-vs-sr` on `PILOT_SEEDS` and checks those 84 cells (3 scenarios x 7 policies x 4 values). The test never compares rounded strings and never uses the rounded results object of 5.7: for each scenario, seed and policy it calls `traffic.generate`, `engine.runPolicy` and `metrics.dayMetrics` (5.1), averages the unrounded per-seed values over the 20 seeds, converts to the table's unit (SR times 100) and asserts `|x - cell| <= 0.5 * unit + 1e-9` with `unit` = 0.01 for SR (in percent), 0.001 for cost (Rs) and 0.01 for regret. A cell outside that tolerance is a real deviation. A mismatch means the implementation or the prototype deviates from this document. The document wins: find the deviation; if it is in the prototype, correct this table with a recorded reason in the build report (never to make a test pass without finding the cause).

## 7. Library API, validation, invariants, CLI

### 7.1 Public API (`js/routelab.js`)

`RouteLab` in the browser and `require('./js/routelab.js')` in Node expose:

| Member | Behaviour |
|---|---|
| `VERSION` | `'1.0.0'` (equals package.json) |
| `CSP_META` | `true` (2.4) |
| `METHODS`, `METHOD_LABELS`, `STRATEGY_IDS`, `POLICY_IDS`, `POLICY_LABELS`, `REASONS`, `REASON_LABELS`, `GATEWAY_IDS`, `BANK_IDS` | constants of 3.2 |
| `scenarios` | array of `{ id, title, story, changes, expectationText, focus }` in 6.2 order (`changes` is the verbatim 6.2 "Changes from the base" cell) |
| `RESULTS_SEEDS`, `ROBUST_SEEDS` | 6.5 |
| `getScenario(id)` | a fresh normalised configuration for the preset; `RangeError('unknown scenario: ' + id)` otherwise |
| `validateConfig(input)` | `{ ok, config, errors }` (7.2); never throws; `config` is the normalised copy when `ok`, else `null` |
| `createRunner(config, options)` | validates (on failure throws `TypeError('invalid config: ' + errors[0].path + ': ' + errors[0].message)`); `options = { scenarioId, seeds, seedStart }` all optional (`seeds`/`seedStart` override `run`, validated with the same limits, `RangeError` otherwise); returns `{ total, done, step(), isDone(), result() }` |
| `simulate(config, options)` | `createRunner`, step to completion, return `result()` |
| `toJson(results)`, `toCsv(results)`, `buildMemo(results, { generatedOn })` | section 8.10 |
| `encodeState(config)`, `decodeState(hash)` | section 8.9 |
| `charts` | the `charts.js` API |
| `prng`, `stats`, `config`, `model`, `strategies`, `engine`, `metrics`, `traffic` | module namespaces, for tests and advanced use |

Runner: units are `(seed, policy)` pairs in seed-major order (for each seed in order, for each policy of `results.policies` in order); `total = seeds * policies`. `step()` runs exactly one unit and returns `isDone()`; the traffic for a seed is generated by the first unit of that seed and dropped after its last. `result()` aggregates (5.7) and evaluates expectations when `options.scenarioId` is a preset id and the configuration equals that preset (5.7 `preset` rule); otherwise `expectations` is `null`. `result()` before completion throws `Error('runner not finished')`; `step()` after completion is a no-op returning `true`.

Example (Node):

```js
const RouteLab = require('./js/routelab.js');
const config = RouteLab.getScenario('peak-outage');
const results = RouteLab.simulate(config, { scenarioId: 'peak-outage', seeds: 20, seedStart: 1 });
console.log(results.summary.thompson.orderSr.mean, results.expectations.map(e => e.id + ' ' + e.held));
```

### 7.2 Configuration validation (`config.validateConfig`)

Input is untrusted (URL hash, `--config` file, library callers, UI). Rules, in this order (all errors are collected; each has `path` and `message`):

| Path | Rule | Message |
|---|---|---|
| (root) | a plain object, `v === 1` | `must be a RouteLab configuration object (v: 1)` |
| `run.seeds` | integer 1-100 | `must be a whole number from 1 to 100` |
| `run.seedStart` | integer 0 to 4294967295 - seeds | `must be a whole number from 0 to <max>` |
| `run.txnPerDay` | integer 100-50000 | `must be a whole number from 100 to 50,000` |
| `traffic.hourly` | array of exactly 24 numbers, each 0-10, sum > 0 | `must be 24 numbers from 0 to 10, not all 0` |
| `traffic.mix.<m>` | number 0-100 for each method; sum > 0 | `must be a number from 0 to 100` / `traffic.mix: at least one method needs a share above 0` |
| `traffic.customerDecline.<m>` | number 0-0.9 | `must be a number from 0 to 0.9` |
| `traffic.amount.<m>.p50` | number 1-1000000 | `must be a number from 1 to 1,000,000` |
| `traffic.amount.<m>.p95` | number, `p50 < p95 <= 50 * p50` | `must be above p50 and at most 50 times p50` |
| `traffic.banks` | exactly 3 objects with ids X, Y, Z in order; `share` 0-100 (sum > 0); `srFactor` 0-1 | `must list Bank X, Bank Y and Bank Z`; `traffic.banks[i].share`: `must be a number from 0 to 100`; sum: `traffic.banks: at least one bank needs a share above 0`; `traffic.banks[i].srFactor`: `must be a number from 0 to 1` |
| `gateways` | array of 2-5 objects; ids `A`, `B`, ... in order | `must be 2 to 5 gateways named A, B, C, D, E in order` |
| `gateways[i].activeFrom` | integer 0-1439 | `must be a whole minute from 0 to 1439` |
| `gateways[i].capacityTpm` | `null` or integer 1-100000 | `must be empty or a whole number from 1 to 100,000` |
| `gateways[i].methods.<m>` | `null` or object | `must be null (not supported) or a method object` |
| `...<m>.sr` | number 0-1 | `must be a number from 0 to 1` |
| `...<m>.p50` | number 100-600000 (ms) | `must be from 100 ms to 600,000 ms` |
| `...<m>.p95` | number, `p50 < p95 <= min(600000, 50 * p50)` | `must be above p50, at most 50 times p50 and at most 600,000 ms` |
| `...<m>.fixedFee` | number 0-1000 | `must be a number from 0 to 1,000` |
| `...<m>.pctFee` | number 0-10 | `must be a number from 0 to 10` |
| coverage | for every method with mix > 0, at least one gateway with `activeFrom === 0` supports it | `gateways: no gateway available at 00:00 supports <Method label>` |
| `events` | array of at most 20 | `must have at most 20 events` |
| `events[j].target`, `.id` | `'gateway'` with an existing gateway id, or `'bank'` with X, Y or Z | `must name an existing gateway or bank` |
| `events[j].methods` | array of distinct method ids (empty = all) | `must be a list of payment methods` |
| `events[j].start` | integer 0-1439 | `must be a whole minute from 0 to 1439` |
| `events[j].duration` | integer 1-1440 | `must be from 1 to 1,440 minutes` |
| `events[j].srFactor` | number 0-1 | `must be a number from 0 to 1` |
| `events[j].latencyFactor` | number 1-10; exactly 1 for bank events | `must be from 1 to 10` / `must be 1 for a bank event` |
| `events[j].recovery` | integer 0-240 | `must be from 0 to 240 minutes` |
| `events[j].repeatEvery` | 0, or integer with `duration + recovery <= repeatEvery <= 1440` | `must be 0 or at least duration + recovery (and at most 1,440)` |
| `events[j].repeatCount` | integer 1-48; exactly 1 when `repeatEvery === 0` | `must be from 1 to 48 (1 when the event does not repeat)` |
| `retry.maxRetries` | integer 0-3 | `must be 0, 1, 2 or 3` |
| `retry.mode` | `'other'` or `'same'` | `must be "other" or "same"` |
| `retry.delaySec` | number 0-60 | `must be from 0 to 60 seconds` |
| `dropoff.base`, `.max` | numbers 0-1, `base <= max` | `must be from 0 to 1` / `dropoff.base must not exceed dropoff.max` |
| `dropoff.perSec` | number 0-0.1 | `must be from 0 to 0.1` |
| `strategies.<id>.enabled` | boolean; at least one strategy enabled | `strategies: switch on at least one strategy` |
| `strategies.static.priority` | a permutation of all gateway ids | `must list every gateway exactly once` |
| `strategies.weighted.weights.<G>` | number 0-100 for every gateway; sum > 0 when enabled | `must be from 0 to 100` / `strategies.weighted: at least one weight above 0` |
| `strategies.rules.rules` | array of at most 20; `method` a method id or `'any'`; `minAmount` 0-1000000; `maxAmount` `null` or `> minAmount` and <= 1000000; `gateway` an existing id | `must have at most 20 rules`; `strategies.rules.rules[k].method`: `must be a payment method or "any"`; `.minAmount`: `must be a number from 0 to 1,000,000`; `.maxAmount`: `must be empty or above minAmount (at most 1,000,000)`; `.gateway`: `must name an existing gateway` |
| `strategies.egreedy.epsilon` | number 0-1 | `must be from 0 to 1` |
| `strategies.<learning>.memory` | `kind` in `none`, `window`, `discount`; `minutes` integer 1-1440 (kept but unused for `none`) | `must be none, window or discount` / `must be from 1 to 1,440 minutes` |
| `strategies.thompson_cost.lambda` | number 0-1 | `must be from 0 to 1` |
| `compare.baseline` | an enabled strategy id | `must be a strategy that is switched on` |
| `focus` | `null` or `{start, end}` integers, multiples of 15, `0 <= start < end <= 1440` | `must be empty or a 15-minute-aligned window inside the day` |

Type rules: numbers must be finite JavaScript numbers (strings such as `"0.5"` are rejected, so the UI converts field text first); integers must satisfy `Number.isInteger`. Unknown keys are dropped; the prototype keys `__proto__`, `constructor` and `prototype` are never copied (iterate with `Object.keys` over JSON-parsed input; build output objects fresh in 3.2 key order). Missing optional sections are not filled from defaults: every section is required, so a link or file always means exactly one configuration. Arrays longer than their limits are rejected, not truncated. The validator caps its work: oversized inputs are rejected before parsing by `decodeState` (hash string longer than 64,000 characters, 8.9) and by the CLI (`--config` file larger than 64,000 bytes, 7.4). `config.isRenderable(input)` (pure, never throws, unit-tested in `config.test.cjs`) is the structural check the UI applies to a decoded hash before filling the Configure form (8.3). It returns `true` only when: `input` is a plain object; `run`, `traffic`, `retry`, `dropoff`, `strategies` and `compare` are present and plain objects, `gateways` and `events` are arrays, and `focus` is `null` or a plain object; `traffic.mix`, `traffic.customerDecline` and `traffic.amount` are plain objects and every `traffic.amount.<m>` (for each of the 4 `METHODS`) is a plain object; `traffic.hourly` is an array of length 24; `traffic.banks` is an array of length 3 of plain objects; `gateways` has length 2-5 and each entry is a plain object whose `methods` is a plain object in which each of the 4 `METHODS` keys is `null` or a plain object (a missing key counts as not renderable); `strategies.static`, `.weighted`, `.rules`, `.egreedy`, `.thompson` and `.thompson_cost` are plain objects; `strategies.static.priority` is an array with length equal to `gateways.length`; `strategies.weighted.weights` is a plain object; `strategies.rules.rules` and `events` are arrays of length at most 20 whose entries are plain objects; every learning strategy's `memory` is a plain object; every `gateways[i].id === GATEWAY_IDS[i]` and every `traffic.banks[i].id === BANK_IDS[i]` (strict string equality), so the element ids that the form derives from them (8.6) are always `a`..`e` and `x`..`z` and unique. Other leaf values may be of any type (they are checked by `validateConfig`).

### 7.3 Invariants and where they are enforced

| Invariant | Owner | Why there |
|---|---|---|
| Every transaction ends exactly once with one of `REASONS`; `sum(reasons) = n` | engine (structure: an end is recorded only at the three exit points of 3.5) | Only the engine sees the life cycle; tests count it for every preset |
| Attempts per transaction `<= 1 + maxRetries` | engine | Same |
| `orderSr >= firstSr`; regret `>= 0`; oracle regret `= 0` | engine (definitions) | Follow from 3.5 and 3.6; asserted in tests |
| Fees, costs `>= 0` | validation (fee limits) + engine (only adds fees) | Validation rejects negative fees at the boundary |
| Shares in a bucket sum to 1 | metrics (computed from counts of one denominator) | Asserted with tolerance 1e-9 |
| Every enabled method can be routed at minute 0 | validation (coverage rule) | Prevents `no_route` on first attempts by construction |
| No future information | engine (updates applied at completion events, in time order) | Tested by E7 (10.1) |
| Determinism and pairing | prng streams + 2.6 ordering rules | Tested: same input same JSON; switching one strategy off leaves the others' results unchanged |

### 7.4 CLI (`scripts/simulate.cjs`)

```
node scripts/simulate.cjs --scenario <id> [--seeds N] [--seed-start S] [--txns N] [--format text|json|csv|memo] [--out <file>] [--assert]
node scripts/simulate.cjs --config <file.json> [--scenario <id>] [same options]
node scripts/simulate.cjs --list
node scripts/simulate.cjs --help
```

- Argument validation happens before any file is read: unknown flags, a flag given twice, a missing value, unknown `--scenario`, non-integer or out-of-range `--seeds` (1-100), `--seed-start` (0 to 4294967295 - seeds) or `--txns` (100-50000), unknown `--format`, neither `--scenario` nor `--config` (unless `--list`/`--help`), positional arguments: message `routelab: <problem>` plus the usage on stderr, exit 2.
- `--config`: the file must exist, be at most 64,000 bytes, be UTF-8 JSON and pass `validateConfig`; otherwise `routelab: <file>: <problem>` (with the first three validation errors, `path: message`), exit 1. With `--config`, `--scenario` names the preset to compare against (for `preset` and expectations).
- `--seeds`, `--seed-start`, `--txns` override `run` (applied before validation). Defaults come from the configuration (presets: 20 seeds from 1).
- Output to stdout (or `--out`, written atomically: temporary file in the same folder, then rename; an unwritable path is exit 1).
- `text` format (default):

```
RouteLab 1.0.0 - Evening-peak outage on the best gateway (peak-outage)
Synthetic data and illustrative assumptions; results show mechanisms, not real-world success rates.
Seeds 1-20 (20). About 10,000 transactions per seed. Baseline: Static priority.

Strategy              Order SR             First-attempt SR     Cost/success      p95 time   Drop-off  Regret/1k
Static priority       90.72% +-0.12        ...
...
Oracle (reference)    ...

Paired difference vs Static priority (order SR, percentage points; 95% CI)
Weighted split        +0.26 (+0.19 to +0.33)
...

Focus window 19:30-20:30: order SR
...

Expectations (seeds 1-20)
PASS PO1 Thompson sampling - Static priority, order SR 19:30-20:30: +11.56 pp (95% CI +10.95 to +12.17); required at least +5.00 pp and CI above 0.
...
```

  Focus block (only when `focus` is not null): the heading line `Focus window <HH:MM>-<HH:MM>: order SR`, then one row per policy in `results.policies` order: the policy label padded to 22 characters, then the focus order SR in the Order SR column format (`91.47% +-0.31`, padded to 21 characters). For `collect-degradation` (and any configuration whose focus summary has per-method values), the heading line is followed by a header row (`Strategy` padded to 22, then `All methods` and each method label in `METHODS` order, each padded to 21) and each policy row adds one column per method in the same format; a null value prints `n/a`.
  Column rules: SR as percent with 2 decimals and `+-` the CI half-width in percentage points (2 decimals); cost `Rs 13.68 +-0.05`; p95 time in seconds with 1 decimal; drop-off percent with 2 decimals; regret with 1 decimal. Columns are left-aligned and padded with spaces to the widths of the header (`padEnd`). Numbers above are placeholders; real values come from the run. `FAIL` and `SKIP` (held null) are printed the same way.
- `json`: `toJson(results)`; `csv`: `toCsv(results)`; `memo`: `buildMemo(results, { generatedOn: <today's local date YYYY-MM-DD> })`.
- `--list`: one line per preset, `<id>  <title>`.
- Exit codes: 0 success; 1 file, configuration or write error; 2 bad arguments; 3 with `--assert` when any expectation has `held === false` (output still written).

### 7.5 Results generator (`scripts/results.cjs`)

`node scripts/results.cjs [--check]`

- Runs every preset with `RESULTS_SEEDS` and with `ROBUST_SEEDS` (`scenarioId` set, so expectations are evaluated).
- Writes `docs/results.json`: `{ "schema": "routelab.results-set.v1", "version": "1.0.0", "seedSets": { "results": { "seedStart": 101, "seeds": 30 }, "robust": { "seedStart": 1, "seeds": 20 } }, "scenarios": [ { "id", "title", "configHash", "focus", "summary", "status", "paired", "focusSummary", "expectations": { "results": [...], "robust": [...] }, "headlines": [ { "text", "mean", "ciLow", "ciHigh" } ] } ] }` where the summaries come from the `RESULTS_SEEDS` run (no `series`, no `perSeed`, no `config`), rounded as 5.7, serialised as `JSON.stringify(obj, null, 2) + '\n'`.
- Writes `docs/RESULTS.md` (generated, never edited by hand), rendered only from the in-memory object that was written to `results.json`: a header ("Generated by `npm run results` from RouteLab 1.0.0. Seeds 101-130 (30). Synthetic data and illustrative assumptions; these numbers show how the strategies behave under the model in docs/MODEL.md, not real-world success rates. Not financial advice."); a "How to read this" paragraph (means with 95% t-intervals across seeds; paired differences against static priority; pp = percentage points); then per scenario: title, story, changes from the base (the preset's `changes` string, 6.2), expected outcome (`expectationText`), the summary table (strategy, order SR, first-attempt SR, cost per success, effective fee rate, time to success p95, drop-off, regret per 1,000; each `mean (low to high)`), the paired table, the focus-window table (order SR and, for `collect-degradation`, per method; for `cold-start` and `steady`, shares), the status table, and the expectation table with PASS/FAIL for both seed sets; finally "Reproduce: `npm run results`; check: `npm run results -- --check`."
- Updates the README block between `<!-- results:start -->` and `<!-- results:end -->` with the scenarios table of 12.1 item 9 (only that block is rewritten; if the markers are missing, exit 1 with a message).
- Prints the SHA-256 of `docs/results.json` and `docs/RESULTS.md`.
- `--check`: writes nothing. Generates everything twice in memory, compares the two SHA-256 sets, and compares them with the files on disk (and the README block); prints `IDENTICAL` or the first difference; exit 0 when all are identical, else 1.
- Exit 1 also when any expectation in either seed set has `held !== true` (after writing, so the failure is visible in RESULTS.md); the report must then list it as a finding.

## 8. UI (`index.html`, `css/app.css`, `js/ui.js`)

### 8.1 Overall structure

- `<html lang="en">`. Title: "RouteLab - payment routing and success-rate simulator". System font stack `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`; numbers in tables use `font-variant-numeric: tabular-nums`.
- Elements in order:
  1. Skip link `#rl-skip` ("Skip to content", target `#rl-main`).
  2. Header `#rl-header`: `<h1>` "RouteLab"; tagline "Compare payment-routing strategies on synthetic UPI, card and netbanking traffic. Runs in your browser; nothing is uploaded."
  3. Disclaimer `#rl-disclaimer` (always visible): "Synthetic data and illustrative assumptions. Results show how routing mechanisms behave, not real-world success rates. Not financial advice."
  4. Status line `#rl-status` (`role="status"`, `aria-live="polite"`) containing `#rl-status-text`.
  5. Banner `#rl-newhere` (`hidden` unless 8.3 shows it): "New here? The Help tab explains what you are looking at." with `#rl-newhere-help` ("Open Help") and `#rl-newhere-close` ("Dismiss").
  6. Tab list `#rl-tablist` (`role="tablist"`, `aria-label="Sections"`): `#rl-tab-help` "Help", `#rl-tab-scenarios` "Scenarios", `#rl-tab-config` "Configure", `#rl-tab-results` "Results".
  7. `<main id="rl-main" tabindex="-1">` with `#rl-panel-help`, `#rl-panel-scenarios`, `#rl-panel-config`, `#rl-panel-results` (`role="tabpanel"`, `aria-labelledby` = their tab).
  8. Footer: "RouteLab 1.0.0 - MIT licence - synthetic data only; nothing leaves this page. Not financial advice."
- Layout: max width 1200 px, centred; no horizontal page scroll at 320 px; wide tables in `div.rl-scroll` (`overflow-x: auto`, `tabindex="0"`, `role="region"` with an `aria-label`); charts scale to the container width (`width: 100%; height: auto`).

### 8.2 Tabs

WAI-ARIA tabs with automatic activation: each tab is a `<button role="tab" aria-selected aria-controls>`; only the selected tab has `tabindex="0"`; Left/Right arrows move and select (wrapping); Home/End select first/last; hidden panels have the `hidden` attribute.

### 8.3 Start-up and which tab opens first

1. Load the `peak-outage` preset as the configuration (not run); "last loaded preset" = `peak-outage`.
2. If `location.hash` is non-empty: `decodeState` (8.9).
   - Success and the decoded configuration is valid: use it; last loaded preset = the preset it equals ignoring `run.seeds`/`run.seedStart` (the first match in 6.2 order), else none; select Results and start a run (8.12); if the help-seen flag is not set, show `#rl-newhere`. Status: "Loaded the settings from the link."
   - Decoded, invalid and renderable (`config.isRenderable(decoded.config)` is `true`, 7.2): use it in Configure, select Configure; status "The link's settings have problems; fix the marked fields, then run." Each field shows its leaf value converted as 8.6 when the leaf is a finite number, otherwise `String(value)`, or an empty field when the leaf is `undefined`, `null` (except `capacityTpm` and `maxAmount`, where empty already means `null`), an object or an array; checkboxes and selects are set only when the leaf is a boolean or one of the select's values, otherwise left unticked or at their first option. Event method checkboxes: when `methods` is an array, tick every box when it is empty, otherwise tick exactly the methods whose id appears in it (`===` comparison); when it is not an array, tick none (which then shows "Choose at least one payment method."). Event target select: selected when `target` and `id` together name one of its options (`'gateway'` + a rendered gateway id, or `'bank'` + X, Y or Z), otherwise the first option. Then the UI converts the fields and validates once immediately (8.7), so the field errors show without any user action. Last loaded preset = none.
   - Decoded but not renderable (`config.isRenderable` is `false`): handled exactly like "Not decodable" below, but with the status "This link's settings could not be shown, so the default scenario was loaded." Then continue with step 3.
   - Not decodable: keep the default; status "This link could not be read, so the default scenario was loaded." Then continue with step 3.
3. Without a usable hash: Help if the help-seen flag is not set, otherwise Scenarios.
4. Write the hash once immediately (8.9), so the address always holds the full configuration.

"Help seen" is set (`storageSet('routelab.helpSeen.v1', '1')`) when the user clicks `#rl-help-start` or `#rl-help-run`, selects any non-Help tab, or clicks `#rl-newhere-close` or `#rl-newhere-help`. Both newhere buttons hide the banner; `#rl-newhere-help` also selects Help. If storage is unavailable, everything works and help counts as unseen on each visit, without errors or messages.

### 8.4 Help panel (`#rl-panel-help`), static HTML, in this order

1. "What RouteLab does" (3 sentences: simulates one day of a merchant's payments across fictional gateways; compares routing strategies on the same traffic over many seeds; everything is synthetic and runs in this page), with `#rl-help-start` ("Start with a scenario", selects Scenarios) and `#rl-help-run` ("Run the outage example", loads `peak-outage` and runs).
2. "Quick start": pick a scenario; press Load and run; read the Results tab (charts, table, expectation checks); change settings in Configure and run again; share the address or download the memo.
3. "How to read the results": order SR vs first-attempt SR; mean and 95% interval across seeds; paired differences ("same traffic for every strategy, so the difference is measured seed by seed"); the oracle and regret; "held on these seeds" means the documented expectation was met for this run's seeds, not a guarantee.
4. "Routing strategies": one subsection each for the 6 strategies and the oracle, each with a one-sentence plain explanation followed by "Precisely:" and the rule from section 4 in words (including the Beta update and discounting for Thompson sampling, the window for epsilon-greedy and the cost-aware score).
5. "Scenarios": a table (`#rl-help-scenarios`) with title and `expectationText` for each preset.
6. "Assumptions and limitations": 6-8 bullets summarising MODEL.md section 10, ending with "The full list, the formulas and the sources are in docs/MODEL.md in the repository."
7. "Glossary" (`<dl id="rl-glossary">`), at least: Success rate (SR); Order SR; First-attempt SR; Attempt SR; MDR (merchant discount rate); Fee per success; UPI intent; UPI collect; Issuer and remitter bank; Acquirer; Payment gateway; PSP (payment service provider); Business (customer-side) decline; Technical decline; Retry and failover; Drop-off; Multi-armed bandit; Exploration and exploitation; Epsilon-greedy; Thompson sampling; Beta distribution; Non-stationary; Sliding window; Discounting and half-life; Oracle; Regret; Seed; Confidence interval; Paired comparison; Common random numbers. Definitions are written for this page in plain words (no real company names).
8. "Privacy": the network sentence of 2.4; no analytics, no cookies; localStorage only for the help flag; the address bar holds your settings (browsers do not send the part after `#` to the server, but anyone with the link can read the settings).
9. "Reproducibility": "The same settings and seeds always give the same results. The page, the Node library and the command line use the same code."
10. "Not financial advice": "RouteLab is an educational simulator. It does not describe any real gateway, bank or merchant and is not financial, legal or regulatory advice."

### 8.5 Scenarios panel (`#rl-panel-scenarios`)

- `<fieldset>` legend "Scenario" with one radio per preset (`name="rl-scn"`, id `rl-scn-<id>`, label = title), in 6.2 order; the selected radio is the last loaded preset if any, else `peak-outage`.
- Under the group, `#rl-scn-detail` shows the selected preset: title (`h3`), "What to expect" (`expectationText`, which starts with the story) and "Checked by the test suite on seeds 1-20 and 101-130."
- Buttons: `#rl-scn-load` "Load into Configure" (loads the preset, selects Configure, status "Loaded the <title> preset.") and `#rl-scn-run` "Load and run" (loads, then runs, 8.12). Loading replaces the current configuration; when the current configuration was custom, the status adds " Your previous settings were replaced."

### 8.6 Configure panel (`#rl-panel-config`)

Static and generated controls. Generated ids are derived from configuration ids (gateway `a`..`e`, method `upi-intent`, `upi-collect`, `card`, `netbanking`, bank `x`..`z`, strategy `static`, `weighted`, `rules`, `egreedy`, `thompson`, `thompson-cost`) or from list counters that only ever increase during the page's life (`rl-cfg-ev-<n>-...`, `rl-cfg-rule-<n>-...`; `n` starts at 1 and is never reused, even after removal), so ids never collide. Fields show configuration units converted for people, for exactly these fields: through `toPercent`/`fromPercent` (stored as a fraction 0-1, shown 0-100): gateway method `sr`, `traffic.customerDecline.<m>`, bank `srFactor`, event `srFactor`, `dropoff.base`, `dropoff.perSec`, `dropoff.max`, `strategies.egreedy.epsilon`; shown as stored, without conversion (already 0-100 or already in display units): `traffic.mix.<m>`, bank `share`, `strategies.weighted.weights.<G>`, `pctFee`, `fixedFee`, amounts, `thompson_cost.lambda`, counts, minutes and `retry.delaySec`; through `toSeconds`/`fromSeconds`: gateway method `p50` and `p95`; times as `HH:MM` (`<input type="time" step="60">`; the end of the day is entered as `24:00` only in the focus end field, which is a text input with pattern `^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$`). Conversions both ways use the field codecs listed after the fieldsets (`config.codec`), never ad-hoc arithmetic in `ui.js`.

Fieldsets, in order:

1. "Run": `#rl-cfg-seeds` (1-100), `#rl-cfg-seed-start`, `#rl-cfg-txns` (100-50,000), each `type="number"`.
2. "Traffic": per method `#rl-cfg-mix-<m>` (share %), `#rl-cfg-decline-<m>` (%), `#rl-cfg-amt-<m>-p50`, `#rl-cfg-amt-<m>-p95` (Rs); banks `#rl-cfg-bank-<x>-share` (%), `#rl-cfg-bank-<x>-factor` (%); `<details id="rl-cfg-hourly">` "Hourly traffic shape" with 24 inputs `#rl-cfg-hour-<hh>` (`hh` = `00`..`23`).
3. "Gateways": one sub-fieldset per gateway (`#rl-cfg-gw-<g>`, legend "Gateway <G>") with `#rl-cfg-gw-<g>-active` (time), `#rl-cfg-gw-<g>-cap` (number; empty = no limit) and a table with one row per method: `#rl-cfg-gw-<g>-<m>-on` (checkbox "Supports <Method>"), `-sr` (%), `-p50` and `-p95` (s), `-fixed` (Rs), `-pct` (%). Unticking "Supports" disables the row's inputs and stores `null`; ticking restores the last values (or the base defaults of gateway C for that method). `#rl-cfg-gw-add` "Add a gateway" (disabled at 5; the new gateway gets the next id, gateway C's base values, `activeFrom 0`, is appended to the static priority, gets weight 0, and receives no rules). `#rl-cfg-gw-remove` "Remove the last gateway" (disabled at 2; removes it from the priority and weights and deletes rules and events that name it; status "Removed Gateway <G>, <r> rule(s) and <e> event(s) that used it.").
4. "Events": one sub-fieldset per event (`#rl-cfg-ev-<n>`, legend "Event <k>" where `k` is its 1-based position) with `-target` (select: "Gateway A" ... and "Bank X", "Bank Y", "Bank Z"), method checkboxes `-m-<m>` (all ticked = `methods: []`; none ticked is a field error "Choose at least one payment method."), `-start` (time), `-duration` (min), `-sr` ("Success rate during the event, % of normal": `srFactor * 100`), `-lat` (latency factor; disabled with value 1 for bank targets), `-recovery` (min), `-repeat-every` (min, 0 = once), `-repeat-count`, and `-remove` ("Remove event <k>"). `#rl-cfg-ev-add` "Add an event" (disabled at 20; new event: Gateway A, all methods, 18:00, 30 min, 20%, factor 1, recovery 0, once).
5. "Retries and drop-off": `#rl-cfg-retries` (select 0-3), `#rl-cfg-retry-mode` (select "Another gateway" = `other`, "The same gateway" = `same`), `#rl-cfg-retry-delay` (s), `#rl-cfg-drop-base` (%), `#rl-cfg-drop-persec` (% per second), `#rl-cfg-drop-max` (%), with the hint "Illustrative model: the chance that a customer gives up before a retry grows with waiting time."
6. "Strategies": per strategy a sub-fieldset `#rl-cfg-st-<s>` with `#rl-cfg-st-<s>-on` (checkbox "Include <label>") and its parameters: static `#rl-cfg-st-static-p<k>` (one select per position `k` = 1..G; choosing a gateway already used swaps the two positions, so the list stays a permutation); weighted `#rl-cfg-st-weighted-<g>` (%); rules list (`#rl-cfg-rule-<n>-method` select with "Any method", `-min`, `-max` (empty = no upper limit), `-gateway`, `-remove`) and `#rl-cfg-rule-add` (disabled at 20); epsilon-greedy `#rl-cfg-st-egreedy-eps` (%), `#rl-cfg-st-egreedy-mem` (select "No forgetting", "Sliding window", "Discounting"), `#rl-cfg-st-egreedy-min` (label changes to "Window (minutes)" or "Half-life (minutes)"; disabled for "No forgetting"); Thompson `#rl-cfg-st-thompson-mem`, `-min`; cost-aware `#rl-cfg-st-thompson-cost-lambda` (number 0-1, label "Lambda: success probability traded per rupee of fee", hint "0.01 means saving Rs 1 is worth 1 percentage point of success"), `-mem`, `-min`.
7. "Comparison": `#rl-cfg-baseline` (select of enabled strategies), `#rl-cfg-focus-start` (`type="time"`) and `#rl-cfg-focus-end` (text, `HH:MM` or `24:00`). Both empty = no focus window (`focus: null`); both filled = `{ start, end }`, validated as 7.2; exactly one filled is a field error (8.7).

Field codecs (pure, in `config.js` as `config.codec`, unit-tested in `config.test.cjs`; `ui.js` uses only these):

- `toPercent(v)` = `Number((v * 100).toPrecision(12))`, shown with `String()`; `fromPercent(x)` = `Number((x / 100).toPrecision(12))`. So `0.07` displays as `7`, not `7.000000000000001`, and converts back to `0.07`.
- `toSeconds(ms)` = `Number((ms / 1000).toPrecision(12))`; `fromSeconds(s)` = `Math.round(s * 1000)`.
- `toHHMM(min)` = zero-padded `HH:MM` (1440 gives `24:00`); `fromHHMM(text, allow2400)` returns the minute or `null` when the text does not match `^([01][0-9]|2[0-3]):[0-5][0-9]$` (or `^24:00$` when `allow2400`).
- Test: for every preset, every field shown in percent or seconds (8.6) converted with `to...` then `from...` gives back the identical value, and the configuration rebuilt from the converted fields has identical canonical JSON.

Buttons after the fieldsets: `#rl-cfg-run` "Run with these settings" and `#rl-cfg-reset` "Reset to the <title> preset" (only enabled when a preset was loaded; restores it; status "Restored the <title> preset.").

### 8.7 Validation display

- On every `change` (and `input` for number and text fields, debounced 300 ms) the UI converts all fields to a configuration and calls `validateConfig`.
- Each error path maps to one field id (a fixed mapping table in `ui.js`; errors without a field, such as coverage, map to the fieldset). The field gets `aria-invalid="true"` and its error element `<id>-err` (`class="rl-field-err"`, linked by `aria-describedby`) shows the message in plain words with the label, for example "Gateway A, Card success rate: must be a number from 0 to 100." (the UI's message table translates the units it displays). Translation rules, applied only to the fields that 8.6 converts: for `toPercent` fields, every 7.2 limit is multiplied by 100 (`sr`, `srFactor` of events and of banks, `dropoff.base`/`.max`, `epsilon`: "must be a number from 0 to 100" or "must be from 0 to 100"; `customerDecline`: "must be a number from 0 to 90"; `dropoff.perSec`: "must be from 0 to 10"), and `dropoff.base must not exceed dropoff.max` becomes "Drop-off at the start must not exceed the maximum drop-off."; for `toSeconds` fields, ms limits are divided by 1000 (`p50`: "must be from 0.1 s to 600 s"; `p95`: "must be above p50, at most 50 times p50 and at most 600 s"). Fields shown as stored use the 7.2 message unchanged. The translation is the pure helper `config.codec.displayMessage(path, message)` (it returns the translated message, or `message` unchanged); `ui.js` calls it and adds the field label. It is unit-tested in `config.test.cjs` (one case per translated message above, plus one unchanged case for `traffic.mix.card`), and smoke R09 checks the `sr` text.
- `#rl-cfg-errors` (above the buttons, `role="region"`, `aria-label="Problems to fix"`) lists all problems as links that focus the field. Both Run buttons and `#rl-scn-run` stay enabled; pressing Run with problems focuses `#rl-cfg-errors`, selects Configure and shows the status "Fix <N> problem(s) before running." No run starts.
- A field that cannot be parsed as a number (empty where a number is required) is reported as "Enter a number." before calling the validator, and that field's value is not changed in the configuration.
- Time fields: a time that `fromHHMM` rejects (in practice the text field `#rl-cfg-focus-end`, because `type="time"` inputs only yield valid values or empty) shows "Enter a time as HH:MM." and does not change the configuration. Focus window: if exactly one of `#rl-cfg-focus-start` and `#rl-cfg-focus-end` is empty, the empty one shows "Enter both times, or leave both empty." and the configuration keeps its previous `focus` value; when both are empty, `focus` becomes `null`. These UI-level errors count as problems for the Run buttons and `#rl-cfg-errors` exactly like validator errors.

### 8.8 Results panel (`#rl-panel-results`)

- Heading `#rl-res-heading` ("Results", `tabindex="-1"`).
- `#rl-res-empty` "No results yet. Choose a scenario and press Load and run." (shown until the first run).
- Run progress `#rl-run-progress` (`<progress id="rl-run-bar" max="<total>" value="<done>">` plus text `#rl-run-text`, "Running seed 7 of 20...").
- `#rl-res-summary`: "<`results.title`>: <seeds> seeds (<a>-<b>), about <txnPerDay> transactions per seed, <k> strategies plus the oracle. Ran in <ms> ms." and `#rl-run-time` (a `<span>` with the ms number, also in attribute `data-ms`); `#rl-res-stale` ("Settings changed since this run. Run again to update.", hidden unless the current configuration's canonical JSON differs from the run's).
- `#rl-res-expect` ("What to expect"): for a preset run, `expectationText` and a list with one item per expectation row: "Held on these seeds" / "Did not hold on these seeds" / "Not checked" followed by the row's `detail`; for a custom run: "Expectations apply to the unmodified presets; these settings are custom."
- Chart 1 `#rl-ch-sr` (figure, caption "Order success rate over the day"), select `#rl-ch-sr-method` ("All methods" and the 4 methods); chart 2 `#rl-ch-share` ("Share of first attempts by gateway"), select `#rl-ch-share-policy` (enabled policies and the oracle; default the first learning policy enabled, else static); chart 3 `#rl-ch-scatter` ("Cost per success vs order success rate"). Each figure has a text legend (`ul.rl-legend`) and a `<details>` "Show the data" with a table (`#rl-ch-sr-table`, `#rl-ch-share-table`, `#rl-ch-scatter-table`): hourly rows (pooling the four buckets of each hour) for charts 1 and 2, one row per policy for chart 3. Chart 2's figure also has a second `<details>` "Gateway attempt success rate by hour" with `#rl-ch-gwsr-table` for the policy chosen in `#rl-ch-share-policy`: 24 hourly rows, one column per gateway, each cell from `series.hourly.gatewayAttemptSr` (percent with 2 decimals, `n/a` for null, that is when the gateway had no attempts that hour). This is where "SR by gateway over time" is shown; it is a table only, without a chart.
- Summary table `#rl-res-table` (caption "Results by strategy (mean and 95% interval across seeds)"): columns Strategy, Order SR, First-attempt SR, Cost per success, Effective fee rate, Time to success p95, Drop-off, Retries per transaction, Regret per 1,000. Cells: mean on the first line, interval on the second ("94.90-95.34%"), `n/a` for null. One row per policy in `results.policies` order; the oracle row has class `rl-ref` and the label "Oracle (reference)".
- Paired table `#rl-res-paired` (caption "Difference from <baseline label>, paired by seed"): Strategy, Order SR (pp), First-attempt SR (pp), Cost per success (Rs), Regret per 1,000; each "+1.23 (+0.98 to +1.48)".
- Focus table `#rl-res-focus` (only when `focus` is set; caption "During <HH:MM>-<HH:MM>"): order SR, first-attempt SR, order SR per method, share per gateway.
- Status table `#rl-res-status` (caption "How transactions ended (share of all transactions)"): one column per reason with `REASON_LABELS`.
- Exports `#rl-exp-csv` "Download CSV", `#rl-exp-json` "Download JSON", `#rl-exp-memo` "Download memo (Markdown)", `#rl-exp-copy` "Copy memo"; `<details id="rl-memo">` "Preview the memo" with `<pre id="rl-memo-preview">`.

Number formats (`ui.js` and `memo.js` share `memo.format`): SR and shares as percent with 2 decimals (`95.12%`); differences in percentage points with sign and 2 decimals (`+1.23`); rupees with 2 decimals (`Rs 13.57`); seconds with 1 decimal; regret with 1 decimal; integers with thousands separators in prose (`10,000`).

Charts (`charts.js`, pure). Each function returns a tree `{ tag, attrs, children, text }` that `ui.js` renders with `document.createElementNS('http://www.w3.org/2000/svg', tag)` and `setAttribute` (never `innerHTML`):

- Common: `viewBox="0 0 720 320"`, `role="img"`, `aria-labelledby="<id>-title <id>-desc"`, `<title id="<id>-title">` and `<desc id="<id>-desc">` (a one-sentence summary naming the metric, the policies and any events, for example "Order success rate in 15-minute buckets for 7 strategies, pooled over 20 seeds. Shaded: Gateway A event 19:30-20:15, recovery to 20:30."). Plot area x 56-704, y 16-272; x axis 00:00-24:00 with ticks every 3 hours; 5 y ticks with labels; axis lines `#4a4a4a`.
- Chart 1: y range from `max(0, floor((min - 0.01) * 50) / 50)` to `min(1, ceil((max + 0.005) * 50) / 50)` over the plotted values; one `<polyline>` per policy (split at null buckets), stroke colour and dash from the table below, `stroke-width` 2 (3 for Thompson sampling), with markers every 8 buckets; shaded `<rect fill="#e5e7eb">` for each event occurrence (and a lighter `#f3f4f6` rect for its recovery), drawn before the lines.
- Chart 2: y 0-100%; one polyline per gateway with colours A `#1d4ed8`, B `#b45309`, C `#0f766e`, D `#be123c`, E `#7c3aed` and dashes `none`, `6 3`, `2 3`, `10 3 2 3`, `4 2`; a text label at the right end of each line.
- Chart 3: x = mean cost per success, y = mean order SR, each axis padded by 10% of its range (or 1% of the value when the range is 0); per policy a marker plus horizontal and vertical whiskers from the 95% intervals and a text label next to the marker.

| Policy | Colour | Dash | Marker |
|---|---|---|---|
| static | `#1f2937` | none | square |
| weighted | `#7c3aed` | `6 3` | diamond |
| rules | `#b45309` | `2 3` | triangle down |
| egreedy | `#0f766e` | `10 3 2 3` | cross |
| thompson | `#1d4ed8` | none (width 3) | circle |
| thompson_cost | `#be123c` | `4 2` | triangle up |
| oracle | `#6b7280` | `1 3` | none on lines; ring in the scatter |

All colours have at least 3:1 contrast against white (WCAG 1.4.11); dashes and markers make lines distinguishable without colour.

### 8.9 URL hash (`state.js`)

- Format `#s=<base64url(UTF-8 JSON of { "v": 1, "config": <config as edited, valid or not> })>`, no padding (`+` -> `-`, `/` -> `_`, `=` stripped). Encode with `TextEncoder` and `btoa` over the byte string; decode with `atob` and `new TextDecoder('utf-8', { fatal: true })` (globals in browsers and Node 22+).
- `encodeState(config)` returns the hash string including `#s=`. `decodeState(hash)` returns `{ ok: true, config }` (the raw parsed `config`, to be validated by the caller) or `{ ok: false, error }` and never throws; `error` is `empty` (no hash or `#`), `format` (not `#s=`), `too-long` (the whole hash string, including `#s=`, is longer than 64,000 characters; checked right after `empty` and before `format` or any decoding), `base64`, `utf8`, `json`, or `shape` (not an object with `v === 1` and an object `config`).
- Writing: `history.replaceState(null, '', h)` in try/catch, falling back to `location.replace(h)`; never push history entries; remember `lastHash` so the resulting `hashchange` is ignored. Written after each configuration change (debounced 400 ms), after loading a preset and after each run.
- `hashchange` with `location.hash !== lastHash`: handle as start-up step 2 (8.3), without changing the help flag. On `hashchange`, the not-decodable and not-renderable branches keep the current configuration and tab unchanged (no preset is reloaded), show their kept-settings status ("This link could not be read; your current settings are kept." or "This link's settings could not be shown; your current settings are kept."), and rewrite the hash from the current configuration (8.3 step 4).
- `static.test.cjs` forbids assignments to `location.hash`.

### 8.10 Exports and the memo (`memo.js`)

- File names: `routelab-<scenarioId>-summary.csv`, `routelab-<scenarioId>-results.json`, `routelab-<scenarioId>-memo.md` (`scenarioId` is `custom` for custom runs).
- Download: `new Blob([text], { type })` (`text/csv;charset=utf-8`, `application/json`, `text/markdown;charset=utf-8`), `URL.createObjectURL`, a temporary `<a download="<name>" href="<url>">` appended, clicked, removed, and the URL revoked after 0 ms (`setTimeout`). Status "Downloaded <name>."
- `toCsv(results)`: header `scenario,policy,metric,mean,ci_low,ci_high,sd,n`, then one row per policy (in `results.policies` order) and day metric (in 5.1 order), then paired rows with policy written as `<policy>-minus-<baseline>`, then focus rows with metric names `focus_orderSr`, `focus_firstSr`, `focus_orderSr_<method>`, `focus_share_<gateway>`; numbers as in the results object, nulls as empty fields; lines end with `\n`; no quoting needed (all fields are identifiers or numbers).
- `buildMemo(results, { generatedOn })` (`generatedOn` a `YYYY-MM-DD` string, required; `TypeError` otherwise) returns Markdown:

```
# Routing decision memo: <title or "Custom settings">

Generated by RouteLab 1.0.0 on <generatedOn>. Synthetic data and illustrative assumptions; this memo shows how routing strategies behave under the stated model, not what any real gateway would achieve. Not financial advice.

## Setup
<for a preset: "- Scenario: <title> (<id>)."; for custom: "- Scenario: custom settings (not an unmodified preset).">
- Traffic: about <txnPerDay> transactions per simulated day; method mix <UPI intent 55%, ...>; seeds <a>-<b> (<n>).
- Gateways: <for each: "Gateway A (technical SR: UPI intent 97.00%, UPI collect 93.00%, Card 96.00%, Netbanking 94.00%; fees: ...)">.
- Events: <one per event: "Gateway A, all methods, 19:30 for 45 min at 10% of normal SR, recovery 15 min"> or "none".
- Retries: up to <k> on <another|the same> gateway after <d> s; illustrative drop-off model (<base>% plus <perSec>% per second waited, at most <max>%).

## Results (mean across seeds, 95% interval)
| Strategy | Order SR | First-attempt SR | Cost per success | Effective fee rate | Time to success p95 | Drop-off | Regret per 1,000 |
|---|---|---|---|---|---|---|---|
<one row per policy; cells "95.12% (94.90-95.34)">

## Compared with <baseline label> (paired by seed)
| Strategy | Order SR (pp) | Cost per success (Rs) |
|---|---|---|
<rows "+1.23 (+0.98 to +1.48)">

## Reading
- Highest order SR: <label> (<x>%).<if its paired order SR difference against the baseline has ciLow > 0: " Its gain over <baseline> is <d> pp (95% CI <l> to <h>)."; if it is the baseline itself: " It is the baseline."; otherwise: " On these seeds it cannot be told apart from <baseline>.">
- Lowest cost per success: <label> (Rs <c>).
- <if the two differ: "Trade-off: <highest-SR label> has <d> pp higher order SR and Rs <c> higher cost per success than <lowest-cost label>."; else: "The same strategy is best on both.">
- <for a preset: "Expected for this scenario: <expectationText> On these seeds <k> of <m> checks held."; for custom: "Custom settings: no documented expectation applies.">

## Caveats
- Synthetic traffic and illustrative parameters (docs/MODEL.md lists every assumption and its source).
- Each strategy ran in its own simulated world on identical traffic; in production, strategies tested side by side share gateways, so validate a routing change with a controlled experiment such as a switchback test, with guardrails on cost, latency and duplicate charges.
- Intervals describe simulation noise under these assumptions only.
- Not financial advice.
```

  "Highest" and "lowest" exclude the oracle; ties go to the earlier policy in `POLICY_IDS`. The memo uses only `results` and `generatedOn`: `<title or "Custom settings">` is `results.title`, `<id>` is `results.scenarioId`, `<expectationText>` is `results.expectationText`, and `k of m` counts `results.expectations` with `held === true` out of all of them; `memo.js` never reads `scenarios.js` (2.3). `ui.js` passes the local date.
- Copy memo: `navigator.clipboard.writeText` when available and `window.isSecureContext`; otherwise or on rejection, select `#rl-memo-preview`'s text (open the details first) and `document.execCommand('copy')` in try/catch. Messages: "Copied the memo." or "Copy did not work in this browser. The memo text is selected; press Ctrl+C (Cmd+C on a Mac)." Never `console.error`.
- Exports and copy before any run: "Run a scenario first."

### 8.11 Storage

```js
var ALLOWED_KEYS = ['routelab.helpSeen.v1'];
function storageGet(key) { if (ALLOWED_KEYS.indexOf(key) < 0) return null; try { return window.localStorage.getItem(key); } catch (e) { return null; } }
function storageSet(key, value) { if (ALLOWED_KEYS.indexOf(key) < 0) return false; try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; } }
```

`ui.js` touches `localStorage` only inside these two functions; no `sessionStorage`, cookies or `indexedDB`.

### 8.12 Run loop

1. Convert and validate (8.7); on problems stop as described there.
2. Disable `#rl-scn-run`, `#rl-cfg-run`, `#rl-help-run` and the export buttons (`aria-disabled` is not used; real `disabled`), show `#rl-run-progress`, status "Running <seeds> seeds...". Record `t0 = performance.now()` (start of the click handler).
3. `runner = RouteLab.createRunner(config, { scenarioId: lastLoadedPreset })`.
4. `tick()`: `s = performance.now(); do { runner.step(); } while (!runner.isDone() && performance.now() - s < 30);` record the slice length; update the progress bar and text; if not done, `setTimeout(tick, 0)`.
5. When done: `results = runner.result()`, render the Results panel and charts, write the hash, record `ms = Math.round(performance.now() - t0)` (after rendering), set `#rl-run-time` text and `data-ms`, set `data-max-slice-ms` on `#rl-run-time` to the longest slice (rounded ms, including the final aggregation and render as one slice), re-enable the buttons, hide the progress, select Results, focus `#rl-res-heading`, status "Finished: <seeds> seeds in <ms> ms."
6. Edits during a run are allowed and do not affect it (the runner works on a snapshot); `#rl-res-stale` then shows after the run.
7. An exception in any step: catch, `console.warn` once, re-enable the buttons, hide progress, status "Something went wrong while running. Your settings are kept; please report this on the project's Issues page." No partial results are shown.
8. `#rl-run-time` carries `data-run-id` (an integer incremented after each completed run); the smoke test and benchmarks wait on it.

### 8.13 Messages, errors and element ids

- All messages go to `#rl-status-text` (a new one replaces the old) or to field errors. No `alert`, `confirm` or `prompt`. Any unexpected exception in an event handler is caught at the top of the handler (start-up step 2 of 8.3 is wrapped the same way; if filling the form from a renderable hash still throws, the UI falls back to the default preset as for a not-renderable hash and shows that status, with `console.warn`): status "Something went wrong. Your settings are kept; please report this on the project's Issues page.", `console.warn` (never `console.error`).
- Every id starts with `rl-` and is unique (checked on the live DOM by the smoke test and on `index.html` by `static.test.cjs`). Generated ids follow 8.6. `readField(id)` returns `el ? String(el.value) : ''`; `readChecked(id)` returns `el ? !!el.checked : false`; `setText(id, text)` is a no-op when the element is missing.

### 8.14 Accessibility

Target: WCAG 2.2 AA for what can be checked in code; full conformance needs manual testing with assistive technology (manual checklist in the report).

- Focus: `:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }` on every interactive element, including scroll regions and `summary`. Never `outline: none` or `outline: 0`.
- Text `#111111` on `#ffffff`; secondary text `#4a4a4a`; links and the primary buttons `#1d4ed8` (white text on primary buttons); error text `#9b1c1c`; the disclaimer has a `#fff7ed` background with `#111111` text and a `#b45309` left border.
- Every control has a `<label for>` (or `aria-label` for compact table cells, for example "Gateway A, Card, success rate (%)"); fieldsets have legends; field errors are linked by `aria-describedby`.
- Target size at least 24 x 24 CSS px for buttons, checkboxes, radios and selects.
- No animations; the progress bar updates without transitions.
- Exactly one `h1`; panel headings `h2`, sub-headings `h3`.
- Charts: `role="img"` with title and desc, a text legend and a data table alternative; colour is never the only signal.

## 9. Performance budget (fixed before any measurement)

The **default run** is the unmodified `peak-outage` preset with its defaults: 6 strategies plus the oracle (7 policies), 20 seeds (1-20), 10,000 transactions per simulated day, one simulated day.

| Id | Budget | Measured by |
|---|---|---|
| P1 | Browser, end to end (click on `#rl-scn-run` to results rendered, the `data-ms` of 8.12): p95 <= 2,000 ms in Edge and p95 <= 2,000 ms in Firefox | `scripts/bench-browser.cjs` |
| P2 | Browser responsiveness: the longest slice (`data-max-slice-ms`) <= 250 ms in every measured run | `scripts/bench-browser.cjs` |
| P3 | Node, `simulate(getScenario('peak-outage'), { seeds: 20, seedStart: 1 })`: p95 <= 1,500 ms | `scripts/bench.cjs` and `test/perf.test.cjs` |

Method: p95 is the nearest-rank 95th percentile (5.5) of 10 measured runs after 1 discarded warm-up run (so with 10 runs it is the slowest run). Browsers: headless, file mode, fresh profile, viewport 1440 x 900, the page loaded once with the `peak-outage` radio selected, then 11 runs, each started with `document.getElementById('rl-scn-run').click()` through `evaluate` (the button is in the Scenarios panel, which may be hidden after a run; `click()` still dispatches the event), waiting each time for `data-run-id` to increase. Node: `process.hrtime.bigint()` around `simulate`. `perf.test.cjs` uses 1 warm-up and 5 runs and asserts the slowest <= 1,500 ms; it is skipped (and says so) when the environment variable `ROUTELAB_SKIP_PERF=1` is set.

Outputs (not packaged): `dist/logs/perf-node.json` (`{ version, node, runsMs, p50, p95, budgetMs, pass }`) and `dist/logs/perf-browser.json` (per browser: `{ browser, browserVersion, runsMs, p95, maxSliceMs, pass }` or `{ browser, error }`). No host names, user names or paths. Exit codes: 0 all budgets met for every browser that ran; 1 a budget missed; 2 no browser could run. The report copies the numbers with the machine description (operating system, CPU model, browser versions). The README "Performance" section states the budget and the measured p95 values.

If a budget is missed: optimisations that keep the results JSON byte-identical are allowed (for example precomputing event lists, typed arrays, avoiding allocations); changing the default run, the budget or the model is not. A remaining miss is reported honestly in the report and the README. If P3 is still missed after the allowed optimisations, the verification gate runs `npm test` with `ROUTELAB_SKIP_PERF=1`, and the report says so explicitly next to the measured P3 values; it is never skipped silently. `perf.test.cjs` is calibrated on the author's machine, so the README "Performance" section tells people who clone the repository that it may fail on slower machines and can be skipped with `ROUTELAB_SKIP_PERF=1` (`set ROUTELAB_SKIP_PERF=1` in cmd, `$env:ROUTELAB_SKIP_PERF='1'` in PowerShell, `ROUTELAB_SKIP_PERF=1 npm test` in POSIX shells).

## 10. Test plan

### 10.1 Unit tests (`npm test`, which runs `node --test "test/**/*.test.cjs"`)

The gate is `npm test`. Bare `node --test` must also pass when no `dist/` folder exists. Test files import only project files and Node built-ins and have no shared helper files. Deny-list and brand trigger strings in tests are built by concatenation at runtime.

Statistical tolerance rule (normative): every frequency, mean or quantile check on random draws states its sample size and uses a tolerance of at least 4 analytical standard errors at that size (a correct implementation then fails a given check with probability below about 1 in 15,000, and because seeds are fixed, a failure is reproducible and points at a defect, not at bad luck). The sizes and tolerances below satisfy this rule (the variance checks of `normal` and `poisson` use 400,000 draws for that reason). A tolerance is never widened to make a test pass; if a check fails, the implementation is checked against this document first.

| File | Covers |
|---|---|
| `prng.test.cjs` | 3.4 vectors; draw counts of every helper (through a counting wrapper); `normal` mean 0 and variance 1 within 0.01 (400,000 draws, stream `stream(1, 'test:normal')`); `gamma` means for shapes 1, 2.5, 30 within 1% relative (200,000 draws per shape); `beta` means for (2,5), (30,3), (1,1) within 0.005 (200,000 draws each); `poisson` mean and variance for 0.5, 5, 29.9, 30, 75 within 2% relative (400,000 draws each); `weightedIndex` with weights `[5, 3, 2]` frequencies within 0.005 (200,000 draws); `gamma(rng, 0.5)` throws `RangeError` |
| `stats.test.cjs` | `t975` table and expansion vectors (5.3); the worked interval and the paired example; percentiles (5.5); `n < 2` and empty inputs give the null forms |
| `config.test.cjs` | every preset validates and round-trips through normalisation unchanged; one failing case per 7.2 row with the exact `path` and `message`; strings for numbers rejected; unknown keys dropped; `__proto__`/`constructor`/`prototype` keys not copied and `Object.prototype` untouched; coverage rule; normalised key order equals 3.2 regardless of input key order; `configHash` stable and independent of input key order; the `config.codec` helpers of 8.6 (`toPercent(0.07) === 7`, `fromPercent(7) === 0.07`, `toSeconds(2500) === 2.5`, `fromHHMM('24:00', true) === 1440`, `fromHHMM('24:00', false) === null`, `fromHHMM('9:00', true) === null`) and the every-preset round trip; `config.codec.displayMessage` (one case per translated message of 8.7 and one unchanged case); `config.isRenderable` (7.2): `true` for every preset and for a preset with gateway A card `sr: 1.5` or `"0.97"`, `false` for each of: a non-object input, a missing section (`traffic`), `gateways` a string, 1 and 6 gateways, a missing method key, a method value `"0.97"`, `hourly` of length 23 and 30, 2 banks, `priority` shorter than `gateways`, 21 events, 21 rules, gateway ids `['A', 'A']`, gateway ids `['A', 'C']`, banks in the order `[Y, X, Z]`, a gateway `id` of `5`; never throws on 1,000 seeded random JSON values |
| `model.test.cjs` | `severity` inside, at `start`, at `end`, mid-recovery, at `end + recovery`, for repeats (each occurrence and between them); the 3.3 worked values; several events multiply; bank events; `lognormalParams` vector; `fee` |
| `traffic.test.cjs` | same seed -> identical arrays; different seed -> different; exactly 22 draws per transaction (through `traffic.generate(config, seed, { rngFactory })`); times sorted and in `[0, 1440)`; `maxRetries` does not change traffic; `steady` and `issuer-outage` traffic identical for seeds 1-3; distribution sanity on the base configuration, pooled over seeds 1-20 at 10,000 per day (`N` = pooled arrivals, about 200,000): mean daily count within 1% of `txnPerDay`; for each hour `h`, `|phat_h - p_h| <= 4 * sqrt(p_h * (1 - p_h) / N)` with `p_h = w_h / sum(w)`; for each method, mix share `|phat_m - p_m| <= 4 * sqrt(p_m * (1 - p_m) / N)`; for each method and `q` in {0.5, 0.95}, the nearest-rank sample quantile of the amounts of that method (`n_m` values) satisfies `|ln(xhat_q) - ln(x_q)| <= 4 * sigma_m * sqrt(q * (1 - q) / n_m) / phi(z_q)`, where `x_q` is the configured p50 or p95, `sigma_m` the 3.3 lognormal sigma, `z_q` 0 or 1.6448536269514722 and `phi` the standard normal density (0.3989422804014327 and 0.10313564037537128) |
| `strategies.test.cjs` | static, weighted, rules choices including fallbacks, eligibility and rule boundaries (`minAmount` inclusive, `maxAmount` exclusive, `any`); weighted frequencies over 200,000 decisions within 0.005 of the renormalised weights; memory examples of 4.5 (window, discount, none); epsilon-greedy with epsilon 0 is greedy with optimistic empty cells and rank ties, with epsilon 1 over three eligible gateways is uniform (frequencies within 0.01 of 1/3 over 100,000 decisions), and draws 1 value when exploiting and 2 when exploring; Thompson: with cells at (a=10, b=0) and (a=0, b=10) the first is chosen in at least 99.9% of 10,000 decisions; exactly one Beta sample per eligible gateway (counting wrapper); `scoreThompson` example; cost-aware with lambda 1 picks the cheaper gateway when thetas are close |
| `engine.test.cjs` | hand-built cases E1-E8 below; for every preset, every policy and seeds 1-3: every transaction ends exactly once, `sum(reasons) = n`, attempts per transaction <= 1 + maxRetries, `orderSr >= firstSr`, regret >= 0, oracle regret = 0, fees >= 0, first-attempt shares per bucket sum to 1 within 1e-9; pairing: switching `egreedy` off leaves every other policy's `perSeed` values identical; determinism: two runs give identical run records |
| `distributions.test.cjs` | D1: gateways A and B with identical card settings (`sr 0.9`, p50 4000, p95 15000, fees as the base gateway A) and every other method `null`, mix card 100 and the other methods 0, customer decline 0 for every method, only the static policy enabled with priority A, B, `maxRetries 0` (so B is never used), 50,000 transactions per day, seeds 1-4, the configuration built through `validateConfig` (3.5): attempt SR within 0.004 of 0.9 (about 6 standard errors); D2: same run, time to success p50 within 2% of 4,000 ms and p95 within 3% of 15,000 ms; D3: customer decline 0.2: share of `customer` endings within 0.004 of 0.2 |
| `metrics.test.cjs` | window metrics on hand-built run records (bucket ranges, method filter, shares, null denominators); pooled series; results object key order and rounding (5.7, including `-0` -> `0`); every expectation op (6.3) true and false on hand-built per-seed values; `diffAtLeastCi` with fewer than 2 seeds gives `held: false`, `ciLow: null` and the "needs at least 2 seeds for an interval" detail; disabled policy gives `held: null`, `value: null` and the "Not checked" detail; every label, unit and format rule of the 6.3 table and the five normative examples of 6.3 (exact strings); `title` and `expectationText` copied from `scenarioMeta` (preset and custom) and placed right after `preset` |
| `scenarios.test.cjs` | 6.1 and 6.2 values (spot checks of every changed field); every preset has `story`, `changes`, `expectationText`, `focus` as listed (`changes` spot-checked: `steady` is `none` and `issuer-outage` equals its 6.2 cell verbatim); every 6.4 row exists with its threshold; **every expectation holds on `RESULTS_SEEDS` and on `ROBUST_SEEDS`** |
| `conformance.test.cjs` | the 84 cells of 6.6 |
| `results.test.cjs` | `buildResultsSet()` (exported by `scripts/results.cjs` when required as a module) twice -> identical strings; equal to the committed `docs/results.json`, `docs/RESULTS.md` and README block |
| `perf.test.cjs` | P3 (section 9) |
| `state.test.cjs` | round trip of every preset; each `decodeState` error code; the 64,000 limit on the hash string (a hash of exactly 64,000 characters is not `too-long` and is decoded further; 64,001 characters gives `too-long`); non-ASCII content; 1,000 seeded random strings never throw |
| `memo.test.cjs` | CSV header, row count and focus rows; JSON parses with `schema`; memo sections and each "Reading" branch on hand-built results; the Setup scenario line for a preset (`- Scenario: Evening-peak outage on the best gateway (peak-outage).`) and for custom results (`- Scenario: custom settings (not an unmodified preset).`); `generatedOn` required |
| `charts.test.cjs` | trees: svg attributes, title/desc ids, one polyline group per policy (split at null buckets), event rects, scatter markers and whiskers, the 8.8 colour table, no `NaN` or `Infinity` in any attribute |
| `api.test.cjs` | the 7.1 surface in Node; `VERSION` equals package.json; runner `total`, order of units, `result()` before completion throws, `step()` after completion; option errors; the README Node example runs |
| `cli.test.cjs` | `--list`; `--scenario steady --seeds 2` text output: the three header lines and 7 strategy rows; `--format json` equals `toJson(simulate(...))`; CSV header; memo first line; `--scenario peak-outage --assert` exit 0; `--scenario steady --seeds 1 --assert` exit 3 (CI checks need 2 seeds); bad arguments exit 2 with usage and no file read; `--config` missing file, non-JSON, too large (a valid preset JSON padded with spaces to exactly 64,000 bytes is accepted; 64,001 bytes gives exit 1), invalid -> exit 1; `--out` writes the file |
| `static.test.cjs` | `index.html` loads exactly the 14 scripts of 2.3 in order with `defer`; no `type="module"`, inline script, `on*=` or `style=` attributes; no `http:`/`https:` URL in `index.html`, `css/` or `js/`; code checks on stripped source (below); every id starts with `rl-` and is unique; every `for=` points to an existing id; CSP and privacy sentence (2.4); the focus rule (8.14) and no `outline: none` / `outline: 0` |
| `denylist.test.cjs` | 11.3 with synthetic terms (for example "Contoso", "Fabrikam Ltd"): case and separator insensitivity, short-term word boundaries, file names, PNG chunk rules, zip entries, unknown types refused, reserved-domain e-mail exemption |
| `selfscan.test.cjs` | 11.4: a clean folder passes; a planted brand (built at runtime) in `js/` is a hit and in `docs/MODEL.md` is allowed; a planted Luhn-valid 16-digit number, a 10-digit mobile-like number and a handle-like string (a local part, the at sign and a letters-only handle) (all built at runtime) are hits; decimals such as `0.6270739405881613` are not; the real repository passes |
| `zip.test.cjs` | write and read back: forward slashes, CRC-32 (`'123456789'` -> `0xCBF43926`), deflate and stored entries, empty file, 1 MB file |
| `package.test.cjs` | `packagePublic({ out: <tmp>, genericOnly: true })` succeeds; file list equals the allow-list; zip entries equal the files prefixed `routelab-public/`; no backslashes; `dist/` and `.denylist.local` never included; a planted deny-list term or brand makes the package fail and removes the outputs |
| `readme.test.cjs` | the README results block equals the rendering from `docs/results.json`; every `docs/screenshot-*.png` is referenced in "Screenshots" with non-empty alt text followed by the caption line "Synthetic data."; every referenced image exists; the "Live demo" section contains exactly one of: (a) the placeholder line `Live demo: add the GitHub Pages link here after publishing.`, or (b) a line matching `^Live demo: https://[A-Za-z0-9-]+\.github\.io/routelab/$` (host part case-insensitive, because the owner may paste a user name with capitals; the owner's edit on GitHub, publish step 5); the README contains "not financial advice"; the only `github.io` addresses are the placeholder form `https://<your-user-name>.github.io/<repository-name>/` and, in case (b), that one live-demo address. So `npm test` passes both before and after the owner adds the link, and no repository file written by the build contains a user name |

Engine cases (configurations built from the `steady` preset, edited and passed through `validateConfig` with `ok` asserted, so every case has 2 or more gateways; traffic objects built by hand with uniforms and normals set directly). Unless a case says otherwise, every hand-built transaction has `uS = 0.5`, `z = 0` and `uD = 0.99` in all four attempt slots, so drop-off never ends a case early:

- E1: gateway A card `sr 1`, one transaction, `customer 0`: success on the first attempt, fee `fixedFee + pctFee/100 * amount`, time to success = latency from `z[0]`.
- E2: A `sr 0`, B `sr 1`, mode `other`, `maxRetries 2`, `uD = 0.99`: attempts A then B; success; time to success = latency A + 3 s + latency B.
- E3: as E2 with `uD[0] = 0`: ends `dropped` after one attempt.
- E4: `customer 1`: ends `customer` after one attempt; a learning policy's memory is unchanged.
- E5: mode `same`, A `sr 0`: three attempts on A, ends `technical`.
- E6: A `capacityTpm 1`, two transactions in the same minute: the second's first attempt is `rate_limited` (latency 200 ms) and its retry goes to B.
- E7: Thompson with a memory spy: transaction 2 arrives before transaction 1's first attempt completes; at transaction 2's decision the memory has no update from transaction 1.
- E8: two gateways both `sr 0`, mode `other`, `maxRetries 2`: attempts A, B, then the transaction ends `no_route`.

Code token checks (`static.test.cjs`) run on stripped source, never as plain substring searches:

- Stripping: a single left-to-right scanner replaces line comments, block comments, single- and double-quoted strings (with escapes) and regex literals by spaces, keeping newlines. A `/` starts a regex literal when the previous non-space character is one of `( , = : [ ! & | ? { } ;` or the start of the file, or the previous token is `return`, `typeof` or `case`. A backtick in code fails with "template literals are not used in js/". The scanner's own cases are unit-tested in the same file.
- All files in `js/`: `/\bfetch\s*\(/`, `/\bXMLHttpRequest\b/`, `/\bWebSocket\b/`, `/\bEventSource\b/`, `/\bsendBeacon\b/`, `/\bWorker\b/`, `/\bimport\s*\(/`, `/^\s*(import|export)\b/m`, `/\.innerHTML\b/`, `/\.outerHTML\b/`, `/\binsertAdjacentHTML\b/`, `/\bdocument\s*\.\s*write/`, `/\beval\s*\(/`, `/\bnew\s+Function\b/`.
- Pure modules (all of `js/` except `ui.js`): `/\bMath\s*\.\s*random\b/`, `/\bDate\s*[.(]/`, `/\bnew\s+Date\b/`, `/\bperformance\s*\./`, `/\bconsole\s*\./`, `/\bwindow\b/`, `/\bdocument\b/`, `/\blocalStorage\b/`.
- `ui.js`: `localStorage` only inside `storageGet`/`storageSet` (located by their headers and brace matching); none of `/\bsessionStorage\b/`, `/\bdocument\s*\.\s*cookie\b/`, `/\bindexedDB\b/`, `/\blocation\s*\.\s*hash\s*=(?!=)/`, `/\bMath\s*\.\s*random\b/`.
- ES2018: `/\?\.(?!\d)/`, `/\?\?/`, `/\bcatch\s*\{/`, `/\.matchAll\s*\(/`, `/\b\d+n\b/`.
- A failure message names the file, line and regex.

### 10.2 What is unit-tested and what is not

- Pure modules, CLI, results generator and packaging: Node unit tests.
- `ui.js` (DOM, hash, storage, downloads, clipboard, keyboard, rendering, run loop): browser smoke test.
- Screen-reader output, 200% zoom, high-contrast mode, 320 px reflow and a keyboard-only pass by a person: manual checklist in the report.

### 10.3 Browser smoke test (`node scripts/ui-smoke.cjs`)

Drivers (`scripts/browser.cjs`):

- Edge headless (`--headless=new`) via the Chrome DevTools Protocol; Firefox headless via WebDriver BiDi (`--remote-debugging-port`, `ws://127.0.0.1:<port>/session`, `session.new`).
- Each run uses a fresh temporary profile. Firefox `user.js` prefs: disable first-run pages, telemetry, updates, safe browsing and captive-portal checks; `focusmanager.testmode: true`; `security.default_personal_cert: "Select Automatically"` (on machines with operating-system or enterprise client certificates, a background TLS connection at start-up can otherwise open the client-certificate chooser, which takes focus from the page so that no `:focus` style matches).
- Both drivers expose `evaluate(expr)`, real pointer `click(x, y)`, real key `press(key)`, `goto(url)`, `reload()`, `addPreload(src)` -> handle, `removePreload(handle)`, `setViewport(w, h)`, `screenshot(clip)`, `errors[]` (uncaught exceptions, `console.error`, error-level log entries), `requests[]` (every request URL) and `close()`.
- Executables: `--edge <path>` / `EDGE_PATH`, then `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, then `C:\Program Files\Microsoft\Edge\Application\msedge.exe`; `--firefox <path>` / `FIREFOX_PATH`, then `C:\Program Files\Mozilla Firefox\firefox.exe`. Defaults are generic install locations, never user-profile paths.

Usage: `node scripts/ui-smoke.cjs [--browser edge|firefox|all] [--mode file|http|all] [--port 4395] [--cdp-port 9397] [--bidi-port 9398] [--keep]`.

- Refuses `--port 4317` with exit 2. Never stops processes it did not start; kills only its own child PIDs (`taskkill /PID <pid> /T /F` on Windows).
- Exit codes: 0 all passed in every browser that ran; 1 a failure; 2 no browser could run or invalid arguments.
- Prints one line per scenario, browser and mode (`PASS edge file R04 every-scenario-runs`) and a summary.
- Modes: `file` = `pathToFileURL(<project>/index.html)`; `http` = `scripts/serve.cjs` as a child process.

`scripts/serve.cjs` (`node scripts/serve.cjs [--port 4395] [--root <dir>]`): binds 127.0.0.1 only; GET and HEAD only (405 otherwise); refuses port 4317; rejects `..` segments and null bytes and resolves inside the root (403); MIME types for `.html`, `.js`, `.css`, `.png`, `.md`, `.json`, `.svg`; `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; `/` serves `index.html`; 404 otherwise; no directory listings.

Shared preload (registered once per browser): counts `securitypolicyviolation` events in `window.__smokeCsp`; records downloads by wrapping `URL.createObjectURL` (store the Blob in `window.__smokeBlobs`) and `HTMLAnchorElement.prototype.click` (record `download` names in `window.__smokeDownloads` and do not navigate when `download` is set). No hooks in the app.

Waiting: after starting a run, poll every 50 ms until `#rl-run-time`'s `data-run-id` increases (timeout 30 s), never fixed sleeps.

Scenarios (each browser, each mode; localStorage cleared before R01, R03 and R18 by loading the app URL, running `localStorage.clear()`, then reloading):

| # | Scenario | Assertions |
|---|---|---|
| R01 | First visit | Help tab `aria-selected="true"`, Help panel visible, others `hidden`; `#rl-disclaimer` visible |
| R02 | Help seen persists | Click `#rl-help-start` -> Scenarios selected; reload -> Scenarios selected; flag equals `1` |
| R03 | Storage blocked | `h = addPreload(...)` making `window.localStorage` throw `SecurityError`; load: Help selected; select the `cost-vs-sr` radio, click `#rl-scn-load`, set `#rl-cfg-seeds` to 3, click `#rl-cfg-run`: results shown; no errors; `removePreload(h)` in `finally` |
| R04 | Every scenario runs | For each preset in 6.2 order: select the Scenarios tab, click its radio, click `#rl-scn-run` (real pointer clicks), wait: Results selected and focused heading; `#rl-res-table` has one body row per policy (7 for every preset); 3 `svg[role="img"]` with non-empty title and desc; `#rl-res-expect` has one item per 6.4 row of that preset and every item starts with "Held on these seeds" (default seeds 1-20 = `ROBUST_SEEDS`) |
| R05 | Charts | After `peak-outage`: chart 1 has 7 policy groups and at least one event rect; changing `#rl-ch-sr-method` to UPI collect changes the desc; changing `#rl-ch-share-policy` to Static priority changes chart 2's desc; chart 3 has 7 markers and 14 whiskers; each data table has 24 body rows (chart 3: 7), including `#rl-ch-gwsr-table` with one column per gateway after the hour column; with Static priority chosen, its Gateway A cell for 20:00 is below its cell for 18:00 |
| R06 | Browser equals Node | In the page, `RouteLab.toJson(RouteLab.simulate(RouteLab.getScenario('peak-outage'), { scenarioId: 'peak-outage', seeds: 3, seedStart: 1 }))`; its SHA-256 (computed in Node from the returned string) equals Node's for the same call |
| R07 | Hash restore | After running `cost-vs-sr`, read `location.href`, go to `about:blank`, open the saved URL: Results selected, a run completes without a click, `#rl-res-table` text equals the earlier text, status "Loaded the settings from the link." |
| R08 | Bad hash | Open `index.html#s=not-valid!`: `peak-outage` preset in Configure, status "This link could not be read, so the default scenario was loaded.", no errors |
| R08b | Invalid but renderable hash | Open `index.html` + `RouteLab.encodeState(c)` (computed in the page) where `c` is the `peak-outage` preset with gateway A card `sr: 1.5`: Configure selected; `#rl-cfg-gw-a-card-sr` has value `150` and `aria-invalid="true"`; `#rl-cfg-errors` lists it; status "The link's settings have problems; fix the marked fields, then run."; no run started; no errors. Second hash: `peak-outage` with its event's `methods` set to the string `"card"`: no `#rl-cfg-ev-<n>-m-<m>` box is ticked and the event's method error "Choose at least one payment method." shows |
| R08c | Unrenderable hash | Open `index.html` + `RouteLab.encodeState(c)` where `c` is the `peak-outage` preset with 7 gateways (gateway A's object repeated): the `peak-outage` preset is in Configure (3 gateway sub-fieldsets), no field has `aria-invalid="true"`, status "This link's settings could not be shown, so the default scenario was loaded.", no errors |
| R08d | Mismatched gateway ids | Open `index.html` + `RouteLab.encodeState(c)` where `c` is the `peak-outage` preset with gateway B's `id` set to `'A'`: the `peak-outage` preset is in Configure (3 gateway sub-fieldsets), no field has `aria-invalid="true"`, status "This link's settings could not be shown, so the default scenario was loaded.", all ids unique, no errors |
| R08e | Bad hash mid-session | Load `steady`, set `#rl-cfg-seeds` to 3 (dispatch `change`), wait for the debounced hash write, then set `location.hash = '#s=not-valid!'` from the smoke script: `#rl-cfg-seeds` is still 3, Configure is still selected, status "This link could not be read; your current settings are kept.", `location.hash` is rewritten and decodes to a configuration with `run.seeds` 3, no errors |
| R09 | Validation | Configure: set `#rl-cfg-gw-a-card-sr` to 150 and dispatch `change`: `aria-invalid="true"`, `#rl-cfg-gw-a-card-sr-err` visible, `#rl-cfg-errors` lists it; click `#rl-cfg-run`: no run starts, status "Fix 1 problem(s) before running."; set 96: error cleared. Then clear `#rl-cfg-focus-end` only (start still filled) and dispatch `change`: `#rl-cfg-focus-end-err` shows "Enter both times, or leave both empty." and the decoded hash still has the previous `focus`; set it to `25:00`: "Enter a time as HH:MM."; set `20:30`: error cleared and the hash has `focus.end` 1230; clear both: no error and the hash has `focus: null` |
| R10 | Edits take effect | Load `steady`, set seeds 3, add an event (`#rl-cfg-ev-add`, target Gateway B), run: `#rl-res-summary` starts with "Custom settings"; `#rl-res-expect` says expectations apply to unmodified presets; the hash decodes to a configuration with that event |
| R11 | Exports | After `peak-outage`: click CSV, JSON, memo: `__smokeDownloads` equals `['routelab-peak-outage-summary.csv', 'routelab-peak-outage-results.json', 'routelab-peak-outage-memo.md']`; the CSV blob's first line is the 8.10 header; the JSON parses with `schema` `routelab.results.v1`; the memo starts with `# Routing decision memo: Evening-peak outage on the best gateway`; `#rl-exp-copy` gives one of the two 8.10 messages |
| R12 | Keyboard tabs | Focus `#rl-tab-help`; real ArrowRight -> Scenarios focused and selected; End -> Results; Home -> Help; ArrowLeft from Help -> Results |
| R13 | Focus visible | `document.hasFocus()` first ("the browser window has no focus" otherwise); with `peak-outage` results shown, Tab with real key presses through each panel (up to 800 presses per panel) and assert every element reached has `outlineStyle !== 'none'` and `outlineWidth >= 2px` |
| R14 | Responsive | 375 x 800: `document.documentElement.scrollWidth <= innerWidth + 1` on every tab with `peak-outage` results |
| R15 | No network, no CSP violations | Every request is `file:` (file mode) or `http://127.0.0.1:<port>` (http mode), ignoring the browser's own `favicon.ico`; no `blob:` request other than downloads; if `CSP_META`, `__smokeCsp === 0` |
| R16 | Accessibility basics | Every input, select and textarea has a label or `aria-label`; no duplicate ids; `html[lang="en"]`; one `h1`; panels have accessible names; every chart `svg` has `role="img"` and `aria-labelledby` pointing to existing title and desc |
| R17 | No errors | `errors[]` empty at the end of every scenario |
| R18 | Privacy | After runs and edits: `localStorage` keys are a subset of `['routelab.helpSeen.v1']`; `document.cookie === ''` |
| R19 | Run progress | During a `peak-outage` run, the run buttons are `disabled` and `#rl-run-bar`'s `value` is observed at least two different values before completion; after completion the buttons are enabled |

The verification step runs the full smoke (`--browser all --mode all`) three consecutive times; all three must pass.

### 10.4 Benchmarks

`node scripts/bench.cjs` (P3) and `node scripts/bench-browser.cjs [--browser edge|firefox|all] [--edge <path>] [--firefox <path>] [--cdp-port 9399] [--bidi-port 9400]` (P1, P2), as section 9.

### 10.5 Screenshots (`node scripts/capture-screenshots.cjs [--out docs] [--edge <path>]`)

Headless Edge, file mode, 1440 x 900, `deviceScaleFactor` 1, fresh profile, CDP port 9401. For each shot: set up the state through the UI, wait for the run, check `document.body.innerText` against the deny-list (11.3, including `.denylist.local` and the operating-system user name) and the brand list (11.4); any hit refuses that shot and exits 1 without printing the term; then capture the element's bounding box (height capped at 3,000 px).

| File | Content | Element |
|---|---|---|
| `docs/screenshot-help.png` | Help tab, first visit | `#rl-main` |
| `docs/screenshot-scenarios.png` | Scenarios tab, `peak-outage` selected | `#rl-main` |
| `docs/screenshot-configure.png` | Configure tab, `peak-outage`, Gateways and Events fieldsets | `#rl-cfg-gw-a` to the events fieldset (the union box) |
| `docs/screenshot-outage-results.png` | Results for `peak-outage`: summary, expectations, chart 1 | `#rl-panel-results` top to the end of `#rl-ch-sr` |
| `docs/screenshot-cold-start-share.png` | Results for `cold-start`, chart 2 with Thompson sampling | `#rl-ch-share` |
| `docs/screenshot-cost-vs-sr-scatter.png` | Results for `cost-vs-sr`, chart 3 and the summary table | `#rl-ch-scatter` to the end of `#rl-res-table` |
| `docs/screenshot-memo.png` | Memo preview for `peak-outage` (details open) | `#rl-memo` |

A person must look at every image before publishing and confirm it shows synthetic data only.

## 11. Packaging (`node scripts/package-public.cjs`)

### 11.1 Allow-list

- Root: `index.html`, `README.md`, `LICENSE`, `.gitignore`, `.nojekyll`, `package.json`.
- `css/*.css`, `js/*.js`, `docs/*.md`, `docs/*.png`, `docs/results.json`, `test/*.test.cjs`, `scripts/*.cjs`, `scripts/brands.json` (top level of each folder only).
- Anything else is not copied. The script fails (exit 1) and removes its output if an allow-listed path has a segment `dist`, `node_modules` or `.git`, a segment starting with `.` other than the two root dotfiles, is named `.denylist.local`, or ends in `.log`.

### 11.2 Output

- `dist/routelab-public/` and `dist/routelab-public.zip`. `--out <dir>` overrides the folder; the zip is `<out>.zip`. Refuses an `--out` that contains the project folder, or that exists and is not a previous package (recognised by `index.html` and `js/routelab.js`).
- Zip (`scripts/zip.cjs`): deflate via `zlib.deflateRawSync`, stored when not smaller; own CRC-32 table; UTF-8 flag; fixed DOS timestamp 2025-01-01 00:00; entry names `routelab-public/<relative path>` with forward slashes only; no directory entries; no ZIP64 (refuse above 65,535 entries or 4 GB). Never use .NET `ZipFile.CreateFromDirectory` or `Compress-Archive`. After writing, read back and verify the entry count, no backslashes, and byte-identical inflated contents.
- Order: copy -> path checks -> deny-list scan of the folder -> self-scan of the folder -> zip -> read-back checks -> deny-list scan of the zip -> self-scan of the zip's text entries. Any failure removes both outputs and exits 1.
- Console: file count, path problems, hits (location only), zip entry count and backslash count, then `OK: <folder>` and `OK: <zip>`, or `REFUSED: package removed.`

### 11.3 Deny-list scan (`scripts/denylist.cjs`, module and CLI)

Generic patterns (public, always on):

- Windows profile paths `/[A-Za-z]:[\\/]+Users[\\/]+/i`; macOS and Linux home paths `/\/Users\/[^\/\s]+\//` and `/\/home\/[^\/\s]+\//`.
- E-mail addresses `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/`, except domains `example.com`, `example.org`, `example.net` and their subdomains, and names ending in `.example`, `.test`, `.invalid` or `.localhost` (RFC 2606, RFC 6761).

Private terms: the owner's `.denylist.local` at the project root (UTF-8, one term per line, `#` comments and blank lines ignored; gitignored, never packaged) plus `ROUTELAB_DENY_EXTRA` (comma-separated). The term list is supplied by the owner out of band and is deliberately not written in any repository file, not even encoded. The implementer creates `.denylist.local` from the owner's brief.

Matching: case-insensitive; within a term, any run of space, `_` or `-` matches `[\s_-]*`; other characters literal; short terms (3 characters or fewer, or 4 or fewer containing a digit) need non-alphanumeric neighbours, `(?<![A-Za-z0-9])term(?![A-Za-z0-9])`; longer terms match as substrings.

Scanned by type, never scanning compressed or pixel bytes as text: every file and folder name; text types (`.html .css .js .cjs .json .md .txt .svg`, the root dotfiles, `LICENSE`) as UTF-8 line by line (invalid UTF-8 is a hit); `.png` by chunk list (chunk types, `tEXt`, `zTXt` inflated, `iTXt` inflated when flagged, `eXIf`; never `IDAT`; a malformed PNG is a hit); `.zip` by entry name and inflated entry. Other types are refused (a hit). Output: `file:line [N chars]`, `file:chunk <type> [N chars]` or `zip!entry:...`, never the term. CLI: `node scripts/denylist.cjs [dir] [--generic-only]`, exit 0 for no hits, 1 for hits.

Flags on `package-public.cjs`: `--require-local` (fail if `.denylist.local` is missing; used by `npm run package`), `--generic-only` (for people who clone the repository), neither (use the file if present, else print `WARNING: no .denylist.local; only generic patterns were scanned.`).

### 11.4 Self-scan (`scripts/selfscan.cjs`, module and CLI)

Two checks over every text file of the package (the 11.3 text types; zip text entries too):

1. Brands. `scripts/brands.json` is an array of real payments-industry names that must never appear as simulated entities: `["Razorpay", "PayU", "Cashfree", "Juspay", "Hyperswitch", "Paytm", "PhonePe", "Google Pay", "GPay", "BharatPe", "CCAvenue", "MobiKwik", "Pine Labs", "Stripe", "Adyen", "PayPal", "Worldline", "Checkout.com", "Visa", "Mastercard", "RuPay", "American Express", "Amex", "HDFC", "ICICI", "SBI", "Axis Bank", "Kotak", "Yes Bank", "IndusInd", "Bank of Baroda", "Canara Bank", "Punjab National Bank", "Airtel Payments Bank"]`. Matching is case-sensitive and whole-word (`(?<![A-Za-z0-9])` and `(?![A-Za-z0-9])`; spaces inside a term match `\s+`). Hits are allowed only in `README.md`, `docs/PRD.md`, `docs/SPEC.md`, `docs/MODEL.md` and `scripts/brands.json` (citations and this list); anywhere else (app, Help, results, memo, tests, RESULTS, CASE-STUDY) a hit fails.
2. Identifier shapes (no real personal or account data may ship): contiguous digit runs of 13-19 digits that pass the Luhn check, `(?<![\d.])\d{13,19}(?![\d.])`; Indian-mobile-like numbers `(?<![\d.])(?:\+91[ -]?)?[6-9]\d{9}(?![\d.])`; handle-like addresses `(?<![A-Za-z0-9._-])[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}(?![A-Za-z0-9.-])` (e-mail addresses are covered by 11.3). Every hit fails; there is no allow-list, because RouteLab never needs such values.

Output: `file:line <check> [N chars]`, never the matched text. CLI: `node scripts/selfscan.cjs [dir]`, exit 0 for no hits, 1 for hits. The page's visible text in screenshots is checked by 10.5 with the same brand list.

## 12. Repository files

### 12.1 README.md (public; exhaustive, plain language)

Sections, in this order:

1. "# RouteLab": one-line pitch ("A browser-only simulator that compares payment-routing strategies, from static priority to Thompson-sampling bandits, on synthetic UPI, card and netbanking traffic."), then `docs/screenshot-outage-results.png` with the caption "Synthetic data."
2. "Live demo": the exact line `Live demo: add the GitHub Pages link here after publishing.` Never write the owner's user name or the owner's repository URL in any repository file (the source URLs of MODEL.md section 11, used in item 18, are fine).
3. Table of contents.
4. "What it is and why": the problem (PRD 2), the three forms (page, library, CLI), what it is not.
5. "Not a forecast, not financial advice": the disclaimer of 8.1 plus "Every default is illustrative or sourced; see docs/MODEL.md."
6. "Use it online": open the demo, Help first, pick a scenario, Load and run, read Results, change settings, share the link, download the memo.
7. "Screenshots": the 7 images of 10.5 in table order, each `![<alt>](docs/screenshot-<name>.png)` followed by the caption line "Synthetic data." Alt texts: help "Help tab shown on the first visit"; scenarios "Scenarios tab with the evening-peak outage selected"; configure "Configure tab with gateway and event settings"; outage-results "Results for the evening-peak outage: expectation checks and success rate over the day"; cold-start-share "Share of first attempts by gateway for Thompson sampling when a new gateway joins at noon"; cost-vs-sr-scatter "Cost per success against success rate for each strategy, with intervals"; memo "Routing decision memo preview".
8. "Use it offline": download the ZIP from Releases (or Code > Download ZIP), extract, double-click `index.html`.
9. "Scenarios and results": the `<!-- results:start -->` / `<!-- results:end -->` block written by `scripts/results.cjs`: a table with columns Scenario, What happens (the story), Headline on seeds 101-130 (the 6.4 headline rows, formatted as in 6.4), Expectations held (`<k>/<m>` on seeds 101-130 and `<k>/<m>` on seeds 1-20). After the block: links to docs/RESULTS.md and docs/MODEL.md and the sentence "These numbers come from the model and its illustrative assumptions; they show mechanisms, not what any real gateway achieves."
10. "Routing strategies explained": each strategy simple then precise, with the formulas of section 4 (Beta update, discounting, window, epsilon-greedy, cost-aware score) and the oracle and regret.
11. "How the simulation works": traffic, customer-side vs technical declines, events, latency, retries and drop-off, fees, the discrete-event engine (routers learn only from completed attempts), common random numbers and paired comparisons, seeds and t-intervals.
12. "Assumptions and limitations": the MODEL.md section 10 list in short form, with a link. It includes, in short form, the MODEL.md 4.1 note that the default technical failure rates are deliberately much larger than public UPI ecosystem technical-decline figures, so that routing differences show up within one simulated day, and that the gaps between gateways are illustrative, not typical.
13. "Performance": the section 9 budget and the measured p95 values with browser versions and "measured on the author's Windows laptop"; any miss stated as a miss; the `ROUTELAB_SKIP_PERF=1` note of section 9 for people whose machines are slower.
14. "Deploy your own copy on GitHub Pages": create a repository; upload the files (100 files or fewer per upload; `.nojekyll` may be hidden by your file browser, so create it with Add file > Create new file if needed); Settings > Pages > Deploy from a branch, `main`, `/ (root)`; wait 1-2 minutes; the address is `https://<your-user-name>.github.io/<repository-name>/` (literal placeholders).
15. "Privacy": the network sentence matching `CSP_META`; no analytics, no cookies; localStorage only for the help flag; the address holds your settings.
16. "FAQ", at least: Is this how real gateways perform? Why does Thompson sampling lose in steady state? Why does it keep exploring? Why discounting or a window? Why does routing not fix a bank outage? Why is the oracle not truly optimal? Why paired comparisons and intervals? How would I test a router in production? Can I name real gateways? Why are the gateway names fixed? Why classic scripts and no Web Worker? Does anything leave my browser?
17. "For developers": file layout; library API (7.1 with the Node example and a browser example); CLI (7.4 with examples and exit codes); results generator (7.5); commands (`npm test`, `npm run results`, `npm run results -- --check`, `npm run simulate -- --scenario flapping --seeds 30`, `npm run bench`, `npm run bench:browser`, `npm run smoke`, `npm run screenshots`, `node scripts/package-public.cjs --generic-only`); requirements (Node 22+ for tooling only); zero dependencies.
18. "Related work and sources": the public projects and papers of MODEL.md section 11 (Hyperswitch and Juspay's decision engine described only as public open-source projects for production routing; no claims about their performance).
19. "License": MIT, see `LICENSE`.

Style: short sentences, no hype, no usage or popularity claims; the only numbers are results-block values, performance values and test counts.

### 12.2 Other documents

- `docs/PRD.md`, `docs/SPEC.md`, `docs/MODEL.md`: the owner's design documents. `docs/SPEC.md` must stay byte-identical to the owner's private copy (checked in the report with SHA-256).
- `docs/RESULTS.md` and `docs/results.json`: generated (7.5). Never edited by hand.
- `docs/CASE-STUDY.md`: a portfolio case-study template with every real-world value as a `[[placeholder]]`: one-line summary; links (live demo, repository, release date); the problem; what I built; key decisions and trade-offs (discrete-event engine with completion-time feedback; common random numbers and paired intervals; per-method learning; discounting vs window; cost-aware scoring; fixed synthetic names; browser-only); how I validated it (expectations fixed before measurement, two seed sets, conformance with the design prototype, reproducibility hash); what I measured after launch (the PRD section 9 table with `[[n]]` cells for day 30 and day 90); what I learned (placeholders); what's next; a resume line with placeholders and the instruction "Fill only with real, checked numbers; delete any clause you can't support."
- `LICENSE`: standard MIT text, `Copyright (c) <current year at implementation time> <your name>`.
- `.gitignore`: `dist/`, `.denylist.local`, `*.log`, `node_modules/`, `.DS_Store`, `Thumbs.db`.
- `.nojekyll`: empty.
- No favicon (the smoke test ignores the automatic favicon request).

## 13. References

MODEL.md section 11 lists the payments and methods sources ([S1]-[S7], [R1]-[R12]). The README cites them in "Related work and sources" (12.1 item 18). The Help panel cites no source by name (several source names are real brands, which the self-scan of 11.4 forbids in `index.html`); its "Assumptions and limitations" section ends with the pointer to docs/MODEL.md (8.4 item 6), which holds the full list. Web platform: WAI-ARIA Authoring Practices Guide, Tabs pattern (W3C); WCAG 2.2 (W3C); RFC 4648 (base64url); Content Security Policy Level 3 (W3C). The implementer opens each public source before citing details; if a detail cannot be confirmed, cite the source without that detail.

## 14. Milestones

| M | Scope | Done when |
|---|---|---|
| M1 | `prng.js`, `stats.js`, `config.js`, `model.js` and their tests | 3.3, 3.4, 5.3-5.5 vectors and all 7.2 cases pass |
| M2 | `traffic.js`, `strategies.js`, `engine.js`, `metrics.js`, `scenarios.js`, `routelab.js` and tests | E1-E8, invariants, distributions and the 6.6 conformance cells pass |
| M3 | `scenarios.test.cjs` on both seed sets, `scripts/results.cjs`, `docs/RESULTS.md`, `docs/results.json` | every expectation holds on both sets; `--check` prints IDENTICAL; two generations give the same SHA-256 |
| M4 | `memo.js`, `state.js`, `charts.js`, `scripts/simulate.cjs` and tests | CLI, memo, state and chart tests pass |
| M5 | `index.html`, `css/app.css`, `js/ui.js`, `static.test.cjs` | static test passes; manual double-click check in Edge works |
| M6 | `browser.cjs`, `serve.cjs`, `ui-smoke.cjs`, `bench.cjs`, `bench-browser.cjs`, `perf.test.cjs` | R01-R19 pass in Edge and Firefox, file and http, three consecutive full runs; budgets measured |
| M7 | `capture-screenshots.cjs`, `docs/screenshot-*.png` | 7 images, visible-text scans clean, each image looked at |
| M8 | `denylist.cjs`, `selfscan.cjs`, `brands.json`, `zip.cjs`, `package-public.cjs`, README, CASE-STUDY, LICENSE, `.gitignore`, `.nojekyll`, `package.json` and their tests | `npm test` passes; `npm run package` exits 0 with 0 deny-list and 0 self-scan hits |
| M9 | The private build report and the owner's private demo and interview guide, both outside the repository at the paths of the owner's build brief | Report: section 15 complete. Guide (the owner's build brief is the authority for its contents): written from real seeded runs of this build, with every demo command and its exact output quoted from an actual run (seeds stated); covers the brief's sections (payments basics, each strategy simple then precise including Thompson sampling and non-stationarity, the outage story, the cost vs SR trade-off, A/B testing a router, PM metrics, 15-20 interview Q&A, the honest-claims cheat-sheet and one honest resume line without usage numbers); converted to .docx with the owner's Markdown-to-docx script; the .docx has 0 zip entry names containing a backslash and opens as a valid zip whose `word/document.xml` parses as XML |

Long-running commands (tests, results, smoke, benchmarks, screenshots) are started as background processes or script files that write logs under `dist/logs/` and are then polled. Never stop a process listening on port 4317.

## 15. Report and publish checklist (owner-facing, outside the repository)

The report `routelab-report.md` goes to the owner's private task folder at the exact path given in the owner's build brief (not written here, because it would trip the deny-list). It lists:

- what was built (files) and any deviation from this document, with reasons;
- the RESULTS headline table (seeds 101-130) and the expectation table for both seed sets, with every row's value and PASS/FAIL;
- the 6.6 conformance result;
- `npm test` totals; the two SHA-256 values of `docs/results.json` and `docs/RESULTS.md` from two `npm run results` runs (identical) and the `--check` output;
- the performance budget table with measured values, machine description and browser versions, PASS or MISS;
- smoke results per browser and mode for each of the three consecutive runs;
- the package result (file count, zip entries, deny-list hits 0, self-scan hits 0, with `--require-local`);
- the screenshot list, each marked as inspected and showing synthetic data only;
- whether `CSP_META` is still true;
- the manual accessibility checklist (keyboard-only pass by a person, screen reader, 200% zoom, 320 px reflow, high-contrast mode), each marked done or not verified;
- the independent review's re-derivations (Thompson update, one paired comparison, one interval) and its check that MODEL.md labels every assumption;
- what was not verified (for example Safari, mobile browsers, cross-engine floating-point identity beyond R06, the source details of section 18);
- the SHA-256 of `docs/SPEC.md` and of the owner's private spec copy (identical).

Publish checklist:

1. Get open-source approval first. Nothing is published before it.
2. Create a new public repository named `routelab` on GitHub. Tick "Add a license" and choose MIT License; choose the Node `.gitignore` template; no README. GitHub fills in the licence holder and year.
3. Add file > Upload files: upload the contents of `dist/routelab-public/` (not the folder itself, not the zip) except `LICENSE` and `.gitignore`, in batches of 100 files or fewer. Check that `.nojekyll` arrived (create it with Add file > Create new file if the file picker hid it; it is empty). Commit to `main`.
4. Settings > Pages: Deploy from a branch, `main`, `/ (root)`. Wait for the green check, open the site, run a scenario.
5. Edit `README.md` on GitHub: replace the live-demo placeholder line with `Live demo: ` followed by the Pages address exactly as shown under Settings > Pages (GitHub shows it in lower case), ending with `/routelab/`.
6. About: description (at most 350 characters, for example "Browser-only payment-routing simulator: static, weighted, rule-based and Thompson-sampling routers compared on the same synthetic UPI, card and netbanking traffic, with outages, retries, fees, regret and confidence intervals. Works offline; nothing uploaded; not financial advice."), website = the Pages address, topics `payments`, `upi`, `payment-routing`, `multi-armed-bandit`, `thompson-sampling`, `simulation`, `fintech`, `product-management`, `github-pages`.
7. Releases > Draft a new release: tag `v1.0.0` (created from `main` on publish), title "RouteLab 1.0.0", attach only `dist/routelab-public.zip`, publish.
8. Pin the repository on the profile.

## 16. Key design decisions (summary)

- **Discrete-event engine in simulated time.** Routers decide at attempt start and learn at completion (start plus latency), so they never use information from the future. A simpler "learn instantly" loop would overstate how fast learning routers react, especially for slow methods such as UPI collect.
- **Common random numbers, separate strategy streams.** Each transaction carries its own pre-drawn uniforms and normals for up to four attempts, shared by every policy; each policy's own randomness has its own stream. Differences are then caused by decisions, paired intervals are narrow, and switching one strategy off changes nothing else.
- **Customer-side vs technical declines.** Following the public UPI statistics' business/technical split, customer-side declines are drawn once per transaction, never retried and never blamed on a gateway. This stops retries and learning from looking better than they can be.
- **Per-method learning, not per bank.** Enough to show the main lessons (collect degradation moves only collect), with sparse-data problems avoided; per-bank context is a stated limitation, and the issuer-outage preset shows its consequence.
- **Thompson with time-based discounting; epsilon-greedy with a time window.** Both are standard answers to non-stationarity; using one of each by default shows both, and every learning strategy can switch memory in Configure.
- **Oracle on true technical success and routable regret.** Regret uses true probabilities, so it is low-noise and exact for structural checks (static equals the oracle in two presets).
- **Same hyperparameters in every preset.** No preset is tuned to flatter a strategy; the expectations were fixed before measurement and sanity-checked on separate pilot seeds.
- **t-intervals across seeds; seed sets fixed in advance.** Two disjoint seed sets must both pass; the UI default equals the robustness set, so a visitor's first run is a tested run.
- **Fixed synthetic names and a brand self-scan.** Users cannot type a real company into a gateway name, so screenshots and shared links stay clean; the package scan enforces that real names appear only in citations.
- **Main-thread time slices, no Web Worker.** Workers do not start from file:// in Chromium; 30 ms slices with `setTimeout` keep the page responsive within the stated budget.
- **Classic scripts with UMD.** ES modules fail from file://; the same files run in Node tests, the CLI and the results generator.

## 17. Error handling, validation and logging (summary)

| Operation | Failure | Recoverable? | Caller receives | Logged |
|---|---|---|---|---|
| `validateConfig` | any rule of 7.2 | yes | `{ ok: false, errors }` | never (library) |
| `createRunner` / `simulate` | invalid configuration or options | yes | `TypeError` / `RangeError` with the first error | never |
| `getScenario` | unknown id | yes | `RangeError` | never |
| `prng.gamma` | shape below 1 (programming error) | no | `RangeError` | never |
| `runner.result()` | called before completion | yes | `Error('runner not finished')` | never |
| `buildMemo` | missing or malformed `generatedOn` | yes | `TypeError` | never |
| `decodeState` | empty, wrong format, too long, bad base64, bad UTF-8, bad JSON, wrong shape | yes | `{ ok: false, error }` | never |
| UI start-up | undecodable hash | yes | default preset, status message (8.3) | no |
| UI start-up | decodable, invalid and renderable hash (`config.isRenderable` true) | yes | Configure with field errors, status message (8.3) | no |
| UI start-up | decodable but not renderable hash (`config.isRenderable` false: wrong structure, such as 7 gateways or 30 hourly values) | yes | default preset, status "This link's settings could not be shown, so the default scenario was loaded." (8.3) | no |
| UI `hashchange` | undecodable hash after start-up | yes | current settings and tab kept, status "This link could not be read; your current settings are kept.", hash rewritten (8.9) | no |
| UI `hashchange` | decodable but not renderable hash after start-up | yes | current settings and tab kept, status "This link's settings could not be shown; your current settings are kept.", hash rewritten (8.9) | no |
| UI run | validation problems | yes | no run; Configure selected; problem list focused; status | no |
| UI run | exception during a run | yes | no partial results; buttons re-enabled; status (8.12) | `console.warn` |
| UI handler | unexpected exception | yes | status (8.13); settings kept | `console.warn` |
| UI storage | blocked or throwing storage | yes | app works; help treated as unseen | no |
| UI copy | clipboard missing or rejected | yes | fallback; failure message with the text selected | no |
| UI export before a run | no results | yes | status "Run a scenario first." | no |
| CLI | bad arguments (7.4) | yes | message and usage on stderr, exit 2; no file read | stderr |
| CLI | config file missing, too large, not UTF-8 JSON, invalid; unwritable `--out` | yes | message on stderr, exit 1 | stderr |
| CLI | `--assert` with an expectation not held | yes | output written, exit 3 | stdout lists FAIL rows |
| Results generator | an expectation not held | yes (reported) | files written, exit 1 | stderr |
| Results generator `--check` | difference found | yes | nothing written, exit 1, first difference printed | stdout |
| Bench / smoke / screenshots | browser missing | partial | exit 2 if none ran; per-browser error entries | stdout |
| Smoke / serve | port 4317 requested | yes | exit 2 | stderr |
| Package | path, deny-list, self-scan or zip check failure | fatal for the run | outputs removed, exit 1, `REFUSED` | stdout (locations only, never terms or values) |

External inputs and their validation: configurations from the URL hash, `--config` files and library callers (7.2, with the 64,000-character cap before parsing); UI field text (8.6 conversions and 8.7 "Enter a number."); CLI arguments (7.4); environment variables (`EDGE_PATH`, `FIREFOX_PATH` must be existing files, else that browser is reported missing; `ROUTELAB_DENY_EXTRA` is split on commas and trimmed; `ROUTELAB_SKIP_PERF` only `1` has an effect).

## 18. Assumptions to confirm during implementation

These were not verified against primary sources while writing this document. The implementer confirms each when citing it and records the outcome in the report; none of them changes an interface or a number in this document (all numeric defaults are labelled illustrative regardless).

- NPCI publishes monthly UPI product statistics (volume and value) and ecosystem statistics including remitter-bank approval, business-decline and technical-decline percentages ([S1], [S3]).
- UPI person-to-merchant payments carry zero MDR under Section 269SU of the Income-tax Act and the related notification effective 1 January 2020 ([S4]).
- RBI's December 2017 circular rationalised debit-card MDR with caps by merchant turnover ([S5]).
- The Hyperswitch documentation describes rule-based, volume-split and success-rate-based routing, and Juspay has published an open-source decision engine for success-rate-based gateway selection ([S6]). If the second cannot be confirmed, the README and PRD drop that sentence.
- Juspay or the Hyperswitch documentation describes success-rate-based routing publicly as a non-stationary multi-armed bandit problem (PRD section 5; the design brief attributes this to the Hyperswitch intelligent-routing page of [S6]). Confirm the wording on the page; if it cannot be confirmed, the README and PRD drop the "non-stationary multi-armed bandit" attribution and keep only the description of the routing types.
- A public payments-industry article [S7] states a UPI technical-decline rate of about 0.8%. Confirm before citing the number; otherwise MODEL.md 4.1 and the README cite [S3] for the business/technical structure without any number, and keep the sentence that RouteLab's defaults are deliberately larger.
- The page names and URLs given for [S1]-[S3] in MODEL.md section 11 (NPCI and RBI reorganise their sites; if a URL has moved, cite the page name and the site's home address).
- The bibliographic details of [R1]-[R12] (volumes, pages, years).
- Chromium refuses to start a Web Worker from a file:// script, which is the reason for main-thread slicing (2.3); if a browser allows it, nothing changes.
- The performance budget assumes the owner's development machine (a current Windows laptop) and current Edge and Firefox releases; the report records the actual machine and versions.

## 19. Responses to the design reviews (revisions 1 and 2)

### Revision 1: responses to the round 1 design review

The design review (0 high, 11 medium, 8 nits) was answered in this revision, before any implementation or any run on `RESULTS_SEEDS` or `ROBUST_SEEDS`. No threshold of 6.4 was changed; one row (FL5) was added. Every finding was addressed; none was backlogged or ignored.

| # | Finding | Response |
|---|---|---|
| 1 | Memo cannot get title or expectation text | Addressed: `title` and `expectationText` added to the results object after `preset` (5.7), filled from `scenarioMeta`; memo, summary line, expectations list and CLI read only these (5.7, 8.8, 8.10) |
| 2 | Expectation templates, labels and units undefined; `value` overloaded | Addressed: 6.3 now defines row fields `threshold`/`threshold2`/`before`, the stored-expectation fields, and a table of policy, metric and scope labels, level/difference/relative formats, requirement phrases and the `text`/`detail` templates, with five normative examples; headline format defined from the same rules (6.4); CLI sample updated (7.4) |
| 3 | User-facing texts claim more than the rows check; PRD cold-start row | Addressed: `cost-vs-sr` text drops the unchecked mechanism sentence; `flapping` text now names both learning routers and row FL5 (epsilon-greedy regret at least 15, pilot 31.51) checks it; `peak-outage`, `collect-degradation` and `cold-start` texts tightened to what PO1-PO5, CD1-CD3 and CO1-CO6 check; PRD 7.4 cold-start row rewritten |
| 4 | Distribution tolerances below 2 SE or without N | Addressed: normative 4-standard-error rule with stated N (10.1); hourly shares and method mix use `4 * sqrt(p(1-p)/N)`; amount quantiles use the log-space quantile standard error; `gamma`, `beta`, `weightedIndex` 200,000 draws; weighted split 200,000 decisions; epsilon 1 100,000 decisions; `normal` and `poisson` raised to 400,000 draws so their variance checks also meet the rule |
| 5 | Conformance double rounding | Addressed: cells computed from unrounded per-seed day metrics (`metrics.dayMetrics`, 5.1) and compared with `|x - cell| <= 0.5 * unit + 1e-9` (6.6) |
| 6 | D1 needs one gateway; engine config status | Addressed: D1 uses A and B with identical card settings, static A, B, `maxRetries 0`; `runPolicy` takes a normalised config, tests build configs through `validateConfig` (3.5, 10.1) |
| 7 | PRD CLI flags | Addressed: PRD 7.6 and Flow D use `--format` and `--out` |
| 8 | Help citations vs brand self-scan | Addressed: Help cites no source by name and points to MODEL.md; README cites the sources (13) |
| 9 | README test breaks after the live link is added | Addressed: `readme.test.cjs` accepts the placeholder or one `https://<name>.github.io/routelab/` line (10.1) |
| 10 | Focus window with one field filled | Addressed: "Enter both times, or leave both empty." and "Enter a time as HH:MM." (8.7), with `config.codec.fromHHMM` (8.6) and smoke R09 steps |
| 11 | Technical-decline defaults above public figures | Addressed: MODEL 4.1, 9 and 10 state the deliberate exaggeration and why; README item 12 and PRD assumption E repeat it; the public figure is [S7] and is in section 18 as confirm-before-citing |
| 12 | Capacity counters clamp late minutes | Addressed: a `Map` per capacity-limited gateway keyed by `floor(t)` (3.5); no preset result changes |
| 13 | Percent display formatting | Addressed: `config.codec` with `toPrecision(12)` both ways and an every-preset round-trip test (8.6, 10.1) |
| 14 | MODEL parameter table gaps | Addressed: rows for the 200 ms rate-limit latency, Beta(1, 1) prior, optimistic empty-cell estimate, amount clip and 15-minute bucket (MODEL 9) |
| 15 | Sources lack locators; non-stationary claim | Addressed: page names and URLs for [S1]-[S3], [S6] and new [S7] (MODEL 11); the claim and the URLs are in section 18 |
| 16 | 5.4 exact-math values | Addressed: tolerance 1e-9 for mean, sd and interval, with the floating-point note (5.4) |
| 17 | `perf.test.cjs` vs an honest miss | Addressed: explicit `ROUTELAB_SKIP_PERF=1` path in the gate, stated in the report; README note for people who clone (9, 12.1 item 13) |
| 18 | Private guide has no done-criteria | Addressed: M9 lists the guide criteria (14) |
| 19 | Gateway SR over time never shown | Addressed: "Gateway attempt success rate by hour" table under chart 2 from the new `series.hourly` (5.6, 5.7, 8.8), checked in R05; the other data tables also use `series.hourly`, so the UI never re-pools ratios |

### Revision 2: responses to the round 2 design review

The round 2 review (0 high, 1 medium, 10 nits; all 19 round 1 findings closed) was answered in this revision, still before any implementation or any run on `RESULTS_SEEDS` or `ROBUST_SEEDS`. No threshold, preset value, seed set or 6.6 cell changed. Every finding was addressed; none was backlogged or ignored.

| # | Sev | Finding | Response |
|---|---|---|---|
| 20 | MEDIUM | A link that decodes but cannot be rendered has no defined handling | Addressed: pure `config.isRenderable(input)` with the exact structural rules (7.2), unit-tested in `config.test.cjs` (10.1); 8.3 step 2 split into renderable-invalid (leaf rendering rules, immediate validation) and not renderable (default preset, status "This link's settings could not be shown, so the default scenario was loaded."); start-up wrapped like the handlers (8.13); new section 17 row; smoke R08b (card `sr 1.5` -> value 150 and `aria-invalid`) and R08c (7 gateways -> default preset, no field errors) (10.3) |
| 21 | NIT | "section 3.11" cross-references | Addressed: SPEC 3.5 and PRD 7.3 now point to section 3.7 |
| 22 | NIT | The 64,000 limit means two things | Addressed: 7.2 states hash string longer than 64,000 characters for `decodeState` and file larger than 64,000 bytes for the CLI; 8.9 fixes when `too-long` is checked; `state.test.cjs` tests 64,000 vs 64,001 characters and `cli.test.cjs` 64,000 vs 64,001 bytes (10.1) |
| 23 | NIT | E5, E6, E8 don't fix `uD` | Addressed: default `uS = 0.5`, `z = 0`, `uD = 0.99` in all four slots unless a case says otherwise (10.1) |
| 24 | NIT | CLI focus block layout undefined | Addressed: one row per policy in `results.policies` order, label padded to 22, Order SR column format; per-method header and columns for `collect-degradation` (7.4) |
| 25 | NIT | Which fields are percent; message unit translation | Addressed: exact `toPercent`, as-stored and `toSeconds` field lists (8.6); translated limit messages enumerated and produced by the pure, unit-tested `config.codec.displayMessage` (8.7, 10.1) |
| 26 | NIT | Custom memo Setup line repeats itself | Addressed: separate preset and custom Setup lines (8.10), both checked in `memo.test.cjs` (10.1) |
| 27 | NIT | No data field for "Changes from the base" | Addressed: `changes` (verbatim 6.2 cell) in every preset and in the 7.1 `scenarios` shape; RESULTS.md reads it (7.5); spot-checked in `scenarios.test.cjs` (10.1) |
| 28 | NIT | PRD 7.4 cells claim more than the 6.4 rows check | Addressed both ways: the `steady`, `peak-outage`, `collect-degradation` and `issuer-outage` cells now state only what the rows check, and G4 says SPEC 6.4 lists exactly what the suite asserts (PRD 6, 7.4) |
| 29 | NIT | README URL/user-name rule too broad; case-sensitive regex | Addressed: 12.1 item 2 now says the owner's user name and repository URL (source URLs are fine); `readme.test.cjs` host part is `[A-Za-z0-9-]+`, and publish step 5 says to paste the address as shown under Settings > Pages (10.1, 15) |
| 30 | NIT | MODEL 9 lacks the non-learning strategy defaults | Addressed: MODEL 9 row "Static priority, weighted split, rules", labelled Illustrative with the stale-belief note |

### Revision 3: responses to the round 3 design review

The round 3 review (0 high, 1 medium, 3 nits; all 11 round 2 findings closed) was answered in this revision, before any implementation or any run on `RESULTS_SEEDS` or `ROBUST_SEEDS`. No threshold, preset value, seed set or 6.6 cell changed. Every finding was addressed; none was backlogged or ignored.

| # | Sev | Finding | Response |
|---|---|---|---|
| 31 | MEDIUM | `isRenderable` does not check gateway and bank ids, which drive generated element ids | Addressed: 7.2 `isRenderable` now requires `gateways[i].id === GATEWAY_IDS[i]` and `traffic.banks[i].id === BANK_IDS[i]`; `config.test.cjs` false cases for ids `['A', 'A']`, `['A', 'C']`, banks `[Y, X, Z]` and id `5` (10.1); smoke R08d (10.3) |
| 32 | NIT | Renderable-invalid rendering does not cover event method checkboxes or the target select | Addressed: 8.3 step 2 defines both; R08b has a second hash with `methods: "card"` (10.3) |
| 33 | NIT | "per-field messages" for banks and rules | Addressed: exact messages in the 7.2 `traffic.banks` and `strategies.rules.rules` rows (plus `must have at most 20 rules` for the length limit); 8.7 translates bank `srFactor` like event `srFactor` |
| 34 | NIT | Bad hash on `hashchange` mid-session | Addressed: 8.9 keeps the current configuration and tab, shows a kept-settings status and rewrites the hash; two section 17 rows; smoke R08e (10.3) |
