'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/state.js');
const S = require('../js/scenarios.js');
const P = require('../js/prng.js');

test('round trip of every preset', () => {
  for (const id of S.ids) {
    const c = S.getScenario(id);
    const h = ST.encodeState(c);
    assert.ok(h.startsWith('#s='));
    assert.ok(/^#s=[A-Za-z0-9_-]+$/.test(h));
    const d = ST.decodeState(h);
    assert.equal(d.ok, true);
    assert.deepEqual(d.config, c);
  }
});

test('decode error codes', () => {
  assert.equal(ST.decodeState('').error, 'empty');
  assert.equal(ST.decodeState('#').error, 'empty');
  assert.equal(ST.decodeState(undefined).error, 'empty');
  assert.equal(ST.decodeState('#x=abc').error, 'format');
  assert.equal(ST.decodeState('#s=not-valid!').error, 'base64');
  assert.equal(ST.decodeState('#s=A').error, 'base64');
  const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
  assert.equal(ST.decodeState('#s=' + b64([0xff, 0xfe, 0xfd])).error, 'utf8');
  assert.equal(ST.decodeState('#s=' + b64(Buffer.from('{oops'))).error, 'json');
  assert.equal(ST.decodeState('#s=' + b64(Buffer.from('[1]'))).error, 'shape');
  assert.equal(ST.decodeState('#s=' + b64(Buffer.from('{"v":2,"config":{}}'))).error, 'shape');
  assert.equal(ST.decodeState('#s=' + b64(Buffer.from('{"v":1,"config":5}'))).error, 'shape');
  assert.equal(ST.decodeState('#s=' + b64(Buffer.from('{"v":1,"config":{}}'))).ok, true);
});

test('64,000 character limit applies to the whole hash string', () => {
  const ok = '#s=' + 'A'.repeat(64000 - 3);
  assert.equal(ok.length, 64000);
  assert.notEqual(ST.decodeState(ok).error, 'too-long');
  const long = ok + 'A';
  assert.equal(long.length, 64001);
  assert.equal(ST.decodeState(long).error, 'too-long');
  assert.equal(ST.decodeState('x'.repeat(64001)).error, 'too-long', 'checked before the format');
});

test('non-ASCII content survives', () => {
  const c = { v: 1, label: 'caf\u00e9 \u20b9 \u{1F600}' };
  const d = ST.decodeState(ST.encodeState(c));
  assert.equal(d.ok, true);
  assert.equal(d.config.label, c.label);
});

test('1,000 seeded random strings never throw', () => {
  const r = P.stream(7, 'state-random');
  const alphabet = '#s=AZaz09-_+/!%\u00e9 ';
  for (let i = 0; i < 1000; i++) {
    let s = r() < 0.5 ? '#s=' : '';
    const n = Math.floor(r() * 60);
    for (let k = 0; k < n; k++) s += alphabet[Math.floor(r() * alphabet.length)];
    assert.doesNotThrow(() => ST.decodeState(s));
    assert.equal(typeof ST.decodeState(s).ok, 'boolean');
  }
});
