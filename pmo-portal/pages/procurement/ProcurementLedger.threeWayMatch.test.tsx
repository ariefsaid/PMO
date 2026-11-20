import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail, ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';

/** #2622: with the three-way match on, a held bill is named in the ledger and its match opens from the bill. */
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
vi.mock('./BillMatchDrawer', () => ({ BillMatchDrawer: ({ invoiceId, billLabel }: { invoiceId: string; billLabel: string }) => <div role="dialog" aria-label={`match ${billLabel}`}>{invoiceId}</div> }));
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

describe('ProcurementLedger — three-way match (#2622)', () => {
  it('AC-TWM-014 a held bill is named with Review match, which opens its match; a matched bill is not', () => {
    h.statuses = { 'vi-1': 'held', 'vi-2': 'matched' };
    renderLedger([invoice('vi-1', 'VI-1'), invoice('vi-2', 'VI-2')]);
    const held = screen.getByTestId('bill-match-held-vi-1');
    expect(held).toHaveTextContent('VI-1 is held by the three-way match, so payments wait.');
    expect(screen.queryByTestId('bill-match-held-vi-2')).toBeNull();
    fireEvent.click(within(held).getByRole('button', { name: 'Review match' }));
    expect(screen.getByRole('dialog', { name: 'match VI-1' })).toHaveTextContent('vi-1');
  });

  it('AC-TWM-014 every live bill offers its three-way match from the row menu; a voided bill is not read', () => {
    renderLedger([invoice('vi-1', 'VI-1'), invoice('vi-9', 'VI-9', { voided_at: '2026-11-02T00:00:00Z' })]);
    expect(h.matchIds).toEqual(['vi-1']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Three-way match' }));
    expect(screen.getByRole('dialog', { name: 'match VI-1' })).toBeInTheDocument();
  });

  it('with the match off, nothing is read and nothing is offered', () => {
    h.on = false;
    renderLedger([invoice('vi-1', 'VI-1')]);
    expect(h.matchIds).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Three-way match' })).toBeNull();
  });

  it('an Engineer (no bill access) is offered no match', () => {
    h.role = 'Engineer';
    renderLedger([invoice('vi-1', 'VI-1')]);
    expect(h.matchIds).toEqual([]);
  });
});
