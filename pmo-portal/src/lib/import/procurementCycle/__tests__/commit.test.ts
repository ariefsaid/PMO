import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRefLookup } from '@/src/lib/import/refLookup';
import type { ValidatedGroup } from '../types';

// SECURITY (2026-07-27 review round 2 #2): a bulk commit run must NOT fire one `save_failed`
// event per failed case/record — mock the analytics facade to assert the aggregate shape.
type Analytics = typeof import('@/src/lib/analytics');
const analytics = vi.hoisted(() => ({
  trackSaveFailed: vi.fn<Analytics['trackSaveFailed']>(),
  trackBulkImportFailed: vi.fn<Analytics['trackBulkImportFailed']>(),
}));
vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...await importOriginal<Analytics>(),
  ...analytics,
} satisfies Analytics));

// ─── Mock the DB create functions ─────────────────────────────────────────────

vi.mock('@/src/lib/db/procurementCrud', () => ({
  createProcurement: vi.fn(),
}));

vi.mock('@/src/lib/db/procurementRecords', () => ({
  createPurchaseRequest: vi.fn(),
  createRfq: vi.fn(),
  createPurchaseOrder: vi.fn(),
  createPayment: vi.fn(),
}));

vi.mock('@/src/lib/db/procurementLifecycle', () => ({
  createQuotation: vi.fn(),
  createReceipt: vi.fn(),
  createInvoice: vi.fn(),
}));

import { commitGroups } from '../commit';
import { createProcurement } from '@/src/lib/db/procurementCrud';
import { createPurchaseRequest, createRfq, createPurchaseOrder, createPayment } from '@/src/lib/db/procurementRecords';
import { createInvoice } from '@/src/lib/db/procurementLifecycle';
import { groupRows } from '../group';
import { validateGroups } from '../validate';
import type { CycleRow } from '../types';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

afterEach(() => resetActiveLocale());

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const projectLookup = makeRefLookup([{ id: 'proj-1', name: 'Solar EPC' }], 'Project');
const vendorLookup = makeRefLookup([{ id: 'vend-1', name: 'Acme Supplies' }], 'Vendor');

const REQUESTER = 'user-abc';

// ─── AC-CYCLE-COMMIT-001: VI+Payment case → payment.invoiceId = VI id ─────────

describe('commitGroups — AC-CYCLE-COMMIT-001: VI+Payment settlement FK', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets payment.invoiceId to the created VI id within the same group', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-1' } as never);
    vi.mocked(createInvoice).mockResolvedValue({ id: 'inv-1' } as never);
    vi.mocked(createPayment).mockResolvedValue({ id: 'pay-1' } as never);

    const group: ValidatedGroup = {
      valid: true,
      groupErrors: [],
      group: {
        caseRef: 'CASE-MC',
        attrs: { title: 'Legacy Invoice', project: 'Solar EPC', caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-MC', type: 'VI', title: 'Legacy Invoice', project: 'Solar EPC',
            caseStatus: undefined, vendor: undefined, externalRef: 'EXT-001',
            status: 'Received', date: '2025-01-15', amount: '5000',
            // #505: validate.ts guarantees a committed VI row carries both.
            taxTreatment: 'inclusive', taxAmount: '500', rowNumber: 1,
          },
          {
            caseRef: 'CASE-MC', type: 'Payment', title: undefined, project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'PAY-001',
            status: 'Paid', date: '2025-02-01', amount: '5000', rowNumber: 2,
          },
        ],
        errors: [],
      },
      rows: [
        { rowNumber: 1, valid: true, errors: [] },
        { rowNumber: 2, valid: true, errors: [] },
      ],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER,
      projectLookup,
      vendorLookup,
    });

    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);

    // createInvoice called for VI row
    expect(createInvoice).toHaveBeenCalledWith({
      procurementId: 'proc-1',
      status: 'Received',
      invoiceDate: '2025-01-15',
      referenceNumber: 'EXT-001',
      amount: 5000,
      // #505: the sheet's tax facts reach the RPC — parsed, not defaulted.
      taxTreatment: 'inclusive',
      taxAmount: 500,
      importKey: undefined,
      importBatchId: undefined,
      importedAt: undefined,
    });

    // createPayment called with invoiceId = 'inv-1' (the VI created in this group)
    expect(createPayment).toHaveBeenCalledWith(
      'proc-1',
      'inv-1',     // invoiceId = the VI's id
      'PAY-001',
      'Paid',
      '2025-02-01',
      5000,
      undefined,
      undefined,
      undefined,
    );
  });

  it('sets payment.invoiceId to null when no VI exists in the group', async () => {
    vi.clearAllMocks();
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-2' } as never);
    vi.mocked(createPayment).mockResolvedValue({ id: 'pay-2' } as never);

    const group: ValidatedGroup = {
      valid: true,
      groupErrors: [],
      group: {
        caseRef: 'CASE-PAY',
        attrs: { title: 'Direct Payment', project: undefined, caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-PAY', type: 'Payment', title: 'Direct Payment', project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: null as unknown as string,
            status: 'Paid', date: '2025-03-01', amount: '2500', rowNumber: 1,
          },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER,
      projectLookup,
      vendorLookup,
    });

    expect(createPayment).toHaveBeenCalledWith(
      'proc-2',
      null, // no VI → invoiceId null
      null,
      'Paid',
      '2025-03-01',
      2500,
      undefined,
      undefined,
      undefined,
    );
    expect(result.created).toBe(1);
  });
});

// ─── AC-CYCLE-COMMIT-002: Header fail skips all children ─────────────────────

describe('commitGroups — AC-CYCLE-COMMIT-002: header failure skips children', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call any record create fn when createProcurement throws', async () => {
    vi.mocked(createProcurement).mockRejectedValue(new Error('DB error'));

    const group: ValidatedGroup = {
      valid: true,
      groupErrors: [],
      group: {
        caseRef: 'CASE-FAIL',
        attrs: { title: 'Failing Case', project: undefined, caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-FAIL', type: 'PR', title: 'Failing Case', project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: null as unknown as string,
            status: null as unknown as string, date: null as unknown as string,
            amount: null as unknown as string, rowNumber: 1,
          },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER,
      projectLookup,
      vendorLookup,
    });

    expect(result.cases[0].headerStatus).toBe('failed');
    expect(result.cases[0].records).toEqual([expect.objectContaining({ rowNumber: 1, status: 'failed', error: expect.stringMatching(/not attempted/i) })]);
    expect(createPurchaseRequest).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.failed).toBe(1); // the unattempted record is reported as failed
  });
});

// ─── AC-CYCLE-COMMIT-003: One bad record isolates (others still created) ─────

describe('commitGroups — AC-CYCLE-COMMIT-003: single bad record does not abort rest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('continues creating remaining records when one throws', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-3' } as never);
    // PR succeeds
    vi.mocked(createPurchaseRequest).mockResolvedValue({ id: 'pr-1' } as never);
    // RFQ throws
    vi.mocked(createRfq).mockRejectedValue(new Error('RFQ error'));
    // PO succeeds
    vi.mocked(createPurchaseOrder).mockResolvedValue({ id: 'po-1' } as never);

    const group: ValidatedGroup = {
      valid: true,
      groupErrors: [],
      group: {
        caseRef: 'CASE-MIXED',
        attrs: { title: 'Mixed Results', project: undefined, caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-MIXED', type: 'PR', title: 'Mixed Results', project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'PR-EXT',
            status: 'Approved', date: '2025-01-01', amount: '1000', rowNumber: 1,
          },
          {
            caseRef: 'CASE-MIXED', type: 'RFQ', title: undefined, project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'RFQ-EXT',
            status: null as unknown as string, date: null as unknown as string,
            amount: null as unknown as string, rowNumber: 2,
          },
          {
            caseRef: 'CASE-MIXED', type: 'PO', title: undefined, project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'PO-EXT',
            status: 'Ordered', date: '2025-02-01', amount: '950', rowNumber: 3,
          },
        ],
        errors: [],
      },
      rows: [
        { rowNumber: 1, valid: true, errors: [] },
        { rowNumber: 2, valid: true, errors: [] },
        { rowNumber: 3, valid: true, errors: [] },
      ],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER,
      projectLookup,
      vendorLookup,
    });

    // PR and PO created; RFQ failed
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);

    const records = result.cases[0].records;
    expect(records).toHaveLength(3);
    expect(records.find((r) => r.type === 'PR')?.status).toBe('created');
    expect(records.find((r) => r.type === 'RFQ')?.status).toBe('failed');
    expect(records.find((r) => r.type === 'PO')?.status).toBe('created');
  });
});

// ─── SECURITY (review round 2 #2): one aggregate event per commitGroups() run ──────────────

describe('commitGroups — SECURITY (review round 2 #2, revised per code-quality review #2): ' +
  'per-classification aggregate bulk_import_failed, never save_failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analytics.trackSaveFailed.mockClear();
    analytics.trackBulkImportFailed.mockClear();
  });

  it('a header failure AND a record failure, with DIFFERENT classifications, across two groups ' +
    'fire ONE bulk_import_failed event PER CLASSIFICATION — never save_failed, and never a ' +
    'single lump event that discards the reason distribution', async () => {
    // Group A: header create rejects with 42501 (permission_denied) -> whole case fails, no
    // children attempted. Group B: header succeeds, one record (RFQ) rejects with 23503 (in_use)
    // — a DIFFERENT classification, so the test actually proves per-bucket aggregation.
    vi.mocked(createProcurement)
      .mockRejectedValueOnce(Object.assign(new Error('header boom'), { code: '42501' }))
      .mockResolvedValueOnce({ id: 'proc-ok' } as never);
    vi.mocked(createPurchaseRequest).mockResolvedValue({ id: 'pr-1' } as never);
    vi.mocked(createRfq).mockRejectedValue(Object.assign(new Error('RFQ error'), { code: '23503' }));

    const groupA: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-A', attrs: { title: 'Case A', project: undefined, caseStatus: undefined },
        rows: [{
          caseRef: 'CASE-A', type: 'PR', title: 'Case A', project: undefined,
          caseStatus: undefined, vendor: undefined, externalRef: 'A-EXT',
          status: 'Approved', date: '2025-01-01', amount: '1000', rowNumber: 1,
        }],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };
    const groupB: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-B', attrs: { title: 'Case B', project: undefined, caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-B', type: 'PR', title: 'Case B', project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'B-PR',
            status: 'Approved', date: '2025-01-01', amount: '1000', rowNumber: 1,
          },
          {
            caseRef: 'CASE-B', type: 'RFQ', title: undefined, project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'B-RFQ',
            status: null as unknown as string, date: null as unknown as string,
            amount: null as unknown as string, rowNumber: 2,
          },
        ],
        errors: [],
      },
      rows: [
        { rowNumber: 1, valid: true, errors: [] },
        { rowNumber: 2, valid: true, errors: [] },
      ],
    };

    const result = await commitGroups([groupA, groupB], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
    });

    expect(result.cases[0].headerStatus).toBe('failed');
    expect(result.failed).toBe(2); // the failed RFQ and the record not attempted after the header failure

    // Never the old event; ONE call PER classification bucket (2 buckets here, 1 each).
    expect(analytics.trackSaveFailed).not.toHaveBeenCalled();
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledTimes(2);
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('procurement', 'permission_denied', 1);
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('procurement', 'in_use', 1);
  });

  it('a fully clean run fires no aggregate event', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-clean' } as never);
    vi.mocked(createPurchaseRequest).mockResolvedValue({ id: 'pr-clean' } as never);

    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-CLEAN', attrs: { title: 'Clean', project: undefined, caseStatus: undefined },
        rows: [{
          caseRef: 'CASE-CLEAN', type: 'PR', title: 'Clean', project: undefined,
          caseStatus: undefined, vendor: undefined, externalRef: 'C-EXT',
          status: 'Approved', date: '2025-01-01', amount: '1000', rowNumber: 1,
        }],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup });
    expect(analytics.trackSaveFailed).not.toHaveBeenCalled();
    expect(analytics.trackBulkImportFailed).not.toHaveBeenCalled();
  });
});

// ─── AC-CYCLE-COMMIT-004: Canonical order PR→RFQ→Quotation→PO→GR→VI→Payment ─

describe('commitGroups — AC-CYCLE-COMMIT-004: canonical creation order', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates records in canonical order regardless of sheet row order', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-4' } as never);
    vi.mocked(createPurchaseRequest).mockResolvedValue({ id: 'pr-x' } as never);
    vi.mocked(createInvoice).mockResolvedValue({ id: 'inv-x' } as never);
    vi.mocked(createPayment).mockResolvedValue({ id: 'pay-x' } as never);

    const callOrder: string[] = [];
    vi.mocked(createPurchaseRequest).mockImplementation(async () => { callOrder.push('PR'); return { id: 'pr-x' } as never; });
    vi.mocked(createInvoice).mockImplementation(async () => { callOrder.push('VI'); return { id: 'inv-x' } as never; });
    vi.mocked(createPayment).mockImplementation(async () => { callOrder.push('Payment'); return { id: 'pay-x' } as never; });

    // Sheet has Payment first, then VI, then PR — reversed order
    const group: ValidatedGroup = {
      valid: true,
      groupErrors: [],
      group: {
        caseRef: 'CASE-ORDER',
        attrs: { title: 'Order Test', project: undefined, caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-ORDER', type: 'Payment', title: undefined, project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: null as unknown as string,
            status: 'Paid', date: '2025-04-01', amount: '500', rowNumber: 1,
          },
          {
            caseRef: 'CASE-ORDER', type: 'VI', title: undefined, project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: null as unknown as string,
            status: 'Received', date: '2025-03-15', amount: '500', rowNumber: 2,
            // #505: a VI row states its tax treatment. validateGroups refuses one that does not, and
            // commitGroups now THROWS rather than coercing — `Number('')` is 0, which would have made
            // a blank cell a confident "no tax" on a money row.
            taxTreatment: 'exclusive', taxAmount: '0',
          },
          {
            caseRef: 'CASE-ORDER', type: 'PR', title: 'Order Test', project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: null as unknown as string,
            status: null as unknown as string, date: null as unknown as string,
            amount: null as unknown as string, rowNumber: 3,
          },
        ],
        errors: [],
      },
      rows: [
        { rowNumber: 1, valid: true, errors: [] },
        { rowNumber: 2, valid: true, errors: [] },
        { rowNumber: 3, valid: true, errors: [] },
      ],
    };

    await commitGroups([group], {
      requestedById: REQUESTER,
      projectLookup,
      vendorLookup,
    });

    // Must be in canonical order: PR → VI → Payment
    expect(callOrder).toEqual(['PR', 'VI', 'Payment']);
  });
});

// ─── AC-CYCLE-COMMIT-005: skip invalid groups ─────────────────────────────────

describe('commitGroups — AC-CYCLE-COMMIT-005: invalid groups are skipped', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call any DB fn for groups where valid=false', async () => {
    const invalidGroup: ValidatedGroup = {
      valid: false,
      groupErrors: ['Case must have at least a title or a project set.'],
      group: {
        caseRef: 'CASE-INVALID',
        attrs: { title: undefined, project: undefined, caseStatus: undefined },
        rows: [],
        errors: [],
      },
      rows: [],
    };

    const result = await commitGroups([invalidGroup], {
      requestedById: REQUESTER,
      projectLookup,
      vendorLookup,
    });

    expect(createProcurement).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.cases).toHaveLength(0);
  });
});

// ─── AC-IDEM-002/003/004/004a: import-idempotency skip semantics ─────────────

import type { ImportSkipLookup } from '@/src/lib/db/procurementImportSkip';

const BATCH_ID = 'batch-aaa';

function makeStubSkipLookup(overrides: Partial<ImportSkipLookup> = {}): ImportSkipLookup {
  const lookup: ImportSkipLookup = {
    findExistingCase: vi.fn().mockResolvedValue(null),
    findExistingRecord: vi.fn().mockResolvedValue(null),
    findCrossBatchCollision: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  if (!('listCases' in overrides)) lookup.listCases = async keys => {
    const rows = [];
    for (const key of keys) {
      const same = await lookup.findExistingCase(key, BATCH_ID);
      if (same) rows.push({ id: same.id, import_key: key, import_batch_id: BATCH_ID });
      else {
        const other = await lookup.findCrossBatchCollision('procurements', key, BATCH_ID);
        if (other) rows.push({ id: other.id, import_key: key, import_batch_id: other.import_batch_id });
      }
    }
    return rows;
  };
  return lookup;
}

describe('commitGroups — AC-IDEM-002: case-level skip within the same batch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips the header insert when an existing case matches (org_id, import_key, batch) and does not call createProcurement', async () => {
    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing-proc-1' }),
    });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: { caseRef: 'CASE-DUP', attrs: { title: 'Dup Case', project: undefined, caseStatus: undefined }, rows: [], errors: [] },
      rows: [],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(createProcurement).not.toHaveBeenCalled();
    expect(result.cases[0].headerStatus).toBe('skipped');
    expect(result.cases[0].procurementId).toBe('existing-proc-1');
  });
});

describe('commitGroups — AC-IDEM-004a: header skip does NOT skip its still-missing children', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-runs a case whose header + 2 of 5 records already exist: skips header + those 2, creates the remaining 3', async () => {
    vi.mocked(createPurchaseOrder).mockResolvedValue({ id: 'po-new' } as never);
    vi.mocked(createInvoice).mockResolvedValue({ id: 'vi-new' } as never);
    vi.mocked(createPayment).mockResolvedValue({ id: 'pay-new' } as never);

    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing-proc-2' }),
      listCaseRecords: vi.fn().mockImplementation(async (table: string) => {
        if (table === 'purchase_requests') return [{ id: 'already-pr', import_key: 'pcy2:["r","PR-1"]', import_batch_id: BATCH_ID, import_identity_version: 2, import_identity_facts: ['PR-1', 'Approved', '2025-01-01', '100.00'] }];
        if (table === 'rfqs') return [{ id: 'already-rfq', import_key: 'pcy2:["r","RFQ-1"]', import_batch_id: BATCH_ID, import_identity_version: 2, import_identity_facts: ['RFQ-1', 'Draft', null, null] }];
        return [];
      }),
    });

    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-CRASH', attrs: { title: 'Crashed Case', project: undefined, caseStatus: undefined },
        rows: [
          { caseRef: 'CASE-CRASH', type: 'PR', title: 'Crashed Case', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PR-1', status: 'Approved', date: '2025-01-01', amount: '100', rowNumber: 1 },
          { caseRef: 'CASE-CRASH', type: 'RFQ', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'RFQ-1', status: null as unknown as string, date: null as unknown as string, amount: null as unknown as string, rowNumber: 2 },
          { caseRef: 'CASE-CRASH', type: 'PO', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO-1', status: 'Ordered', date: '2025-02-01', amount: '900', rowNumber: 3 },
          { caseRef: 'CASE-CRASH', type: 'VI', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'VI-1', status: 'Received', date: '2025-03-01', amount: '900', rowNumber: 4, taxTreatment: 'exclusive', taxAmount: '0' },
          { caseRef: 'CASE-CRASH', type: 'Payment', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PAY-1', status: 'Paid', date: '2025-04-01', amount: '900', rowNumber: 5 },
        ],
        errors: [],
      },
      rows: [1, 2, 3, 4, 5].map((n) => ({ rowNumber: n, valid: true, errors: [] })),
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(result.cases[0].headerStatus).toBe('skipped');
    const byType = Object.fromEntries(result.cases[0].records.map((r) => [r.type, r.status]));
    expect(byType.PR).toBe('skipped');
    expect(byType.RFQ).toBe('skipped');
    expect(byType.PO).toBe('created');
    expect(byType.VI).toBe('created');
    expect(byType.Payment).toBe('created');
    expect(createPurchaseRequest).not.toHaveBeenCalled(); // skipped, not re-created
    expect(createRfq).not.toHaveBeenCalled();
    expect(createPurchaseOrder).toHaveBeenCalled();
  });
});

describe('commitGroups — AC-IDEM-004: exact re-run of the same batch creates zero new rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports every case and record as skipped when everything already exists in this batch', async () => {
    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing-proc-3' }),
      listCaseRecords: vi.fn().mockResolvedValue([{ id: 'already-there', import_key: 'pcy2:["r","PR-R"]', import_batch_id: BATCH_ID, import_identity_version: 2, import_identity_facts: ['PR-R', 'Approved', '2025-01-01', '100.00'] }]),
    });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-REPEAT', attrs: { title: 'Repeat Case', project: undefined, caseStatus: undefined },
        rows: [
          { caseRef: 'CASE-REPEAT', type: 'PR', title: 'Repeat Case', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PR-R', status: 'Approved', date: '2025-01-01', amount: '100', rowNumber: 1 },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(result.created).toBe(0);
    expect(result.cases[0].headerStatus).toBe('skipped');
    expect(result.cases[0].records[0].status).toBe('skipped');
    expect(createPurchaseRequest).not.toHaveBeenCalled();
  });
});

describe('commitGroups — FR-IDEM-006: cross-batch collision is skipped at commit time, not duplicated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips a case whose import_key exists in a DIFFERENT batch (findExistingCase null, findCrossBatchCollision hit)', async () => {
    const skipLookup = makeStubSkipLookup({
      // Nothing in THIS batch...
      findExistingCase: vi.fn().mockResolvedValue(null),
      // ...but the same import_key was imported by an earlier batch.
      findCrossBatchCollision: vi.fn().mockImplementation(
        async (table: string) =>
          table === 'procurements'
            ? { id: 'earlier-batch-proc', import_batch_id: 'batch-earlier' }
            : null,
      ),
    });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: { caseRef: 'CASE-XBATCH', attrs: { title: 'Cross-batch Case', project: undefined, caseStatus: undefined }, rows: [], errors: [] },
      rows: [],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(createProcurement).not.toHaveBeenCalled();
    expect(result.cases[0].headerStatus).toBe('skipped');
    expect(result.cases[0].procurementId).toBe('earlier-batch-proc');
  });

  it('reports an unmarked record from an earlier batch for reconciliation', async () => {
    // Header is a fresh create in this batch; the PO record already exists in an earlier batch.
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-new' } as never);
    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn().mockResolvedValue(null),
      findExistingRecord: vi.fn().mockResolvedValue(null),
      listCaseRecords: vi.fn().mockResolvedValue([{ id: 'earlier-po', import_key: 'PO-X', import_batch_id: 'batch-earlier', import_identity_version: null, import_identity_facts: null }]),
      findCrossBatchCollision: vi.fn().mockImplementation(
        async (table: string) =>
          table === 'purchase_orders'
            ? { id: 'earlier-po', import_batch_id: 'batch-earlier' }
            : null,
      ),
    });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-XREC', attrs: { title: 'Case', project: undefined, caseStatus: undefined },
        rows: [
          { caseRef: 'CASE-XREC', type: 'PO', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO-X', status: 'Ordered', date: '2025-02-01', amount: '900', rowNumber: 1 },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(result.cases[0].records[0].status).toBe('failed');
    expect(result.cases[0].records[0].id).toBe('earlier-po');
    expect(createPurchaseOrder).not.toHaveBeenCalled();
  });
});

describe('commitGroups — A4: a 23505 unique-violation on insert is treated as "already imported → skipped" (TOCTOU-safe)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a header as skipped (not failed) when createProcurement raises 23505', async () => {
    // Both skip probes miss (the concurrent run inserted between the check and this insert),
    // then the DB unique index fires.
    vi.mocked(createProcurement).mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    // First skip-check misses (null); after the 23505 the concurrent row is now visible.
    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'raced-proc' }),
    });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: { caseRef: 'CASE-RACE', attrs: { title: 'Race Case', project: undefined, caseStatus: undefined }, rows: [], errors: [] },
      rows: [],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(result.cases[0].headerStatus).toBe('skipped');
    expect(result.failed).toBe(0);
  });

  it('reports an unmatched unique violation as a failure', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-race' } as never);
    vi.mocked(createPurchaseOrder).mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const skipLookup = makeStubSkipLookup();
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-RACE2', attrs: { title: 'Case', project: undefined, caseStatus: undefined },
        rows: [
          { caseRef: 'CASE-RACE2', type: 'PO', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO-R', status: 'Ordered', date: '2025-02-01', amount: '900', rowNumber: 1 },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(result.cases[0].records[0].status).toBe('failed');
    expect(result.failed).toBe(1);
  });

  it('rechecks the scoped identity after a concurrent insert', async () => {
    // The catch-path race lookup must scope to the exact import batch — otherwise a
    // stale/incorrect id could be attributed to a same-batch VI/record FK settlement.
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-race-2' } as never);
    vi.mocked(createPurchaseOrder).mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const listCaseRecords = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'raced-po-id', import_key: 'pcy2:["r","PO-R3"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['PO-R3', 'Ordered', '2025-02-01', '900.00'] }]);
    const skipLookup = makeStubSkipLookup({ listCaseRecords });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-RACE3', attrs: { title: 'Case', project: undefined, caseStatus: undefined },
        rows: [
          { caseRef: 'CASE-RACE3', type: 'PO', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO-R3', status: 'Ordered', date: '2025-02-01', amount: '900', rowNumber: 1 },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(listCaseRecords).toHaveBeenLastCalledWith('purchase_orders', 'proc-race-2', ['PO-R3', 'pcy2:["r","PO-R3"]']);
    expect(result.cases[0].records[0].id).toBe('raced-po-id');
    expect(result.cases[0].records[0].status).toBe('skipped');
  });
});


// ─── #505: a VI row missing its tax facts NEVER reaches the RPC ───────────────────────────────
// The end-to-end oracle for "reported at preview, zero writes": drive the REAL group→validate
// pipeline (not a hand-built ValidatedGroup) and assert createInvoice was never called. A P0001
// from the RPC would also stop the write, but only after the case header had already been created.

describe('commitGroups — #505: a VI row with no tax treatment is rejected before any write', () => {
  beforeEach(() => vi.clearAllMocks());

  const viRow = (overrides: Partial<CycleRow>): CycleRow => ({
    caseRef: 'CASE-505', type: 'VI', title: 'Legacy Invoice', project: 'Solar EPC',
    caseStatus: undefined, vendor: undefined, externalRef: 'EXT-505',
    status: 'Received', date: '2025-01-15', amount: '5000', rowNumber: 1,
    ...overrides,
  });

  const commitFromSheet = async (rows: CycleRow[]) => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-505' } as never);
    vi.mocked(createInvoice).mockResolvedValue({ id: 'inv-505' } as never);
    const { groups } = groupRows(rows);
    const validated = validateGroups(groups, { projectLookup, vendorLookup });
    return commitGroups(validated.filter((g) => g.valid), {
      requestedById: REQUESTER, projectLookup, vendorLookup,
    });
  };

  it('#505: no tax treatment on the sheet ⇒ createInvoice is never called', async () => {
    await commitFromSheet([viRow({ taxTreatment: undefined, taxAmount: '500' })]);
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it('#505: no tax amount on the sheet ⇒ createInvoice is never called', async () => {
    await commitFromSheet([viRow({ taxTreatment: 'inclusive', taxAmount: undefined })]);
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it('#505: with both stated the row commits, and taxAmount "0" arrives as the number 0', async () => {
    await commitFromSheet([viRow({ taxTreatment: 'exclusive', taxAmount: '0' })]);
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createInvoice).mock.calls[0][0]).toMatchObject({
      taxTreatment: 'exclusive',
      taxAmount: 0,
    });
  });

  it('AC-PLC-009: a neutral comma-grouped invoice amount commits as a number under id-ID', async () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    await commitFromSheet([viRow({ amount: '1,234.56', taxTreatment: 'exclusive', taxAmount: '1.23' })]);

    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createInvoice).mock.calls[0][0]).toMatchObject({ amount: 1234.56, taxAmount: 1.23 });
  });

  it('writes normalized spreadsheet noise for invoice amount and tax', async () => {
    await commitFromSheet([viRow({ amount: '1234.5600000000002', taxTreatment: 'exclusive', taxAmount: '0.30000000000000004' })]);
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createInvoice).mock.calls[0][0]).toMatchObject({ amount: 1234.56, taxAmount: 0.3 });
  });

  it('AC-PLC-009: a three-decimal invoice amount is rejected before the import commit writes', async () => {
    await commitFromSheet([viRow({ amount: '1.234', taxTreatment: 'exclusive', taxAmount: '0' })]);

    expect(createProcurement).not.toHaveBeenCalled();
    expect(createInvoice).not.toHaveBeenCalled();
  });

  // The three cases above all use SINGLE-ROW groups: the invalid VI row is the group's only row,
  // so `anyRowValid` is false and validateGroups filters the WHOLE group before commit ever runs —
  // that proves nothing about PER-ROW filtering inside commitCase, which is what protects a real
  // mixed sheet (a valid PR/PO/GR row sharing a case with a broken VI row). This case puts a VALID
  // PR row in the SAME group as the invalid VI row: `anyRowValid` is true (the PR row), so the
  // group as a whole is `valid: true` and reaches commitCase — proving per-row filtering, not
  // group-level rejection, is what keeps the bad VI row from ever reaching createInvoice.
  it('#505: a valid PR row commits even when the VI row beside it (same case) has no tax treatment, and createInvoice is never called', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-mix' } as never);
    vi.mocked(createPurchaseRequest).mockResolvedValue({ id: 'pr-mix' } as never);

    const prRow: CycleRow = {
      caseRef: 'CASE-505-MIX', type: 'PR', title: 'Legacy Invoice', project: 'Solar EPC',
      caseStatus: undefined, vendor: undefined, externalRef: 'PR-505',
      status: 'Open', date: '2025-01-10', amount: '1000', rowNumber: 1,
    };
    const invalidViRow: CycleRow = {
      ...viRow({ taxTreatment: undefined, taxAmount: '500' }),
      caseRef: 'CASE-505-MIX',
      rowNumber: 2,
    };

    const { groups } = groupRows([prRow, invalidViRow]);
    const validated = validateGroups(groups, { projectLookup, vendorLookup });
    // Confirms the fixture actually exercises the per-row path, not group-level rejection.
    expect(validated).toHaveLength(1);
    expect(validated[0].valid).toBe(true);

    const result = await commitGroups(validated.filter((g) => g.valid), {
      requestedById: REQUESTER, projectLookup, vendorLookup,
    });

    expect(result.cases[0].headerStatus).toBe('created');
    expect(result.created).toBe(1);
    expect(createPurchaseRequest).toHaveBeenCalledTimes(1);
    expect(createInvoice).not.toHaveBeenCalled();
    // The stronger, filtering-specific assertions: with per-row filtering intact, the invalid VI
    // row is never even ATTEMPTED — it produces no record at all (not a 'failed' one). Asserting
    // only `createInvoice` was never called is not enough to prove filtering ran, because the
    // commit-time guard (tested separately below) would ALSO stop createInvoice from firing if the
    // invalid row were mistakenly let through the filter and attempted — that would just show up
    // as a 'failed' record instead. `records` having exactly the one PR record, and `failed` at 0,
    // is what distinguishes "never attempted" (filtering) from "attempted and caught" (the guard).
    expect(result.failed).toBe(0);
    expect(result.cases[0].records).toEqual([
      expect.objectContaining({ rowNumber: 1, type: 'PR', status: 'created' }),
    ]);
  });
});

// ─── #505: the throw guard at commit-time is the last line of defense ────────────────────────
// validateGroups is SUPPOSED to refuse a tax-less VI row before commit ever runs (the describe
// block above proves that). This block proves the OTHER half: if a validation regression ever let
// one through anyway (hand-built here, bypassing validateGroups entirely — exactly what a future
// bug in validateRowFields would look like from commit.ts's point of view), commit.ts's own guard
// (~line 206) must catch it and report the row `failed` with a loud message, not coerce `Number('')`
// into a confident `0` and silently write a wrong tax figure.
describe('commitGroups — #505: the tax-less-VI-at-commit guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a VI row as failed, carrying the guard message, when it reaches commit with no tax treatment', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-guard' } as never);

    const group: ValidatedGroup = {
      valid: true,
      groupErrors: [],
      group: {
        caseRef: 'CASE-GUARD',
        attrs: { title: 'Legacy Invoice', project: undefined, caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-GUARD', type: 'VI', title: 'Legacy Invoice', project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'EXT-GUARD',
            status: 'Received', date: '2025-01-15', amount: '5000',
            // Hand-built as though validateGroups had (wrongly) let this through: no tax treatment,
            // no tax amount — the exact shape a validation regression would produce.
            taxTreatment: undefined, taxAmount: undefined, rowNumber: 1,
          },
        ],
        errors: [],
      },
      // Marked valid: true by hand — simulating the validation bug this guard exists to catch.
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
    });

    expect(createInvoice).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.cases[0].records).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        type: 'VI',
        status: 'failed',
        error: expect.stringContaining(
          'a VI row reached commit with no tax treatment or amount',
        ),
      }),
    ]);
  });

  // Code-quality follow-up (#505 review): the guard used to check only for EMPTINESS (`!taxTreatment`),
  // so an out-of-domain-but-non-empty value like 'Inclusive' (wrong case) or 'invalid' slipped past it
  // and reached the RPC to die on the DB's 23514 — the wrong, less actionable error. Same hand-built
  // bypass-validateGroups shape as above, but with a non-empty, out-of-domain treatment string.
  it('reports a VI row as failed, carrying the guard message, when its tax treatment is non-empty but out of domain', async () => {
    vi.mocked(createProcurement).mockResolvedValue({ id: 'proc-guard-2' } as never);

    const group: ValidatedGroup = {
      valid: true,
      groupErrors: [],
      group: {
        caseRef: 'CASE-GUARD-2',
        attrs: { title: 'Legacy Invoice', project: undefined, caseStatus: undefined },
        rows: [
          {
            caseRef: 'CASE-GUARD-2', type: 'VI', title: 'Legacy Invoice', project: undefined,
            caseStatus: undefined, vendor: undefined, externalRef: 'EXT-GUARD-2',
            status: 'Received', date: '2025-01-15', amount: '5000',
            // Non-empty but NOT in VI_TAX_TREATMENT ('inclusive' | 'exclusive') — an emptiness-only
            // guard would wrongly let this through.
            taxTreatment: 'Inclusive', taxAmount: '500', rowNumber: 1,
          },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
    });

    expect(createInvoice).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.cases[0].records).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        type: 'VI',
        status: 'failed',
        error: expect.stringContaining(
          'a VI row reached commit with no tax treatment or amount',
        ),
      }),
    ]);
  });
});

it('reports a case lookup failure without creating its header', async () => {
  vi.clearAllMocks();
  const group: ValidatedGroup = {
    valid: true, groupErrors: [],
    group: { caseRef: 'CASE', attrs: { title: 'Case', project: undefined, caseStatus: undefined }, rows: [], errors: [] },
    rows: [],
  };
  const result = await commitGroups([group], {
    requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID,
    skipLookup: makeStubSkipLookup({ findExistingCase: vi.fn().mockRejectedValue(new Error('read failed')) }),
  });
  expect(result.cases[0].headerStatus).toBe('failed');
  expect(createProcurement).not.toHaveBeenCalled();
});

it('stops a case after a record lookup failure', async () => {
  vi.clearAllMocks();
  const rows: CycleRow[] = [
    { caseRef: 'C', type: 'PR', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'A', status: 'Approved', date: '2025-01-01', amount: '1', rowNumber: 1 },
    { caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'B', status: 'Approved', date: '2025-01-01', amount: '1', rowNumber: 2 },
  ];
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: makeStubSkipLookup({ findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }), findExistingRecord: vi.fn().mockRejectedValue(new Error('read failed')) }) });
  expect(result.cases[0].records[0].status).toBe('failed');
  expect(result.failed).toBe(2);
  expect(result.cases[0].records[1].error).toContain('not attempted');
  expect(createPurchaseRequest).not.toHaveBeenCalled();
  expect(createPurchaseOrder).not.toHaveBeenCalled();
});

it('reports a failed race recheck without continuing to later records', async () => {
  vi.mocked(createProcurement).mockResolvedValue({ id: 'race-case' } as never);
  vi.mocked(createPurchaseOrder).mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
  const lookup = makeStubSkipLookup({ listCaseRecords: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('recheck unavailable')) });
  const group: ValidatedGroup = {
    valid: true, groupErrors: [],
    group: { caseRef: 'race', attrs: { title: 'Race', project: undefined, caseStatus: undefined }, errors: [], rows: [
      { caseRef: 'race', type: 'PO', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO', status: 'Ordered', date: '2025-02-01', amount: '10', rowNumber: 1 },
      { caseRef: 'race', type: 'Payment', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PAY', status: 'Paid', date: '2025-02-01', amount: '10', rowNumber: 2 },
    ] }, rows: [{ rowNumber: 1, valid: true, errors: [] }, { rowNumber: 2, valid: true, errors: [] }],
  };
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records).toHaveLength(2);
  expect(result.failed).toBe(2);
  expect(result.cases[0].records[1].error).toContain('not attempted');
  expect(result.cases[0].records[0].status).toBe('failed');
  expect(createPayment).not.toHaveBeenCalled();
});

it('reports a header race recheck error and preserves subsequent cases', async () => {
  vi.mocked(createProcurement).mockReset().mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' })).mockResolvedValueOnce({ id: 'next-case' } as never);
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('recheck unavailable')).mockResolvedValue([]) });
  const group = (caseRef: string): ValidatedGroup => ({ valid: true, groupErrors: [], group: { caseRef, attrs: { title: caseRef, project: undefined, caseStatus: undefined }, rows: [], errors: [] }, rows: [] });
  const result = await commitGroups([group('first'), group('next')], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases.map(item => item.headerStatus)).toEqual(['failed', 'created']);
  expect(result.cases[0].headerError).toBeTruthy();
});


it('rechecks a new record after the batched snapshot and observes an interleaved import', async () => {
  vi.clearAllMocks();
  const rows: CycleRow[] = ['A', 'B'].map((externalRef, i) => ({ caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef, status: 'Ordered', date: '2025-01-01', amount: '1', rowNumber: i + 1 }));
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  let inserted = false;
  let releaseWrite!: () => void;
  let notifyWrite!: () => void;
  const writeStarted = new Promise<void>(resolve => { notifyWrite = resolve; });
  const writeReleased = new Promise<void>(resolve => { releaseWrite = resolve; });
  vi.mocked(createPurchaseOrder).mockImplementation(async () => { notifyWrite(); await writeReleased; return { id: 'first' } as never; });
  const listCaseRecords = vi.fn().mockImplementation(async (_table, _caseId, keys: string[]) => keys.length === 2 && inserted ? [{ id: 'other', import_key: keys[1], import_batch_id: 'old', import_identity_version: 2, import_identity_facts: ['B', 'Ordered', '2025-01-01', '1.00'] }] : []);
  const lookup = makeStubSkipLookup({ findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }), listCaseRecords });
  const pending = commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  await writeStarted;
  inserted = true;
  releaseWrite();
  const result = await pending;
  expect(createPurchaseOrder).toHaveBeenCalledTimes(1);
  expect(result.cases[0].records[1]).toMatchObject({ status: 'skipped', id: 'other' });
});

it('bulk probes 500 case keys at commit and freshly checks each new header', async () => {
  vi.clearAllMocks();
  vi.mocked(createProcurement).mockResolvedValue({ id: 'new' } as never);
  const groups: ValidatedGroup[] = Array.from({ length: 500 }, (_, i) => ({ valid: true, groupErrors: [], group: { caseRef: `C${i}`, attrs: { title: `C${i}`, project: undefined, caseStatus: undefined }, rows: [], errors: [] }, rows: [] }));
  const listCases = vi.fn().mockResolvedValue([]);
  const lookup = makeStubSkipLookup({ listCases });
  const result = await commitGroups(groups, { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases).toHaveLength(500);
  expect(listCases).toHaveBeenCalledTimes(501);
  expect(listCases.mock.calls[0][0]).toHaveLength(500);
  expect(lookup.findExistingCase).not.toHaveBeenCalled();
});

it('accounts for every row when a header probe fails', async () => {
  vi.clearAllMocks();
  const rows: CycleRow[] = ['A', 'B'].map((externalRef, i) => ({ caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef, status: 'Ordered', date: '2025-01-01', amount: '1', rowNumber: i + 1 }));
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockRejectedValue(new Error('read failed')) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].headerStatus).toBe('failed');
  expect(result.failed).toBe(2);
  expect(result.cases[0].records.map(record => record.status)).toEqual(['failed', 'failed']);
  expect(result.cases[0].records[0].error).toContain('not attempted');
  expect(createProcurement).not.toHaveBeenCalled();
});

it('accounts for remaining rows after a fresh record probe fails', async () => {
  vi.clearAllMocks();
  const rows: CycleRow[] = ['A', 'B'].map((externalRef, i) => ({ caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef, status: 'Ordered', date: '2025-01-01', amount: '1', rowNumber: i + 1 }));
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  const lookup = makeStubSkipLookup({ findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }), listCaseRecords: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('fresh read failed')) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.failed).toBe(2);
  expect(result.cases[0].records[1].error).toContain('not attempted');
  expect(createPurchaseOrder).not.toHaveBeenCalled();
});

it('retains earlier skipped and created outcomes when a later fresh probe fails', async () => {
  vi.clearAllMocks();
  const rows: CycleRow[] = ['A', 'B', 'C', 'D'].map((externalRef, i) => ({ caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef, status: 'Ordered', date: '2025-01-01', amount: '1', rowNumber: i + 1 }));
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  const { computeRecordImportKey } = await import('../importKey');
  const lookup = makeStubSkipLookup({ findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }), listCaseRecords: vi.fn().mockResolvedValueOnce([{ id: 'existing', import_key: computeRecordImportKey(rows[0], ['A', 'Ordered', '2025-01-01', '1.00']), import_batch_id: BATCH_ID, import_identity_version: 2, import_identity_facts: ['A', 'Ordered', '2025-01-01', '1.00'] }]).mockResolvedValueOnce([{ id: 'existing', import_key: computeRecordImportKey(rows[0], ['A', 'Ordered', '2025-01-01', '1.00']), import_batch_id: BATCH_ID, import_identity_version: 2, import_identity_facts: ['A', 'Ordered', '2025-01-01', '1.00'] }]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('fresh read failed')) });
  vi.mocked(createPurchaseOrder).mockResolvedValue({ id: 'created' } as never);
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records.map(record => record.status)).toEqual(['skipped', 'created', 'failed', 'failed']);
  expect(result.cases[0].records[3].error).toContain('not attempted');
  expect(result.created).toBe(1);
  expect(result.failed).toBe(2);
  expect(createPurchaseOrder).toHaveBeenCalledTimes(1);
});

it('writes the versioned identity through the existing record RPC', async () => {
  vi.clearAllMocks();
  vi.mocked(createPurchaseOrder).mockResolvedValue({ id: 'po' } as never);
  const row: CycleRow = { caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'fp:PO|||', status: 'Draft', date: '2025-01-01', amount: '1', rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords: vi.fn().mockResolvedValue([]) });
  await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(vi.mocked(createPurchaseOrder).mock.calls[0][5]).toBe('pcy2:["r","fp:PO|||"]');
});

it('rejects both duplicate source identities before creating a case', async () => {
  vi.clearAllMocks();
  const row: CycleRow = { caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'duplicate', status: 'Draft', date: '2025-01-01', amount: '1', rowNumber: 1 };
  const rows = [row, { ...row, amount: '2', rowNumber: 2 }];
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(r => ({ rowNumber: r.rowNumber, valid: true, errors: [] })) };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([]), listCaseRecords: vi.fn().mockResolvedValue([]) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(createProcurement).not.toHaveBeenCalled();
  expect(result.cases[0].records.map(record => record.status)).toEqual(['failed', 'failed']);
});

it('fails a record when a matching legacy candidate has unknown origin', async () => {
  vi.clearAllMocks();
  const row: CycleRow = { caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO', status: 'Draft', date: '2025-01-01', amount: '1', rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords: vi.fn().mockResolvedValue([{ id: 'old', import_key: 'PO', import_batch_id: null, import_identity_version: null, import_identity_facts: null }]) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records[0]).toMatchObject({ status: 'failed', id: 'old' });
  expect(createPurchaseOrder).not.toHaveBeenCalled();
});

it('does not classify an unrelated unique violation as a successful retry', async () => {
  vi.clearAllMocks();
  vi.mocked(createPurchaseOrder).mockRejectedValue(Object.assign(new Error('unique violation'), { code: '23505' }));
  const row: CycleRow = { caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO', status: 'Draft', date: '2025-01-01', amount: '1', rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords: vi.fn().mockResolvedValue([]), findExistingRecord: vi.fn().mockResolvedValue({ id: 'unrelated' }) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records[0].status).toBe('failed');
});

it('does not write a linked payment when its invoice fails', async () => {
  vi.clearAllMocks();
  vi.mocked(createInvoice).mockRejectedValue(new Error('invoice failed'));
  const common = { caseRef: 'C', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, date: '2025-01-01', amount: '1' };
  const rows: CycleRow[] = [
    { ...common, type: 'VI', externalRef: 'VI', status: 'Received', taxTreatment: 'exclusive', taxAmount: '0', rowNumber: 1 },
    { ...common, type: 'Payment', externalRef: 'PAY', status: 'Scheduled', rowNumber: 2 },
  ];
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords: vi.fn().mockResolvedValue([]) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records.map(record => record.status)).toEqual(['failed', 'failed']);
  expect(createPayment).not.toHaveBeenCalled();
});

it('uses the resolved invoice ID when comparing a linked payment on retry', async () => {
  vi.clearAllMocks();
  const common = { caseRef: 'C', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, date: '2025-01-01', amount: '1' };
  const invoiceId = '39900000-0000-0000-0000-000000000051';
  const rows: CycleRow[] = [
    { ...common, type: 'VI', externalRef: 'VI', status: 'Received', taxTreatment: 'exclusive', taxAmount: '0', rowNumber: 1 },
    { ...common, type: 'Payment', externalRef: 'PAY', status: 'Scheduled', rowNumber: 2 },
  ];
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  const listCaseRecords = vi.fn().mockImplementation(async (table: string) => table === 'procurement_invoices'
    ? [{ id: invoiceId, import_key: 'pcy2:["r","VI"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['VI', 'Received', '2025-01-01', '1.00', 'exclusive', '0.00'] }]
    : [{ id: 'payment', import_key: 'pcy2:["r","PAY"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['PAY', invoiceId, 'Scheduled', '2025-01-01', '1.00'] }]);
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records.map(record => record.status)).toEqual(['skipped', 'skipped']);
  expect(createPayment).not.toHaveBeenCalled();
});

it('fails closed when a caller cannot read record identity metadata', async () => {
  vi.clearAllMocks();
  const row: CycleRow = { caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO', status: 'Draft', date: '2025-01-01', amount: '1', rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const lookup = makeStubSkipLookup({ findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }), findExistingRecord: vi.fn().mockResolvedValue({ id: 'old' }) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records[0].status).toBe('failed');
  expect(createPurchaseOrder).not.toHaveBeenCalled();
});

it('reports changed invoice tax facts as a conflict', async () => {
  vi.clearAllMocks();
  const row: CycleRow = { caseRef: 'C', type: 'VI', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'VI', status: 'Received', date: '2025-01-01', amount: '100', taxTreatment: 'exclusive', taxAmount: '10', rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords: vi.fn().mockResolvedValue([{ id: 'invoice', import_key: 'pcy2:["r","VI"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['VI', 'Received', '2025-01-01', '100.00', 'exclusive', '0.00'] }]) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records[0]).toMatchObject({ status: 'failed', id: 'invoice' });
  expect(createInvoice).not.toHaveBeenCalled();
});

it('freshly rechecks an equal marked candidate before reporting a skip', async () => {
  vi.clearAllMocks();
  const row: CycleRow = { caseRef: 'C', type: 'PO', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO', status: 'Draft', date: '2025-01-01', amount: '1', rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const marked = { id: 'same', import_key: 'pcy2:["r","PO"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['PO', 'Draft', '2025-01-01', '1.00'] };
  const unknown = { id: 'unknown', import_key: 'PO', import_batch_id: null, import_identity_version: null, import_identity_facts: null };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords: vi.fn().mockResolvedValueOnce([marked]).mockResolvedValue([marked, unknown]) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records[0]).toMatchObject({ status: 'failed', id: 'unknown' });
  expect(createPurchaseOrder).not.toHaveBeenCalled();
});

it('freshly checks a matched case before attempting its children', async () => {
  vi.clearAllMocks();
  const row: CycleRow = { caseRef: 'C', type: 'PR', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PR', status: 'Draft', date: undefined, amount: undefined, rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const listCases = vi.fn().mockResolvedValueOnce([{ id: 'one', import_key: 'C', import_batch_id: BATCH_ID }]).mockResolvedValue([{ id: 'one', import_key: 'C', import_batch_id: BATCH_ID }, { id: 'two', import_key: 'C', import_batch_id: null }]);
  const lookup = makeStubSkipLookup({ listCases, listCaseRecords: vi.fn().mockResolvedValue([]) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].headerStatus).toBe('failed');
  expect(createPurchaseRequest).not.toHaveBeenCalled();
});

it('fails closed when a caller cannot use the normalized case lookup', async () => {
  vi.clearAllMocks();
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [], errors: [] }, rows: [] };
  const lookup = makeStubSkipLookup({ listCases: undefined, findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].headerStatus).toBe('failed');
  expect(createProcurement).not.toHaveBeenCalled();
});

it('reports unattempted records after a header write fails', async () => {
  vi.clearAllMocks();
  vi.mocked(createProcurement).mockRejectedValue(new Error('header failed'));
  const row: CycleRow = { caseRef: 'C', type: 'PR', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PR', status: 'Draft', date: undefined, amount: undefined, rowNumber: 1 };
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows: [row], errors: [] }, rows: [{ rowNumber: 1, valid: true, errors: [] }] };
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([]), listCaseRecords: vi.fn().mockResolvedValue([]) });
  const result = await commitGroups([group], { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup });
  expect(result.cases[0].records[0]).toMatchObject({ rowNumber: 1, status: 'failed', error: expect.stringMatching(/not attempted/i) });
  expect(createPurchaseRequest).not.toHaveBeenCalled();
});

it('creates, retries and reclassifies a race for tax-distinct invoices with the same legacy key', async () => {
  vi.clearAllMocks();
  const common = { caseRef: 'C', title: 'C', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: undefined, type: 'VI', status: 'Received', date: '2025-01-01', amount: '100', taxTreatment: 'exclusive' };
  const rows: CycleRow[] = [{ ...common, taxAmount: '1', rowNumber: 1 }, { ...common, taxAmount: '2', rowNumber: 2 }];
  const group: ValidatedGroup = { valid: true, groupErrors: [], group: { caseRef: 'C', attrs: { title: 'C', project: undefined, caseStatus: undefined }, rows, errors: [] }, rows: rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] })) };
  const stored: Array<{ id: string; import_key: string; import_batch_id: string; import_identity_version: number; import_identity_facts: (string | null)[] }> = [];
  const listCaseRecords = vi.fn().mockImplementation(async (_table: string, _case: string, keys: string[]) => stored.filter(item => keys.includes(item.import_key)));
  const lookup = makeStubSkipLookup({ listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: BATCH_ID }]), listCaseRecords });
  vi.mocked(createInvoice).mockImplementation(async input => {
    const facts = [null, 'Received', '2025-01-01', '100.00', 'exclusive', Number(input.taxAmount).toFixed(2)];
    const item = { id: `invoice-${input.taxAmount}`, import_key: input.importKey!, import_batch_id: BATCH_ID, import_identity_version: 2, import_identity_facts: facts };
    stored.push(item);
    if (input.taxAmount === 2) throw Object.assign(new Error('race'), { code: '23505' });
    return { id: item.id } as never;
  });
  const options = { requestedById: REQUESTER, projectLookup, vendorLookup, importBatchId: BATCH_ID, skipLookup: lookup };
  const first = await commitGroups([group], options);
  expect(first.cases[0].records.map(record => [record.status, record.id])).toEqual([['created', 'invoice-1'], ['skipped', 'invoice-2']]);
  const retry = await commitGroups([group], options);
  expect(retry.cases[0].records.map(record => [record.status, record.id])).toEqual([['skipped', 'invoice-1'], ['skipped', 'invoice-2']]);
  expect(createInvoice).toHaveBeenCalledTimes(2);
});
