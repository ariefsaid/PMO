import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, formatTable, parseDelay } from './region-timing.mjs';

test('parseArgs reads route, delays and regions', () => {
  const o = parseArgs(['--route', '/sales', '--delay', 'rest/v1/opportunities=3000', '--region', 'a', '--region', 'b']);
  assert.equal(o.route, '/sales');
  assert.deepEqual(o.delays, [{ match: 'rest/v1/opportunities', ms: 3000 }]);
  assert.deepEqual(o.regions, ['a', 'b']);
});
test('parseArgs accepts several --region values after one flag', () => {
  assert.deepEqual(parseArgs(['--route', '/x', '--delay', 'u=1', '--region', 'a', 'b']).regions, ['a', 'b']);
});
test('parseArgs rejects bad input', () => {
  assert.throws(() => parseArgs([]), /--route/);
  assert.throws(() => parseArgs(['--route', 'x', '--delay', 'u=1', '--region', 'a']), /start with/);
  assert.throws(() => parseArgs(['--route', '/x', '--delay', 'u', '--region', 'a']), /delay/);
  assert.throws(() => parseArgs(['--route', '/x', '--delay', 'u=-5', '--region', 'a']), /delay/);
  assert.throws(() => parseArgs(['--route', '/x', '--region', 'a', '--nope']), /unknown/);
  assert.throws(() => parseArgs(['--route', '/x', '--delay', 'u=1']), /--region/);
});
test('parseDelay splits on the last equals sign', () => {
  assert.deepEqual(parseDelay('rpc/f?x=1=250'), { match: 'rpc/f?x=1', ms: 250 });
});
test('formatTable marks beat/not-beat and missing hooks', () => {
  const t = formatTable({ route: '/sales', delayMs: 3000, delayed: 'opportunities',
    rows: [{ region: 'a', ms: 420.4 }, { region: 'b', ms: 3150.9 }, { region: 'c', ms: null, hook: false }, { region: 'd', ms: null, hook: true }] });
  const lines = t.split('\n');
  assert.match(lines[0], /\/sales/);
  assert.match(t, /\| a \| 420 \| yes \|/);
  assert.match(t, /\| b \| 3151 \| no \|/);
  assert.match(t, /\| c \| no hook \| n\/a \|/);
  assert.match(t, /\| d \| never \| no \|/);
});
