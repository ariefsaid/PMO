import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { StatTile } from '@/src/components/ui';
import type { HistoryEvent } from '@/src/lib/db/procurementHistory';

// DecisionSupportPanel reads budget hooks; stub them so the bento renders a real
// (non-loading) budget signal without a QueryClientProvider.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import { ProcurementOverviewTab } from './ProcurementOverviewTab';

const tiles: StatTile[] = [
  { label: 'PR value', value: '$486,000', sub: 'Meridian' },
  { label: 'Selected quote', value: '$478,500', sub: 'Sunforge' },
  { label: 'PO committed', value: '$478,500' },
  { label: 'Goods received', value: '1 receipt' },
];

const detailRows = [
  { label: 'Project', value: 'Meridian Solar Farm' },
  { label: 'Vendor', value: 'Sunforge Components' },
  { label: 'Requested by', value: 'D. Okafor' },
];

const events: HistoryEvent[] = [
  { kind: 'transition', label: 'Created → Requested', actor: 'D. Okafor', at: '2026-04-28T09:00:00Z' },
  { kind: 'transition', label: 'Vendor Invoiced → Paid', actor: 'L. Chen', at: '2026-05-14T12:00:00Z' },
];

const renderTab = (props: Partial<React.ComponentProps<typeof ProcurementOverviewTab>> = {}) =>
  render(
    <MemoryRouter>
      <ProcurementOverviewTab
        tiles={tiles}
        detailRows={detailRows}
        events={events}
        projectId="proj-1"
        projectName="Meridian Solar Farm"
        totalValue={486000}
        {...props}
      />
    </MemoryRouter>,
  );

describe('ProcurementOverviewTab (bento)', () => {
  it('renders the StatTiles strip (2-col bento)', () => {
    renderTab();
    // The bento's own stat strip (the Budget signal also renders a StatTiles, so scope
    // to the FIRST strip — the main bento tiles).
    const strip = screen.getAllByTestId('stat-tiles')[0];
    expect(within(strip).getAllByTestId('stat-tile')).toHaveLength(4);
    expect(within(strip).getByText('$486,000')).toBeInTheDocument();
  });

  it('renders the budget signal (DecisionSupportPanel) when a project is linked', () => {
    renderTab();
    expect(screen.getByText(/Budget impact/i)).toBeInTheDocument();
  });

  it('omits the budget signal when there is no linked project (no empty card)', () => {
    renderTab({ projectId: null, projectName: null });
    expect(screen.queryByText(/Budget impact/i)).toBeNull();
  });

  it('renders the Detail <dl> with each label + value as a dt/dd pair', () => {
    renderTab();
    const dl = screen.getByTestId('procurement-detail-dl');
    expect(dl.tagName).toBe('DL');
    expect(within(dl).getByText('Project')).toBeInTheDocument();
    expect(within(dl).getByText('Meridian Solar Farm')).toBeInTheDocument();
    expect(within(dl).getByText('Vendor')).toBeInTheDocument();
  });

  it('renders the Progression timeline (newest-first, current ring) in the side slot', () => {
    renderTab();
    const region = screen.getByTestId('procurement-progression');
    const list = within(region).getByRole('list', { name: /Progression history/i });
    const items = within(list).getAllByRole('listitem');
    // newest-first: Paid is the latest event → first item, marked current.
    expect(within(items[0]).getByText(/Vendor Invoiced → Paid/)).toBeInTheDocument();
    expect(items[0]).toHaveAttribute('data-current', 'true');
  });
});
