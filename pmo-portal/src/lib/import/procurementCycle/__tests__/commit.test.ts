import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRefLookup } from '@/src/lib/import/refLookup';
import type { ValidatedGroup } from '../types';

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
            status: 'Received', date: '2025-01-15', amount: '5000', rowNumber: 1,
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
    expect(createInvoice).toHaveBeenCalledWith(
      'proc-1',
      'Received',
      '2025-01-15',
      'EXT-001',
      5000,
    );

    // createPayment called with invoiceId = 'inv-1' (the VI created in this group)
    expect(createPayment).toHaveBeenCalledWith(
      'proc-1',
      'inv-1',     // invoiceId = the VI's id
      'PAY-001',
      'Paid',
      '2025-02-01',
      5000,
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
    expect(result.cases[0].records).toHaveLength(0);
    expect(createPurchaseRequest).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0); // header fail doesn't count as record failure
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
