'use strict';
// SPEC 10.1 zip row: write then read back; forward slashes; CRC-32; deflate and stored entries; empty and 1 MB files.
const test = require('node:test');
const assert = require('node:assert');
const { crc32, writeZip, readZip } = require('../scripts/zip.cjs');

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('CRC-32 of "123456789" is 0xCBF43926', () => {
  assert.strictEqual(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926);
  assert.strictEqual(crc32(Buffer.alloc(0)), 0);
});

test('write and read back: names, CRC, contents, deflate and stored, empty and 1 MB files', () => {
  const r = rng(7);
  const random = Buffer.alloc(4096);
  for (let i = 0; i < random.length; i++) random[i] = Math.floor(r() * 256);
  const big = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 10)) & 0xff;
  const entries = [
    { name: 'pkg/index.html', data: Buffer.from('<p>' + 'hello '.repeat(200) + '</p>') },
    { name: 'pkg\\js\\stats.js', data: Buffer.from('var x = 1;\n'.repeat(50)) },
    { name: 'pkg/docs/random.bin', data: random },
    { name: 'pkg/empty.txt', data: Buffer.alloc(0) },
    { name: 'pkg/big.bin', data: big },
    { name: 'pkg/docs/ñ-测试.md', data: Buffer.from('Prueba ñ 测试\n') }
  ];
  const zip = writeZip(entries);
  const back = readZip(zip);
  assert.strictEqual(back.length, entries.length);
  back.forEach((e, i) => {
    assert.ok(!e.name.includes('\\'), 'forward slashes only');
    assert.strictEqual(e.name, entries[i].name.replace(/\\/g, '/'));
    assert.ok(e.data.equals(entries[i].data), 'content round trip ' + e.name);
    assert.strictEqual(e.crc, crc32(entries[i].data));
  });
  assert.strictEqual(back[0].method, 8, 'repetitive text is deflated');
  assert.strictEqual(back[2].method, 0, 'random bytes are stored (deflate is not smaller)');
  assert.strictEqual(back[3].size, 0);
  assert.strictEqual(back[4].size, 1024 * 1024);
});

test('reproducible: fixed timestamp, UTF-8 flag, no directory entries', () => {
  const entries = [{ name: 'a/b.txt', data: Buffer.from('b') }, { name: 'a/c.txt', data: Buffer.from('c') }];
  const z1 = writeZip(entries);
  const z2 = writeZip(entries);
  assert.ok(z1.equals(z2));
  // First local header: flags at 6, time at 10, date at 12.
  assert.strictEqual(z1.readUInt16LE(6) & 0x0800, 0x0800);
  assert.strictEqual(z1.readUInt16LE(10), 0);
  assert.strictEqual(z1.readUInt16LE(12), ((2025 - 1980) << 9) | (1 << 5) | 1);
  assert.ok(readZip(z1).every((e) => !e.name.endsWith('/')));
});

test('refuses more than 65,535 entries and detects damage', () => {
  const many = new Array(65536).fill(null).map((_, i) => ({ name: 'f' + i, data: Buffer.alloc(0) }));
  assert.throws(() => writeZip(many), /65,535/);
  const zip = writeZip([{ name: 'x.txt', data: Buffer.from('hello hello hello hello') }]);
  const broken = Buffer.from(zip);
  broken[40] ^= 0xff;
  assert.throws(() => readZip(broken));
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')));
});
