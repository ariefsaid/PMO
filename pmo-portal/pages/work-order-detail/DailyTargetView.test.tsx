import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import idRp from '../../public/locales/id/workOrderRevenuePlan.json';
import enRp from '../../public/locales/en/workOrderRevenuePlan.json';
import { formatTableMoney } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import type { DailyTarget, DailyTargetDay } from '@/src/lib/dailyTarget';
import { buildCostView } from '@/src/lib/workOrderCostView';
import type { CostSource, WorkOrderCostLine } from '@/src/lib/db/workOrderCosts';
import { DailyTargetView } from './DailyTargetView';

const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, asked: [] as unknown[] }));
vi.mock('@/src/hooks/useWorkOrderDailyTarget', () => ({
  useWorkOrderDailyTarget: (...args: unknown[]) => { state.asked.push(args); return state.query; },
}));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-12-03' }));
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const day = (extra: Partial<DailyTargetDay>): DailyTargetDay => ({ date: '2026-12-01', working: true, listed: false, nonWorkingLabel: null, hasTarget: true, target: '100.00', actual: '80.00', gap: '-20.00', pendingReports: 0, ...extra });
const target = (extra: Partial<DailyTarget> = {}): DailyTarget => ({
  workOrderId: 'w', currency: 'IDR', asOf: '2026-12-03', month: '2026-12-01', hasTarget: true, monthTarget: '230.00', mtdTarget: '200.00', mtdActual: '80.00', mtdGap: '-120.00',
  elapsedWorkingDays: 3, remainingWorkingDays: 19, projection: '613.33', projectedGap: '383.33',
  days: [day({}), day({ date: '2026-12-02', actual: '0.00', gap: '-100.00', pendingReports: 1 }), day({ date: '2026-12-25', working: false, listed: true, nonWorkingLabel: 'Holiday', target: '30.00', actual: '0.00', gap: '-30.00' })], ...extra,
});
const ok = (d: DailyTarget | null) => ({ data: d, isPending: false, isError: false, error: null, refetch: vi.fn() });
// Read-only money shows whole units through the shared table formatter.
const money = (v: string) => formatTableMoney(v, 'IDR');

beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); state.asked = []; });

describe('DailyTargetView (#2672)', () => {
  it('AC-WDT-014 keeps target to date available in the work-order month view for comparison with the project', () => {
    state.query = ok(target());
    render(<DailyTargetView workOrderId="w" monthOnly />);
    expect(screen.getByTestId('wo-daily-mtd-target').textContent).toBe(money('200.00'));
  });
  it('shows target to date, actual to date, the gap in words and the projection', () => {
    state.query = ok(target());
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-daily-mtd-target').textContent).toBe(money('200.00'));
    expect(screen.getByTestId('wo-daily-mtd-actual').textContent).toBe(money('80.00'));
    expect(screen.getByTestId('wo-daily-row-2026-12-01').textContent).toContain(money('20.00') + ' behind target');
    expect(screen.getByTestId('wo-daily-mtd-gap').textContent).toBe(`${money('120.00')} behind target`);
    expect(screen.getByTestId('wo-daily-projection').textContent).toBe(money('613.33'));
    expect(screen.getByTestId('wo-daily-projected-gap').textContent).toContain('ahead of target');
  });
  it('explains an ahead or on-target daily gap in words', () => {
    state.query = ok(target({ days: [day({ gap: '20.00' }), day({ date: '2026-12-02', gap: '0.00' })] }));
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-daily-row-2026-12-01').textContent).toContain(money('20.00') + ' ahead of target');
    expect(screen.getByTestId('wo-daily-row-2026-12-02').textContent).toContain('On target');
  });
  it('AC-WDT-007 a null projection reads "not enough working days", never 0', () => {
    state.query = ok(target({ projection: null, projectedGap: null }));
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-daily-projection').textContent).toBe('Not enough working days yet');
    expect(screen.queryByTestId('wo-daily-projected-gap')).toBeNull();
  });
  it('AC-WDT-006 names reports not yet validated apart from actual', () => {
    state.query = ok(target());
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-daily-pending')).toBeTruthy();
    expect(screen.getByTestId('wo-daily-row-2026-12-02').textContent).toContain('1 not yet validated');
  });
  it('AC-WDT-008 a month with no target says "No target entered", not a zero gap', () => {
    state.query = ok(target({ hasTarget: false, mtdTarget: '0.00', mtdGap: '80.00', monthTarget: '0.00', days: [day({ hasTarget: false, target: '0.00', gap: '80.00' })] }));
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-daily-mtd-target').textContent).toBe('No target entered');
    expect(screen.getByTestId('wo-daily-mtd-gap').textContent).toBe('No target entered');
  });
  it('#1126 a month with no target and no actual says so once and offers the one fix, with no chart and no rows of zeros', async () => {
    state.query = ok(target({ hasTarget: false, mtdTarget: '0.00', mtdActual: '0.00', mtdGap: '0.00', monthTarget: '0.00', projection: null, projectedGap: null,
      days: [day({ hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00' }), day({ date: '2026-12-02', hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00' })] }));
    render(<DailyTargetView workOrderId="w" plan={{ woLabel: 'WO-1' }} />);
    expect(screen.getByTestId('wo-daily-empty').textContent).toContain('No target and no actual in Dec 2026');
    expect(screen.queryByTestId('wo-daily-chart')).toBeNull();
    expect(screen.queryByTestId('wo-daily-table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enter plan' })).toBeTruthy();
  });
  it('#1126 the empty month offers no entry to a reader who may not plan', () => {
    state.query = ok(target({ hasTarget: false, mtdActual: '0.00', days: [day({ hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00' })] }));
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-daily-empty')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enter plan' })).toBeNull();
  });
  it('#1126 two blocks: the month against its target, then each day; a day with nothing on it gets no row, only a count', () => {
    state.query = ok(target({ days: [day({}), day({ date: '2026-12-02', hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00' }), day({ date: '2026-12-03', hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00' })] }));
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByRole('region', { name: 'Daily target' })).toContainElement(screen.getByTestId('wo-daily-mtd-target'));
    expect(screen.getByRole('region', { name: 'Each day' })).toContainElement(screen.getByTestId('wo-daily-row-2026-12-01'));
    expect(screen.queryByTestId('wo-daily-row-2026-12-02')).toBeNull();
    expect(screen.getByTestId('wo-daily-quiet').textContent).toBe('2 days with nothing on them');
  });
  it('AC-WDT-009 a refused caller sees "restricted", never a zero', () => {
    state.query = { data: undefined, isPending: false, isError: true, error: { code: '42501' }, refetch: vi.fn() };
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByText('The revenue plan is restricted for your role.')).toBeTruthy();
    expect(screen.queryByTestId('wo-daily-mtd-actual')).toBeNull();
  });
  it('AC-WDT-012 a target on a listed date carries a non-working marker and its amount', () => {
    state.query = ok(target());
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-daily-nonworking-2026-12-25').textContent).toBe('Non-working day: Holiday');
    expect(screen.getByTestId('wo-daily-row-2026-12-25').textContent).toContain(money('30.00') as string);
  });
  it('browses months: the current month asks for today (null), the previous month for its last day', async () => {
    state.query = ok(target());
    render(<DailyTargetView workOrderId="w" />);
    expect(state.asked.at(-1)).toEqual(['w', null]);
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(state.asked.at(-1)).toEqual(['w', '2026-11-30']);
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(state.asked.at(-1)).toEqual(['w', '2027-01-01']);
  });
  it('shows loading and error states', () => {
    state.query = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    const { unmount } = render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByTestId('wo-page-daily-target')).toBeTruthy();
    unmount();
    state.query = { data: undefined, isPending: false, isError: true, error: { code: 'XX' }, refetch: vi.fn() };
    render(<DailyTargetView workOrderId="w" />);
    expect(screen.getByText("Couldn't load the daily target")).toBeTruthy();
  });
  it('AC-WDT-013 renders Bahasa Indonesia strings', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    const i18n = createInstance();
    void i18n.init({ lng: 'id', fallbackLng: 'en', defaultNS: 'workOrderRevenuePlan', ns: ['workOrderRevenuePlan'], initImmediate: false, interpolation: { escapeValue: false },
      resources: { id: { workOrderRevenuePlan: idRp }, en: { workOrderRevenuePlan: enRp } }, react: { useSuspense: false } });
    state.query = ok(target());
    render(<I18nextProvider i18n={i18n}><DailyTargetView workOrderId="w" /></I18nextProvider>);
    expect(screen.getAllByText('Target sampai hari ini').length).toBeGreaterThan(0);
    expect(screen.getByTestId('wo-daily-mtd-gap').textContent).toMatch(/di bawah target/);
    expect(screen.getByTestId('wo-daily-row-2026-12-01').textContent).toContain(idRp.daily.behind.replace('{{amount}}', money('20.00')!));
    expect(screen.getByTestId('wo-daily-nonworking-2026-12-25').textContent).toBe('Hari tidak kerja: Holiday');
  });
  it('AC-WDT-013 every English key has an Indonesian translation', () => {
    const keys = (o: Record<string, unknown>, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(idRp).sort()).toEqual(keys(enRp).sort());
  });

  describe('#1126 cost beside revenue per day', () => {
    const line = (source: CostSource, id: string, occurredOn: string | null): WorkOrderCostLine => ({ source, recordId: id, projectId: 'p', workOrderId: 'w', disciplineId: null, occurredOn, reference: id, quantity: null, quantityUnit: null });
    const idr = (amount: number) => ({ amount, currency: 'IDR' });
    const groups = buildCostView(
      [line('equipment_usage', 'e1', '2026-12-01'), line('stock_document', 's1', '2026-12-01'), line('expense_claim', 'c1', '2026-12-02'), line('equipment_usage', 'e2', null), line('stock_document', 's2', '2026-11-30')],
      { equipment_usage: { e1: idr(30), e2: idr(5.5) }, stock_document: { s1: idr(20), s2: idr(99) }, expense_claim: { c1: idr(7) } },
    );
    it('shows each day\'s cost by kind, its total and revenue less cost, from the cost list\'s own figures', () => {
      state.query = ok(target());
      render(<DailyTargetView workOrderId="w" costGroups={groups} />);
      expect(screen.getByTestId('wo-daily-cost-equipment-2026-12-01').textContent).toBe(money('30.00'));
      expect(screen.getByTestId('wo-daily-cost-material-2026-12-01').textContent).toBe(money('20.00'));
      expect(screen.getByTestId('wo-daily-cost-total-2026-12-01').textContent).toBe(money('50.00'));
      expect(screen.getByTestId('wo-daily-cost-net-2026-12-01').textContent).toBe(money('30.00'));
      expect(screen.getByTestId('wo-daily-cost-net-2026-12-02').textContent).toBe(money('-7.00'));
      expect(screen.queryByTestId('wo-daily-cost-total-2026-11-30')).toBeNull();
      expect(screen.queryByText('Labour')).toBeNull();
      // Beside the revenue of the same row, not in a second table.
      expect(screen.getByTestId('wo-daily-row-2026-12-01').contains(screen.getByTestId('wo-daily-cost-net-2026-12-01'))).toBe(true);
    });
    it('a day with cost stays on the table even when it is a non-working day with no revenue', () => {
      state.query = ok(target({ days: [day({ date: '2026-12-06', working: false, hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00' })] }));
      render(<DailyTargetView workOrderId="w" costGroups={buildCostView([line('expense_claim', 'c9', '2026-12-06')], { expense_claim: { c9: idr(12) } })} />);
      expect(screen.getByTestId('wo-daily-cost-net-2026-12-06').textContent).toBe(money('-12.00'));
    });
    it('a cost with no day is named apart and spread over no day', () => {
      state.query = ok(target());
      render(<DailyTargetView workOrderId="w" costGroups={groups} />);
      expect(screen.getByTestId('wo-daily-cost-undated').textContent).toBe(`Not dated to a day: ${money('5.50')}`);
    });
    it('a caller who cannot read any cost amount sees revenue and target only', () => {
      state.query = ok(target());
      render(<DailyTargetView workOrderId="w" costGroups={buildCostView(groups.flatMap((g) => g.lines), { equipment_usage: null, stock_document: null, expense_claim: null })} />);
      expect(screen.queryByTestId('wo-daily-cost-total-2026-12-01')).toBeNull();
      expect(screen.queryByTestId('wo-daily-cost-undated')).toBeNull();
      expect(screen.getByTestId('wo-daily-table')).toBeTruthy();
    });
    it('a day whose only cost cannot be read here gets no row of dashes; the days are counted apart', () => {
      state.query = ok(target({ days: [day({}), day({ date: '2026-12-04', hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00' })] }));
      render(<DailyTargetView workOrderId="w" costGroups={buildCostView([line('stock_document', 's1', '2026-12-01'), line('equipment_usage', 'e4', '2026-12-04')],
        { stock_document: { s1: idr(20) }, equipment_usage: { e4: { amount: 9, currency: 'USD' } } })} />);
      expect(screen.queryByTestId('wo-daily-row-2026-12-04')).toBeNull();
      expect(screen.getByTestId('wo-daily-cost-unreadable').textContent).toBe('1 day has cost in another currency or not shown to you');
      expect(screen.getByTestId('wo-daily-cost-total-2026-12-01').textContent).toBe(money('20.00'));
    });
    it('without cost groups the view is unchanged', () => {
      state.query = ok(target());
      render(<DailyTargetView workOrderId="w" />);
      expect(screen.queryByTestId('wo-daily-cost-total-2026-12-01')).toBeNull();
    });
  });
});
