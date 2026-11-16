'use strict';
// SPEC 10.1 static.test.cjs row and "Code token checks": markup, CSP, URL ban, code tokens on stripped source,
// ES2018 rule, ids and labels, focus styles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const guard = require('../js/routelab.js');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function listDir(rel, ext) {
  return fs.readdirSync(path.join(ROOT, rel)).filter((n) => n.endsWith(ext)).sort().map((n) => rel + '/' + n);
}

const html = read('index.html');
const css = read('css/app.css');
const jsFiles = listDir('js', '.js');
const cssFiles = listDir('css', '.css');

const SCRIPTS = ['prng', 'stats', 'config', 'scenarios', 'traffic', 'model', 'strategies', 'engine', 'metrics', 'memo', 'state', 'charts', 'routelab', 'ui'].map((n) => 'js/' + n + '.js');
const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\' file:; ' +
  'style-src \'self\' file:; img-src \'self\' data: blob: file:; connect-src \'none\'; font-src \'none\'; object-src \'none\'; ' +
  'base-uri \'none\'; form-action \'none\'">';
const PRIVACY_CSP = 'No network requests (blocked by a Content Security Policy and checked by automated tests).';
const PRIVACY_NO_CSP = 'No network requests (the code makes none, which automated tests check).';

function tags(s) { return s.match(/<[^>]+>/g) || []; }

// ---------------------------------------------------------------- stripping scanner
const REGEX_PREV = '(,=:[!&|?{};';
const REGEX_WORDS = ['return', 'typeof', 'case'];
const BACKTICK_MSG = 'template literals are not used in js/';

// Replaces comments, strings and regex literals by spaces (newlines kept). Returns { code, errors: [{ line, msg }] }.
function strip(src) {
  const out = src.split('');
  const errors = [];
  let i = 0;
  let prev = '';      // last significant code character ('' = start of file; 'x' after a literal)
  let prevWord = '';  // identifier ending at prev, if any
  let word = '';
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const lineAt = (k) => src.slice(0, k).split('\n').length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? n : end + 2;
      blank(i, j); i = j; continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (src[j] === '\n') break; j++; }
      j = Math.min(n, j + 1);
      blank(i, j); i = j; prev = 'x'; prevWord = ''; word = ''; continue;
    }
    if (c === '/' && (prev === '' || REGEX_PREV.indexOf(prev) >= 0 || REGEX_WORDS.indexOf(prevWord) >= 0)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (inClass) { if (ch === ']') inClass = false; } else if (ch === '[') inClass = true; else if (ch === '/') break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      blank(i, j); i = j; prev = 'x'; prevWord = ''; word = ''; continue;
    }
    if (c === '`') errors.push({ line: lineAt(i), msg: BACKTICK_MSG });
    if (/\s/.test(c)) { if (word) { prevWord = word; word = ''; } i++; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) { word += c; prev = c; prevWord = word; i++; continue; }
    word = ''; prevWord = ''; prev = c; i++;
  }
  return { code: out.join(''), errors };
}

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }
function findHits(rel, code, regexes) {
  const hits = [];
  for (const re of regexes) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(code)) !== null) {
      hits.push(rel + ':' + lineOf(code, m.index) + ' ' + re.toString());
      if (m[0] === '') g.lastIndex++;
    }
  }
  return hits;
}

// Blanks the bodies of the named functions (located by "function <name>(" and brace matching).
function blankFunctionBodies(code, names) {
  let out = code;
  for (const name of names) {
    const at = out.indexOf('function ' + name + '(');
    assert.ok(at >= 0, 'js/ui.js: function ' + name + ' not found');
    const open = out.indexOf('{', at);
    let depth = 0;
    let k = open;
    for (; k < out.length; k++) {
      if (out[k] === '{') depth++;
      else if (out[k] === '}') { depth--; if (depth === 0) break; }
    }
    out = out.slice(0, open) + out.slice(open, k + 1).replace(/[^\n]/g, ' ') + out.slice(k + 1);
  }
  return out;
}

const ALL_RE = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /\bsendBeacon\b/, /\bWorker\b/, /\bimport\s*\(/,
  /^\s*(import|export)\b/m, /\.innerHTML\b/, /\.outerHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\s*\.\s*write/,
  /\beval\s*\(/, /\bnew\s+Function\b/];
const PURE_RE = [/\bMath\s*\.\s*random\b/, /\bDate\s*[.(]/, /\bnew\s+Date\b/, /\bperformance\s*\./, /\bconsole\s*\./,
  /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/];
const UI_RE = [/\bsessionStorage\b/, /\bdocument\s*\.\s*cookie\b/, /\bindexedDB\b/, /\blocation\s*\.\s*hash\s*=(?!=)/];
const ES2018_RE = [/\?\.(?!\d)/, /\?\?/, /\bcatch\s*\{/, /\.matchAll\s*\(/, /\b\d+n\b/];

const stripped = {};
for (const rel of jsFiles) stripped[rel] = strip(read(rel));

// ---------------------------------------------------------------- scanner unit cases
test('scanner: line and block comments become spaces, newlines kept', () => {
  const s = 'a = 1; // fetch(x)\n/* window\n document */ b = 2;';
  const r = strip(s);
  assert.equal(r.code.length, s.length);
  assert.equal(r.code.split('\n').length, 3);
  assert.doesNotMatch(r.code, /fetch|window|document/);
  assert.match(r.code, /a = 1;/);
  assert.match(r.code, /b = 2;/);
});

test('scanner: strings are stripped, including escapes and a string containing //', () => {
  const r = strip('var a = "http://x // y"; var b = \'it\\\'s window\'; c();');
  assert.doesNotMatch(r.code, /http|window|\/\//);
  assert.match(r.code, /c\(\);/);
});

test('scanner: a regex literal containing a quote is stripped and does not open a string', () => {
  const r = strip('var re = /\'/g; window.x = 1;');
  assert.match(r.code, /window\.x = 1;/);
  assert.doesNotMatch(r.code, /'/);
});

test('scanner: regex with a slash in a class, after return and after (', () => {
  const r = strip('function f(s) { return /[/]document/.test(s) || (/fetch\\//).test(s); }');
  assert.doesNotMatch(r.code, /document|fetch/);
  assert.match(r.code, /\.test\(s\)/);
});

test('scanner: division is not a regex literal', () => {
  const r = strip('var x = a / b / document;');
  assert.match(r.code, /document/);
  const r2 = strip('var y = f(1) / 2; var z = "q" / 3 / window;');
  assert.match(r2.code, /window/);
});

test('scanner: a backtick in code fails, a backtick in a comment or string does not', () => {
  assert.deepEqual(strip('var a = `x`;').errors.map((e) => e.msg), [BACKTICK_MSG, BACKTICK_MSG]);
  assert.deepEqual(strip('// `x`\nvar a = "`";').errors, []);
});

// ---------------------------------------------------------------- index.html
test('index.html loads exactly the 14 classic scripts of SPEC 2.3 in order, each deferred', () => {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  let m;
  while ((m = re.exec(html)) !== null) scripts.push(m);
  assert.deepEqual(scripts.map((x) => (/\ssrc="([^"]+)"/.exec(x[1]) || [])[1]), SCRIPTS);
  for (const x of scripts) {
    assert.match(x[1], /\sdefer(\s|$)/, 'defer missing: ' + x[1]);
    assert.doesNotMatch(x[1], /type\s*=/i);
    assert.equal(x[2].trim(), '', 'inline script body');
  }
  assert.doesNotMatch(html, /type\s*=\s*["']?module/i);
});

test('index.html has no on* attributes, style attributes or style elements', () => {
  for (const t of tags(html)) {
    assert.doesNotMatch(t, /\son[a-z]+\s*=/i, 'on* attribute: ' + t);
    assert.doesNotMatch(t, /\sstyle\s*=/i, 'style attribute: ' + t);
  }
  assert.doesNotMatch(html, /<style\b/i);
});

test('no http: or https: URL in index.html, css/ or js/ (raw text, comments included)', () => {
  for (const rel of ['index.html'].concat(cssFiles, jsFiles)) assert.doesNotMatch(read(rel), /https?:/i, 'URL in ' + rel);
});

test('html lang, title and exactly one h1', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>RouteLab - payment routing and success-rate simulator<\/title>/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test('every id starts with rl- and is unique; every for= points to an existing id', () => {
  const ids = [];
  const re = /\sid="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  assert.ok(ids.length > 60);
  for (const id of ids) assert.ok(id.startsWith('rl-'), 'id without rl- prefix: ' + id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  const fors = [];
  const rf = /\sfor="([^"]*)"/g;
  while ((m = rf.exec(html)) !== null) fors.push(m[1]);
  assert.ok(fors.length >= 6);
  for (const f of fors) assert.ok(ids.includes(f), 'for= target missing: ' + f);
  // Every input, select and textarea has a label for it or an aria-label.
  for (const t of tags(html).filter((x) => /^<(input|select|textarea)\b/i.test(x))) {
    const id = (/\sid="([^"]*)"/.exec(t) || [])[1];
    assert.ok((id && fors.includes(id)) || /\saria-label=/.test(t), 'unlabelled control: ' + t);
  }
});

test('CSP meta tag matches guard.CSP_META (SPEC 2.4)', () => {
  if (guard.CSP_META) {
    const head = /<head>([\s\S]*?)<\/head>/i.exec(html)[1];
    const first = tags(head).slice(0, 2);
    assert.equal(first[0], '<meta charset="utf-8">');
    assert.equal(first[1], CSP);
  } else {
    assert.doesNotMatch(html, /Content-Security-Policy/i);
  }
});

test('the Help privacy sentence matches guard.CSP_META', () => {
  const want = guard.CSP_META ? PRIVACY_CSP : PRIVACY_NO_CSP;
  const other = guard.CSP_META ? PRIVACY_NO_CSP : PRIVACY_CSP;
  assert.ok(html.includes(want), 'privacy sentence missing');
  assert.ok(!html.includes(other), 'wrong privacy sentence present');
});

// ---------------------------------------------------------------- code token checks
test('js/ has no template literals (backtick in code)', () => {
  const problems = [];
  for (const rel of jsFiles) for (const e of stripped[rel].errors) problems.push(rel + ':' + e.line + ' ' + e.msg);
  assert.deepEqual(problems, []);
});

test('all js/ files match none of the "all files" regexes', () => {
  const hits = [];
  for (const rel of jsFiles) hits.push.apply(hits, findHits(rel, stripped[rel].code, ALL_RE));
  assert.deepEqual(hits, []);
});

test('pure modules match none of the "pure" regexes', () => {
  const pure = jsFiles.filter((rel) => rel !== 'js/ui.js');
  assert.equal(pure.length, 13);
  const hits = [];
  for (const rel of pure) hits.push.apply(hits, findHits(rel, stripped[rel].code, PURE_RE));
  assert.deepEqual(hits, []);
});

test('js/ui.js uses localStorage only inside the two storage helpers and none of the "ui" regexes', () => {
  const code = stripped['js/ui.js'].code;
  assert.ok(/\blocalStorage\b/.test(code), 'ui.js should use localStorage in its helpers');
  const outside = blankFunctionBodies(code, ['storageGet', 'storageSet']);
  assert.deepEqual(findHits('js/ui.js', outside, [/\blocalStorage\b/]), []);
  assert.deepEqual(findHits('js/ui.js', code, UI_RE), []);
});

test('js/ follows the ES2018 rule of SPEC 2.3', () => {
  const hits = [];
  for (const rel of jsFiles) hits.push.apply(hits, findHits(rel, stripped[rel].code, ES2018_RE));
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------- css
test('css/app.css has the focus-visible rule of SPEC 7.13 and never removes outlines', () => {
  assert.match(css, /:focus-visible\s*\{\s*outline:\s*3px solid #1d4ed8;\s*outline-offset:\s*2px;\s*\}/);
  assert.doesNotMatch(css, /outline:\s*none/i);
  assert.doesNotMatch(css, /outline:\s*0/i);
});
