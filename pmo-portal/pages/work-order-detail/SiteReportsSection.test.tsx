import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/** AC-SRC-006: the work order's own reports, each with its crew. */
const h = vi.hoisted(() => ({ q: { data: { rows: [] as unknown[] }, isPending: false, isError: false, refetch: vi.fn() }, calls: [] as unknown[] }));
vi.mock('@/src/hooks/useDailySiteReports', () => ({ useDailySiteReports: (f: unknown) => { h.calls.push(f); return h.q; } }));

import { SiteReportsSection } from './SiteReportsSection';

const renderIt = () => render(<MemoryRouter><SiteReportsSection workOrderId="w1" /></MemoryRouter>);

describe('SiteReportsSection', () => {
  it('AC-SRC-006 lists this work order\'s reports with their crew and links to each', () => {
    h.q = { data: { rows: [{ id: 'r1', work_date: '2026-03-10', crew_name: 'Pipe crew', author_name: 'Field One', status: 'draft' }, { id: 'r2', work_date: '2026-03-09', crew_name: null, author_name: null, status: 'validated' }] }, isPending: false, isError: false, refetch: vi.fn() };
    renderIt();
    expect(h.calls.at(-1)).toEqual({ workOrderId: 'w1' });
    expect(screen.getByText('Crew Pipe crew')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/site-reports/r1');
  });

  it('says so when there are none', () => {
    h.q = { data: { rows: [] }, isPending: false, isError: false, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText('No site reports on this work order yet.')).toBeInTheDocument();
  });
});
