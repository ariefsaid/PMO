import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BahasaProvider } from '@/test/bahasa';
import type { PlanCandidate } from '@/src/lib/billingPlan';
import type { PlanSettings } from '@/src/lib/db/billingPlan';

const state = vi.hoisted(() => ({ rows: [] as unknown[], settings: {} as unknown, may: true, mutate: vi.fn() }));

vi.mock('@/src/hooks/useBillingPlan', () => ({
  useBillingPlanCandidates: () => ({ isPending: false, isError: false, isSuccess: true, data: { rows: state.rows, truncated: false }, refetch: vi.fn() }),
  useBillingPlanSettings: () => ({ data: state.settings }),
  useSaveBillingPlanSettings: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.may }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import BillingPlan from './BillingPlan';

const line = (key: string, acceptedOn: string | null, code: string): PlanCandidate => ({
  key, kind: 'line', projectId: 'p1', projectName: 'North project', currency: 'IDR', workOrderId: 'w' + key, woNumber: 'WO-7', boqItemId: 'b' + key, itemCode: code,
  description: 'Item', unit: 'm', earningBasis: 'unit_rate', contractQuantity: 100, acceptedQuantity: 12, claimedQuantity: 5, unclaimedQuantity: 7,
  value: 7000, acceptedOn, today: '2026-11-21',
});
const base: PlanSettings = { monthlyTarget: null, targetCurrency: null, reminderOn: false, doneNotClaimedAfterDays: null, monthTargets: [] };
const renderPlan = (bahasa = false) => render(bahasa
  ? <BahasaProvider><MemoryRouter><BillingPlan /></MemoryRouter></BahasaProvider>
  : <MemoryRouter><BillingPlan /></MemoryRouter>);

describe('BillingPlan done-not-claimed age (#2675)', () => {
  beforeEach(() => {
    state.may = true; state.mutate.mockReset(); state.settings = base;
    state.rows = [line('a', '2026-11-11', 'I-1'), line('b', '2026-11-19', 'I-2'), line('c', null, 'I-3')];
  });
  afterEach(() => cleanup());

  it('AC-DNC-003 reminder off: every dated line shows its age and nothing is flagged or counted', () => {
    renderPlan();
    const ages = screen.getAllByTestId('billing-plan-age').map((e) => e.textContent);
    expect(ages).toEqual(['10 days since accepted', '2 days since accepted']);
    expect(screen.queryByTestId('billing-plan-over-limit')).toBeNull();
    expect(screen.queryByTestId('billing-plan-over-count')).toBeNull();
  });

  it('AC-DNC-003 reminder on without a limit flags nothing', () => {
    state.settings = { ...base, reminderOn: true };
    renderPlan();
    expect(screen.queryByTestId('billing-plan-over-limit')).toBeNull();
  });

  it('AC-DNC-004 reminder on with a limit: the older line is flagged with words, and the summary counts it', () => {
    state.settings = { ...base, reminderOn: true, doneNotClaimedAfterDays: 5 };
    renderPlan();
    const flagged = screen.getAllByTestId('billing-plan-over-limit');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].textContent).toBe('Over the 5-day limit');
    expect(within(screen.getAllByTestId('billing-plan-line')[0]).getByTestId('billing-plan-over-limit')).toBeTruthy();
    expect(screen.getByTestId('billing-plan-over-count').textContent).toBe('1 line is over the day limit');
    expect(screen.queryByRole('button', { name: /claim|invoice|raise|bill now/i })).toBeNull();
  });

  it('AC-DNC-005 the plan settings form no longer carries the reminder or the day limit; saving keeps the stored reminder untouched (they moved to the Billing extras module card, #2746)', () => {
    state.settings = { ...base, reminderOn: true, doneNotClaimedAfterDays: 5 };
    renderPlan();
    fireEvent.click(screen.getByTestId('billing-plan-settings-button'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('switch')).toBeNull();
    expect(within(dialog).queryByLabelText('Flag after (days)')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ reminderOn: true });
    expect(state.mutate.mock.calls[0][0]).not.toHaveProperty('afterDays');
  });

  it('AC-DNC-005 a role that may not edit has no settings control', () => {
    state.may = false;
    renderPlan();
    expect(screen.queryByTestId('billing-plan-settings-button')).toBeNull();
  });

  it('AC-DNC-005 in Bahasa Indonesia the age and the flag read as Bahasa', () => {
    state.settings = { ...base, reminderOn: true, doneNotClaimedAfterDays: 5 };
    renderPlan(true);
    expect(screen.getAllByTestId('billing-plan-age')[0].textContent).toBe('10 hari sejak diterima');
    expect(screen.getByTestId('billing-plan-over-limit').textContent).toBe('Melewati batas 5 hari');
    expect(screen.getByTestId('billing-plan-over-count').textContent).toBe('1 baris melewati batas hari');
    expect(screen.queryByText(/since accepted|Over the/)).toBeNull();
  });
});
