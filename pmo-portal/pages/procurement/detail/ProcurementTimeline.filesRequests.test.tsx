import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { LedgerRow, RecordType } from '@/src/lib/db/procurementLedger';
import { ProcurementTimeline } from './ProcurementDetailPanels';

/**
 * #2106 AC-PERF-2106-2 — the procurement Timeline's file reads, counted at the repository seam.
 *
 * Before: `<details>` per timeline entry rendered ProcurementFilesSubsection while closed (React mounts closed
 * details children), and each subsection ran its own useProcurementFiles query — 3-10+ files requests every time a
 * procurement was opened on the default Timeline tab. After: the subsection mounts only when its entry is opened.
 * The request count is the oracle: the file facts the row shows (fileCount) still come from the detail read.
 */

const h = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/src/lib/repositories', () => ({ repositories: { procurementFiles: { list: h.list } } }));
vi.mock('@/src/hooks/useUploadDestination', () => ({
  useUploadDestination: () => ({ kind: 'private' }),
  useUploadFailureText: () => () => 'Upload unavailable',
}));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: null, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: null, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: null, currency: 'USD', isPending: false, isError: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));

const procurement = {
  id: 'proc-2106', currency: 'USD', total_value: 50_000, created_at: '2026-09-01T00:00:00.000Z',
  requested_by: { full_name: 'Dana Requester' }, statusEvents: [],
  purchase_requests: [], purchase_orders: [], invoices: [], payments: [],
} as unknown as ProcurementDetail;

const TYPES: RecordType[] = ['PR', 'RFQ', 'Quote', 'PO', 'GR', 'Invoice', 'Payment', 'PO'];
const ledgerRow = (i: number): LedgerRow => ({
  id: `${TYPES[i]}-rec-${i}`,
  date: `2026-09-${String(i + 2).padStart(2, '0')}`,
  type: TYPES[i],
  systemNumber: `${TYPES[i]}-2609${i}`,
  externalRef: null,
  amount: 1000 + i,
  taxTreatment: null,
  status: 'Recorded',
  statusVariant: 'info',
  // The file FACTS are already in the detail read (fileCount renders in the row's facts); no per-row read is needed
  // to know a record HAS files — only to list them, which is what expanding an entry asks for.
  fileHref: `org/rec-${i}/file-${i}.pdf`,
  fileTitle: `file-${i}.pdf`,
  fileCount: 1,
  financial: TYPES[i] !== 'RFQ' && TYPES[i] !== 'GR',
  recordId: `rec-${i}`,
  currency: 'USD',
} as unknown as LedgerRow);
const rows = Array.from({ length: 8 }, (_, i) => ledgerRow(i));

const renderTimeline = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <ProcurementTimeline procurement={procurement} ledgerRows={rows} linkedDocuments={[]} isEngineer={false}
          canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );

const summaryOf = (row: HTMLElement) => row.querySelector('summary') as HTMLElement;

describe('AC-PERF-2106-2 the Timeline reads files only for the entry the reader opened', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.list.mockResolvedValue([]);
  });

  it('AC-PERF-2106-2 8 records on the Timeline fire ZERO files requests until an entry is expanded', async () => {
    renderTimeline();
    // 8 ledger records + the "Procurement raised" entry the timeline always shows.
    expect(screen.getAllByTestId('procurement-timeline-row')).toHaveLength(9);
    // Give any mount-time query a chance to land: a closed <details> must not have started one.
    await waitFor(() => expect(screen.getAllByTestId('procurement-timeline-row')).toHaveLength(9));
    expect(h.list).not.toHaveBeenCalled();
  });

  it('AC-PERF-2106-2 expanding one entry asks for that record’s files exactly once', async () => {
    const user = userEvent.setup();
    renderTimeline();
    // Row 0 is the "Procurement raised" entry (no record, so no attachments); row 1 is the first ledger record.
    const record = screen.getAllByTestId('procurement-timeline-row')[1];
    await user.click(summaryOf(record));
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
    expect(h.list).toHaveBeenCalledWith('purchase_request', 'rec-0');
    expect(await screen.findByText('No files attached.')).toBeInTheDocument();
  });

  it('AC-PERF-2106-2 expanding a second entry adds only its own request', async () => {
    const user = userEvent.setup();
    renderTimeline();
    const rendered = screen.getAllByTestId('procurement-timeline-row');
    await user.click(summaryOf(rendered[4]));  // raised + records in date order: rec-3, the PO
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
    expect(h.list).toHaveBeenLastCalledWith('purchase_order', 'rec-3');
    await user.click(summaryOf(rendered[3]));  // rec-2, the Quote
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
    expect(h.list).toHaveBeenLastCalledWith('quotation', 'rec-2');
  });

  it('AC-PERF-2106-2 collapsing an entry again does not refetch it', async () => {
    const user = userEvent.setup();
    renderTimeline();
    const record = screen.getAllByTestId('procurement-timeline-row')[1];
    await user.click(summaryOf(record));
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
    await user.click(summaryOf(record));
    await waitFor(() => expect(screen.queryByText('No files attached.')).toBeNull());
    expect(h.list).toHaveBeenCalledTimes(1);
  });
});
