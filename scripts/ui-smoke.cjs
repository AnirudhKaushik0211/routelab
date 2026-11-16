'use strict';
// Browser smoke test (SPEC 10.3): scenarios R01-R19 (plus R08b-R08e) in headless Edge (CDP) and Firefox (WebDriver BiDi),
// in file:// mode (double-click equivalent) and http mode (scripts/serve.cjs on 127.0.0.1).
// Usage: node scripts/ui-smoke.cjs [--browser edge|firefox|all] [--mode file|http|all] [--port 4395]
//                                  [--cdp-port 9397] [--bidi-port 9398] [--edge <path>] [--firefox <path>] [--keep]
// Exit codes: 0 = all passed in every browser that ran; 1 = a failure; 2 = no browser could run or invalid arguments.
// Only processes started here are ever stopped (taskkill /PID <pid> /T /F). Port 4317 is refused.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');
const RL = require('../js/routelab.js');
const SC = require('../js/scenarios.js');

const ROOT = path.resolve(__dirname, '..');
const RESERVED_PORT = 4317;
const VALUE_FLAGS = ['--browser', '--mode', '--port', '--cdp-port', '--bidi-port', '--edge', '--firefox'];
const BOOL_FLAGS = ['--keep'];
const argv = process.argv.slice(2);

function usage(msg) {
  console.error(msg);
  console.error('Usage: node scripts/ui-smoke.cjs [--browser edge|firefox|all] [--mode file|http|all] [--port 4395] ' +
    '[--cdp-port 9397] [--bidi-port 9398] [--edge <path>] [--firefox <path>] [--keep]');
  process.exit(2);
}
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (BOOL_FLAGS.includes(a)) { opts[a] = true; continue; }
  if (!VALUE_FLAGS.includes(a)) usage('unknown option: ' + a);
  if (i + 1 >= argv.length) usage(a + ' needs a value');
  opts[a] = argv[++i];
}
const BROWSER = String(opts['--browser'] || 'all').toLowerCase();
const MODE = String(opts['--mode'] || 'all').toLowerCase();
const PORT = Number(opts['--port'] || '4395');
const CDP_PORT = Number(opts['--cdp-port'] || '9397');
const BIDI_PORT = Number(opts['--bidi-port'] || '9398');
const KEEP = !!opts['--keep'];
const sleep = B.sleep;

if (typeof WebSocket !== 'function') usage('Node 22+ is required (global WebSocket).');
if (!['edge', 'firefox', 'all'].includes(BROWSER)) usage('--browser must be edge, firefox or all.');
if (!['file', 'http', 'all'].includes(MODE)) usage('--mode must be file, http or all.');
for (const [name, p] of [['--port', PORT], ['--cdp-port', CDP_PORT], ['--bidi-port', BIDI_PORT]]) {
  if (!Number.isInteger(p) || p < 1 || p > 65535) usage(name + ' must be a port number.');
  if (p === RESERVED_PORT) usage('Port ' + RESERVED_PORT + ' is reserved for another local tool; choose another port.');
}

const BROWSERS = BROWSER === 'all' ? ['edge', 'firefox'] : [BROWSER];
const MODES = MODE === 'all' ? ['file', 'http'] : [MODE];
const ORIGIN = 'http://127.0.0.1:' + PORT;
const children = [];
const results = [];

// ---------------------------------------------------------------- shared preload (SPEC 10.3)
const HOOK = '(function () {\n' +
  '  if (window.__smokeHooked) return;\n' +
  '  window.__smokeHooked = true;\n' +
  '  window.__smokeCsp = 0; window.__smokeBlobs = []; window.__smokeDownloads = [];\n' +
  '  window.addEventListener("securitypolicyviolation", function () { window.__smokeCsp += 1; }, true);\n' +
  '  var create = URL.createObjectURL;\n' +
  '  URL.createObjectURL = function (b) { window.__smokeBlobs.push(b); return create.call(URL, b); };\n' +
  '  var click = HTMLAnchorElement.prototype.click;\n' +
  '  HTMLAnchorElement.prototype.click = function () {\n' +
  '    if (this.hasAttribute("download")) { window.__smokeDownloads.push(this.getAttribute("download")); return; }\n' +
  '    return click.apply(this, arguments);\n' +
  '  };\n' +
  '})();';

const BLOCK_STORAGE = '(function () {\n' +
  '  try {\n' +
  '    Object.defineProperty(window, "localStorage", { configurable: true, get: function () {\n' +
  '      throw new DOMException("The operation is insecure.", "SecurityError"); } });\n' +
  '  } catch (e) { /* ignore */ }\n' +
  '})();';

// ---------------------------------------------------------------- helpers
function fail(msg) { throw new Error(msg); }
function check(cond, msg) { if (!cond) fail(msg); }
const J = JSON.stringify;
const byId = B.byId;
const baseUrl = (mode) => (mode === 'file' ? pathToFileURL(path.join(ROOT, 'index.html')).href : ORIGIN + '/index.html');

const READY = '(() => !!(window.RouteLab && window.RouteLab.createRunner && document.querySelector("[role=tab][aria-selected=true]") &&' +
  ' document.getElementById("rl-cfg-form") && document.getElementById("rl-cfg-form").children.length > 0))()';

const DUP_IDS = '(() => { const seen = Object.create(null), dup = []; for (const el of document.querySelectorAll("[id]")) { if (seen[el.id]) dup.push(el.id); seen[el.id] = 1; } return dup; })()';

async function harvestCsp(d) {
  try { const n = await d.evaluate('typeof window.__smokeCsp === "number" ? window.__smokeCsp : 0'); d.cspTotal += Number(n) || 0; } catch (e) { /* no page */ }
}
async function waitReady(d, what) {
  const ok = await B.waitFor(() => d.evaluate(READY), 15000, 100);
  check(ok, 'the app did not start (' + what + ')');
}
async function open(d, url) {
  await harvestCsp(d);
  await d.goto('about:blank');
  await d.goto(url);
  await waitReady(d, url.slice(0, 5));
}
async function clearStorage(d, mode) {
  await open(d, baseUrl(mode));
  return d.evaluate('(() => { try { localStorage.clear(); return localStorage.length === 0 ? "ok" : "length " + localStorage.length; } catch (e) { return "threw " + e.name; } })()');
}
const text = (d, id) => d.evaluate('(' + byId(id) + ' || {}).textContent');
const status = (d) => text(d, 'rl-status-text');
async function click(d, id) { await B.clickEl(d, byId(id)); await sleep(60); }
async function setVal(d, id, v) {
  await d.evaluate('(() => { const el = ' + byId(id) + '; el.value = ' + J(String(v)) + '; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return el.value; })()');
}
async function selectedTab(d) { return d.evaluate('(() => { const t = document.querySelector("[role=tab][aria-selected=true]"); return t ? t.id : null; })()'); }
async function tab(d, name) {
  await click(d, 'rl-tab-' + name);
  check(await selectedTab(d) === 'rl-tab-' + name, name + ' tab not selected after click');
}
const runId = (d) => d.evaluate('Number(' + byId('rl-run-time') + '.getAttribute("data-run-id"))');
async function waitRun(d, before, what) {
  const ok = await B.waitFor(async () => (await runId(d)) > before, 40000, 50);
  check(ok, 'run did not finish within 40 s (' + what + ')');
}
async function runScenario(d, id) {
  await tab(d, 'scenarios');
  await click(d, 'rl-scn-' + id);
  const before = await runId(d);
  await click(d, 'rl-scn-run');
  await waitRun(d, before, id);
}
async function hashConfig(d) { return d.evaluate('(() => { const r = RouteLab.decodeState(location.hash); return r.ok ? r.config : null; })()'); }
const hashFor = (d, js) => d.evaluate('(() => { const c = RouteLab.getScenario("peak-outage"); ' + js + ' return RouteLab.encodeState(c); })()');

async function openWithHash(d, mode, js) {
  await open(d, baseUrl(mode));
  const hash = await hashFor(d, js);
  await d.goto('about:blank');
  await d.goto(baseUrl(mode) + hash);
  await waitReady(d, 'hash');
  return hash;
}

const PAGE_STATE = '(() => {\n' +
  '  const sel = document.querySelector("[role=tab][aria-selected=true]");\n' +
  '  const vis = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };\n' +
  '  return { tab: sel ? sel.id : null, helpVisible: vis("rl-panel-help"), helpHidden: document.getElementById("rl-panel-help").hidden,\n' +
  '    scnHidden: document.getElementById("rl-panel-scenarios").hidden, cfgHidden: document.getElementById("rl-panel-config").hidden,\n' +
  '    resHidden: document.getElementById("rl-panel-results").hidden, disclaimer: vis("rl-disclaimer"),\n' +
  '    flag: (function () { try { return localStorage.getItem("routelab.helpSeen.v1"); } catch (e) { return "blocked"; } })() };\n' +
  '})()';

const MSG_COPIED = 'Copied the memo.';
const MSG_COPY_FAIL = 'Copy did not work in this browser. The memo text is selected; press Ctrl+C (Cmd+C on a Mac).';

// ---------------------------------------------------------------- scenarios
const SCENARIOS = [
  { id: 'R01', name: 'first visit', fn: async (d, mode, ctx) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    await d.reload();
    await waitReady(d, 'reload');
    const p = await d.evaluate(PAGE_STATE);
    check(p.tab === 'rl-tab-help', 'selected tab ' + p.tab);
    check(p.helpVisible && !p.helpHidden && p.scnHidden && p.cfgHidden && p.resHidden, 'panel visibility ' + J(p));
    check(p.disclaimer, 'disclaimer not visible');
    ctx.noErrors();
  } },
  { id: 'R02', name: 'help seen persists', fn: async (d) => {
    await click(d, 'rl-help-start');
    let p = await d.evaluate(PAGE_STATE);
    check(p.tab === 'rl-tab-scenarios', 'after Start: ' + p.tab);
    await harvestCsp(d);
    await d.reload();
    await waitReady(d, 'reload');
    p = await d.evaluate(PAGE_STATE);
    check(p.tab === 'rl-tab-scenarios', 'after reload: ' + p.tab);
    check(p.flag === '1', 'flag = ' + p.flag);
  } },
  { id: 'R03', name: 'storage blocked', fn: async (d, mode, ctx) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    const h = await d.addPreload(BLOCK_STORAGE);
    try {
      await harvestCsp(d);
      await d.goto('about:blank');
      await d.goto(baseUrl(mode));
      await waitReady(d, 'storage blocked');
      const blocked = await d.evaluate('(() => { try { void window.localStorage; return false; } catch (e) { return e.name; } })()');
      check(blocked === 'SecurityError', 'storage was not blocked: ' + blocked);
      let p = await d.evaluate(PAGE_STATE);
      check(p.tab === 'rl-tab-help', 'selected tab ' + p.tab);
      await tab(d, 'scenarios');
      await click(d, 'rl-scn-cost-vs-sr');
      await click(d, 'rl-scn-load');
      await setVal(d, 'rl-cfg-seeds', 3);
      const before = await runId(d);
      await click(d, 'rl-cfg-run');
      await waitRun(d, before, 'storage blocked');
      p = await d.evaluate(PAGE_STATE);
      check(p.tab === 'rl-tab-results', 'results not shown: ' + p.tab);
      ctx.noErrors();
    } finally {
      await d.removePreload(h);
    }
  } },
  { id: 'R04', name: 'every-scenario-runs', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    for (const s of SC.scenarios) {
      await runScenario(d, s.id);
      const r = await d.evaluate('(() => { const a = document.activeElement; const items = [...document.querySelectorAll("#rl-res-expect-list li")];\n' +
        '  const svgs = [...document.querySelectorAll("svg[role=img]")].filter((v) => v.querySelector("title") && v.querySelector("title").textContent && v.querySelector("desc") && v.querySelector("desc").textContent);\n' +
        '  return { tab: document.querySelector("[role=tab][aria-selected=true]").id, active: a ? a.id : null,\n' +
        '    rows: document.querySelectorAll("#rl-res-table tbody tr").length, svgs: svgs.length, items: items.length,\n' +
        '    held: items.every((li) => li.textContent.indexOf("Held on these seeds") === 0), summary: document.getElementById("rl-res-summary-text").textContent }; })()');
      check(r.tab === 'rl-tab-results' && r.active === 'rl-res-heading', s.id + ': tab/focus ' + J(r));
      check(r.rows === 7, s.id + ': table rows ' + r.rows);
      check(r.svgs === 3, s.id + ': charts ' + r.svgs);
      check(r.items === s.expectations.length, s.id + ': expectation items ' + r.items + ' vs ' + s.expectations.length);
      check(r.held, s.id + ': not every expectation held');
      check(r.summary.indexOf(s.title + ': 20 seeds (1-20)') === 0, s.id + ': summary ' + r.summary);
    }
  } },
  { id: 'R05', name: 'charts', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await runScenario(d, 'peak-outage');
    const q = (js) => d.evaluate('(() => { ' + js + ' })()');
    const c1 = await q('return { groups: document.querySelectorAll("#rl-ch-sr svg g[data-role=series]").length, rects: document.querySelectorAll("#rl-ch-sr rect[data-role=event]").length, desc: document.querySelector("#rl-ch-sr desc").textContent };');
    check(c1.groups === 7 && c1.rects >= 1, 'chart 1 ' + J({ g: c1.groups, r: c1.rects }));
    await setVal(d, 'rl-ch-sr-method', 'upi_collect');
    const d1 = await q('return document.querySelector("#rl-ch-sr desc").textContent;');
    check(d1 !== c1.desc, 'chart 1 desc unchanged by method');
    const c2 = await q('return document.querySelector("#rl-ch-share desc").textContent;');
    await setVal(d, 'rl-ch-share-policy', 'static');
    const d2 = await q('return document.querySelector("#rl-ch-share desc").textContent;');
    check(d2 !== c2, 'chart 2 desc unchanged by policy');
    const c3 = await q('return { m: document.querySelectorAll("#rl-ch-scatter [data-role=marker]").length, w: document.querySelectorAll("#rl-ch-scatter [data-role=whisker]").length };');
    check(c3.m === 7 && c3.w === 14, 'chart 3 ' + J(c3));
    const rows = await q('return { a: document.querySelectorAll("#rl-ch-sr-table tbody tr").length, b: document.querySelectorAll("#rl-ch-share-table tbody tr").length, c: document.querySelectorAll("#rl-ch-scatter-table tbody tr").length, g: document.querySelectorAll("#rl-ch-gwsr-table tbody tr").length, h: document.querySelectorAll("#rl-ch-gwsr-table thead th").length };');
    check(rows.a === 24 && rows.b === 24 && rows.c === 7 && rows.g === 24, 'table rows ' + J(rows));
    check(rows.h === 4, 'gateway SR columns ' + rows.h);
    const cells = await q('const r = document.querySelectorAll("#rl-ch-gwsr-table tbody tr"); return [r[20].children[1].textContent, r[18].children[1].textContent];');
    const n20 = parseFloat(cells[0]); const n18 = parseFloat(cells[1]);
    check(n20 < n18, 'Gateway A attempt SR at 20:00 (' + cells[0] + ') is not below 18:00 (' + cells[1] + ')');
  } },
  { id: 'R06', name: 'browser-equals-node', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    const s = await d.evaluate('RouteLab.toJson(RouteLab.simulate(RouteLab.getScenario("peak-outage"), { scenarioId: "peak-outage", seeds: 3, seedStart: 1 }))');
    const node = RL.toJson(RL.simulate(RL.getScenario('peak-outage'), { scenarioId: 'peak-outage', seeds: 3, seedStart: 1 }));
    const h = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
    check(h(s) === h(node), 'browser JSON differs from Node JSON (' + h(s).slice(0, 12) + ' vs ' + h(node).slice(0, 12) + ')');
  } },
  { id: 'R07', name: 'hash-restore', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await runScenario(d, 'cost-vs-sr');
    await sleep(500);
    const url = await d.evaluate('location.href');
    const table = await text(d, 'rl-res-table');
    await d.goto('about:blank');
    await d.goto(url);
    await waitReady(d, 'restore');
    const ok = await B.waitFor(async () => (await runId(d)) >= 1, 40000, 50);
    check(ok, 'no run after opening the saved link');
    check(await selectedTab(d) === 'rl-tab-results', 'Results not selected');
    check(await text(d, 'rl-res-table') === table, 'results table differs after restore');
    const s = await status(d);
    check(s === 'Loaded the settings from the link.', 'status ' + J(s));
  } },
  { id: 'R08', name: 'bad-hash', fn: async (d, mode, ctx) => {
    await open(d, baseUrl(mode));
    await d.goto('about:blank');
    await d.goto(baseUrl(mode) + '#s=not-valid!');
    await waitReady(d, 'bad hash');
    const r = await d.evaluate('({ status: document.getElementById("rl-status-text").textContent, gw: document.querySelectorAll("#rl-cfg-gateways fieldset[id^=rl-cfg-gw-]").length,' +
      ' card: document.getElementById("rl-cfg-gw-a-card-sr").value })');
    check(r.status === 'This link could not be read, so the default scenario was loaded.', 'status ' + J(r.status));
    check(r.gw === 3 && r.card === '96', 'default preset not in Configure: ' + J(r));
    ctx.noErrors();
  } },
  { id: 'R08b', name: 'invalid-but-renderable', fn: async (d, mode, ctx) => {
    await openWithHash(d, mode, 'c.gateways[0].methods.card.sr = 1.5;');
    const r = await d.evaluate('({ tab: document.querySelector("[role=tab][aria-selected=true]").id, v: document.getElementById("rl-cfg-gw-a-card-sr").value,' +
      ' inv: document.getElementById("rl-cfg-gw-a-card-sr").getAttribute("aria-invalid"), errs: document.getElementById("rl-cfg-errors").textContent, shown: !document.getElementById("rl-cfg-errors").hidden,' +
      ' status: document.getElementById("rl-status-text").textContent, run: Number(document.getElementById("rl-run-time").getAttribute("data-run-id")) })');
    check(r.tab === 'rl-tab-config', 'tab ' + r.tab);
    check(r.v === '150' && r.inv === 'true', 'field ' + J({ v: r.v, inv: r.inv }));
    check(r.shown && r.errs.indexOf('must be a number from 0 to 100') > 0, 'problem list ' + r.errs);
    check(r.status === 'The link\'s settings have problems; fix the marked fields, then run.', 'status ' + J(r.status));
    check(r.run === 0, 'a run started');
    ctx.noErrors();
    await openWithHash(d, mode, 'c.events[0].methods = "card";');
    const r2 = await d.evaluate('({ ticked: [...document.querySelectorAll("input[id^=rl-cfg-ev-][id*=-m-]")].filter((e) => e.checked).length, boxes: document.querySelectorAll("input[id^=rl-cfg-ev-][id*=-m-]").length,' +
      ' err: [...document.querySelectorAll("[id$=-m-err]")].map((e) => e.textContent).join("|") })');
    check(r2.boxes === 4 && r2.ticked === 0, 'method boxes ' + J(r2));
    check(r2.err.indexOf('Choose at least one payment method.') >= 0, 'method error ' + r2.err);
    ctx.noErrors();
  } },
  { id: 'R08c', name: 'unrenderable-hash', fn: async (d, mode, ctx) => {
    await openWithHash(d, mode, 'while (c.gateways.length < 7) c.gateways.push(JSON.parse(JSON.stringify(c.gateways[0])));');
    const r = await d.evaluate('({ gw: document.querySelectorAll("#rl-cfg-gateways fieldset[id^=rl-cfg-gw-]").length, inv: document.querySelectorAll("[aria-invalid=true]").length,' +
      ' status: document.getElementById("rl-status-text").textContent })');
    check(r.gw === 3 && r.inv === 0, 'form ' + J(r));
    check(r.status === 'This link\'s settings could not be shown, so the default scenario was loaded.', 'status ' + J(r.status));
    ctx.noErrors();
  } },
  { id: 'R08d', name: 'mismatched-gateway-ids', fn: async (d, mode, ctx) => {
    await openWithHash(d, mode, 'c.gateways[1].id = "A";');
    const r = await d.evaluate('({ gw: document.querySelectorAll("#rl-cfg-gateways fieldset[id^=rl-cfg-gw-]").length, inv: document.querySelectorAll("[aria-invalid=true]").length,' +
      ' status: document.getElementById("rl-status-text").textContent, dups: ' + DUP_IDS + ' })');
    check(r.gw === 3 && r.inv === 0, 'form ' + J({ gw: r.gw, inv: r.inv }));
    check(r.status === 'This link\'s settings could not be shown, so the default scenario was loaded.', 'status ' + J(r.status));
    check(r.dups.length === 0, 'duplicate ids ' + r.dups.join(','));
    ctx.noErrors();
  } },
  { id: 'R08e', name: 'bad-hash-mid-session', fn: async (d, mode, ctx) => {
    await open(d, baseUrl(mode));
    await tab(d, 'scenarios');
    await click(d, 'rl-scn-steady');
    await click(d, 'rl-scn-load');
    await setVal(d, 'rl-cfg-seeds', 3);
    await sleep(900);
    await d.evaluate('location.hash = "#s=not-valid!"');
    const ok = await B.waitFor(async () => (await status(d)) === 'This link could not be read; your current settings are kept.', 5000, 50);
    check(ok, 'status ' + J(await status(d)));
    check(await d.evaluate('document.getElementById("rl-cfg-seeds").value') === '3', 'seeds not kept');
    check(await selectedTab(d) === 'rl-tab-config', 'tab not kept');
    const cfg = await hashConfig(d);
    check(cfg && cfg.run && cfg.run.seeds === 3, 'hash not rewritten from the current settings: ' + J(cfg && cfg.run));
    ctx.noErrors();
  } },
  { id: 'R09', name: 'validation', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'config');
    await setVal(d, 'rl-cfg-gw-a-card-sr', 150);
    const inv = () => d.evaluate('({ inv: document.getElementById("rl-cfg-gw-a-card-sr").getAttribute("aria-invalid"), err: document.getElementById("rl-cfg-gw-a-card-sr-err").textContent,' +
      ' errVisible: !document.getElementById("rl-cfg-gw-a-card-sr-err").hidden, list: document.getElementById("rl-cfg-errors").textContent })');
    let r = await inv();
    check(r.inv === 'true' && r.errVisible, 'not marked invalid ' + J(r));
    check(r.err === 'Gateway A, Card success rate: must be a number from 0 to 100.', 'error text ' + J(r.err));
    check(r.list.indexOf('Gateway A, Card success rate') >= 0, 'problem list ' + r.list);
    const before = await runId(d);
    await click(d, 'rl-cfg-run');
    await sleep(300);
    check(await runId(d) === before, 'a run started with problems');
    check(await status(d) === 'Fix 1 problem(s) before running.', 'status ' + J(await status(d)));
    await setVal(d, 'rl-cfg-gw-a-card-sr', 96);
    r = await inv();
    check(r.inv === null && !r.errVisible, 'error not cleared ' + J(r));
    const focusErr = () => d.evaluate('({ err: document.getElementById("rl-cfg-focus-end-err").textContent, shown: !document.getElementById("rl-cfg-focus-end-err").hidden,' +
      ' startErr: document.getElementById("rl-cfg-focus-start-err").textContent })');
    await setVal(d, 'rl-cfg-focus-end', '');
    let f = await focusErr();
    check(f.startErr === 'Enter both times, or leave both empty.' || f.err === 'Enter both times, or leave both empty.', 'one empty ' + J(f));
    await sleep(1000);
    let cfg = await hashConfig(d);
    check(cfg && cfg.focus && cfg.focus.start === 1170 && cfg.focus.end === 1230, 'hash lost the previous focus ' + J(cfg && cfg.focus));
    await setVal(d, 'rl-cfg-focus-end', '25:00');
    f = await focusErr();
    check(f.err === 'Enter a time as HH:MM.' && f.shown, 'invalid time ' + J(f));
    await setVal(d, 'rl-cfg-focus-end', '20:30');
    f = await focusErr();
    check(!f.shown && f.startErr === '' || !f.shown, 'time error not cleared ' + J(f));
    await sleep(1000);
    cfg = await hashConfig(d);
    check(cfg && cfg.focus && cfg.focus.end === 1230, 'hash focus.end ' + J(cfg && cfg.focus));
    await setVal(d, 'rl-cfg-focus-start', '');
    await setVal(d, 'rl-cfg-focus-end', '');
    f = await focusErr();
    check(!f.shown && f.startErr === '', 'both empty still shows an error ' + J(f));
    await sleep(1000);
    cfg = await hashConfig(d);
    check(cfg && cfg.focus === null, 'hash focus should be null: ' + J(cfg && cfg.focus));
  } },
  { id: 'R10', name: 'edits-take-effect', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'scenarios');
    await click(d, 'rl-scn-steady');
    await click(d, 'rl-scn-load');
    await setVal(d, 'rl-cfg-seeds', 3);
    await click(d, 'rl-cfg-ev-add');
    const target = await d.evaluate('(() => { const s = [...document.querySelectorAll("select[id^=rl-cfg-ev-][id$=-target]")]; return s.length ? s[s.length - 1].id : null; })()');
    check(target, 'new event has no target select');
    await setVal(d, target, 'gateway:B');
    const before = await runId(d);
    await click(d, 'rl-cfg-run');
    await waitRun(d, before, 'edited steady');
    const s = await text(d, 'rl-res-summary-text');
    check(s.indexOf('Custom settings') === 0, 'summary ' + s);
    const e = await text(d, 'rl-res-expect-text');
    check(e === 'Expectations apply to the unmodified presets; these settings are custom.', 'expect text ' + e);
    await sleep(600);
    const cfg = await hashConfig(d);
    check(cfg && cfg.events && cfg.events.length === 1 && cfg.events[0].id === 'B' && cfg.run.seeds === 3, 'hash config ' + J(cfg && cfg.events));
  } },
  { id: 'R11', name: 'exports', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await runScenario(d, 'peak-outage');
    await click(d, 'rl-exp-csv'); await click(d, 'rl-exp-json'); await click(d, 'rl-exp-memo');
    const names = await d.evaluate('window.__smokeDownloads');
    check(J(names) === J(['routelab-peak-outage-summary.csv', 'routelab-peak-outage-results.json', 'routelab-peak-outage-memo.md']), 'downloads ' + J(names));
    const csv = await d.evaluate('window.__smokeBlobs[window.__smokeBlobs.length - 3].text()');
    check(csv.split('\n')[0] === 'scenario,policy,metric,mean,ci_low,ci_high,sd,n', 'csv header');
    const json = await d.evaluate('window.__smokeBlobs[window.__smokeBlobs.length - 2].text()');
    check(JSON.parse(json).schema === 'routelab.results.v1', 'json schema');
    const memo = await d.evaluate('window.__smokeBlobs[window.__smokeBlobs.length - 1].text()');
    check(memo.indexOf('# Routing decision memo: Evening-peak outage on the best gateway') === 0, 'memo title');
    await click(d, 'rl-exp-copy');
    const ok = await B.waitFor(async () => { const s = await status(d); return s === MSG_COPIED || s === MSG_COPY_FAIL ? s : null; }, 6000, 50);
    check(ok, 'no copy status: ' + J(await status(d)));
  } },
  { id: 'R12', name: 'keyboard-tabs', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await B.clickEl(d, byId('rl-tagline'));
    await d.evaluate(byId('rl-tab-help') + '.focus()');
    const state = () => d.evaluate('(() => { const a = document.activeElement; const sel = document.querySelector("[role=tab][aria-selected=true]"); return { active: a ? a.id : null, selected: sel ? sel.id : null }; })()');
    const expect = async (key, id) => { await d.press(key); const s = await state(); check(s.active === id && s.selected === id, key + ' ' + J(s)); };
    await expect('ArrowRight', 'rl-tab-scenarios');
    await expect('End', 'rl-tab-results');
    await expect('Home', 'rl-tab-help');
    await expect('ArrowLeft', 'rl-tab-results');
  } },
  { id: 'R13', name: 'focus-visible', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await runScenario(d, 'peak-outage');
    check(await d.evaluate('document.hasFocus()'), 'the browser window has no focus');
    await B.clickEl(d, byId('rl-tagline'));
    const SEL = 'a[href], button, input, select, textarea, summary, [tabindex="0"]';
    const FOCUS = '(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el);\n' +
      '  const p = el.closest("[role=tabpanel]");\n' +
      '  const key = el.id || (p ? "idx" + [...p.querySelectorAll(' + J(SEL) + ')].indexOf(el) : el.tagName);\n' +
      '  return { id: el.id || "", key, tag: el.tagName.toLowerCase(), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0, panel: p ? p.id : null }; })()';
    const VISIBLE = (panel) => '(() => [...document.getElementById(' + J(panel) + ').querySelectorAll(' + J(SEL) + ')]\n' +
      '  .map((el, i) => ({ el, key: el.id || "idx" + i }))\n' +
      '  .filter(({ el }) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0) &&\n' +
      '    !el.disabled && el.tabIndex >= 0 && !(el.type === "radio" && !el.checked))\n' +
      '  .map(({ key }) => key))()';
    const problems = [];
    const ORDER = ['help', 'scenarios', 'config', 'results'];
    for (let k = 0; k < ORDER.length; k++) {
      const name = ORDER[k];
      const panel = 'rl-panel-' + name;
      await d.evaluate(byId('rl-tab-' + ORDER[(k + ORDER.length - 1) % ORDER.length]) + '.focus()');
      await d.press('ArrowRight');
      const t = await d.evaluate(FOCUS);
      if (!t || t.id !== 'rl-tab-' + name) { problems.push('ArrowRight did not focus rl-tab-' + name); continue; }
      if (t.style === 'none' || t.width < 2) problems.push(t.id + ' outline ' + t.style + ' ' + t.width);
      const want = await d.evaluate(VISIBLE(panel));
      const reached = new Set();
      for (let i = 0; i < 800; i++) {
        await d.press('Tab');
        const fx = await d.evaluate(FOCUS);
        if (!fx || fx.panel !== panel) break;
        if (fx.style === 'none' || fx.width < 2) problems.push((fx.id || fx.tag) + ' outline ' + fx.style + ' ' + fx.width);
        reached.add(fx.key);
        if (want.every((id) => reached.has(id))) break;
      }
      const missed = want.filter((id) => !reached.has(id));
      if (missed.length) problems.push(name + ': not reached by Tab: ' + missed.slice(0, 5).join(','));
      if (reached.size === 0) problems.push(name + ': no element reached');
    }
    check(problems.length === 0, problems.slice(0, 8).join('; '));
  } },
  { id: 'R14', name: 'responsive', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await runScenario(d, 'peak-outage');
    await d.setViewport(375, 800);
    try {
      await sleep(300);
      const fits = () => d.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })');
      for (const name of ['help', 'scenarios', 'config', 'results']) {
        await d.evaluate(byId('rl-tab-' + name) + '.click()');
        await sleep(200);
        const r = await fits();
        check(r.iw <= 400, 'viewport not applied: innerWidth ' + r.iw);
        check(r.sw <= r.iw + 1, name + ' overflows: scrollWidth ' + r.sw + ' > ' + r.iw);
      }
    } finally {
      await d.setViewport(1400, 1000);
    }
  } },
  { id: 'R15', name: 'no-network-no-csp-violations', fn: async (d, mode, ctx) => {
    await harvestCsp(d);
    const allowed = mode === 'file' ? (u) => u.startsWith('file:') : (u) => u.startsWith(ORIGIN + '/');
    const bad = d.requests.slice(ctx.requestStart).filter((u) => !/\/favicon\.ico(\?|$)/.test(u) && u !== 'about:blank' && !allowed(u));
    check(bad.length === 0, 'unexpected requests: ' + bad.slice(0, 5).map((u) => u.slice(0, 80)).join(', '));
    if (mode === 'http') check(d.requests.length > ctx.requestStart, 'no requests recorded');
    const cspMeta = await d.evaluate('window.RouteLab ? window.RouteLab.CSP_META : null');
    check(cspMeta === RL.CSP_META, 'CSP_META in page ' + cspMeta);
    if (cspMeta) check(d.cspTotal === ctx.cspStart, 'securitypolicyviolation events: ' + (d.cspTotal - ctx.cspStart));
  } },
  { id: 'R16', name: 'accessibility-basics', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await runScenario(d, 'peak-outage');
    const a = await d.evaluate('(() => {\n' +
      '  const unlabelled = [];\n' +
      '  for (const el of document.querySelectorAll("input, select, textarea")) {\n' +
      '    const named = (el.id && document.querySelector("label[for=\\"" + el.id + "\\"]")) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");\n' +
      '    if (!named) unlabelled.push(el.id || el.name || el.tagName);\n' +
      '  }\n' +
      '  const panels = [...document.querySelectorAll("[role=tabpanel]")].filter((p) => {\n' +
      '    const ref = p.getAttribute("aria-labelledby"); const t = ref && document.getElementById(ref);\n' +
      '    return !(t && t.textContent.trim()) && !p.getAttribute("aria-label");\n' +
      '  }).map((p) => p.id);\n' +
      '  const charts = [...document.querySelectorAll("svg[role=img]")].filter((s) => {\n' +
      '    const ids = (s.getAttribute("aria-labelledby") || "").split(" ");\n' +
      '    return ids.length !== 2 || !document.getElementById(ids[0]) || !document.getElementById(ids[1]);\n' +
      '  }).length;\n' +
      '  return { unlabelled, panels, charts, lang: document.documentElement.getAttribute("lang"), h1: document.querySelectorAll("h1").length };\n' +
      '})()');
    check(a.unlabelled.length === 0, 'unlabelled controls ' + a.unlabelled.slice(0, 6).join(','));
    check(a.panels.length === 0, 'panels without a name ' + a.panels.join(','));
    check(a.charts === 0, 'charts without title and desc');
    check(a.lang === 'en', 'lang ' + a.lang);
    check(a.h1 === 1, 'h1 count ' + a.h1);
    const dups = await d.evaluate(DUP_IDS);
    check(dups.length === 0, 'duplicate ids ' + dups.join(','));
  } },
  { id: 'R18', name: 'privacy', fn: async (d, mode) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    await d.reload();
    await waitReady(d, 'reload');
    await runScenario(d, 'flapping');
    await tab(d, 'config');
    await setVal(d, 'rl-cfg-seeds', 4);
    const st = await d.evaluate('(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return { ls: o, cookie: document.cookie }; })()');
    check(Object.keys(st.ls).every((k) => k === 'routelab.helpSeen.v1'), 'unexpected keys ' + J(Object.keys(st.ls)));
    check(st.cookie === '', 'cookie ' + J(st.cookie));
  } },
  { id: 'R19', name: 'run-progress', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'scenarios');
    await click(d, 'rl-scn-peak-outage');
    const before = await runId(d);
    await B.clickEl(d, byId('rl-scn-run'));
    const seen = new Set();
    let disabled = false;
    const t0 = Date.now();
    for (;;) {
      const s = await d.evaluate('({ v: ' + byId('rl-run-bar') + '.value, dis: ' + byId('rl-scn-run') + '.disabled && ' + byId('rl-cfg-run') + '.disabled, id: Number(' + byId('rl-run-time') + '.getAttribute("data-run-id")) })');
      if (s.id > before) break;
      seen.add(s.v);
      if (s.dis) disabled = true;
      if (Date.now() - t0 > 40000) fail('run did not finish');
      await sleep(15);
    }
    check(seen.size >= 2, 'progress bar values observed: ' + seen.size);
    check(disabled, 'run buttons were not disabled during the run');
    const after = await d.evaluate('!' + byId('rl-scn-run') + '.disabled && !' + byId('rl-cfg-run') + '.disabled');
    check(after, 'run buttons not re-enabled');
  } }
];

// ---------------------------------------------------------------- runner
function report(browser, mode, id, name, ok, detail) {
  results.push({ browser, mode, id, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + browser + ' ' + mode + ' ' + id + ' ' + name + (ok ? '' : ' - ' + detail));
}

async function runMode(d, mode) {
  const ctx = { requestStart: d.requests.length, cspStart: d.cspTotal };
  const r17 = [];
  for (const sc of SCENARIOS) {
    const errStart = d.errors.length;
    ctx.noErrors = () => { const e = d.errors.slice(errStart); check(e.length === 0, 'errors: ' + e.slice(0, 3).join(' | ')); };
    let ok = true;
    let detail = '';
    try { await sc.fn(d, mode, ctx); } catch (e) { ok = false; detail = String((e && e.message) || e).split('\n')[0]; }
    await sleep(100);
    const errs = d.errors.slice(errStart);
    let dups = [];
    try { dups = await d.evaluate(DUP_IDS); } catch (e) { /* page gone */ }
    if (errs.length) r17.push(sc.id + ' errors: ' + errs.slice(0, 3).join(' | '));
    if (dups && dups.length) r17.push(sc.id + ' duplicate ids: ' + dups.join(','));
    report(d.name, mode, sc.id, sc.name, ok, detail);
  }
  report(d.name, mode, 'R17', 'no-errors', r17.length === 0, r17.join('; '));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const probe = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      reject(new Error('port ' + PORT + ' is already in use; choose another --port'));
    });
    probe.on('timeout', () => probe.destroy(new Error('timeout')));
    probe.on('error', () => {
      const proc = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), '--port', String(PORT), '--root', ROOT], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(proc);
      let out = '';
      proc.stdout.on('data', (c) => { out += c; });
      proc.stderr.on('data', (c) => { out += c; });
      B.waitFor(() => new Promise((ok) => {
        const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1000 }, (res) => { res.resume(); ok(res.statusCode === 200); });
        r.on('error', () => ok(false));
        r.on('timeout', () => { r.destroy(); ok(false); });
      }), 8000, 200).then((up) => (up ? resolve(proc) : reject(new Error('serve.cjs did not start: ' + out.slice(-200)))));
    });
  });
}

function cleanup() { for (const p of children) B.killTree(p); }

async function main() {
  const watchdog = setTimeout(() => { console.error('Smoke test timed out after 40 minutes.'); cleanup(); process.exit(1); }, 40 * 60 * 1000);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  if (MODES.includes('http')) {
    try { await startServer(); } catch (e) { console.error('Cannot run http mode: ' + e.message); cleanup(); process.exit(2); }
  }
  let ran = 0;
  for (const name of BROWSERS) {
    const exe = B.resolveExe(name, opts['--' + name]);
    if (!exe) { console.log('SKIP ' + name + ': executable not found'); continue; }
    let d;
    try {
      d = name === 'edge' ? await B.openEdge(exe, { cdpPort: CDP_PORT, keep: KEEP }) : await B.openFirefox(exe, { bidiPort: BIDI_PORT, keep: KEEP });
    } catch (e) {
      console.log('SKIP ' + name + ': could not start (' + String(e.message).split('\n')[0] + ')');
      continue;
    }
    children.push(d.proc);
    ran++;
    d.cspTotal = 0;
    console.log('# ' + name + ': ' + (d.version || d.label));
    try {
      await d.addPreload(HOOK);
      for (const mode of MODES) await runMode(d, mode);
    } catch (e) {
      report(name, '-', 'R00', 'driver', false, String(e.message).split('\n')[0]);
    } finally {
      try { await d.close(); } catch (e) { /* killed in cleanup */ }
    }
  }
  cleanup();
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('Summary: ' + results.length + ' checks, ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed; browsers run: ' + ran + '.');
  if (ran === 0) { console.log('No browser could run.'); process.exit(2); }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error((e && e.stack) || e); cleanup(); process.exit(1); });
