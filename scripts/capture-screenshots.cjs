'use strict';
// Screenshot capture (SPEC 10.5):
//   node scripts/capture-screenshots.cjs [--out docs] [--edge <path>] [--cdp-port 9401]
// Headless Edge via CDP, file:// mode, viewport 1440 x 900, deviceScaleFactor 1, fresh profile. Before each shot the
// page's visible text is checked against the deny-list (SPEC 11.3, including .denylist.local), the operating-system user
// name and the brand list (SPEC 11.4); any hit refuses the shot and exits 1 without printing the term.
// A person must still look at every image before publishing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');
const deny = require('./denylist.cjs');
const selfscan = require('./selfscan.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESERVED_PORT = 4317;
const USAGE = 'Usage: node scripts/capture-screenshots.cjs [--out docs] [--edge <path>] [--cdp-port 9401]';
const MAX_HEIGHT = 3000;
const byId = B.byId;
const sleep = B.sleep;

function usage(msg) { console.error(msg + '\n' + USAGE); process.exit(2); }

function parseArgs(argv) {
  const o = { out: 'docs', edge: null, cdpPort: 9401 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--out' && a !== '--edge' && a !== '--cdp-port') usage('unknown option: ' + a);
    if (seen.has(a)) usage(a + ' given twice');
    seen.add(a);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) usage(a + ' needs a value');
    i++;
    if (a === '--out') o.out = val;
    else if (a === '--edge') o.edge = val;
    else o.cdpPort = Number(val);
  }
  if (!Number.isInteger(o.cdpPort) || o.cdpPort < 1024 || o.cdpPort > 65535) usage('--cdp-port must be an integer from 1024 to 65535');
  if (o.cdpPort === RESERVED_PORT) usage('Port ' + RESERVED_PORT + ' is reserved for another local tool; choose another port.');
  return o;
}

const ARGS = parseArgs(process.argv.slice(2));
const OUT = path.resolve(ROOT, ARGS.out);
if (typeof WebSocket !== 'function') { console.error('Node 22+ is required (global WebSocket).'); process.exit(2); }

function matchers() {
  const terms = deny.loadTerms({ root: ROOT }).terms.slice();
  let user = '';
  try { user = os.userInfo().username || ''; } catch (e) { /* no user name available */ }
  if (user) terms.push(user);
  return deny.buildMatchers(terms);
}

const READY = '(() => !!(window.RouteLab && document.querySelector("[role=tab][aria-selected=true]") && document.getElementById("rl-cfg-form").children.length > 0))()';
const runId = (d) => d.evaluate('Number(document.getElementById("rl-run-time").getAttribute("data-run-id"))');

async function open(d, url) {
  await d.goto('about:blank');
  await d.goto(url);
  const ready = await B.waitFor(() => d.evaluate(READY), 15000, 100);
  if (!ready) throw new Error('the app did not start');
}
async function click(d, id) { await B.clickEl(d, byId(id)); await sleep(150); }
async function selectTab(d, name) { await click(d, 'rl-tab-' + name); }
async function runPreset(d, id) {
  await selectTab(d, 'scenarios');
  await click(d, 'rl-scn-' + id);
  const before = await runId(d);
  await click(d, 'rl-scn-run');
  const ok = await B.waitFor(async () => (await runId(d)) > before, 60000, 50);
  if (!ok) throw new Error('the ' + id + ' run did not finish');
  await sleep(300);
}

// Hides the scrollbar in this screenshot session only (the page CSP blocks injected <style> elements).
const HIDE_SCROLLBAR = '(() => { if (window.__rlShotSheet) return true; const s = new CSSStyleSheet();' +
  ' s.replaceSync("html { scrollbar-width: none; } ::-webkit-scrollbar { width: 0; height: 0; }");' +
  ' document.adoptedStyleSheets = document.adoptedStyleSheets.concat([s]); window.__rlShotSheet = s; return true; })()';

// Union box of the elements from `fromId` to the end of `toId`, in document coordinates.
function boxExpr(fromId, toId) {
  return '(() => { const a = document.getElementById(' + JSON.stringify(fromId) + '); const b = document.getElementById(' + JSON.stringify(toId) + ');' +
    ' if (!a || !b) return null; const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();' +
    ' const x = Math.min(ra.left, rb.left), y = ra.top, r = Math.max(ra.right, rb.right), btm = rb.bottom;' +
    ' return { x: x + window.scrollX, y: y + window.scrollY, width: r - x, height: btm - y }; })()';
}

async function shot(d, M, file, fromId, toId) {
  await d.evaluate(HIDE_SCROLLBAR);
  await d.evaluate('window.scrollTo(0, 0)');
  await sleep(200);
  const visibleText = await d.evaluate('document.body.innerText');
  if (deny.textHasHit(visibleText, M) || selfscan.textHasBrand(visibleText)) {
    throw Object.assign(new Error('REFUSED: the visible text for ' + file + ' contains a deny-list term, the user name or a brand.'), { refused: true });
  }
  const box = await d.evaluate(boxExpr(fromId, toId || fromId));
  if (!box || !box.width || !box.height) throw new Error('#' + fromId + ' is not visible for ' + file);
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.min(MAX_HEIGHT, Math.ceil(box.height)) };
  const png = await d.screenshot({ clip, captureBeyondViewport: true });
  const hits = [];
  deny.scanPng(file, png, M, hits);
  if (hits.length) throw Object.assign(new Error('REFUSED: ' + hits[0]), { refused: true });
  fs.writeFileSync(path.join(OUT, file), png);
  console.log('Saved ' + path.relative(ROOT, path.join(OUT, file)).replace(/\\/g, '/') + ' (' + clip.width + 'x' + clip.height + ')');
}

async function main() {
  const exe = B.resolveExe('edge', ARGS.edge);
  if (!exe) { console.error('Microsoft Edge was not found. Pass --edge <path> or set EDGE_PATH.'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const M = matchers();
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  const d = await B.openEdge(exe, { cdpPort: ARGS.cdpPort });
  let code = 0;
  try {
    console.log('Browser: ' + d.version);
    await d.setViewport(1440, 900);
    // Help, first visit.
    await open(d, url);
    await d.evaluate('localStorage.clear()');
    await open(d, url);
    await shot(d, M, 'screenshot-help.png', 'rl-main');
    // Scenarios with peak-outage selected.
    await selectTab(d, 'scenarios');
    await click(d, 'rl-scn-peak-outage');
    await shot(d, M, 'screenshot-scenarios.png', 'rl-main');
    // Configure: gateways and events of peak-outage.
    await click(d, 'rl-scn-load');
    await shot(d, M, 'screenshot-configure.png', 'rl-cfg-gw-a', 'rl-cfg-events');
    // Results for peak-outage: summary, expectations, chart 1.
    await runPreset(d, 'peak-outage');
    await shot(d, M, 'screenshot-outage-results.png', 'rl-panel-results', 'rl-ch-sr');
    // Cold start: chart 2 with Thompson sampling.
    await runPreset(d, 'cold-start');
    await d.evaluate('(() => { const s = document.getElementById("rl-ch-share-policy"); s.value = "thompson"; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()');
    await sleep(200);
    await shot(d, M, 'screenshot-cold-start-share.png', 'rl-ch-share');
    // Cost vs SR: chart 3 and the summary table.
    await runPreset(d, 'cost-vs-sr');
    await shot(d, M, 'screenshot-cost-vs-sr-scatter.png', 'rl-ch-scatter', 'rl-res-table');
    // Memo preview for peak-outage (details open).
    await runPreset(d, 'peak-outage');
    await d.evaluate('document.getElementById("rl-memo").open = true');
    await sleep(200);
    await shot(d, M, 'screenshot-memo.png', 'rl-memo');
    if (d.errors.length) { console.error('Page errors: ' + d.errors.length + '; first: ' + String(d.errors[0]).slice(0, 120)); code = 1; }
    else console.log('Done: 7 screenshots, visible-text scan clean. Look at every image before publishing.');
  } catch (e) {
    console.error(e.refused ? e.message : 'ERROR: ' + e.message);
    code = 1;
  } finally {
    await d.close();
  }
  process.exit(code);
}

main().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
