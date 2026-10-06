import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { getDownPaymentItem: h.get, setDownPaymentItem: h.set } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgDownPaymentItem from './OrgDownPaymentItem';
beforeEach(() => { vi.clearAllMocks(); h.canManage = true; h.get.mockResolvedValue(null); h.set.mockResolvedValue(undefined); });
function renderSetting() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrgDownPaymentItem /></ToastProvider>
  </QueryClientProvider>);
}
it('AC-PB-011 an Admin sets the down payment item', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Down payment item'), 'PB-DOWN-PAYMENT');
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(h.set).toHaveBeenCalledWith('PB-DOWN-PAYMENT');
});
it('AC-PB-011 Finance reads the item but has no writer', async () => {
  h.canManage = false; h.get.mockResolvedValue('PB-DOWN-PAYMENT');
  renderSetting();
  expect(await screen.findByText('PB-DOWN-PAYMENT')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save item' })).not.toBeInTheDocument();
});
it('AC-PB-011 a refused write keeps the value editable and shows why', async () => {
  h.set.mockRejectedValue(new Error('Only an Admin can change the down payment item.'));
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Down payment item'), 'PB-DOWN-PAYMENT');
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(await screen.findByText('Only an Admin can change the down payment item.')).toBeInTheDocument();
  expect(screen.getByLabelText('Down payment item')).toHaveValue('PB-DOWN-PAYMENT');
});
it('AC-PB-011 a failed read offers retry and no writer', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue('PB-DOWN-PAYMENT');
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the down payment item")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save item' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByLabelText('Down payment item')).toHaveValue('PB-DOWN-PAYMENT');
});
