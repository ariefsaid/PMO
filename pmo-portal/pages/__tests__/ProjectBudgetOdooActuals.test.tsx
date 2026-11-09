// AC-ODA-017 (#1507 S7): ledger-basis project actuals in each state, with plain messages and no invented zero.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({ getConnection: vi.fn(), reads: vi.fn(), health: vi.fn(), lines: vi.fn(), linked: vi.fn(), currency: vi.fn() }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/odoo', () => ({
  odooRepository: { getConnection: h.getConnection },
}));
vi.mock('@/src/lib/repositories/odooLedger', () => ({
  odooLedgerRepository: { health: h.health, lines: h.lines, projectLinked: h.linked, companyCurrency: h.currency },
}));
vi.mock('@/src/lib/repositories/revenue', () => ({
  revenueRepository: { getOrgReadsErpLedger: h.reads },
}));

import { BudgetOdooActuals, BudgetOdooCategoryLines } from '../project-detail/budget/BudgetOdooActuals';

const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const now = () => new Date().toISOString();
const health = (over: Record<string, unknown> = {}) => ({
  state: 'fresh', asOf: now(), caughtUp: true, lastCensus: null,
  check: { status: 'matches', checkedAt: now(), reason: null, accountsChecked: 3, stale: false, accounts: [] }, lastGood: null,
  unmapped: { count: 0, debit: '0.00', credit: '0.00', accounts: [] }, unattributed: null, unlinked: null, ...over,
});
const line = (i: number) => ({ id: `l${i}`, date: '2026-10-01', moveName: `BILL/2026/${i}`, account: '5100', partner: 'Vendor A', debit: '10.00', credit: '0.00' });

function setup({ odoo = true, ledger = true, linked = true, role = 'Finance' as string } = {}) {
  h.getConnection.mockResolvedValue({ status: odoo ? 'active' : 'disconnected', activated: odoo, connection: null, capabilities: null, config: {} });
  h.reads.mockResolvedValue(ledger);
  h.linked.mockResolvedValue(linked);
  return (node: React.ReactNode) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole={role as never}>
        <FinanceI18nTestProvider><MemoryRouter>{node}</MemoryRouter></FinanceI18nTestProvider>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); h.currency.mockResolvedValue('IDR'); });
afterEach(async () => { cleanup(); await financeTestI18n.changeLanguage('en'); });

describe('BudgetOdooActuals strip (FR-ODA-050/052)', () => {
  it('renders nothing for an organisation that is not on the Odoo ledger', async () => {
    const mount = setup({ ledger: false });
    const { container } = mount(<BudgetOdooActuals projectId={PROJECT} />);
    await waitFor(() => expect(h.reads).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="budget-odoo-actuals"]')).toBeNull();
    expect(h.health).not.toHaveBeenCalled();
  });

  it('renders nothing when the organisation does not use Odoo', async () => {
    const mount = setup({ odoo: false });
    const { container } = mount(<BudgetOdooActuals projectId={PROJECT} />);
    await waitFor(() => expect(h.getConnection).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="budget-odoo-actuals"]')).toBeNull();
  });

  it('fresh and matching: shows the as-of time and "Matches Odoo"', async () => {
    h.health.mockResolvedValue(health());
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('Matches Odoo')).toBeInTheDocument();
    expect(h.health).toHaveBeenCalledWith(PROJECT);
  });

  it.each([
    ['stale', { state: 'stale' }, 'Not updated for over 30 minutes'],
    ['partial (catching up)', { state: 'catching-up', caughtUp: false }, 'Still reading Odoo history'],
    ['unavailable', { state: 'unavailable' }, 'Odoo not reachable, showing the last data'],
  ])('%s says so', async (_n, over, text) => {
    h.health.mockResolvedValue(health(over));
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('differs and not checked are shown for what they are', async () => {
    h.health.mockResolvedValue(health({ check: { status: 'differs', checkedAt: now(), reason: null, accountsChecked: 2, stale: false, accounts: [{ account: '5100', pmo: { debit: '1.00', credit: '0.00' }, odoo: { debit: '2.00', credit: '0.00' } }] } }));
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText('Differs from Odoo')).toBeInTheDocument();
    expect(screen.getByText(/Account 5100/)).toBeInTheDocument();
    cleanup();
    h.health.mockResolvedValue(health({ check: null }));
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText('Not checked against Odoo')).toBeInTheDocument();
  });

  it('unmapped amounts are a separate, labelled line that names the accounts', async () => {
    h.health.mockResolvedValue(health({ unmapped: { count: 4, debit: '250.00', credit: '0.00', accounts: ['6100'] } }));
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText(/Accounts without a budget category \(6100\): debits 250\.00, credits 0\.00 \(4 lines\)/)).toBeInTheDocument();
    expect(await screen.findByText('Amounts in IDR')).toBeInTheDocument();
  });

  it('falls back to the org currency when the Odoo company has none recorded', async () => {
    h.currency.mockResolvedValue(null);
    h.health.mockResolvedValue(health({ unmapped: { count: 1, debit: '1.00', credit: '0.00', accounts: ['6100'] } }));
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText('Amounts in USD')).toBeInTheDocument();
  });

  it('no linked cost account: says actual cost cannot be shown, links the setup to a manager, and never shows a zero', async () => {
    const mount = setup({ linked: false, role: 'Admin' });
    mount(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText(/no Odoo cost account is linked to this project/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Link a cost account' })).toHaveAttribute('href', '/administration/integrations');
    expect(h.health).not.toHaveBeenCalled();
    expect(screen.queryByText(/^0([.,]00)?$/)).not.toBeInTheDocument();
  });

  it('no linked cost account, role that cannot set it up: tells them who can', async () => {
    setup({ linked: false, role: 'Project Manager' })(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText(/An administrator can link one\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Link a cost account' })).not.toBeInTheDocument();
  });

  it('a Project Manager sees freshness but not the reconciliation', async () => {
    h.health.mockResolvedValue(health({ check: null, unmapped: null }));
    setup({ role: 'Project Manager' })(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByText('Not checked against Odoo')).not.toBeInTheDocument();
    expect(screen.queryByText('Matches Odoo')).not.toBeInTheDocument();
  });

  it('a failed read offers a retry', async () => {
    h.health.mockRejectedValueOnce(new AppError('boom', 'XX000')).mockResolvedValue(health());
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText('The Odoo ledger status could not be read')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
  });

  it('speaks Indonesian', async () => {
    await financeTestI18n.changeLanguage('id');
    h.health.mockResolvedValue(health());
    setup()(<BudgetOdooActuals projectId={PROJECT} />);
    expect(await screen.findByText('Biaya aktual dari Odoo')).toBeInTheDocument();
    expect(await screen.findByText('Cocok dengan Odoo')).toBeInTheDocument();
  });
});

describe('BudgetOdooCategoryLines (FR-ODA-051)', () => {
  const fallback = <p>ERPNext fallback</p>;
  it('falls back to what was there when the organisation is not on the Odoo ledger', async () => {
    setup({ ledger: false })(<BudgetOdooCategoryLines projectId={PROJECT} category="materials" fallback={fallback} />);
    expect(await screen.findByText('ERPNext fallback')).toBeInTheDocument();
    expect(h.lines).not.toHaveBeenCalled();
  });

  it('lists the lines of the category and says "Showing x of x" when all are loaded', async () => {
    h.lines.mockResolvedValue({ lines: [line(1), line(2)], next: null, limit: 50, linked: true });
    setup()(<BudgetOdooCategoryLines projectId={PROJECT} category="materials" fallback={fallback} />);
    const table = await screen.findByRole('table', { name: 'Odoo lines behind this category' });
    expect(within(table).getByText('BILL/2026/1')).toBeInTheDocument();
    expect(within(table).getAllByText('Vendor A')).toHaveLength(2);
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
    expect(await within(table).findByRole('columnheader', { name: /Amount \(IDR\)/ })).toBeInTheDocument();
    expect(h.lines).toHaveBeenCalledWith({ projectId: PROJECT, category: 'materials', after: null, limit: 50 });
  });

  it('pages by key: Show more fetches the next page, All fetches the rest', async () => {
    h.lines
      .mockResolvedValueOnce({ lines: [line(1)], next: 'l1', limit: 50, linked: true })
      .mockResolvedValueOnce({ lines: [line(2)], next: 'l2', limit: 50, linked: true })
      .mockResolvedValueOnce({ lines: [line(3)], next: null, limit: 50, linked: true });
    setup()(<BudgetOdooCategoryLines projectId={PROJECT} category="materials" fallback={fallback} />);
    expect(await screen.findByText('Showing 1 so far')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Showing 2 so far')).toBeInTheDocument();
    expect(h.lines).toHaveBeenLastCalledWith({ projectId: PROJECT, category: 'materials', after: 'l1', limit: 50 });
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('Showing 3 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('shows an empty category as empty, not as a zero', async () => {
    h.lines.mockResolvedValue({ lines: [], next: null, limit: 50, linked: true });
    setup()(<BudgetOdooCategoryLines projectId={PROJECT} category="materials" fallback={fallback} />);
    expect(await screen.findByText('No lines in this category')).toBeInTheDocument();
  });

  it('a Project Manager gets the totals-only sentence and no lines are asked for', async () => {
    setup({ role: 'Project Manager' })(<BudgetOdooCategoryLines projectId={PROJECT} category="materials" fallback={fallback} />);
    expect(await screen.findByText(/Your role sees the project totals/)).toBeInTheDocument();
    expect(h.lines).not.toHaveBeenCalled();
  });

  it('an unlinked project has no lines to show and asks for none', async () => {
    setup({ linked: false })(<BudgetOdooCategoryLines projectId={PROJECT} category="materials" fallback={fallback} />);
    expect(await screen.findByText(/so there are no lines to show/)).toBeInTheDocument();
    expect(h.lines).not.toHaveBeenCalled();
  });
});
