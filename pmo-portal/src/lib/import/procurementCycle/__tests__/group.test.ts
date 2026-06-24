import { describe, it, expect } from 'vitest';
import { groupRows } from '../group';
import type { CycleRow } from '../types';

// Helper to build a minimal CycleRow
function row(overrides: Partial<CycleRow> & Pick<CycleRow, 'caseRef' | 'type' | 'rowNumber'>): CycleRow {
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

describe('groupRows — AC-CYCLE-GROUP-001: PR-less case (VI+Payment only) groups correctly', () => {
  it('groups a VI+Payment-only case (Model-C: no PR/PO required)', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'CASE-001', type: 'VI', title: 'Legacy Invoice', project: 'Solar EPC', rowNumber: 1 }),
      row({ caseRef: 'CASE-001', type: 'Payment', rowNumber: 2 }),
    ];
    const { groups, rowErrors } = groupRows(rows);
    expect(rowErrors).toHaveLength(0);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.caseRef).toBe('CASE-001');
    expect(g.rows).toHaveLength(2);
    expect(g.rows[0].type).toBe('VI');
    expect(g.rows[1].type).toBe('Payment');
    // attrs from first row wins
    expect(g.attrs.title).toBe('Legacy Invoice');
    expect(g.attrs.project).toBe('Solar EPC');
  });
});

describe('groupRows — AC-CYCLE-GROUP-002: multi-case sheet splits into N groups', () => {
  it('splits a sheet with 3 different case_refs into 3 groups', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'CASE-A', type: 'PR', title: 'Case A', rowNumber: 1 }),
      row({ caseRef: 'CASE-B', type: 'RFQ', title: 'Case B', rowNumber: 2 }),
      row({ caseRef: 'CASE-A', type: 'PO', rowNumber: 3 }),
      row({ caseRef: 'CASE-C', type: 'VI', title: 'Case C', rowNumber: 4 }),
    ];
    const { groups, rowErrors } = groupRows(rows);
    expect(rowErrors).toHaveLength(0);
    expect(groups).toHaveLength(3);
    const caseRefs = groups.map((g) => g.caseRef).sort();
    expect(caseRefs).toEqual(['CASE-A', 'CASE-B', 'CASE-C']);
    const caseA = groups.find((g) => g.caseRef === 'CASE-A')!;
    expect(caseA.rows).toHaveLength(2);
  });
});

describe('groupRows — AC-CYCLE-GROUP-003: blank caseRef → rowError, excluded from groups', () => {
  it('excludes rows with blank caseRef and reports them as rowErrors', () => {
    const rows: CycleRow[] = [
      row({ caseRef: '', type: 'PR', rowNumber: 1 }),
      row({ caseRef: '   ', type: 'PO', rowNumber: 2 }),
      row({ caseRef: 'CASE-X', type: 'VI', title: 'Real case', rowNumber: 3 }),
    ];
    const { groups, rowErrors } = groupRows(rows);
    expect(rowErrors).toHaveLength(2);
    expect(rowErrors[0].rowNumber).toBe(1);
    expect(rowErrors[1].rowNumber).toBe(2);
    expect(groups).toHaveLength(1);
    expect(groups[0].caseRef).toBe('CASE-X');
  });
});

describe('groupRows — AC-CYCLE-GROUP-004: first-row-wins attr resolution', () => {
  it('uses first non-empty value for each attr across group rows', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'CASE-Y', type: 'PR', title: undefined, project: 'ProjectA', caseStatus: 'Active', rowNumber: 1 }),
      row({ caseRef: 'CASE-Y', type: 'RFQ', title: 'The Title', project: 'ProjectB', rowNumber: 2 }),
      row({ caseRef: 'CASE-Y', type: 'PO', title: 'Another Title', rowNumber: 3 }),
    ];
    const { groups } = groupRows(rows);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    // project from row 1 (first non-empty)
    expect(g.attrs.project).toBe('ProjectA');
    // title from row 2 (row 1 had undefined)
    expect(g.attrs.title).toBe('The Title');
    // caseStatus from row 1
    expect(g.attrs.caseStatus).toBe('Active');
  });
});

describe('groupRows — AC-CYCLE-GROUP-005: case-insensitive grouping key with original caseRef preserved', () => {
  it('groups rows with same caseRef differing only in case', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'case-001', type: 'VI', rowNumber: 1 }),
      row({ caseRef: 'CASE-001', type: 'Payment', rowNumber: 2 }),
    ];
    const { groups } = groupRows(rows);
    expect(groups).toHaveLength(1);
    // original caseRef (first seen) is preserved for display
    expect(groups[0].caseRef).toBe('case-001');
    expect(groups[0].rows).toHaveLength(2);
  });
});
