/**
 * ProcurementLedger component tests (AC-PR-LEDGER-010..018)
 *
 * Tests render behavior: filter chips, DataTable reuse, capture row gating,
 * empty/filtered-empty states. Uses RTL + the real DataTable (not mocked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

// ---------------------------------------------------------------------------
// Stubs — vi.hoisted keeps mock factories before the import block
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({
  currentUser: { id: 'user-pm', org_id: 'org1', role: 'Project Manager' } as {
    id: string;
    org_id: string;
    role: string;
  } | null,
}));

const roleState = vi.hoisted(() => ({
  realRole: 'Project Manager' as string | null,
  effectiveRole: 'Project Manager' as string | null,
  canImpersonate: false,
  viewAs: vi.fn(),
}));

const mutState = vi.hoisted(() => ({
  createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false },
  createRfq: { mutateAsync: vi.fn(), isPending: false },
  createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false },
  createPayment: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: authState.currentUser }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => roleState,
}));

vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => mutState,
}));

vi.mock('@/src/components/ui', async (orig) => {
  const actual = await orig<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

// Stub useProcurementFiles — AttachButton in LedgerFileCell calls this hook.
// Returns a minimal shape; upload.mutate is no-op in tests.
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

// Stub procurementFiles DAL — getSignedDownloadUrl used lazily by SingleFileButton.
// listProcurementFiles is no longer called on mount (that is the whole fix).
vi.mock('@/src/lib/db/procurementFiles', () => ({
  listProcurementFiles: vi.fn(async () => []),
  getSignedDownloadUrl: vi.fn(async (path: string) => `https://cdn.example.com/${path}`),
}));

// The ledger consumes useVendorWithholdingCoverage directly; the tests steer the query object
// here instead of injecting coverage props.
const coverageQuery = vi.hoisted(() => ({
  fn: vi.fn(),
  current: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn(async () => {}) },
}));
vi.mock('@/src/hooks/useVendorWithholdingSlips', async (orig) => {
  const actual = await orig<typeof import('@/src/hooks/useVendorWithholdingSlips')>();
  return { ...actual, useVendorWithholdingCoverage: coverageQuery.fn };
});

import { ProcurementLedger } from './ProcurementLedger';
import type { LedgerRow } from '../../src/lib/db/procurementLedger';
import type { ProcurementDetail } from '../../src/lib/db/procurementLifecycle';

function makeDetail(overrides: Partial<ProcurementDetail> = {}): ProcurementDetail {
  return {
    id: 'proc-1',
    org_id: 'org-1',
    title: 'Test Procurement',
    status: 'Paid',
    code: 'PROC-001',
    created_at: '2026-01-01T00:00:00Z',
    total_value: 100000,
    pr_number: null,
    vq_number: null,
    po_number: null,
    project_id: null,
    vendor_id: null,
    requested_by_id: null,
    approved_by_id: null,
    approval_notes: null,
    rejection_notes: null,
    project: null,
    vendor: null,
    requested_by: null,
    approved_by: null,
    items: [],
    quotations: [],
    receipts: [],
    invoices: [],
    purchase_requests: [],
    rfqs: [],
    purchase_orders: [],
    payments: [],
    statusEvents: [],
    ...overrides,
  } as unknown as ProcurementDetail;
}

const SAMPLE_ROWS: LedgerRow[] = [
  {
    id: 'pay-1',
    date: '2026-05-14',
    type: 'Payment',
    systemNumber: 'PAY-2026-0033',
    externalRef: 'TT-9930021',
    amount: 478500,
    status: 'Cleared',
    statusVariant: 'won',
    fileHref: null,
    fileTitle: null,
    fileCount: 0,
    financial: true,
    recordId: 'pay-1',
    currency: 'USD',
    taxTreatment: null,
  },
  {
    id: 'vi-1',
    date: '2026-05-12',
    type: 'Invoice',
    systemNumber: 'VI-2026-0054',
    externalRef: 'INV-SF-2291',
    amount: 478500,
    status: 'Received',
    statusVariant: 'progress',
    fileHref: null,
    fileTitle: null,
    fileCount: 0,
    financial: true,
    recordId: 'vi-1',
    // OD-TAX-1 §2: 0196 makes this NOT NULL, so an Invoice fixture with a null basis would be a row
    // the database cannot produce — and the label under test would never render in this suite.
    currency: 'USD',
    taxTreatment: 'inclusive',
  },
  {
    id: 'gr-1',
    date: '2026-05-11',
    type: 'GR',
    systemNumber: 'GR-2026-0061',
    externalRef: 'DN-44120',
    amount: null,
    status: 'Complete',
    statusVariant: 'won',
    fileHref: 'org-1/proc-1/receipt/f1/gr.pdf',
    fileTitle: 'GR Document',
    fileCount: 1,
    financial: false,
    recordId: 'gr-1',
    currency: 'USD',
    taxTreatment: null,
  },
  {
    id: 'rfq-1',
    date: '2026-04-30',
    type: 'RFQ',
    systemNumber: 'RFQ-2026-0091',
    externalRef: null,
    amount: null,
    status: 'Closed',
    statusVariant: 'neutral',
    fileHref: null,
    fileTitle: null,
    fileCount: 0,
    financial: false,
    recordId: 'rfq-1',
    currency: 'USD',
    taxTreatment: null,
  },
];

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        {ui}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function setCoverage(next: Partial<typeof coverageQuery.current>) {
  coverageQuery.current = { ...coverageQuery.current, ...next };
  coverageQuery.fn.mockImplementation(() => coverageQuery.current);
  return coverageQuery.current;
}

beforeEach(() => {
  setCoverage({ data: [], isLoading: false, isError: false });
  coverageQuery.current.refetch = vi.fn(async () => {});
});

const BASE_PROPS = {
  detail: makeDetail(),
  rows: SAMPLE_ROWS,
  procurementId: 'proc-1',
  uploadedById: 'user-pm' as string | null,
  canWrite: true,
  invoices: [] as Parameters<typeof ProcurementLedger>[0]['invoices'],
};

describe('Procurement files ledger floor controls', () => {
  it('floor: All filter restores every ledger row after Financial filtering', async () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    const filters = screen.getByRole('group', { name: 'Filter records' });
    await userEvent.click(within(filters).getByRole('button', { name: 'Financial' }));
    expect(screen.queryByText('GR-2026-0061')).not.toBeInTheDocument();
    await userEvent.click(within(filters).getByRole('button', { name: 'All' }));
    expect(screen.getByText('PAY-2026-0033')).toBeInTheDocument();
    expect(screen.getByText('VI-2026-0054')).toBeInTheDocument();
    expect(screen.getByText('GR-2026-0061')).toBeInTheDocument();
    expect(screen.getByText('RFQ-2026-0091')).toBeInTheDocument();
  });

  it('floor: Ledger capture selects Purchase Order and saves it to this procurement', async () => {
    const createPurchaseOrder = mutState.createPurchaseOrder.mutateAsync;
    wrap(<ProcurementLedger
      {...BASE_PROPS}
      detail={makeDetail({ status: 'Draft' })}
      rows={[]}
      firstDocumentKinds={['purchase_request', 'purchase_order']}
    />);
    await userEvent.selectOptions(screen.getByLabelText('Record the first document'), 'purchase_order');
    await userEvent.click(screen.getByTestId('ledger-capture-open'));
    await userEvent.type(screen.getByTestId('purchase_order-ref-input'), 'PO-INTAKE-1');
    await userEvent.click(screen.getByTestId('purchase_order-save-btn'));
    await waitFor(() => expect(createPurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({ referenceNumber: 'PO-INTAKE-1' })));
  });
});

