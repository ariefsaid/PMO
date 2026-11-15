import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
 * details children), and each subsection ran its own useProcurementFiles query — one files request per ledger
 * record every time a procurement was opened on the default Timeline tab. After: the files of every record are read
 * in ONE batched call up front; an opened entry shows its files at once, with no request of its own.
 */

const h = vi.hoisted(() => ({ list: vi.fn(), listForParents: vi.fn() }));

vi.mock('@/src/lib/repositories', () => ({ repositories: { procurementFiles: { list: h.list, listForParents: h.listForParents } } }));
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

const fileRow = (parentId: string) => ({ id: `f-${parentId}`, org_id: 'o', title: `Spec ${parentId}`, file_path: `o/${parentId}/spec-${parentId}.pdf`, uploaded_by_id: null, created_at: '2026-09-01', archived_at: null, parent_id: parentId });

describe('AC-PERF-2106-2 the Timeline reads every record’s files in one request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.list.mockResolvedValue([]);
    h.listForParents.mockImplementation(async (parents: { phase: string; parentId: string }[]) =>
      Object.fromEntries(parents.map((p) => [`${p.phase}:${p.parentId}`, p.parentId === 'rec-0' ? [fileRow('rec-0')] : []])));
  });

  it('AC-PERF-2106-2 8 records on the Timeline cost ONE files request (was 8), and none per row', async () => {
    renderTimeline();
    await waitFor(() => expect(h.listForParents).toHaveBeenCalledTimes(1));
    expect(h.listForParents.mock.calls[0][0]).toHaveLength(8);
    expect(h.list).not.toHaveBeenCalled();
  });

  it('AC-PERF-2106-2 an opened entry shows its files at once, with no request of its own', async () => {
    const user = userEvent.setup();
    renderTimeline();
    await waitFor(() => expect(h.listForParents).toHaveBeenCalledTimes(1));
    await screen.findByTestId('procurement-timeline');
    await waitFor(() => expect(h.listForParents.mock.results[0]).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    // Row 0 is the "Procurement raised" entry (no record); row 1 is the first ledger record, which has a file.
    await user.click(summaryOf(screen.getAllByTestId('procurement-timeline-row')[1]));
    expect(await screen.findByText('spec-rec-0.pdf')).toBeInTheDocument();
    await user.click(summaryOf(screen.getAllByTestId('procurement-timeline-row')[2]));
    expect(await within(screen.getAllByTestId('procurement-timeline-row')[2]).findByText('No files attached.')).toBeInTheDocument();
    expect(h.listForParents).toHaveBeenCalledTimes(1);
    expect(h.list).not.toHaveBeenCalled();
  });

  it('AC-PERF-2106-2 an entry opened before the read lands shows loading, then its files (still one request)', async () => {
    const user = userEvent.setup();
    let release: (v: Record<string, unknown[]>) => void = () => {};
    h.listForParents.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderTimeline();
    const row = screen.getAllByTestId('procurement-timeline-row')[1];
    await user.click(summaryOf(row));
    expect(within(row).getByText(/Loading attachments/)).toBeInTheDocument();
    release({ 'purchase_request:rec-0': [fileRow('rec-0')] });
    expect(await screen.findByText('spec-rec-0.pdf')).toBeInTheDocument();
    expect(h.listForParents).toHaveBeenCalledTimes(1);
    expect(h.list).not.toHaveBeenCalled();
  });

  it('AC-PERF-2106-2 switching the timeline filter does not re-read the files', async () => {
    const user = userEvent.setup();
    renderTimeline();
    await waitFor(() => expect(h.listForParents).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Financial' }));
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(h.listForParents).toHaveBeenCalledTimes(1);
  });

  it('AC-PERF-2106-2 a failed batch read shows the attachments error state in an opened entry', async () => {
    const user = userEvent.setup();
    h.listForParents.mockRejectedValue(new Error('boom'));
    renderTimeline();
    await waitFor(() => expect(h.listForParents).toHaveBeenCalled());
    const row = screen.getAllByTestId('procurement-timeline-row')[1];
    await user.click(summaryOf(row));
    expect(await within(row).findByText(/load attachments/)).toBeInTheDocument();
  });

  it('AC-PERF-2106-2 one phase failing shows the error only on that phase’s entries; other phases keep their files', async () => {
    const user = userEvent.setup();
    // PR (purchase_request) read failed; every other phase answered. The batch reports a failed phase as null.
    h.listForParents.mockImplementation(async (parents: { phase: string; parentId: string }[]) =>
      Object.fromEntries(parents.map((p) => [`${p.phase}:${p.parentId}`,
        p.phase === 'purchase_request' ? null : p.parentId === 'rec-3' ? [fileRow('rec-3')] : []])));
    renderTimeline();
    await waitFor(() => expect(h.listForParents).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    const trows = screen.getAllByTestId('procurement-timeline-row');
    await user.click(summaryOf(trows[1])); // PR record — its phase failed
    expect(await within(trows[1]).findByText(/load attachments/)).toBeInTheDocument();
    await user.click(summaryOf(trows[4])); // PO record (rec-3) — its phase succeeded
    expect(await within(trows[4]).findByText('spec-rec-3.pdf')).toBeInTheDocument();
    expect(within(trows[4]).queryByText(/load attachments/)).not.toBeInTheDocument();
  });
});
