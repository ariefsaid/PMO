/**
 * AC-BUD-050/051/053 — pages/BudgetProjection.tsx: PMO's forward view surface (FR-BUD-151/152/123).
 * Mirrors the "react-query + the repository seam directly" mocking idiom (AdminUsers.test.tsx §S6):
 * `@/src/lib/repositories/budgetProjection` is mocked; usePermission reads the real JWT role via the
 * mocked `useEffectiveRole`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { RAW_ADAPTER_TOKEN } from '@/src/lib/adapterSeam/pushErrorCopy';
import type { BudgetPushStatusRow } from '@/src/lib/repositories/budgetProjection';

const { fetchMock, upsertEtcMock, retryMock, yearsMock, pushStatusMock, releaseHoldMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  upsertEtcMock: vi.fn(),
  retryMock: vi.fn(),
  yearsMock: vi.fn(),
  pushStatusMock: vi.fn(),
  releaseHoldMock: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetProjection: fetchMock,
  upsertBudgetProjectionEtc: upsertEtcMock,
  retryActiveBudgetPush: retryMock,
  listBudgetFiscalYears: yearsMock,
  fetchBudgetPushStatus: pushStatusMock,
  releaseActiveBudgetPushHold: releaseHoldMock,
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

/** NEW-4: every fixture below describes a project-year whose ledger HAS been read, unless it says
 *  otherwise — that is the ordinary case, and the absence of a reading is its own state. */
const READ_AT = '2026-03-04T09:00:00.000Z';

const ROW = {
  category: 'Labor' as const,
  pmoBudgetAmount: 100000,
  actualsToDate: 40000,
  actualsAsOf: READ_AT,
  pmoEtc: 35000,
  projectedFinalCost: 75000,
  projectedVariance: 25000,
  projectedUtilization: 0.75,
};

const NO_PUSH: BudgetPushStatusRow = {
  pushState: null,
  pushError: null,
  unmappedCategories: null,
  erpBudgetName: null,
  fiscalYear: null,
  pushedAt: null,
  holdReleasable: false,
};

const pushStatus = (over: Partial<BudgetPushStatusRow>): BudgetPushStatusRow => ({ ...NO_PUSH, ...over });

const renderPage = (role: Role = 'Finance') => {
  realRole = role;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BudgetProjection projectId="proj-1" />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  fetchMock.mockReset();
  upsertEtcMock.mockReset();
  retryMock.mockReset();
  yearsMock.mockReset();
  pushStatusMock.mockReset();
  yearsMock.mockResolvedValue([
    { fiscalYear: ERP_FISCAL_YEAR, isActivePush: true },
    { fiscalYear: PRIOR_ERP_FISCAL_YEAR, isActivePush: false },
  ]);
  fetchMock.mockResolvedValue([ROW]);
  pushStatusMock.mockResolvedValue(NO_PUSH);
  upsertEtcMock.mockResolvedValue(undefined);
  retryMock.mockResolvedValue({ pushState: 'pushed' });
  releaseHoldMock.mockReset();
  releaseHoldMock.mockResolvedValue(undefined);
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
    fetchMock.mockResolvedValue([]);
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'never-pushed' }));
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ C-1 / C-2 (rendered Discover pass, 2026-07-22) — MONEY HONESTY.
// A figure the system cannot know must never be rendered as a number.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetProjection — an unobtainable figure is never rendered as money (C-1/C-2)', () => {
  const unmappedRow = {
    ...ROW,
    category: 'Equipment' as const,
    pmoBudgetAmount: 20000,
    actualsToDate: null,
    projectedFinalCost: null,
    projectedVariance: null,
    projectedUtilization: null,
  };

  it('C-1 an unmapped category shows NO actuals figure — never a confident $0', async () => {
    fetchMock.mockResolvedValue([unmappedRow]);
    renderPage();
    const row = (await screen.findByText('Equipment')).closest('tr')!;
    expect(within(row).queryByText('$0')).not.toBeInTheDocument();
    expect(within(row).queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('C-2 the unavailable cells say WHY, not merely nothing — a dash alone reads as "we forgot"', async () => {
    fetchMock.mockResolvedValue([unmappedRow]);
    renderPage();
    const row = (await screen.findByText('Equipment')).closest('tr')!;
    // The accessible name of each unobtainable cell explains itself to a screen reader too.
    expect(within(row).getAllByTitle(/no ERP account is mapped/i).length).toBeGreaterThanOrEqual(3);
  });

  it('C-2 utilization for an unmapped category is NOT 0% ', async () => {
    fetchMock.mockResolvedValue([unmappedRow]);
    renderPage();
    const row = (await screen.findByText('Equipment')).closest('tr')!;
    expect(within(row).queryByText('0%')).not.toBeInTheDocument();
  });

  it('C-1 a MAPPED category with an empty ledger still shows a real $0 — the distinction is the point', async () => {
    fetchMock.mockResolvedValue([
      { ...ROW, actualsToDate: 0, projectedFinalCost: 0, projectedVariance: 100000, projectedUtilization: 0 },
    ]);
    renderPage();
    const row = (await screen.findByText('Labor')).closest('tr')!;
    // actuals AND projected final are both a real, computed zero here.
    expect(within(row).getAllByText('$0').length).toBeGreaterThanOrEqual(1);
    expect(within(row).getByText('0%')).toBeInTheDocument();
  });

  // I-1 — DESIGN.md §3: `tabular-nums` is mandatory on every figure that can be compared.
  it('I-1 every money cell carries tabular figures so columns align', async () => {
    fetchMock.mockResolvedValue([ROW]);
    renderPage();
    const row = (await screen.findByText('Labor')).closest('tr')!;
    const moneyCells = Array.from(row.querySelectorAll('td')).slice(1);
    expect(moneyCells.length).toBeGreaterThan(0);
    for (const cell of moneyCells) expect(cell.className).toContain('tabular');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ THE MONEY-HONESTY INVARIANT, at the two scopes found after C-1 shipped.
//
//   A money figure may be rendered only when its inputs are known; otherwise it renders as
//   UNAVAILABLE — and it SAYS WHICH INPUT IS MISSING, because "no ERP account is mapped", "nobody has
//   read this ledger" and "PMO has no budget for this year" are three different things for an operator
//   to do something about.
//
// NEW-4 (never-synced ledger) and HIGH-1 (a fiscal year the budget is not on record for) are the third
// and fourth scopes of the class C-1/C-2 closed at category scope.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetProjection — an unread ledger is not a zero (NEW-4)', () => {
  const neverRead = {
    ...ROW,
    actualsToDate: null,
    actualsAsOf: null,
    projectedFinalCost: null,
    projectedVariance: null,
    projectedUtilization: null,
  };

  it('NEW-4 a project-year whose ERP ledger has NEVER been read shows no actuals figure, and no 0%', async () => {
    fetchMock.mockResolvedValue([neverRead]);
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'pushed', fiscalYear: ERP_FISCAL_YEAR }));
    renderPage();
    const row = (await screen.findByText('Labor')).closest('tr')!;
    expect(within(row).queryByText('$0')).not.toBeInTheDocument();
    expect(within(row).queryByText('0%')).not.toBeInTheDocument();
    // …and the PMO-owned budget is still stated: it never depended on the ledger.
    expect(within(row).getByText('$100,000')).toBeInTheDocument();
  });

  it('NEW-4 it says the LEDGER has not been read — not that the category is unmapped (a different fix)', async () => {
    fetchMock.mockResolvedValue([neverRead]);
    renderPage();
    const row = (await screen.findByText('Labor')).closest('tr')!;
    expect(within(row).getAllByTitle(/ledger has not been read/i).length).toBeGreaterThanOrEqual(3);
    expect(within(row).queryByTitle(/no ERP account is mapped/i)).not.toBeInTheDocument();
  });

  it('NEW-4 dates the actuals it DOES show, so an operator can weigh how current they are', async () => {
    renderPage();
    await screen.findByText('Labor');
    expect(screen.getByText(/actuals as of/i)).toBeInTheDocument();
  });

  it('NEW-4 claims no "as of" date when there is no reading to date', async () => {
    fetchMock.mockResolvedValue([neverRead]);
    renderPage();
    await screen.findByText('Labor');
    expect(screen.queryByText(/actuals as of/i)).not.toBeInTheDocument();
  });
});

describe('BudgetProjection — a fiscal year the budget is not on record for (HIGH-1)', () => {
  // The audit's concrete case: one late GL posting lands in a year the Active version was never
  // pushed for. The selector offers that year (it is real ERP spend, worth looking at) — so the grid
  // must state the actual and refuse to state anything the budget would have to supply.
  const offYearRow = {
    ...ROW,
    pmoBudgetAmount: null,
    actualsToDate: 12000,
    pmoEtc: 0,
    projectedFinalCost: 12000,
    projectedVariance: null,
    projectedUtilization: null,
  };

  beforeEach(() => {
    yearsMock.mockResolvedValue([
      { fiscalYear: ERP_FISCAL_YEAR, isActivePush: true },
      { fiscalYear: PRIOR_ERP_FISCAL_YEAR, isActivePush: false },
    ]);
    fetchMock.mockResolvedValue([offYearRow]);
  });

  it('HIGH-1 explains that the budget is not on record for the selected year, rather than leaving a bare dash', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Labor');
    await user.selectOptions(screen.getByRole('combobox', { name: /fiscal year/i }), PRIOR_ERP_FISCAL_YEAR);
    const row = (await screen.findByText('Labor')).closest('tr')!;
    await waitFor(() =>
      expect(within(row).getAllByTitle(/not on record as covering this fiscal year/i).length).toBeGreaterThanOrEqual(1),
    );
  });

  it('HIGH-1 on the year the budget IS on record for, an unbudgeted category still reads as "no line for this category"', async () => {
    renderPage();
    const row = (await screen.findByText('Labor')).closest('tr')!;
    expect(within(row).getAllByTitle(/no line for this category/i).length).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ C-3 — with no fiscal year on record the grid must be EMPTY, and that empty state must offer a
// route forward rather than being a dead end.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetProjection — the no-fiscal-year state is reachable and has a way out (C-3)', () => {
  beforeEach(() => {
    yearsMock.mockResolvedValue([]);
    fetchMock.mockResolvedValue([]); // the RPC is year-scoped: no year ⇒ no rows
  });

  it('C-3 renders the honest empty state, never a fabricated money grid', async () => {
    renderPage();
    await screen.findByText(/no fiscal year on record yet/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('C-3 the empty state names what actually produces a fiscal year — it is not a dead end', async () => {
    renderPage();
    await screen.findByText(/no fiscal year on record yet/i);
    expect(screen.getByText(/activate a budget version/i)).toBeInTheDocument();
  });

  // ── MED-3 (audit round 6): the copy named THREE routes out and one of them does not exist. The only
  //    `upsertBudgetProjectionEtc` caller is the per-row Edit button, which renders inside `rows.map`
  //    and is additionally gated on a fiscal year — so from an empty grid with no year there is no
  //    button, and "log an estimate to complete against it" instructed the user to do something the
  //    product does not offer. An empty state that names an impossible act is worse than a short one.
  it('MED-3 the empty state names ONLY routes the product can actually perform', async () => {
    renderPage();
    const empty = await screen.findByText(/no fiscal year on record yet/i);
    const copy = empty.closest('div')?.parentElement?.textContent ?? '';
    expect(copy).not.toMatch(/estimate to complete/i);
    expect(screen.queryByRole('button', { name: /edit.*etc/i })).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ C-4 — two contradicting "Actual" columns on the same tab, unexplained.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetProjection — the two Actual columns are disambiguated (C-4)', () => {
  it('C-4 names the SOURCE of its actuals column and says which figure governs', async () => {
    renderPage();
    await screen.findByText('Labor');
    expect(screen.getByRole('columnheader', { name: /actuals to date \(ERP ledger\)/i })).toBeInTheDocument();
    expect(screen.getByText(/posted ERP ledger|differ from the .Actual./i)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ C-5 — a state that renders nothing is a defect, not a default.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetProjection — every push state is stated (C-5)', () => {
  it.each([
    ['pending', /queued for ERPNext/i],
    ['pushing', /being sent to ERPNext/i],
    ['pushed', /ERPNext is enforcing this budget/i],
    ['failed', /still enforcing the previous budget/i],
    ['held', /still enforcing the previous budget/i],
  ])('C-5 %s renders its own distinct statement', async (state, matcher) => {
    pushStatusMock.mockResolvedValue(
      pushStatus({ pushState: state, fiscalYear: ERP_FISCAL_YEAR, erpBudgetName: 'BUDGET-0007' }),
    );
    renderPage();
    expect(await screen.findByText(matcher)).toBeInTheDocument();
  });

  it('C-5 a SUCCESSFUL push names the ERP document it created (stored since 0137, never shown)', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({ pushState: 'pushed', fiscalYear: ERP_FISCAL_YEAR, erpBudgetName: 'BUDGET-0007' }),
    );
    renderPage();
    expect(await screen.findByText(/BUDGET-0007/)).toBeInTheDocument();
  });

  it('C-5 an org with NO ERP tier renders no push statement at all — absence, correctly, says nothing', async () => {
    pushStatusMock.mockResolvedValue(NO_PUSH);
    renderPage();
    await screen.findByText('Labor');
    expect(screen.queryByText(/ERPNext/)).not.toBeInTheDocument();
  });
});

describe('BudgetProjection — the push-state banner (FR-BUD-123)', () => {
  it('states the operational consequence in plain words when the push is failed/held', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({ pushState: 'held', pushError: 'budget-category-unmapped', unmappedCategories: ['Contingency'] }),
    );
    renderPage();
    expect(await screen.findByText(/still enforcing the previous budget/i)).toBeInTheDocument();
    expect(screen.getByText(/Contingency/)).toBeInTheDocument();
  });

  it('renders no BLOCKED banner when the push is healthy', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'pushed' }));
    renderPage();
    await screen.findByText('Labor');
    expect(screen.queryByText(/still enforcing the previous budget/i)).not.toBeInTheDocument();
  });

  it('HIGH-C banners an ACTIVE version whose push was never recorded at all (a NULL push_state is not "fine")', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'never-pushed' }));
    renderPage();
    expect(await screen.findByText(/never reached ERPNext/i)).toBeInTheDocument();
  });

  // ── I-7: "still enforcing the PREVIOUS budget" is materially WRONG for a push that never arrived —
  //    if this is the first push, ERPNext is enforcing NOTHING, which is worse, not better.
  it('I-7 a never-arrived push says ERPNext is enforcing NOTHING, not "the previous budget"', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'never-pushed' }));
    renderPage();
    expect(await screen.findByText(/not enforcing any budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/still enforcing the previous budget/i)).not.toBeInTheDocument();
  });

  it('HIGH-D offers a retry on a held push and re-drives it (so fixing the category map finally lands)', async () => {
    const user = userEvent.setup();
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'held', pushError: 'budget-category-unmapped' }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry the push/i }));
    await waitFor(() => expect(retryMock).toHaveBeenCalledWith('proj-1'));
    expect(await screen.findByText(/budget pushed to ERPNext/i)).toBeInTheDocument();
  });

  it('HIGH-D a retry that fails again says so, and leaves the banner in place', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue({ pushState: 'failed' });
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'failed', pushError: 'budget-category-unmapped' }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry the push/i }));
    await waitFor(() => expect(retryMock).toHaveBeenCalled());
    expect(await screen.findByText(/did not complete/i)).toBeInTheDocument();
    expect(screen.getByText(/still enforcing the previous budget/i)).toBeInTheDocument();
  });

  // ── I-6: a 503 is not a gate rejection. "The reason shown above may need fixing first" is false
  //    when nothing above was fixable and the push simply never reached ERPNext.
  it('I-6 a TRANSPORT failure does not tell the operator to fix something above', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue({ pushState: 'failed' });
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'failed', pushError: 'external-unreachable' }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry the push/i }));
    await waitFor(() => expect(retryMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/could not be reached/i).length).toBeGreaterThan(1));
    expect(screen.queryByText(/may need fixing first/i)).not.toBeInTheDocument();
  });

  it('I-6 a GATE rejection still says the reason above may need fixing first', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue({ pushState: 'failed' });
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'failed', pushError: 'budget-category-unmapped' }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry the push/i }));
    await waitFor(() => expect(retryMock).toHaveBeenCalled());
    expect(await screen.findByText(/may need fixing first/i)).toBeInTheDocument();
  });

  it('H-3 banners an Active version with NO activation stamp, and names the route out (a retry cannot mint one)', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'unstamped-activation' }));
    renderPage();
    expect(await screen.findByText(/no record of when it was activated/i)).toBeInTheDocument();
    expect(screen.getByText(/activate a new version/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry the push/i })).not.toBeInTheDocument();
  });

  // ── I-11: an unstamped activation's only route out is "Clone to revise, then activate". Naming the
  //    remedy without naming the CONTROL that performs it is still a dead end.
  it('I-11 the unstamped-activation banner names the control that performs its remedy', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'unstamped-activation' }));
    renderPage();
    expect(await screen.findByText(/clone to revise/i)).toBeInTheDocument();
  });

  it('offers NO retry when the push is healthy', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'pushed' }));
    renderPage();
    await screen.findByText('Labor');
    expect(screen.queryByRole('button', { name: /retry the push/i })).not.toBeInTheDocument();
  });

  // ── I-14: Retry must be WITHHELD where it provably cannot work — the contract the surface already
  //    honours for `unstamped-activation`, applied to every ERP-side cause.
  it('I-14 offers NO retry for an ERP-side cause a retry can never fix, and says what must change', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'failed', pushError: 'budget-multi-fiscal-year' }));
    renderPage();
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /retry the push/i })).not.toBeInTheDocument();
    expect(screen.getByText(/split the budget/i)).toBeInTheDocument();
  });

  it('NEW-6 names the unmapped categories as the operator\'s to-do list, not just the bare error code', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({
        pushState: 'failed',
        pushError: 'budget-category-unmapped',
        unmappedCategories: ['Materials', 'Subcontract'],
      }),
    );
    renderPage();

    await screen.findByText(/still enforcing the previous budget/i);
    const todo = screen.getByRole('list', { name: /categories that need an ERP account/i });
    expect(within(todo).getByText('Materials')).toBeInTheDocument();
    expect(within(todo).getByText('Subcontract')).toBeInTheDocument();
  });

  // ── I-8: naming the to-do is half the job; the banner must LINK to the place it is done.
  it('I-8 the unmapped-category banner links to the account map that fixes it', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({ pushState: 'failed', pushError: 'budget-category-unmapped', unmappedCategories: ['Materials'] }),
    );
    renderPage();
    const link = await screen.findByRole('link', { name: /account map/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/administration'));
  });

  it('NEW-6 renders no category list when the failure has nothing to do with the map', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'failed', pushError: 'external-unreachable' }));
    renderPage();

    await screen.findByText(/still enforcing the previous budget/i);
    expect(screen.queryByRole('list', { name: /categories that need an ERP account/i })).not.toBeInTheDocument();
  });

  // ── NEW-3 (rendered re-verification): `unmapped_categories` PERSISTS on the mirror row across
  //    failures, so after a map gap is fixed and the next push dies in transport, the banner still
  //    rendered the previous failure's to-do list — and the retry toast then said "Nothing on this
  //    screen needs fixing". Two contradictory instructions, on screen at once. The names describe the
  //    map-gap failure, so they may only be shown for it.
  it('NEW-3 a transport failure never shows a STALE map to-do list left over from an earlier failure', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({
        pushState: 'failed',
        pushError: 'external-unreachable',
        unmappedCategories: ['Subcontractors', 'Permits & Fees'],
      }),
    );
    renderPage();
    await screen.findByText(/could not be reached/i);
    expect(screen.queryByText(/map these categories/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Subcontractors')).not.toBeInTheDocument();
  });

  it('NEW-3 the banner and its own retry toast agree — nothing to fix above means nothing is listed above', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue({ pushState: 'failed' });
    pushStatusMock.mockResolvedValue(
      pushStatus({ pushState: 'failed', pushError: 'external-unreachable', unmappedCategories: ['Contingency'] }),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry the push/i }));
    await waitFor(() => expect(screen.getByText(/nothing on this screen needs fixing/i)).toBeInTheDocument());
    expect(screen.queryByText(/then retry/i)).not.toBeInTheDocument();
  });

  // ── NEW-5 (rendered re-verification): the QUIET states name `push.fiscalYear`; the BLOCKED branch —
  //    the one that matters, and the only one that can be about a year other than the one on screen —
  //    never did. On a multi-FY project the alarm was unattributable.
  it('NEW-5 the BLOCKED banner names the fiscal year it is about, exactly as the quiet states do', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({ pushState: 'failed', pushError: 'budget-category-unmapped', fiscalYear: ERP_FISCAL_YEAR }),
    );
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(new RegExp(`fiscal year ${ERP_FISCAL_YEAR}`, 'i'))).toBeInTheDocument();
  });

  it('NEW-5 says nothing about a year when the status carries none, rather than inventing one', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'never-pushed' }));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(within(alert).queryByText(/fiscal year/i)).not.toBeInTheDocument();
  });

  // ── I-5/I-15: no raw kebab-case adapter token may reach the DOM. The prior version of this file
  //    asserted the OPPOSITE (`getByText('external-unreachable')`) — it pinned the defect in place.
  it.each([
    'external-unreachable',
    'budget-category-unmapped',
    'budget-multi-fiscal-year',
    'erpnext-activity-type-missing: no Activity Type on the binding',
  ])('I-5 the push error %s never reaches the DOM as a raw token', async (pushError) => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'failed', pushError }));
    const { container } = renderPage();
    await screen.findByRole('alert');
    expect(container.textContent ?? '').not.toMatch(RAW_ADAPTER_TOKEN);
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

  // ── I-4: the editor was a hand-rolled <input>+<span>: the validation message was not wired to the
  //    field at all, so a screen-reader user was told nothing was wrong.
  it('I-4 an invalid amount marks the field invalid and wires the message to it', async () => {
    const user = userEvent.setup();
    renderPage('Finance');
    await user.click(await screen.findByRole('button', { name: /edit.*labor.*etc/i }));
    const field = screen.getByLabelText(/estimate to complete/i);
    await user.clear(field);
    await user.type(field, '-5');
    await user.click(screen.getByRole('button', { name: /save/i }));

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent(/valid, non-negative/i);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby') ?? '').toContain(message.id);
    expect(upsertEtcMock).not.toHaveBeenCalled();
  });

  // ── I-3: focus was dumped to <body> on open/cancel/save — the keyboard user lost their place in a
  //    table row entirely.
  it('I-3 opening the editor moves focus INTO it, and cancelling returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderPage('Finance');
    const trigger = await screen.findByRole('button', { name: /edit.*labor.*etc/i });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByLabelText(/estimate to complete/i)).toHaveFocus());

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /edit.*labor.*etc/i })).toHaveFocus(),
    );
  });

  it('I-3 saving also returns focus to the trigger, never to <body>', async () => {
    const user = userEvent.setup();
    renderPage('Finance');
    await user.click(await screen.findByRole('button', { name: /edit.*labor.*etc/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /edit.*labor.*etc/i })).toHaveFocus(),
    );
  });

  // ── I-2: the trigger printed the whole category name, so the ETC column's width changed per row and
  //    the money in it stopped lining up. The category belongs in the accessible name, not on screen.
  it('I-2 the Edit trigger shows a fixed label and keeps the category in its accessible name only', async () => {
    renderPage('Finance');
    const trigger = await screen.findByRole('button', { name: /edit.*labor.*etc/i });
    expect(trigger.textContent).toContain('Edit');
    expect(trigger.textContent).not.toMatch(/^Edit Labor ETC$/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ MED-2 (money-safety audit round 6) — `release_outbox_hold` shipped with ZERO CALLERS, so the wedge
// its own migration header describes in the present tense ("that week's costing can never reach the
// client's ERP, by ANY in-app action whatsoever") remained literally true: the operator's route out was
// `psql`. A `held` push is exactly the state where the product must offer the release.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetProjection — a held push has an in-app route out (MED-2)', () => {
  /** A REAL dispatch hold: the outbox row genuinely is `held`, so there is something to release. */
  const heldStatus = () => pushStatus({ pushState: 'held', pushError: 'command-held', fiscalYear: ERP_FISCAL_YEAR, holdReleasable: true });

  it('MED-2 an Admin is offered the release, and it re-drives the ordinary recovery', async () => {
    const user = userEvent.setup();
    pushStatusMock.mockResolvedValue(heldStatus());
    renderPage('Admin');
    await user.click(await screen.findByRole('button', { name: /release the hold/i }));
    await waitFor(() => expect(releaseHoldMock).toHaveBeenCalledWith('proj-1'));
    expect(await screen.findByText(/hold released/i)).toBeInTheDocument();
  });

  it('MED-2 a non-Admin is NOT offered it — the RPC is Admin-only and the surface never promises more', async () => {
    pushStatusMock.mockResolvedValue(heldStatus());
    renderPage('Project Manager');
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /release the hold/i })).not.toBeInTheDocument();
  });

  it('MED-2 it is offered ONLY for a held command — a plain failure has nothing to release', async () => {
    pushStatusMock.mockResolvedValue(pushStatus({ pushState: 'failed', pushError: 'budget-category-unmapped' }));
    renderPage('Admin');
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /release the hold/i })).not.toBeInTheDocument();
  });

  it('MED-2 a refused release says so — never a silent button (the I-13 lesson)', async () => {
    const user = userEvent.setup();
    releaseHoldMock.mockRejectedValue(Object.assign(new Error('not authorized'), { code: '42501' }));
    pushStatusMock.mockResolvedValue(heldStatus());
    renderPage('Admin');
    await user.click(await screen.findByRole('button', { name: /release the hold/i }));
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ MEDIUM-1 (money-safety audit round 7) — `push_state = 'held'` HAS TWO PRODUCERS, AND ONLY ONE OF
// THEM LEAVES A RELEASABLE COMMAND.
//
//   (a) the dispatch's real `command-held` outcome — the `external_command_outbox` row genuinely IS
//       `held`, it wedges the one-in-flight index, and releasing it is the only route out;
//   (b) the SWEEP parking a row it may not re-drive (`budget-push-attempts-exhausted` /
//       `budget-push-no-outbox-candidate`) — the outbox row is `failed`/`pending`/absent, so there is
//       nothing `held` anywhere.
//
// The mirror row looks identical in both, so the banner offered "Release the hold" in BOTH — and in (b)
// the click could ONLY fail ("There is no held ERP command to release for this project."), on the very
// screen that is telling the operator ERPNext is enforcing the wrong budget or none. A button whose only
// possible outcome is an error costs the reader their remaining trust in the screen. The surface now
// asks the outbox (`hold_releasable`), and case (b) gets its real route out instead: Retry.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetProjection — the Release affordance is offered only where it can work (MEDIUM-1)', () => {
  it('MEDIUM-1 a SWEEP-PARKED hold offers NO release button — there is no held command behind it', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({
        pushState: 'held',
        pushError: 'budget-push-attempts-exhausted',
        fiscalYear: ERP_FISCAL_YEAR,
        holdReleasable: false,
      }),
    );
    renderPage('Admin');
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('button', { name: /release the hold/i }),
      'the release would throw "there is no held ERP command to release"',
    ).not.toBeInTheDocument();
  });

  it('MEDIUM-1 a sweep-parked hold offers RETRY instead — the operator is never left with no route out', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({
        pushState: 'held',
        pushError: 'budget-push-attempts-exhausted',
        fiscalYear: ERP_FISCAL_YEAR,
        holdReleasable: false,
      }),
    );
    renderPage('Admin');
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it.each([['budget-push-attempts-exhausted'], ['budget-push-no-outbox-candidate']])(
    'MEDIUM-1 %s reads as a sentence, never as a raw adapter token',
    async (code) => {
      pushStatusMock.mockResolvedValue(
        pushStatus({ pushState: 'held', pushError: code, fiscalYear: ERP_FISCAL_YEAR, holdReleasable: false }),
      );
      renderPage('Admin');
      const alert = await screen.findByRole('alert');
      expect(alert.textContent ?? '').not.toMatch(RAW_ADAPTER_TOKEN);
      expect(alert.textContent ?? '').not.toContain(code);
    },
  );

  it('MEDIUM-1 a REAL dispatch hold still offers the release — the gate narrows the affordance, it does not remove it', async () => {
    pushStatusMock.mockResolvedValue(
      pushStatus({ pushState: 'held', pushError: 'command-held', fiscalYear: ERP_FISCAL_YEAR, holdReleasable: true }),
    );
    renderPage('Admin');
    expect(await screen.findByRole('button', { name: /release the hold/i })).toBeInTheDocument();
  });
});
