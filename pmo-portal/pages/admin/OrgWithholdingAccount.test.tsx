import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, bindingStatus: 'active', bindingError: false, retryBinding: vi.fn(), get: vi.fn(), set: vi.fn(), listAccounts: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: {
  getWithholdingAccount: h.get, setWithholdingAccount: h.set,
} } }));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  listBudgetPostingAccountCatalogue: h.listAccounts,
}));
vi.mock('@/src/hooks/useErpnextBinding', () => ({
  useErpnextBinding: () => ({ data: { status: h.bindingStatus }, isPending: false, isError: h.bindingError, refetch: h.retryBinding }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgWithholdingAccount from './OrgWithholdingAccount';
beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.bindingStatus = 'active';
  h.bindingError = false;
  h.get.mockResolvedValue(null);
  h.set.mockResolvedValue(undefined);
  h.listAccounts.mockResolvedValue({
    accounts: [
      { account: 'Tax Prepaid - DEMO', accountName: 'Tax Prepaid', accountNumber: '1150', parentAccount: 'Current Assets', rootType: 'Asset', isGroup: false, disabled: false },
      { account: 'Tax Payable - DEMO', accountName: 'Tax Payable', accountNumber: '2150', parentAccount: 'Current Liabilities', rootType: 'Liability', isGroup: false, disabled: false },
    ],
    source: 'mirror',
  });
});
function renderSetting() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>
    <ToastProvider><OrgWithholdingAccount /></ToastProvider>
  </QueryClientProvider>);
  return queryClient;
}
it('AC-WHT-004: an Admin can configure the tax-prepaid account used by receipt deductions', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Tax-prepaid account' }));
  await user.click(await screen.findByRole('option', { name: /Tax Prepaid - DEMO/ }));
  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(h.set).toHaveBeenCalledWith('Tax Prepaid - DEMO');
});
it('AC-WHT-004: Finance can read the account but has no setting writer', async () => {
  h.canManage = false; h.get.mockResolvedValue('Tax Prepaid - DEMO');
  renderSetting();
  expect(await screen.findByText('Tax Prepaid - DEMO')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save account' })).not.toBeInTheDocument();
  expect(h.listAccounts).not.toHaveBeenCalled();
});
it('AC-WHT-004: a refused setting write keeps the account editable and shows a recoverable error', async () => {
  h.set.mockRejectedValue(new Error('Choose a valid ERP tax account.'));
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Tax-prepaid account' }));
  await user.click(await screen.findByRole('option', { name: /Tax Prepaid - DEMO/ }));
  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(await screen.findByText('Choose a valid ERP tax account.')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Tax-prepaid account' })).toHaveTextContent('Tax Prepaid - DEMO');
  expect(screen.getByRole('button', { name: 'Save account' })).toBeEnabled();
});
it('AC-WHT-004: clearing an existing account explicitly disables receipt withholding', async () => {
  h.get.mockResolvedValue('Tax Prepaid - DEMO');
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Clear account' }));
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
  expect(await screen.findByRole('combobox', { name: 'Tax-prepaid account' })).toHaveTextContent('Tax Prepaid - DEMO');
});

it('AC-S11-002: an Admin explicitly chooses an Asset account before saving receipt withholding', async () => {
  h.listAccounts.mockResolvedValue({
    accounts: [
      { account: '1120 - Tax Credit', accountName: 'Tax Credit', accountNumber: '1120', parentAccount: 'Current Assets', rootType: 'Asset', isGroup: false, disabled: false },
      { account: '2190 - Tax Payable', accountName: 'Tax Payable', accountNumber: '2190', parentAccount: 'Current Liabilities', rootType: 'Liability', isGroup: false, disabled: false },
    ],
    source: 'mirror',
  });
  renderSetting();
  const user = userEvent.setup();

  await user.click(await screen.findByRole('combobox', { name: 'Tax-prepaid account' }));
  await user.click(await screen.findByRole('option', { name: /1120 - Tax Credit/ }));

  expect(h.set).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(h.set).toHaveBeenCalledWith('1120 - Tax Credit');
});

it('AC-S11-002: a saved value missing from the catalogue stays visible until an Admin replaces it and saves', async () => {
  h.get.mockResolvedValue('Legacy Account - DEMO');
  renderSetting();
  const user = userEvent.setup();
  const field = await screen.findByRole('combobox', { name: 'Tax-prepaid account' });

  expect(field).toHaveTextContent('Legacy Account - DEMO');
  expect(screen.getByRole('button', { name: 'Save account' })).toBeDisabled();
  await user.click(field);
  expect(screen.queryByRole('option', { name: /Legacy Account - DEMO/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: /Tax Prepaid - DEMO/ }));
  expect(h.set).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(h.set).toHaveBeenCalledWith('Tax Prepaid - DEMO');
});

it('AC-S11-002: an Admin draft survives a remote setting refresh and can explicitly reload the saved choice', async () => {
  const queryClient = renderSetting();
  const user = userEvent.setup();
  const field = await screen.findByRole('combobox', { name: 'Tax-prepaid account' });
  await user.click(field);
  await user.click(await screen.findByRole('option', { name: /Tax Prepaid - DEMO/ }));

  queryClient.setQueryData(['org-withholding-account', 'fixture-org'], 'Remote Account - DEMO');

  expect(await screen.findByText(/The saved account changed/)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Tax-prepaid account' })).toHaveTextContent('Tax Prepaid - DEMO');
  expect(h.set).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Reload saved value' }));
  expect(screen.getByRole('combobox', { name: 'Tax-prepaid account' })).toHaveTextContent('Remote Account - DEMO');
  expect(h.set).not.toHaveBeenCalled();
});

it('AC-S11-002: without an active ERPNext binding the chart is not queried and the saved choice remains clearable', async () => {
  h.bindingStatus = 'inactive';
  h.get.mockResolvedValue('Tax Prepaid - DEMO');
  renderSetting();
  const user = userEvent.setup();
  const field = await screen.findByRole('combobox', { name: 'Tax-prepaid account' });

  expect(field).toBeDisabled();
  expect(screen.getByText(/active ERPNext organization connection is needed/)).toBeInTheDocument();
  expect(h.listAccounts).not.toHaveBeenCalled();
  expect(field).toHaveTextContent('Tax Prepaid - DEMO');

  await user.click(screen.getByRole('button', { name: 'Clear account' }));
  await user.click(screen.getByRole('button', { name: 'Save account' }));
  expect(h.set).toHaveBeenCalledWith(null);
});

it('AC-S11-002: an unknown binding status stays unknown and can be checked again', async () => {
  h.bindingError = true;
  renderSetting();
  const user = userEvent.setup();

  expect(await screen.findByText(/Couldn't check ERPNext setup/)).toBeInTheDocument();
  expect(screen.queryByText(/active ERPNext organization connection is needed/)).not.toBeInTheDocument();
  expect(h.listAccounts).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Check setup again' }));
  expect(h.retryBinding).toHaveBeenCalledTimes(1);
});

it('AC-S11-002: catalogue errors keep the saved value visible and offer a retry', async () => {
  h.get.mockResolvedValue('Tax Prepaid - DEMO');
  h.listAccounts.mockRejectedValueOnce(new Error('Temporary chart read failure')).mockResolvedValue({
    accounts: [
      { account: 'Tax Prepaid - DEMO', accountName: 'Tax Prepaid', accountNumber: '1150', parentAccount: 'Current Assets', rootType: 'Asset', isGroup: false, disabled: false },
    ],
    source: 'mirror',
  });
  renderSetting();
  const user = userEvent.setup();

  expect(await screen.findByText("Couldn't load chart accounts")).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Tax-prepaid account' })).toHaveTextContent('Tax Prepaid - DEMO');
  expect(screen.getByRole('button', { name: 'Save account' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByRole('combobox', { name: 'Tax-prepaid account' })).toHaveTextContent('Tax Prepaid - DEMO');
});
