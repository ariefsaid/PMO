/**
 * ProcurementHistoryTimeline — renders the progression-history as a semantic <ol>
 * with accessible name "Progression history" (NFR-PR-A11Y-002).
 * Each event's kind, label, actor, timestamp appear as TEXT (not color-only).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ProcurementHistoryTimeline } from './ProcurementHistoryTimeline';
import type { HistoryEvent } from '@/src/lib/db/procurementHistory';

const fixture: HistoryEvent[] = [
  {
    kind: 'transition',
    label: 'Draft → Requested',
    actor: 'user-abc',
    at: '2026-06-10T08:00:00Z',
  },
  {
    kind: 'record',
    label: 'Purchase Request PR-2606100001',
    actor: null,
    at: '2026-06-10T08:01:00Z',
  },
  {
    kind: 'transition',
    label: 'Requested → Approved',
    actor: 'user-xyz',
    at: '2026-06-11T09:30:00Z',
  },
];

describe('ProcurementHistoryTimeline', () => {
  it('renders a semantic <ol> with accessible name "Progression history" (NFR-PR-A11Y-002)', () => {
    render(<ProcurementHistoryTimeline events={fixture} />);
    const list = screen.getByRole('list', { name: 'Progression history' });
    expect(list.tagName).toBe('OL');
  });

  it('renders N+M items matching the fixture length', () => {
    render(<ProcurementHistoryTimeline events={fixture} />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(fixture.length);
  });

  it('renders event labels as text in order', () => {
    render(<ProcurementHistoryTimeline events={fixture} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('Draft → Requested');
    expect(items[1].textContent).toContain('Purchase Request PR-2606100001');
    expect(items[2].textContent).toContain('Requested → Approved');
  });

  it('renders event kind as text (not color-only) — NFR-PR-A11Y-002', () => {
    render(<ProcurementHistoryTimeline events={fixture} />);
    const items = screen.getAllByRole('listitem');
    // First item is a transition — "transition" or "Transition" should appear as text
    expect(items[0].textContent?.toLowerCase()).toContain('transition');
    // Second item is a record
    expect(items[1].textContent?.toLowerCase()).toContain('record');
  });

  it('renders actor id as text for transition events', () => {
    render(<ProcurementHistoryTimeline events={fixture} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('user-abc');
  });

  it('renders timestamp as text for each event', () => {
    render(<ProcurementHistoryTimeline events={fixture} />);
    const items = screen.getAllByRole('listitem');
    // The ISO string or formatted date must appear somewhere in each item
    expect(items[0].textContent).toMatch(/2026/);
    expect(items[1].textContent).toMatch(/2026/);
    expect(items[2].textContent).toMatch(/2026/);
  });

  it('renders empty state when events array is empty', () => {
    render(<ProcurementHistoryTimeline events={[]} />);
    expect(screen.getByText(/no history/i)).toBeDefined();
  });
});
