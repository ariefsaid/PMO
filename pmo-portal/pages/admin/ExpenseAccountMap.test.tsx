/**
 * AC-EXP-130 — pages/admin/ExpenseAccountMap.tsx (#775 phase B, FR-EXP-116): the 7 keys an expense posting needs,
 * mapped or flagged; Admin save/clear through the validating edge action; the server refusal shown in the form.
 * Mirrors BudgetAccountMap.test.tsx: react-query + the repository seam mocked, the real usePermission over a mocked
 * `useEffectiveRole`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { listMock, saveMock, clearMock } = vi.hoisted(() => ({ listMock: vi.fn(), saveMock: vi.fn(), clearMock: vi.fn() }));
vi.mock('@/src/lib/repositories/expensePostings', () => ({ listExpenseAccountMap: listMock }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { integrations: { saveExpenseAccount: saveMock, clearExpenseAccount: clearMock } },
}));
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import ExpenseAccountMap from './ExpenseAccountMap';

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <MemoryRouter initialEntries={['/administration/accounting']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ExpenseAccountMap />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([{ accountKey: 'employee_payable', erpAccount: 'Employee Payable - PSC', updatedAt: 't' }]);
  saveMock.mockReset().mockResolvedValue({ ok: true });
  clearMock.mockReset().mockResolvedValue({ ok: true });
});

describe('ExpenseAccountMap (AC-EXP-130)', () => {
  it('AC-EXP-130 renders all seven keys, mapped or flagged', async () => {
    renderPage();
    expect(await screen.findByText('Employee Payable - PSC')).toBeInTheDocument();
    const rows = screen.getAllByTestId('expense-account-row');
    expect(rows).toHaveLength(7);
    expect(within(rows[0]).getByText('Employee payable')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Not mapped — expense posting stops')).toBeInTheDocument();
    expect(screen.getAllByText('Not mapped — expense posting stops')).toHaveLength(6);
  });

  it('AC-EXP-130 an Admin saves a key with the trimmed account', async () => {
    renderPage();
    await screen.findByText('Employee Payable - PSC');
    await userEvent.click(screen.getByRole('button', { name: 'Map Employee advances' }));
    await userEvent.type(screen.getByLabelText(/ERP account/), '  Employee Advances - PSC  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save account' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ accountKey: 'employee_advance', erpAccount: 'Employee Advances - PSC' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save account' })).toBeNull());
    expect(listMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('AC-EXP-130 the server refusal is shown in the form, and the form stays open', async () => {
    saveMock.mockRejectedValue(Object.assign(
      new Error("employee_payable: Creditors - PSC is the company's supplier payable account; use a separate employee payable account"),
      { code: 'config-rejected' },
    ));
    renderPage();
    await screen.findByText('Employee Payable - PSC');
    await userEvent.click(screen.getByRole('button', { name: 'Change Employee payable' }));
    await userEvent.clear(screen.getByLabelText(/ERP account/));
    await userEvent.type(screen.getByLabelText(/ERP account/), 'Creditors - PSC');
    await userEvent.click(screen.getByRole('button', { name: 'Save account' }));
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findAllByText(/supplier payable account/)).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Save account' })).toBeInTheDocument();
  });

  it('AC-EXP-130 an Admin clears a mapped key after confirming', async () => {
    renderPage();
    await screen.findByText('Employee Payable - PSC');
    await userEvent.click(screen.getByRole('button', { name: 'Clear Employee payable' }));
    expect(clearMock).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(clearMock).toHaveBeenCalledWith('employee_payable'));
  });

  it('AC-EXP-130 a non-Admin sees the map but no actions', async () => {
    renderPage('Finance');
    expect(await screen.findByText('Employee Payable - PSC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Map|Change|Clear) / })).toBeNull();
  });

  it('AC-EXP-130 a failed read shows the error state with a retry', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load the expense account map")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
