import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatExactMoney } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { rollupProject, type CostAmountLine, type PvaWorkOrder } from '@/src/lib/workOrderPlanVsActual';

/** #2670 (AC-LCM-001, AC-LCM-019): the labour block appears only for priced labour; nothing new otherwise. */
vi.mock('@/src/hooks/useLabourCost', () => ({
  useLabourClasses: () => ({ data: [{ id: 'direct', code: 'direct', name: 'Direct', archivedAt: null }, { id: 'guard', code: 'guard', name: 'Guard', archivedAt: null }] }),
}));
import { PlanVsActualSection } from './PlanVsActualSection';

const wo = (id: string): PvaWorkOrder => ({ id, woNumber: 'WO-1', title: 'T', status: 'Issued', currency: 'IDR', revenue: '1000000.00', revenueComplete: true });
let seq = 0;
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: `r${++seq}`, projectId: 'p1', workOrderId: 'A', disciplineId: null, occurredOn: null,
  reference: null, currency: 'IDR', amount: '0.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null, ...extra,
});
const render1 = (lines: CostAmountLine[]) => {
  const workOrders = [wo('A')];
  const d = { workOrders, plans: [], split: null, rollup: rollupProject({ workOrders, lines, plans: [], split: null, restricted: false }) };
  render(<PlanVsActualSection workOrderId="A" query={{ data: d, isPending: false, isError: false, refetch: vi.fn() }} disciplines={[]} />);
};
beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); });

describe('labour cost by class on the work-order page', () => {
  it('AC-LCM-019 shows each class with hours and cost, inside the direct cost', () => {
    render1([
      line({ source: 'timesheet_entry', labourClassId: 'direct', amount: '700000.00', quantity: 14, quantityUnit: 'hours', personId: 'u1' }),
      line({ source: 'timesheet_entry', labourClassId: 'guard', amount: '100000.00', quantity: 2, quantityUnit: 'hours', personId: 'u2' }),
    ]);
    const block = screen.getByTestId('wo-page-pva-labour');
    const direct = within(block).getByTestId('wo-page-pva-labour-direct');
    expect(within(direct).getByText('Direct')).toBeVisible();
    expect(direct.textContent).toContain('14');
    expect(direct.textContent).toContain(formatExactMoney('700000.00', 'IDR', 'en-US'));
    expect(within(block).getByTestId('wo-page-pva-labour-guard').textContent).toContain(formatExactMoney('100000.00', 'IDR', 'en-US'));
    expect(screen.getByTestId('wo-page-pva-direct').textContent).toContain(formatExactMoney('800000.00', 'IDR', 'en-US'));
  });

  it('AC-LCM-001 shows no labour block when no line is priced (existing organisations)', () => {
    render1([line({ amount: '50.00' }), line({ source: 'timesheet_entry', amount: null, reason: 'no-rate', quantity: 8, quantityUnit: 'hours' })]);
    expect(screen.queryByTestId('wo-page-pva-labour')).toBeNull();
  });
});
