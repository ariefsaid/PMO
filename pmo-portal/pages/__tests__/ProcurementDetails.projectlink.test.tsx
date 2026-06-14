/**
 * AC-JR-W1-05 — ProcurementDetails project name links
 *
 * The project name in the RecordHeader meta strip must be a click-to-open
 * link to /projects/:id (not inert text). Also covers the moneyContext
 * confirm-dialog project name link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Shared mutable hook state
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

vi.mock('@/pages/procurement/ProcurementFilesSubsection', () => ({
  ProcurementFilesSubsection: () => null,
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn().mockResolvedValue({ id: 'q-new' }), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn().mockResolvedValue({ id: 'r-new' }), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn().mockResolvedValue({ id: 'i-new', vi_number: 'VI-001' }), isPending: false, error: null },
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
  useProcurementDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-finance', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance' }),
}));

const navigate = vi.fn();
const toast = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast }) };
});

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const baseProcurement = {
  id: 'proc-1',
  code: 'PROC-001',
  title: 'Steel Beams',
  status: 'Requested' as const,
  total_value: 25000,
  pr_number: 'PR-001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-eng',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-09T00:00:00Z',
  updated_at: '2026-06-09T00:00:00Z',
  project: { name: 'Bridge Alpha', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Eng User' },
  approved_by: null,
  items: [{ id: 'item-1', name: 'Steel', qty: 10, unit_price: 2500, total_price: 25000 }],
  quotations: [],
  receipts: [],
  invoices: [],
};

const renderPage = (id = 'proc-1') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  detailState.data = { ...baseProcurement };
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
  navigate.mockClear();
  toast.mockClear();
});

// ---------------------------------------------------------------------------
// AC-JR-W1-05: RecordHeader meta project name is a link to /projects/:id
// ---------------------------------------------------------------------------
describe('AC-JR-W1-05: ProcurementDetails project name links', () => {
  it('AC-JR-W1-05: RecordHeader meta strip contains a project name link to /projects/:id', () => {
    renderPage();
    // The project name "Bridge Alpha" must be a link to /projects/proj-1
    const projectLinks = screen.getAllByRole('link', { name: /Open Bridge Alpha/i });
    expect(projectLinks.length).toBeGreaterThanOrEqual(1);
    expect(projectLinks[0].getAttribute('href')).toBe('/projects/proj-1');
  });

  it('AC-JR-W1-05: moneyContext in Approve confirm shows project name as a link', async () => {
    // Finance role, different requester — can Approve
    detailState.data = { ...baseProcurement, status: 'Requested' as const };
    renderPage();

    // Click "Approve"
    const approveBtn = screen.getByRole('button', { name: /approve/i });
    await userEvent.click(approveBtn);

    // The confirm dialog body should contain the project name as a link
    const dialogLinks = screen.getAllByRole('link', { name: /Open Bridge Alpha/i });
    expect(dialogLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('AC-JR-W1-05: no project link when project is null', () => {
    detailState.data = {
      ...baseProcurement,
      project_id: null,
      project: null,
    };
    renderPage();
    // Should not throw; no link with project text
    const projectLinks = screen.queryAllByRole('link', { name: /Open Bridge Alpha/i });
    expect(projectLinks.length).toBe(0);
  });
});
