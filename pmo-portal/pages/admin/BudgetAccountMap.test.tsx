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
    expect(screen.getAllByText(/^Not mapped/)).toHaveLength(6);
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

/**
 * ⚑ I-8 (rendered Discover pass, 2026-07-22) — the budget banner now LINKS here, so this page has to
 * be (a) reachable by that link and (b) able to answer the question the operator arrives with:
 * "which of these is blocking my push?"
 */
describe('BudgetAccountMap — I-8: reachable, and it marks what is blocking', () => {
  it('I-8 the section carries the anchor the budget banner links to', async () => {
    renderPage('Admin');
    await screen.findByText('Labor');
    expect(document.getElementById('budget-account-map')).not.toBeNull();
  });

  // ── AC-ADMIA-004 (fragment deep-link): the canonical accounting link ships with
  //    `#budget-account-map`, and the shell preserves that fragment across the redirect.
  //
  //    A reference click on an in-page anchor makes the browser scroll; a route navigation that
  //    lands on the fragment (History API replace + async panel mount) does NOT auto-scroll. So the
  //    route-mounted panel must scroll/focus its own deep-link target once mounted, without
  //    trapping focus or adding a new visual token.
  it('AC-ADMIA-004 opens via #budget-account-map: the map scrolls into view and receives focus', async () => {
    window.location.hash = '#budget-account-map';
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    renderPage('Admin');
    await screen.findByText('Labor');
    const section = document.getElementById('budget-account-map')!;
    await waitFor(() => expect(document.activeElement).toBe(section));
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
    window.location.hash = '';
  });

  it('AC-ADMIA-004 without the fragment, the map does not steal focus', async () => {
    renderPage('Admin');
    await screen.findByText('Labor');
    expect(document.activeElement).not.toBe(document.getElementById('budget-account-map'));
  });

  it('I-8 an UNMAPPED category is marked as blocking every push, not merely "Not mapped"', async () => {
    renderPage('Admin');
    await screen.findByText('Labor');
    const row = screen.getByText('Contingency').closest('tr')!;
    expect(within(row).getByText(/blocks every push/i)).toBeInTheDocument();
  });

  it('I-8 a MAPPED category is not marked as blocking', async () => {
    renderPage('Admin');
    const row = (await screen.findByText('Labor')).closest('tr')!;
    expect(within(row).queryByText(/blocks every push/i)).not.toBeInTheDocument();
  });
});
