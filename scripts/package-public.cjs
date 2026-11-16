'use strict';
// Public package builder (SPEC 11):
//   node scripts/package-public.cjs [--out <dir>] [--require-local | --generic-only]
// Order: copy -> path checks -> deny-list scan of the folder -> self-scan of the folder -> zip -> read-back checks ->
// deny-list scan of the zip -> self-scan of the zip's text entries. Output dist/routelab-public/ (or --out) and
// <out>.zip with entry names routelab-public/<relative path>. Any problem removes both outputs and exits 1.
const fs = require('fs');
const path = require('path');
const { writeZip, readZip } = require('./zip.cjs');
const deny = require('./denylist.cjs');
const selfscan = require('./selfscan.cjs');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = 'routelab-public/';
const ROOT_FILES = ['index.html', 'README.md', 'LICENSE', '.gitignore', '.nojekyll', 'package.json'];
const ROOT_DOTFILES = new Set(['.gitignore', '.nojekyll']);
const WARN_NO_LOCAL = 'WARNING: no .denylist.local; only generic patterns were scanned.';
const REFUSED = 'REFUSED: package removed.';

function listTop(dir, base, test, out) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) if (ent.isFile() && test(ent.name)) out.push(base + '/' + ent.name);
  return out;
}

// SPEC 11.1 allow-list (top level of each folder only), as sorted relative paths with forward slashes.
function allowList(root) {
  const files = ROOT_FILES.filter((f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile());
  listTop(path.join(root, 'css'), 'css', (n) => /\.css$/.test(n), files);
  listTop(path.join(root, 'js'), 'js', (n) => /\.js$/.test(n), files);
  listTop(path.join(root, 'docs'), 'docs', (n) => /\.(md|png)$/.test(n) || n === 'results.json', files);
  listTop(path.join(root, 'test'), 'test', (n) => /\.test\.cjs$/.test(n), files);
  listTop(path.join(root, 'scripts'), 'scripts', (n) => /\.cjs$/.test(n) || n === 'brands.json', files);
  return files.sort();
}

// SPEC 11.1 refusals. Returns a problem text or null.
function pathProblem(rel) {
  const segs = rel.split('/');
  if (segs.some((s) => s === 'dist' || s === 'node_modules' || s === '.git')) return 'has a dist, node_modules or .git segment';
  if (segs[segs.length - 1] === '.denylist.local') return 'is .denylist.local';
  if (segs.some((s, i) => s.startsWith('.') && !(segs.length === 1 && i === 0 && ROOT_DOTFILES.has(s)))) return 'has a segment starting with "."';
  if (/\.log$/i.test(rel)) return 'ends in .log';
  return null;
}

function isInside(child, parent) {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

function isPreviousPackage(dir) {
  return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'js', 'routelab.js'));
}

function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

// opts: {root, out, requireLocal, genericOnly, log}.
// Returns {ok, files, zipEntries, hits, selfHits, problems, out, zip, local, lines, backslashes}.
function packagePublic(opts) {
  opts = opts || {};
  const root = path.resolve(opts.root || ROOT);
  const out = path.resolve(opts.out || path.join(root, 'dist', 'routelab-public'));
  const zipPath = out + '.zip';
  const lines = [];
  const log = (s) => { lines.push(s); if (opts.log) opts.log(s); };
  const shown = (p) => (isInside(p, root) ? path.relative(root, p) : p);
  const result = { ok: false, files: [], zipEntries: [], hits: [], selfHits: [], problems: [], out, zip: zipPath, local: false, lines, backslashes: null };
  const refuse = (msg, removeOutputs) => {
    if (msg) { result.problems.push(msg); log(msg); }
    if (removeOutputs) { rm(out); rm(zipPath); }
    log(REFUSED);
    return result;
  };

  if (opts.requireLocal && opts.genericOnly) return refuse('Use either --require-local or --generic-only, not both.', false);
  if (isInside(root, out)) return refuse('REFUSED: --out must not contain the project folder.', false);
  if (fs.existsSync(out) && !(fs.statSync(out).isDirectory() && isPreviousPackage(out))) {
    return refuse('REFUSED: --out exists and is not a previous package.', false);
  }

  const t = deny.loadTerms({ root, genericOnly: !!opts.genericOnly });
  result.local = t.local;
  if (opts.requireLocal && !t.local) return refuse('REFUSED: .denylist.local is missing (--require-local).', false);
  if (!opts.genericOnly && !t.local) log(WARN_NO_LOCAL);
  const matchers = deny.buildMatchers(t.terms);

  // Copy.
  const files = allowList(root);
  result.files = files;
  rm(out);
  rm(zipPath);
  for (const rel of files) {
    const dest = path.join(out, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, ...rel.split('/')), dest);
  }
  log('Files: ' + files.length);

  // Path checks.
  for (const rel of files) {
    const why = pathProblem(rel);
    if (why) { result.problems.push(rel + ' ' + why); log('PATH: ' + rel + ' ' + why); }
  }
  if (!files.includes('index.html') || !files.includes('js/routelab.js')) {
    result.problems.push('index.html or js/routelab.js is missing');
    log('PATH: index.html or js/routelab.js is missing');
  }
  log('Path problems: ' + result.problems.length);
  if (result.problems.length) return refuse(null, true);

  // Deny-list scan of the folder, then self-scan of the folder.
  const folderScan = deny.scanDir(out, { matchers });
  for (const h of folderScan.hits) { result.hits.push(h); log('HIT: ' + h); }
  log('Deny-list hits (folder): ' + folderScan.hits.length);
  if (folderScan.hits.length) return refuse(null, true);
  const folderSelf = selfscan.scanDir(out);
  for (const h of folderSelf.hits) { result.selfHits.push(h); log('SELF-SCAN HIT: ' + h); }
  log('Self-scan hits (folder, ' + folderSelf.files + ' text files): ' + folderSelf.hits.length);
  if (folderSelf.hits.length) return refuse(null, true);

  // Zip and read back.
  let zipBuf;
  try {
    const entries = files.map((rel) => ({ name: PREFIX + rel, data: fs.readFileSync(path.join(out, ...rel.split('/'))) }));
    fs.writeFileSync(zipPath, writeZip(entries));
    zipBuf = fs.readFileSync(zipPath);
    const back = readZip(zipBuf);
    result.zipEntries = back.map((e) => e.name);
    const backslashes = back.filter((e) => e.name.includes('\\')).length;
    result.backslashes = backslashes;
    log('Zip entries: ' + back.length + ', backslashes: ' + backslashes);
    if (back.length !== files.length) result.problems.push('zip entry count ' + back.length + ' != file count ' + files.length);
    if (backslashes) result.problems.push('zip entry names contain backslashes');
    back.forEach((e, i) => {
      const rel = files[i];
      if (e.name !== PREFIX + rel) result.problems.push('zip entry ' + (i + 1) + ' has an unexpected name');
      else if (!e.data.equals(fs.readFileSync(path.join(out, ...rel.split('/'))))) result.problems.push('zip entry ' + (i + 1) + ' differs from the copied file');
    });
  } catch (e) {
    result.problems.push('zip: ' + e.message);
  }
  if (result.problems.length) {
    for (const p of result.problems) log('ZIP: ' + p);
    return refuse(null, true);
  }

  // Deny-list scan of the zip, then self-scan of its text entries.
  const zipScan = deny.scanPath(zipPath, { matchers });
  for (const h of zipScan.hits) { result.hits.push(h); log('HIT: ' + h); }
  log('Deny-list hits (zip): ' + zipScan.hits.length);
  if (zipScan.hits.length) return refuse(null, true);
  const zipSelf = selfscan.scanZip(path.basename(zipPath), zipBuf);
  for (const h of zipSelf.hits) { result.selfHits.push(h); log('SELF-SCAN HIT: ' + h); }
  log('Self-scan hits (zip, ' + zipSelf.files + ' text entries): ' + zipSelf.hits.length);
  if (zipSelf.hits.length) return refuse(null, true);

  log('OK: ' + shown(out));
  log('OK: ' + shown(zipPath));
  result.ok = true;
  return result;
}

module.exports = { packagePublic, allowList, pathProblem, PREFIX, ROOT_FILES };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const known = new Set(['--out', '--require-local', '--generic-only']);
  const opts = { log: (s) => console.log(s) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known.has(a)) { console.error('Usage: node scripts/package-public.cjs [--out <dir>] [--require-local | --generic-only]'); process.exit(1); }
    if (a === '--out') {
      if (i + 1 >= argv.length) { console.error('--out needs a folder.'); process.exit(1); }
      opts.out = argv[++i];
    }
    if (a === '--require-local') opts.requireLocal = true;
    if (a === '--generic-only') opts.genericOnly = true;
  }
  let r;
  try { r = packagePublic(opts); } catch (e) { console.error('ERROR: ' + e.message); console.log(REFUSED); process.exit(1); }
  process.exit(r.ok ? 0 : 1);
}
