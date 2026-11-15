/**
 * pmo-bids.test.mjs — `pmo bid win|lose|decline` planning (#1789). Run: node --test scripts/pmo-bids.test.mjs
 * Pure checks only; the command's HTTP path is covered in pmo.test.mjs (AC-1789-CLI-*).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { BID_OUTCOMES, LOST_REASONS, planBidOutcome } from './lib/pmo-bids.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const TODAY = '2026-11-15';
const BID = { id: 'p-1', name: 'Survey', status: 'Negotiation', contract_value: 125000, contract_value_set_at: '2026-10-01T00:00:00Z' };
const plan = (outcome, input, project = BID) => planBidOutcome(outcome, input, project, { today: TODAY });

test('AC-1789-001: a win with order number, date and the stored contract value plans the won transition', () => {
  const result = plan('win', { ref: ' SO-77 ', date: '2026-09-12', value: '125000' });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.rpc, {
    p_id: 'p-1', p_to: 'Won, Pending KoM', p_customer_contract_ref: 'SO-77', p_contract_date: '2026-09-12',
  });
  assert.equal(result.from, 'Negotiation');
  assert.equal(result.contract_value, 125000);
});

test('AC-1789-002: a win missing any artifact is refused and plans nothing', () => {
  const cases = [
    [{ date: '2026-09-12', value: '125000' }, /client order number/],
    [{ ref: '   ', date: '2026-09-12', value: '125000' }, /client order number/],
    [{ ref: 'SO-77', value: '125000' }, /date/],
    [{ ref: 'SO-77', date: '2026-02-30', value: '125000' }, /date/],
    [{ ref: 'SO-77', date: '2026-11-17', value: '125000' }, /future/],
    [{ ref: 'SO-77', date: '2026-09-12' }, /--value/],
    [{ ref: 'SO-77', date: '2026-09-12', value: 'abc' }, /--value/],
    [{ ref: 'SO-77', date: '2026-09-12', value: '120000' }, /does not match/],
  ];
  for (const [input, message] of cases) {
    const result = plan('win', input);
    assert.equal(result.rpc, null, JSON.stringify(input));
    assert.match(result.problems.join('\n'), message, JSON.stringify(input));
  }
});

test('AC-1789-002: a win on a project with no contract value is refused', () => {
  for (const contract_value of [null, 0]) {
    const result = plan('win', { ref: 'SO-77', date: '2026-09-12', value: '0' }, { ...BID, contract_value });
    assert.equal(result.rpc, null);
    assert.match(result.problems.join('\n'), /no contract value/);
  }
});

test('AC-1789-003: lost records the reason and note through the lost transition', () => {
  const result = plan('lose', { reason: 'price', note: ' Lower bid won ' });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.rpc, { p_id: 'p-1', p_to: 'Loss Tender', p_lost_reason: 'price', p_lost_note: 'Lower bid won' });
});

test('AC-1789-004: declined records the reason through the declined transition', () => {
  const result = plan('decline', { reason: 'capacity' });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.rpc, { p_id: 'p-1', p_to: 'Declined', p_lost_reason: 'capacity' });
});

test('AC-1789-003: lost or declined needs a known reason, a note for "other", and a note of at most 500 characters', () => {
  for (const outcome of ['lose', 'decline']) {
    assert.match(plan(outcome, {}).problems.join('\n'), /--reason/);
    assert.match(plan(outcome, { reason: 'bad-luck' }).problems.join('\n'), /--reason/);
    assert.match(plan(outcome, { reason: 'other' }).problems.join('\n'), /--note/);
    assert.match(plan(outcome, { reason: 'price', note: 'x'.repeat(501) }).problems.join('\n'), /500/);
    assert.equal(plan(outcome, { reason: 'other', note: 'Client merged' }).problems.length, 0);
  }
});

test('AC-1789-005: only an open bid can be decided, and win-only flags are refused on a loss', () => {
  for (const status of ['Won, Pending KoM', 'Ongoing Project', 'Loss Tender', 'Declined', 'Internal Project']) {
    const result = plan('win', { ref: 'SO-77', date: '2026-09-12', value: '125000' }, { ...BID, status });
    assert.equal(result.rpc, null);
    assert.match(result.problems.join('\n'), /open bid/);
  }
  assert.match(plan('lose', { reason: 'price', ref: 'SO-1' }).problems.join('\n'), /--ref/);
  assert.match(plan('win', { ref: 'SO-77', date: '2026-09-12', value: '125000', reason: 'price' }).problems.join('\n'), /--reason/);
});

test('AC-1789-006: the CLI lost reasons match the latest transition_project', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /create or replace function (public\.)?transition_project\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .pop();
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const m = sql.match(/v_reason = any \(array\[([^\]]*)\]\)/);
  assert.ok(m, `the lost reasons are listed in ${latest}`);
  assert.deepEqual([...LOST_REASONS].sort(), [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort());
  assert.deepEqual(Object.keys(BID_OUTCOMES), ['win', 'lose', 'decline']);
});
