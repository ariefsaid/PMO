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
  bindingPending: false,
  bindingError: false,
  bindingRefetch: vi.fn(async () => undefined),
  ownership: [] as Array<{ externalTier: string; domain: string }>,
  ownershipPending: false,
  ownershipError: false,
  ownershipRefetch: vi.fn(async () => undefined),
  list: vi.fn(async (): Promise<Array<{ accountKey: string; erpAccount: string }>> => []),
  save: vi.fn(async () => undefined),
  toast: vi.fn(),
}));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({
  data: h.binding, isPending: h.bindingPending, isError: h.bindingError, refetch: h.bindingRefetch,
}) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({
  data: h.ownership, isPending: h.ownershipPending, isError: h.ownershipError, refetch: h.ownershipRefetch,
}) }));
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
  h.bindingPending = false;
  h.bindingError = false;
  h.ownership = [];
  h.ownershipPending = false;
  h.ownershipError = false;
  h.list.mockResolvedValue([]);
  h.save.mockResolvedValue(undefined);
  h.toast.mockClear();
});

describe('expense account readiness (AD-2, S-12)', () => {
  it('names connecting ERPNext only when the org is actually not connected', async () => {
    renderMap();
    expect(await screen.findByText('Connect ERPNext before mapping expense accounts. Expense posting is not active.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open integrations' })).toBeInTheDocument();
    expect(screen.getAllByText('Not mapped').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Map Travel' })).toBeNull();
  });

  it('UX-080: an org that is connected but has expense posting switched off is told the missing step, never to connect again', async () => {
    h.binding = { status: 'active' };
    renderMap();
    expect(await screen.findByText(
      'ERPNext is connected, but expense posting is not switched on yet. An Admin can switch it on in Integrations under ERPNext setup.',
    )).toBeInTheDocument();
    // The contradictory reconnect instruction is gone, the recovery doorway stays.
    expect(screen.queryByText('Connect ERPNext before mapping expense accounts. Expense posting is not active.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open integrations' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map Travel' })).toBeNull();
    expect(screen.getAllByText('Not mapped').length).toBeGreaterThan(0);
  });

  it('unknown is distinct: a failed readiness read says it could not check and offers its own retry', async () => {
    h.bindingError = true;
    renderMap();
    expect(await screen.findByText("Couldn't check whether expense posting is ready. Try checking again.")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Check again' });
    await userEvent.click(retry);
    expect(h.bindingRefetch).toHaveBeenCalled();
    expect(h.ownershipRefetch).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Map Travel' })).toBeNull();
    expect(screen.queryByText('Connect ERPNext before mapping expense accounts. Expense posting is not active.')).toBeNull();
  });

  it('incomplete is distinct while ready: the unmapped count is named with its consequence, and disappears when fully mapped', async () => {
    h.binding = { status: 'active' };
    h.ownership = [{ externalTier: 'erpnext', domain: 'expenses' }];
    h.list.mockResolvedValue([{ accountKey: 'employee_payable', erpAccount: 'Employee Payable - ABC' }]);
    const first = renderMap();
    expect(await screen.findByRole('button', { name: 'Map Travel' })).toBeEnabled();
    expect(screen.getByText('6 of 7 accounts are not mapped yet. A posting that needs an unmapped account stops until it is mapped.')).toBeInTheDocument();
    expect(screen.getAllByText('Not mapped — expense posting stops')).toHaveLength(6);

    first.unmount();
    // Full map — the incomplete line is gone, every row reads mapped and offers Change.
    const allKeys = ['employee_payable', 'employee_advance', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other'];
    h.list.mockResolvedValue(allKeys.map((accountKey) => ({ accountKey, erpAccount: `${accountKey} - ABC` })));
    const { unmount } = renderMap();
    await screen.findByRole('button', { name: 'Change Travel' });
    expect(screen.queryByText(/accounts are not mapped yet/)).not.toBeInTheDocument();
    expect(screen.queryByText('Not mapped — expense posting stops')).toBeNull();
    unmount();
  });

  it('uses a state-neutral integrations remedy for the external-set-company CONFIG_REJECTED AppError while preserving the account remedy', async () => {
    const { AppError } = await import('@/src/lib/appError');
    h.binding = { status: 'active' };
    h.ownership = [{ externalTier: 'erpnext', domain: 'expenses' }];
    h.save.mockRejectedValueOnce(new AppError('company binding refused', 'CONFIG_REJECTED'));
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: 'Map Travel' }));
    await user.type(await screen.findByRole('textbox'), 'Travel');
    await user.click(screen.getByRole('button', { name: /Save account|Simpan akun/ }));
    // S-12: the org is connected, so a "connect ERPNext" refusal would contradict the Integrations
    // screen; the remedy names the connection setup instead.
    expect(await screen.findByText("Expense posting isn't ready right now, so the account was not saved. Check the ERPNext connection setup in Integrations.")).toBeInTheDocument();

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
