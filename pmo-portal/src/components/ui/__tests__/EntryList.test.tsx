// T6 — EntryList component tests
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { EntryList } from '../EntryList';
import type { FlatEntry } from '@/src/lib/timesheet-derive';

const makeEntry = (
  id: string,
  hours: number,
  entry_date: string,
  projectName: string,
  code: string | null,
  notes: string | null,
): FlatEntry =>
  ({
    id,
    timesheet_id: 'ts1',
    org_id: 'o1',
    hours,
    entry_date,
    project_id: 'p1',
    notes,
    sheetId: 'ts1',
    project: { name: projectName, code },
  }) as unknown as FlatEntry;

const entries: FlatEntry[] = [
  makeEntry('e1', 8, '2026-06-02', 'Alpha Project', 'A001', 'Status call'),
  makeEntry('e2', 4, '2026-06-01', 'Beta Corp', null, null),
  makeEntry('e3', 2, '2026-05-30', 'Gamma', 'G002', ''),
];

describe('T6 — EntryList', () => {
  it('renders a <ul> with one <li> per entry (T6 semantic list)', () => {
    const { container } = render(<EntryList entries={entries} />);
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(entries.length);
  });

  it('shows "No note" for null notes — NOT an em-dash (T6 no-em-dash)', () => {
    render(<EntryList entries={entries} />);
    expect(screen.getAllByText('No note').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain('—');
  });

  it('shows "No note" for empty-string notes (T6 edge)', () => {
    render(<EntryList entries={entries} />);
    // e3 has notes='' — should render "No note"
    const liItems = document.querySelectorAll('li');
    const gammaLi = Array.from(liItems).find((li) => li.textContent?.includes('Gamma'));
    expect(gammaLi?.textContent).toContain('No note');
  });

  it('renders hours with tabular class on every row (T6 tabular-nums rule)', () => {
    const { container } = render(<EntryList entries={entries} />);
    const tabularEls = container.querySelectorAll('.tabular');
    expect(tabularEls.length).toBeGreaterThanOrEqual(entries.length);
  });

  it('renders project names (T6 content)', () => {
    render(<EntryList entries={entries} />);
    expect(screen.getByText('Alpha Project')).toBeInTheDocument();
    expect(screen.getByText('Beta Corp')).toBeInTheDocument();
  });

  it('renders actual note text when present (T6 content)', () => {
    render(<EntryList entries={entries} />);
    expect(screen.getByText('Status call')).toBeInTheDocument();
  });

  it('renders empty list state when entries is empty (T6 empty)', () => {
    render(<EntryList entries={[]} />);
    expect(screen.getByText(/No timesheet entries yet/i)).toBeInTheDocument();
  });
});
