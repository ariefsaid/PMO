import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents, formatMoneyInputValue } from '@/src/lib/format';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number, c: string) => formatCurrencyCents(v, c).replace(/\u00a0/g, ' ');

const h = vi.hoisted(() => ({
  claim: null as unknown,
  route: null as unknown,
  outstanding: null as number | null,
  projects: [] as Array<{ id: string; name: string }>,
  agingRows: [] as Array<Record<string, unknown>>,
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
  useExpenseAdvanceAging: () => ({ data: { rows: h.agingRows, truncated: false } }),
  useExpenseClaimMutations: () => h.m,
}));
vi.mock('@/src/hooks/useExpenseReceipts', () => ({
  useExpenseReceipts: () => ({
    list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn() }, archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(), progress: null, uploadError: null, clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: h.projects }) }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'inactive', retry: vi.fn() }) }));
// #775 phase B — the Ledger postings card is proven by its own test (AC-EXP-131); it needs a QueryClient this page test does not mount.
vi.mock('./expenses/ExpensePostingsCard', () => ({ ExpensePostingsCard: () => null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import ExpenseClaimDetail from './ExpenseClaimDetail';
import { FinanceI18nTestProvider } from './__tests__/financeI18nTestProvider';
import { financeTestI18n } from './__tests__/financeI18nTestInstance';

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

beforeEach(() => {
  h.route = null;
  h.outstanding = null;
  h.projects = [];
  h.agingRows = [];
  h.m.update.mutateAsync.mockReset();
  h.m.update.mutateAsync.mockResolvedValue(undefined);
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
});
afterEach(() => resetActiveLocale());

const renderAtWithI18n = () =>
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter initialEntries={['/expenses/c1']}>
        <ToastProvider>
          <Routes><Route path="/expenses/:claimId" element={<ExpenseClaimDetail />} /></Routes>
        </ToastProvider>
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );

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

  it('AC-UXS-011 the named approver confirms the selected claim identity and amount', async () => {
    h.claim = { ...base, status: 'Submitted' };
    h.route = { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'pma', fullName: 'Ayu Approver' }], requestAmount: 300, lineBudget: 500, lineUsed: 0 };
    as('pma', 'Project Manager');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Approve EXP-2610060001 for');
    expect(dialog).toHaveTextContent('Site visit');
    expect(dialog).toHaveTextContent(money(300, 'IDR'));
  });

  it('AC-UXS-011 rejection also restates the record and amount without changing the note or decision', async () => {
    h.claim = { ...base, status: 'Submitted' };
    h.route = { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'pma', fullName: 'Ayu Approver' }], requestAmount: 300, lineBudget: 500, lineUsed: 0 };
    as('pma', 'Project Manager');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Reject EXP-2610060001?');
    expect(dialog).toHaveTextContent('Site visit');
    expect(dialog).toHaveTextContent(money(300, 'IDR'));
    expect(dialog).toHaveTextContent('Note to the claimant (optional)');
    expect(h.m.transition.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-UXS-011 cancellation restates the current claim before its existing safeguard', async () => {
    h.claim = { ...base, status: 'Submitted' };
    as('fin', 'Finance');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Cancel EXP-2610060001?');
    expect(dialog).toHaveTextContent('Site visit');
    expect(dialog).toHaveTextContent(money(300, 'IDR'));
    expect(dialog).toHaveTextContent('It stays on record as Cancelled');
    expect(h.m.transition.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-EXP-061 Finance paying an advance-linked claim sees the advance applied and the cash to pay', async () => {
    h.claim = { ...base, status: 'Approved', approved_by_id: 'pm', advance_id: 'adv-1' };
    h.outstanding = 250;
    as('f2', 'Finance');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Site visit');
    expect(dialog).toHaveTextContent(money(300, 'IDR'));
    expect(await screen.findByTestId('pay-preview-applied')).toHaveTextContent(money(250, 'IDR'));
    expect(screen.getByTestId('pay-preview-cash')).toHaveTextContent(money(50, 'IDR'));
    // The headline restates the cash actually paid, not the full claim the advance partly covers.
    expect(dialog).toHaveTextContent(`Mark EXP-2610060001 paid: ${money(50, 'IDR')}?`);
  });

  it('AC-UXS-011 cash-return confirmation keeps the advance and outstanding amount in context', async () => {
    h.claim = { ...base, kind: 'advance', claim_number: 'ADV-2610060001', title: 'Travel advance', amount: 700, status: 'Paid' };
    h.outstanding = 250;
    as('f2', 'Finance');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Record cash returned' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('ADV-2610060001 · Travel advance');
    expect(dialog).toHaveTextContent(money(700, 'IDR'));
    expect(dialog).toHaveTextContent(`Up to ${money(250, 'IDR')} is outstanding.`);
    expect(dialog).toHaveTextContent('Amount returned');
  });

  it('AC-UWC-004 retains claim edit prefill and sends the existing line-derived update patch', async () => {
    h.claim = {
      ...base, title: 'Original visit', project_id: 'project-1',
      project: { name: 'Project one' }, budget_category: 'Special expenses',
      purpose: 'Original purpose', advance_id: 'advance-1',
    };
    h.projects = [{ id: 'project-1', name: 'Project one' }];
    h.agingRows = [{ advanceId: 'advance-1', claimantId: 'eng', claimNumber: 'ADV-1', outstanding: 50, currency: 'IDR' }];
    as('eng', 'Engineer');
    renderAt();

    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Edit details');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    const textboxes = within(dialog).getAllByRole('textbox');
    const selects = within(dialog).getAllByRole('combobox');
    expect(textboxes[0]).toHaveValue('Original visit');
    expect(selects[0]).toHaveValue('project-1');
    expect(selects[1]).toHaveValue('Special expenses');
    expect(textboxes[1]).toHaveValue('Original purpose');
    expect(selects[2]).toHaveValue('advance-1');
    expect(dialog).not.toHaveTextContent(/expense posting to accounting isn't active/i);

    await userEvent.clear(textboxes[0]);
    await userEvent.type(textboxes[0], 'Updated visit');
    await userEvent.selectOptions(selects[0], '');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(h.m.update.mutateAsync).toHaveBeenCalledWith({
      id: 'c1', kind: 'claim',
      patch: expect.objectContaining({ title: 'Updated visit', projectId: null, amount: undefined }),
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('AC-UWC-004 retains localized advance edit values after a failed save and retries the parsed amount', async () => {
    h.claim = {
      ...base, kind: 'advance', claim_number: 'ADV-1', title: 'Original advance',
      amount: 1234.5, project_id: null, budget_category: 'Travel', purpose: 'Original purpose',
      advance_id: null, status: 'Draft',
    };
    as('eng', 'Engineer');
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    h.m.update.mutateAsync.mockRejectedValueOnce(new Error('temporary write failure'))
      .mockResolvedValueOnce(undefined);
    renderAtWithI18n();

    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog');
    const textboxes = within(dialog).getAllByRole('textbox');
    const amount = textboxes[1];
    expect(amount).toHaveValue(formatMoneyInputValue(1234.5));
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/expense posting to accounting isn't active/i);
    await userEvent.clear(amount);
    await userEvent.type(amount, '2.500,75');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByTestId('entity-modal-save-error')).toHaveTextContent(/nothing was saved/i);
    expect(amount).toHaveValue('2.500,75');
    expect(textboxes[0]).toHaveValue('Original advance');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(h.m.update.mutateAsync).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.m.update.mutateAsync).toHaveBeenCalledTimes(2));
    expect(h.m.update.mutateAsync).toHaveBeenLastCalledWith({
      id: 'c1', kind: 'advance',
      patch: expect.objectContaining({ title: 'Original advance', amount: 2500.75 }),
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('AC-EXP-061 the claimant of an Approved claim cannot pay it', () => {
    h.claim = { ...base, status: 'Approved', approved_by_id: 'pm' };
    as('eng', 'Engineer');
    renderAt();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
  });
});

describe('AC-UXS-011 Bahasa confirmations restate identity and amount', () => {
  // Renders under the shipped en+id catalogue instance (the default suite instance has empty
  // resources by design), so these assertions bind to public/locales/id/common.json itself.
  const renderAtId = () =>
    render(
      <FinanceI18nTestProvider>
        <MemoryRouter initialEntries={['/expenses/c1']}>
          <ToastProvider>
            <Routes><Route path="/expenses/:claimId" element={<ExpenseClaimDetail />} /></Routes>
          </ToastProvider>
        </MemoryRouter>
      </FinanceI18nTestProvider>,
    );

  it('binds approve, pay, cash-return and cancel to the id catalogue', async () => {
    await financeTestI18n.changeLanguage('id');
    const submitted = { ...base, status: 'Submitted' };
    const route = { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'pma', fullName: 'Ayu Approver' }], requestAmount: 300, lineBudget: 500, lineUsed: 0 };

    h.claim = submitted; h.route = route; h.outstanding = null;
    as('pma', 'Project Manager');
    let view = renderAtId();
    await userEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Setujui EXP-2610060001 sebesar');
    expect(screen.getByRole('dialog')).toHaveTextContent('Site visit');
    expect(screen.getByRole('dialog')).toHaveTextContent(money(300, 'IDR'));
    view.unmount();

    h.claim = submitted; h.route = route;
    view = renderAtId();
    await userEvent.click(screen.getByRole('button', { name: 'Tolak' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Tolak EXP-2610060001?');
    view.unmount();

    h.claim = { ...base, status: 'Approved', approved_by_id: 'pm' }; h.route = null;
    as('f2', 'Finance');
    view = renderAtId();
    await userEvent.click(screen.getByRole('button', { name: 'Tandai dibayar' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Tandai EXP-2610060001 dibayar:');
    expect(screen.getByRole('dialog')).toHaveTextContent(money(300, 'IDR'));
    view.unmount();

    h.claim = { ...base, kind: 'advance', claim_number: 'ADV-2610060001', title: 'Travel advance', amount: 700, status: 'Paid' };
    h.outstanding = 250;
    view = renderAtId();
    await userEvent.click(screen.getByRole('button', { name: 'Catat pengembalian kas' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('ADV-2610060001 · Travel advance');
    expect(screen.getByRole('dialog')).toHaveTextContent(`Maksimal ${money(250, 'IDR')} belum diselesaikan.`);
    view.unmount();

    h.claim = submitted; h.route = null; h.outstanding = null;
    as('fin', 'Finance');
    view = renderAtId();
    await userEvent.click(screen.getByRole('button', { name: 'Batalkan' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Batalkan EXP-2610060001?');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Tetap tercatat sebagai Dibatalkan');
    view.unmount();

    await financeTestI18n.changeLanguage('en');
  });
});
