import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatTableMoney } from '@/src/lib/format';
import type { ProjectDailyTarget } from '@/src/lib/dailyTarget';
import DailyTargetRollup from './DailyTargetRollup';

const state = vi.hoisted(() => ({ enabled: true, canView: true, query: {} as Record<string, unknown> }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({ useRevenuePlanSettings: () => ({ data: { enabled: state.enabled, workingWeekdays: [1, 2, 3, 4, 5] } }) }));
vi.mock('@/src/hooks/useWorkOrderDailyTarget', () => ({ useProjectDailyTarget: () => state.query }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.canView }));

const data = (): ProjectDailyTarget => ({
  asOf: '2026-12-03',
  rows: [
    { workOrderId: 'a', woNumber: 'WO-A', title: 'A', status: 'Issued', currency: 'IDR', hasTarget: true, monthTarget: '230.00', mtdTarget: '200.00', mtdActual: '80.00', mtdGap: '-120.00', projection: '613.33', projectedGap: '383.33' },
    { workOrderId: 'n', woNumber: 'WO-N', title: 'N', status: 'Issued', currency: 'IDR', hasTarget: false, monthTarget: '0.00', mtdTarget: '0.00', mtdActual: '0.00', mtdGap: '0.00', projection: null, projectedGap: null },
    { workOrderId: 'b', woNumber: 'WO-B', title: 'B', status: 'Issued', currency: 'USD', hasTarget: true, monthTarget: '50.00', mtdTarget: '50.00', mtdActual: '0.00', mtdGap: '-50.00', projection: '0.00', projectedGap: '-50.00' },
  ],
  totals: [
    { currency: 'IDR', monthTarget: '230.00', mtdTarget: '200.00', mtdActual: '80.00', mtdGap: '-120.00', projection: '613.33', targetedCount: 1 },
    { currency: 'USD', monthTarget: '50.00', mtdTarget: '50.00', mtdActual: '0.00', mtdGap: '-50.00', projection: '0.00', targetedCount: 1 },
  ],
});
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <AuthContext.Provider value={{} as AuthContextValue}><MemoryRouter><DailyTargetRollup projectId="p" /></MemoryRouter></AuthContext.Provider>
  </QueryClientProvider>,
);
beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); state.enabled = true; state.canView = true; state.query = { data: data(), isPending: false, isError: false, error: null, refetch: vi.fn() }; });

describe('DailyTargetRollup (#2672)', () => {
  it('AC-WDT-001 renders nothing while the switch is off, and for a role that cannot view', () => {
    state.enabled = false;
    expect(renderIt().container.firstChild).toBeNull();
  });
  it('renders nothing for a role that cannot view', () => {
    state.canView = false;
    expect(renderIt().container.firstChild).toBeNull();
  });
  it('AC-WDT-010 shows one total per currency, never blended', () => {
    renderIt();
    expect(screen.getByTestId('daily-target-total-IDR').textContent).toContain(formatTableMoney('200.00', 'IDR') as string);
    expect(screen.getByTestId('daily-target-total-USD').textContent).toContain(formatTableMoney('50.00', 'USD') as string);
    expect(screen.getByTestId('daily-target-total-IDR').textContent).toContain('behind target');
  });
  it('AC-WDT-008 a work order with no target says so, and a null projection reads "not enough days"', () => {
    renderIt();
    expect(screen.getByTestId('daily-target-row-n').textContent).toContain('No target entered');
    expect(screen.getByTestId('daily-target-row-n').textContent).toContain('Not enough days yet');
  });
  it('AC-WDT-009 a refused caller sees "restricted", never a zero', () => {
    state.query = { data: undefined, isPending: false, isError: true, error: { code: '42501' }, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText('The revenue plan is restricted for your role.')).toBeTruthy();
  });
});
