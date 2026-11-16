'use strict';
// SPEC 10.1 denylist row. Synthetic terms only; generic trigger strings are built by concatenation so that the
// package scan of test/ stays clean.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const deny = require('../scripts/denylist.cjs');
const { crc32, writeZip } = require('../scripts/zip.cjs');

const TERMS = ['Contoso', 'Fabrikam Ltd', 'C:\\Temp\\', 'XYZ', 'Q7a'];
const M = deny.buildMatchers(TERMS);
const hitsOf = (name, data) => { const h = []; deny.scanBuffer(name, name, Buffer.isBuffer(data) ? data : Buffer.from(data), M, h); return h; };
const AT = '@';

// PNG helpers: real chunk CRCs from the zip module's CRC-32.
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(extra, idat) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([sig, chunk('IHDR', ihdr)].concat(extra || [], [chunk('IDAT', idat || zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]));
}

test('term matching: case-insensitive, substring for long terms, separators interchangeable', () => {
  assert.ok(deny.textHasHit('made by contoso', M));
  assert.ok(deny.textHasHit('myContosoWidget', M), 'long terms match inside identifiers');
  assert.ok(deny.textHasHit('FABRIKAM-LTD', M));
  assert.ok(deny.textHasHit('fabrikam_ltd', M));
  assert.ok(deny.textHasHit('FabrikamLtd', M));
  assert.ok(deny.textHasHit('fabrikam  -_ ltd', M));
  assert.ok(deny.textHasHit('saved to c:\\temp\\file', M), 'other characters are literal');
  assert.ok(!deny.textHasHit('c:/temp/file', M));
  assert.ok(!deny.textHasHit('Fabrikam Limited', M));
});

test('short terms need word boundaries (3 chars, or 4 with a digit)', () => {
  assert.ok(deny.textHasHit('see xyz.', M));
  assert.ok(deny.textHasHit('(XYZ)', M));
  assert.ok(!deny.textHasHit('XYZW', M));
  assert.ok(!deny.textHasHit('aXYZ', M));
  assert.ok(!deny.textHasHit('x1XYZ', M));
  assert.ok(deny.textHasHit('q7a', M));
  assert.ok(!deny.textHasHit('q7ab', M));
  assert.ok(deny.termToRegex('ab12').source.startsWith('(?<!'), '4 characters with a digit is short');
  assert.ok(!deny.termToRegex('abcd').source.startsWith('(?<!'), '4 letters is long');
});

test('generic patterns: profile paths and home paths', () => {
  const G = deny.buildMatchers([]);
  assert.ok(deny.textHasHit('C:' + '\\' + 'Users' + '\\' + 'someone', G));
  assert.ok(deny.textHasHit('d:/' + 'users/x', G));
  assert.ok(deny.textHasHit('/' + 'Users/someone/file', G));
  assert.ok(deny.textHasHit('/' + 'home/someone/file', G));
  assert.ok(!deny.textHasHit('C:\\Program Files\\App', G));
  assert.ok(!deny.textHasHit('plain text with an at sign @ here', G));
});

test('generic e-mail pattern: reserved domains are exempt, other addresses hit', () => {
  const G = deny.buildMatchers([]);
  assert.ok(!deny.textHasHit('mail someone' + AT + 'example.com today', G));
  assert.ok(!deny.textHasHit('a' + AT + 'example.org, b' + AT + 'example.net', G));
  assert.ok(!deny.textHasHit('x' + AT + 'mail.example.com', G), 'subdomain of a reserved domain');
  assert.ok(!deny.textHasHit('x' + AT + 'x.test', G));
  assert.ok(!deny.textHasHit('x' + AT + 'host.example and y' + AT + 'a.invalid and z' + AT + 'b.localhost', G));
  const real = 'someone' + AT + 'mail' + 'box.co';
  assert.ok(deny.textHasHit('write to ' + real, G), 'a non-reserved address is a hit');
  assert.ok(deny.textHasHit('x' + AT + 'example.com.co', G), 'example.com must be the end of the domain');
  assert.ok(deny.textHasHit('x' + AT + 'notexample.com', G));
  assert.ok(deny.textHasHit('XXXX' + AT + 'XXXX.XX', G), 'no placeholder exemption');
  assert.deepStrictEqual(hitsOf('a.md', 'ok x' + AT + 'example.com\nbad ' + real + '\n'), ['a.md:2 [' + real.length + ' chars]']);
});

test('parseTermList and loadTerms: comments, blank lines, ROUTELAB_DENY_EXTRA, generic-only', () => {
  assert.deepStrictEqual(deny.parseTermList('# comment\nContoso\n\n  Fabrikam Ltd  # trailing\r\n'), ['Contoso', 'Fabrikam Ltd']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-deny-'));
  const saved = process.env.ROUTELAB_DENY_EXTRA;
  try {
    fs.writeFileSync(path.join(dir, '.denylist.local'), 'Contoso\n');
    assert.deepStrictEqual(deny.loadTerms({ root: dir, extra: 'Fabrikam, XYZ' }), { terms: ['Contoso', 'Fabrikam', 'XYZ'], local: true });
    process.env.ROUTELAB_DENY_EXTRA = 'Northwind';
    assert.deepStrictEqual(deny.loadTerms({ root: dir }), { terms: ['Contoso', 'Northwind'], local: true });
    assert.deepStrictEqual(deny.loadTerms({ root: dir, genericOnly: true, extra: 'XYZ' }), { terms: [], local: false });
    fs.rmSync(path.join(dir, '.denylist.local'));
    assert.strictEqual(deny.loadTerms({ root: dir, extra: '' }).local, false);
  } finally {
    if (saved === undefined) delete process.env.ROUTELAB_DENY_EXTRA; else process.env.ROUTELAB_DENY_EXTRA = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('text files: line-numbered hits without the term, undecodable text is a hit', () => {
  const h = hitsOf('docs/a.md', 'line one\nby Contoso here\n');
  assert.deepStrictEqual(h, ['docs/a.md:2 [7 chars]']);
  assert.ok(!h.join(' ').toLowerCase().includes('contoso'));
  assert.deepStrictEqual(hitsOf('LICENSE', 'clean'), []);
  assert.deepStrictEqual(hitsOf('.gitignore', 'dist/'), []);
  assert.deepStrictEqual(hitsOf('.nojekyll', ''), []);
  assert.deepStrictEqual(hitsOf('a.js', Buffer.from([0x61, 0xff, 0xfe, 0x62])), ['a.js: undecodable text']);
});

test('file names are scanned (/ and \\ forms) and printed masked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-deny-'));
  try {
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'contoso-notes.md'), 'clean\n');
    fs.writeFileSync(path.join(dir, 'ok.md'), 'clean\n');
    const r = deny.scanDir(dir, { terms: TERMS });
    assert.strictEqual(r.files, 2);
    assert.ok(r.hits.length >= 1);
    assert.ok(r.hits.every((h) => !h.toLowerCase().includes('contoso')));
    // A backslash term only matches the \ form of a relative path.
    const hb = []; deny.scanFile(path.join(dir, 'ok.md'), 'Temp/ok.md', deny.buildMatchers(['Temp\\ok']), hb);
    assert.strictEqual(hb.length, 1);
    // A folder name is scanned too.
    fs.mkdirSync(path.join(dir, 'Fabrikam_Ltd'));
    fs.writeFileSync(path.join(dir, 'Fabrikam_Ltd', 'x.md'), 'clean\n');
    assert.ok(deny.scanDir(dir, { terms: TERMS }).hits.some((h) => h.startsWith('folder ')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PNG: text chunks are scanned, IDAT never, unparseable is a hit', () => {
  assert.deepStrictEqual(hitsOf('docs/clean.png', png()), []);
  const tEXt = chunk('tEXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from('by Contoso', 'latin1')]));
  assert.strictEqual(hitsOf('a.png', png([tEXt])).length, 1);
  const zTXt = chunk('zTXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from([0]), zlib.deflateSync(Buffer.from('by Contoso'))]));
  assert.strictEqual(hitsOf('a.png', png([zTXt])).length, 1);
  const iTXt = chunk('iTXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from([1, 0]), Buffer.from('en\0\0', 'latin1'), zlib.deflateSync(Buffer.from('by Contoso', 'utf8'))]));
  assert.strictEqual(hitsOf('a.png', png([iTXt])).length, 1);
  const eXIf = chunk('eXIf', Buffer.from('MM\0*Contoso', 'latin1'));
  assert.strictEqual(hitsOf('a.png', png([eXIf])).length, 1);
  const idat = Buffer.from('\x00XYZ\x00\x00Contoso\x00', 'latin1');
  assert.deepStrictEqual(hitsOf('a.png', png([], idat)), [], 'IDAT bytes are never scanned');
  assert.ok(!hitsOf('a.png', png([tEXt]))[0].toLowerCase().includes('contoso'));
});

test('PNG: wrong signature, truncated chunk, missing IEND or failed inflation are unparseable', () => {
  assert.deepStrictEqual(hitsOf('fake.png', 'not a png'), ['fake.png: unparseable binary']);
  const good = png();
  assert.deepStrictEqual(hitsOf('t.png', good.slice(0, good.length - 6)), ['t.png: unparseable binary']);
  assert.deepStrictEqual(hitsOf('n.png', good.slice(0, good.length - 12)), ['n.png: unparseable binary']);
  const badZ = chunk('zTXt', Buffer.concat([Buffer.from('k\0', 'latin1'), Buffer.from([0]), Buffer.from('not deflate')]));
  assert.deepStrictEqual(hitsOf('z.png', png([badZ])), ['z.png: unparseable binary']);
});

test('unsupported file types are refused', () => {
  assert.deepStrictEqual(hitsOf('tool.exe', 'MZ'), ['tool.exe: unsupported file type']);
  assert.deepStrictEqual(hitsOf('Makefile', 'all:'), ['Makefile: unsupported file type']);
  assert.deepStrictEqual(hitsOf('photo.jpg', 'x'), ['photo.jpg: unsupported file type']);
});

test('zip: entry names and inflated entries scanned by extension, raw bytes never', () => {
  const clean = writeZip([{ name: 'p/a.md', data: Buffer.from('clean '.repeat(50)) }]);
  assert.deepStrictEqual(hitsOf('p.zip', clean), []);
  const deflatedTerm = writeZip([{ name: 'p/a.md', data: Buffer.from('filler '.repeat(50) + 'Contoso') }]);
  assert.strictEqual(deflatedTerm.readUInt16LE(8), 8, 'the text entry is deflated');
  assert.strictEqual(hitsOf('p.zip', deflatedTerm).length, 1, 'term inside a deflated text entry');
  assert.ok(hitsOf('p.zip', deflatedTerm)[0].startsWith('p.zip!'));
  const named = writeZip([{ name: 'p/contoso.md', data: Buffer.from('x') }]);
  assert.ok(hitsOf('p.zip', named).length >= 1, 'entry names are scanned');
  // A stored PNG entry (random-ish IDAT does not deflate smaller) whose IDAT holds the short term: no hit.
  const noise = Buffer.alloc(2048);
  let s = 12345;
  for (let i = 0; i < noise.length; i++) { s = (s * 1103515245 + 12345) >>> 0; noise[i] = s >>> 24; }
  const idat = Buffer.concat([noise.slice(0, 1000), Buffer.from('\x00XYZ\x00', 'latin1'), noise.slice(1000)]);
  const stored = writeZip([{ name: 'p/docs/s.png', data: png([], idat) }]);
  assert.strictEqual(stored.readUInt16LE(8), 0, 'the PNG entry is stored');
  assert.ok(stored.includes(Buffer.from('\x00XYZ\x00', 'latin1')), 'the raw zip bytes contain the term');
  assert.deepStrictEqual(hitsOf('p.zip', stored), []);
  assert.deepStrictEqual(hitsOf('bad.zip', 'PK not really'), ['bad.zip: unparseable binary']);
  const odd = writeZip([{ name: 'p/tool.exe', data: Buffer.from('MZ') }]);
  assert.strictEqual(hitsOf('p.zip', odd).length, 1);
});
