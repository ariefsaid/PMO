/**
 * AC-EXT-001 / AC-EXT-002 (#769) — the vendor-invoice entry paths carry the optional external
 * reference ("Group ref") end to end, and an ERP-owned org is never asked for it (the dispatched
 * create does not carry it, so a typed value would be silently dropped):
 *   - the inline capture (VIInlineCapture → atomic `capture_vendor_invoice` path)
 *   - the staged-confirm path (RecordCaptureForm → onStage → ProcurementDetails.commitConfirm → createInvoice)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// OD-TAX-1 (#548): the inline VI capture PRE-SELECTS the org's `default_tax_treatment`. Only the
// org READ is stubbed — `useTaxTreatmentPreselect` stays the shipped implementation, so the real
// seeding behaviour runs here against a controllable org row.
const orgDefault = vi.hoisted(() => ({ value: 'exclusive' as string | undefined }));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => orgDefault.value };
});
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

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

const mockTransition = vi.fn().mockResolvedValue(undefined);
const mockCreateInvoice = vi.fn().mockResolvedValue({ id: 'i-new', vi_number: 'VI-001' });
const mockCaptureVendorInvoice = vi.fn().mockResolvedValue({ id: 'vi-new', vi_number: 'VI-001' });
const mockCreateReceipt = vi.fn().mockResolvedValue({ id: 'r-new' });
const mockCreateQuotation = vi.fn().mockResolvedValue({ id: 'q-new' });

// The per-phase file sub-section has its own unit test + needs a QueryClient;
// stub it here so the page tests stay focused on the lifecycle behavior.
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
// #520: the ERP template list is read from ERPNext; pinned so the staged-confirm forwarding is what is under test.
vi.mock('@/src/hooks/usePurchaseTaxTemplates', () => ({
  usePurchaseTaxTemplates: () => ({ data: [{ name: 'Input VAT 11' }], isError: false }),
}));
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
    transition: { mutateAsync: mockTransition, isPending: false, error: null },
    createQuotation: { mutateAsync: mockCreateQuotation, isPending: false, error: null },
    createReceipt: { mutateAsync: mockCreateReceipt, isPending: false, error: null },
    createInvoice: { mutateAsync: mockCreateInvoice, isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: mockCaptureVendorInvoice, isPending: false, error: null },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

const mockUpdateHeader = vi.fn().mockResolvedValue(undefined);
const mockCreateItem = vi.fn().mockResolvedValue({ id: 'it-new' });
const mockUpdateItem = vi.fn().mockResolvedValue(undefined);
const mockDeleteItem = vi.fn().mockResolvedValue(undefined);
const mockSelectQuote = vi.fn().mockResolvedValue(undefined);
const mockCreateDocument = vi.fn().mockResolvedValue({ id: 'd-new' });
const mockDeleteDocument = vi.fn().mockResolvedValue(undefined);
const docsState = {
  data: [] as Record<string, unknown>[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useProcurementCrudMutations: () => ({
    updateHeader: { mutateAsync: mockUpdateHeader, isPending: false },
    createItem: { mutateAsync: mockCreateItem, isPending: false },
    updateItem: { mutateAsync: mockUpdateItem, isPending: false },
    deleteItem: { mutateAsync: mockDeleteItem, isPending: false },
    selectQuote: { mutateAsync: mockSelectQuote, isPending: false },
    createDocument: { mutateAsync: mockCreateDocument, isPending: false },
    deleteDocument: { mutateAsync: mockDeleteDocument, isPending: false },
  }),
  useProcurementDocuments: () => docsState,
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-finance', org_id: 'org-1' }, role: 'Finance' }),
}));

let mockEffectiveRole = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockEffectiveRole, realRole: mockEffectiveRole }),
}));

const navigate = vi.fn();
const toast = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast }) };
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const baseProcurement = {
  id: 'proc-w3',
  code: 'PROC-2026-W3',
  title: 'Network Switches',
  status: 'Draft' as const,
  total_value: 0, currency: 'USD',
  pr_number: 'PR-2606090001',
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
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Eng User' },
  approved_by: null,
  items: [],
  quotations: [],
  receipts: [],
  invoices: [],
};

/** A Received PR ready for "Mark Vendor Invoiced" with a different user as approver (not u-finance). */
const receivedProcurement = {
  ...baseProcurement,
  status: 'Received' as const,
  total_value: 50000, currency: 'USD',
  approved_by_id: 'u-pm',
  approved_by: { full_name: 'PM User' },
  receipts: [
    {
      id: 'r-1',
      procurement_id: 'proc-w3',
      gr_number: 'GR-2606090001',
      status: 'Complete' as const,
      receipt_date: '2026-06-09',
      org_id: 'org-1',
      created_at: '2026-06-09T00:00:00Z',
    },
  ],
};

/** A Vendor Invoiced PR (after transition, for VI form tests). */
const vendorInvoicedProcurement = {
  ...baseProcurement,
  status: 'Vendor Invoiced' as const,
  total_value: 50000, currency: 'USD',
  approved_by_id: 'u-pm',
  approved_by: { full_name: 'PM User' },
};

const renderPage = (id = 'proc-w3') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );


import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';

afterEach(() => clearOwnershipCache());

const openInlineCapture = async () => {
  detailState.data = { ...receivedProcurement };
  detailState.isPending = false;
  detailState.isError = false;
  mockEffectiveRole = 'Finance';
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /mark vendor invoiced/i }));
};

describe('AC-EXT-001: inline vendor-invoice capture (atomic capture_vendor_invoice path)', () => {
  beforeEach(() => {
    mockCaptureVendorInvoice.mockClear();
    mockCreateInvoice.mockClear();
  });

  it('forwards the trimmed Group ref as externalRef on the atomic capture', async () => {
    await openInlineCapture();
    await userEvent.type(screen.getByTestId('vendor_invoice-group-ref-input'), '  PRO-0026100002 ');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.click(screen.getByTestId('btn-submit-vi-capture'));
    await waitFor(() =>
      expect(mockCaptureVendorInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ externalRef: 'PRO-0026100002' }),
      ),
    );
  });

  it('sends no externalRef when the field is left empty', async () => {
    await openInlineCapture();
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.click(screen.getByTestId('btn-submit-vi-capture'));
    await waitFor(() => expect(mockCaptureVendorInvoice).toHaveBeenCalled());
    expect(mockCaptureVendorInvoice.mock.calls[0][0]).not.toHaveProperty('externalRef');
  });

  it('an ERP-owned org is not asked for it, and nothing is sent', async () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    await openInlineCapture();
    expect(screen.queryByTestId('vendor_invoice-group-ref-input')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('btn-submit-vi-capture'));
    await waitFor(() => expect(mockCaptureVendorInvoice).toHaveBeenCalled());
    expect(mockCaptureVendorInvoice.mock.calls[0][0]).not.toHaveProperty('externalRef');
  });
});

describe('AC-EXT-001: staged vendor-invoice capture is forwarded through the confirm dialog', () => {
  beforeEach(() => {
    mockCaptureVendorInvoice.mockClear();
    mockCreateInvoice.mockClear();
    mockEffectiveRole = 'Finance';
    detailState.data = { ...vendorInvoicedProcurement, invoices: [] };
    detailState.isPending = false;
    detailState.isError = false;
  });

  it('the Group ref typed in the form reaches createInvoice after the confirm', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    await userEvent.type(screen.getByTestId('vendor_invoice-group-ref-input'), 'PRO-0026100002');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    // staged, not yet written
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /save vi/i }));
    await waitFor(() =>
      expect(mockCreateInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ externalRef: 'PRO-0026100002' }),
      ),
    );
  });

  it('an ERP-owned org is not asked for it on the form either', async () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    expect(screen.queryByTestId('vendor_invoice-group-ref-input')).not.toBeInTheDocument();
  });

  it('AC-520-9 an ERP-owned org: the chosen ERPNext tax template reaches createInvoice after the confirm', async () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    await userEvent.selectOptions(screen.getByTestId('vi-tax-template-select'), 'Input VAT 11');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /save vi/i }));
    await waitFor(() =>
      expect(mockCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({ taxTemplate: 'Input VAT 11' })),
    );
  });
});
