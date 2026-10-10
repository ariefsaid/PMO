import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  detail: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  updateVendor: vi.fn().mockResolvedValue(undefined),
  history: { data: { pages: [{ rows: [{ slip_id: 'slip-history', slip_number: 'TAX-HISTORY', status: 'void' }] }] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() },
}));
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => h.detail,
  useProcurementMutations: () => ({ transition: { mutateAsync: vi.fn(), isPending: false }, createQuotation: { mutateAsync: vi.fn(), isPending: false }, createReceipt: { mutateAsync: vi.fn(), isPending: false }, createInvoice: { mutateAsync: vi.fn(), isPending: false }, captureVendorInvoice: { mutateAsync: vi.fn(), isPending: false }, setEfaktur: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({ useProcurementCrudMutations: () => ({ updateHeader: { mutateAsync: vi.fn(), isPending: false }, updateVendor: { mutateAsync: h.updateVendor, isPending: false }, createItem: { mutateAsync: vi.fn(), isPending: false }, updateItem: { mutateAsync: vi.fn(), isPending: false }, deleteItem: { mutateAsync: vi.fn(), isPending: false }, selectQuote: { mutateAsync: vi.fn(), isPending: false } }) }));
vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => h.history,
  useVendorWithholdingSlipMutations: () => ({ record: { mutateAsync: vi.fn(), isPending: false }, correct: { mutateAsync: vi.fn(), isPending: false }, void: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/pages/procurement/VendorWithholdingSlipModal', () => ({ VendorWithholdingSlipModal: ({ invoice, onSave }: { invoice: { id: string }; onSave: (input: { slipId: string }) => void }) => <div role="dialog" aria-label="Record modal"><span>{invoice.id}</span><button onClick={() => onSave({ slipId: 'new-slip' })}>Save evidence</button></div> }));
vi.mock('@/pages/procurement/VendorWithholdingSlipDetails', () => ({ VendorWithholdingSlipDetails: ({ slipId, onClose, onOpenProcurement, suppressArrivalFocus }: { slipId: string; onClose: () => void; onOpenProcurement?: (procurementId: string, slipId: string, invoiceId: string) => void; suppressArrivalFocus?: boolean }) => <div data-testid="slip-detail" data-suppress-arrival-focus={suppressArrivalFocus ? 'true' : 'false'}>Details: {slipId}<button onClick={onClose}>Close slip</button><button onClick={() => onOpenProcurement?.('case-b', slipId, 'invoice-2')}>Open bill in case</button></div> }));
vi.mock('@/pages/procurement/ProcurementLedger', () => ({ ProcurementLedger: ({ invoices, onRecordWithholdingSlip, onWithholdingHistory, onSetVendor, vendorMissing, canWriteWithholdingSlip, targetInvoiceId }: { invoices: { id: string; vi_number?: string }[]; onRecordWithholdingSlip: (invoice: { id: string }) => void; onWithholdingHistory: (invoiceId: string) => void; onSetVendor?: () => void; vendorMissing: boolean; canWriteWithholdingSlip: boolean; targetInvoiceId?: string }) => <section aria-label="Bill row" data-target-invoice={targetInvoiceId}><span>{invoices[0]?.vi_number}</span>{vendorMissing ? <button onClick={onSetVendor}>Set vendor</button> : canWriteWithholdingSlip ? <button onClick={() => onRecordWithholdingSlip(invoices[0])}>Record bukti potong</button> : null}<button onClick={() => onWithholdingHistory(invoices[0].id)}>Bill history</button></section> }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [{ value: 'vendor-new', label: 'New vendor' }] }), useProjectOptions: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'requester', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false }) }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: 1, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectCommittedSpend: () => ({ data: 0 }), useProjectReservedSpend: () => ({ data: 0 }) }));
vi.mock('@/src/hooks/useAgentContext', () => ({ useAgentContext: () => ({ setEntity: vi.fn() }) }));
vi.mock('@/src/hooks/useListReturn', () => ({ useListReturn: () => ({ returnToList: vi.fn() }) }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

import ProcurementDetails from '../ProcurementDetails';

const procurement = {
  id: 'proc-001', code: 'PROC-001', title: 'Office equipment', status: 'Paid' as const, total_value: 50000, currency: 'IDR',
  pr_number: 'PR-001', po_number: null, vq_number: null, approval_notes: null, rejection_notes: null,
  requested_by_id: 'requester', approved_by_id: null, vendor_id: 'vendor-1', project_id: 'project-1', org_id: 'org-1',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', project: null, vendor: null,
  requested_by: null, approved_by: null, items: [], quotations: [], receipts: [],
  invoices: [{ id: 'invoice-1', vi_number: 'VI-001', currency: 'IDR', withheld_amount: 20000, withheld_pph_type: 'pph23' }],
  purchase_requests: [], rfqs: [], purchase_orders: [], payments: [], statusEvents: [],
};
function LocationText() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/procurement/:procurementId/:tab?" element={<><ProcurementDetails /><LocationText /></>} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  h.detail.data = procurement; h.detail.isPending = false; h.detail.isError = false; h.detail.error = null;
  h.updateVendor.mockClear();
  h.history.data = { pages: [{ rows: [{ slip_id: 'slip-history', slip_number: 'TAX-HISTORY', status: 'void' }] }] };
  h.history.isLoading = false; h.history.isError = false;
});

describe('AC-BUPOT-016/018 ProcurementDetails wiring', () => {
  it('lets Finance set only the missing vendor on a billed request, then permits slip recording', async () => {
    const vendorlessBilled = { ...procurement, vendor_id: null };
    h.detail.data = vendorlessBilled;
    const view = renderAt('/procurement/proc-001/documents');
    fireEvent.click(screen.getByRole('button', { name: 'Set vendor' }));

    fireEvent.click(screen.getByRole('combobox', { name: 'Vendor' }));
    expect(await screen.findByRole('option', { name: 'New vendor' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'New vendor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save vendor' }));

    await waitFor(() => expect(h.updateVendor).toHaveBeenCalledWith('vendor-new'));
    h.detail.data = { ...vendorlessBilled, vendor_id: 'vendor-new' };
    view.rerender(<MemoryRouter initialEntries={['/procurement/proc-001/documents']}><Routes><Route path="/procurement/:procurementId/:tab?" element={<><ProcurementDetails /><LocationText /></>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Record bukti potong' }));
    expect(screen.getByRole('dialog', { name: 'Record modal' })).toHaveTextContent('invoice-1');
  });

  it('opens the record modal from a paid bill row', () => {
    renderAt('/procurement/proc-001/documents');
    expect(screen.getAllByText('VI-001')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Record bukti potong' }));
    expect(screen.getByRole('dialog', { name: 'Record modal' })).toHaveTextContent('invoice-1');
    expect(screen.getByRole('button', { name: 'Save evidence' })).toBeInTheDocument();
  });

  it('opens slip details from the URL and closing removes bupot targets, preserving other params', async () => {
    renderAt('/procurement/proc-001?keep=1&bupot=slip-from-url&bupotBill=invoice-2&tabHint=history');
    expect(screen.getByTestId('slip-detail')).toHaveTextContent('Details: slip-from-url');
    fireEvent.click(screen.getByRole('button', { name: 'Close slip' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/procurement/proc-001?keep=1&tabHint=history'));
  });

  it('#961 open-case-scroll carries the selected slip and linked bill to the target Documents ledger', async () => {
    renderAt('/procurement/proc-001?bupot=slip-from-url');
    fireEvent.click(screen.getByRole('button', { name: 'Open bill in case' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/procurement/case-b/documents?bupot=slip-from-url&bupotBill=invoice-2'));
    expect(screen.getByRole('tab', { name: /^Documents/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('slip-detail')).toHaveTextContent('Details: slip-from-url');
    expect(screen.getByTestId('slip-detail')).toHaveAttribute('data-suppress-arrival-focus', 'true');
    expect(screen.getByRole('region', { name: 'Bill row' })).toHaveAttribute('data-target-invoice', 'invoice-2');
  });

  it('#961 F15 states that this bill has no withholding history', async () => {
    h.history.data = { pages: [{ rows: [] }] };
    renderAt('/procurement/proc-001/documents');
    fireEvent.click(screen.getByRole('button', { name: 'Bill history' }));
    expect(await screen.findByText('No withholding slips recorded for this bill.')).toBeInTheDocument();
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens a retained slip from the bill history entry point, including void entries', async () => {
    renderAt('/procurement/proc-001/documents');
    const historyOpener = screen.getByRole('button', { name: 'Bill history' });
    historyOpener.focus();
    fireEvent.click(historyOpener);
    expect(await screen.findByRole('heading', { name: 'Bukti potong history', level: 2 })).toHaveFocus();
    expect(screen.getByText(/TAX-HISTORY · void/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(historyOpener).toHaveFocus());
    fireEvent.click(historyOpener);
    fireEvent.click(screen.getByRole('button', { name: 'View bukti potong' }));
    expect(screen.getByTestId('slip-detail')).toHaveTextContent('Details: slip-history');
  });
});
