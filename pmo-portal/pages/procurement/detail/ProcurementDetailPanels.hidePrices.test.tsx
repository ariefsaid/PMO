/** AC-009 (#2699) — the procurement record panels draw no price figure for a person who may not see prices. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { act, render, screen } from '@testing-library/react';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import { setPricesHidden } from '@/src/lib/priceReadPath';
import { ProcurementMoneySummary, ProcurementStageTracker, ProcurementTimeline } from './ProcurementDetailPanels';

vi.mock('../ProcurementFilesSubsection', () => ({ ProcurementFilesSubsection: () => null }));
vi.mock('@/src/hooks/useProcurementFilesBatch', () => ({ useProcurementFilesBatch: () => ({ data: undefined, isError: false }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));

const procurement = {
  id: 'p-1', currency: 'USD', total_value: 62_000, created_at: '2026-09-01T00:00:00.000Z', status: 'Ordered',
  requested_by: { full_name: 'Requester' }, statusEvents: [],
  purchase_requests: [{ id: 'pr', amount: 62_000, date: '2026-09-02', created_at: '2026-09-02T00:00:00Z' }],
  purchase_orders: [{ id: 'po', amount: 62_000, date: '2026-09-03', created_at: '2026-09-03T00:00:00Z' }],
  invoices: [], payments: [], receipts: [], quotations: [], rfqs: [],
} as unknown as ProcurementDetail;

afterEach(() => act(() => setPricesHidden(false)));

describe('AC-009 procurement record panels without prices', () => {
  it('shows the money block and a stage amount while prices are visible', () => {
    render(<MemoryRouter><ProcurementMoneySummary procurement={procurement} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />
      <ProcurementStageTracker procurement={procurement} linkedDocuments={[]} /></MemoryRouter>);
    expect(screen.getByTestId('procurement-money-summary')).toBeInTheDocument();
    expect(screen.getAllByText(/62,000/).length).toBeGreaterThan(0);
  });
  it('draws no money block, no stage amount and no timeline amount when the server hides prices', () => {
    act(() => setPricesHidden(true));
    render(<MemoryRouter>
      <ProcurementMoneySummary procurement={procurement} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />
      <ProcurementStageTracker procurement={procurement} linkedDocuments={[]} />
      <ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} />
    </MemoryRouter>);
    expect(screen.queryByTestId('procurement-money-summary')).toBeNull();
    expect(screen.queryByText(/62,000/)).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });
});
