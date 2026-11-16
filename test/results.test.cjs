'use strict';
// SPEC 10.1 results.test.cjs: the generator is deterministic and the committed files are what it generates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../scripts/results.cjs');

const ROOT = path.join(__dirname, '..');

test('two builds of a subset give identical strings', () => {
  const a = G.buildResultsSet({ only: ['peak-outage', 'cost-vs-sr'] });
  const b = G.buildResultsSet({ only: ['peak-outage', 'cost-vs-sr'] });
  assert.equal(a.json, b.json);
  assert.equal(a.md, b.md);
  assert.equal(a.block, b.block);
  assert.equal(a.obj.scenarios.length, 2);
});

test('the committed docs/results.json, docs/RESULTS.md and README block equal a fresh build', () => {
  const s = G.buildResultsSet();
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs', 'results.json'), 'utf8'), s.json);
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs', 'RESULTS.md'), 'utf8'), s.md);
  assert.equal(G.readmeBlockOf(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')), s.block);
  const o = JSON.parse(s.json);
  assert.equal(o.schema, 'routelab.results-set.v1');
  assert.equal(o.scenarios.length, 7);
  for (const sc of o.scenarios) {
    assert.ok(sc.expectations.results.every((e) => e.held === true));
    assert.ok(sc.expectations.robust.every((e) => e.held === true));
    assert.ok(!('series' in sc) && !('perSeed' in sc) && !('config' in sc));
    assert.ok(sc.headlines.length >= 1);
  }
});

test('splice replaces only the block and needs the markers', () => {
  const r = G.splice('a\n' + G.MARK_START + '\nold\n' + G.MARK_END + '\nz\n', 'NEW\n');
  assert.equal(r, 'a\n' + G.MARK_START + '\nNEW\n' + G.MARK_END + '\nz\n');
  assert.equal(G.splice('no markers', 'x'), null);
});
