import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { HistoryEvent } from '@/src/lib/db/procurementHistory';
import { ProcurementProgressionTimeline } from './ProcurementProgressionTimeline';

// buildProcurementHistory returns events ASCENDING by time; the bento timeline
// presents them NEWEST-FIRST with a current-state ring on the latest event.
const ASC_EVENTS: HistoryEvent[] = [
  { kind: 'transition', label: 'Created → Requested', actor: 'D. Okafor', at: '2026-04-28T09:00:00Z' },
  { kind: 'record', label: 'Purchase Order PO-2026-0077', actor: null, at: '2026-05-06T10:00:00Z' },
  { kind: 'transition', label: 'Vendor Invoiced → Paid', actor: 'L. Chen', at: '2026-05-14T12:00:00Z' },
];

describe('ProcurementProgressionTimeline (Overview bento slot)', () => {
  it('renders an empty taught-state when there are no events', () => {
    render(<ProcurementProgressionTimeline events={[]} />);
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    // No list rendered when empty
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a semantic ordered list labelled "Progression history" (a11y NFR-PR-A11Y-002)', () => {
    render(<ProcurementProgressionTimeline events={ASC_EVENTS} />);
    const list = screen.getByRole('list', { name: /Progression history/i });
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('presents events NEWEST-FIRST (the latest event renders first)', () => {
    render(<ProcurementProgressionTimeline events={ASC_EVENTS} />);
    const items = screen.getAllByRole('listitem');
    // ASC last = Paid → must be first in the rendered (newest-first) order.
    expect(within(items[0]).getByText(/Vendor Invoiced → Paid/)).toBeInTheDocument();
    expect(within(items[2]).getByText(/Created → Requested/)).toBeInTheDocument();
  });

  it('marks the latest (current-state) event with data-current + a decorative ring (text conveys "current" by being first)', () => {
    render(<ProcurementProgressionTimeline events={ASC_EVENTS} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-current', 'true');
    expect(items[1]).not.toHaveAttribute('data-current');
  });

  it('shows actor + a machine-readable <time> for each event (text, not color-only)', () => {
    render(<ProcurementProgressionTimeline events={ASC_EVENTS} />);
    const items = screen.getAllByRole('listitem');
    // newest event actor
    expect(within(items[0]).getByText(/L\. Chen/)).toBeInTheDocument();
    const time = within(items[0]).getByText((_, el) => el?.tagName === 'TIME');
    expect(time).toHaveAttribute('dateTime', '2026-05-14T12:00:00Z');
  });
});
