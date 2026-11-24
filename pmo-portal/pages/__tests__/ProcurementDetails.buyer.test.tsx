import { render as rtlRender, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClientTestProvider } from '@/test/QueryClientTestProvider';
// C11: the follow-up task button mounts with its host page now, so every render here runs
// inside the shared test query client and the button's open-task read is stubbed quiet.
const render = ((ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(<QueryClientTestProvider>{ui}</QueryClientTestProvider>, options)) as typeof rtlRender;
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { repositories: { ...actual.repositories, task: { ...actual.repositories.task, findOpenForRecord: async () => null } } };
});

import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  detail: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  updateVendor: vi.fn().mockResolvedValue(undefined),
  history: { data: { pages: [{ rows: [{ slip_id: 'slip-history', slip_number: 'TAX-HISTORY', status: 'void' }] }] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() },
  realRole: 'Engineer',
  effectiveRole: 'Engineer',
  mayOrder: true,
  toast: vi.fn(),
  vendor: { data: [{ value: 'vendor-new', label: 'New supplier' }], isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useProcurementFilesBatch', () => ({ useProcurementFilesBatch: () => ({ data: undefined, isError: false }) }));
vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/hooks/useProcurementItemEligibility', () => ({ useProcurementItemEligibility: () => ({ data: true, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }) }));

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
vi.mock('@/pages/procurement/ProcurementLedger', () => ({ ProcurementLedger: ({ invoices, onRecordWithholdingSlip, onWithholdingHistory, onSetVendor, vendorMissing, canWriteWithholdingSlip, targetInvoiceId }: { invoices: { id: string; vi_number?: string }[]; onRecordWithholdingSlip: (invoice: { id: string }) => void; onWithholdingHistory: (invoiceId: string) => void; onSetVendor?: () => void; vendorMissing: boolean; canWriteWithholdingSlip: boolean; targetInvoiceId?: string }) => <section aria-label="Bill row" data-target-invoice={targetInvoiceId}><span>{invoices[0]?.vi_number}</span>{vendorMissing && onSetVendor ? <button onClick={onSetVendor}>Set supplier</button> : canWriteWithholdingSlip ? <button onClick={() => onRecordWithholdingSlip(invoices[0])}>Record bukti potong</button> : null}<button onClick={() => onWithholdingHistory(invoices[0].id)}>Bill history</button></section> }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => h.vendor, useProjectOptions: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'buyer', org_id: 'org-1', built_in_role: 'buyer' } }) }));
// The database gate itself (actor_may_order_purchases), as the page reads it.
vi.mock('@/src/hooks/useOrderJobRoles', () => ({ useMayOrderPurchases: () => h.mayOrder }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.effectiveRole }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false }) }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: 1, isPending: false, isError: false }) }));
// The budget panel and header line also read the project's budget positions (no QueryClient is mounted here).
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectCommittedSpend: () => ({ data: 0 }), useProjectReservedSpend: () => ({ data: 0 }) }));
vi.mock('@/src/hooks/useAgentContext', () => ({ useAgentContext: () => ({ setEntity: vi.fn() }) }));
vi.mock('@/src/hooks/useListReturn', () => ({ useListReturn: () => ({ returnToList: vi.fn() }) }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: h.toast }) };
});

vi.mock('@/src/hooks/useProcurementRecords', () => ({ useProcurementRecordMutations: () => ({ createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false }, createRfq: { mutateAsync: vi.fn(), isPending: false }, createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false }, createPayment: { mutateAsync: vi.fn(), isPending: false } }) }));
vi.mock('@/src/hooks/useProcurementFiles', () => import('@/pages/__tests__/helpers/procurementFilesMock'));
vi.mock('@/src/hooks/useProjects', () => import('@/pages/__tests__/helpers/projectScopeMock'));
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
import ProcurementDetails from '../ProcurementDetails';

// Another requester's approved purchase with no supplier yet.
const procurement = {
  id: 'proc-001', code: 'PROC-001', title: 'Scaffold hire', status: 'Approved' as const, total_value: 50000, currency: 'IDR',
  pr_number: 'PR-001', po_number: null, vq_number: null, approval_notes: null, rejection_notes: null,
  requested_by_id: 'someone-else', approved_by_id: 'approver', vendor_id: null, project_id: 'project-1', org_id: 'org-1',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', project: null, vendor: null,
  requested_by: null, approved_by: null, items: [], quotations: [], receipts: [], invoices: [],
  purchase_requests: [], rfqs: [], purchase_orders: [], payments: [], statusEvents: [],
};
function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/procurement/:procurementId/:tab?" element={<ProcurementDetails />} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  h.detail.data = procurement; h.detail.isPending = false; h.detail.isError = false; h.detail.error = null;
  h.updateVendor.mockClear();
  h.vendor.isPending = false; h.vendor.isError = false; h.vendor.data = [{ value: 'vendor-new', label: 'New supplier' }];
  h.realRole = 'Engineer'; h.effectiveRole = 'Engineer'; h.mayOrder = true;
});

describe('a Buyer (job role at Engineer access level) on an approved purchase it did not raise', () => {
  it('opens the purchase and names its supplier through the narrow command', async () => {
    renderAt('/procurement/proc-001/overview');
    expect(screen.queryByTestId('procurement-no-access')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('buyer-set-supplier'));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Supplier' }));
    fireEvent.click(await screen.findByRole('option', { name: 'New supplier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    await waitFor(() => expect(h.updateVendor).toHaveBeenCalledWith({ vendorId: 'vendor-new', byBuyer: true }));
  });

  it('still gets the Engineer view: the manager-only ledger with its money rows is not shown', () => {
    renderAt('/procurement/proc-001/files');
    expect(screen.queryByRole('region', { name: 'Bill row' })).not.toBeInTheDocument();
  });

  it('an Engineer the database does not let order purchases is refused the same record, as before', () => {
    h.mayOrder = false;
    renderAt('/procurement/proc-001/overview');
    expect(screen.getByTestId('procurement-no-access')).toBeInTheDocument();
    expect(screen.queryByTestId('buyer-set-supplier')).not.toBeInTheDocument();
  });

  it('is offered no supplier action once the purchase is past approval or already names one', () => {
    h.detail.data = { ...procurement, status: 'PO Issued' };
    const view = renderAt('/procurement/proc-001/overview');
    expect(screen.queryByTestId('buyer-set-supplier')).not.toBeInTheDocument();
    view.unmount();
    h.detail.data = { ...procurement, vendor_id: 'vendor-1', vendor: { id: 'vendor-1', name: 'Old supplier' } };
    renderAt('/procurement/proc-001/overview');
    expect(screen.queryByTestId('buyer-set-supplier')).not.toBeInTheDocument();
  });
});

it("a named routed approver can inspect the request before deciding", () => {
  h.mayOrder = false; h.realRole = "Project Manager"; h.effectiveRole = "Project Manager";
  h.detail.data = { ...procurement, status: "Requested", approvalRoute: { route: "org", approvers: [{ id: "buyer", fullName: "Reviewer" }] } };
  renderAt("/procurement/proc-001/overview");
  expect(screen.queryByTestId("procurement-no-access")).not.toBeInTheDocument();
});

it("JOB-PU4 an Approved purchase explains sourcing and offers Request quotations before adding quotes", async () => {
  renderAt("/procurement/proc-001/quotes");
  expect(await screen.findByTestId("quote-next-step")).toHaveTextContent("Request quotations");
  expect(screen.queryByTestId("add-quotation")).not.toBeInTheDocument();
});
