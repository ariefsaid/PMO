import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), setLine: vi.fn() }));
vi.mock('@/src/lib/db/procurementLinePlanning', () => ({
  getPurchaseLinePlanning: h.get, listPurchaseLineCategories: h.list, setProcurementLinePlanning: h.setLine,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));

import { LinePlanningPanel } from './LinePlanningPanel';

const CATS = [
  { id: 'c1', name: 'Alpha', archived_at: null, org_id: 'o', position: 1, created_at: '' },
  { id: 'c2', name: 'Old', archived_at: '2026-01-01', org_id: 'o', position: 2, created_at: '' },
];
const ITEMS = [
  { id: 'l1', name: 'Cable', category_id: null, needed_by: null },
  { id: 'l2', name: 'Pipe', category_id: 'c2', needed_by: '2026-12-31' },
];
const renderIt = (editable: boolean) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LinePlanningPanel items={ITEMS} editable={editable} /></QueryClientProvider>,
);

describe('AC-PLP-010 LinePlanningPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); h.list.mockResolvedValue(CATS); h.setLine.mockResolvedValue(undefined); });

  it('renders nothing while the setting is off', async () => {
    h.get.mockResolvedValue(false);
    const { container } = renderIt(true);
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(h.list).not.toHaveBeenCalled();
  });

  it('when on and read-only, shows category and date with a dash for an empty line', async () => {
    h.get.mockResolvedValue(true);
    renderIt(false);
    expect(await screen.findByText('Old')).toBeInTheDocument();
    expect(screen.getByText('2026-12-31')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('when editable on a Draft, saves only the changed line', async () => {
    h.get.mockResolvedValue(true);
    renderIt(true);
    await screen.findAllByRole('option', { name: 'Alpha' });
    const selects = screen.getAllByRole('combobox', { name: 'Line category' });
    await userEvent.selectOptions(selects[0], 'c1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setLine).toHaveBeenCalledTimes(1));
    expect(h.setLine).toHaveBeenCalledWith('l1', 'c1', null);
  });
});
