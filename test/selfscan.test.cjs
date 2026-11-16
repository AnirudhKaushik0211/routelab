'use strict';
// SPEC 10.1 selfscan row. Trigger strings are built at runtime so the repository itself stays clean.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../scripts/selfscan.cjs');

const ROOT = path.resolve(__dirname, '..');
const BRAND = 'Razor' + 'pay';

function luhnComplete(prefix) {
  for (let d = 0; d <= 9; d++) if (S.luhn(prefix + d)) return prefix + d;
  return null;
}

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-self-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('a clean folder passes', () => {
  const dir = folder({ 'js/a.js': 'var x = 0.6270739405881613;\n', 'docs/b.md': 'Gateway A and Bank X.\n' });
  try { assert.deepEqual(S.scanDir(dir).hits, []); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('brands: a hit in js/, allowed in the citation files, whole words only, case-sensitive', () => {
  const dir = folder({ 'js/a.js': '// routed via ' + BRAND + '\n', 'docs/MODEL.md': 'Source: ' + BRAND + ' blog.\n', 'README.md': BRAND + '\n',
    'docs/CASE-STUDY.md': 'x ' + BRAND + '\n' });
  try {
    const h = S.scanDir(dir).hits;
    assert.deepEqual(h.sort(), ['docs/CASE-STUDY.md:1 brand [8 chars]', 'js/a.js:1 brand [8 chars]']);
    assert.ok(h.every((x) => x.indexOf(BRAND) < 0), 'never prints the match');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(S.scanString('a.md', 'a.md', BRAND + 'X ' + BRAND.toLowerCase()), []);
  assert.equal(S.scanString('a.md', 'a.md', 'via Goo' + 'gle  Pay').length, 1, 'spaces inside a brand match \\s+');
  assert.ok(S.textHasBrand('paid with ' + BRAND));
  assert.ok(!S.textHasBrand('paid with Gateway A'));
});

test('identifier shapes: Luhn numbers, mobile-like numbers and handles are hits; decimals are not', () => {
  const card = luhnComplete('4' + '11111111111111');
  assert.equal(card.length, 16);
  assert.equal(S.scanString('a.md', 'a.md', 'n ' + card).length, 1);
  const notLuhn = card.slice(0, 15) + String((Number(card[15]) + 1) % 10);
  assert.equal(S.scanString('a.md', 'a.md', 'n ' + notLuhn).length, 0);
  const mobile = '98' + '76543210';
  assert.deepEqual(S.scanString('a.md', 'a.md', 'call ' + mobile), ['a.md:1 mobile-like-number [10 chars]']);
  assert.equal(S.scanString('a.md', 'a.md', 'call +91 ' + mobile).length, 1);
  const handle = 'some.one' + '@' + 'okbank';
  assert.deepEqual(S.scanString('a.md', 'a.md', 'pay ' + handle + ' now'), ['a.md:1 handle-like-address [' + handle.length + ' chars]']);
  assert.deepEqual(S.scanString('a.js', 'a.js', 'x = 0.6270739405881613; y = 2816405663; z = 4294967295;'), []);
});

test('the real repository passes', () => {
  const r = S.scanDir(ROOT);
  assert.deepEqual(r.hits, []);
  assert.ok(r.files > 30);
});
