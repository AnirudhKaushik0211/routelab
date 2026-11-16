'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/routelab.js');

const res = R.simulate(R.getScenario('peak-outage'), { scenarioId: 'peak-outage', seeds: 2, seedStart: 1 });

function walk(t, fn) { fn(t); t.children.forEach((c) => walk(c, fn)); }
function find(t, pred) { const out = []; walk(t, (x) => { if (pred(x)) out.push(x); }); return out; }
function noBadNumbers(t) {
  walk(t, (x) => {
    for (const k of Object.keys(x.attrs)) assert.ok(!/NaN|Infinity|undefined/.test(String(x.attrs[k])), x.tag + ' ' + k + '=' + x.attrs[k]);
    if (x.text !== null) assert.ok(!/NaN|Infinity|undefined/.test(x.text), 'text ' + x.text);
  });
}

test('chart 1: svg attributes, title and desc, one group per policy, event rects, colours', () => {
  const t = R.charts.srChart(res, { id: 'c1' });
  assert.equal(t.tag, 'svg');
  assert.equal(t.attrs.viewBox, '0 0 720 320');
  assert.equal(t.attrs.role, 'img');
  assert.equal(t.attrs['aria-labelledby'], 'c1-title c1-desc');
  assert.equal(find(t, (x) => x.tag === 'title')[0].attrs.id, 'c1-title');
  const desc = find(t, (x) => x.tag === 'desc')[0];
  assert.equal(desc.attrs.id, 'c1-desc');
  assert.ok(desc.text.indexOf('7 strategies') > 0 && desc.text.indexOf('Gateway A event 19:30-20:15, recovery to 20:30') > 0, desc.text);
  const groups = find(t, (x) => x.attrs['data-role'] === 'series');
  assert.equal(groups.length, 7);
  const th = groups.find((g) => g.attrs['data-id'] === 'thompson');
  assert.equal(th.children[0].attrs.stroke, '#1d4ed8');
  assert.equal(th.children[0].attrs['stroke-width'], '3');
  assert.equal(groups.find((g) => g.attrs['data-id'] === 'static').children[0].attrs['stroke-dasharray'], undefined);
  assert.equal(groups.find((g) => g.attrs['data-id'] === 'weighted').children[0].attrs['stroke-dasharray'], '6 3');
  const rects = find(t, (x) => x.attrs['data-role'] === 'event');
  assert.equal(rects.length, 1);
  assert.equal(rects[0].attrs.fill, '#e5e7eb');
  assert.equal(find(t, (x) => x.attrs['data-role'] === 'recovery')[0].attrs.fill, '#f3f4f6');
  noBadNumbers(t);
  const m = R.charts.srChart(res, { id: 'c1', method: 'upi_collect' });
  assert.notEqual(find(m, (x) => x.tag === 'desc')[0].text, desc.text);
  noBadNumbers(m);
});

test('polylines split at null buckets', () => {
  const hand = JSON.parse(JSON.stringify(res));
  hand.series.orderSr.static[10] = null;
  hand.series.orderSr.static[11] = null;
  const t = R.charts.srChart(hand, { id: 'c1' });
  const g = find(t, (x) => x.attrs['data-id'] === 'static' && x.attrs['data-role'] === 'series')[0];
  assert.equal(g.children.filter((c) => c.tag === 'polyline').length, 2);
});

test('chart 2: one line per gateway with the 8.8 colours; chart 3: markers and whiskers', () => {
  const t = R.charts.shareChart(res, { id: 'c2', policy: 'static' });
  const g = find(t, (x) => x.attrs['data-role'] === 'series');
  assert.equal(g.length, 3);
  assert.equal(g[0].children[0].attrs.stroke, '#1d4ed8');
  assert.equal(g[1].children[0].attrs.stroke, '#b45309');
  assert.equal(g[2].children[0].attrs.stroke, '#0f766e');
  noBadNumbers(t);
  const s = R.charts.scatterChart(res, { id: 'c3' });
  assert.equal(find(s, (x) => x.attrs['data-role'] === 'marker').length, 7);
  assert.equal(find(s, (x) => x.attrs['data-role'] === 'whisker').length, 14);
  noBadNumbers(s);
});

test('charts survive degenerate results (one seed, flat values)', () => {
  const one = R.simulate(R.getScenario('steady'), { seeds: 1 });
  noBadNumbers(R.charts.srChart(one, { id: 'a' }));
  noBadNumbers(R.charts.shareChart(one, { id: 'b' }));
  noBadNumbers(R.charts.scatterChart(one, { id: 'c' }));
});

test('policy colours have the table values', () => {
  const P = R.charts.POLICY_STYLE;
  assert.equal(P.static.color, '#1f2937');
  assert.equal(P.weighted.color, '#7c3aed');
  assert.equal(P.rules.color, '#b45309');
  assert.equal(P.egreedy.color, '#0f766e');
  assert.equal(P.thompson_cost.color, '#be123c');
  assert.equal(P.oracle.color, '#6b7280');
  assert.equal(P.egreedy.dash, '10 3 2 3');
});
