import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const { master, allowances } = vi.hoisted(() => ({
  master: { listItems: vi.fn() },
  allowances: { list: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, allowances } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));

import MaterialAllowanceModal from './MaterialAllowanceModal';

const workItem = { id: 'b1', item_code: 'FO-01', description: 'Floor screed' };
const items = [
  { id: 'i1', code: 'CEM', name: 'Cement 50kg', unit_id: 'u1', archived_at: null },
  { id: 'i2', code: 'CAB', name: 'Cable 4mm', unit_id: 'u2', archived_at: null },
];
const onClose = vi.fn();
const renderIt = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MaterialAllowanceModal projectId="p1" workItem={workItem} onClose={onClose} /></QueryClientProvider>);
};
async function pick(search: string, option: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: /^Item/ }));
  await userEvent.type(screen.getByRole('searchbox'), search);
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listItems.mockResolvedValue(items);
  allowances.list.mockResolvedValue([
    { id: 'a1', boqItemId: 'b1', itemId: 'i1', plannedQuantity: '60' },
    { id: 'a9', boqItemId: 'b2', itemId: 'i2', plannedQuantity: '5' }, // another work item: not shown here
  ]);
  allowances.set.mockResolvedValue(undefined);
  allowances.clear.mockResolvedValue(undefined);
});

describe('Material allowance editor', () => {
  it('FR-STK-050 lists only this work item\'s allowances, and every field is labelled (axe)', async () => {
    const { baseElement } = renderIt();
    const list = await screen.findByRole('list', { name: 'Material allowance' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('CEM - Cement 50kg')).toBeInTheDocument();
    expect(within(list).getByText(/60/)).toBeInTheDocument();
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it('FR-STK-050 sets a new item\'s planned quantity exactly as typed', async () => {
    renderIt();
    await screen.findByRole('list', { name: 'Material allowance' });
    await pick('cab', /CAB - Cable 4mm/);
    await userEvent.type(screen.getByLabelText(/^Planned quantity/), '120.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(allowances.set).toHaveBeenCalledWith({ boqItemId: 'b1', itemId: 'i2', plannedQuantity: '120.5' }));
  });

  it('FR-STK-050 picking an item that already has an allowance prefills it and changes that allowance', async () => {
    renderIt();
    await screen.findByRole('list', { name: 'Material allowance' });
    await pick('cem', /CEM - Cement 50kg/);
    const qty = screen.getByLabelText(/^Planned quantity/);
    expect(qty).toHaveValue('60');
    await userEvent.clear(qty);
    await userEvent.type(qty, '75');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(allowances.set).toHaveBeenCalledWith({ id: 'a1', boqItemId: 'b1', itemId: 'i1', plannedQuantity: '75' }));
  });

  it('FR-STK-050 Clear removes an allowance', async () => {
    renderIt();
    const list = await screen.findByRole('list', { name: 'Material allowance' });
    await userEvent.click(within(list).getByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(allowances.clear).toHaveBeenCalledWith('a1'));
  });

  it('a quantity of 0 or with more than 3 decimals is refused before any write', async () => {
    renderIt();
    await screen.findByRole('list', { name: 'Material allowance' });
    await pick('cab', /CAB - Cable 4mm/);
    await userEvent.type(screen.getByLabelText(/^Planned quantity/), '1.2345');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a quantity above 0, at most 3 decimals.')).toBeInTheDocument();
    expect(allowances.set).not.toHaveBeenCalled();
  });

  it('AC-STK-024 a refused save keeps the dialog open and says so', async () => {
    allowances.set.mockRejectedValue(Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }));
    renderIt();
    await screen.findByRole('list', { name: 'Material allowance' });
    await pick('cab', /CAB - Cable 4mm/);
    await userEvent.type(screen.getByLabelText(/^Planned quantity/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});
