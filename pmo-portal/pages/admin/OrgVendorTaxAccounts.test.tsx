import React from 'react';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, bindingStatus: 'active', bindingError: false, retryBinding: vi.fn(), get: vi.fn(), set: vi.fn(), listAccounts: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: {
  getVendorTaxAccounts: h.get, setVendorTaxAccounts: h.set,
} } }));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({ listBudgetPostingAccountCatalogue: h.listAccounts }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({
  useErpnextBinding: () => ({ data: { status: h.bindingStatus }, isPending: false, isError: h.bindingError, refetch: h.retryBinding }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgVendorTaxAccounts from './OrgVendorTaxAccounts';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

const NONE = { inputVatAccount: null, pph23PayableAccount: null, pph42PayableAccount: null };
beforeAll(async () => { await financeTestI18nReady; });
beforeEach(async () => {
  vi.clearAllMocks();
  h.canManage = true;
  h.bindingStatus = 'active';
  h.bindingError = false;
  h.get.mockResolvedValue(NONE);
  h.set.mockResolvedValue(undefined);
  h.listAccounts.mockResolvedValue({
    accounts: [
      { account: '1160 - Input VAT', accountName: 'Input VAT', accountNumber: '1160', parentAccount: 'Current Assets', rootType: 'Asset', isGroup: false, disabled: false },
      { account: '2150 - PPh 23 Payable', accountName: 'PPh 23 Payable', accountNumber: '2150', parentAccount: 'Tax Liabilities', rootType: 'Liability', isGroup: false, disabled: false },
      { account: '2160 - PPh 4(2) Payable', accountName: 'PPh 4(2) Payable', accountNumber: '2160', parentAccount: 'Tax Liabilities', rootType: 'Liability', isGroup: false, disabled: false },
      { account: '5100 - Expense', accountName: 'Expense', accountNumber: '5100', parentAccount: 'Expenses', rootType: 'Expense', isGroup: false, disabled: false },
    ],
    source: 'mirror',
  });
  await financeTestI18n.changeLanguage('en');
});
function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<FinanceI18nTestProvider><QueryClientProvider client={client}>
    <ToastProvider><OrgVendorTaxAccounts /></ToastProvider>
  </QueryClientProvider></FinanceI18nTestProvider>);
  return client;
}

it('AC-S11-003 an Admin reviews the three purpose-filtered accounts and saves exact values only on submit', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Input VAT account' }));
  await user.click(await screen.findByRole('option', { name: /1160 - Input VAT/ }));
  await user.click(screen.getByRole('combobox', { name: 'PPh 23 payable account' }));
  await user.click(await screen.findByRole('option', { name: /2150 - PPh 23 Payable/ }));
  await user.click(screen.getByRole('combobox', { name: 'PPh 4(2) payable account' }));
  await user.click(await screen.findByRole('option', { name: /2160 - PPh 4\(2\) Payable/ }));
  expect(h.set).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save accounts' }));
  expect(h.set).toHaveBeenCalledTimes(1);
  expect(h.set).toHaveBeenCalledWith({ inputVatAccount: '1160 - Input VAT', pph23PayableAccount: '2150 - PPh 23 Payable', pph42PayableAccount: '2160 - PPh 4(2) Payable' });
});

it('AC-S11-003 clearing a saved vendor account explicitly sends null and keeps the existing setter shape', async () => {
  h.get.mockResolvedValue({ ...NONE, inputVatAccount: '1160 - Input VAT' });
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Clear account' }));
  await user.click(screen.getByRole('button', { name: 'Save accounts' }));

  expect(h.set).toHaveBeenCalledTimes(1);
  expect(h.set).toHaveBeenCalledWith({ inputVatAccount: null, pph23PayableAccount: null, pph42PayableAccount: null });
});

it('AC-S11-003 a refused write keeps the reviewed selection available to retry', async () => {
  h.set.mockRejectedValue(new Error('Choose a valid ERP tax account.'));
  renderSetting();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Input VAT account' }));
  await user.click(await screen.findByRole('option', { name: /1160 - Input VAT/ }));
  await user.click(screen.getByRole('button', { name: 'Save accounts' }));

  expect(await screen.findByText('Choose a valid ERP tax account.')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Input VAT account' })).toHaveTextContent('1160 - Input VAT');
  expect(screen.getByRole('button', { name: 'Save accounts' })).toBeEnabled();
});

it('AC-VWH-029 preserves a dirty draft on refreshed data and offers an explicit reload', async () => {
  const client = renderSetting();
  const user = userEvent.setup();
  const input = await screen.findByRole('combobox', { name: 'Input VAT account' });
  await user.click(input);
  await user.click(await screen.findByRole('option', { name: /1160 - Input VAT/ }));
  client.setQueryData(['org-vendor-tax-accounts', 'fixture-org'], { inputVatAccount: 'Remote VAT', pph23PayableAccount: null, pph42PayableAccount: null });
  expect(await screen.findByText(/The saved accounts changed/)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Input VAT account' })).toHaveTextContent('1160 - Input VAT');
  expect(h.set).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Reload saved values' }));
  expect(screen.getByRole('combobox', { name: 'Input VAT account' })).toHaveTextContent('Remote VAT');
});

it('AC-VWH-029 a non-Admin sees the accounts read-only', async () => {
  h.canManage = false;
  h.get.mockResolvedValue({ ...NONE, inputVatAccount: 'Input VAT - DEMO' });
  renderSetting();
  expect(await screen.findByText('Input VAT - DEMO')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save accounts' })).toBeNull();
});

it('AC-S11-003 keeps an unreadable binding status distinct from a missing connection', async () => {
  h.bindingError = true;
  renderSetting();

  expect(await screen.findByText(/Couldn't check ERPNext setup/)).toBeInTheDocument();
  expect(screen.queryByText(/active ERPNext organization connection is needed/)).not.toBeInTheDocument();
  expect(h.listAccounts).not.toHaveBeenCalled();
});

it('AC-VWH-029 a failed read offers a retry and no write', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue(NONE);
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the tax accounts")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save accounts' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByRole('combobox', { name: 'Input VAT account' })).toBeInTheDocument();
});

it('AC-VWH-029 the setting renders in Bahasa Indonesia', async () => {
  await financeTestI18n.changeLanguage('id');
  renderSetting();
  expect(await screen.findByText('Akun pajak tagihan vendor')).toBeInTheDocument();
  expect(await screen.findByRole('combobox', { name: 'Akun PPN Masukan' })).toBeInTheDocument();
});
