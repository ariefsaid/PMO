import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

const h = vi.hoisted(() => ({
  binding: null as { status: string } | null,
  ownership: [] as Array<{ externalTier: string; domain: string }>,
  list: vi.fn(async () => []),
  save: vi.fn(async () => undefined),
  toast: vi.fn(),
}));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: h.binding, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: h.ownership, isPending: false, isError: false }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/lib/repositories', () => ({ repositories: {
  expensePostings: { listAccountMap: h.list },
  integrations: { saveExpenseAccount: h.save, clearExpenseAccount: vi.fn() },
} }));
vi.mock('@/src/components/ui', async (original) => {
  const actual = await original<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: h.toast }) };
});

import ExpenseAccountMap from './ExpenseAccountMap';

function renderMap() {
  return render(<FinanceI18nTestProvider><MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><ExpenseAccountMap /></ToastProvider>
  </QueryClientProvider></MemoryRouter></FinanceI18nTestProvider>);
}

beforeEach(async () => {
  await financeTestI18nReady;
  await financeTestI18n.changeLanguage('en');
  h.binding = null;
  h.ownership = [];
  h.list.mockResolvedValue([]);
  h.save.mockResolvedValue(undefined);
  h.toast.mockClear();
});

describe('expense account readiness (AD-2)', () => {
  it('requires an ERP connection before expense mapping', async () => {
    renderMap();
    expect(await screen.findByText('Connect ERPNext before mapping expense accounts. Expense posting is not active.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open integrations' })).toBeInTheDocument();
    expect(screen.getAllByText('Not mapped').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Map Travel' })).toBeNull();
  });

  it('requires the expenses domain to be active on a connected ERP', async () => {
    h.binding = { status: 'active' };
    renderMap();
    expect(await screen.findByText('Connect ERPNext before mapping expense accounts. Expense posting is not active.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map Travel' })).toBeNull();
  });

  it('uses the AD-2 integrations remedy for the external-set-company CONFIG_REJECTED AppError while preserving the account remedy', async () => {
    const { AppError } = await import('@/src/lib/appError');
    h.binding = { status: 'active' };
    h.ownership = [{ externalTier: 'erpnext', domain: 'expenses' }];
    h.save.mockRejectedValueOnce(new AppError('company binding refused', 'CONFIG_REJECTED'));
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: 'Map Travel' }));
    await user.type(await screen.findByRole('textbox'), 'Travel');
    await user.click(screen.getByRole('button', { name: /Save account|Simpan akun/ }));
    expect(await screen.findByText('Connect ERPNext before mapping expense accounts. Expense posting is not active.')).toBeInTheDocument();

    h.save.mockRejectedValueOnce(new AppError('account rejected', 'config-rejected'));
    await user.click(screen.getByRole('button', { name: 'Map Travel' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Travel');
    await user.click(screen.getByRole('button', { name: /Save account|Simpan akun/ }));
    expect(await screen.findByText('Check the account name and type in ERPNext, then try again. Your entry is kept.')).toBeInTheDocument();
  });

  it('keeps one localized persistent error and the entry after an account refusal (AD-3)', async () => {
    h.binding = { status: 'active' };
    h.ownership = [{ externalTier: 'erpnext', domain: 'expenses' }];
    h.save.mockRejectedValueOnce(Object.assign(new Error('private diagnostic'), { code: 'config-rejected' }));
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: 'Map Travel' }));
    await screen.findByRole('dialog');
    const field = await screen.findByRole('textbox');
    await user.type(field, 'Draft account');
    await user.click(screen.getByRole('button', { name: /Save account|Simpan akun/ }));
    expect(await screen.findByText('Couldn’t save the expense account')).toBeInTheDocument();
    expect(screen.getByText('Check the account name and type in ERPNext, then try again. Your entry is kept.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Draft account');
    expect(screen.getAllByText('Couldn’t save the expense account')).toHaveLength(1);
    expect(h.toast).not.toHaveBeenCalledWith('Couldn’t save the expense account', expect.anything(), 'warning');
  });

  it('offers account mapping only when the connected expenses domain is active', async () => {
    h.binding = { status: 'active' };
    h.ownership = [{ externalTier: 'erpnext', domain: 'expenses' }];
    renderMap();
    expect(await screen.findByRole('button', { name: 'Map Travel' })).toBeEnabled();
    expect(screen.queryByText('Connect ERPNext before mapping expense accounts. Expense posting is not active.')).toBeNull();
  });
});
