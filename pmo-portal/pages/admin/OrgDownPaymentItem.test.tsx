import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, bindingStatus: 'active', bindingError: false, connected: false, get: vi.fn(), set: vi.fn(), loadItems: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { getDownPaymentItem: h.get, setDownPaymentItem: h.set } } }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({
  useErpnextBinding: () => ({ data: { status: h.bindingStatus }, isPending: false, isError: h.bindingError, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useErpItemOptions', () => ({
  useErpItemOptions: () => ({ connected: h.connected, loadOptions: h.loadItems }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgDownPaymentItem from './OrgDownPaymentItem';
beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.bindingStatus = 'active';
  h.bindingError = false;
  h.connected = false;
  h.get.mockResolvedValue(null);
  h.set.mockResolvedValue(undefined);
  h.loadItems.mockResolvedValue([{ value: 'PB-DOWN-PAYMENT', label: 'PB-DOWN-PAYMENT', sub: 'Customer advance' }]);
});
function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <ToastProvider><OrgDownPaymentItem /></ToastProvider>
  </QueryClientProvider>);
  return client;
}
it('AC-S11-004 an Admin reviews an existing item and its unverified liability consequence before saving', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Down payment item' }));
  await user.click(await screen.findByRole('option', { name: /PB-DOWN-PAYMENT/ }));
  expect(screen.getByText(/Use an item configured to post customer advances to a liability account/)).toBeInTheDocument();
  expect(h.set).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(h.set).toHaveBeenCalledWith('PB-DOWN-PAYMENT');
});
it('AC-PB-011 Finance reads the item but has no writer', async () => {
  h.canManage = false; h.get.mockResolvedValue('PB-DOWN-PAYMENT');
  renderSetting();
  expect(await screen.findByText('PB-DOWN-PAYMENT')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save item' })).not.toBeInTheDocument();
  expect(h.loadItems).not.toHaveBeenCalled();
});
it('AC-PB-011 a refused write keeps the value editable and shows why', async () => {
  h.set.mockRejectedValue(new Error('Only an Admin can change the down payment item.'));
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Down payment item' }));
  await user.click(await screen.findByRole('option', { name: /PB-DOWN-PAYMENT/ }));
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(await screen.findByText('Only an Admin can change the down payment item.')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Down payment item' })).toHaveTextContent('PB-DOWN-PAYMENT');
});
it('AC-PB-011 a failed read offers retry and no writer', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue('PB-DOWN-PAYMENT');
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the down payment item")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save item' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByRole('combobox', { name: 'Down payment item' })).toHaveTextContent('PB-DOWN-PAYMENT');
});

it('AC-S11-004 retains a saved item absent from the current list until the Admin replaces and saves it', async () => {
  h.get.mockResolvedValue('LEGACY-ADVANCE');
  renderSetting();
  const user = userEvent.setup();
  const field = await screen.findByRole('combobox', { name: 'Down payment item' });

  expect(field).toHaveTextContent('LEGACY-ADVANCE');
  expect(screen.getByRole('button', { name: 'Save item' })).toBeDisabled();
  await user.click(field);
  expect(await screen.findByRole('option', { name: /PB-DOWN-PAYMENT/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /LEGACY-ADVANCE/ })).not.toBeInTheDocument();
  expect(h.set).not.toHaveBeenCalled();
  await user.click(screen.getByRole('option', { name: /PB-DOWN-PAYMENT/ }));
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(h.set).toHaveBeenCalledWith('PB-DOWN-PAYMENT');
});

it('AC-S11-004 does not request items without an active binding and keeps an existing item available to clear', async () => {
  h.bindingStatus = 'inactive';
  h.get.mockResolvedValue('LEGACY-ADVANCE');
  renderSetting();
  const user = userEvent.setup();
  const field = await screen.findByRole('combobox', { name: 'Down payment item' });

  expect(field).toBeDisabled();
  expect(field).toHaveTextContent('LEGACY-ADVANCE');
  expect(screen.getByText(/active ERPNext organization connection is needed/)).toBeInTheDocument();
  expect(h.loadItems).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Clear item' }));
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(h.set).toHaveBeenCalledWith(null);
});

it('AC-S11-004 does not treat an unreadable ERPNext binding as a missing connection', async () => {
  h.bindingError = true;
  renderSetting();

  expect(await screen.findByText(/Couldn't check ERPNext setup/)).toBeInTheDocument();
  expect(screen.queryByText(/active ERPNext organization connection is needed/)).not.toBeInTheDocument();
  expect(h.loadItems).not.toHaveBeenCalled();
});

it('AC-S11-004 distinguishes an empty item list from an unavailable account default', async () => {
  h.loadItems.mockResolvedValue([]);
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Down payment item' }));

  expect(await screen.findByText(/No ERPNext sales items were returned/)).toBeInTheDocument();
  expect(screen.getByText(/check the item's account before saving/)).toBeInTheDocument();
  expect(h.set).not.toHaveBeenCalled();
});

it('AC-S11-004 retains an item draft when the saved setting changes remotely', async () => {
  const client = renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Down payment item' }));
  await user.click(await screen.findByRole('option', { name: /PB-DOWN-PAYMENT/ }));
  client.setQueryData(['org-down-payment-item', 'fixture-org'], 'REMOTE-ADVANCE');

  expect(await screen.findByText(/The saved item changed/)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Down payment item' })).toHaveTextContent('PB-DOWN-PAYMENT');
  expect(h.set).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Reload saved values' }));
  expect(screen.getByRole('combobox', { name: 'Down payment item' })).toHaveTextContent('REMOTE-ADVANCE');
});
