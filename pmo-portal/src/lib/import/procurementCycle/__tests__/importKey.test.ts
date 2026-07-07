import { describe, it, expect } from 'vitest';
import { computeCaseImportKey, computeRecordImportKey } from '../importKey';
import type { CaseGroup, CycleRow } from '../types';

describe('computeCaseImportKey — FR-IDEM-002 (per-case stable key)', () => {
  it('derives the key from caseRef when present (AC: caseRef is the stable grouping key)', () => {
    const group: CaseGroup = {
      caseRef: 'CASE-001',
      attrs: { title: 'Solar Modules', project: 'Meridian', caseStatus: undefined },
      rows: [],
      errors: [],
    };
    expect(computeCaseImportKey(group)).toBe('CASE-001');
  });
});

describe('computeRecordImportKey — FR-IDEM-002 (per-record stable key, reference_number-first)', () => {
  const baseRow: CycleRow = {
    caseRef: 'CASE-001', type: 'PO', project: undefined, title: undefined, caseStatus: undefined,
    vendor: undefined, externalRef: undefined, status: undefined, date: undefined, amount: undefined,
    rowNumber: 1,
  };

  it('uses externalRef (reference_number) as the key when present', () => {
    const row: CycleRow = { ...baseRow, externalRef: 'PO-VENDOR-4471' };
    expect(computeRecordImportKey(row)).toBe('PO-VENDOR-4471');
  });

  it('falls back to a deterministic content fingerprint of type+date+amount+vendor when externalRef is absent', () => {
    const row: CycleRow = {
      ...baseRow, externalRef: undefined, date: '2025-06-01', amount: '1500', vendor: 'Acme',
    };
    const key = computeRecordImportKey(row);
    expect(key).toBe(computeRecordImportKey({ ...row })); // deterministic — same input, same key
    expect(key).not.toBe(computeRecordImportKey({ ...row, amount: '1600' })); // sensitive to amount
  });
});
