import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TERMINAL_PROJECT_STATUSES,
  TERMINAL_PROCUREMENT_STATUSES,
  COMMITTED_STATUSES,
  validateProjectRow,
  validateCaseRow,
} from './historicalImportValidate.mjs';

test('AC-HIST-002: a projects.csv row with a non-terminal status is rejected with a per-row error', () => {
  const result = validateProjectRow({ code: 'P-1', title: 'Ongoing Deal', status: 'Ongoing Project', contract_value: '100000', end_date: '2026-01-01' });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /terminal/i);
});

test('AC-HIST-002: a projects.csv row with a terminal status (Close Out) is accepted', () => {
  const result = validateProjectRow({ code: 'P-2', title: 'Closed Deal', status: 'Close Out', contract_value: '250000', end_date: '2026-01-01' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('AC-HIST-002: a procurement_cases.csv case row with a non-terminal terminal_status is rejected', () => {
  const result = validateCaseRow({ case_ref: 'C-1', type: 'PO', terminal_status: 'Ordered', total_value: '5000' });
  // 'Ordered' IS a terminal-eligible committed status per COMMITTED_STATUSES — use a genuinely
  // non-terminal status (e.g. 'Draft') for the negative case:
  const nonTerminal = validateCaseRow({ case_ref: 'C-2', type: 'PO', terminal_status: 'Draft', total_value: '5000' });
  assert.equal(nonTerminal.valid, false);
  assert.match(nonTerminal.errors[0], /terminal/i);
});

test('FR-HIST-004: a case row whose terminal_status is COMMITTED and total_value is blank is REJECTED (not silently 0)', () => {
  const result = validateCaseRow({ case_ref: 'C-3', type: 'PO', terminal_status: 'Paid', total_value: '' });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /total_value/i);
});

test('FR-HIST-004: a case row whose terminal_status is NOT committed may leave total_value blank', () => {
  const result = validateCaseRow({ case_ref: 'C-4', type: 'PO', terminal_status: 'Rejected', total_value: '' });
  assert.equal(result.valid, true);
});

test('COMMITTED_STATUSES matches procurements.ts:28-32 exactly', () => {
  assert.deepEqual(COMMITTED_STATUSES, ['Ordered', 'Received', 'Vendor Invoiced', 'Paid']);
});
