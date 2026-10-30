import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeCaseImportKey, computeRecordImportKey, computeLegacyRecordImportKey, projectRecordFacts } from '../importKey';
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
    expect(computeLegacyRecordImportKey(row)).toBe('PO-VENDOR-4471');
  });

  it('falls back to a deterministic content fingerprint of type+date+amount+vendor when externalRef is absent', () => {
    const row: CycleRow = {
      ...baseRow, externalRef: undefined, date: '2025-06-01', amount: '1500', vendor: 'Acme',
    };
    const key = computeLegacyRecordImportKey(row);
    expect(key).toBe(computeLegacyRecordImportKey({ ...row })); // deterministic — same input, same key
    expect(key).not.toBe(computeLegacyRecordImportKey({ ...row, amount: '1600' })); // sensitive to amount
  });
});

describe('versioned creation identity', () => {
  const row: CycleRow = {
    caseRef: 'C', type: 'PO', project: undefined, title: undefined, caseStatus: undefined,
    vendor: undefined, externalRef: 'fp:PO|||', status: undefined, date: undefined,
    amount: undefined, rowNumber: 1,
  };
  it('separates literal legacy-looking references from reference-free facts', () => {
    expect(computeRecordImportKey(row, [null, 'Draft', null, null])).toBe('pcy2:["r","fp:PO|||"]');
    expect(computeRecordImportKey({ ...row, externalRef: undefined }, [null, 'Draft', null, null]))
      .toBe('pcy2:["f",[null,"Draft",null,null]]');
  });
});

  it('uses the invoice tax amount as a creation fact', () => {
    const row: CycleRow = {
      caseRef: 'C', type: 'VI', project: undefined, title: undefined, caseStatus: undefined,
      vendor: undefined, externalRef: 'VI', status: 'Received', date: '2026-01-02',
      amount: '100', taxTreatment: 'exclusive', taxAmount: '10', rowNumber: 1,
    };
    expect(projectRecordFacts(row, null, null)).toEqual(['VI', 'Received', '2026-01-02', '100.00', 'exclusive', '10.00']);
  });

  it('matches shared database creation vectors for each app writer', () => {
    const sql = readFileSync(new URL('../../../../../../supabase/tests/0399_procurement_import_identity.test.sql', import.meta.url), 'utf8');
    const vectors = JSON.parse(sql.split('$vectors$')[1]) as Array<{ type: string; input: Record<string, string | null>; facts: (string | null)[] }>;
    const types: Record<string, string> = { pr: 'PR', rfq: 'RFQ', po: 'PO', quotation: 'Quotation', receipt: 'GR', invoice: 'VI', payment: 'Payment' };
    for (const vector of vectors.filter(v => v.type in types)) {
      const input = vector.input;
      const row: CycleRow = { caseRef: 'C', type: types[vector.type], project: undefined, title: undefined, caseStatus: undefined, vendor: undefined,
        externalRef: input.reference_number ?? undefined, status: input.status ?? undefined, date: input.date ?? input.received_date ?? input.receipt_date ?? input.invoice_date ?? undefined,
        amount: input.amount ?? input.total_amount ?? undefined, taxTreatment: input.tax_treatment ?? undefined, taxAmount: input.tax_amount ?? undefined, rowNumber: 1 };
      expect(projectRecordFacts(row, input.vendor_id ?? null, input.invoice_id ?? null), vector.type).toEqual(vector.facts);
    }
  });

  it('rejects nonrepresentable amounts instead of rounding creation facts', () => {
    const row: CycleRow = { caseRef: 'C', type: 'VI', project: undefined, title: undefined, caseStatus: undefined, vendor: undefined, externalRef: undefined, status: 'Received', date: '2026-01-02', amount: '1.234', taxTreatment: 'exclusive', taxAmount: '0', rowNumber: 1 };
    expect(() => projectRecordFacts(row, null, null)).toThrow();
  });

it('keeps the calculated-tax vector scoped to the server path that supplies a rate', () => {
  const sql = readFileSync(new URL('../../../../../../supabase/tests/0399_procurement_import_identity.test.sql', import.meta.url), 'utf8');
  const vector = (JSON.parse(sql.split('$vectors$')[1]) as Array<{ type: string; input: Record<string, string>; facts: (string | null)[] }>).find(item => item.type === 'invoice_calculated')!;
  const row: CycleRow = { caseRef: 'C', type: 'VI', project: undefined, title: undefined, caseStatus: undefined, vendor: undefined,
    externalRef: vector.input.reference_number, status: vector.input.status, date: vector.input.invoice_date,
    amount: vector.input.amount, taxTreatment: vector.input.tax_treatment, taxAmount: vector.input.tax_amount, rowNumber: 1 };
  expect(vector.input.tax_rate).toBe('10.000');
  expect(vector.facts[5]).toBe('10.00');
  expect(projectRecordFacts(row, null, null)[5]).toBe('0.00');
});

it('encodes literal namespaces, delimiters and escapes without colliding', () => {
  const row: CycleRow = { caseRef: 'C', type: 'PO', project: undefined, title: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'pcy2:["f",[null]]|字\\', status: undefined, date: undefined, amount: undefined, rowNumber: 1 };
  const facts = [null, 'Draft', null, null];
  expect(computeRecordImportKey(row, facts)).toBe(`pcy2:${JSON.stringify(['r', row.externalRef])}`);
  expect(computeRecordImportKey(row, facts)).not.toBe(computeRecordImportKey({ ...row, externalRef: undefined }, facts));
  expect(computeLegacyRecordImportKey(row)).toBe(row.externalRef);
});

it('projects normalized invoice amount and tax into the same fixed-scale facts as the write', () => {
  const row: CycleRow = { caseRef: 'C', type: 'VI', project: undefined, title: undefined, caseStatus: undefined, vendor: undefined, externalRef: undefined, status: 'Received', date: '2026-01-02', amount: '1234.5600000000002', taxTreatment: 'exclusive', taxAmount: '0.30000000000000004', rowNumber: 1 };
  expect(projectRecordFacts(row, null, null)).toEqual([null, 'Received', '2026-01-02', '1234.56', 'exclusive', '0.30']);
});
