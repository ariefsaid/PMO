import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail, ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';

/** #2634 (AC-TWM-023): with the match on, the ledger offers the line editors where a person could use them (the database decides the rest). */
const h = vi.hoisted(() => ({ role: 'Finance', on: true, statuses: {} as Record<string, string>, matchIds: [] as string[] }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-finance', org_id: 'org-1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role, canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => ({
    createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false }, createRfq: { mutateAsync: vi.fn(), isPending: false },
    createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false }, createPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({ list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn(), isPending: false }, archive: { mutate: vi.fn(), isPending: false }, download: vi.fn(), progress: null, uploadError: null, cancelUpload: vi.fn(), clearUploadError: vi.fn() }),
}));
vi.mock('@/src/hooks/useSubcontract', () => ({ useSubcontractMutations: () => ({ voidBill: { mutateAsync: vi.fn(), isPending: false } }) }));
vi.mock('@/src/lib/db/procurementFiles', () => ({ listProcurementFiles: vi.fn(), getSignedDownloadUrl: vi.fn() }));
vi.mock('@/src/hooks/useThreeWayMatch', () => ({
  useThreeWayMatchOn: () => ({ on: h.on }),
  useBillMatches: (ids: string[], enabled: boolean) => { h.matchIds = enabled ? ids : []; return ids.map((id) => ({ data: enabled && h.statuses[id] ? { status: h.statuses[id] } : undefined })); },
  useApproveBillMatchException: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./BillMatchDrawer', () => ({ BillMatchDrawer: () => null }));
vi.mock('./MatchLinesEditor', () => ({ MatchLinesEditor: ({ kind, targetId, label }: { kind: string; targetId: string; label: string }) => <div role="dialog" aria-label={`editor ${kind} ${label}`}>{targetId}</div> }));
import { ProcurementLedger } from './ProcurementLedger';

const detail = { id: 'proc-1', status: 'Vendor Invoiced', created_at: '2026-11-01T00:00:00Z', purchase_orders: [{ id: 'po-1' }] } as unknown as ProcurementDetail;
const row = (id: string, number: string): LedgerRow => ({
  id: `Invoice-${id}`, date: '2026-11-01', type: 'Invoice', systemNumber: number, externalRef: null,
  amount: 1000, status: 'Received', statusVariant: 'neutral', fileHref: null, fileTitle: null, fileCount: 0,
  financial: true, recordId: id, currency: 'IDR', taxTreatment: 'exclusive',
  efakturNumber: null, efakturDate: null, efakturLocked: false, voidable: false, voided: null, poId: 'po-1',
});
const invoice = (id: string, number: string, extra: Partial<ProcurementInvoiceRow> = {}) => ({ id, vi_number: number, reference_number: null, voided_at: null, ...extra }) as ProcurementInvoiceRow;

function renderLedger(invoices: ProcurementInvoiceRow[]) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
    <ProcurementLedger detail={detail} rows={invoices.map((i) => row(i.id, i.vi_number ?? ''))} procurementId="proc-1" uploadedById={null} canWrite={false} invoices={invoices} />
  </QueryClientProvider></MemoryRouter>);
}

beforeEach(() => { h.role = 'Finance'; h.on = true; h.statuses = {}; h.matchIds = []; });


const receiptRow = (id: string, number: string): LedgerRow => ({ ...row(id, number), id: `GR-${id}`, type: 'GR', systemNumber: number, amount: null, poId: undefined } as LedgerRow);
function renderFull(invoices: ProcurementInvoiceRow[], detailOver: Record<string, unknown> = {}, extraRows: LedgerRow[] = []) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
    <ProcurementLedger detail={{ ...detail, ...detailOver } as ProcurementDetail} rows={[...extraRows, ...invoices.map((i) => row(i.id, i.vi_number ?? ''))]}
      procurementId="proc-1" uploadedById={null} canWrite={false} invoices={invoices} />
  </QueryClientProvider></MemoryRouter>);
}

describe('ProcurementLedger — match line editors (#2634)', () => {
  it('AC-TWM-023 a held bill offers Edit bill lines, which opens the bill editor for that bill', () => {
    h.statuses = { 'vi-1': 'held' };
    renderFull([invoice('vi-1', 'VI-1')]);
    fireEvent.click(within(screen.getByTestId('bill-match-held-vi-1')).getByRole('button', { name: 'Edit bill lines' }));
    expect(screen.getByRole('dialog', { name: 'editor bill VI-1' })).toHaveTextContent('vi-1');
  });

  it('AC-TWM-023 a matched bill offers the editor from its row menu', () => {
    h.statuses = { 'vi-1': 'matched' };
    renderFull([invoice('vi-1', 'VI-1')]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit bill lines' }));
    expect(screen.getByRole('dialog', { name: 'editor bill VI-1' })).toBeInTheDocument();
  });

  it('AC-TWM-023 no editor for a Paid bill, an approved exception, a bill outside the match, or an unread match', () => {
    h.statuses = { 'vi-1': 'held', 'vi-2': 'exception_approved', 'vi-3': 'not_applicable' };
    renderFull([invoice('vi-1', 'VI-1', { status: 'Paid' }), invoice('vi-2', 'VI-2'), invoice('vi-3', 'VI-3'), invoice('vi-4', 'VI-4')]);
    expect(within(screen.getByTestId('bill-match-held-vi-1')).queryByRole('button', { name: 'Edit bill lines' })).toBeNull();
    for (const button of screen.getAllByRole('button', { name: 'Row actions' })) {
      fireEvent.click(button);
      expect(screen.queryByRole('menuitem', { name: 'Edit bill lines' })).toBeNull();
      fireEvent.keyDown(document.body, { key: 'Escape' });
    }
  });

  it('AC-TWM-023 a goods receipt offers Record received quantities while the purchase is open', () => {
    renderFull([], {}, [receiptRow('r-1', 'GR-1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record received quantities' }));
    expect(screen.getByRole('dialog', { name: 'editor receipt GR-1' })).toHaveTextContent('r-1');
  });

  it('AC-TWM-023 no receipt editor for a Paid or Cancelled purchase, a subcontract purchase, the match off, or a role that cannot edit', () => {
    for (const over of [{ status: 'Paid' }, { status: 'Cancelled' }, { is_subcontract: true }]) {
      const { unmount } = renderFull([], over, [receiptRow('r-1', 'GR-1')]);
      expect(screen.queryByRole('button', { name: 'Row actions' })).toBeNull();
      unmount();
    }
    h.on = false;
    let view = renderFull([], {}, [receiptRow('r-1', 'GR-1')]);
    expect(screen.queryByRole('button', { name: 'Row actions' })).toBeNull();
    view.unmount();
    h.on = true; h.role = 'Engineer';
    view = renderFull([], {}, [receiptRow('r-1', 'GR-1')]);
    expect(screen.queryByRole('button', { name: 'Row actions' })).toBeNull();
  });
});
