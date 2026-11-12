// AC-ODA-018 (#1507 S7): the Odoo statement states, in both locales, with values, as-of time and badges and no internal jargon.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({ catalogue: vi.fn(), statement: vi.fn(), currency: vi.fn() }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { odooLedger: { statementCatalogue: h.catalogue, statement: h.statement, companyCurrency: h.currency } } }));

import { OdooStatementsSection } from './OdooStatementsSection';
import { statementLedgerState } from '@/src/components/odoo-ledger/ledgerState';

const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const now = () => new Date().toISOString();
const month = { kind: 'month', currentStart: '2026-10-01', currentEnd: '2026-10-31', priorStart: '2026-09-01', priorEnd: '2026-09-30' };
const catalogue = { state: 'complete', companyLabel: 'PT Contoh', asOf: now(), periods: [month, { ...month, kind: 'quarter', currentStart: '2026-10-01', currentEnd: '2026-12-31' }], scopes: [] };
const prov = (over: Record<string, unknown> = {}) => ({
  ledgerAsOf: now(), caughtUp: true, lastCheck: { status: 'matches', checkedAt: now() }, scope: 'company',
  unattributed: { count: 2, debit: '30.00', credit: '0.00' }, unlinked: null, unclassified: { count: 0, balance: '0.00' }, ...over,
});
const side = (columns: string[], rows: unknown[], summary: unknown[]) => ({ columns: columns.map((c) => ({ fieldname: c, label: c, type: 'currency' })), rows, summary });
const tb = (over: Record<string, unknown> = {}) => ({
  state: 'complete', companyLabel: 'PT Contoh', viewKind: 'account_breakdown', period: month, hasActivity: true,
  current: side(['debit', 'credit'], [
    { account: '5100', account_name: 'Materials', opening_debit: '0', opening_credit: '0', debit: '1500.50', credit: '0', closing_debit: '1500.50', closing_credit: '0' },
    { account: '2100', account_name: null, opening_debit: '0', opening_credit: '0', debit: '0', credit: '1500.50', closing_debit: '0', closing_credit: '1500.50' },
  ], [{ total_debit: '1500.50', total_credit: '1500.50', opening_debit: '0', opening_credit: '0', closing_debit: '1500.50', closing_credit: '1500.50' }]),
  prior: side([], [], [{}]), provenance: prov(), ...over,
});
const bs = (summary: Record<string, unknown>) => ({
  ...tb(), current: side(['balance'], [
    { row_kind: 'account', account: '1100', account_name: 'Cash', section: 'asset', balance: '50.00' },
    { row_kind: 'current_year_earnings', section: 'equity', account_name: 'Current-year earnings', derived: true, balance: '10.00' },
  ], [summary]),
});

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location" data-search={location.search} />;
};

function mount(projectId?: string, role = 'Finance', initialEntry = '/financial-statements') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <ImpersonationProvider realRole={role as never}><FinanceI18nTestProvider><OdooStatementsSection projectId={projectId} /></FinanceI18nTestProvider></ImpersonationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => { h.catalogue.mockReset(); h.statement.mockReset(); h.currency.mockReset(); h.currency.mockResolvedValue('IDR'); h.catalogue.mockResolvedValue(catalogue); });
afterEach(async () => { cleanup(); await financeTestI18n.changeLanguage('en'); });

describe('OdooStatementsSection states', () => {
  it('loading, then error with a retry that reloads', async () => {
    h.catalogue.mockRejectedValueOnce(new AppError('x', 'XX000')).mockResolvedValue(catalogue);
    h.statement.mockResolvedValue(tb());
    mount();
    expect(await screen.findByText("Couldn't load financial statements")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Total')).toBeInTheDocument();
  });

  it('not in use yet: says so and offers no statement', async () => {
    h.catalogue.mockResolvedValue({ state: 'not_in_use' });
    mount();
    expect(await screen.findByText('Odoo ledger not in use yet')).toBeInTheDocument();
    expect(h.statement).not.toHaveBeenCalled();
  });

  it('the company page has a plain empty state when nothing has been read', async () => {
    h.catalogue.mockResolvedValue({ state: 'unavailable', companyLabel: null });
    mount();
    expect(await screen.findByText('No Odoo ledger lines yet')).toBeInTheDocument();
  });

  it('a project page stays quiet when there is nothing to show', async () => {
    h.catalogue.mockResolvedValue({ state: 'not_in_use' });
    const { container } = mount(PROJECT, 'Admin');
    await waitFor(() => expect(h.catalogue).toHaveBeenCalledWith(PROJECT));
    await waitFor(() => expect(container.querySelector('[data-testid="odoo-statements"]')).not.toBeInTheDocument());
  });
});

describe('OdooStatementsSection: populated', () => {
  it('C10 OdooStatementsSection.tsx:40: period selections restore from and write to the URL', async () => {
    h.statement.mockResolvedValue(tb());
    mount(undefined, 'Finance', '/financial-statements?keep=preserve&periodKind=quarter&periodStart=2026-10-01');

    await screen.findByRole('table', { name: 'Trial balance' });
    expect(screen.getByLabelText('Period type')).toHaveValue('quarter');
    expect(screen.getByLabelText('Period')).toHaveValue('2026-10-01');
    expect(h.statement).toHaveBeenCalledWith({ statement: 'trial_balance', periodKind: 'quarter', periodStart: '2026-10-01' });

    await userEvent.selectOptions(screen.getByLabelText('Period type'), 'month');
    const params = new URLSearchParams(screen.getByTestId('location').getAttribute('data-search') ?? '');
    expect(params.get('keep')).toBe('preserve');
    expect(params.get('periodKind')).toBe('month');
    expect(params.get('periodStart')).toBe('2026-10-01');
  });

  it('Trial Balance: accounts as "code name", totals, as-of, freshness and the tie to Odoo', async () => {
    h.statement.mockResolvedValue(tb());
    mount();
    const table = await screen.findByRole('table', { name: 'Trial balance' });
    expect(within(table).getByText('5100 Materials')).toBeInTheDocument();
    expect(within(table).getByText('2100')).toBeInTheDocument();
    expect(within(table).getAllByText('1,500.50').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Matches Odoo')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText(/Belong to no project: debits 30\.00, credits 0\.00 \(2 lines\)/)).toBeInTheDocument();
    expect(await screen.findByText('Amounts in IDR')).toBeInTheDocument();
    expect(h.statement).toHaveBeenCalledWith({ statement: 'trial_balance', periodKind: 'month', periodStart: '2026-10-01' });
  });

  it('asks the database for the statement and period the user picks', async () => {
    h.statement.mockResolvedValue(tb());
    mount();
    await screen.findByRole('table', { name: 'Trial balance' });
    await userEvent.selectOptions(screen.getByLabelText('Statement'), 'balance_sheet');
    await waitFor(() => expect(h.statement).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'balance_sheet' })));
    await userEvent.selectOptions(screen.getByLabelText('Period type'), 'quarter');
    await waitFor(() => expect(h.statement).toHaveBeenLastCalledWith(expect.objectContaining({ periodKind: 'quarter' })));
  });

  it('Balance Sheet that balances: shows the derived earnings line and no warning', async () => {
    h.statement.mockImplementation(({ statement }) => Promise.resolve(statement === 'balance_sheet'
      ? bs({ total_assets: '50.00', total_liabilities_equity: '50.00', difference: '0.00', balanced: true }) : tb()));
    mount();
    await screen.findByRole('table', { name: 'Trial balance' });
    await userEvent.selectOptions(screen.getByLabelText('Statement'), 'balance_sheet');
    expect(await screen.findByText(/Current-year earnings/)).toBeInTheDocument();
    expect(screen.getByText('(calculated)')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Balance Sheet that does not balance: says so with the difference', async () => {
    h.statement.mockImplementation(({ statement }) => Promise.resolve(statement === 'balance_sheet'
      ? bs({ total_assets: '50.00', total_liabilities_equity: '40.00', difference: '10.00', balanced: false }) : tb()));
    mount();
    await screen.findByRole('table', { name: 'Trial balance' });
    await userEvent.selectOptions(screen.getByLabelText('Statement'), 'balance_sheet');
    expect(await screen.findByRole('alert')).toHaveTextContent('This balance sheet does not balance: assets and liabilities plus equity differ by 10.00.');
  });

  it('partial while the history is still being read', async () => {
    h.statement.mockResolvedValue(tb({ provenance: prov({ caughtUp: false }) }));
    mount();
    expect(await screen.findByText(/Partial: PMO is still reading the Odoo history/)).toBeInTheDocument();
    expect(screen.getByText('Still reading Odoo history')).toBeInTheDocument();
  });

  it('differs from Odoo and a check that was never run are both visible', async () => {
    h.statement.mockResolvedValue(tb({ provenance: prov({ lastCheck: { status: 'differs', checkedAt: now() } }) }));
    mount();
    expect(await screen.findByText('Differs from Odoo')).toBeInTheDocument();
    cleanup();
    h.statement.mockResolvedValue(tb({ provenance: prov({ lastCheck: null }) }));
    mount();
    expect(await screen.findByText('Not checked against Odoo')).toBeInTheDocument();
  });

  it('a ledger last read long ago is stale', () => {
    expect(statementLedgerState({ ...prov(), ledgerAsOf: new Date(Date.now() - 45 * 60_000).toISOString() } as never)).toBe('stale');
    expect(statementLedgerState({ ...prov(), caughtUp: false } as never)).toBe('catching-up');
    expect(statementLedgerState(prov() as never)).toBe('fresh');
  });

  it('no activity in the period is said, not shown as zero lines', async () => {
    h.statement.mockResolvedValue(tb({ hasActivity: false }));
    mount();
    expect(await screen.findByText('No activity in this period')).toBeInTheDocument();
  });

  it('project profit and loss for a Project Manager: totals only, no account lines, no reconciliation', async () => {
    h.catalogue.mockResolvedValue({ ...catalogue, scopes: [{ scopeKind: 'project', projectId: PROJECT, statements: ['profit_and_loss'], viewKinds: ['project_totals'] }] });
    h.statement.mockResolvedValue({
      state: 'complete', companyLabel: 'PT Contoh', viewKind: 'project_totals', period: month, hasActivity: true,
      current: { columns: [], rows: [], summary: [{ income: '900.00', expense: '400.00', net: '500.00' }] }, prior: { columns: [], rows: [], summary: [{ income: '0.00', expense: '0.00', net: '0.00' }] },
      provenance: { ledgerAsOf: now(), caughtUp: null, lastCheck: null, scope: 'project', unattributed: null, unlinked: null, unclassified: null },
    });
    mount(PROJECT, 'Project Manager');
    const table = await screen.findByRole('table', { name: 'Project profit and loss' });
    expect(within(table).getByText('900.00')).toBeInTheDocument();
    expect(within(table).getByText('500.00')).toBeInTheDocument();
    expect(screen.queryByText('Matches Odoo')).not.toBeInTheDocument();
    expect(screen.queryByText('Not checked against Odoo')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Statement')).not.toBeInTheDocument();
    expect(h.statement).toHaveBeenCalledWith({ statement: 'profit_and_loss', periodKind: 'month', periodStart: '2026-10-01', projectId: PROJECT });
  });
});

describe('OdooStatementsSection: language (FR-ODA-024)', () => {
  it.each(['en', 'id'])('shows no internal jargon in %s', async (lng) => {
    await financeTestI18n.changeLanguage(lng);
    h.statement.mockResolvedValue(tb({ provenance: prov({ caughtUp: false, lastCheck: { status: 'differs', checkedAt: now() }, unlinked: { count: 1, debit: '1.00', credit: '0.00' } }) }));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(container.textContent).not.toMatch(/mirror|analytic|\bGL\b|distribution/i);
  });

  it('labels the statement in Indonesian', async () => {
    await financeTestI18n.changeLanguage('id');
    h.statement.mockResolvedValue(tb());
    mount();
    expect(await screen.findByText('Jumlah')).toBeInTheDocument();
    expect(screen.getByText('Cocok dengan Odoo')).toBeInTheDocument();
  });
});
