/**
 * ERP budget enforcement notice (Budget tab → "Sources and budget enforcement"). Ported from the
 * deleted pages/BudgetProjection.test.tsx: the push-state behaviours moved here with the notice in
 * the #1402 restructure. Only the repository seam is mocked; the role gate is the real policy.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { RAW_ADAPTER_TOKEN } from '@/src/lib/testing/rawAdapterToken';
import type { BudgetPushStatusRow } from '@/src/lib/repositories/budgetProjection';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  pushStatus: vi.fn(),
  retry: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetPushStatus: h.pushStatus,
  retryActiveBudgetPush: h.retry,
  releaseActiveBudgetPushHold: h.release,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }),
}));

import BudgetErpNotice from './BudgetErpNotice';

const FY = '2025-2026';
const NO_PUSH: BudgetPushStatusRow = {
  pushState: null, pushError: null, unmappedCategories: null, erpBudgetName: null,
  fiscalYear: null, pushedAt: null, holdReleasable: false, staleAttribution: false,
};
const push = (over: Partial<BudgetPushStatusRow>): BudgetPushStatusRow => ({ ...NO_PUSH, ...over });
const activeVersion = { id: 'v1', status: 'Active' } as unknown as BudgetVersionWithItems;

const renderNotice = (role = 'Finance', onRecover?: () => void) => {
  h.role = role;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <ToastProvider>
          <BudgetErpNotice projectId="proj-1" activeVersion={activeVersion} onRecover={onRecover} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};
const notice = () => screen.findByTestId('budget-erp-notice');

beforeEach(() => {
  h.pushStatus.mockReset();
  h.retry.mockReset();
  h.release.mockReset();
  h.retry.mockResolvedValue({ pushState: 'pushed' });
  h.release.mockResolvedValue(undefined);
});

describe('every push state is stated (C-5)', () => {
  it.each(['Project Manager', 'Executive', 'Engineer'])('SP-4 hides ERP push state from %s', async (role) => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'pushed', fiscalYear: FY, erpBudgetName: 'BUDGET-0007' })]);
    renderNotice(role);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('budget-erp-notice')).not.toBeInTheDocument();
    expect(h.pushStatus).not.toHaveBeenCalled();
  });

  it('SP-4 shows ERP push state to Admin', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'pushed', fiscalYear: FY, erpBudgetName: 'BUDGET-0007' })]);
    renderNotice('Admin');
    expect(await notice()).toHaveTextContent('BUDGET-0007');
    expect(h.pushStatus).toHaveBeenCalledWith('proj-1');
  });

  it.each([
    ['pending', 'Queued'],
    ['pushing', 'Sending'],
    ['pushed', 'Enforced by ERPNext'],
    ['failed', 'Previous budget still enforced'],
    ['held', 'Previous budget still enforced'],
  ])('C-5 %s renders its own distinct statement', async (pushState, words) => {
    h.pushStatus.mockResolvedValue([push({ pushState, fiscalYear: FY, erpBudgetName: 'BUDGET-0007', pushError: pushState === 'failed' || pushState === 'held' ? 'budget-category-unmapped' : null })]);
    renderNotice();
    expect(await notice()).toHaveTextContent(words);
  });

  it('C-5 a successful push names the ERP document it created', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'pushed', fiscalYear: FY, erpBudgetName: 'BUDGET-0007' })]);
    renderNotice();
    expect(await notice()).toHaveTextContent('BUDGET-0007');
    expect(screen.queryByRole('button', { name: 'Retry the push' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Previous budget still enforced/)).not.toBeInTheDocument();
  });

  it('C-5 an org with no ERP tier renders no push statement at all', async () => {
    h.pushStatus.mockResolvedValue([NO_PUSH]);
    renderNotice();
    await waitFor(() => expect(h.pushStatus).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('budget-erp-notice')).not.toBeInTheDocument();
    expect(screen.queryByText(/ERPNext/)).not.toBeInTheDocument();
  });

  it('a failure to read the push state says so and offers a retry, never a silent blank', async () => {
    h.pushStatus.mockRejectedValue(new Error('boom'));
    renderNotice();
    expect(await screen.findByText('ERP enforcement status could not be checked.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('the push-state notice (FR-BUD-123)', () => {
  it('I-7/HIGH-C a push that never arrived says no ERP budget exists — not "the previous budget"', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'never-pushed' })]);
    renderNotice();
    expect(await notice()).toHaveTextContent('No ERP budget yet');
    expect(screen.queryByText(/Previous budget still enforced/)).not.toBeInTheDocument();
  });

  it('NEW-6/I-8 a held push names the unmapped categories and links to the account map that fixes them', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'held', pushError: 'budget-category-unmapped', unmappedCategories: ['Contingency', 'Subcontract'], fiscalYear: FY })]);
    renderNotice();
    const n = await notice();
    expect(n).toHaveTextContent('Previous budget still enforced');
    expect(n).toHaveTextContent('Contingency, Subcontract');
    expect(within(n).getByRole('link', { name: 'Open the budget account map' })).toHaveAttribute('href', '/administration/accounting#budget-account-map');
  });

  it('NEW-6/NEW-3 a transport failure lists no categories, even stale ones left from an earlier failure', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'external-unreachable', unmappedCategories: ['Subcontractors'], fiscalYear: FY })]);
    renderNotice();
    const n = await notice();
    expect(n).toHaveTextContent('could not be reached');
    expect(n).not.toHaveTextContent('Subcontractors');
    expect(within(n).queryByRole('link', { name: /account map/i })).not.toBeInTheDocument();
  });

  it('HIGH-D a held push offers a retry that re-drives that fiscal year and announces success', async () => {
    const user = userEvent.setup();
    h.pushStatus.mockResolvedValue([push({ pushState: 'held', pushError: 'budget-category-unmapped', fiscalYear: FY })]);
    renderNotice();
    await user.click(await screen.findByRole('button', { name: 'Retry the push' }));
    await waitFor(() => expect(h.retry).toHaveBeenCalledWith('proj-1', FY));
    expect(await findToastAnnouncement('status', /Budget pushed to ERPNext/)).toBeInTheDocument();
  });

  it('HIGH-D a retry that fails again says so and leaves the notice in place', async () => {
    const user = userEvent.setup();
    h.retry.mockResolvedValue({ pushState: 'failed' });
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'budget-category-unmapped', fiscalYear: FY })]);
    renderNotice();
    await user.click(await screen.findByRole('button', { name: 'Retry the push' }));
    expect(await findToastAnnouncement('alert', /did not complete/)).toBeInTheDocument();
    expect(await notice()).toHaveTextContent('Previous budget still enforced');
  });

  it('a retry with nothing to push says so — never that ERPNext is enforcing the budget', async () => {
    const user = userEvent.setup();
    h.retry.mockResolvedValue({ pushState: 'nothing-to-push' });
    h.pushStatus.mockResolvedValue([push({ pushState: 'never-pushed', fiscalYear: FY })]);
    renderNotice();
    await user.click(await screen.findByRole('button', { name: 'Retry the push' }));
    expect(await findToastAnnouncement('alert', /nothing to push/i)).toBeInTheDocument();
    expect(screen.queryByText(/ERPNext is enforcing this budget/)).not.toBeInTheDocument();
  });

  it('I-6/NEW-3 a transport failure retry says nothing here needs fixing', async () => {
    const user = userEvent.setup();
    h.retry.mockResolvedValue({ pushState: 'failed' });
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'external-unreachable', unmappedCategories: ['Contingency'], fiscalYear: FY })]);
    renderNotice();
    await user.click(await screen.findByRole('button', { name: 'Retry the push' }));
    expect(await findToastAnnouncement('alert', /Nothing on this screen needs fixing/)).toBeInTheDocument();
    expect(screen.queryByText(/may need fixing first/)).not.toBeInTheDocument();
  });

  it('I-6 a gate rejection retry says the reason shown may need fixing first', async () => {
    const user = userEvent.setup();
    h.retry.mockResolvedValue({ pushState: 'failed' });
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'budget-category-unmapped', fiscalYear: FY })]);
    renderNotice();
    await user.click(await screen.findByRole('button', { name: 'Retry the push' }));
    expect(await findToastAnnouncement('alert', /may need fixing first/)).toBeInTheDocument();
  });

  it('H-3/I-11 an unstamped activation names its recovery control and offers no retry (a retry cannot mint a date)', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    h.pushStatus.mockResolvedValue([push({ pushState: 'unstamped-activation' })]);
    renderNotice('Finance', onRecover);
    expect(await notice()).toHaveTextContent('Add an activation date');
    expect(screen.queryByRole('button', { name: 'Retry the push' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clone to revise' }));
    expect(onRecover).toHaveBeenCalledOnce();
  });

  it('I-14 offers no retry for a cause a retry can never fix, and says what must change', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'budget-multi-fiscal-year', fiscalYear: FY })]);
    renderNotice();
    expect(await notice()).toHaveTextContent(/Split the budget/);
    expect(screen.queryByRole('button', { name: 'Retry the push' })).not.toBeInTheDocument();
  });

  it('NEW-5 a blocked notice names the fiscal year it is about, and invents none when the status has none', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'budget-category-unmapped', fiscalYear: FY })]);
    const withYear = renderNotice();
    expect(await notice()).toHaveTextContent(FY);
    withYear.unmount();

    h.pushStatus.mockResolvedValue([push({ pushState: 'never-pushed' })]);
    renderNotice();
    expect(await notice()).not.toHaveTextContent(/20\d\d/);
  });

  it.each([
    'external-unreachable',
    'budget-category-unmapped',
    'budget-multi-fiscal-year',
    'budget-push-attempts-exhausted',
    'budget-push-no-outbox-candidate',
    'erpnext-activity-type-missing: no Activity Type on the binding',
  ])('I-5/MEDIUM-1 the push error %s never reaches the screen as a raw token', async (pushError) => {
    // No fiscal year here: a client year name such as 2025-2026 is legitimately hyphenated.
    h.pushStatus.mockResolvedValue([push({ pushState: pushError.startsWith('budget-push') ? 'held' : 'failed', pushError })]);
    renderNotice();
    const n = await notice();
    expect(n.textContent ?? '').not.toMatch(RAW_ADAPTER_TOKEN);
    expect(n.textContent ?? '').not.toContain(pushError.split(':')[0]);
  });
});

describe('a held push has an in-app route out (MED-2, MEDIUM-1)', () => {
  const realHold = () => push({ pushState: 'held', pushError: 'command-held', fiscalYear: FY, holdReleasable: true });

  it('MED-2 an Admin is offered the release, it targets the row year, and it announces the release', async () => {
    const user = userEvent.setup();
    h.pushStatus.mockResolvedValue([realHold()]);
    renderNotice('Admin');
    await user.click(await screen.findByRole('button', { name: 'Release the hold' }));
    await waitFor(() => expect(h.release).toHaveBeenCalledWith('proj-1', FY));
    expect(await findToastAnnouncement('status', /Hold released/)).toBeInTheDocument();
  });

  it('MED-2 a non-Admin is not offered the release (the RPC is Admin-only)', async () => {
    h.pushStatus.mockResolvedValue([realHold()]);
    renderNotice('Finance');
    expect(await notice()).toHaveTextContent('On hold');
    expect(screen.queryByRole('button', { name: 'Release the hold' })).not.toBeInTheDocument();
  });

  it('MED-2 a plain failure has nothing to release', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'budget-category-unmapped', fiscalYear: FY })]);
    renderNotice('Admin');
    await notice();
    expect(screen.queryByRole('button', { name: 'Release the hold' })).not.toBeInTheDocument();
  });

  it('MED-2 a refused release says so — never a silent button', async () => {
    const user = userEvent.setup();
    h.release.mockRejectedValue(Object.assign(new Error('not authorized'), { code: '42501' }));
    h.pushStatus.mockResolvedValue([realHold()]);
    renderNotice('Admin');
    await user.click(await screen.findByRole('button', { name: 'Release the hold' }));
    expect(await findToastAnnouncement('alert', /permission/i)).toBeInTheDocument();
  });

  it('MEDIUM-1 a sweep-parked hold offers retry instead of a release that could only fail', async () => {
    h.pushStatus.mockResolvedValue([push({ pushState: 'held', pushError: 'budget-push-attempts-exhausted', fiscalYear: FY, holdReleasable: false })]);
    renderNotice('Admin');
    expect(await screen.findByRole('button', { name: 'Retry the push' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release the hold' })).not.toBeInTheDocument();
  });
});

describe('per-year push status and per-year actions (AC-BFY-026)', () => {
  const PUSHED_2026 = () => push({ pushState: 'pushed', fiscalYear: '2026', erpBudgetName: 'BUDGET-2026-00001' });
  const FAILED_2027 = () => push({ pushState: 'failed', pushError: 'budget-category-unmapped', fiscalYear: '2027' });

  it('AC-BFY-026: every year renders — a failed year is not hidden behind a pushed one', async () => {
    h.pushStatus.mockResolvedValue([PUSHED_2026(), FAILED_2027()]);
    renderNotice();
    const n = await notice();
    expect(n).toHaveTextContent('Enforced by ERPNext');
    expect(n).toHaveTextContent('Previous budget still enforced');
    expect(n).toHaveTextContent('(2027)');
  });

  it('AC-BFY-026: a year with no mirror row renders as an explicit never-pushed year', async () => {
    h.pushStatus.mockResolvedValue([PUSHED_2026(), push({ pushState: 'never-pushed', fiscalYear: '2027' })]);
    renderNotice();
    const n = await notice();
    expect(n).toHaveTextContent('No ERP budget yet');
    expect(n).toHaveTextContent('(2027)');
  });

  it("AC-BFY-026: Retry dispatches for the row's fiscal year, never the project as a whole", async () => {
    const user = userEvent.setup();
    h.pushStatus.mockResolvedValue([PUSHED_2026(), FAILED_2027()]);
    renderNotice();
    await user.click(await screen.findByRole('button', { name: 'Retry the push' }));
    await waitFor(() => expect(h.retry).toHaveBeenCalledWith('proj-1', '2027'));
  });

  it("AC-BFY-026: Release targets the row's fiscal year", async () => {
    const user = userEvent.setup();
    h.pushStatus.mockResolvedValue([PUSHED_2026(), push({ pushState: 'held', pushError: 'command-held', fiscalYear: '2027', holdReleasable: true })]);
    renderNotice('Admin');
    await user.click(await screen.findByRole('button', { name: 'Release the hold' }));
    await waitFor(() => expect(h.release).toHaveBeenCalledWith('proj-1', '2027'));
  });

  it('AC-BFY-026: two failed years each get their own retry, acting on their own year', async () => {
    const user = userEvent.setup();
    h.pushStatus.mockResolvedValue([push({ pushState: 'failed', pushError: 'budget-category-unmapped', fiscalYear: '2026' }), FAILED_2027()]);
    renderNotice();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry the push' })).toHaveLength(2));
    await user.click(screen.getAllByRole('button', { name: 'Retry the push' })[1]);
    await waitFor(() => expect(h.retry).toHaveBeenCalledWith('proj-1', '2027'));
  });
});
