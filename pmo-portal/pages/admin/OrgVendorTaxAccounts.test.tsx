import React from 'react';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: {
  getVendorTaxAccounts: h.get, setVendorTaxAccounts: h.set,
} } }));
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
  h.get.mockResolvedValue(NONE);
  h.set.mockResolvedValue(undefined);
  await financeTestI18n.changeLanguage('en');
});
function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<FinanceI18nTestProvider><QueryClientProvider client={client}>
    <ToastProvider><OrgVendorTaxAccounts /></ToastProvider>
  </QueryClientProvider></FinanceI18nTestProvider>);
  return client;
}

it('AC-VWH-029 an Admin sets the three vendor-bill tax accounts (trimmed; blank is none)', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Input VAT account'), ' Input VAT - DEMO ');
  await user.type(screen.getByLabelText('PPh 23 payable account'), 'PPh 23 Payable - DEMO');
  await user.click(screen.getByRole('button', { name: 'Save accounts' }));
  expect(h.set).toHaveBeenCalledWith({ inputVatAccount: 'Input VAT - DEMO', pph23PayableAccount: 'PPh 23 Payable - DEMO', pph42PayableAccount: null });
});

it('AC-VWH-029 preserves a dirty draft on refreshed data and offers an explicit reload', async () => {
  const client = renderSetting();
  const user = userEvent.setup();
  const input = await screen.findByLabelText('Input VAT account');
  await user.type(input, 'Draft VAT account');
  client.setQueryData(['org-vendor-tax-accounts', 'fixture-org'], { inputVatAccount: 'Remote VAT', pph23PayableAccount: null, pph42PayableAccount: null });
  expect(await screen.findByText('The saved accounts changed. Your edits are kept; reload the saved values to discard them.')).toBeInTheDocument();
  expect(input).toHaveValue('Draft VAT account');
  await user.click(screen.getByRole('button', { name: 'Reload saved values' }));
  expect(input).toHaveValue('Remote VAT');
});

it('AC-VWH-029 a non-Admin sees the accounts read-only', async () => {
  h.canManage = false;
  h.get.mockResolvedValue({ ...NONE, inputVatAccount: 'Input VAT - DEMO' });
  renderSetting();
  expect(await screen.findByText('Input VAT - DEMO')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save accounts' })).toBeNull();
});

it('AC-VWH-029 a failed read offers a retry and no write', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue(NONE);
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the tax accounts")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save accounts' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByLabelText('Input VAT account')).toBeInTheDocument();
});

it('AC-VWH-029 the setting renders in Bahasa Indonesia', async () => {
  await financeTestI18n.changeLanguage('id');
  renderSetting();
  expect(await screen.findByText('Akun pajak tagihan vendor')).toBeInTheDocument();
  expect(await screen.findByLabelText('Akun PPN Masukan')).toBeInTheDocument();
});
