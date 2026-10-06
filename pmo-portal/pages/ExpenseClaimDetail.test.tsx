import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number, c: string) => formatCurrencyCents(v, c).replace(/\u00a0/g, ' ');

const h = vi.hoisted(() => ({
  claim: null as unknown,
  route: null as unknown,
  outstanding: null as number | null,
  userId: 'eng',
  realRole: 'Engineer',
  m: {
    transition: { mutateAsync: vi.fn(), isPending: false }, recordReturn: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false }, addLine: { mutateAsync: vi.fn(), isPending: false },
    updateLine: { mutateAsync: vi.fn(), isPending: false }, removeLine: { mutateAsync: vi.fn(), isPending: false },
  },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaim: () => ({ data: h.claim, isPending: false, isError: false, refetch: vi.fn() }),
  useExpenseClaimLines: () => ({ data: [], isPending: false, isError: false }),
  useExpenseClaimRoute: () => ({ data: h.route }),
  useExpenseAdvanceOutstanding: () => ({ data: h.outstanding }),
  useExpenseAdvanceAging: () => ({ data: { rows: [], truncated: false } }),
  useExpenseClaimMutations: () => h.m,
}));
vi.mock('@/src/hooks/useExpenseReceipts', () => ({
  useExpenseReceipts: () => ({
    list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn() }, archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(), progress: null, uploadError: null, clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import ExpenseClaimDetail from './ExpenseClaimDetail';

const base = {
  id: 'c1', kind: 'claim', claim_number: 'EXP-2610060001', claimant_id: 'eng', claimant: { full_name: 'Budi Field' },
  project_id: null, project: null, budget_category: 'Special expenses', title: 'Site visit', purpose: null,
  currency: 'IDR', amount: 300, advance_id: null, advance_applied: 0, returned_amount: 0, status: 'Draft',
  approved_by_id: null, payment_reference: null, rejection_notes: null,
};
const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/expenses/c1']}>
      <ToastProvider>
        <Routes><Route path="/expenses/:claimId" element={<ExpenseClaimDetail />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
const as = (userId: string, role: string) => { h.userId = userId; h.realRole = role; };

beforeEach(() => { h.route = null; h.outstanding = null; });

describe('ExpenseClaimDetail', () => {
  it('AC-EXP-061 the claimant of a Draft can add lines and submit', () => {
    h.claim = { ...base };
    as('eng', 'Engineer');
    renderAt();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
  });

  it('AC-EXP-061 a PM the route does not name sees who decides and no Approve', () => {
    h.claim = { ...base, status: 'Submitted' };
    h.route = { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'pma', fullName: 'Ayu Approver' }], requestAmount: 300, lineBudget: 500, lineUsed: 0 };
    as('pm', 'Project Manager');
    renderAt();
    expect(screen.getByTestId('approval-route-note')).toHaveTextContent('Ayu Approver');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('AC-EXP-061 the named approver sees Approve', () => {
    h.claim = { ...base, status: 'Submitted' };
    h.route = { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'pma', fullName: 'Ayu Approver' }], requestAmount: 300, lineBudget: 500, lineUsed: 0 };
    as('pma', 'Project Manager');
    renderAt();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('AC-EXP-061 Finance paying an advance-linked claim sees the advance applied and the cash to pay', async () => {
    h.claim = { ...base, status: 'Approved', approved_by_id: 'pm', advance_id: 'adv-1' };
    h.outstanding = 250;
    as('f2', 'Finance');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    expect(await screen.findByTestId('pay-preview-applied')).toHaveTextContent(money(250, 'IDR'));
    expect(screen.getByTestId('pay-preview-cash')).toHaveTextContent(money(50, 'IDR'));
  });

  it('AC-EXP-061 the claimant of an Approved claim cannot pay it', () => {
    h.claim = { ...base, status: 'Approved', approved_by_id: 'pm' };
    as('eng', 'Engineer');
    renderAt();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
  });
});
