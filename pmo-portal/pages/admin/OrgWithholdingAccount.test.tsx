import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: {
  getWithholdingAccount: h.get, setWithholdingAccount: h.set,
} } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgWithholdingAccount from './OrgWithholdingAccount';
beforeEach(() => { vi.clearAllMocks(); h.canManage = true; h.get.mockResolvedValue(null); h.set.mockResolvedValue(undefined); });
function renderSetting() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrgWithholdingAccount /></ToastProvider>
  </QueryClientProvider>);
}
it('AC-WHT-004: an Admin can configure the tax-prepaid account used by receipt deductions', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Tax-prepaid account'), 'Tax Prepaid - DEMO');
  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(h.set).toHaveBeenCalledWith('Tax Prepaid - DEMO');
});
it('AC-WHT-004: Finance can read the account but has no setting writer', async () => {
  h.canManage = false; h.get.mockResolvedValue('Tax Prepaid - DEMO');
  renderSetting();
  expect(await screen.findByText('Tax Prepaid - DEMO')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save account' })).not.toBeInTheDocument();
});
it('AC-WHT-004: a refused setting write keeps the account editable and shows a recoverable error', async () => {
  h.set.mockRejectedValue(new Error('Choose a valid ERP tax account.'));
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Tax-prepaid account'), 'Tax Prepaid - DEMO');
  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(await screen.findByText('Choose a valid ERP tax account.')).toBeInTheDocument();
  expect(screen.getByLabelText('Tax-prepaid account')).toHaveValue('Tax Prepaid - DEMO');
  expect(screen.getByRole('button', { name: 'Save account' })).toBeEnabled();
});
it('AC-WHT-004: clearing an existing account explicitly disables receipt withholding', async () => {
  h.get.mockResolvedValue('Tax Prepaid - DEMO');
  renderSetting();
  const user = userEvent.setup();
  const field = await screen.findByLabelText('Tax-prepaid account');
  await user.clear(field);
  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(h.set).toHaveBeenCalledWith(null);
});
it('AC-WHT-004: a failed account read can be retried without offering a setting write', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue('Tax Prepaid - DEMO');
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the tax-prepaid account")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save account' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByLabelText('Tax-prepaid account')).toHaveValue('Tax Prepaid - DEMO');
});
