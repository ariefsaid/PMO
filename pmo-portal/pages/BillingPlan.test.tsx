import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanCandidate } from '@/src/lib/billingPlan';
import type { UnacceptedProgressCandidate } from '@/src/lib/db/billingPlan';
import type { PlanSettings } from '@/src/lib/db/billingPlan';

const state = vi.hoisted(() => ({
  query: { isPending: false, isError: false, isSuccess: true, data: { rows: [] as unknown[], truncated: false }, refetch: vi.fn() } as Record<string, unknown>,
  unaccepted: { isPending: false, isError: false, isSuccess: true, data: { rows: [] as unknown[], truncated: false }, refetch: vi.fn() } as Record<string, unknown>,
  settings: { data: { monthlyTarget: 10000, targetCurrency: 'IDR', reminderOn: false, monthTargets: [] } } as Record<string, unknown>,
  may: true,
  managementViews: true,
  unacceptedEnabled: [] as boolean[],
  mutate: vi.fn(),
}));

vi.mock('@/src/hooks/useBillingPlan', () => ({
  useBillingPlanCandidates: (projectId: string | null) => {
    if (projectId) {
      const rows = (state.query.data as { rows: PlanCandidate[] }).rows.filter((r) => r.projectId === projectId);
      return { ...state.query, data: { rows, truncated: false } };
    }
    return state.query;
  },
  useBillingUnacceptedProgress: (projectId: string | null, enabled = true) => {
    state.unacceptedEnabled.push(enabled);
    if (!enabled) return { isPending: true, isError: false, isSuccess: false, data: undefined, refetch: vi.fn() };
    if (projectId) {
      const rows = (state.unaccepted.data as { rows: UnacceptedProgressCandidate[] }).rows.filter((r) => r.projectId === projectId);
      return { ...state.unaccepted, data: { rows, truncated: false } };
    }
    return state.unaccepted;
  },
  useBillingPlanSettings: () => state.settings,
  useSaveBillingPlanSettings: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.may }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: (key: string) => key !== 'management_views' || state.managementViews }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import BillingPlan from './BillingPlan';

const line = (over: Partial<PlanCandidate> & { key: string; value: number }): PlanCandidate => ({
  kind: 'line', projectId: 'p1', projectName: 'North project', currency: 'IDR', workOrderId: 'w1', woNumber: 'WO-7', boqItemId: 'b1', itemCode: 'I-1',
  description: 'Item one', unit: 'm', earningBasis: 'unit_rate', contractQuantity: 100, acceptedQuantity: 12, claimedQuantity: 5, unclaimedQuantity: 7,
  acceptedOn: '2026-05-04', today: '2026-11-21', ...over,
});
const setRows = (rows: PlanCandidate[], truncated = false) => {
  state.query = { isPending: false, isError: false, isSuccess: true, data: { rows, truncated }, refetch: vi.fn() };
};
const setUnacceptedRows = (rows: UnacceptedProgressCandidate[], truncated = false) => {
  state.unaccepted = { isPending: false, isError: false, isSuccess: true, data: { rows, truncated }, refetch: vi.fn() };
};
const renderPlan = () => render(<MemoryRouter><BillingPlan /></MemoryRouter>);
const settings: PlanSettings = { monthlyTarget: 10000, targetCurrency: 'IDR', reminderOn: false, monthTargets: [] };

describe('BillingPlan', () => {
  beforeEach(() => { state.may = true; state.managementViews = true; state.unacceptedEnabled = []; state.mutate.mockReset(); state.settings = { data: settings }; setRows([]); setUnacceptedRows([]); });
  afterEach(() => cleanup());

  it('AC-MBP-013 groups by project, ticking updates the total against the target, and says candidates only', () => {
    setRows([
      line({ key: 'a', value: 7000 }),
      line({ key: 'b', value: 4000, boqItemId: 'b2', itemCode: 'I-2', description: 'Item two' }),
      line({ key: 'c', value: 900, projectId: 'p2', projectName: 'South project', boqItemId: 'b3', itemCode: 'I-3', description: 'Item three' }),
    ]);
    renderPlan();
    expect(screen.getByTestId('billing-plan-statement').textContent).toContain('Candidates only. Nothing here raises a claim or an invoice.');
    expect(screen.getAllByTestId('billing-plan-group')).toHaveLength(2);
    expect(screen.getByTestId('billing-plan-month').textContent).toBe('Nov 2026');
    expect(screen.getByTestId('billing-plan-picked').textContent).toMatch(/0/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Pick I-1 Item one/ }));
    expect(screen.getByTestId('billing-plan-picked').textContent).toMatch(/7[.,]000/);
    expect(screen.getByTestId('billing-plan-remaining').textContent).toMatch(/3[.,]000/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Pick I-2 Item two/ }));
    expect(screen.getByText('Above target by')).toBeTruthy();
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /claim|invoice|raise|bill/i })).toBeNull();
  });

  it('AC-MBP-011 a picked line that would pass the contract quantity warns but is never blocked', () => {
    setRows([line({ key: 'a', value: 7000, contractQuantity: 10 })]);
    renderPlan();
    expect(screen.queryByTestId('billing-plan-overclaim')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Pick I-1/ }));
    expect(screen.getByTestId('billing-plan-overclaim').textContent).toContain('Over-claimed');
    expect(screen.getByTestId('billing-plan-picked').textContent).toMatch(/7[.,]000/);
  });

  it('AC-MV-004 keeps unaccepted measured progress separate from accepted work that is not yet claimed', () => {
    setRows([line({ key: 'accepted', value: 7000, description: 'Accepted item' })]);
    setUnacceptedRows([{
      projectId: 'p1', projectName: 'North project', boqItemId: 'b2', itemCode: 'I-2', description: 'Measured item',
      unit: 'm', quantity: '8.000', today: '2026-11-21',
    }]);
    renderPlan();
    const accepted = screen.getByTestId('billing-plan-accepted-group');
    const unaccepted = screen.getByTestId('billing-plan-unaccepted-group');
    expect(within(accepted).getByRole('heading', { name: 'Progress accepted by the client, not yet claimed' })).toBeInTheDocument();
    expect(within(accepted).getByText(/Accepted item/)).toBeInTheDocument();
    expect(within(unaccepted).getByRole('heading', { name: 'Progress not yet accepted by the client' })).toBeInTheDocument();
    expect(within(unaccepted).getByText('I-2 · Measured item')).toBeInTheDocument();
    expect(within(unaccepted).getByText(/8/)).toBeInTheDocument();
  });

  it('AC-MV-006 hides the unaccepted group and disables its reads until the organisation opts in', () => {
    state.managementViews = false;
    setRows([line({ key: 'accepted', value: 7000, description: 'Accepted item' })]);
    renderPlan();
    expect(screen.getByTestId('billing-plan-accepted-group')).toBeInTheDocument();
    expect(screen.queryByTestId('billing-plan-unaccepted-group')).toBeNull();
    expect(state.unacceptedEnabled.length).toBeGreaterThan(0);
    expect(state.unacceptedEnabled.every((enabled) => enabled === false)).toBe(true);
  });

  it('AC-MBP-010 other-currency picks are listed apart and not counted', () => {
    setRows([line({ key: 'a', value: 100, currency: 'USD' })]);
    renderPlan();
    fireEvent.click(screen.getByRole('checkbox', { name: /Pick I-1/ }));
    expect(screen.getByTestId('billing-plan-other-currency').textContent).toContain('not counted toward the target');
    expect(screen.getByTestId('billing-plan-remaining').textContent).toMatch(/10[.,]000/);
  });

  it('AC-MBP-012 no target set says so', () => {
    state.settings = { data: { monthlyTarget: null, targetCurrency: null, reminderOn: false, monthTargets: [] } };
    setRows([line({ key: 'a', value: 100 })]);
    renderPlan();
    expect(screen.getByTestId('billing-plan-target').textContent).toBe('No target set');
  });

  it('AC-MBP-014 an error says the read failed, empty says nothing to show, truncation is announced', () => {
    state.query = { isPending: false, isError: true, isSuccess: false, data: undefined, refetch: vi.fn() };
    const { unmount } = renderPlan();
    expect(screen.getByText('The billing plan could not be loaded')).toBeTruthy();
    expect(screen.queryByText('No candidates to show')).toBeNull();
    unmount();
    setRows([]);
    const second = renderPlan();
    expect(screen.getByText('No candidates to show')).toBeTruthy();
    second.unmount();
    setRows([line({ key: 'a', value: 1 })], true);
    renderPlan();
    expect(screen.getByTestId('billing-plan-truncated').textContent).toContain('500');
  });

  it('AC-MBP-015 the settings control shows for those who may edit, opens the form and saves through the settings call', () => {
    setRows([line({ key: 'a', value: 100 })]);
    renderPlan();
    fireEvent.click(screen.getByTestId('billing-plan-settings-button'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(dialog).getByRole('switch'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ targetCurrency: 'IDR', reminderOn: true });
  });

  it('AC-MBP-015 a role that may not edit gets no settings control', () => {
    state.may = false;
    setRows([line({ key: 'a', value: 100 })]);
    renderPlan();
    expect(screen.queryByTestId('billing-plan-settings-button')).toBeNull();
  });
});
