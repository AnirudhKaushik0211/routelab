'use strict';
// Brand and identifier self-scan (SPEC 11.4), module and CLI:
//   node scripts/selfscan.cjs [dir]
// Default dir: dist/routelab-public. Exit 0 = no hits, 1 = hits, 2 = bad arguments.
// 1. Brands (scripts/brands.json): case-sensitive whole words; allowed only in the citation files README.md,
//    docs/PRD.md, docs/SPEC.md, docs/MODEL.md and scripts/brands.json.
// 2. Identifier shapes, never allowed: Luhn-valid 13-19 digit runs, Indian-mobile-like numbers, handle-like addresses.
// Output: "file:line <check> [N chars]", never the matched text.
const fs = require('fs');
const path = require('path');
const deny = require('./denylist.cjs');
const { readZip } = require('./zip.cjs');

const ROOT = path.resolve(__dirname, '..');
const BRANDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'brands.json'), 'utf8'));
const CITATION_FILES = new Set(['README.md', 'docs/PRD.md', 'docs/SPEC.md', 'docs/MODEL.md', 'scripts/brands.json']);
const SKIP_NAMES = new Set(['.denylist.local', 'dist', 'node_modules', '.git']);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
function brandRegex(list) {
  const alt = list.map((b) => escapeRe(b).replace(/\\? /g, '\\s+')).join('|');
  return new RegExp('(?<![A-Za-z0-9])(?:' + alt + ')(?![A-Za-z0-9])', 'g');
}
const BRAND_RE = brandRegex(BRANDS);
const LUHN_RE = /(?<![\d.])\d{13,19}(?![\d.])/g;
const MOBILE_RE = /(?<![\d.])(?:\+91[ -]?)?[6-9]\d{9}(?![\d.])/g;
const HANDLE_RE = new RegExp('(?<![A-Za-z0-9._-])[A-Za-z0-9._-]{2,}' + '@' + '[A-Za-z]{2,}(?![A-Za-z0-9.-])', 'g');

function luhn(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function isTextName(name) {
  const base = path.posix.basename(String(name).replace(/\\/g, '/'));
  return deny.TEXT_NAMES.has(base) || deny.TEXT_EXT.has(path.extname(base).toLowerCase());
}

// rel: the path relative to the package root with forward slashes (decides the brand allowance).
function scanString(label, rel, text) {
  const hits = [];
  const brandsAllowed = CITATION_FILES.has(rel);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = label + ':' + (i + 1);
    let m;
    if (!brandsAllowed) {
      BRAND_RE.lastIndex = 0;
      while ((m = BRAND_RE.exec(line)) !== null) hits.push(at + ' brand [' + m[0].length + ' chars]');
    }
    LUHN_RE.lastIndex = 0;
    while ((m = LUHN_RE.exec(line)) !== null) if (luhn(m[0])) hits.push(at + ' luhn-number [' + m[0].length + ' chars]');
    MOBILE_RE.lastIndex = 0;
    while ((m = MOBILE_RE.exec(line)) !== null) hits.push(at + ' mobile-like-number [' + m[0].length + ' chars]');
    HANDLE_RE.lastIndex = 0;
    while ((m = HANDLE_RE.exec(line)) !== null) hits.push(at + ' handle-like-address [' + m[0].length + ' chars]');
  });
  return hits;
}

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });
function scanBuffer(label, rel, buf) {
  let text;
  try { text = fatalUtf8.decode(buf); } catch (e) { return [label + ': undecodable text']; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return scanString(label, rel, text);
}

function walk(dir, base, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(abs, rel, out);
    else if (ent.isFile()) out.push({ abs, rel });
  }
  return out;
}

function scanDir(dir) {
  const hits = [];
  let files = 0;
  for (const e of walk(dir, '', [])) {
    if (!isTextName(e.rel)) continue;
    files++;
    for (const h of scanBuffer(e.rel, e.rel, fs.readFileSync(e.abs))) hits.push(h);
  }
  return { files, hits };
}

// Zip entries are named "<prefix>/<relative path>"; the prefix is removed for the citation-file allowance.
function scanZip(label, buf) {
  let entries;
  try { entries = readZip(buf); } catch (e) { return { files: 0, hits: [label + ': unparseable zip'] }; }
  const hits = [];
  let files = 0;
  for (const e of entries) {
    if (!isTextName(e.name)) continue;
    files++;
    const rel = e.name.indexOf('/') >= 0 ? e.name.slice(e.name.indexOf('/') + 1) : e.name;
    for (const h of scanBuffer(label + '!' + e.name, rel, e.data)) hits.push(h);
  }
  return { files, hits };
}

// For the screenshot visible-text check (SPEC 10.5).
function textHasBrand(text) { BRAND_RE.lastIndex = 0; return BRAND_RE.test(String(text)); }

module.exports = { BRANDS, CITATION_FILES, luhn, scanString, scanBuffer, scanDir, scanZip, isTextName, textHasBrand };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((a) => a.startsWith('--')) || args.length > 1) {
    console.error('Usage: node scripts/selfscan.cjs [dir]');
    process.exit(2);
  }
  const dir = path.resolve(args[0] || path.join(ROOT, 'dist', 'routelab-public'));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('Not a folder: ' + (args[0] || 'dist/routelab-public')); process.exit(2); }
  const r = scanDir(dir);
  for (const h of r.hits) console.log('HIT: ' + h);
  console.log('Self-scanned ' + r.files + ' text files: ' + r.hits.length + ' self-scan hits.');
  process.exit(r.hits.length ? 1 : 0);
}
