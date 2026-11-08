import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { LedgerProvenance, type LedgerProvenanceProps } from './LedgerProvenance';

const asOf = new Date(Date.now() - 5 * 60_000).toISOString();
const matches = { status: 'matches' as const, checkedAt: asOf, reason: null, accountsChecked: 4, stale: false, accounts: [] };
const mount = (props: Partial<LedgerProvenanceProps> = {}) => render(
  <FinanceI18nTestProvider><LedgerProvenance state="fresh" asOf={asOf} {...props} /></FinanceI18nTestProvider>,
);
afterEach(async () => { cleanup(); await financeTestI18n.changeLanguage('en'); });

describe('LedgerProvenance (AC-ODA-017/018): freshness', () => {
  it.each([
    ['fresh', 'Up to date'],
    ['stale', 'Not updated for over 30 minutes'],
    ['catching-up', 'Still reading Odoo history'],
    ['unavailable', 'Odoo not reachable, showing the last data'],
  ] as const)('%s says so in words', (state, text) => {
    mount({ state });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows the as-of time, or says nothing was read yet', () => {
    mount();
    expect(screen.getByText(/Odoo ledger as of/)).toBeInTheDocument();
    cleanup();
    mount({ asOf: null, state: 'catching-up' });
    expect(screen.getByText('Nothing read from the Odoo ledger yet')).toBeInTheDocument();
  });
});

describe('LedgerProvenance: reconciliation', () => {
  it('shows nothing about reconciliation to a role that does not see it', () => {
    mount({ check: undefined });
    expect(screen.queryByText(/Odoo$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Not checked against Odoo')).not.toBeInTheDocument();
  });

  it('matches', () => {
    mount({ check: matches });
    expect(screen.getByText('Matches Odoo')).toBeInTheDocument();
  });

  it('differs: names every account with both figures', () => {
    mount({ check: { ...matches, status: 'differs', accounts: [{ account: '5100', pmo: { debit: '100.00', credit: '0.00' }, odoo: { debit: '120.00', credit: '0.00' } }] } });
    expect(screen.getByText('Differs from Odoo')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Accounts that differ from Odoo' });
    expect(within(list).getByText(/Account 5100: PMO 100\.00, Odoo 120\.00/)).toBeInTheDocument();
  });

  it('not checked, and never checked, are both "not checked", never "matches"', () => {
    mount({ check: { ...matches, status: 'not-checked', reason: 'timeout' } });
    expect(screen.getByText('Not checked against Odoo')).toBeInTheDocument();
    expect(screen.queryByText('Matches Odoo')).not.toBeInTheDocument();
    cleanup();
    mount({ check: null });
    expect(screen.getByText('Not checked against Odoo')).toBeInTheDocument();
  });

  it('a check that covered an older position is out of date, not a match', () => {
    mount({ check: { ...matches, stale: true } });
    expect(screen.getByText('Check is out of date')).toBeInTheDocument();
    expect(screen.queryByText('Matches Odoo')).not.toBeInTheDocument();
  });
});

describe('LedgerProvenance: what is left out (FR-ODA-031)', () => {
  it('lists each reason with its count and amount, separately, and names the unmapped accounts', () => {
    mount({
      unmapped: { count: 2, debit: '1500.00', credit: '0.00', accounts: ['6100', '6200'] },
      unattributed: { count: 3, debit: '20.00', credit: '5.00' },
      unlinked: { count: 1, debit: '7.00', credit: '0.00' },
    });
    const list = screen.getByRole('list', { name: 'Amounts not counted in a category or project' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText(/Accounts without a budget category \(6100, 6200\): 1,500\.00, lines: 2/)).toBeInTheDocument();
    expect(within(list).getByText(/Belong to no project: 15\.00, lines: 3/)).toBeInTheDocument();
    expect(within(list).getByText(/In cost accounts no project is linked to: 7\.00, lines: 1/)).toBeInTheDocument();
  });

  it('prints nothing for a reason with no lines', () => {
    mount({ unmapped: { count: 0, debit: '0.00', credit: '0.00', accounts: [] }, unattributed: null, unlinked: null });
    expect(screen.queryByRole('list', { name: 'Amounts not counted in a category or project' })).not.toBeInTheDocument();
  });
});

describe('LedgerProvenance: copy (FR-ODA-024)', () => {
  it.each(['en', 'id'])('uses no internal jargon in %s', async (lng) => {
    await financeTestI18n.changeLanguage(lng);
    const { container } = mount({
      state: 'stale',
      check: { ...matches, status: 'differs', accounts: [{ account: '5100', pmo: { debit: '1.00', credit: '0.00' }, odoo: { debit: '2.00', credit: '0.00' } }] },
      unmapped: { count: 1, debit: '1.00', credit: '0.00', accounts: ['6100'] }, unattributed: { count: 1, debit: '1.00', credit: '0.00' }, unlinked: { count: 1, debit: '1.00', credit: '0.00' },
    });
    expect(container.textContent).not.toMatch(/mirror|analytic|\bGL\b|distribution|\bkey\b/i);
  });

  it('speaks Indonesian when asked', async () => {
    await financeTestI18n.changeLanguage('id');
    mount({ state: 'catching-up', check: matches });
    expect(screen.getByText('Masih membaca riwayat Odoo')).toBeInTheDocument();
    expect(screen.getByText('Cocok dengan Odoo')).toBeInTheDocument();
  });
});
