/**
 * ProcurementLedger component tests (AC-PR-LEDGER-010..018)
 *
 * Tests render behavior: filter chips, DataTable reuse, capture row gating,
 * empty/filtered-empty states. Uses RTL + the real DataTable (not mocked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

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

// Stub listProcurementFiles — no Supabase in unit tests.
// Returns [] by default; override per-test via fileRows.
const fileRows = vi.hoisted(() => ({
  data: [] as Array<{ id: string; file_path: string | null; title: string | null }>,
}));

vi.mock('@/src/lib/db/procurementFiles', () => ({
  listProcurementFiles: vi.fn(async () => fileRows.data),
  getSignedDownloadUrl: vi.fn(async (path: string) => `https://cdn.example.com/${path}`),
}));

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
    financial: true,
    recordId: 'pay-1',
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
    financial: true,
    recordId: 'vi-1',
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
    fileHref: '/files/gr.pdf',
    financial: false,
    recordId: 'gr-1',
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
    financial: false,
    recordId: 'rfq-1',
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

const BASE_PROPS = {
  detail: makeDetail(),
  rows: SAMPLE_ROWS,
  procurementId: 'proc-1',
  orgId: 'org1',
  uploadedById: 'user-pm' as string | null,
  canWrite: true,
  invoices: [] as Parameters<typeof ProcurementLedger>[0]['invoices'],
};

describe('AC-PR-LEDGER-010: ProcurementLedger renders DataTable', () => {
  it('renders a table or card list with all rows', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    // All system numbers appear
    expect(screen.getByText('PAY-2026-0033')).toBeInTheDocument();
    expect(screen.getByText('VI-2026-0054')).toBeInTheDocument();
    expect(screen.getByText('GR-2026-0061')).toBeInTheDocument();
    expect(screen.getByText('RFQ-2026-0091')).toBeInTheDocument();
  });

  it('shows both system # and external ref (dual-ID)', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    expect(screen.getByText('TT-9930021')).toBeInTheDocument();
    expect(screen.getByText('INV-SF-2291')).toBeInTheDocument();
    expect(screen.getByText('DN-44120')).toBeInTheDocument();
  });
});

describe('AC-PR-LEDGER-011: filter chips', () => {
  beforeEach(() => {
    roleState.realRole = 'Project Manager';
    authState.currentUser = { id: 'user-pm', org_id: 'org1', role: 'Project Manager' };
  });

  it('All chip is active by default and shows all rows', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    const allChip = screen.getByRole('button', { name: /^All/i });
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('PAY-2026-0033')).toBeInTheDocument();
    expect(screen.getByText('GR-2026-0061')).toBeInTheDocument();
  });

  it('Financial chip filters to financial rows only', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    const financialChip = screen.getByRole('button', { name: /Financial/i });
    fireEvent.click(financialChip);

    // Financial rows: Payment and Invoice
    expect(screen.getByText('PAY-2026-0033')).toBeInTheDocument();
    expect(screen.getByText('VI-2026-0054')).toBeInTheDocument();
    // Non-financial: GR and RFQ should not appear
    expect(screen.queryByText('GR-2026-0061')).toBeNull();
    expect(screen.queryByText('RFQ-2026-0091')).toBeNull();
  });

  it('Has file chip filters to rows with fileHref only', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    const hasFileChip = screen.getByRole('button', { name: /Has file/i });
    fireEvent.click(hasFileChip);

    // Only GR has a fileHref
    expect(screen.getByText('GR-2026-0061')).toBeInTheDocument();
    expect(screen.queryByText('PAY-2026-0033')).toBeNull();
    expect(screen.queryByText('VI-2026-0054')).toBeNull();
  });

  it('filter chips are keyboard-operable with aria-pressed', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    const chips = screen.getAllByRole('button', { name: /All|Financial|Has file/i });
    expect(chips.length).toBeGreaterThanOrEqual(3);
    chips.forEach((chip) => {
      expect(chip).toHaveAttribute('aria-pressed');
    });
  });
});

describe('AC-PR-LEDGER-012: empty state', () => {
  it('shows taught empty state when no rows exist', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} rows={[]} />);
    expect(screen.getByText(/No records captured yet/i)).toBeInTheDocument();
  });

  it('shows filtered-empty state when filter yields no rows', () => {
    // Only RFQ row — not financial, no file
    const rfqOnly: LedgerRow[] = [SAMPLE_ROWS[3]];
    wrap(<ProcurementLedger {...BASE_PROPS} rows={rfqOnly} />);

    const financialChip = screen.getByRole('button', { name: /Financial/i });
    fireEvent.click(financialChip);

    expect(screen.getByText(/No Financial records/i)).toBeInTheDocument();
  });
});

describe('AC-PR-LEDGER-013: capture row gating', () => {
  it('capture row is rendered when canWrite=true', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} canWrite detail={makeDetail({ status: 'Draft' })} rows={[]} />);
    // The capture row / "+ Add record" affordance should appear
    expect(screen.getByTestId('ledger-capture-row')).toBeInTheDocument();
  });

  it('capture row is omitted when canWrite=false', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} canWrite={false} detail={makeDetail({ status: 'Draft' })} />);
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('capture row is omitted when detail status is terminal (Paid)', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} canWrite detail={makeDetail({ status: 'Paid' })} />);
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });
});

describe('AC-PR-LEDGER-014: ledger testid present', () => {
  it('wraps the ledger in a data-testid for targeting', () => {
    const { container } = wrap(<ProcurementLedger {...BASE_PROPS} />);
    expect(container.querySelector('[data-testid="procurement-ledger"]')).toBeInTheDocument();
  });
});

describe('AC-PR-LEDGER-018: file link renders when record has a file', () => {
  it('renders a View link for a row whose record has an attached file', async () => {
    fileRows.data = [
      { id: 'file-1', file_path: 'org-1/proc-1/receipt/file-1/receipt.pdf', title: 'Receipt' },
    ];

    const rowWithFile: LedgerRow = {
      id: 'gr-1',
      date: '2026-05-11',
      type: 'GR',
      systemNumber: 'GR-2026-0061',
      externalRef: 'DN-44120',
      amount: null,
      status: 'Complete',
      statusVariant: 'won',
      fileHref: null,
      financial: false,
      recordId: 'gr-1',
    };

    wrap(<ProcurementLedger {...BASE_PROPS} rows={[rowWithFile]} />);

    // Wait for the async file fetch + signed URL — the LedgerFileCell effect
    // must complete (listProcurementFiles → getSignedDownloadUrl → setState).
    // The anchor's accessible name is the aria-label (overrides inner text).
    await waitFor(
      () => {
        const link = screen.getByRole('link', { name: /open file/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', expect.stringContaining('cdn.example.com'));
      },
      { timeout: 3000 },
    );
  });

  it('renders "—" in the file column when no file is attached', () => {
    fileRows.data = [];

    const rowNoFile: LedgerRow = {
      id: 'po-1',
      date: '2026-05-06',
      type: 'PO',
      systemNumber: 'PO-2026-0001',
      externalRef: null,
      amount: 50000,
      status: 'Issued',
      statusVariant: 'progress',
      fileHref: null,
      financial: true,
      recordId: 'po-1',
    };

    wrap(<ProcurementLedger {...BASE_PROPS} rows={[rowNoFile]} />);
    // Should not find a "View" link
    expect(screen.queryByRole('link', { name: /view/i })).toBeNull();
  });
});
