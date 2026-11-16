import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { TimesheetDayView } from '../TimesheetDayView';
import { gridDaysForWeek } from '../timesheetWeekModel';

// Week of Mon 9 Nov 2026; "today" is pinned to Wednesday 11 Nov.
const dates = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 9 + i));
const days = gridDaysForWeek(dates);
const rows = [
  { id: 'pA', project: 'Alpha Project', code: 'A001', hours: [8, 8, 0, 0, 0, 0, 0] },
  { id: 'pB', project: 'Beta Project', code: 'B002', hours: [0, 0, 6, 0, 0, 0, 0] },
];
const totals = { dayTotals: [8, 8, 6, 0, 0, 0, 0], rowTotals: [16, 6], weekTotal: 22 };

function renderView(props: Partial<React.ComponentProps<typeof TimesheetDayView>> = {}) {
  return render(
    <MemoryRouter>
      <TimesheetDayView days={days} dates={dates} rows={rows} {...totals} editable onCellChange={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe('#2440 the phone week, one day at a time', () => {
  afterEach(() => vi.useRealTimers());

  it("opens on today's fields, with the week total and every day's total in view", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 9));
    renderView();
    expect(screen.getByTestId('tsgrid-grand-total')).toHaveTextContent('22 hours this week');
    expect(screen.getByRole('button', { name: /^Wed 11, 6 hours/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Mon 9, 8 hours/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Alpha Project, Wed hours')).toHaveValue('');
    expect(screen.getByLabelText('Beta Project, Wed hours')).toHaveValue('6');
    expect(screen.queryByLabelText('Alpha Project, Mon hours')).not.toBeInTheDocument();
    expect(screen.getByTestId('tsgrid-row-total-pA')).toHaveTextContent('A001 · 16 hours this week');
  });

  it('opens on the first day for a week that does not hold today, and any other day is one tap away', async () => {
    const onCellChange = vi.fn();
    renderView({ dates: dates.map((d) => new Date(d.getTime() - 364 * 864e5)), onCellChange });
    const strip = screen.getByRole('group', { name: 'Days of the week' });
    expect(within(strip).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(strip).getAllByRole('button')[4]);
    await userEvent.type(screen.getByLabelText('Alpha Project, Fri hours'), '7');
    expect(onCellChange).toHaveBeenLastCalledWith('pA', 4, '7');
  });

  it('marks the day that holds a red hour, so the person can find it from the strip', () => {
    renderView({ invalidCells: new Set(['pB:5']) });
    expect(screen.getByRole('button', { name: /^Sat 14, 0 hours · 0–24 only$/ })).toBeInTheDocument();
  });

  it('reads back a submitted week without fields, project names linking to their project', () => {
    renderView({ editable: false, rows: rows.map((r) => ({ ...r, projectId: r.id })) });
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alpha Project/ })).toHaveAttribute('href', '/projects/pA');
  });
});
