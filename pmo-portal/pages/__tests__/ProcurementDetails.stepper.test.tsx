import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * AC-IXD-PROC-002 — the lifecycle stepper ADVANCES when a request is Approved
 * (IxD #11). Today Approve left the stepper on step 1 (Draft/Requested/Approved
 * all mapped to the PR node), so the approval was invisible. The stepper now
 * carries an explicit "Approved" node: the current node for an Approved PR is a
 * later position than for a Requested PR.
 */

const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: vi.fn(), isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn(), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn(), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
  }),
}));
const docsState = { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() };
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
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance' }),
}));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

import ProcurementDetails from '../ProcurementDetails';

const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Requested' as const,
  total_value: 85000,
  pr_number: 'PR-2606040001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Alice Manager' },
  approved_by: null,
  items: [],
  quotations: [],
  receipts: [],
  invoices: [],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/procurement/proc-001']}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

/** The 0-based index of the node-stepper item currently in the `current` state. */
function currentStepIndex(): number {
  const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
  const items = within(stepper).getAllByRole('listitem');
  return items.findIndex((el) => /:\s*current$/i.test(el.getAttribute('aria-label') ?? ''));
}

beforeEach(() => {
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
});

describe('AC-IXD-PROC-002: the lifecycle stepper advances when a PR is Approved', () => {
  it('AC-IXD-PROC-002: an Approved PR sits at a LATER stepper node than a Requested PR', () => {
    detailState.data = { ...base, status: 'Requested' };
    const { unmount } = renderPage();
    const requestedIdx = currentStepIndex();
    unmount();

    detailState.data = { ...base, status: 'Approved', approved_by_id: 'u-fin' };
    renderPage();
    const approvedIdx = currentStepIndex();

    expect(requestedIdx).toBeGreaterThanOrEqual(0);
    expect(approvedIdx).toBeGreaterThan(requestedIdx);
  });

  it('AC-IXD-PROC-002: the stepper renders an explicit "Approved" node', () => {
    detailState.data = { ...base, status: 'Approved', approved_by_id: 'u-fin' };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    // a node whose label is the canonical "Approved"
    const labels = within(stepper)
      .getAllByRole('listitem')
      .map((el) => (el.getAttribute('aria-label') ?? '').split(':')[0].trim());
    expect(labels).toContain('Approved');
  });
});
