/**
 * historicalImportGroup.test.mjs — mirrors pmo-portal/src/lib/import/procurementCycle/group.ts's
 * existing test coverage (group.test.ts) for the copied-inline .mjs mirror import-historical.mjs
 * uses (FR-HIST-008 pure-layer reuse; see historicalImportGroup.mjs's docstring for why this is a
 * copy, not a TS import — no scripts/*.mjs imports a .ts file in this repo).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { groupRows } from './historicalImportGroup.mjs';

function row(overrides) {
  return {
    project: undefined,
    title: undefined,
    caseStatus: undefined,
    vendor: undefined,
    externalRef: undefined,
    status: undefined,
    date: undefined,
    amount: undefined,
    ...overrides,
  };
}

test('AC-CYCLE-GROUP-001: groups a VI+Payment-only case (Model-C: no PR/PO required)', () => {
  const rows = [
    row({ caseRef: 'CASE-001', type: 'VI', title: 'Legacy Invoice', project: 'Solar EPC', rowNumber: 1 }),
    row({ caseRef: 'CASE-001', type: 'Payment', rowNumber: 2 }),
  ];
  const { groups, rowErrors } = groupRows(rows);
  assert.equal(rowErrors.length, 0);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.caseRef, 'CASE-001');
  assert.equal(g.rows.length, 2);
  assert.equal(g.attrs.title, 'Legacy Invoice');
  assert.equal(g.attrs.project, 'Solar EPC');
});

test('AC-CYCLE-GROUP-002: splits a sheet with 3 different case_refs into 3 groups', () => {
  const rows = [
    row({ caseRef: 'CASE-A', type: 'PR', title: 'Case A', rowNumber: 1 }),
    row({ caseRef: 'CASE-B', type: 'RFQ', title: 'Case B', rowNumber: 2 }),
    row({ caseRef: 'CASE-A', type: 'PO', rowNumber: 3 }),
    row({ caseRef: 'CASE-C', type: 'VI', title: 'Case C', rowNumber: 4 }),
  ];
  const { groups, rowErrors } = groupRows(rows);
  assert.equal(rowErrors.length, 0);
  assert.equal(groups.length, 3);
  const caseA = groups.find((g) => g.caseRef === 'CASE-A');
  assert.equal(caseA.rows.length, 2);
});

test('AC-CYCLE-GROUP-003: excludes rows with blank caseRef and reports them as rowErrors', () => {
  const rows = [
    row({ caseRef: '', type: 'PR', rowNumber: 1 }),
    row({ caseRef: '   ', type: 'PO', rowNumber: 2 }),
    row({ caseRef: 'CASE-X', type: 'VI', title: 'Real case', rowNumber: 3 }),
  ];
  const { groups, rowErrors } = groupRows(rows);
  assert.equal(rowErrors.length, 2);
  assert.equal(rowErrors[0].rowNumber, 1);
  assert.equal(rowErrors[1].rowNumber, 2);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].caseRef, 'CASE-X');
});

test('AC-CYCLE-GROUP-004: uses first non-empty value for each attr across group rows', () => {
  const rows = [
    row({ caseRef: 'CASE-Y', type: 'PR', title: undefined, project: 'ProjectA', caseStatus: 'Active', rowNumber: 1 }),
    row({ caseRef: 'CASE-Y', type: 'RFQ', title: 'The Title', project: 'ProjectB', rowNumber: 2 }),
    row({ caseRef: 'CASE-Y', type: 'PO', title: 'Another Title', rowNumber: 3 }),
  ];
  const { groups } = groupRows(rows);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.attrs.project, 'ProjectA');
  assert.equal(g.attrs.title, 'The Title');
  assert.equal(g.attrs.caseStatus, 'Active');
});

test('AC-CYCLE-GROUP-005: groups rows with same caseRef differing only in case (original preserved)', () => {
  const rows = [
    row({ caseRef: 'case-001', type: 'VI', rowNumber: 1 }),
    row({ caseRef: 'CASE-001', type: 'Payment', rowNumber: 2 }),
  ];
  const { groups } = groupRows(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].caseRef, 'case-001');
  assert.equal(groups[0].rows.length, 2);
});
