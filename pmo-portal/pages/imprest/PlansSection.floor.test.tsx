import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const mut = () => ({ mutateAsync: vi.fn().mockResolvedValue('x'), isPending: false });
const h = vi.hoisted(() => ({
  userId: 'u-auth', realRole: 'Project Manager' as string, plans: null as unknown, lines: null as unknown,
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestPlans: () => h.plans, useImprestPlanLines: () => h.lines,
  useCreatePlan: () => h.m.createPlan, useSavePlanLine: () => h.m.savePlanLine,
  useDeletePlanLine: () => h.m.deletePlanLine, useTransitionPlan: () => h.m.transitionPlan,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import { PlansSection } from './PlansSection';

const plan = (over: Record<string, unknown> = {}) => ({ id: 'pl1', float_id: 'f1', month: '2026-11-01', number: null, status: 'Draft', author_id: 'u-auth', total: 800000, is_late: false, ...over });
const page = () => {
  const tree = () => <ToastProvider><PlansSection floatId="f1" custodianId="u-cust" currency="IDR" currentMonth="2026-11-01" /></ToastProvider>;
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
};
const openLines = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Show lines' }));
  return user;
};
describe('PlansSection — floor (floor-tests/imprest-float-record.md 19, 21, 24, 26-32)', () => {
  beforeEach(() => {
    h.userId = 'u-auth'; h.realRole = 'Project Manager';
    h.plans = ok({ rows: [plan()], truncated: false });
    h.lines = ok([{ id: 'l1', plan_id: 'pl1', budget_category: 'Vehicle', planned_amount: 800000 }]);
    h.m = { createPlan: mut(), savePlanLine: mut(), deletePlanLine: mut(), transitionPlan: mut() };
  });

  it('floor: choosing Next month creates the plan for that month', async () => {
    const user = userEvent.setup();
    page();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    await waitFor(() => expect(h.m.createPlan.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', month: '2026-12-01' }));
  });

  it('floor: the plans Retry refetches and renders the plans', async () => {
    const { rerender } = page();
    h.plans = { data: undefined, isPending: false, isError: true, refetch: vi.fn(async () => { h.plans = ok({ rows: [plan()], truncated: false }); rerender(); }) };
    rerender();
    const alert = screen.getByText("Couldn't load plans").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Nov 2026')).toBeInTheDocument();
  });

  it('floor: Edit and resubmit on a rejected plan reopens it for editing', async () => {
    const user = userEvent.setup();
    h.plans = ok({ rows: [plan({ status: 'Rejected', decision_notes: 'Needs the fuel receipts' })], truncated: false });
    page();
    await user.click(screen.getByRole('button', { name: 'Edit and resubmit' }));
    await waitFor(() => expect(h.m.transitionPlan.mutateAsync).toHaveBeenCalledWith({ id: 'pl1', to: 'Draft' }));
  });

  it('floor: Reject confirmed moves a Submitted plan to Rejected', async () => {
    const user = userEvent.setup();
    h.userId = 'u-other'; h.realRole = 'Finance';
    h.plans = ok({ rows: [plan({ status: 'Submitted' })], truncated: false });
    page();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(h.m.transitionPlan.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.m.transitionPlan.mutateAsync).toHaveBeenCalledWith({ id: 'pl1', to: 'Rejected' }));
  });

  it('floor: Cancel confirmed moves a Draft plan to Cancelled', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.m.transitionPlan.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('alertdialog')).getAllByRole('button', { name: 'Cancel' })[1]);
    await waitFor(() => expect(h.m.transitionPlan.mutateAsync).toHaveBeenCalledWith({ id: 'pl1', to: 'Cancelled' }));
  });

  it('floor: Remove on a plan line deletes that line', async () => {
    page();
    const user = await openLines();
    await user.click(screen.getByRole('button', { name: 'Remove Vehicle' }));
    await waitFor(() => expect(h.m.deletePlanLine.mutateAsync).toHaveBeenCalledWith('l1'));
  });

  it('floor: the add-line category select decides the line category', async () => {
    page();
    const user = await openLines();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Budget category' }), 'Materials');
    await user.type(screen.getByRole('textbox', { name: 'Planned amount' }), '12500');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    await waitFor(() => expect(h.m.savePlanLine.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ category: 'Materials' })));
  });

  it('floor: the planned amount field decides the line amount', async () => {
    page();
    const user = await openLines();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Budget category' }), 'Vehicle');
    await user.type(screen.getByRole('textbox', { name: 'Planned amount' }), '12500');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    await waitFor(() => expect(h.m.savePlanLine.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ amount: 12500 })));
  });

  it('floor: Save line sends the category and amount once', async () => {
    page();
    const user = await openLines();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Budget category' }), 'Vehicle');
    await user.type(screen.getByRole('textbox', { name: 'Planned amount' }), '12500');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    await waitFor(() => expect(h.m.savePlanLine.mutateAsync).toHaveBeenCalledTimes(1));
    expect(h.m.savePlanLine.mutateAsync).toHaveBeenCalledWith({ planId: 'pl1', category: 'Vehicle', amount: 12500 });
  });

  it('floor: a rejection note on the plan reaches the transition', async () => {
    const user = userEvent.setup();
    h.userId = 'u-other'; h.realRole = 'Finance';
    h.plans = ok({ rows: [plan({ status: 'Submitted' })], truncated: false });
    page();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/Note to the author/), 'Fuel receipts missing');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.m.transitionPlan.mutateAsync).toHaveBeenCalledWith({ id: 'pl1', to: 'Rejected', notes: 'Fuel receipts missing' }));
  });
});
