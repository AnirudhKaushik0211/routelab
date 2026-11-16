'use strict';
// Shared headless browser drivers (SPEC 10.3). Node 22+ built-ins only (global WebSocket).
//   openEdge(exe, {cdpPort})    Microsoft Edge, --headless=new, Chrome DevTools Protocol
//   openFirefox(exe, {bidiPort}) Mozilla Firefox, --headless, WebDriver BiDi (ws://127.0.0.1:<port>/session)
// Each driver uses a fresh temporary profile and exposes:
//   name, label, version, errors[], requests[], evaluate(expr), click(x, y), press(key), goto(url), reload(),
//   addPreload(src) -> handle, removePreload(handle), setViewport(w, h), screenshot(opts) -> Buffer,
//   emulateMedia(media) (Edge only), close().
// close() kills only the browser process tree this module started (taskkill /PID <pid> /T /F on Windows).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generic install locations only (never a user profile directory).
const DEFAULT_EXES = {
  edge: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
  firefox: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe']
};

// Resolution order: explicit path (--edge / --firefox), then EDGE_PATH / FIREFOX_PATH, then the defaults.
function resolveExe(kind, explicit) {
  const env = kind === 'edge' ? process.env.EDGE_PATH : process.env.FIREFOX_PATH;
  const list = [explicit, env].concat(DEFAULT_EXES[kind] || []).filter(Boolean);
  for (const p of list) { try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* next */ } }
  return null;
}

function getJson(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ }
    if (Date.now() > end) return null;
    await sleep(step || 150);
  }
}

// Kills a process tree we started. Never targets any other PID.
function killTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } }
}

function rmTemp(dir) {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (e) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); }
  }
}

// WebSocket JSON-RPC client shared by CDP and BiDi.
class Rpc {
  constructor(url, label) { this.url = url; this.label = label; this.id = 0; this.pending = new Map(); this.handlers = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(this.label + ' socket error ' + ((e && e.message) || '')));
      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (e) { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(p.method + ': ' + (typeof msg.error === 'string' ? msg.error + ' ' + (msg.message || '') : msg.error.message)));
          else p.resolve(msg.result);
        } else if (msg.method) {
          for (const h of this.handlers.slice()) h(msg.method, msg.params);
        }
      };
    });
  }
  send(method, params, ms) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(this.label + ' timeout: ' + method)); }
      }, ms || 20000);
      this.pending.set(id, { resolve, reject, method, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  on(fn) { this.handlers.push(fn); }
  waitEvent(name, ms) {
    let fn, t;
    const p = new Promise((resolve, reject) => {
      fn = (m, params) => { if (m === name) { clearTimeout(t); this.off(fn); resolve(params); } };
      t = setTimeout(() => { this.off(fn); reject(new Error(this.label + ': no ' + name + ' within ' + ms + ' ms')); }, ms);
      this.handlers.push(fn);
    });
    p.cancel = () => { clearTimeout(t); this.off(fn); };
    return p;
  }
  off(fn) { this.handlers = this.handlers.filter((x) => x !== fn); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

function firstLine(s) { return String(s).split('\n')[0]; }

// data: and blob: URLs are resolved in memory (for example the browser's own form-control icons), not fetched.
function isNetworkUrl(url) { return !/^(data|blob):/i.test(String(url)); }

// ---------------------------------------------------------------- Edge (CDP)
const CDP_KEYS = {
  ArrowRight: { code: 'ArrowRight', vk: 39 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
  Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 }, Tab: { code: 'Tab', vk: 9 },
  Enter: { code: 'Enter', vk: 13, text: '\r' }, ' ': { code: 'Space', vk: 32, text: ' ' }, Escape: { code: 'Escape', vk: 27 }
};

function charKey(ch) {
  const up = ch.toUpperCase();
  if (/^[A-Z]$/.test(up)) return { code: 'Key' + up, vk: up.charCodeAt(0), text: ch };
  if (/^[0-9]$/.test(ch)) return { code: 'Digit' + ch, vk: ch.charCodeAt(0), text: ch };
  return { code: '', vk: 0, text: ch };
}

async function openEdge(exe, opts) {
  opts = opts || {};
  const port = Number(opts.cdpPort || 9397);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-edge-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking',
    '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  const d = { name: 'edge', label: 'Edge (CDP)', version: '', errors: [], requests: [], proc };
  try {
    const targets = await waitFor(async () => {
      const t = await getJson(port, '/json/list');
      return t.find((x) => x.type === 'page') ? t : null;
    }, 20000);
    if (!targets) throw new Error('Edge DevTools endpoint did not come up on port ' + port);
    try { const v = await getJson(port, '/json/version'); d.version = v.Browser || ''; } catch (e) { /* optional */ }
    const cdp = new Rpc(targets.find((x) => x.type === 'page').webSocketDebuggerUrl, 'CDP');
    await cdp.open();
    cdp.on((method, p) => {
      if (method === 'Runtime.exceptionThrown') {
        const ex = p.exceptionDetails;
        d.errors.push(firstLine('exception: ' + ((ex.exception && ex.exception.description) || ex.text)));
      }
      if (method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        d.errors.push(firstLine('console.error: ' + p.args.map((a) => (a.value !== undefined ? a.value : a.description || '')).join(' ')));
      }
      if (method === 'Log.entryAdded' && p.entry.level === 'error' && !/favicon\.ico$/.test(p.entry.url || '')) {
        d.errors.push(firstLine('log: ' + p.entry.text + ' ' + (p.entry.url || '')));
      }
      if (method === 'Network.requestWillBeSent' && isNetworkUrl(p.request.url)) d.requests.push(p.request.url);
    });
    for (const m of ['Runtime.enable', 'Log.enable', 'Network.enable', 'Page.enable']) await cdp.send(m);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

    d.evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false });
      if (r.exceptionDetails) {
        throw new Error('evaluate failed: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
      }
      return r.result.value;
    };
    d.click = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    d.press = async (key) => {
      // Named keys from CDP_KEYS; any other single printable character is typed as text.
      const k = CDP_KEYS[key] || (typeof key === 'string' && key.length === 1 ? charKey(key) : null);
      if (!k) throw new Error('unsupported key ' + key);
      const base = { key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
      await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: k.text ? 'keyDown' : 'rawKeyDown' }, base, k.text ? { text: k.text } : {}));
      await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    };
    d.goto = async (url) => {
      const loaded = cdp.waitEvent('Page.loadEventFired', 20000);
      loaded.catch(() => {});
      const r = await cdp.send('Page.navigate', { url });
      if (r && r.errorText) { loaded.cancel(); throw new Error('navigate failed: ' + r.errorText); }
      if (r && !r.loaderId) { loaded.cancel(); return; } // same-document (fragment) navigation
      await loaded;
    };
    d.reload = async () => {
      const loaded = cdp.waitEvent('Page.loadEventFired', 20000);
      await cdp.send('Page.reload', { ignoreCache: true });
      await loaded;
    };
    d.addPreload = async (source) => (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
    d.removePreload = (identifier) => cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    d.setViewport = (width, height) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    d.emulateMedia = (media) => cdp.send('Emulation.setEmulatedMedia', { media: media || '' });
    d.screenshot = async (o) => {
      o = o || {};
      const params = { format: 'png', captureBeyondViewport: !!o.captureBeyondViewport };
      if (o.clip) params.clip = Object.assign({ scale: 1 }, o.clip);
      const r = await cdp.send('Page.captureScreenshot', params, 60000);
      return Buffer.from(r.data, 'base64');
    };
    d.close = async () => {
      try { await cdp.send('Browser.close', {}, 5000); } catch (e) { /* killed below */ }
      cdp.close();
      await sleep(300);
      killTree(proc);
      if (!opts.keep) rmTemp(dir);
    };
    return d;
  } catch (e) {
    killTree(proc);
    rmTemp(dir);
    throw e;
  }
}

// ---------------------------------------------------------------- Firefox (WebDriver BiDi)
// BiDi serialises results as RemoteValues; turn them back into plain JSON values.
function fromRemote(v) {
  if (!v || typeof v !== 'object') return v;
  switch (v.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': case 'boolean': return v.value;
    case 'number': return typeof v.value === 'number' ? v.value : (v.value === '-0' ? -0 : Number(v.value));
    case 'bigint': return Number(v.value);
    case 'array': return (v.value || []).map(fromRemote);
    case 'object': {
      const out = {};
      for (const pair of v.value || []) out[typeof pair[0] === 'string' ? pair[0] : String(fromRemote(pair[0]))] = fromRemote(pair[1]);
      return out;
    }
    default: return '[' + v.type + ']';
  }
}

// Disables first-run pages, telemetry, updates, safe browsing and captive-portal checks.
const FIREFOX_PREFS = {
  'remote.active-protocols': 1,
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.aboutwelcome.enabled': false,
  'startup.homepage_welcome_url': 'about:blank',
  'datareporting.policy.dataSubmissionEnabled': false,
  'datareporting.healthreport.uploadEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'toolkit.telemetry.enabled': false,
  'app.update.disabledForTesting': true,
  'app.update.auto': false,
  'extensions.update.enabled': false,
  'browser.cache.disk.enable': false,
  'browser.cache.memory.enable': false,
  'browser.safebrowsing.malware.enabled': false,
  'browser.safebrowsing.phishing.enabled': false,
  'browser.safebrowsing.downloads.enabled': false,
  'network.captive-portal-service.enabled': false,
  'network.connectivity-service.enabled': false,
  // Headless windows never get OS focus; test mode makes :focus / :focus-visible behave as in an active window.
  'focusmanager.testmode': true,
  // On machines with OS/enterprise client certificates, a background TLS connection at startup can open the modal
  // client-certificate chooser (chrome://pippki/content/clientauthask.xhtml). It takes focus from the page, so
  // document.hasFocus() stays false and no :focus rule matches. Choose automatically so the dialog never opens.
  'security.default_personal_cert': 'Select Automatically',
  'browser.download.useDownloadDir': true,
  'browser.download.folderList': 2
};

const BIDI_KEYS = {
  ArrowRight: '\uE014', ArrowLeft: '\uE012', ArrowUp: '\uE013', ArrowDown: '\uE015',
  Home: '\uE011', End: '\uE010', Tab: '\uE004', Enter: '\uE007', ' ': ' ', Escape: '\uE00C'
};

async function openFirefox(exe, opts) {
  opts = opts || {};
  const port = Number(opts.bidiPort || 9398);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-firefox-'));
  const prefs = Object.assign({}, FIREFOX_PREFS, { 'browser.download.dir': path.join(dir, 'downloads') });
  fs.writeFileSync(path.join(dir, 'user.js'),
    Object.keys(prefs).map((k) => 'user_pref(' + JSON.stringify(k) + ', ' + JSON.stringify(prefs[k]) + ');').join('\n') + '\n');
  // --wait-for-browser keeps the launcher as the root of the process tree, so the tree kill is clean.
  const proc = spawn(exe, ['--headless', '--no-remote', '--new-instance', '--wait-for-browser', '--profile', dir, '--remote-debugging-port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { MOZ_CRASHREPORTER_DISABLE: '1' }) });
  let out = '';
  proc.stdout.on('data', (c) => { out = (out + c).slice(-2000); });
  proc.stderr.on('data', (c) => { out = (out + c).slice(-2000); });
  const d = { name: 'firefox', label: 'Firefox (BiDi)', version: '', errors: [], requests: [], proc };
  try {
    const bidi = await waitFor(async () => { const r = new Rpc('ws://127.0.0.1:' + port + '/session', 'BiDi'); await r.open(); return r; }, 40000, 500);
    if (!bidi) throw new Error('Firefox remote agent did not answer on port ' + port + ': ' + out.slice(-300));
    const session = await bidi.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
    d.version = 'Firefox ' + session.capabilities.browserVersion;
    d.label = d.version + ' (BiDi)';
    const tree = await bidi.send('browsingContext.getTree', {});
    const context = (tree.contexts[0] && tree.contexts[0].context) || (await bidi.send('browsingContext.create', { type: 'tab' })).context;
    await bidi.send('browsingContext.setViewport', { context, viewport: { width: 1400, height: 1000 } });
    // Give the headless window focus, so :focus and :focus-visible match like in a real window.
    await bidi.send('browsingContext.activate', { context });
    bidi.on((method, p) => {
      const own = !(p.source && p.source.context) || p.source.context === context;
      if (method === 'log.entryAdded' && own && p.level === 'error' && !/favicon\.ico/.test(p.text || '')) d.errors.push(firstLine(p.type + ': ' + p.text));
      // Only our own tab: other contexts (for example a start page opened by browser policy) are not the app.
      if (method === 'network.beforeRequestSent' && p.context === context && isNetworkUrl(p.request.url)) d.requests.push(p.request.url);
    });
    await bidi.send('session.subscribe', { events: ['log.entryAdded', 'network.beforeRequestSent'] });
    // The first tab may still be loading a start page set by browser policy; replace it and drop that noise.
    await bidi.send('browsingContext.navigate', { context, url: 'about:blank', wait: 'complete' }, 30000);
    await sleep(1000);
    await bidi.send('browsingContext.activate', { context });
    d.errors.length = 0;
    d.requests.length = 0;

    d.evaluate = async (expression) => {
      const r = await bidi.send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none',
        serializationOptions: { maxObjectDepth: 20, maxDomDepth: 0 } });
      if (r.type === 'exception') throw new Error('evaluate failed: ' + r.exceptionDetails.text);
      return fromRemote(r.result);
    };
    d.click = async (x, y) => {
      await bidi.send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
        actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
    };
    d.press = async (key) => {
      const v = BIDI_KEYS[key] || (typeof key === 'string' && key.length === 1 ? key : null);
      if (!v) throw new Error('unsupported key ' + key);
      await bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard',
        actions: [{ type: 'keyDown', value: v }, { type: 'keyUp', value: v }] }] });
    };
    const activate = () => bidi.send('browsingContext.activate', { context }).catch(() => {});
    d.goto = async (url) => { await bidi.send('browsingContext.navigate', { context, url, wait: 'complete' }, 30000); await activate(); };
    // ignoreCache is not supported by Firefox's BiDi; the HTTP cache is disabled through the profile prefs.
    d.reload = async () => { await bidi.send('browsingContext.reload', { context, wait: 'complete' }, 30000); await activate(); };
    d.addPreload = async (src) => (await bidi.send('script.addPreloadScript', { functionDeclaration: '() => { ' + src + '\n}' })).script;
    d.removePreload = (script) => bidi.send('script.removePreloadScript', { script });
    d.setViewport = (width, height) => bidi.send('browsingContext.setViewport', { context, viewport: { width, height } });
    d.emulateMedia = null; // not available over BiDi
    d.screenshot = async (o) => {
      o = o || {};
      const params = { context, origin: o.captureBeyondViewport ? 'document' : 'viewport' };
      if (o.clip) params.clip = { type: 'box', x: o.clip.x, y: o.clip.y, width: o.clip.width, height: o.clip.height };
      const r = await bidi.send('browsingContext.captureScreenshot', params, 60000);
      return Buffer.from(r.data, 'base64');
    };
    d.close = async () => {
      try { await bidi.send('browser.close', {}, 5000); } catch (e) { /* killed below */ }
      bidi.close();
      await sleep(300);
      killTree(proc);
      if (!opts.keep) rmTemp(dir);
    };
    return d;
  } catch (e) {
    killTree(proc);
    rmTemp(dir);
    throw e;
  }
}

// ---------------------------------------------------------------- page helpers
const byId = (id) => 'document.getElementById(' + JSON.stringify(id) + ')';
const centreExpr = (elExpr) => '(() => { const el = ' + elExpr + '; if (!el) return null; el.scrollIntoView({ block: "center" });' +
  ' const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()';
async function clickEl(d, elExpr) {
  const c = await d.evaluate(centreExpr(elExpr));
  if (!c || !c.w) throw new Error('element not visible: ' + elExpr);
  await d.click(c.x, c.y);
}

module.exports = { resolveExe, openEdge, openFirefox, killTree, waitFor, sleep, byId, centreExpr, clickEl, fromRemote, DEFAULT_EXES };
