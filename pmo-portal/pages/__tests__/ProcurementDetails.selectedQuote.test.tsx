import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * AC-IXD-PROC-004 — once a quote is selected, the "Selected quote" summary tile
 * shows the SELECTED vendor + amount (not "Pending" / "0 received") all the way
 * through to Paid, and the chosen quotation row is marked "Selected" (IxD #12).
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
}));

import ProcurementDetails from '../ProcurementDetails';

const selectedQuote = {
  id: 'q-1',
  procurement_id: 'proc-001',
  vendor_id: 'v-apex',
  vendor: { name: 'Apex Supply' },
  total_amount: 48000,
  vq_number: 'VQ-2606040001',
  is_selected: true,
  reference: 'VQ-2606040001',
  received_date: '2026-06-04',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
};
const otherQuote = {
  ...selectedQuote,
  id: 'q-2',
  vendor_id: 'v-beta',
  vendor: { name: 'Beta Traders' },
  total_amount: 52000,
  vq_number: 'VQ-2606040002',
  is_selected: false,
  reference: 'VQ-2606040002',
};

const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Quote Selected' as const,
  total_value: 48000,
  pr_number: 'PR-2606040001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: null,
  vendor_id: 'v-apex',
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: { name: 'Apex Supply' },
  requested_by: { full_name: 'Alice Manager' },
  approved_by: null,
  items: [],
  quotations: [otherQuote, selectedQuote],
  receipts: [],
  invoices: [],
};

// The page is a tabbed shell (`/procurement/:id/:tab?`, default Overview). `tab`
// deep-links the panel that owns the asserted content (the stat tiles live on the
// default Overview tab; the quotations section lives on the Vendor-quotes tab).
const renderPage = (tab?: string) =>
  render(
    <MemoryRouter initialEntries={[`/procurement/proc-001${tab ? `/${tab}` : ''}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

/** The stat tile whose label matches; returns its container element. */
function tile(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  return labelEl.closest('[data-testid="stat-tile"]') as HTMLElement;
}

beforeEach(() => {
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
});

describe('AC-IXD-PROC-004: the Selected-quote summary binds to the chosen quotation', () => {
  it('AC-IXD-PROC-004: at Quote Selected the tile shows the selected amount + vendor (not "Pending")', () => {
    detailState.data = { ...base, status: 'Quote Selected' };
    renderPage();
    const t = tile('Selected quote');
    // formatCurrency(48000) = "$48,000" (the selected quote's amount)
    expect(t).toHaveTextContent('$48,000');
    // names the selected vendor — not the raw "N received" pending sub
    expect(t).toHaveTextContent('Apex Supply');
    expect(t).not.toHaveTextContent('Pending');
  });

  it('AC-IXD-PROC-004: the selected amount persists through to Paid (not reverting to Pending)', () => {
    detailState.data = {
      ...base,
      status: 'Paid',
      po_number: 'PO-2606040001',
      receipts: [
        { id: 'r-1', procurement_id: 'proc-001', gr_number: 'GR-1', status: 'Complete', receipt_date: '2026-06-05', org_id: 'org-1', created_at: '2026-06-05T00:00:00Z' },
      ],
      invoices: [
        { id: 'i-1', procurement_id: 'proc-001', vi_number: 'VI-1', status: 'Paid', invoice_date: '2026-06-06', org_id: 'org-1', created_at: '2026-06-06T00:00:00Z' },
      ],
    };
    renderPage();
    const t = tile('Selected quote');
    expect(t).toHaveTextContent('$48,000');
    expect(t).not.toHaveTextContent('Pending');
  });

  it('AC-IXD-PROC-004: the chosen quotation row is marked "Selected · best value"', () => {
    detailState.data = { ...base, status: 'Quote Selected' };
    renderPage('quotes');
    // VendorQuotesTab (Slice 3) replaced QuotationsSection — testid is now vendor-quotes.
    const section = screen.getByTestId('vendor-quotes');
    // Both desktop + mobile branches render the pill so at least one match expected.
    expect(within(section).getAllByText(/Selected · best value/i).length).toBeGreaterThanOrEqual(1);
    // its vq number is shown alongside (may appear in both branches)
    expect(within(section).getAllByText('VQ-2606040001').length).toBeGreaterThanOrEqual(1);
  });
});
