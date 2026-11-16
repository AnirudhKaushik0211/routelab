'use strict';
// In-browser performance (SPEC 9, P1 and P2). File mode, fresh profiles, headless, viewport 1440 x 900.
// Usage: node scripts/bench-browser.cjs [--browser edge|firefox|all] [--edge <path>] [--firefox <path>]
//                                       [--cdp-port 9399] [--bidi-port 9400]
// One warm-up click and 10 measured clicks on #rl-scn-run per browser. P1: p95 of data-ms <= 2,000 ms; P2: every
// data-max-slice-ms <= 250 ms. Writes dist/logs/perf-browser.json. Exit 0 all budgets met, 1 a budget missed or a
// browser failed, 2 no browser ran or bad arguments. Only processes started here are stopped. Port 4317 is refused.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');
const pkg = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const RESERVED_PORT = 4317;
const P1_MS = 2000;
const P2_MS = 250;
const VALUE_FLAGS = ['--browser', '--edge', '--firefox', '--cdp-port', '--bidi-port'];

function usage(msg) {
  console.error(msg);
  console.error('Usage: node scripts/bench-browser.cjs [--browser edge|firefox|all] [--edge <path>] [--firefox <path>] [--cdp-port 9399] [--bidi-port 9400]');
  process.exit(2);
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!VALUE_FLAGS.includes(argv[i])) usage('unknown option: ' + argv[i]);
    if (i + 1 >= argv.length) usage(argv[i] + ' needs a value');
    o[argv[i]] = argv[++i];
  }
  const browser = String(o['--browser'] || 'all').toLowerCase();
  if (!['edge', 'firefox', 'all'].includes(browser)) usage('--browser must be edge, firefox or all.');
  const cdp = Number(o['--cdp-port'] || '9399');
  const bidi = Number(o['--bidi-port'] || '9400');
  for (const [name, p] of [['--cdp-port', cdp], ['--bidi-port', bidi]]) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) usage(name + ' must be a port number.');
    if (p === RESERVED_PORT) usage('Port ' + RESERVED_PORT + ' is reserved for another local tool; choose another port.');
  }
  return { browsers: browser === 'all' ? ['edge', 'firefox'] : [browser], edge: o['--edge'], firefox: o['--firefox'], cdp, bidi };
}

const idExpr = 'Number(document.getElementById("rl-run-time").getAttribute("data-run-id"))';

async function benchOne(name, exe, args) {
  const d = name === 'edge' ? await B.openEdge(exe, { cdpPort: args.cdp }) : await B.openFirefox(exe, { bidiPort: args.bidi });
  try {
    await d.setViewport(1440, 900);
    await d.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
    const ready = await B.waitFor(() => d.evaluate('!!(window.RouteLab && document.getElementById("rl-scn-peak-outage") && document.getElementById("rl-cfg-form").children.length > 0)'), 15000, 100);
    if (!ready) throw new Error('the app did not load');
    await d.evaluate('document.getElementById("rl-scn-peak-outage").checked = true');
    const runs = [];
    for (let i = 0; i < 11; i++) {
      const before = await d.evaluate(idExpr);
      await d.evaluate('document.getElementById("rl-scn-run").click()');
      const ok = await B.waitFor(async () => (await d.evaluate(idExpr)) > before, 60000, 50);
      if (!ok) throw new Error('run ' + (i + 1) + ' did not finish');
      const m = await d.evaluate('({ ms: Number(document.getElementById("rl-run-time").getAttribute("data-ms")), slice: Number(document.getElementById("rl-run-time").getAttribute("data-max-slice-ms")) })');
      if (i > 0) runs.push(m);
    }
    const ms = runs.map((r) => r.ms);
    const sorted = ms.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)];
    const maxSlice = Math.max.apply(null, runs.map((r) => r.slice));
    return { browser: name, browserVersion: d.version, runsMs: ms, p95: p95, maxSliceMs: maxSlice, pass: p95 <= P1_MS && maxSlice <= P2_MS };
  } finally {
    try { await d.close(); } catch (e) { B.killTree(d.proc); }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = { version: pkg.version, p1BudgetMs: P1_MS, p2BudgetMs: P2_MS, browsers: [] };
  let ok = 0;
  let failed = 0;
  for (const name of args.browsers) {
    const exe = B.resolveExe(name, args[name]);
    if (!exe) { out.browsers.push({ browser: name, error: 'executable not found' }); failed++; console.log('SKIP ' + name + ': executable not found'); continue; }
    try {
      const r = await benchOne(name, exe, args);
      out.browsers.push(r);
      ok++;
      if (!r.pass) failed++;
      console.log(name + ' (' + r.browserVersion + '): p95 ' + r.p95 + ' ms (budget ' + P1_MS + '), longest slice ' + r.maxSliceMs + ' ms (budget ' + P2_MS + '): ' + (r.pass ? 'PASS' : 'MISS') + '; runs ' + r.runsMs.join(', '));
    } catch (e) {
      out.browsers.push({ browser: name, error: String(e.message || e).split('\n')[0] });
      failed++;
      console.log('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]);
    }
  }
  if (ok === 0) { console.log('No browser produced results; nothing written.'); process.exit(2); }
  fs.mkdirSync(path.join(ROOT, 'dist', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'logs', 'perf-browser.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error((e && e.stack) || e); process.exit(1); });
