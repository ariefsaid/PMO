import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

/** AC-ARA-002: rates by area on one contract line (docs/specs/areas-and-area-rates.spec.md). */
const h = vi.hoisted(() => ({
  may: true, areas: [{ id: 'a1', code: 'N', name: 'North', description: 'Northern block', archived_at: null }, { id: 'a2', code: 'S', name: 'South', description: null, archived_at: null }] as unknown[],
  rates: [{ areaId: 'a1', rate: '8.5' }] as unknown[], set: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.may }));
vi.mock('@/src/hooks/useWorkOrderLists', () => ({ useWorkOrderListEntries: () => ({ data: h.areas }) }));
vi.mock('@/src/lib/repositories/workOrderLists', () => ({ workOrderListRepository: { areaRates: async () => h.rates, setAreaRate: (...a: unknown[]) => h.set(...a) } }));

import BoqAreaRates from './BoqAreaRates';

const renderIt = (catalogueItemId: string | null = null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><BoqAreaRates boqItemId="b1" catalogueItemId={catalogueItemId} /></ToastProvider></QueryClientProvider>);

beforeEach(() => { h.may = true; h.set = vi.fn().mockResolvedValue(undefined); h.rates = [{ areaId: 'a1', rate: '8.5' }]; });

describe('BoqAreaRates', () => {
  it('preserves another area draft when a saved rate refreshes', async () => {
    const user = userEvent.setup();
    renderIt();
    const north = await screen.findByRole('textbox', { name: 'Rate for North' });
    await waitFor(() => expect(north).toHaveValue('8.5'));
    const south = screen.getByRole('textbox', { name: 'Rate for South' });
    await user.type(south, '12');
    await user.clear(north);
    await user.type(north, '10');
    h.set.mockImplementation(async () => { h.rates = [{ areaId: 'a1', rate: '10' }]; });
    await user.click(within(north.closest('li') as HTMLElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(north).not.toBeDisabled());
    expect(south).toHaveValue('12');
  });
  it('AC-ARA-002 shows each area with its rate and saves a new one through the seam', async () => {
    const user = userEvent.setup();
    renderIt();
    const north = await screen.findByRole('textbox', { name: 'Rate for North' });
    await waitFor(() => expect(north).toHaveValue('8.5'));
    expect(screen.getByText('Northern block')).toBeInTheDocument();
    const south = screen.getByRole('textbox', { name: 'Rate for South' });
    await user.type(south, '9.25');
    await user.click(within(south.closest('li') as HTMLElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', 'a2', '9.25'));
  });

  it.each(['10', '100'])('AC-ARA-002 reopening and saving the integer rate %s preserves its value', async (rate) => {
    h.rates = [{ areaId: 'a1', rate }];
    const user = userEvent.setup();
    renderIt();
    const north = await screen.findByRole('textbox', { name: 'Rate for North' });
    await waitFor(() => expect(north).toHaveValue(rate));
    await user.click(within(north.closest('li') as HTMLElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', 'a1', rate));
  });

  it('AC-ARA-002 accepts the full eight decimal places promised for an area rate', async () => {
    const user = userEvent.setup();
    renderIt();
    const south = await screen.findByRole('textbox', { name: 'Rate for South' });
    await user.type(south, '0.12345678');
    await user.click(within(south.closest('li') as HTMLElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', 'a2', '0.12345678'));
  });

  it.each(['10', '1000000000.12345678', '9007199254740993'])(
    'AC-ARA-002 shows and resaves the exact stored rate %s', async (rate) => {
      h.rates = [{ areaId: 'a1', rate }];
      const user = userEvent.setup();
      renderIt();
      const north = await screen.findByRole('textbox', { name: 'Rate for North' });
      await waitFor(() => expect(north).toHaveValue(rate));
      await user.click(within(north.closest('li') as HTMLElement).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', 'a1', rate));
    },
  );

  it('AC-ARA-002 an empty field removes the area\'s rate', async () => {
    const user = userEvent.setup();
    renderIt();
    const north = await screen.findByRole('textbox', { name: 'Rate for North' });
    await waitFor(() => expect(north).toHaveValue('8.5'));
    await user.clear(north);
    await user.click(within(north.closest('li') as HTMLElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', 'a1', null));
  });

  it('AC-ARA-002 a rate that is not above zero is stopped on the screen', async () => {
    const user = userEvent.setup();
    renderIt();
    const south = await screen.findByRole('textbox', { name: 'Rate for South' });
    await user.type(south, '0');
    await user.click(within(south.closest('li') as HTMLElement).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a rate above 0, or leave it empty to remove it.')).toBeInTheDocument();
    expect(h.set).not.toHaveBeenCalled();
  });

  it('AC-ARA-005 a catalogue-priced line, a role that may not edit, or an organisation with no areas shows nothing', () => {
    const a = renderIt('cat1');
    expect(screen.queryByTestId('boq-area-rates')).toBeNull();
    a.unmount();
    h.may = false;
    const b = renderIt();
    expect(screen.queryByTestId('boq-area-rates')).toBeNull();
    b.unmount();
    h.may = true; h.areas = [];
    renderIt();
    expect(screen.queryByTestId('boq-area-rates')).toBeNull();
  });
});
