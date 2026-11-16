#!/usr/bin/env node
'use strict';
// RouteLab command-line interface (SPEC 7.4). Node built-ins only.
const fs = require('fs');
const path = require('path');
const R = require('../js/routelab.js');

const USAGE = [
  'Usage:',
  '  node scripts/simulate.cjs --scenario <id> [--seeds N] [--seed-start S] [--txns N] [--format text|json|csv|memo] [--out <file>] [--assert]',
  '  node scripts/simulate.cjs --config <file.json> [--scenario <id>] [same options]',
  '  node scripts/simulate.cjs --list',
  '  node scripts/simulate.cjs --help'
].join('\n');

const VALUE_FLAGS = ['--scenario', '--seeds', '--seed-start', '--txns', '--format', '--out', '--config'];
const BOOL_FLAGS = ['--assert', '--list', '--help'];
const MAX_CONFIG_BYTES = 64000;

function bad(problem) {
  process.stderr.write('routelab: ' + problem + '\n' + USAGE + '\n');
  process.exit(2);
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.indexOf('--') !== 0) bad('unexpected argument: ' + a);
    if (BOOL_FLAGS.indexOf(a) >= 0) {
      if (o[a]) bad(a + ' given twice');
      o[a] = true;
      continue;
    }
    if (VALUE_FLAGS.indexOf(a) < 0) bad('unknown option: ' + a);
    if (o[a] !== undefined) bad(a + ' given twice');
    if (i + 1 >= argv.length || argv[i + 1].indexOf('--') === 0) bad(a + ' needs a value');
    o[a] = argv[++i];
  }
  return o;
}

function intArg(o, name, lo, hi) {
  if (o[name] === undefined) return undefined;
  if (!/^\d+$/.test(o[name])) bad(name + ' must be a whole number from ' + lo + ' to ' + hi);
  const v = Number(o[name]);
  if (v < lo || v > hi) bad(name + ' must be a whole number from ' + lo + ' to ' + hi);
  return v;
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

function localDate() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Stat -> "91.47% +-0.31" style cells (SPEC 7.4 column rules).
function half(s) { return s.ciLow === null ? null : (s.ciHigh - s.ciLow) / 2; }
function srCell(s) {
  if (!s || s.mean === null) return 'n/a';
  const h = half(s);
  return (s.mean * 100).toFixed(2) + '%' + (h === null ? '' : ' +-' + (h * 100).toFixed(2));
}
function costCell(s) {
  if (!s || s.mean === null) return 'n/a';
  const h = half(s);
  return 'Rs ' + s.mean.toFixed(2) + (h === null ? '' : ' +-' + h.toFixed(2));
}
function oneDec(s, unit) { return !s || s.mean === null ? 'n/a' : s.mean.toFixed(1) + (unit || ''); }

function hhmm(m) { return R.metrics.windowLabel([m, m]).split('-')[0]; }

function textReport(res) {
  const L = [];
  const cfg = res.config;
  L.push('RouteLab ' + res.version + ' - ' + res.title + ' (' + res.scenarioId + ')');
  L.push('Synthetic data and illustrative assumptions; results show mechanisms, not real-world success rates.');
  const seeds = res.seeds;
  L.push('Seeds ' + seeds[0] + '-' + seeds[seeds.length - 1] + ' (' + seeds.length + '). About ' + R.config.fmtInt(cfg.run.txnPerDay) +
    ' transactions per seed. Baseline: ' + R.POLICY_LABELS[res.baseline] + '.');
  L.push('');
  L.push(pad('Strategy', 22) + pad('Order SR', 21) + pad('First-attempt SR', 21) + pad('Cost/success', 18) + pad('p95 time', 11) + pad('Drop-off', 10) + 'Regret/1k');
  for (const p of res.policies) {
    const s = res.summary[p.id];
    L.push(pad(p.label, 22) + pad(srCell(s.orderSr), 21) + pad(srCell(s.firstSr), 21) + pad(costCell(s.costPerSuccess), 18) +
      pad(oneDec(s.ttsP95, ' s'), 11) + pad(s.dropRate.mean === null ? 'n/a' : (s.dropRate.mean * 100).toFixed(2) + '%', 10) + oneDec(s.regretPer1000));
  }
  L.push('');
  L.push('Paired difference vs ' + R.POLICY_LABELS[res.baseline] + ' (order SR, percentage points; 95% CI)');
  const f2 = R.memo.format.pp;
  for (const p of res.policies) {
    if (p.id === res.baseline) continue;
    const d = res.paired[p.id].orderSr;
    let cell = 'n/a';
    if (d.mean !== null) cell = f2(d.mean) + (d.ciLow === null ? '' : ' (' + f2(d.ciLow) + ' to ' + f2(d.ciHigh) + ')');
    L.push(pad(p.label, 22) + cell);
  }
  if (res.focus) {
    L.push('');
    L.push('Focus window ' + R.metrics.windowLabel([res.focus.start, res.focus.end]) + ': order SR');
    const perMethod = cfg.events.some((e) => e.methods.length > 0);
    if (perMethod) {
      L.push(pad('Strategy', 22) + pad('All methods', 21) + R.METHODS.map((m) => pad(R.METHOD_LABELS[m], 21)).join(''));
    }
    for (const p of res.policies) {
      const f = res.focusSummary[p.id];
      let row = pad(p.label, 22) + pad(srCell(f.orderSr), 21);
      if (perMethod) row += R.METHODS.map((m) => pad(srCell(f.orderSrByMethod[m]), 21)).join('');
      L.push(row.replace(/\s+$/, ''));
    }
  }
  if (res.expectations) {
    L.push('');
    L.push('Expectations (seeds ' + seeds[0] + '-' + seeds[seeds.length - 1] + ')');
    for (const e of res.expectations) {
      const tag = e.held === true ? 'PASS' : (e.held === false ? 'FAIL' : 'SKIP');
      L.push(tag + ' ' + e.id + ' ' + e.detail);
    }
  }
  return L.join('\n') + '\n';
}

function writeAtomic(file, text) {
  const dir = path.dirname(path.resolve(file));
  const tmp = path.join(dir, '.routelab-' + process.pid + '-' + Date.now() + '.tmp');
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, path.resolve(file));
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o['--help']) { process.stdout.write(USAGE + '\n'); return 0; }
  if (o['--list']) {
    for (const s of R.scenarios) process.stdout.write(s.id + '  ' + s.title + '\n');
    return 0;
  }
  if (o['--scenario'] === undefined && o['--config'] === undefined) bad('give --scenario <id> or --config <file>');
  if (o['--scenario'] !== undefined && !R.scenarios.some((s) => s.id === o['--scenario'])) bad('unknown scenario: ' + o['--scenario']);
  const seeds = intArg(o, '--seeds', 1, 100);
  const seedStart = intArg(o, '--seed-start', 0, 4294967295 - (seeds === undefined ? 1 : seeds));
  const txns = intArg(o, '--txns', 100, 50000);
  const format = o['--format'] === undefined ? 'text' : o['--format'];
  if (['text', 'json', 'csv', 'memo'].indexOf(format) < 0) bad('unknown format: ' + format + ' (use text, json, csv or memo)');

  let config;
  if (o['--config'] !== undefined) {
    const file = o['--config'];
    const fail = (msg) => { process.stderr.write('routelab: ' + file + ': ' + msg + '\n'); process.exit(1); };
    let st;
    try { st = fs.statSync(file); } catch (e) { fail('cannot read the file'); }
    if (!st.isFile()) fail('not a file');
    if (st.size > MAX_CONFIG_BYTES) fail('file is larger than 64,000 bytes');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)); } catch (e) { fail('not valid UTF-8'); }
    try { config = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text); } catch (e) { fail('not valid JSON'); }
    if (config && typeof config === 'object' && config.run && typeof config.run === 'object') config.run = Object.assign({}, config.run);
  } else {
    config = R.getScenario(o['--scenario']);
  }
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    if (config.run && typeof config.run === 'object') {
      if (seeds !== undefined) config.run.seeds = seeds;
      if (seedStart !== undefined) config.run.seedStart = seedStart;
      if (txns !== undefined) config.run.txnPerDay = txns;
    }
  }
  const v = R.validateConfig(config);
  if (!v.ok) {
    const first = v.errors.slice(0, 3).map((e) => e.path + ': ' + e.message).join('; ');
    process.stderr.write('routelab: ' + (o['--config'] !== undefined ? o['--config'] + ': ' : '') + first + '\n');
    return 1;
  }
  const res = R.simulate(v.config, { scenarioId: o['--scenario'] });
  let out;
  if (format === 'json') out = R.toJson(res);
  else if (format === 'csv') out = R.toCsv(res);
  else if (format === 'memo') out = R.buildMemo(res, { generatedOn: localDate() });
  else out = textReport(res);
  if (o['--out'] !== undefined) {
    try { writeAtomic(o['--out'], out); } catch (e) { process.stderr.write('routelab: ' + o['--out'] + ': cannot write the file\n'); return 1; }
  } else process.stdout.write(out);
  if (o['--assert'] && res.expectations && res.expectations.some((e) => e.held === false)) return 3;
  return 0;
}

process.exitCode = main();
