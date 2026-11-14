import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const exportXlsx = vi.fn();
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx, busy: false }) }));

import { ReadyToPayCard } from './FinanceBlocks';

const row = (id: string, title: string, status: string) => ({
  id, title, status, currency: 'IDR', vendor: { name: 'Nordic Supply' }, total_value: 1_000_000,
  requested_by: null, refs: [], invoice_number: 'SI-1', invoice_date: '2026-10-01',
});

describe('ReadyToPayCard — floor (floor-tests/home-company.md 21)', () => {
  beforeEach(() => exportXlsx.mockClear());

  it('floor: Export exports exactly the visible ready-to-pay rows', async () => {
    const rows = [row('pr1', 'Case one', 'Vendor Invoiced'), row('pr2', 'Case two', 'Ordered'), row('pr3', 'Case three', 'Vendor Invoiced')];
    render(<MemoryRouter><ReadyToPayCard rows={rows} pending={false} error={false} retry={() => {}} unpaidOf={() => 1_000_000} today="2026-10-27" /></MemoryRouter>);
    const card = screen.getByRole('heading', { name: 'Ready to pay' }).closest('.panel-card') as HTMLElement;
    expect(within(card).getAllByRole('row')).toHaveLength(3); // header + two Vendor Invoiced rows
    await userEvent.click(within(card).getByRole('button', { name: 'Export' }));
    expect(exportXlsx).toHaveBeenCalledTimes(1);
    const [exported] = exportXlsx.mock.calls[0] as [Array<{ id: string }>, unknown, string];
    expect(exported.map((r) => r.id)).toEqual(['pr1', 'pr3']);
  });

  it('floor: Export is disabled when nothing is ready to pay', () => {
    render(<MemoryRouter><ReadyToPayCard rows={[row('pr2', 'Case two', 'Ordered')]} pending={false} error={false} retry={() => {}} unpaidOf={() => 1_000_000} today="2026-10-27" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(exportXlsx).not.toHaveBeenCalled();
  });
});
