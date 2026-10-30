import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

// ---------------------------------------------------------------------------
// Mutable hook state (mirrors ProcurementDetails.test.tsx's harness)
// ---------------------------------------------------------------------------
const refs = { rows: [] as unknown[] };
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
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
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
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => ({ data: { pages: [] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() }),
  useVendorWithholdingSlipMutations: () => ({ record: { mutateAsync: vi.fn(), isPending: false }, correct: { mutateAsync: vi.fn(), isPending: false }, void: { mutateAsync: vi.fn(), isPending: false } }),
}));

vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({
  useProcurementMicrosoftReferences: () => ({ query: { data: refs.rows } }),
}));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({
  ProcurementMicrosoftReferences: (props: { procurementId: string; requestNumber: string | null; createdAt: string }) => (
    <section aria-label="Case references" data-case={props.procurementId} data-request={props.requestNumber} data-created={props.createdAt} />
  ),
}));

vi.mock('@/src/hooks/useProjects', () => import('@/pages/__tests__/helpers/projectScopeMock'));
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
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
  invoices: [],
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

describe('AC-M365DOC-058 case references on the real procurement Files tab', () => {
  beforeEach(() => {
    detailState.data = { ...orderedProcurement, project_id: null, project: null };
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Finance';
    refs.rows = [];
  });

  it('mounts the case references on the Files tab (the case ledger, #1404) for a project-less case with the request number and creation date', () => {
    renderAt('/procurement/proc-001/files');
    const section = screen.getByRole('region', { name: 'Case references' });
    expect(section).toHaveAttribute('data-case', 'proc-001');
    expect(section).toHaveAttribute('data-request', 'PR-2601100001');
    expect(section).toHaveAttribute('data-created', '2026-06-04T00:00:00Z');
  });

  it('does not mount them on other tabs', () => {
    renderAt('/procurement/proc-001');
    expect(screen.queryByRole('region', { name: 'Case references' })).toBeNull();
  });

  it('F8: the Files tab count is the ledger only — SharePoint links neither change it nor are fetched for it', () => {
    // One purchase order carrying one file, so the ledger count is non-zero (a 0 === 0 check would prove nothing).
    detailState.data = {
      ...(detailState.data as Record<string, unknown>),
      purchase_orders: [{
        id: 'po-1', org_id: 'org-1', procurement_id: 'proc-001', po_number: 'PO-2601100001', reference_number: null,
        status: 'Draft', date: '2026-06-05', amount: 1, currency: 'USD', created_at: '2026-06-05T00:00:00Z',
        files: [{ file_path: 'x/po.pdf', archived_at: null, title: 'po.pdf' }],
      }],
    };
    renderAt('/procurement/proc-001/files');
    const base = screen.getByRole('tab', { name: /Files/ }).textContent;
    refs.rows = [{ id: 'a' }, { id: 'b' }];
    cleanup();
    renderAt('/procurement/proc-001/files');
    const withRefs = screen.getByRole('tab', { name: /Files/ }).textContent;
    const n = (text: string | null) => Number(/(\d+)\s*$/.exec(text ?? '')?.[1] ?? 0);
    expect(n(base)).toBe(1);
    expect(n(withRefs)).toBe(n(base));
  });
});
