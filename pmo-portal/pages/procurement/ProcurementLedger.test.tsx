/**
 * ProcurementLedger component tests (AC-PR-LEDGER-010..018)
 *
 * Tests render behavior: filter chips, DataTable reuse, capture row gating,
 * empty/filtered-empty states. Uses RTL + the real DataTable (not mocked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { BahasaProvider } from '@/test/bahasa';

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

import { ProcurementLedger } from './ProcurementLedger';
import * as procurementFilesModule from '@/src/lib/db/procurementFiles';
import type { LedgerRow } from '../../src/lib/db/procurementLedger';
import type { ProcurementDetail } from '../../src/lib/db/procurementLifecycle';
import { formatCurrency } from '@/src/lib/format';

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

const BASE_PROPS = {
  detail: makeDetail(),
  rows: SAMPLE_ROWS,
  procurementId: 'proc-1',
  uploadedById: 'user-pm' as string | null,
  canWrite: true,
  invoices: [] as Parameters<typeof ProcurementLedger>[0]['invoices'],
};

describe('PR-1 Bahasa rendered-copy contract', () => {
  it('renders translated filters, headers, record types, and capture action', () => {
    render(<BahasaProvider><MemoryRouter><QueryClientProvider client={new QueryClient()}><ProcurementLedger {...BASE_PROPS} detail={makeDetail({ status: 'Draft' })} rows={SAMPLE_ROWS} /></QueryClientProvider></MemoryRouter></BahasaProvider>);
    expect(screen.getByRole('group', { name: 'Filter catatan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Semua' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keuangan' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tanggal' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Jenis' })).toBeInTheDocument();
    expect(screen.getByText('Pembayaran')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Catat Permintaan Pembelian/i })).toBeInTheDocument();
  });
});

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

describe('AC-PR-LEDGER-018: file column — prop-driven, no fetch on mount', () => {
  it('AC-PR-LEDGER-018a: renders file title button for a row with fileTitle/fileHref set (no listProcurementFiles on mount)', () => {
    // listProcurementFiles should NOT be called — file presence comes from the bundle.
    const listProcurementFiles = vi.mocked(procurementFilesModule.listProcurementFiles);
    listProcurementFiles.mockClear();

    const rowWithFile: LedgerRow = {
      id: 'gr-1',
      date: '2026-05-11',
      type: 'GR',
      systemNumber: 'GR-2026-0061',
      externalRef: 'DN-44120',
      amount: null,
      status: 'Complete',
      statusVariant: 'won',
      fileHref: 'org-1/proc-1/receipt/f1/receipt.pdf',
      fileTitle: 'Delivery Note',
      fileCount: 1,
      financial: false,
      recordId: 'gr-1',
    currency: 'USD',
    taxTreatment: null,
    };

    wrap(<ProcurementLedger {...BASE_PROPS} rows={[rowWithFile]} />);

    // The file title text must appear in a button (lazy — no href/link until click).
    // getByRole('button') can't use text content when aria-label overrides; use getByText.
    const titleEl = screen.getByText('Delivery Note');
    expect(titleEl.closest('button')).toBeInTheDocument();
    // NO per-row list fetch on mount
    expect(listProcurementFiles).not.toHaveBeenCalled();
  });

  it('AC-PR-LEDGER-018b: renders upload affordance for canWrite=true rows with no file', () => {
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
      fileTitle: null,
      fileCount: 0,
      financial: true,
      recordId: 'po-1',
    currency: 'USD',
    taxTreatment: null,
    };

    wrap(<ProcurementLedger {...BASE_PROPS} canWrite rows={[rowNoFile]} />);
    // The "Attach" upload affordance should be present for a writer
    expect(screen.getByRole('button', { name: /attach/i })).toBeInTheDocument();
  });

  it('AC-PR-LEDGER-018c: no upload affordance for canWrite=false', () => {
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
      fileTitle: null,
      fileCount: 0,
      financial: true,
      recordId: 'po-1',
    currency: 'USD',
    taxTreatment: null,
    };

    wrap(<ProcurementLedger {...BASE_PROPS} canWrite={false} rows={[rowNoFile]} />);
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull();
    // reads "—" for no-file non-writer (may be multiple dashes for empty cols; at least one present)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('AC-PR-LEDGER-018d: shows "N files" count button when fileCount > 1', () => {
    const rowMultiFile: LedgerRow = {
      id: 'vq-1',
      date: '2026-05-04',
      type: 'Quote',
      systemNumber: 'VQ-2026-0001',
      externalRef: null,
      amount: 478500,
      status: 'Selected',
      statusVariant: 'won',
      fileHref: 'org-1/proc-1/quotation/f1/q1.pdf',
      fileTitle: 'Main Quote',
      fileCount: 3,
      financial: true,
      recordId: 'vq-1',
    currency: 'USD',
    taxTreatment: null,
    };

    wrap(<ProcurementLedger {...BASE_PROPS} rows={[rowMultiFile]} />);
    expect(screen.getByRole('button', { name: /3 files/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #548 / OD-TAX-1 §2 — the vendor invoice's total states its basis; nothing else claims one
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('#548 (OD-TAX-1): the ledger Amount column carries the row’s tax basis', () => {
  it('#548: the Invoice row reads "incl. PPN" — 0196 makes the marker NOT NULL, so it always exists', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    const labels = screen.getAllByTestId('tax-basis');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveTextContent('incl. PPN');
  });

  it('#548: an EXCLUSIVE invoice reads "excl. PPN" — derived from the row, not a fixed string', () => {
    const rows = SAMPLE_ROWS.map((r) =>
      r.type === 'Invoice' ? { ...r, taxTreatment: 'exclusive' } : r,
    );
    wrap(<ProcurementLedger {...BASE_PROPS} rows={rows} />);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent('excl. PPN');
  });

  it('#548: a PAYMENT amount carries NO basis — `payments` has no treatment column to state one from', () => {
    // The honest reading of a null: this record states no basis, NOT "assume the org default".
    // Labelling it with the invoice's basis would put a claim on a figure nobody qualified.
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    // Both the Payment and the Invoice render 478,500 — only ONE of them wears a basis, and the
    // one that does is the invoice (asserted above). Four rows, one label.
    expect(screen.getAllByText(/478,500/).length).toBeGreaterThan(1);
    expect(screen.getAllByTestId('tax-basis')).toHaveLength(1);
  });
});

describe('AC-EXT-002 (#769): the ledger shows each record\'s Group ref', () => {
  it('renders a "Group ref" column carrying the PR / PO / vendor-invoice external reference', () => {
    const rows = SAMPLE_ROWS.map((r) =>
      r.type === 'Invoice' ? { ...r, groupRef: 'PRO-0026100002' } : r,
    );
    wrap(<ProcurementLedger {...BASE_PROPS} rows={rows} />);
    expect(screen.getAllByText('Group ref').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PRO-0026100002').length).toBeGreaterThan(0);
    // the record's own reference_number stays in its own column
    expect(screen.getAllByText('INV-SF-2291').length).toBeGreaterThan(0);
  });

  it('a record with no external reference never shows another record\'s value', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} />);
    expect(screen.queryByText('PRO-0026100002')).toBeNull();
  });
});

describe('AC-VWH-012: a vendor invoice with tax withheld shows VAT, tax withheld and net payable (#876)', () => {
  const withholdingRow: LedgerRow = {
    ...SAMPLE_ROWS[1], id: 'vi-876', systemNumber: 'VI-2026-0876', recordId: 'vi-876',
    amount: 1110000, currency: 'IDR', taxAmount: 110000, withheldAmount: 20000,
  };

  it('AC-VWH-012 the three figures are shown, each labelled, in the bill currency', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} rows={[withholdingRow]} />);
    const breakdown = screen.getAllByTestId('vi-withholding-breakdown')[0];
    expect(within(breakdown).getByText('VAT')).toBeInTheDocument();
    expect(within(breakdown).getByTestId('vi-withholding-vat').textContent).toBe(formatCurrency(110000, 'IDR'));
    expect(within(breakdown).getByText('Tax withheld (PPh)')).toBeInTheDocument();
    expect(within(breakdown).getByTestId('vi-withholding-withheld').textContent).toBe(formatCurrency(20000, 'IDR'));
    expect(within(breakdown).getByText('Net payable')).toBeInTheDocument();
    expect(within(breakdown).getByTestId('vi-withholding-net').textContent).toBe(formatCurrency(1090000, 'IDR'));
  });

  it('AC-VWH-012 a vendor invoice with nothing withheld renders no breakdown (unchanged)', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} rows={[{ ...SAMPLE_ROWS[1], taxAmount: 0, withheldAmount: 0 }]} />);
    expect(screen.queryByTestId('vi-withholding-breakdown')).toBeNull();
  });
});

describe('AC-VWH-026: a standalone tax-exclusive bill shows net payable = amount + VAT − withheld (#876 slice 2)', () => {
  it('AC-VWH-026 the breakdown adds the VAT back for a tax-exclusive amount', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} rows={[{
      ...SAMPLE_ROWS[1], id: 'vi-s2', recordId: 'vi-s2', amount: 1000000, currency: 'IDR',
      taxTreatment: 'exclusive', taxAmount: 110000, withheldAmount: 20000,
    }]} />);
    expect(screen.getAllByTestId('vi-withholding-net')[0].textContent).toBe(formatCurrency(1090000, 'IDR'));
  });
});
