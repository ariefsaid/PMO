import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProgressionEvent } from '@/src/lib/db/procurementHistory';
import { ProcurementProgressionTimeline } from './ProcurementProgressionTimeline';

// buildProgressionTimeline returns events ASCENDING by time; the bento timeline
// presents them NEWEST-FIRST with a current-state ring on the latest event.
const ASC_EVENTS: ProgressionEvent[] = [
  { kind: 'transition', label: 'Requested', actor: 'D. Okafor', at: '2026-04-28T09:00:00Z', docRef: 'PR-2026-0142', docHref: '/procurement/proc-1/documents' },
  { kind: 'transition', label: 'Ordered', actor: 'A. Reyes', at: '2026-05-06T10:00:00Z', docRef: 'PO-2026-0077', docHref: '/procurement/proc-1/documents' },
  { kind: 'transition', label: 'Paid', actor: 'L. Chen', at: '2026-05-14T12:00:00Z', docRef: 'PAY-2026-0033', docHref: '/procurement/proc-1/documents' },
];

// 9 events — more than the default cap of 6
const LONG_EVENTS: ProgressionEvent[] = Array.from({ length: 9 }, (_, i) => ({
  kind: 'transition' as const,
  label: `Step ${i + 1}`,
  actor: null,
  at: `2026-05-0${i + 1}T10:00:00Z`,
  docRef: null,
  docHref: null,
}));

const renderTimeline = (events: ProgressionEvent[]) =>
  render(
    <MemoryRouter>
      <ProcurementProgressionTimeline events={events} />
    </MemoryRouter>,
  );

describe('ProcurementProgressionTimeline (Overview bento slot)', () => {
  it('renders an empty taught-state when there are no events', () => {
    renderTimeline([]);
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    // No list rendered when empty
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a semantic ordered list labelled "Progression history" (a11y NFR-PR-A11Y-002)', () => {
    renderTimeline(ASC_EVENTS);
    const list = screen.getByRole('list', { name: /Progression history/i });
    expect(list.tagName).toBe('OL');
    // 3 events, all within cap — all 3 visible
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('presents events NEWEST-FIRST (the latest event renders first)', () => {
    renderTimeline(ASC_EVENTS);
    const items = screen.getAllByRole('listitem');
    // ASC last = Paid → must be first in the rendered (newest-first) order.
    expect(within(items[0]).getByText(/Paid/)).toBeInTheDocument();
    expect(within(items[2]).getByText(/Requested/)).toBeInTheDocument();
  });

  it('marks the latest (current-state) event with data-current + a decorative ring (text conveys "current" by being first)', () => {
    renderTimeline(ASC_EVENTS);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-current', 'true');
    expect(items[1]).not.toHaveAttribute('data-current');
  });

  it('shows actor + a machine-readable <time> for each event (text, not color-only)', () => {
    renderTimeline(ASC_EVENTS);
    const items = screen.getAllByRole('listitem');
    // newest event actor
    expect(within(items[0]).getByText(/L\. Chen/)).toBeInTheDocument();
    const time = within(items[0]).getByText((_, el) => el?.tagName === 'TIME');
    expect(time).toHaveAttribute('dateTime', '2026-05-14T12:00:00Z');
  });

  it('AC-PR-PROG-007: renders docRef as a link (<a>) within the event row', () => {
    renderTimeline(ASC_EVENTS);
    const items = screen.getAllByRole('listitem');
    // The Paid event (first, newest) should have a link for PAY-2026-0033
    const link = within(items[0]).getByRole('link', { name: /PAY-2026-0033/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/procurement/proc-1/documents');
  });

  it('AC-PR-PROG-008: event without docRef renders the label as plain text (no link)', () => {
    const noRefEvents: ProgressionEvent[] = [
      { kind: 'transition', label: 'Approved', actor: 'L. Marchetti', at: '2026-05-02T10:00:00Z', docRef: null, docHref: null },
    ];
    renderTimeline(noRefEvents);
    // Should render "Approved" as text but NOT as a link
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('AC-PR-PROG-009: shows only the latest 6 events by default when more than 6 events exist', () => {
    renderTimeline(LONG_EVENTS);
    // 9 events, only 6 visible by default (newest 6 = Step 4–9)
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    // Newest (Step 9) should be first
    expect(within(items[0]).getByText('Step 9')).toBeInTheDocument();
  });

  it('AC-PR-PROG-010: "Show N earlier" button reveals the hidden events (keyboard-operable, aria-expanded)', () => {
    renderTimeline(LONG_EVENTS);
    // 9 - 6 = 3 hidden; button should say "Show 3 earlier"
    const btn = screen.getByRole('button', { name: /Show 3 earlier/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(btn);

    // After expanding: all 9 visible
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(9);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('AC-PR-PROG-011: no expander when total events ≤ 6', () => {
    renderTimeline(ASC_EVENTS); // 3 events
    expect(screen.queryByRole('button', { name: /Show .* earlier/i })).toBeNull();
  });
});
