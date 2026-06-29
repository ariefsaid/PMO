import { describe, it, expect } from 'vitest';
import { validateGroups } from '../validate';
import { groupRows } from '../group';
import { makeRefLookup } from '@/src/lib/import/refLookup';
import type { CycleRow, CaseGroup } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const projectLookup = makeRefLookup(
  [{ id: 'proj-1', name: 'Solar EPC' }],
  'Project',
);
const vendorLookup = makeRefLookup(
  [
    { id: 'vend-1', name: 'Acme Supplies' },
    { id: 'vend-2', name: 'Acme Supplies' }, // duplicate — ambiguous
  ],
  'Vendor',
);
const vendorLookupOk = makeRefLookup(
  [{ id: 'vend-1', name: 'Acme Supplies' }],
  'Vendor',
);

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

function makeGroup(rows: CycleRow[]): CaseGroup {
  const { groups } = groupRows(rows);
  return groups[0];
}

// ─── AC-CYCLE-VAL-001: Model-C legality (VI+Payment-only case is VALID) ──────

describe('validateGroups — AC-CYCLE-VAL-001: Model-C VI+Payment-only case is valid', () => {
  it('a case with only VI+Payment rows (no PR/PO) is valid when required fields are present', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-MC',
        type: 'VI',
        title: 'Legacy Invoice',
        project: 'Solar EPC',
        status: 'Received',
        date: '2025-01-15',
        amount: '5000',
        rowNumber: 1,
      }),
      row({
        caseRef: 'CASE-MC',
        type: 'Payment',
        status: 'Paid',
        date: '2025-02-01',
        amount: '5000',
        rowNumber: 2,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.valid).toBe(true);
    expect(result.groupErrors).toHaveLength(0);
    expect(result.rows[0].valid).toBe(true);
    expect(result.rows[1].valid).toBe(true);
  });
});

// ─── AC-CYCLE-VAL-002: Required-field matrix per type ────────────────────────

describe('validateGroups — AC-CYCLE-VAL-002: PR required fields', () => {
  it('a PR row with no date and no status still passes (both optional for PR)', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'C1', type: 'PR', title: 'A PR Case', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    // PR: no required per-row fields beyond what the group-level check demands
    expect(result.rows[0].valid).toBe(true);
  });
});

describe('validateGroups — AC-CYCLE-VAL-003: Quotation required fields', () => {
  it('Quotation row requires vendor, amount, and date', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'C2', type: 'Quotation', title: 'A Quotation Case', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    const errs = result.rows[0].errors.join(' ');
    expect(errs).toMatch(/vendor/i);
    expect(errs).toMatch(/amount/i);
    expect(errs).toMatch(/date/i);
  });

  it('Quotation row with valid vendor, amount, date passes', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'C3',
        type: 'Quotation',
        title: 'Quotation OK',
        vendor: 'Acme Supplies',
        amount: '1500.00',
        date: '2025-03-10',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(true);
  });
});

describe('validateGroups — AC-CYCLE-VAL-004: GR required fields', () => {
  it('GR row requires status (Partial|Complete) and date', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'C4', type: 'GR', title: 'GR Case', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    const errs = result.rows[0].errors.join(' ');
    expect(errs).toMatch(/status/i);
    expect(errs).toMatch(/date/i);
  });

  it('GR row with invalid status value is invalid', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'C5', type: 'GR', title: 'GR Case', status: 'Done', date: '2025-04-01', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/Partial|Complete/);
  });

  it('GR row with valid Partial status and date is valid', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'C6', type: 'GR', title: 'GR Case', status: 'Partial', date: '2025-04-01', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(true);
  });
});

describe('validateGroups — AC-CYCLE-VAL-005: VI required fields', () => {
  it('VI row requires status (Received|Scheduled|Paid) and date', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'C7', type: 'VI', title: 'VI Case', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    const errs = result.rows[0].errors.join(' ');
    expect(errs).toMatch(/status/i);
    expect(errs).toMatch(/date/i);
  });

  it('VI row with bad status "InvoiceReceived" is invalid', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'C8', type: 'VI', title: 'VI Case', status: 'InvoiceReceived', date: '2025-05-01', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
  });
});

// ─── AC-CYCLE-VAL-006: Unresolved project → row error ────────────────────────

describe('validateGroups — AC-CYCLE-VAL-006: unresolved project → row error', () => {
  it('a non-empty project that does not match any known project produces a row error', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-P',
        type: 'PR',
        title: 'PR with bad project',
        project: 'Unknown Project XYZ',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    // The row itself fails because the project can't be resolved
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/not found/i);
  });
});

// ─── AC-CYCLE-VAL-007: Ambiguous vendor → row error ──────────────────────────

describe('validateGroups — AC-CYCLE-VAL-007: ambiguous vendor → row error', () => {
  it('a Quotation row with an ambiguous vendor name produces a row error', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-V',
        type: 'Quotation',
        title: 'Ambiguous Vendor',
        vendor: 'Acme Supplies', // duplicate in vendorLookup → ambiguous
        amount: '1000',
        date: '2025-06-01',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/ambiguous/i);
  });
});

// ─── AC-CYCLE-VAL-008: Negative amount → error ───────────────────────────────

describe('validateGroups — AC-CYCLE-VAL-008: negative amount → error', () => {
  it('a VI row with negative amount is invalid', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-NEG',
        type: 'VI',
        title: 'Negative Amount',
        status: 'Received',
        date: '2025-01-01',
        amount: '-100',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/amount/i);
  });

  it('a non-numeric amount string is invalid', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-NAN',
        type: 'VI',
        title: 'NaN Amount',
        status: 'Received',
        date: '2025-01-01',
        amount: 'not-a-number',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/amount/i);
  });
});

// ─── AC-CYCLE-VAL-009: Group-level: no title AND no project → group error ────

describe('validateGroups — AC-CYCLE-VAL-009: group must have title or project', () => {
  it('a group with no title and no project produces a group error', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'CASE-EMPTY', type: 'PR', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.groupErrors.length).toBeGreaterThan(0);
    expect(result.valid).toBe(false);
    expect(result.groupErrors.join(' ')).toMatch(/title|project/i);
  });

  it('a group with only a project (no title) passes the group check', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'CASE-PROJ-ONLY', type: 'PR', project: 'Solar EPC', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.groupErrors).toHaveLength(0);
  });

  it('a group with only a title (no project) passes the group check', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'CASE-TITLE-ONLY', type: 'PR', title: 'My PR', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.groupErrors).toHaveLength(0);
  });
});

// ─── AC-CYCLE-VAL-010: bad date → row error ──────────────────────────────────

describe('validateGroups — AC-CYCLE-VAL-010: bad date → row error', () => {
  it('a VI row with an unparseable date string is invalid', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-DATE',
        type: 'VI',
        title: 'Bad Date',
        status: 'Received',
        date: 'not-a-date',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/date/i);
  });
});

// ─── AC-CYCLE-VAL-011: calendrically-impossible dates rejected (B6) ───────────

describe('validateGroups — AC-CYCLE-VAL-011: calendrically-impossible dates are rejected', () => {
  it('rejects 2025-13-45 (month 13 does not exist)', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-BADDATE1',
        type: 'GR',
        title: 'Bad Calendar Date',
        status: 'Partial',
        date: '2025-13-45',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/date/i);
  });

  it('rejects 2025-02-30 (February has no 30th)', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-BADDATE2',
        type: 'GR',
        title: 'Feb 30',
        status: 'Partial',
        date: '2025-02-30',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/date/i);
  });

  it('accepts 2025-03-15 (valid calendar date)', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-GOODDATE',
        type: 'GR',
        title: 'Good Date',
        status: 'Complete',
        date: '2025-03-15',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(true);
  });
});

// ─── AC-CYCLE-VAL-012: validateOptionalDate skips blank, validates non-blank (B7) ─

describe('validateGroups — AC-CYCLE-VAL-012: optional dates validated on non-blank', () => {
  it('PR row with no date passes (blank optional date is fine)', () => {
    const rows: CycleRow[] = [
      row({ caseRef: 'CASE-OPT-OK', type: 'PR', title: 'Optional Date OK', rowNumber: 1 }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(true);
  });

  it('PR row with a calendrically-impossible optional date is rejected', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-OPT-BAD',
        type: 'PR',
        title: 'Optional Date Bad',
        date: '2025-13-01',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/date/i);
  });

  it('Payment row with a calendrically-impossible optional date is rejected', () => {
    const rows: CycleRow[] = [
      row({
        caseRef: 'CASE-PAY-BAD',
        type: 'Payment',
        title: 'Payment Bad Date',
        date: '2025-02-30',
        rowNumber: 1,
      }),
    ];
    const group = makeGroup(rows);
    const [result] = validateGroups([group], { projectLookup, vendorLookup: vendorLookupOk });
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].errors.join(' ')).toMatch(/date/i);
  });
});
