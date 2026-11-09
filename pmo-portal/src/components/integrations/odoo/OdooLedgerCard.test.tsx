// S7-T5 (#1507, FR-ODA-060/062): the health card and the Admin's switch, with the reasons a switch is refused in plain words.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({ getConnection: vi.fn(), reads: vi.fn(), health: vi.fn(), switchBasis: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/odoo', () => ({
  odooRepository: { getConnection: h.getConnection },
}));
vi.mock('@/src/lib/repositories/odooLedger', () => ({
  odooLedgerRepository: { health: h.health, switchBasis: h.switchBasis },
}));
vi.mock('@/src/lib/repositories/revenue', () => ({
  revenueRepository: { getOrgReadsErpLedger: h.reads },
}));

import { OdooLedgerCard } from './OdooLedgerCard';
import { switchBlocker } from '@/src/components/odoo-ledger/ledgerState';

const now = () => new Date().toISOString();
const check = (over: Record<string, unknown> = {}) => ({ status: 'matches', checkedAt: now(), reason: null, accountsChecked: 4, stale: false, accounts: [], ...over });
const health = (over: Record<string, unknown> = {}) => ({ state: 'fresh', asOf: now(), caughtUp: true, lastCensus: null, check: check(), lastGood: null, unmapped: null, unattributed: null, unlinked: null, ...over });
const DIFF = check({ status: 'differs', accounts: [{ account: '5100', pmo: { debit: '1.00', credit: '0.00' }, odoo: { debit: '2.00', credit: '0.00' } }] });

function ViewAs({ as }: { as: string }) { const { viewAs } = useEffectiveRole(); return <button onClick={() => viewAs(as as never)}>view-as</button>; }
function mount(role: string, { onLedger = false, viewAs }: { onLedger?: boolean; viewAs?: string } = {}) {
  h.getConnection.mockResolvedValue({ status: 'active', activated: true, connection: null, capabilities: null, config: {} });
  h.reads.mockResolvedValue(onLedger);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole={role as never} demoEligibility="eligible">
        <FinanceI18nTestProvider>{viewAs && <ViewAs as={viewAs} />}<OdooLedgerCard /></FinanceI18nTestProvider>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); h.switchBasis.mockResolvedValue(now()); });
afterEach(async () => { cleanup(); await financeTestI18n.changeLanguage('en'); });

describe('switchBlocker mirrors the database order', () => {
  it.each([
    [{ caughtUp: false }, 'catching-up'],
    [{ check: null }, 'not-checked'],
    [{ check: check({ status: 'not-checked' }) }, 'not-checked'],
    [{ check: check({ stale: true }) }, 'check-stale'],
    [{ check: DIFF }, null],
    [{}, null],
  ])('%j → %s', (over, expected) => { expect(switchBlocker(health(over) as never)).toBe(expected); });
});

describe('OdooLedgerCard', () => {
  it('Admin, matching and caught up: one confirm names the consequence, then the switch is sent with no override', async () => {
    h.health.mockResolvedValue(health());
    mount('Admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the Odoo ledger' }));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.getByRole('dialog'));
    expect(dialog).toHaveTextContent(/stop counting as actual cost/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to the Odoo ledger' }));
    await waitFor(() => expect(h.switchBasis).toHaveBeenCalledWith({}));
  });

  it('catching up: the button is disabled and the reason is next to it', async () => {
    h.health.mockResolvedValue(health({ caughtUp: false, state: 'catching-up' }));
    mount('Admin');
    expect(await screen.findByText(/PMO is still reading the Odoo history\. You can move/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to the Odoo ledger' })).toBeDisabled();
  });

  it('not checked yet and a stale check each say why', async () => {
    h.health.mockResolvedValue(health({ check: null }));
    mount('Admin');
    expect(await screen.findByText(/has not compared its figures with Odoo yet/)).toBeInTheDocument();
    cleanup();
    h.health.mockResolvedValue(health({ check: check({ stale: true }) }));
    mount('Admin');
    expect(await screen.findByText(/last comparison with Odoo is out of date/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to the Odoo ledger' })).toBeDisabled();
  });

  it('a difference: the Admin must write a reason, which is sent with the confirmation', async () => {
    h.health.mockResolvedValue(health({ check: DIFF }));
    mount('Admin');
    expect(await screen.findByText('Differs from Odoo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move to the Odoo ledger with a reason' }));
    const dialog = await screen.findByRole('dialog').catch(() => screen.getByRole('alertdialog'));
    const confirm = within(dialog).getByRole('button', { name: 'Move to the Odoo ledger' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Why is the difference acceptable/), 'Rounding on one account');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(h.switchBasis).toHaveBeenCalledWith({ confirmDifference: true, reason: 'Rounding on one account' }));
  });

  it('Finance sees the health and why, but no switch', async () => {
    h.health.mockResolvedValue(health({ check: DIFF }));
    mount('Finance');
    expect(await screen.findByText('Differs from Odoo')).toBeInTheDocument();
    expect(screen.getByText(/An Admin can move to the Odoo ledger after explaining the difference/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to the Odoo ledger/ })).not.toBeInTheDocument();
  });

  it('an Admin viewing as another role gets no switch (view-only)', async () => {
    h.health.mockResolvedValue(health());
    mount('Admin', { viewAs: 'Finance' });
    await screen.findByText('Matches Odoo');
    expect(screen.getByRole('button', { name: 'Move to the Odoo ledger' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'view-as' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Move to the Odoo ledger' })).not.toBeInTheDocument());
  });

  it('a refusal from the database is said in words and nothing else changes', async () => {
    h.health.mockResolvedValue(health());
    h.switchBasis.mockRejectedValue(new AppError('ledger_check_stale', 'P0001'));
    mount('Admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the Odoo ledger' }));
    const dialog = await screen.findByRole('dialog').catch(() => screen.getByRole('alertdialog'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to the Odoo ledger' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The last comparison is out of date. Wait for the next one.');
  });

  it('already on the Odoo ledger: says so and offers no switch', async () => {
    h.health.mockResolvedValue(health());
    mount('Admin', { onLedger: true });
    expect(await screen.findByText('In use')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to the Odoo ledger/ })).not.toBeInTheDocument();
  });

  it('speaks Indonesian', async () => {
    await financeTestI18n.changeLanguage('id');
    h.health.mockResolvedValue(health({ caughtUp: false }));
    mount('Admin');
    expect(await screen.findByText(/PMO masih membaca riwayat Odoo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pindah ke buku besar Odoo' })).toBeDisabled();
  });
});
