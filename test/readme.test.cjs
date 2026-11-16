'use strict';
// SPEC 10.1 readme row: results block, screenshots, live-demo line, github.io addresses, disclaimer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../scripts/results.cjs');

const ROOT = path.resolve(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

function section(md, title) {
  const a = md.indexOf('\n## ' + title + '\n');
  assert.ok(a >= 0, 'README has a ' + title + ' section');
  const b = md.indexOf('\n## ', a + 5);
  return md.slice(a, b < 0 ? md.length : b);
}

test('the README results block equals the rendering from docs/results.json', () => {
  const obj = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'results.json'), 'utf8'));
  assert.equal(G.readmeBlockOf(README), G.renderBlock(obj));
});

test('every screenshot is referenced in Screenshots with alt text and the caption; every image exists', () => {
  const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter((n) => /^screenshot-.*\.png$/.test(n)).sort();
  assert.equal(docs.length, 7);
  const s = section(README, 'Screenshots');
  const refs = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(s)) !== null) refs.push({ alt: m[1], src: m[2], end: m.index + m[0].length });
  assert.deepEqual(refs.map((r) => r.src.replace(/^docs\//, '')).sort(), docs);
  for (const r of refs) {
    assert.ok(r.alt.trim().length > 0, 'alt text for ' + r.src);
    assert.ok(s.slice(r.end).replace(/^\s+/, '').startsWith('Synthetic data.'), 'caption after ' + r.src);
  }
  const all = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  while ((m = all.exec(README)) !== null) assert.ok(fs.existsSync(path.join(ROOT, ...m[1].split('/'))), m[1]);
});

test('Live demo: the placeholder line or one Pages address', () => {
  const s = section(README, 'Live demo');
  const placeholder = s.split('\n').filter((l) => l === 'Live demo: add the GitHub Pages link here after publishing.').length;
  const live = s.split('\n').filter((l) => /^Live demo: https:\/\/[A-Za-z0-9-]+\.github\.io\/routelab\/$/i.test(l)).length;
  assert.equal(placeholder + live, 1);
});

test('only the placeholder github.io form and the live-demo address appear', () => {
  const found = README.match(/https?:\/\/[^\s)`]*github\.io[^\s)`]*/gi) || [];
  const live = (README.match(/^Live demo: (https:\/\/[A-Za-z0-9-]+\.github\.io\/routelab\/)$/im) || [])[1];
  for (const u of found) assert.ok(u === 'https://<your-user-name>.github.io/<repository-name>/' || u === live, 'unexpected address ' + u);
  assert.ok(README.includes('https://<your-user-name>.github.io/<repository-name>/'));
});

test('README says it is not financial advice and has the privacy sentence', () => {
  assert.ok(/not financial advice/i.test(README));
  assert.ok(README.toLowerCase().includes('not financial advice'));
  assert.ok(README.includes('No network requests (blocked by a Content Security Policy and checked by automated tests).'));
  assert.ok(README.includes('ROUTELAB_SKIP_PERF=1'));
});
