/**
 * AC-BUD-050/051/053 — pages/BudgetProjection.tsx: PMO's forward view surface (FR-BUD-151/152/123).
 * Mirrors the "react-query + the repository seam directly" mocking idiom (AdminUsers.test.tsx §S6):
 * `@/src/lib/repositories/budgetProjection` is mocked; usePermission reads the real JWT role via the
 * mocked `useEffectiveRole`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { fetchMock, upsertEtcMock, retryMock, yearsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  upsertEtcMock: vi.fn(),
  retryMock: vi.fn(),
  yearsMock: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetProjection: fetchMock,
  upsertBudgetProjectionEtc: upsertEtcMock,
  retryActiveBudgetPush: retryMock,
  listBudgetFiscalYears: yearsMock,
}));

let realRole: Role = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import BudgetProjection from './BudgetProjection';

// ⚑ H-4 (audit r3): the client under test is a Jul–Jun one, so its ERPNext `Fiscal Year` doctype is
// NAMED '2025-2026' — and `budget_version_erp_mirror.fiscal_year` / `erp_actuals_snapshot.fiscal_year`
// carry that NAME (the round-2 OQ-BUD-3b ruling: a fiscal year is whatever the client declares). A
// fixture that fed the SAME calendar-year string to both the page and the stub could never observe the
// mismatch — it passed vacuously while every money figure on the real screen was zero.
const ERP_FISCAL_YEAR = '2025-2026';
const PRIOR_ERP_FISCAL_YEAR = '2024-2025';

const ROW = {
  category: 'Labor' as const,
  pmoBudgetAmount: 100000,
  actualsToDate: 40000,
  pmoEtc: 35000,
  projectedFinalCost: 75000,
  projectedVariance: 25000,
  projectedUtilization: 0.75,
  pushState: null,
  pushError: null,
};

const renderPage = (role: Role = 'Finance') => {
  realRole = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <BudgetProjection projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchMock.mockReset();
  upsertEtcMock.mockReset();
  retryMock.mockReset();
  yearsMock.mockReset();
  yearsMock.mockResolvedValue([
    { fiscalYear: ERP_FISCAL_YEAR, isActivePush: true },
    { fiscalYear: PRIOR_ERP_FISCAL_YEAR, isActivePush: false },
  ]);
  fetchMock.mockResolvedValue([ROW]);
  upsertEtcMock.mockResolvedValue(undefined);
  retryMock.mockResolvedValue({ pushState: 'pushed' });
  realRole = 'Finance';
});

describe('BudgetProjection — the forward view (AC-BUD-050/051)', () => {
  it('renders the category row: PMO budget, ERP actuals, PMO ETC, projected final, variance, utilization', async () => {
    renderPage();
    expect(await screen.findByText('Labor')).toBeInTheDocument();
    expect(screen.getByText('$100,000')).toBeInTheDocument(); // pmoBudgetAmount
    expect(screen.getByText('$40,000')).toBeInTheDocument(); // actualsToDate
    expect(screen.getByText('$75,000')).toBeInTheDocument(); // projectedFinalCost
    expect(screen.getByText('$25,000')).toBeInTheDocument(); // projectedVariance
    expect(screen.getByText('75%')).toBeInTheDocument(); // projectedUtilization
  });

  // ── H-4 (audit r3): the screen's fiscal year must come from the data, never from the calendar. ──
  it('H-4 defaults to the fiscal year the Active version was pushed against, not the calendar year', async () => {
    renderPage();
    await screen.findByText('Labor');
    expect(fetchMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR);
    expect(fetchMock).not.toHaveBeenCalledWith('proj-1', String(new Date().getFullYear()));
  });

  it("H-4 offers ONLY fiscal years that exist for this project — a synthesized calendar year can never be selected", async () => {
    renderPage();
    await screen.findByText('Labor');
    const options = Array.from(
      (screen.getByRole('combobox', { name: /fiscal year/i }) as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual([ERP_FISCAL_YEAR, PRIOR_ERP_FISCAL_YEAR]);
  });

  it('H-4 selecting another fiscal year reads THAT year', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Labor');
    await user.selectOptions(screen.getByRole('combobox', { name: /fiscal year/i }), PRIOR_ERP_FISCAL_YEAR);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('proj-1', PRIOR_ERP_FISCAL_YEAR));
  });

  it('H-4 with no fiscal year on record yet, says so plainly instead of inventing one', async () => {
    yearsMock.mockResolvedValue([]);
    fetchMock.mockResolvedValue([]);
    renderPage();
    // Said in the selector's place AND in the empty state — both are the same honest statement.
    expect((await screen.findAllByText(/no fiscal year on record/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('combobox', { name: /fiscal year/i })).not.toBeInTheDocument();
    // …and it never writes an ETC against a fiscal year nobody declared.
    expect(screen.queryByRole('button', { name: /edit.*etc/i })).not.toBeInTheDocument();
  });

  it('H-4 with no fiscal year on record, an unrecorded push is STILL alarmed (the banner is FY-independent)', async () => {
    yearsMock.mockResolvedValue([]);
    fetchMock.mockResolvedValue([{ ...ROW, pushState: 'never-pushed', pushError: null }]);
    renderPage();
    expect(await screen.findByText(/never reached ERPNext/i)).toBeInTheDocument();
  });

  it('H-4 surfaces a failure to read the fiscal years rather than falling back to a guessed year', async () => {
    yearsMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a null pmoBudgetAmount / utilization renders as an em-dash, never 0 or blank', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pmoBudgetAmount: null, projectedUtilization: null }]);
    renderPage();
    await screen.findByText('Labor');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a loading state while fetching', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('budget-projection-loading')).toBeInTheDocument();
  });

  it('shows an error state with retry on a failed fetch', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it('shows an empty state when there is no budget, no actuals, and no ETC yet', async () => {
    fetchMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no projection data yet/i)).toBeInTheDocument();
  });
});

describe('BudgetProjection — the push-state banner (FR-BUD-123)', () => {
  it('states the operational consequence in plain words when the push is failed/held', async () => {
    fetchMock.mockResolvedValue([
      { ...ROW, pushState: 'held', pushError: 'budget categories have no ERP account mapping: Contingency' },
    ]);
    renderPage();
    expect(await screen.findByText(/still enforcing the previous budget/i)).toBeInTheDocument();
    expect(screen.getByText(/Contingency/)).toBeInTheDocument();
  });

  it('renders no banner when the push is healthy (pushed or no push at all)', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pushState: 'pushed', pushError: null }]);
    renderPage();
    await screen.findByText('Labor');
    expect(screen.queryByText(/still enforcing the previous budget/i)).not.toBeInTheDocument();
  });

  // ── HIGH-C (Luna re-audit round 2): a push that NEVER REACHED the edge function leaves no mirror row
  //    at all, so `push_state` comes back NULL — which rendered as a perfectly clean screen while
  //    ERPNext enforced the previous budget (or none) indefinitely. `get_budget_projection` now
  //    distinguishes that state as 'never-pushed'.
  it('HIGH-C banners an ACTIVE version whose push was never recorded at all (a NULL push_state is not "fine")', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pushState: 'never-pushed', pushError: null }]);
    renderPage();
    expect(await screen.findByText(/never reached ERPNext/i)).toBeInTheDocument();
  });

  // ── HIGH-D: 'held' (and 'failed', and 'never-pushed') must be RECOVERABLE. A gate rejection writes
  //    `failed` pre-outbox; the backstop finds no outbox candidate and flips it to `held`, which its own
  //    candidate query excludes — so after the Admin maps the missing category, nothing re-drives it and
  //    re-activation is blocked by the Draft-only guard. The retry re-dispatches under the operator's
  //    own JWT, which is the actor the sweep can never synthesize.
  it('HIGH-D offers a retry on a held push and re-drives it (so fixing the category map finally lands)', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue([
      { ...ROW, pushState: 'held', pushError: 'budget-category-unmapped' },
    ]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry the push/i }));
    await waitFor(() => expect(retryMock).toHaveBeenCalledWith('proj-1'));
    expect(await screen.findByText(/budget pushed to ERPNext/i)).toBeInTheDocument();
  });

  it('HIGH-D a retry that fails again says so, and leaves the banner in place', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue({ pushState: 'failed' });
    fetchMock.mockResolvedValue([{ ...ROW, pushState: 'failed', pushError: 'budget-category-unmapped' }]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry the push/i }));
    await waitFor(() => expect(retryMock).toHaveBeenCalled());
    expect(await screen.findByText(/push did not complete/i)).toBeInTheDocument();
    expect(screen.getByText(/still enforcing the previous budget/i)).toBeInTheDocument();
  });

  // ── H-3 (Luna audit round 3): a version activated BEFORE mig 0139 carries no `activated_at`. It
  //    cannot be pushed — `budgetPushKey` and the server-side budget gate both refuse an unstamped
  //    version, deliberately: a money command keyed on an invented timestamp is worse than one that
  //    never runs. It used to be INVISIBLE (the alarm required the stamp), which meant ERPNext enforced
  //    nothing at all behind a perfectly clean screen. Visible + told what actually works.
  it('H-3 banners an Active version with NO activation stamp, and names the route out (a retry cannot mint one)', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pushState: 'unstamped-activation', pushError: null }]);
    renderPage();
    expect(await screen.findByText(/no record of when it was activated/i)).toBeInTheDocument();
    expect(screen.getByText(/activate a new version/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry the push/i })).not.toBeInTheDocument();
  });

  it('offers NO retry when the push is healthy', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pushState: 'pushed', pushError: null }]);
    renderPage();
    await screen.findByText('Labor');
    expect(screen.queryByRole('button', { name: /retry the push/i })).not.toBeInTheDocument();
  });
});

describe('BudgetProjection — ETC is editable only under OD-BUDGET-3 (ADR-0016 UX gate)', () => {
  it('Finance (OD-BUDGET-3) can edit the ETC for a category', async () => {
    const user = userEvent.setup();
    renderPage('Finance');
    await user.click(await screen.findByRole('button', { name: /edit.*labor.*etc/i }));
    const field = screen.getByLabelText(/estimate to complete/i);
    await user.clear(field);
    await user.type(field, '40000');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR, 'Labor', 40000));
  });

  it('an Engineer (not OD-BUDGET-3) sees the ETC read-only — no edit affordance', async () => {
    renderPage('Engineer');
    await screen.findByText('Labor');
    expect(screen.queryByRole('button', { name: /edit.*labor.*etc/i })).not.toBeInTheDocument();
  });
});
