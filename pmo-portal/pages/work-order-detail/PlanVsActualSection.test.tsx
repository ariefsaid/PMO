import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import idPva from '../../public/locales/id/workOrderPva.json';
import enPva from '../../public/locales/en/workOrderPva.json';
import { formatTableMoney } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { rollupProject, type CostAmountLine, type PvaWorkOrder, type PlanLine } from '@/src/lib/workOrderPlanVsActual';
import { PlanVsActualSection } from './PlanVsActualSection';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));

/** #2570 — the work-order page's plan-vs-actual panel: loading / error / restricted / empty / data (FR-WPVA-040, FR-WPVA-041). */
const wo = (id: string, n: string, extra: Partial<PvaWorkOrder> = {}): PvaWorkOrder =>
  ({ id, woNumber: n, title: `T ${n}`, status: 'Issued', currency: 'IDR', revenue: '1000.00', revenueComplete: true, ...extra });
let seq = 0;
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: `r${++seq}`, projectId: 'p1', workOrderId: null, disciplineId: null, occurredOn: null,
  reference: null, currency: 'IDR', amount: '0.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null, ...extra,
});
function data(workOrders: PvaWorkOrder[], lines: CostAmountLine[], plans: PlanLine[] = [], restricted = false) {
  return { workOrders, plans, split: null, rollup: rollupProject({ workOrders, lines, plans, split: null, restricted }) };
}
const ok = (d: ReturnType<typeof data>) => ({ data: d, isPending: false, isError: false, refetch: vi.fn() });
const discs = [{ id: 'civ', code: 'CIV', name: 'Civil' }] as never;

beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); });

describe('PlanVsActualSection', () => {
  it('AC-WPVA-016 shows this work order\'s planned and actual cost, shared share, revenue and both margins', () => {
    const d = data(
      [wo('A', 'WO-1'), wo('B', 'WO-2', { revenue: '500.00' })],
      [line({ workOrderId: 'A', amount: '600.00', disciplineId: 'civ' }), line({ workOrderId: 'B', amount: '400.00' }), line({ amount: '100.00' })],
      [{ id: 'p', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '550.00', note: null }],
    );
    render(<PlanVsActualSection workOrderId="A" query={ok(d)} disciplines={discs} />);
    // Read-only table money in whole units (docs/ux/screen-rules.md), the same as the project tab's row.
    expect(screen.getByTestId('wo-page-pva-plan-direct').textContent).toBe(formatTableMoney('550.00', 'IDR'));
    expect(screen.getByTestId('wo-page-pva-direct').textContent).toBe(formatTableMoney('600.00', 'IDR'));
    const direct = screen.getByTestId('wo-page-pva-direct').closest('tr') as HTMLElement;
    const over = within(direct).getByText(/^Over plan by/);
    expect(over.textContent).toBe('Over plan by ' + formatTableMoney('50.00', 'IDR'));
    expect(over.className).toContain('text-destructive');
    expect(screen.getByTestId('wo-page-pva-allocated').textContent).toBe(formatTableMoney('60.00', 'IDR'));
    expect(screen.getByTestId('wo-page-pva-revenue').textContent).toBe(formatTableMoney('1000.00', 'IDR'));
    expect(screen.getByTestId('wo-page-pva-direct-margin').textContent).toBe(formatTableMoney('400.00', 'IDR'));
    expect(screen.getByTestId('wo-page-pva-result').textContent).toBe(formatTableMoney('340.00', 'IDR'));
    const civ = screen.getByTestId('wo-page-pva-discipline-civ');
    expect(within(civ).getByText('Civil')).toBeTruthy();
    expect(civ.textContent).toContain(formatTableMoney('600.00', 'IDR'));
    // the other work order's figures are not shown
    expect(screen.queryByText(/WO-2/)).toBeNull();
  });
  it('shows Bahasa Indonesia labels and Indonesian-formatted money', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    const i18n = createInstance();
    void i18n.init({ lng: 'id', fallbackLng: 'en', defaultNS: 'workOrderPva', ns: ['workOrderPva'], initImmediate: false, interpolation: { escapeValue: false },
      resources: { id: { workOrderPva: idPva }, en: { workOrderPva: enPva } }, react: { useSuspense: false } });
    render(<I18nextProvider i18n={i18n}><PlanVsActualSection workOrderId="A" query={ok(data([wo('A', 'WO-1')], [line({ workOrderId: 'A', amount: '1500000.00' })]))} disciplines={discs} /></I18nextProvider>);
    expect(screen.getAllByText('Biaya langsung').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Biaya bersama').length).toBeGreaterThan(0);
    expect(screen.getByTestId('wo-page-pva-direct').textContent).toMatch(/1\.500\.000/);
  });
  it('shows a loading state', () => {
    render(<PlanVsActualSection workOrderId="A" query={{ isPending: true, isError: false, refetch: vi.fn() }} disciplines={[]} />);
    expect(screen.getByText('Plan vs actual')).toBeTruthy();
    expect(screen.queryByTestId('wo-page-pva-direct')).toBeNull();
  });
  it('shows an error with a retry that refetches', () => {
    const refetch = vi.fn();
    render(<PlanVsActualSection workOrderId="A" query={{ isPending: false, isError: true, refetch }} disciplines={[]} />);
    screen.getByRole('button', { name: /try again/i }).click();
    expect(refetch).toHaveBeenCalled();
  });
  it('AC-WPVA-009 says restricted, never a zero, for a role that cannot read the money', () => {
    render(<PlanVsActualSection workOrderId="A" query={ok(data([wo('A', 'WO-1')], [], [], true))} disciplines={[]} />);
    expect(screen.getByRole('status').textContent).toMatch(/restricted/i);
    expect(screen.queryByTestId('wo-page-pva-direct')).toBeNull();
  });
  it('shows one empty line when the work order has no figures in the read', () => {
    render(<PlanVsActualSection workOrderId="ZZ" query={ok(data([wo('A', 'WO-1')], []))} disciplines={[]} />);
    expect(screen.getByText(/No plan or actuals/)).toBeTruthy();
  });
  it('says "No plan" rather than 0 when nothing is planned, and unknown revenue as such', () => {
    render(<PlanVsActualSection workOrderId="A" query={ok(data([wo('A', 'WO-1', { revenue: null, revenueComplete: false })], [line({ workOrderId: 'A', amount: '10.00' })]))} disciplines={[]} />);
    expect(screen.getByTestId('wo-page-pva-plan-direct').textContent).toBe('No plan');
    expect(screen.getByTestId('wo-page-pva-revenue').textContent).toBe('Revenue unknown');
  });

  // Walk PC3: the plan is entered on the work order's own page, with the project tab's dialog and gate.
  it('lets a reader who may plan open the work order plan from its own page; nobody else gets the action', () => {
    const d = data([wo('A', 'WO-1'), wo('C', 'WO-3', { status: 'Cancelled' })], [line({ workOrderId: 'A', amount: '10.00' }), line({ workOrderId: 'C', amount: '5.00' })]);
    const client = new QueryClient();
    const { rerender } = render(<QueryClientProvider client={client}><PlanVsActualSection workOrderId="A" projectId="p1" query={ok(d)} disciplines={discs} /></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
    rerender(<QueryClientProvider client={client}><PlanVsActualSection workOrderId="C" projectId="p1" query={ok(d)} disciplines={discs} canPlan /></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
    rerender(<QueryClientProvider client={client}><PlanVsActualSection workOrderId="A" projectId="p1" query={ok(d)} disciplines={discs} canPlan /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByRole('dialog', { name: /Plan for WO-1/ })).toBeInTheDocument();
  });
});
