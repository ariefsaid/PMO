import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * AC-IXD-PROC-002 — approval is a GATE, not a stage (owner directive 2026-06-21,
 * reversing the prior "Approved is its own node" decision). Approval must still be
 * VISIBLE: approving ADVANCES the bar — the PR node becomes `done` and the
 * Vendor-Quote node becomes `current` (the next action), so an Approved PR sits at
 * a LATER stepper node than a Requested PR. There is NO standalone "Approved" node.
 */

const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

// The per-phase file sub-section has its own unit test + needs a QueryClient;
// stub it here so the page tests stay focused on the lifecycle behavior.
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

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: vi.fn(), isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn(), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn(), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
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
// N8 (AC-IXD-PROC-W5-2): DecisionSupportPanel now mounts in ProcurementDetails.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
// N8 (AC-IXD-PROC-W5-2): DecisionSupportPanel also reads committed spend.
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

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

  it('AC-IXD-PROC-002: approving advances PR→done + Vendor Quote→current, with NO standalone "Approved" node', () => {
    detailState.data = { ...base, status: 'Approved', approved_by_id: 'u-fin' };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const ariaLabels = within(stepper)
      .getAllByRole('listitem')
      .map((el) => el.getAttribute('aria-label') ?? '');
    const labels = ariaLabels.map((l) => l.split(':')[0].trim());
    // Approval is a gate, not a stage — no node is labelled "Approved".
    expect(labels).not.toContain('Approved');
    // The bar advanced on approval: PR done, Vendor Quote current (the next action).
    expect(ariaLabels[0]).toBe('Purchase Request: done');
    expect(ariaLabels[1]).toBe('Vendor Quote: current');
  });
});
