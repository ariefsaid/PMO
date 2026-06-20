/**
 * Unit tests for buildLedgerRows (AC-PR-LEDGER-001..009)
 *
 * Pure function — no mocks needed. Covers:
 *   - Chronological order (newest-first, descending by business date)
 *   - All 7 record types contribute rows
 *   - Empty record types omit rows (de-dup contract)
 *   - Multiple records per phase all appear
 *   - PO-less case: Payment row with no PO row
 *   - financial flag correctness (PR / Quote / PO / Invoice / Payment = true; RFQ / GR = false)
 *   - business-date extraction per type (date vs receipt_date vs invoice_date vs received_date)
 *   - dual-ID fields (systemNumber + externalRef)
 */
import { describe, it, expect } from 'vitest';
import { buildLedgerRows } from './procurementLedger';
import type { ProcurementDetail } from './procurementLifecycle';
import type { Tables } from '@/src/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// Minimal ProcurementDetail factory — only the ledger-relevant fields.
// Uses `unknown` cast for test fixtures since we supply only the fields the
// pure function actually reads (the DB row type has more required columns that
// are not relevant to ledger behaviour).
// ---------------------------------------------------------------------------

function makeDetail(overrides: Record<string, unknown> = {}): ProcurementDetail {
  return {
    id: 'proc-1',
    org_id: 'org-1',
    title: 'Test Procurement',
    status: 'Paid',
    code: 'PROC-001',
    created_at: '2026-01-01T00:00:00Z',
    total_value: 100000,
    pr_number: null,
    vq_number: null,
    po_number: null,
    project_id: null,
    vendor_id: null,
    requested_by_id: null,
    approved_by_id: null,
    approval_notes: null,
    rejection_notes: null,
    project: null,
    vendor: null,
    requested_by: null,
    approved_by: null,
    items: [],
    quotations: [],
    receipts: [],
    invoices: [],
    purchase_requests: [],
    rfqs: [],
    purchase_orders: [],
    payments: [],
    statusEvents: [],
    ...overrides,
  } as unknown as ProcurementDetail;
}

// Typed helpers for each record collection (only fields buildLedgerRows actually reads)
type PRRow = Pick<Tables<'purchase_requests'>, 'id' | 'org_id' | 'procurement_id' | 'pr_number' | 'reference_number' | 'status' | 'date' | 'amount' | 'created_at'>;
type RfqRow = Pick<Tables<'rfqs'>, 'id' | 'org_id' | 'procurement_id' | 'rfq_number' | 'reference_number' | 'status' | 'date' | 'amount' | 'created_at'>;
type QuotRow = Pick<Tables<'procurement_quotations'>, 'id' | 'org_id' | 'procurement_id' | 'vq_number' | 'vendor_id' | 'total_amount' | 'received_date' | 'is_selected' | 'reference'>;
type PORow = Pick<Tables<'purchase_orders'>, 'id' | 'org_id' | 'procurement_id' | 'po_number' | 'reference_number' | 'status' | 'date' | 'amount' | 'created_at'>;
type GRRow = Pick<Tables<'procurement_receipts'>, 'id' | 'org_id' | 'procurement_id' | 'gr_number' | 'status' | 'receipt_date' | 'created_at' | 'po_id' | 'reference_number'>;
type VIRow = Pick<Tables<'procurement_invoices'>, 'id' | 'org_id' | 'procurement_id' | 'vi_number' | 'status' | 'invoice_date' | 'created_at' | 'po_id' | 'reference_number' | 'amount'>;
type PayRow = Pick<Tables<'payments'>, 'id' | 'org_id' | 'procurement_id' | 'pay_number' | 'reference_number' | 'status' | 'date' | 'amount' | 'invoice_id' | 'created_at'>;

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-001: empty detail → empty ledger
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-001: empty detail produces empty ledger', () => {
  it('returns [] when all record arrays are empty', () => {
    const rows = buildLedgerRows(makeDetail());
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-002: all 7 record types produce ledger rows
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-002: all 7 record types each produce a row', () => {
  it('produces one row per non-empty record type', () => {
    const pr: PRRow = {
      id: 'pr-1', org_id: 'org-1', procurement_id: 'proc-1',
      pr_number: 'PR-2026-0001', reference_number: 'EXT-PR-1',
      status: 'Approved', date: '2026-04-28', amount: 486000, created_at: '2026-04-28T08:00:00Z',
    };
    const rfq: RfqRow = {
      id: 'rfq-1', org_id: 'org-1', procurement_id: 'proc-1',
      rfq_number: 'RFQ-2026-0001', reference_number: 'RFQ/EXT/001',
      status: 'Closed', date: '2026-04-30', amount: null, created_at: '2026-04-30T08:00:00Z',
    };
    const vq: QuotRow = {
      id: 'vq-1', org_id: 'org-1', procurement_id: 'proc-1',
      vq_number: 'VQ-2026-0001', vendor_id: 'v-1',
      total_amount: 478500, received_date: '2026-05-04', is_selected: true, reference: null,
    };
    const po: PORow = {
      id: 'po-1', org_id: 'org-1', procurement_id: 'proc-1',
      po_number: 'PO-2026-0001', reference_number: 'PO/EXT/001',
      status: 'Issued', date: '2026-05-06', amount: 478500, created_at: '2026-05-06T08:00:00Z',
    };
    const gr: GRRow = {
      id: 'gr-1', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-2026-0001', status: 'Complete',
      receipt_date: '2026-05-11', created_at: '2026-05-11T08:00:00Z', po_id: null,
      reference_number: null,
    };
    const vi: VIRow = {
      id: 'vi-1', org_id: 'org-1', procurement_id: 'proc-1',
      vi_number: 'VI-2026-0001', status: 'Received',
      invoice_date: '2026-05-12', created_at: '2026-05-12T08:00:00Z', po_id: null,
      reference_number: null, amount: null,
    };
    const pay: PayRow = {
      id: 'pay-1', org_id: 'org-1', procurement_id: 'proc-1',
      pay_number: 'PAY-2026-0001', reference_number: 'TT-001',
      status: 'Cleared', date: '2026-05-14', amount: 478500,
      invoice_id: 'vi-1', created_at: '2026-05-14T08:00:00Z',
    };

    const detail = makeDetail({
      purchase_requests: [pr],
      rfqs: [rfq],
      quotations: [vq],
      purchase_orders: [po],
      receipts: [gr],
      invoices: [vi],
      payments: [pay],
    });

    const rows = buildLedgerRows(detail);
    expect(rows).toHaveLength(7);

    const types = rows.map((r) => r.type);
    expect(types).toContain('PR');
    expect(types).toContain('RFQ');
    expect(types).toContain('Quote');
    expect(types).toContain('PO');
    expect(types).toContain('GR');
    expect(types).toContain('Invoice');
    expect(types).toContain('Payment');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-003: chronological order — newest first
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-003: rows sorted newest-first', () => {
  it('orders rows descending by business date', () => {
    const pr: PRRow = {
      id: 'pr-1', org_id: 'org-1', procurement_id: 'proc-1',
      pr_number: 'PR-001', reference_number: null,
      status: 'Approved', date: '2026-04-28', amount: 100000, created_at: '2026-04-28T08:00:00Z',
    };
    const pay: PayRow = {
      id: 'pay-1', org_id: 'org-1', procurement_id: 'proc-1',
      pay_number: 'PAY-001', reference_number: 'TT-001',
      status: 'Cleared', date: '2026-05-14', amount: 90000,
      invoice_id: null, created_at: '2026-05-14T08:00:00Z',
    };

    const detail = makeDetail({ purchase_requests: [pr], payments: [pay] });
    const rows = buildLedgerRows(detail);
    expect(rows).toHaveLength(2);
    // Newest first: Payment (May 14) before PR (Apr 28)
    expect(rows[0].type).toBe('Payment');
    expect(rows[1].type).toBe('PR');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-004: empty types omit rows (the de-dup contract)
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-004: empty record types omit rows', () => {
  it('only PO rows appear when other types are empty', () => {
    const po: PORow = {
      id: 'po-1', org_id: 'org-1', procurement_id: 'proc-1',
      po_number: 'PO-001', reference_number: 'EXT-PO-1',
      status: 'Issued', date: '2026-05-06', amount: 50000, created_at: '2026-05-06T08:00:00Z',
    };

    const detail = makeDetail({ purchase_orders: [po] });
    const rows = buildLedgerRows(detail);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('PO');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-005: multiple records per phase all appear
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-005: multiple records per phase all appear', () => {
  it('two GRs each produce their own row', () => {
    const gr1: GRRow = {
      id: 'gr-1', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-001', status: 'Partial',
      receipt_date: '2026-05-11', created_at: '2026-05-11T08:00:00Z', po_id: null,
      reference_number: null,
    };
    const gr2: GRRow = {
      id: 'gr-2', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-002', status: 'Complete',
      receipt_date: '2026-05-15', created_at: '2026-05-15T08:00:00Z', po_id: null,
      reference_number: null,
    };

    const detail = makeDetail({ receipts: [gr1, gr2] });
    const rows = buildLedgerRows(detail);
    expect(rows).toHaveLength(2);
    const systemNos = rows.map((r) => r.systemNumber);
    expect(systemNos).toContain('GR-001');
    expect(systemNos).toContain('GR-002');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-006: PO-less case — Payment row exists with no PO row
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-006: PO-less case', () => {
  it('Payment row appears without a PO row in the ledger', () => {
    const vi: VIRow = {
      id: 'vi-1', org_id: 'org-1', procurement_id: 'proc-1',
      vi_number: 'VI-001', status: 'Received',
      invoice_date: '2026-05-12', created_at: '2026-05-12T08:00:00Z', po_id: null,
      reference_number: null, amount: null,
    };
    const pay: PayRow = {
      id: 'pay-1', org_id: 'org-1', procurement_id: 'proc-1',
      pay_number: 'PAY-001', reference_number: null,
      status: 'Cleared', date: '2026-05-14', amount: 90000,
      invoice_id: 'vi-1', created_at: '2026-05-14T08:00:00Z',
    };

    const detail = makeDetail({ invoices: [vi], payments: [pay] });
    const rows = buildLedgerRows(detail);
    const types = rows.map((r) => r.type);
    expect(types).toContain('Payment');
    expect(types).not.toContain('PO');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-007: financial flag correctness
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-007: financial flag', () => {
  it('PR, Quote, PO, Invoice, Payment are financial=true; RFQ and GR are false', () => {
    const pr: PRRow = {
      id: 'pr-1', org_id: 'org-1', procurement_id: 'proc-1',
      pr_number: 'PR-001', reference_number: null,
      status: 'Approved', date: '2026-04-28', amount: 100000, created_at: '2026-04-28T08:00:00Z',
    };
    const rfq: RfqRow = {
      id: 'rfq-1', org_id: 'org-1', procurement_id: 'proc-1',
      rfq_number: 'RFQ-001', reference_number: null,
      status: 'Closed', date: '2026-04-30', amount: null, created_at: '2026-04-30T08:00:00Z',
    };
    const vq: QuotRow = {
      id: 'vq-1', org_id: 'org-1', procurement_id: 'proc-1',
      vq_number: 'VQ-001', vendor_id: 'v-1',
      total_amount: 90000, received_date: '2026-05-04', is_selected: true, reference: null,
    };
    const po: PORow = {
      id: 'po-1', org_id: 'org-1', procurement_id: 'proc-1',
      po_number: 'PO-001', reference_number: null,
      status: 'Issued', date: '2026-05-06', amount: 90000, created_at: '2026-05-06T08:00:00Z',
    };
    const gr: GRRow = {
      id: 'gr-1', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-001', status: 'Complete',
      receipt_date: '2026-05-11', created_at: '2026-05-11T08:00:00Z', po_id: null,
      reference_number: null,
    };
    const vi: VIRow = {
      id: 'vi-1', org_id: 'org-1', procurement_id: 'proc-1',
      vi_number: 'VI-001', status: 'Received',
      invoice_date: '2026-05-12', created_at: '2026-05-12T08:00:00Z', po_id: null,
      reference_number: null, amount: null,
    };
    const pay: PayRow = {
      id: 'pay-1', org_id: 'org-1', procurement_id: 'proc-1',
      pay_number: 'PAY-001', reference_number: null,
      status: 'Cleared', date: '2026-05-14', amount: 90000,
      invoice_id: 'vi-1', created_at: '2026-05-14T08:00:00Z',
    };

    const detail = makeDetail({
      purchase_requests: [pr],
      rfqs: [rfq],
      quotations: [vq],
      purchase_orders: [po],
      receipts: [gr],
      invoices: [vi],
      payments: [pay],
    });

    const rows = buildLedgerRows(detail);
    const byType = Object.fromEntries(rows.map((r) => [r.type, r.financial]));

    expect(byType['PR']).toBe(true);
    expect(byType['RFQ']).toBe(false);
    expect(byType['Quote']).toBe(true);
    expect(byType['PO']).toBe(true);
    expect(byType['GR']).toBe(false);
    expect(byType['Invoice']).toBe(true);
    expect(byType['Payment']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-008: business-date extraction per type
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-008: business date uses type-specific date field', () => {
  it('GR uses receipt_date, Invoice uses invoice_date, Quote uses received_date', () => {
    const gr: GRRow = {
      id: 'gr-1', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-001', status: 'Complete',
      receipt_date: '2026-05-11', created_at: '2026-05-11T08:00:00Z', po_id: null,
      reference_number: null,
    };
    const vi: VIRow = {
      id: 'vi-1', org_id: 'org-1', procurement_id: 'proc-1',
      vi_number: 'VI-001', status: 'Received',
      invoice_date: '2026-05-12', created_at: '2026-05-12T08:00:00Z', po_id: null,
      reference_number: null, amount: null,
    };
    const vq: QuotRow = {
      id: 'vq-1', org_id: 'org-1', procurement_id: 'proc-1',
      vq_number: 'VQ-001', vendor_id: 'v-1',
      total_amount: 50000, received_date: '2026-05-04', is_selected: false, reference: null,
    };

    const detail = makeDetail({ receipts: [gr], invoices: [vi], quotations: [vq] });
    const rows = buildLedgerRows(detail);
    const grRow = rows.find((r) => r.type === 'GR');
    const viRow = rows.find((r) => r.type === 'Invoice');
    const vqRow = rows.find((r) => r.type === 'Quote');

    expect(grRow?.date).toBe('2026-05-11');
    expect(viRow?.date).toBe('2026-05-12');
    expect(vqRow?.date).toBe('2026-05-04');
  });

  it('falls back to created_at when business date is null (GR case)', () => {
    const gr: GRRow = {
      id: 'gr-1', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-001', status: 'Complete',
      receipt_date: null, created_at: '2026-05-11T08:00:00Z', po_id: null,
      reference_number: null,
    };

    const detail = makeDetail({ receipts: [gr] });
    const rows = buildLedgerRows(detail);
    expect(rows[0].date).toBe('2026-05-11T08:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-009: dual-ID fields
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-009: dual-ID fields in each row', () => {
  it('systemNumber and externalRef are both present on a PO row', () => {
    const po: PORow = {
      id: 'po-1', org_id: 'org-1', procurement_id: 'proc-1',
      po_number: 'PO-2026-0077', reference_number: 'PO/MER/0077',
      status: 'Issued', date: '2026-05-06', amount: 478500, created_at: '2026-05-06T08:00:00Z',
    };

    const detail = makeDetail({ purchase_orders: [po] });
    const rows = buildLedgerRows(detail);
    expect(rows[0].systemNumber).toBe('PO-2026-0077');
    expect(rows[0].externalRef).toBe('PO/MER/0077');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-015: Quote externalRef populates from procurement_quotations.reference
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-015: Quote externalRef + amount from procurement_quotations', () => {
  it('populates externalRef from vq.reference and amount from vq.total_amount', () => {
    const vq: QuotRow = {
      id: 'vq-1', org_id: 'org-1', procurement_id: 'proc-1',
      vq_number: 'VQ-2026-0001', vendor_id: 'v-1',
      reference: 'VENDOR-QUOTE-007',
      total_amount: 478500, received_date: '2026-05-04', is_selected: true,
    };

    const detail = makeDetail({ quotations: [vq] });
    const rows = buildLedgerRows(detail);
    const quoteRow = rows.find((r) => r.type === 'Quote');
    expect(quoteRow?.externalRef).toBe('VENDOR-QUOTE-007');
    expect(quoteRow?.amount).toBe(478500);
  });

  it('externalRef is null when vq.reference is null', () => {
    const vq: QuotRow = {
      id: 'vq-1', org_id: 'org-1', procurement_id: 'proc-1',
      vq_number: 'VQ-2026-0001', vendor_id: 'v-1',
      total_amount: 478500, received_date: '2026-05-04', is_selected: false, reference: null,
    };

    const detail = makeDetail({ quotations: [vq] });
    const rows = buildLedgerRows(detail);
    const quoteRow = rows.find((r) => r.type === 'Quote');
    expect(quoteRow?.externalRef).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-016: GR externalRef populates from procurement_receipts.reference_number
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-016: GR externalRef from procurement_receipts.reference_number', () => {
  it('populates externalRef from gr.reference_number; amount stays null (non-financial)', () => {
    const gr: GRRow & { reference_number?: string | null } = {
      id: 'gr-1', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-2026-0001', status: 'Complete',
      receipt_date: '2026-05-11', created_at: '2026-05-11T08:00:00Z', po_id: null,
      reference_number: 'DN-44120',
    };

    const detail = makeDetail({ receipts: [gr] });
    const rows = buildLedgerRows(detail);
    const grRow = rows.find((r) => r.type === 'GR');
    expect(grRow?.externalRef).toBe('DN-44120');
    expect(grRow?.amount).toBeNull();
  });

  it('externalRef is null when gr.reference_number is null', () => {
    const gr: GRRow = {
      id: 'gr-1', org_id: 'org-1', procurement_id: 'proc-1',
      gr_number: 'GR-2026-0001', status: 'Complete',
      receipt_date: '2026-05-11', created_at: '2026-05-11T08:00:00Z', po_id: null,
      reference_number: null,
    };

    const detail = makeDetail({ receipts: [gr] });
    const rows = buildLedgerRows(detail);
    const grRow = rows.find((r) => r.type === 'GR');
    expect(grRow?.externalRef).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-PR-LEDGER-017: VI externalRef + amount from procurement_invoices
// ---------------------------------------------------------------------------

describe('AC-PR-LEDGER-017: VI externalRef + amount from procurement_invoices', () => {
  it('populates externalRef + amount from vi.reference_number / vi.amount', () => {
    const vi: VIRow = {
      id: 'vi-1', org_id: 'org-1', procurement_id: 'proc-1',
      vi_number: 'VI-2026-0001', status: 'Received',
      invoice_date: '2026-05-12', created_at: '2026-05-12T08:00:00Z', po_id: null,
      reference_number: 'INV-SF-2291',
      amount: 478500,
    };

    const detail = makeDetail({ invoices: [vi] });
    const rows = buildLedgerRows(detail);
    const viRow = rows.find((r) => r.type === 'Invoice');
    expect(viRow?.externalRef).toBe('INV-SF-2291');
    expect(viRow?.amount).toBe(478500);
  });

  it('both null when vi.reference_number and vi.amount are null', () => {
    const vi: VIRow = {
      id: 'vi-1', org_id: 'org-1', procurement_id: 'proc-1',
      vi_number: 'VI-2026-0001', status: 'Received',
      invoice_date: '2026-05-12', created_at: '2026-05-12T08:00:00Z', po_id: null,
      reference_number: null, amount: null,
    };

    const detail = makeDetail({ invoices: [vi] });
    const rows = buildLedgerRows(detail);
    const viRow = rows.find((r) => r.type === 'Invoice');
    expect(viRow?.externalRef).toBeNull();
    expect(viRow?.amount).toBeNull();
  });
});
