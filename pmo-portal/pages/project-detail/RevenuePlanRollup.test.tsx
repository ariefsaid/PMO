import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatTableMoney } from '@/src/lib/format';
import type { ProjectRevenuePlan } from '@/src/lib/revenuePlan';
import RevenuePlanRollup from './RevenuePlanRollup';

const state = vi.hoisted(() => ({ enabled: true, canView: true, query: {} as Record<string, unknown> }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({
  useRevenuePlanSettings: () => ({ data: { enabled: state.enabled, workingWeekdays: [1, 2, 3, 4, 5] } }),
  useProjectRevenuePlan: () => state.query,
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.canView }));

const plan = (): ProjectRevenuePlan => ({
  asOf: '2026-12-05',
  rows: [
    { workOrderId: 'a', woNumber: 'WO-A', title: 'A', status: 'Issued', currency: 'IDR', hasPlan: true, planToDate: '800.00', actualToDate: '300.00', gap: '-500.00', planTotal: '1200.00', pendingReports: 1 },
    { workOrderId: 'n', woNumber: 'WO-N', title: 'N', status: 'Issued', currency: 'IDR', hasPlan: false, planToDate: '0.00', actualToDate: '40.00', gap: '40.00', planTotal: '0.00', pendingReports: 0 },
    { workOrderId: 'b', woNumber: 'WO-B', title: 'B', status: 'Issued', currency: 'USD', hasPlan: true, planToDate: '50.00', actualToDate: '0.00', gap: '-50.00', planTotal: '50.00', pendingReports: 0 },
  ],
  totals: [
    { currency: 'IDR', planToDate: '800.00', actualToDate: '300.00', gap: '-500.00', planTotal: '1200.00', plannedCount: 1 },
    { currency: 'USD', planToDate: '50.00', actualToDate: '0.00', gap: '-50.00', planTotal: '50.00', plannedCount: 1 },
  ],
});
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <AuthContext.Provider value={{} as AuthContextValue}><MemoryRouter><RevenuePlanRollup projectId="p" /></MemoryRouter></AuthContext.Provider>
  </QueryClientProvider>,
);
beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); state.enabled = true; state.canView = true; state.query = { data: plan(), isPending: false, isError: false, error: null, refetch: vi.fn() }; });

describe('RevenuePlanRollup (#2671)', () => {
  it('AC-WRP-001 renders nothing while the organisation switch is off, and for a role that cannot view', () => {
    state.enabled = false;
    const { container, unmount } = renderIt();
    expect(container.firstChild).toBeNull();
    unmount();
    state.enabled = true; state.canView = false;
    expect(renderIt().container.firstChild).toBeNull();
  });
  it('shows nothing outside the app providers, as when the plan is off', () => {
    expect(render(<MemoryRouter><RevenuePlanRollup projectId="p" /></MemoryRouter>).container.firstChild).toBeNull();
  });
  it('shows one row per work order with the gap in words, and no plan as "No plan entered"', () => {
    renderIt();
    expect(screen.getByTestId('revenue-plan-row-a').textContent).toContain(`${formatTableMoney('500.00', 'IDR')} behind plan`);
    expect(screen.getByTestId('revenue-plan-row-a').textContent).toContain('1 not yet validated');
    expect(screen.getByTestId('revenue-plan-row-n').textContent).toContain('No plan entered');
  });
  it('AC-WRP-010 shows one total per currency, never blended', () => {
    renderIt();
    expect(screen.getByTestId('revenue-plan-total-IDR').textContent).toContain(formatTableMoney('800.00', 'IDR'));
    expect(screen.getByTestId('revenue-plan-total-USD').textContent).toContain(formatTableMoney('50.00', 'USD'));
  });
  it('AC-WRP-009 a refused caller sees "restricted"', () => {
    state.query = { data: undefined, isPending: false, isError: true, error: { code: '42501' }, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText('The revenue plan is restricted for your role.')).toBeTruthy();
  });
});
