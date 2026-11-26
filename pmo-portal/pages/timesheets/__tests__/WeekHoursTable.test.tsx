import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WeekHoursTable } from '../WeekHoursTable';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ label, dateNum: String(30 + i > 30 ? i : 30), weekend: i > 4 }));
const rows = [
  { id: 'a', project: 'Alpha Jetty', code: 'P-01', hours: [8, 0, 0, 0, 0, 0, 0], projectId: 'p1' },
  { id: 'b', project: 'Bravo Yard', code: 'P-02', hours: [0, 0, 4, 2.5, 0, 0, 0], projectId: 'p2', workOrderLabel: 'WO-7 · Piping' },
];

function viewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: desktop, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}
const mount = () => render(<MemoryRouter><WeekHoursTable days={days} rows={rows} /></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

describe('WeekHoursTable: one read-only week in a drawer', () => {
  it('reads as one row per project with the seven days, the row total and a daily-total row', () => {
    viewport(true);
    mount();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      ['Project', 'Mon30', 'Tue1', 'Wed2', 'Thu3', 'Fri4', 'Sat5', 'Sun6', 'Total']);
    const bravo = screen.getByRole('row', { name: /Bravo Yard/ });
    const cells = within(bravo).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['', '', '4', '2.5', '', '', '', '6.5']);
    expect(within(bravo).getByText('P-02')).toBeInTheDocument();
    expect(within(bravo).getByText('WO-7 · Piping')).toBeInTheDocument();
    const totals = screen.getByRole('row', { name: /Daily total/ });
    expect(within(totals).getAllByRole('cell').map((c) => c.textContent)).toEqual(['8', '', '4', '2.5', '', '', '', '14.5']);
  });

  it('on a phone lists only the days that have hours, per project, and the week total', () => {
    viewport(false);
    mount();
    expect(screen.queryByRole('table')).toBeNull();
    const bravo = screen.getByRole('region', { name: 'Bravo Yard' });
    expect(within(bravo).queryByText(/^Mon/)).toBeNull();
    expect(within(bravo).getByText('Wed 2')).toBeInTheDocument();
    expect(within(bravo).getByText('Thu 3')).toBeInTheDocument();
    expect(within(bravo).getByText('6.5')).toBeInTheDocument();
    expect(screen.getByText('Week total').nextElementSibling).toHaveTextContent('14.5');
  });
});
