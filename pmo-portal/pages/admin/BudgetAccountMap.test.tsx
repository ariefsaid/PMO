/**
 * AC-BUD-011/012 — pages/admin/BudgetAccountMap.tsx: the Admin CRUD surface for the category↔account
 * BIJECTION (FR-BUD-110..113). Mirrors AdminUsers.test.tsx's "react-query + the repository seam
 * directly" mocking idiom (`@/src/lib/repositories/budgetProjection` is mocked; usePermission reads
 * the real JWT role via the mocked `useEffectiveRole`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { listMock, createMock, updateMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  listBudgetCategoryAccountMap: listMock,
  createBudgetCategoryAccountMapRow: createMock,
  updateBudgetCategoryAccountMapRow: updateMock,
  deleteBudgetCategoryAccountMapRow: deleteMock,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import BudgetAccountMap from './BudgetAccountMap';

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <BudgetAccountMap />
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  listMock.mockResolvedValue([{ category: 'Labor', erpAccount: '5100 - Direct Costs' }]);
  createMock.mockResolvedValue({ category: 'Materials', erpAccount: '5200 - Materials' });
  updateMock.mockResolvedValue({ category: 'Labor', erpAccount: '5100 - New Account' });
  deleteMock.mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('BudgetAccountMap — the 7 categories, always all present (AC-BUD-010/011/012)', () => {
  it('renders all 7 budget categories as rows, mapped ones showing the account, others "Not mapped"', async () => {
    renderPage();
    for (const cat of ['Labor', 'Materials', 'Subcontractors', 'Equipment', 'Permits & Fees', 'Overheads', 'Contingency']) {
      expect(await screen.findByText(cat)).toBeInTheDocument();
    }
    expect(screen.getByText('5100 - Direct Costs')).toBeInTheDocument();
    expect(screen.getAllByText('Not mapped')).toHaveLength(6);
  });

  it('shows a loading state while the map is fetching', () => {
    listMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByTestId('budget-account-map-loading')).toBeInTheDocument();
  });

  it('shows an error state with retry on a failed fetch', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
  });
});

describe('BudgetAccountMap — Admin-only affordances (FR-BUD-112)', () => {
  it('Admin sees Map/Edit + Unmap controls', async () => {
    renderPage('Admin');
    expect(await screen.findByRole('button', { name: /edit.*labor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /map materials/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unmap labor/i })).toBeInTheDocument();
  });

  it('a non-Admin (Engineer) sees the same rows read-only — no write affordances', async () => {
    renderPage('Engineer');
    expect(await screen.findByText('5100 - Direct Costs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit.*labor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /map materials/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unmap labor/i })).not.toBeInTheDocument();
  });
});

describe('BudgetAccountMap — CRUD (AC-BUD-010/011/012)', () => {
  it('maps a previously-unmapped category (create)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /map materials/i }));
    const modal = await screen.findByRole('dialog');
    await user.type(within(modal).getByLabelText(/erp account/i), '5200 - Materials');
    await user.click(within(modal).getByRole('button', { name: /save/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith('Materials', '5200 - Materials'));
  });

  it('repoints an already-mapped category (update)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /edit.*labor/i }));
    const modal = await screen.findByRole('dialog');
    const field = within(modal).getByLabelText(/erp account/i);
    await user.clear(field);
    await user.type(field, '5100 - New Account');
    await user.click(within(modal).getByRole('button', { name: /save/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('Labor', '5100 - New Account'));
  });

  it('⚑ the BIJECTION: mapping an account already used by ANOTHER category is blocked client-side, naming the conflict', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /map materials/i }));
    const modal = await screen.findByRole('dialog');
    await user.type(within(modal).getByLabelText(/erp account/i), '5100 - Direct Costs');
    await user.click(within(modal).getByRole('button', { name: /save/i }));
    expect((await within(modal).findAllByText(/already mapped to labor/i)).length).toBeGreaterThan(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('unmaps a category with a confirm dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /unmap labor/i }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /unmap/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('Labor'));
  });
});
