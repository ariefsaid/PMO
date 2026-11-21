import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** #2596 FR-DSF-011..013: hidden figures say why and never read 0; a count opens the rows behind it. */
const h = vi.hoisted(() => ({ summary: null as unknown, kinds: [] as unknown[] }));
vi.mock('@/src/hooks/useSafetyDays', () => ({
  useSafetyEnabled: () => ({ data: true, isPending: false }),
  useSafetySummary: () => ({ data: h.summary, isPending: false, isError: false, refetch: vi.fn() }),
  useSafetySummaryDetail: (kind: string | null) => { h.kinds.push(kind); return { data: [{ date: '2026-03-12', work_order_id: 'w1', ref_id: null, label: '3' }], isPending: false, isError: false, refetch: vi.fn() }; },
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p1', name: 'Pipeline' }] }) }));

import SafetySummary from './SafetySummary';

const base = { month: '2026-03-01', timezone: 'Asia/Jakarta', projectId: null, workedMinutes: 1200, safeMinutes: 600, lostTimeIncidents: 1, recordableIncidents: 0, nearMisses: 2, toolboxTalks: 4, completeDays: 3, daysWithoutRecord: 1, hidden: {} };
const renderAt = (url = '/safety') => render(<MemoryRouter initialEntries={[url]}><SafetySummary /></MemoryRouter>);
beforeEach(() => { h.summary = base; h.kinds.length = 0; });

describe('SafetySummary', () => {
  it('shows hours as hours and minutes and the counts as counts', () => {
    renderAt();
    expect(screen.getByTestId('safety-figure-workedMinutes')).toHaveTextContent('20 h 0 min');
    expect(screen.getByTestId('safety-figure-safeMinutes')).toHaveTextContent('10 h 0 min');
    expect(screen.getByTestId('safety-figure-toolboxTalks')).toHaveTextContent('4');
  });

  it('AC-DSF-012 a figure that cannot be computed is hidden with its reason, not shown as 0', () => {
    h.summary = { ...base, workedMinutes: null, safeMinutes: null, hidden: { workedMinutes: 'no locked or approved attendance in this month', safeMinutes: 'no attendance to count from' } };
    renderAt();
    expect(screen.getByTestId('safety-figure-workedMinutes')).toHaveTextContent('—');
    expect(screen.getByTestId('safety-figure-workedMinutes')).not.toHaveTextContent('0 h');
    expect(screen.getByTestId('safety-hidden')).toHaveTextContent('Worked hours: no locked or approved attendance in this month');
  });

  it('AC-DSF-016 opening a count lists the rows behind it', async () => {
    renderAt();
    await userEvent.click(screen.getByTestId('safety-drill-daysWithoutRecord'));
    const panel = screen.getByTestId('safety-detail');
    expect(within(panel).getAllByTestId('safety-detail-row')).toHaveLength(1);
    expect(h.kinds.at(-1)).toBe('days_without_record');
  });

  it('AC-DSF-014 the client view holds figures only: no project picker, no drill-down', () => {
    renderAt('/safety?view=client');
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
    expect(screen.queryByTestId('safety-drill-daysWithoutRecord')).toBeNull();
    expect(screen.getByTestId('safety-figure-workedMinutes')).toBeInTheDocument();
  });
});
