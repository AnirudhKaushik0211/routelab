'use strict';
// Deny-list scanner (SPEC 11.3), module and CLI:
//   node scripts/denylist.cjs [dir] [--generic-only]
// Default dir: dist/routelab-public. Exit 0 = no hits, 1 = hits, 2 = bad arguments.
// Patterns: the public generic patterns below, plus private terms from <project>/.denylist.local (one per line,
// '#' starts a comment) and the ROUTELAB_DENY_EXTRA environment variable (comma-separated).
// Output names locations only ("file:line [N chars]", "file:chunk <type> [N chars]", "zip!entry:..."), never the term.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readZip } = require('./zip.cjs');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_FILE = '.denylist.local';
const ENV_EXTRA = 'ROUTELAB_DENY_EXTRA';

// Reserved names (RFC 2606, RFC 6761): example.com/.org/.net and their subdomains, and the special-use
// top-level names .example, .test, .invalid and .localhost.
const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net'];
const RESERVED_TLDS = ['example', 'test', 'invalid', 'localhost'];

function isReservedDomain(domain) {
  const d = String(domain).toLowerCase().replace(/\.+$/, '');
  for (const r of RESERVED_DOMAINS) if (d === r || d.endsWith('.' + r)) return true;
  for (const t of RESERVED_TLDS) if (d.endsWith('.' + t)) return true;
  return false;
}

function isAllowedEmail(addr) {
  const s = String(addr);
  const at = s.lastIndexOf('@');
  return at >= 0 && isReservedDomain(s.slice(at + 1));
}

// Generic, public patterns (always on). Built from strings so this file does not describe a match of itself.
const GENERIC = [
  { kind: 'windows profile path', re: new RegExp('[A-Za-z]:[\\\\/]+' + 'Users' + '[\\\\/]+', 'i') },
  { kind: 'home path', re: new RegExp('\\/' + 'Users' + '\\/[^\\/\\s]+\\/') },
  { kind: 'home path', re: new RegExp('\\/' + 'home' + '\\/[^\\/\\s]+\\/') },
  { kind: 'e-mail address', re: new RegExp('[A-Za-z0-9._%+-]+' + '@' + '[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'), allow: isAllowedEmail }
];

const TEXT_EXT = new Set(['.html', '.css', '.js', '.cjs', '.json', '.md', '.txt', '.svg']);
const TEXT_NAMES = new Set(['.gitignore', '.nojekyll', 'LICENSE']);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

// Term -> case-insensitive RegExp. Separator runs (space, _ and -) match any run of [\s_-]*; short terms
// (3 characters or fewer, or 4 or fewer with a digit) need non-alphanumeric neighbours.
function termToRegex(term) {
  const t = String(term).trim();
  if (!t) return null;
  const body = t.split(/[\s_-]+/).filter(Boolean).map(escapeRe).join('[\\s_-]*');
  if (!body) return null;
  const short = t.length <= 3 || (t.length <= 4 && /[0-9]/.test(t));
  return new RegExp(short ? '(?<![A-Za-z0-9])' + body + '(?![A-Za-z0-9])' : body, 'i');
}

function parseTermList(text) {
  return String(text).split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
}

// Returns {terms, local} where local tells whether <root>/.denylist.local was found.
function loadTerms(opts) {
  opts = opts || {};
  if (opts.genericOnly) return { terms: [], local: false };
  const root = opts.root || ROOT;
  let terms = [];
  let local = false;
  const file = path.join(root, LOCAL_FILE);
  if (fs.existsSync(file)) { terms = parseTermList(fs.readFileSync(file, 'utf8')); local = true; }
  const extra = opts.extra !== undefined ? opts.extra : process.env[ENV_EXTRA];
  if (extra) terms = terms.concat(String(extra).split(',').map((s) => s.trim()).filter(Boolean));
  return { terms, local };
}

// Matchers: {re, allow?}. allow(matchText) -> true exempts that match.
function buildMatchers(terms) {
  const list = GENERIC.map((g) => ({ re: g.re, allow: g.allow }));
  for (const t of terms || []) { const re = termToRegex(t); if (re) list.push({ re }); }
  return list;
}

// Every match in a string -> [{index, length}].
function findAll(text, matchers) {
  const out = [];
  for (const mt of matchers) {
    const re = mt instanceof RegExp ? mt : mt.re;
    const allow = mt instanceof RegExp ? null : mt.allow;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(text)) !== null) {
      if (!(allow && allow(m[0]))) out.push({ index: m.index, length: m[0].length });
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  return out;
}

function mask(text, matches) {
  const chars = text.split('');
  for (const m of matches) for (let i = m.index; i < m.index + m.length; i++) chars[i] = '*';
  return chars.join('');
}

function scanTextLines(label, text, matchers, hits) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of findAll(line, matchers)) hits.push(label + ':' + (i + 1) + ' [' + m.length + ' chars]');
  });
}

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

function scanText(label, buf, matchers, hits) {
  let text;
  try { text = fatalUtf8.decode(buf); } catch (e) { hits.push(label + ': undecodable text'); return; }
  scanTextLines(label, text, matchers, hits);
}

function scanString(label, str, matchers, hits) {
  for (const m of findAll(str, matchers)) hits.push(label + ' [' + m.length + ' chars]');
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG: scan chunk type names and the text of tEXt / zTXt / iTXt / eXIf. Never IDAT or other payloads.
function scanPng(label, buf, matchers, hits) {
  const bad = () => hits.push(label + ': unparseable binary');
  if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIG)) return bad();
  let p = 8;
  let sawEnd = false;
  const local = [];
  try {
    while (p + 12 <= buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.slice(p + 4, p + 8).toString('latin1');
      if (p + 12 + len > buf.length) return bad();
      const data = buf.slice(p + 8, p + 8 + len);
      const where = label + ':chunk ' + type.replace(/[^A-Za-z]/g, '?');
      scanString(label + ':chunk type', type, matchers, local);
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        const kw = z >= 0 ? data.slice(0, z) : data;
        const tx = z >= 0 ? data.slice(z + 1) : Buffer.alloc(0);
        scanString(where, kw.toString('latin1') + '\n' + tx.toString('latin1'), matchers, local);
      } else if (type === 'zTXt') {
        const z = data.indexOf(0);
        if (z < 0 || z + 2 > data.length) return bad();
        const tx = zlib.inflateSync(data.slice(z + 2));
        scanString(where, data.slice(0, z).toString('latin1') + '\n' + tx.toString('latin1'), matchers, local);
      } else if (type === 'iTXt') {
        const z1 = data.indexOf(0);
        if (z1 < 0 || z1 + 3 > data.length) return bad();
        const flag = data[z1 + 1];
        const z2 = data.indexOf(0, z1 + 3);
        if (z2 < 0) return bad();
        const z3 = data.indexOf(0, z2 + 1);
        if (z3 < 0) return bad();
        let tx = data.slice(z3 + 1);
        if (flag === 1) tx = zlib.inflateSync(tx);
        const parts = [data.slice(0, z1), data.slice(z1 + 3, z2), data.slice(z2 + 1, z3), tx].map((b) => b.toString('utf8'));
        scanString(where, parts.join('\n'), matchers, local);
      } else if (type === 'eXIf') {
        scanString(where, data.toString('latin1'), matchers, local);
      }
      p += 12 + len;
      if (type === 'IEND') { sawEnd = true; break; }
    }
  } catch (e) {
    return bad();
  }
  if (!sawEnd) return bad();
  for (const h of local) hits.push(h);
}

function scanZipBuffer(label, buf, matchers, hits) {
  let entries;
  try { entries = readZip(buf); } catch (e) { hits.push(label + ': unparseable binary'); return; }
  entries.forEach((e, i) => {
    const where = label + '!entry ' + (i + 1);
    for (const form of [e.name, e.name.replace(/\//g, '\\')]) {
      const m = findAll(form, matchers);
      if (m.length) hits.push(where + ': name ' + mask(form, m) + ' [' + m[0].length + ' chars]');
    }
    scanBuffer(label + '!' + safeName(e.name, matchers), e.name, e.data, matchers, hits);
  });
}

// A location label that never contains a matched term (matched characters are replaced by '*').
function safeName(rel, matchers) {
  const m = findAll(rel, matchers);
  return m.length ? mask(rel, m) : rel;
}

// Content scan by file type. `name` decides the type; `label` is the printed location.
function scanBuffer(label, name, buf, matchers, hits) {
  const base = path.posix.basename(String(name).replace(/\\/g, '/'));
  const ext = path.extname(base).toLowerCase();
  if (TEXT_NAMES.has(base) || TEXT_EXT.has(ext)) return scanText(label, buf, matchers, hits);
  if (ext === '.png') return scanPng(label, buf, matchers, hits);
  if (ext === '.zip') return scanZipBuffer(label, buf, matchers, hits);
  hits.push(label + ': unsupported file type');
}

// Scans one file name (both / and \ forms) and its content.
function scanFile(abs, rel, matchers, hits) {
  rel = String(rel).replace(/\\/g, '/');
  for (const form of [rel, rel.replace(/\//g, '\\')]) {
    const m = findAll(form, matchers);
    if (m.length) hits.push('name ' + mask(form, m) + ' [' + m[0].length + ' chars]');
  }
  scanBuffer(safeName(rel, matchers), rel, fs.readFileSync(abs), matchers, hits);
}

// Never scanned: the private term file and build output (neither is ever packaged, SPEC 11.1).
const SKIP_NAMES = new Set([LOCAL_FILE, 'dist', 'node_modules', '.git']);

function walk(dir, base, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) { out.push({ dir: true, rel }); walk(abs, rel, out); }
    else out.push({ dir: false, abs, rel });
  }
  return out;
}

// Scans every file and folder name under dir plus each file's content. Returns {files, hits}.
function scanDir(dir, opts) {
  opts = opts || {};
  const matchers = opts.matchers || buildMatchers(opts.terms || loadTerms(opts).terms);
  const hits = [];
  let files = 0;
  for (const e of walk(dir, '', [])) {
    if (e.dir) {
      for (const form of [e.rel, e.rel.replace(/\//g, '\\')]) {
        const m = findAll(form, matchers);
        if (m.length) hits.push('folder ' + mask(form, m) + ' [' + m[0].length + ' chars]');
      }
    } else { files++; scanFile(e.abs, e.rel, matchers, hits); }
  }
  return { files, hits };
}

// Scans a single file on disk (for example the package zip). Returns {hits}.
function scanPath(abs, opts) {
  opts = opts || {};
  const matchers = opts.matchers || buildMatchers(opts.terms || loadTerms(opts).terms);
  const hits = [];
  scanFile(abs, opts.label || path.basename(abs), matchers, hits);
  return { hits };
}

// True if the text contains any pattern (used by the screenshot visible-text check).
function textHasHit(text, matchers) { return findAll(String(text), matchers).length > 0; }

module.exports = {
  GENERIC, TEXT_EXT, TEXT_NAMES, LOCAL_FILE, ENV_EXTRA, isReservedDomain, isAllowedEmail,
  termToRegex, parseTermList, loadTerms, buildMatchers, findAll, scanBuffer, scanFile, scanPath, scanDir, scanPng,
  scanZipBuffer, textHasHit
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const genericOnly = args.includes('--generic-only');
  const pos = args.filter((a) => !a.startsWith('--'));
  if (args.some((a) => a.startsWith('--') && a !== '--generic-only') || pos.length > 1) {
    console.error('Usage: node scripts/denylist.cjs [dir] [--generic-only]');
    process.exit(2);
  }
  const dir = path.resolve(pos[0] || path.join(ROOT, 'dist', 'routelab-public'));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('Not a folder: ' + (pos[0] || 'dist/routelab-public')); process.exit(2); }
  const t = loadTerms({ genericOnly });
  if (!genericOnly && !t.local) console.log('WARNING: no .denylist.local; only generic patterns were scanned.');
  const r = scanDir(dir, { terms: t.terms });
  for (const h of r.hits) console.log('HIT: ' + h);
  console.log('Scanned ' + r.files + ' files: ' + r.hits.length + ' deny-list hits.');
  process.exit(r.hits.length ? 1 : 0);
}
