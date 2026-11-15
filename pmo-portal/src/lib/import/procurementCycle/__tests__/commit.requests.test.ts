import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRefLookup } from '@/src/lib/import/refLookup';
import type { ImportSkipLookup, ImportRecordMatch } from '@/src/lib/db/procurementImportSkip';
import type { CycleRow, ValidatedGroup } from '../types';
import { computeCaseImportKey, computeLegacyRecordImportKey, computeRecordImportKey, projectRecordFacts } from '../importKey';

vi.mock('@/src/lib/analytics', async importOriginal => ({ ...await importOriginal<typeof import('@/src/lib/analytics')>(), trackSaveFailed: vi.fn(), trackBulkImportFailed: vi.fn() }));
vi.mock('@/src/lib/db/procurementCrud', () => ({ createProcurement: vi.fn() }));
vi.mock('@/src/lib/db/procurementRecords', () => ({ createPurchaseRequest: vi.fn(), createRfq: vi.fn(), createPurchaseOrder: vi.fn(), createPayment: vi.fn() }));
vi.mock('@/src/lib/db/procurementLifecycle', () => ({ createQuotation: vi.fn(), createReceipt: vi.fn(), createInvoice: vi.fn() }));

import { commitGroups } from '../commit';
import { createProcurement } from '@/src/lib/db/procurementCrud';
import { createPurchaseRequest, createPurchaseOrder, createPayment } from '@/src/lib/db/procurementRecords';
import { createInvoice } from '@/src/lib/db/procurementLifecycle';

// #2113: pins what an import writes and how it fails, and counts the identity reads it spends to do so.
const BATCH = 'batch-1';
const projectLookup = makeRefLookup([{ id: 'proj-1', name: 'Solar EPC' }], 'Project');
const vendorLookup = makeRefLookup([{ id: 'vend-1', name: 'Acme Supplies' }], 'Vendor');

const row = (caseRef: string, type: CycleRow['type'], rowNumber: number, extra: Partial<CycleRow> = {}): CycleRow => ({
  caseRef, type, title: undefined, project: undefined, caseStatus: undefined, vendor: undefined,
  externalRef: `${type}-${caseRef}`, status: type === 'Payment' ? 'Paid' : type === 'VI' ? 'Received' : 'Approved', date: '2025-01-15', amount: '100', rowNumber, ...extra,
});
const makeGroup = (caseRef: string): ValidatedGroup => {
  const rows = [row(caseRef, 'PR', 1), row(caseRef, 'PO', 2, { status: 'Ordered' }), row(caseRef, 'VI', 3, { taxTreatment: 'inclusive', taxAmount: '10' }), row(caseRef, 'Payment', 4)];
  return { valid: true, groupErrors: [], group: { caseRef, attrs: { title: `Case ${caseRef}`, project: 'Solar EPC', caseStatus: undefined }, rows, errors: [] }, rows: rows.map(r => ({ rowNumber: r.rowNumber, valid: true, errors: [] })) };
};

function stubLookup(existing: { cases?: ImportRecordMatch[]; records?: (table: string, caseId: string) => ImportRecordMatch[] } = {}) {
  const listCases = vi.fn(async () => existing.cases ?? []);
  const listCaseRecords = vi.fn(async (table: string, caseId: string) => existing.records?.(table, caseId) ?? []);
  const lookup: ImportSkipLookup = { findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCases, listCaseRecords };
  return { lookup, listCases, listCaseRecords };
}

function mockWrites() {
  vi.mocked(createProcurement).mockImplementation(async (input) => ({ id: `proc-${input.title}` }) as never);
  vi.mocked(createPurchaseRequest).mockImplementation(async () => ({ id: 'pr' }) as never);
  vi.mocked(createPurchaseOrder).mockImplementation(async () => ({ id: 'po' }) as never);
  vi.mocked(createInvoice).mockImplementation(async () => ({ id: 'vi' }) as never);
  vi.mocked(createPayment).mockImplementation(async () => ({ id: 'pay' }) as never);
}

const opts = (lookup: ImportSkipLookup) => ({ requestedById: 'u1', projectLookup, vendorLookup, importBatchId: BATCH, skipLookup: lookup });
const writes = () => [
  ...vi.mocked(createProcurement).mock.calls.map(([i]) => ['case', i.title, i.importKey]),
  ...vi.mocked(createPurchaseRequest).mock.calls.map(c => ['PR', c[0]]),
  ...vi.mocked(createPurchaseOrder).mock.calls.map(c => ['PO', c[0]]),
  ...vi.mocked(createInvoice).mock.calls.map(([i]) => ['VI', i.procurementId, i.importKey]),
  ...vi.mocked(createPayment).mock.calls.map(c => ['Payment', c[0], c[1]]),
];

describe('commitGroups — #2113 import writes and identity-read cost', () => {
  beforeEach(() => { vi.clearAllMocks(); mockWrites(); });

  it('a new 3-case x 4-row workbook writes every case and row once, with the settlement FK, in the same shape', async () => {
    const { lookup } = stubLookup();
    const groups = ['A', 'B', 'C'].map(makeGroup);
    const result = await commitGroups(groups, opts(lookup));
    expect(result.created).toBe(12);
    expect(result.failed).toBe(0);
    expect(result.cases.map(c => [c.caseRef, c.procurementId, c.headerStatus, c.records.map(r => `${r.type}:${r.status}`)])).toEqual(
      ['A', 'B', 'C'].map(k => [k, `proc-Case ${k}`, 'created', ['PR:created', 'PO:created', 'VI:created', 'Payment:created']]));
    expect(writes()).toMatchSnapshot();
    // the settlement FK: each case's payment points at that case's invoice
    expect(vi.mocked(createPayment).mock.calls.map(c => c[1])).toEqual(['vi', 'vi', 'vi']);
  });

  it('re-importing the same workbook skips every case and row and writes nothing', async () => {
    const groups = ['A', 'B'].map(makeGroup);
    const cases = groups.map(g => ({ id: `existing-${g.group.caseRef}`, import_key: computeCaseImportKey(g.group), import_batch_id: BATCH }));
    const tableOf = { PR: 'purchase_requests', PO: 'purchase_orders', VI: 'procurement_invoices', Payment: 'payments' } as const;
    const { lookup } = stubLookup({
      cases,
      records: (table, caseId) => {
        const g = groups.find(x => `existing-${x.group.caseRef}` === caseId)!;
        return g.group.rows.filter(r => tableOf[r.type as keyof typeof tableOf] === table).map(r => {
          const invoice = r.type === 'Payment' ? 'vi-existing' : null;
          const facts = projectRecordFacts(r, null, invoice);
          return { id: `rec-${r.type}`, import_key: computeRecordImportKey(r, facts), import_batch_id: BATCH, import_identity_version: 2, import_identity_facts: facts };
        });
      },
    });
    // the first VI resolves to 'rec-VI' (not 'vi-existing'): the payment key binds to the resolved invoice id
    const result = await commitGroups(groups, opts(lookup));
    expect(vi.mocked(createProcurement)).not.toHaveBeenCalled();
    expect(vi.mocked(createInvoice)).not.toHaveBeenCalled();
    expect(result.cases.map(c => c.headerStatus)).toEqual(['skipped', 'skipped']);
    expect(result.cases[0].records.map(r => r.type + ':' + r.status).slice(0, 3)).toEqual(['PR:skipped', 'PO:skipped', 'VI:skipped']);
    void computeLegacyRecordImportKey;
  });

  it('a failed row lookup fails that row and the rest of THAT case only; other cases still commit', async () => {
    const { lookup, listCaseRecords } = stubLookup();
    listCaseRecords.mockImplementation(async (table: string, caseId: string) => {
      if (caseId === 'proc-Case B' && table === 'purchase_orders') throw new Error('lookup down');
      return [];
    });
    const result = await commitGroups(['A', 'B', 'C'].map(makeGroup), opts(lookup));
    const byCase = Object.fromEntries(result.cases.map(c => [c.caseRef, c.records.map(r => `${r.type}:${r.status}`)]));
    expect(byCase.A).toEqual(['PR:created', 'PO:created', 'VI:created', 'Payment:created']);
    expect(byCase.B).toEqual(['PR:created', 'PO:failed', 'VI:failed', 'Payment:failed']);
    expect(byCase.C).toEqual(['PR:created', 'PO:created', 'VI:created', 'Payment:created']);
    expect(vi.mocked(createPurchaseOrder)).toHaveBeenCalledTimes(2);
  });

  it('a failed case lookup fails that case with its rows not attempted; no header is written for it', async () => {
    const { lookup, listCases } = stubLookup();
    listCases.mockRejectedValue(new Error('cases down'));
    const result = await commitGroups(['A', 'B'].map(makeGroup), opts(lookup));
    expect(result.cases.map(c => c.headerStatus)).toEqual(['failed', 'failed']);
    expect(result.cases[0].records.map(r => r.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect(vi.mocked(createProcurement)).not.toHaveBeenCalled();
  });

  it('identity read cost: header = one list per case, rows = one list per row (measured before #2113: 4 and 24)', async () => {
    const { lookup, listCases, listCaseRecords } = stubLookup();
    await commitGroups(['A', 'B', 'C'].map(makeGroup), opts(lookup));
    // 3 cases: one fresh list each; 12 rows: one fresh list each. Before #2113 it was 4 header reads (a snapshot plus 3 fresh) and 24 row reads (one snapshot per table per case plus 12 fresh).
    expect(listCases).toHaveBeenCalledTimes(3);
    expect(listCaseRecords).toHaveBeenCalledTimes(12);
  });
});
