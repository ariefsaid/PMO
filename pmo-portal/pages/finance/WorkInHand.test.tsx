import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveWorkInHand, type WipInputRow } from '@/src/lib/workInHand';
import type { WorkInHand as WorkInHandFacts } from '@/src/lib/db/workInHand';
import { contrastRatio, themeTokens } from '@/src/test/a11yContrast';

const state = vi.hoisted(() => ({
  role: 'Finance',
  loading: false,
  error: false,
  facts: null as unknown,
  rows: [] as unknown[],
  refetch: vi.fn(),
  readEnabled: true,
}));

vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: state.role }) }));
vi.mock('@/src/hooks/useWorkInHand', () => ({
  useWorkInHand: (enabled: boolean) => {
    state.readEnabled = enabled;
    return { facts: enabled ? state.facts : null, rows: enabled ? state.rows : [], isLoading: enabled && state.loading, isError: enabled && state.error, isSuccess: enabled && !state.loading && !state.error, error: null, refetch: state.refetch };
  },
}));

import WorkInHand from './WorkInHand';

const AS_OF = '2026-12-10';
const TEXT_AA_MIN = 4.5;
const themeCss = readFileSync(join(__dirname, '..', '..', 'index.css'), 'utf8');
const THEME_TOKENS = [
  { name: 'light', tokens: themeTokens(themeCss, ':root {') },
  { name: 'dark', tokens: themeTokens(themeCss, '.dark {') },
];

const rated = (id: string, name: string, value: string, over: Partial<WipInputRow> = {}): WipInputRow => ({
  kind: 'contract', parentId: null, id, name, code: null, status: 'Ongoing Project', currency: 'IDR', value,
  incomplete: false, foreignCurrencyInvoiceCount: 0, unpricedInvoiceCount: 0,
  billedToDate: '100000.00', firstBillingMonth: '2026-11-01', windowMonths: [{ month: '2026-11-01', billed: '100000.00' }], ...over,
});

function setData(inputs: WipInputRow[], extra: Partial<WorkInHandFacts> = {}) {
  const facts: WorkInHandFacts = {
    asOf: AS_OF, timezone: 'Asia/Jakarta', orgCurrency: 'IDR', windowFrom: '2026-06-01', windowTo: '2026-11-01',
    truncated: false, undatedInvoiceCount: 0, noValueContractCount: 0, noValue: [], rows: inputs, ...extra,
  };
  state.facts = facts;
  state.rows = deriveWorkInHand(inputs, AS_OF);
}

function renderPage() {
  return render(<MemoryRouter><WorkInHand /></MemoryRouter>);
}

beforeEach(() => { state.role = 'Finance'; state.loading = false; state.error = false; state.readEnabled = true; state.refetch.mockReset(); });
afterEach(cleanup);

const rowOrder = () => screen.getAllByTestId(/^wih-row-/).map((r) => r.getAttribute('data-testid'));

describe('Work in hand screen', () => {
  it('lets a keyboard user focus the currency table to scroll through its figures', () => {
    setData([rated('c', 'Contract', '900000.00')]);
    renderPage();
    expect(screen.getByRole('region', { name: 'IDR contracts and work orders' })).toHaveAttribute('tabindex', '0');
  });
  it('ranks contracts with their work orders beneath, and each opens its page', () => {
    setData([
      rated('c-big', 'Big contract', '900000.00'),
      rated('c-small', 'Small contract', '300000.00'),
      { ...rated('w1', 'Survey', '500000.00'), kind: 'workOrder', parentId: 'c-big', code: 'WO-1' },
    ]);
    renderPage();
    expect(rowOrder()).toEqual(['wih-row-c-big', 'wih-row-w1', 'wih-row-c-small']);
    expect(screen.getByRole('link', { name: /Big contract/ })).toHaveAttribute('href', '/projects/c-big');
    expect(screen.getByRole('link', { name: /WO-1 Survey/ })).toHaveAttribute('href', '/work-orders/w1');
    expect(screen.getByTestId('wih-as-of')).toHaveTextContent(/10 Dec/);
  });

  it('AC-WIH-008 switching the order re-sorts the table', async () => {
    setData([
      rated('fast', 'Fast', '1000000.00'),                                                                                     // left 900k at 100k a month = 9.0
      rated('slow', 'Slow', '400000.00', { billedToDate: '10000.00', windowMonths: [{ month: '2026-11-01', billed: '10000.00' }] }), // left 390k at 10k = 39.0
    ]);
    renderPage();
    expect(rowOrder()).toEqual(['wih-row-fast', 'wih-row-slow']);
    await userEvent.click(screen.getByTestId('wih-sort-backlog'));
    expect(rowOrder()).toEqual(['wih-row-slow', 'wih-row-fast']);
  });

  it('shows months of backlog, and "No billing rate" with its cause instead of a number', () => {
    setData([
      rated('rate', 'Has rate', '1200000.00', { billedToDate: '340000.00', firstBillingMonth: '2026-09-01',
        windowMonths: [{ month: '2026-09-01', billed: '100000.00' }, { month: '2026-10-01', billed: '150000.00' }, { month: '2026-11-01', billed: '50000.00' }] }),
      rated('none', 'No rate', '500000.00', { billedToDate: '0.00', firstBillingMonth: null, windowMonths: [] }),
    ]);
    renderPage();
    expect(within(screen.getByTestId('wih-row-rate')).getByText('8.6')).toBeInTheDocument();
    const none = screen.getByTestId('wih-row-none');
    expect(within(none).getByText('No billing rate')).toBeInTheDocument();
    expect(within(none).getByText('Nothing billed in 6 months')).toBeInTheDocument();
    // the one place that lists what is off, before the table
    const attention = screen.getByTestId('wih-attention-list');
    expect(within(attention).getByRole('link', { name: 'No rate' })).toBeInTheDocument();
  });

  it('marks a row billed over value and shows Left to bill as the shared zero, not a negative', () => {
    setData([rated('over', 'Over', '50000.00')]);
    renderPage();
    const row = screen.getByTestId('wih-row-over');
    expect(within(row).getByText('Billed over value')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/-\s*(Rp|IDR)/);
  });

  it('the month drill-down offers the window month by month', async () => {
    setData([rated('c', 'Contract', '900000.00')]);
    renderPage();
    expect(screen.queryByTestId('wih-months-c')).toBeNull();
    await userEvent.click(screen.getByTestId('wih-toggle-c'));
    const months = within(screen.getByTestId('wih-months-c'));
    expect(months.getAllByRole('row').length).toBeGreaterThanOrEqual(6);
  });

  it('AC-WIH-016 reports truncation, no-value contracts, incomplete rows and undated invoices in the one hidden-figures line', async () => {
    setData([
      rated('ok', 'Fine', '900000.00'),
      rated('inc', 'Incomplete', '300000.00', { incomplete: true, billedToDate: null, firstBillingMonth: null, windowMonths: [], foreignCurrencyInvoiceCount: 2 }),
    ], {
      truncated: true, undatedInvoiceCount: 3, noValueContractCount: 1,
      noValue: [{ projectId: 'p5', name: 'No value', code: null, status: 'Ongoing Project', currency: 'IDR' }],
    });
    renderPage();
    const line = screen.getByTestId('figures-hidden');
    expect(line).toHaveTextContent('4 figures hidden');
    // the incomplete row carries no figure and is listed with its cause
    expect(screen.queryByTestId('wih-row-inc')).toBeNull();
    expect(within(screen.getByTestId('wih-incomplete-list')).getByText(/2 invoices in another currency/)).toBeInTheDocument();
    await userEvent.click(within(line).getByRole('button', { name: /why/i }));
    expect(await screen.findByText(/the list is cut at 500 contracts and 3,000 work orders/)).toBeInTheDocument();
    expect(screen.getByText(/1 contract has no value set/)).toBeInTheDocument();
    expect(screen.getByText(/1 row has invoices that cannot be totalled/)).toBeInTheDocument();
    expect(screen.getByText(/3 invoices have no date and are not counted/)).toBeInTheDocument();
  });

  it('never totals across currencies: each currency has its own group', () => {
    setData([rated('idr', 'In rupiah', '900000.00'), rated('usd', 'In dollars', '900000.00', { currency: 'USD' })]);
    renderPage();
    expect(screen.getByTestId('wih-group-IDR')).toBeInTheDocument();
    expect(screen.getByTestId('wih-group-USD')).toBeInTheDocument();
    expect(within(screen.getByTestId('wih-group-IDR')).queryByText('In dollars')).toBeNull();
  });

  it('empty: one line naming that nothing is in work in hand, with the control that fixes it', async () => {
    setData([]);
    renderPage();
    expect(screen.getByText('No contract is in work in hand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open projects' })).toBeInTheDocument();
  });

  it('error: the retry uses a DESIGN.md token with WCAG AA text contrast', async () => {
    state.error = true;
    state.facts = undefined;
    renderPage();
    expect(screen.getByText("Couldn't load work in hand")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveClass('text-foreground');

    for (const { name, tokens } of THEME_TOKENS) {
      const textToken = [...retry.classList].find((className) => className.startsWith('text-'))?.slice('text-'.length);
      expect(textToken, `retry text token in ${name} theme`).toBe('foreground');
      for (const surface of ['background', 'card'] as const) {
        const ink = tokens[textToken!];
        const paper = tokens[surface];
        expect(ink, `--${textToken} missing from ${name} theme`).toBeDefined();
        expect(paper, `--${surface} missing from ${name} theme`).toBeDefined();
        const ratio = contrastRatio(ink!, paper!);
        expect(ratio, `${textToken} on ${surface} in ${name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_AA_MIN);
      }
    }

    await userEvent.click(retry);
    expect(state.refetch).toHaveBeenCalled();
  });

  it('loading shows the loading state, not an empty table', () => {
    state.loading = true;
    state.facts = undefined;
    renderPage();
    expect(screen.queryByTestId(/^wih-group-/)).toBeNull();
    expect(screen.queryByText('No contract is in work in hand')).toBeNull();
  });

  it('a role without finance access gets the access-denied state and reads nothing', () => {
    state.role = 'Engineer';
    setData([rated('c', 'Contract', '900000.00')]);
    renderPage();
    expect(screen.queryByTestId('wih-row-c')).toBeNull();
    expect(state.readEnabled).toBe(false);
  });

  it('AC-MV-003 labels a Project Manager position as their assigned projects only', () => {
    state.role = 'Project Manager';
    setData([rated('managed', 'Managed project', '900000.00')]);
    renderPage();
    expect(screen.getByRole('heading', { name: 'My work in hand' })).toBeInTheDocument();
    expect(screen.getByText('These figures cover only projects assigned to you.')).toBeInTheDocument();
  });

  it('AC-MV-003 keeps Finance company-wide while the Project Manager gets the assigned-project label', () => {
    state.role = 'Finance';
    setData([rated('company', 'Company project', '900000.00')]);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Work in hand' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My work in hand' })).toBeNull();
    expect(screen.queryByText('These figures cover only projects assigned to you.')).toBeNull();
  });

  it('AC-M8-005 shows capacity-based months and non-included foreign currencies in the top summary', () => {
    setData([
      rated('idr', 'IDR Contract', '25000000.00', { billedToDate: '0.00', firstBillingMonth: null, windowMonths: [] }),
      rated('usd', 'USD Contract', '900000.00', { currency: 'USD', billedToDate: '0.00', firstBillingMonth: null, windowMonths: [] }),
    ], { monthlyCapacity: '2500000.00' });
    renderPage();
    const summary = screen.getByTestId('wih-capacity-summary');
    expect(summary).toHaveTextContent('IDR 25,000,000');
    expect(summary).toHaveTextContent('10.0 months');
    expect(summary).toHaveTextContent('USD not included in months (no conversion)');
  });

  it('AC-M8-005 shows a sensible empty state in the summary when monthly capacity is unset', () => {
    state.role = 'Admin';
    setData([rated('idr', 'IDR Contract', '25000000.00')], { monthlyCapacity: null });
    renderPage();
    const summary = screen.getByTestId('wih-capacity-summary');
    expect(summary).toHaveTextContent('No monthly capacity set');
    expect(within(summary).getByRole('link', { name: 'Set capacity' })).toHaveAttribute('href', '/administration/projects#work-in-hand-capacity');
  });
});
