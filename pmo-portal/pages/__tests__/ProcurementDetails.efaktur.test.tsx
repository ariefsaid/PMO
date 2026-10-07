import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const spies = vi.hoisted(() => ({
  setEfaktur: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
}));

// #893 AC-EFK-005 — the procurement page wires the Documents-tab e-Faktur edit to its mutation + toast.
// Harness copied from ProcurementDetails.tabshell.test.tsx.

// ---------------------------------------------------------------------------
// Mutable hook state (mirrors ProcurementDetails.test.tsx's harness)
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => ({
    createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false },
    createRfq: { mutateAsync: vi.fn(), isPending: false },
    createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false },
    createPayment: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/pages/procurement/ProcurementFilesSubsection', () => ({
  ProcurementFilesSubsection: () => null,
}));

// LedgerFileCell's AttachButton calls useProcurementFiles → useQuery → needs a QueryClient.
// Stub the hook so tabshell tests stay QueryClient-free.
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: vi.fn(() => ({
    list: { data: [], isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(async () => 'https://signed/url'),
    progress: null,
    uploadError: null,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  })),
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: vi.fn(), isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn(), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn(), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
    setEfaktur: { mutateAsync: spies.setEfaktur, isPending: false },
  }),
}));
const docsState = { data: [], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useProcurementCrudMutations: () => ({
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    createItem: { mutateAsync: vi.fn(), isPending: false },
    updateItem: { mutateAsync: vi.fn(), isPending: false },
    deleteItem: { mutateAsync: vi.fn(), isPending: false },
    selectQuote: { mutateAsync: vi.fn(), isPending: false },
    createDocument: { mutateAsync: vi.fn(), isPending: false },
    deleteDocument: { mutateAsync: vi.fn(), isPending: false },
  }),
  useProcurementDocuments: () => docsState,
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Finance' }),
}));
let mockEffectiveRole = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockEffectiveRole, realRole: mockEffectiveRole }),
}));
const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast: spies.toast }) };
});
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import ProcurementDetails from '../ProcurementDetails';

const orderedProcurement = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Ordered' as const,
  total_value: 50000, currency: 'USD',
  pr_number: 'PR-2601100001',
  po_number: 'PO-2601100001',
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: 'u-finance',
  vendor_id: 'v-1',
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001', budget: 1000000, spent: 500000 },
  vendor: { name: 'Apex Supply' },
  requested_by: { full_name: 'Alice Manager' },
  approved_by: { full_name: 'Finance User' },
  items: [
    { id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Desk', description: null, quantity: 2, rate: 100, amount: 200 },
  ],
  quotations: [
    { id: 'q-1', procurement_id: 'proc-001', vendor_id: 'v-1', total_amount: 48000, currency: 'USD', vq_number: 'VQ-2601100001', is_selected: true, reference: 'VQ-2601100001', received_date: '2026-01-10', org_id: 'org-1', created_at: '2026-01-10T00:00:00Z' },
  ],
  receipts: [],
  invoices: [
    {
      id: 'vi-1', org_id: 'org-1', procurement_id: 'proc-001', vi_number: 'VI-2601100001', status: 'Received',
      invoice_date: '2026-06-05', created_at: '2026-06-05T00:00:00Z', po_id: null, reference_number: null,
      amount: 48000, currency: 'USD', tax_treatment: 'exclusive', tax_rate: null, tax_base_numerator: 1,
      tax_base_denominator: 1, erp_docstatus: null, erp_cancelled_at: null, external_ref: null,
      efaktur_number: null, efaktur_date: null,
    },
  ],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [
    { id: 'se1', procurement_id: 'proc-001', from_status: null, to_status: 'Requested', actor_id: 'u-other', created_at: '2026-04-28T09:00:00Z', org_id: 'org-1' },
    { id: 'se2', procurement_id: 'proc-001', from_status: 'Requested', to_status: 'Approved', actor_id: 'u-finance', created_at: '2026-04-29T09:00:00Z', org_id: 'org-1' },
  ],
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProcurementDetails — e-Faktur on the Documents tab', () => {
  beforeEach(() => {
    detailState.data = orderedProcurement;
    mockEffectiveRole = 'Finance';
    spies.setEfaktur.mockClear();
    spies.toast.mockClear();
  });

  it('AC-EFK-005 Finance records a vendor e-Faktur from the ledger and sees a success toast', async () => {
    const user = userEvent.setup();
    renderAt('/procurement/proc-001/documents');
    const row = screen.getByText('VI-2601100001').closest('tr');
    if (!row) throw new Error('no ledger row for the vendor invoice');
    await user.click(within(row).getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit e-Faktur' }));
    await user.type(screen.getByLabelText('e-Faktur number'), '010.001-26.12345678');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(spies.setEfaktur).toHaveBeenCalledWith({
      invoiceId: 'vi-1', efakturNumber: '010.001-26.12345678', efakturDate: null,
    }));
    await waitFor(() => expect(spies.toast).toHaveBeenCalledWith('e-Faktur details saved', 'VI-2601100001', 'success'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
