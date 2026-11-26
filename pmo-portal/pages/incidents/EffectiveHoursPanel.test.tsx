/** AC-ICM-012 — the effective-hours panel beside the closing report: hint, per-day table, total, "times not entered". */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ rows: [] as unknown[], isPending: false, isError: false }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => ({ data: [{ value: 'p1', label: 'Project One' }] }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: (id: string) => ({ data: id ? [{ id: 'w1', wo_number: 'WO-1', title: 'Pipe', status: 'Issued' }] : [] }),
}));
vi.mock('@/src/hooks/useIssueClosingReport', () => ({
  useWorkOrderEffectiveHours: (wo?: string, from?: string, to?: string) => ({
    data: wo && from && to ? h.rows : undefined, isPending: h.isPending, isError: h.isError, refetch: vi.fn(),
  }),
}));
import EffectiveHoursPanel from './EffectiveHoursPanel';

beforeEach(() => { h.rows = []; h.isPending = false; h.isError = false; });

async function pick() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: /Project/ }));
  await user.click(await screen.findByText('Project One'));
  await user.click(screen.getByRole('combobox', { name: /Work order/ }));
  await user.click(await screen.findByText('WO-1'));
}

describe('AC-ICM-012 effective working hours panel', () => {
  it('asks for a work order first', () => {
    render(<EffectiveHoursPanel from="2026-11-01" to="2026-11-30" />);
    expect(screen.getByTestId('effective-hours-hint')).toBeInTheDocument();
  });
  it('shows worked, stopped and effective hours per day with a total, and "times not entered"', async () => {
    h.rows = [
      { work_date: '2026-11-02', worked_minutes: 510, stopped_minutes: 120, effective_minutes: 390, has_times: true },
      { work_date: '2026-11-03', worked_minutes: null, stopped_minutes: 30, effective_minutes: null, has_times: false },
    ];
    render(<EffectiveHoursPanel from="2026-11-01" to="2026-11-30" />);
    await pick();
    const table = await screen.findByTestId('effective-hours-table');
    expect(table).toHaveTextContent('8.5');
    expect(table).toHaveTextContent('2.0');
    expect(table).toHaveTextContent('6.5');
    expect(table).toHaveTextContent('Times not entered');
    const total = within(table).getByRole('row', { name: /Total/ });
    expect(within(total).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['8.5', '2.0', '6.5']);
  });
  it('says what is missing when the range is open or the work order has no validated report', async () => {
    const { rerender } = render(<EffectiveHoursPanel />);
    await pick();
    expect(screen.getByTestId('effective-hours-range')).toBeInTheDocument();
    rerender(<EffectiveHoursPanel from="2026-11-01" to="2026-11-30" />);
    expect(await screen.findByTestId('effective-hours-empty')).toBeInTheDocument();
  });
});
