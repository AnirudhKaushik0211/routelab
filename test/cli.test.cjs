'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = require('../js/routelab.js');

const CLI = path.join(__dirname, '..', 'scripts', 'simulate.cjs');
function run(args) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routelab-cli-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('--list and --help', () => {
  const l = run(['--list']);
  assert.equal(l.code, 0);
  const lines = l.out.trim().split('\n');
  assert.equal(lines.length, 7);
  assert.equal(lines[0], 'steady  Steady state');
  assert.equal(run(['--help']).code, 0);
});

test('text output: header lines and strategy rows', () => {
  const r = run(['--scenario', 'steady', '--seeds', '2']);
  assert.equal(r.code, 0);
  const lines = r.out.split('\n');
  assert.equal(lines[0], 'RouteLab 1.0.0 - Steady state (steady)');
  assert.equal(lines[1], 'Synthetic data and illustrative assumptions; results show mechanisms, not real-world success rates.');
  assert.equal(lines[2], 'Seeds 1-2 (2). About 10,000 transactions per seed. Baseline: Static priority.');
  const header = lines.findIndex((l) => l.startsWith('Strategy '));
  const rows = lines.slice(header + 1, header + 8);
  assert.deepEqual(rows.map((x) => x.slice(0, 22).trim()), ['Static priority', 'Weighted split', 'Rule-based', 'Epsilon-greedy', 'Thompson sampling', 'Cost-aware Thompson', 'Oracle (reference)']);
  assert.ok(r.out.includes('Paired difference vs Static priority'));
  assert.ok(r.out.includes('Focus window 18:00-24:00: order SR'));
  assert.ok(r.out.includes('Expectations (seeds 1-2)'));
});

test('collect-degradation focus block has per-method columns', () => {
  const r = run(['--scenario', 'collect-degradation', '--seeds', '2', '--txns', '2000']);
  assert.equal(r.code, 0);
  assert.ok(/Strategy\s+All methods\s+UPI intent\s+UPI collect\s+Card\s+Netbanking/.test(r.out));
});

test('json equals toJson(simulate(...)); csv header; memo first line', () => {
  const j = run(['--scenario', 'peak-outage', '--seeds', '2', '--format', 'json']);
  assert.equal(j.out, R.toJson(R.simulate(R.getScenario('peak-outage'), { scenarioId: 'peak-outage', seeds: 2, seedStart: 1 })));
  const c = run(['--scenario', 'peak-outage', '--seeds', '2', '--format', 'csv']);
  assert.equal(c.out.split('\n')[0], 'scenario,policy,metric,mean,ci_low,ci_high,sd,n');
  const m = run(['--scenario', 'peak-outage', '--seeds', '2', '--format', 'memo']);
  assert.equal(m.out.split('\n')[0], '# Routing decision memo: Evening-peak outage on the best gateway');
});

test('--assert: exit 0 on a passing preset, 3 with one seed', () => {
  const ok = run(['--scenario', 'peak-outage', '--assert']);
  assert.equal(ok.code, 0);
  assert.ok(/PASS PO1 /.test(ok.out) && /PASS PO6 /.test(ok.out));
  const no = run(['--scenario', 'steady', '--seeds', '1', '--assert']);
  assert.equal(no.code, 3);
  assert.ok(/FAIL ST3 /.test(no.out));
});

test('bad arguments exit 2 with usage and read no file', () => {
  const cases = [[], ['--bogus'], ['--scenario'], ['--scenario', 'nope'], ['--scenario', 'steady', '--scenario', 'steady'], ['--scenario', 'steady', '--seeds', '0'],
    ['--scenario', 'steady', '--seeds', '1.5'], ['--scenario', 'steady', '--seeds', '101'], ['--scenario', 'steady', '--txns', '99'],
    ['--scenario', 'steady', '--seed-start', '-1'], ['--scenario', 'steady', '--format', 'xml'], ['--scenario', 'steady', 'extra'],
    ['--config', path.join(tmp, 'missing.json'), '--seeds', 'x']];
  for (const a of cases) {
    const r = run(a);
    assert.equal(r.code, 2, JSON.stringify(a));
    assert.ok(r.err.startsWith('routelab: '), a.join(' '));
    assert.ok(r.err.includes('Usage:'));
  }
});

test('--config: missing, not JSON, too large, invalid; boundary at 64,000 bytes', () => {
  const f = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };
  assert.equal(run(['--config', path.join(tmp, 'missing.json')]).code, 1);
  assert.equal(run(['--config', f('bad.json', '{oops')]).code, 1);
  const inv = run(['--config', f('inv.json', '{"v":1}')]);
  assert.equal(inv.code, 1);
  assert.ok(inv.err.includes('inv.json'));
  const json = JSON.stringify(R.getScenario('steady'));
  const small = JSON.parse(json); small.run.seeds = 1; small.run.txnPerDay = 200;
  const text = JSON.stringify(small);
  const exact = text + ' '.repeat(64000 - Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(exact), 64000);
  assert.equal(run(['--config', f('exact.json', exact)]).code, 0);
  assert.equal(run(['--config', f('big.json', exact + ' ')]).code, 1);
  const ok = run(['--config', f('ok.json', text), '--scenario', 'steady']);
  assert.equal(ok.code, 0);
  assert.ok(ok.out.includes('(custom)'), 'a modified configuration is custom');
});

test('--out writes the file atomically and reports an unwritable path', () => {
  const out = path.join(tmp, 'out.csv');
  const r = run(['--scenario', 'steady', '--seeds', '2', '--txns', '500', '--format', 'csv', '--out', out]);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.ok(fs.readFileSync(out, 'utf8').startsWith('scenario,policy,metric'));
  assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.endsWith('.tmp')), []);
  const bad = run(['--scenario', 'steady', '--seeds', '1', '--txns', '500', '--out', path.join(tmp, 'no-such-dir', 'x.txt')]);
  assert.equal(bad.code, 1);
});
