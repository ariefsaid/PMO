import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, within, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import enWo from '../../public/locales/en/workOrders.json';
import idWo from '../../public/locales/id/workOrders.json';
import { formatCurrency } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import type { WorkOrderBilledMonths } from '@/src/lib/db/workOrderBilling';
import { AreaHelpProvider } from './AreaHelp';
const render = (ui: React.ReactElement) => rtlRender(<AreaHelpProvider>{(help) => <>{ui}<output data-testid="billing-help">{help.map((entry) => entry.body).join(' ')}</output></>}</AreaHelpProvider>);
import { BillingSection } from './BillingSection';

const row = { workOrderId: 'w', projectId: 'p', status: 'Issued' as const, currency: 'USD', orderNet: 500000, invoiced: 250000, pending: 50000, paid: 0, remaining: 200000, figuresComplete: true, lineCount: 3, unpaidCount: 1 };
const billing = (r: typeof row | null = row) => ({ row: r, isPending: false, isError: false, onRetry: vi.fn() });
const months = (o: Partial<WorkOrderBilledMonths> = {}): WorkOrderBilledMonths => ({
  currency: 'USD', asOf: '2026-12-05', incomplete: false, total: 290000,
  months: [{ month: '2026-09-01', billed: 100000, toDate: false }, { month: '2026-10-01', billed: 150000, toDate: false }, { month: '2026-11-01', billed: 0, toDate: false }, { month: '2026-12-01', billed: 40000, toDate: true }], ...o });
const perMonth = (m: WorkOrderBilledMonths | undefined, extra: Partial<{ isPending: boolean; isError: boolean }> = {}) =>
  ({ months: m, isPending: false, isError: false, onRetry: vi.fn(), ...extra });
const base = { acceptances: [], acceptancesPending: false, acceptancesError: false, onRetryAcceptances: vi.fn() };

beforeEach(() => setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }));

describe('BillingSection: billed per month (AC-BPM-005..007)', () => {
  it('AC-BPM-005 lists each month newest first with its billed amount, the current month marked to date, and the total', () => {
    render(<BillingSection billing={billing()} perMonth={perMonth(months())} {...base} />);
    const items = within(screen.getByTestId('billed-per-month')).getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual(['billed-month-2026-12', 'billed-month-2026-11', 'billed-month-2026-10', 'billed-month-2026-09']);
    expect(items[0].textContent).toContain('Dec 2026');
    expect(items[0].textContent).toContain('to date');
    expect(items[0].textContent).toContain(formatCurrency(40000, 'USD'));
    expect(items[1].textContent).toContain(formatCurrency(0, 'USD'));
    expect(items[3].textContent).toContain(formatCurrency(100000, 'USD'));
    expect(screen.getByTestId('billed-per-month-total').textContent).toContain(formatCurrency(290000, 'USD'));
  });
  it('AC-BPM-005 says the figure counts submitted invoices only', () => {
    render(<BillingSection billing={billing()} perMonth={perMonth(months())} {...base} />);
    expect(screen.getByTestId('billing-help').textContent).toMatch(/submitted invoices only, excluding tax/);
    expect(screen.getByTestId('billed-per-month-block').textContent).not.toMatch(/submitted invoices only/);
  });
  it('AC-BPM-005 a work order that cannot be totalled says so and shows no figure', () => {
    render(<BillingSection billing={billing()} perMonth={perMonth(months({ incomplete: true, months: [], total: 0 }))} {...base} />);
    expect(screen.getByTestId('billed-per-month-incomplete')).toBeTruthy();
    expect(screen.queryByTestId('billed-per-month')).toBeNull();
  });
  it('AC-BPM-006 nothing billed says so, not a zero', () => {
    render(<BillingSection billing={billing()} perMonth={perMonth(months({ months: [], total: 0 }))} {...base} />);
    expect(screen.getByText('No submitted invoice yet.')).toBeTruthy();
    expect(screen.queryByTestId('billed-per-month')).toBeNull();
  });
  it('AC-BPM-006 a failed read shows its own error with retry', () => {
    const pm = perMonth(undefined, { isError: true });
    render(<BillingSection billing={billing()} perMonth={pm} {...base} />);
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(pm.onRetry).toHaveBeenCalled();
    expect(screen.queryByTestId('billed-per-month')).toBeNull();
  });
  it('AC-BPM-006 a caller who may not see billing gets no per-month block', () => {
    render(<BillingSection billing={null} perMonth={null} {...base} />);
    expect(screen.queryByTestId('billed-per-month-block')).toBeNull();
  });
  it('AC-BPM-007 reads in Bahasa Indonesia', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    const i18n = createInstance();
    void i18n.init({ lng: 'id', fallbackLng: 'en', defaultNS: 'workOrders', ns: ['workOrders'], initImmediate: false, interpolation: { escapeValue: false },
      resources: { en: { workOrders: enWo }, id: { workOrders: idWo } } });
    render(<I18nextProvider i18n={i18n}><BillingSection billing={billing()} perMonth={perMonth(months())} {...base} /></I18nextProvider>);
    const t = screen.getByTestId('billed-per-month-block').textContent ?? '';
    expect(t).toContain('Ditagih per bulan');
    expect(screen.getByTestId('billing-help').textContent).toContain('invoice yang sudah diajukan');
    expect(t).toContain('sampai hari ini');
    expect(t).not.toMatch(/submitted invoices/);
  });
});
