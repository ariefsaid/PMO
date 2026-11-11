import { describe, it, expect, vi, beforeEach } from 'vitest';
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
const renderIt = () => render(<ToastProvider><PlansSection floatId="f1" custodianId="u-cust" currency="IDR" currentMonth="2026-11-01" /></ToastProvider>);

describe('FR-IMP-071 plans section', () => {
  beforeEach(() => {
    h.userId = 'u-auth'; h.realRole = 'Project Manager';
    h.plans = ok({ rows: [plan()], truncated: false });
    h.lines = ok([{ id: 'l1', plan_id: 'pl1', budget_category: 'Vehicle', planned_amount: 800000 }]);
    h.m = { createPlan: mut(), savePlanLine: mut(), deletePlanLine: mut(), transitionPlan: mut() };
  });
  it('FR-IMP-071 the author of a Draft sees Submit plan and can create a plan', async () => {
    const user = userEvent.setup();
    renderIt();
    expect(screen.getByRole('button', { name: 'Submit plan' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    await waitFor(() => expect(h.m.createPlan.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', month: '2026-11-01' }));
  });
  it('FR-IMP-071 submitting moves the plan to Submitted', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Submit plan' }));
    await waitFor(() => expect(h.m.transitionPlan.mutateAsync).toHaveBeenCalledWith({ id: 'pl1', to: 'Submitted' }));
  });
  it('FR-IMP-071 a Draft plan\'s author edits lines; anyone else sees them read-only', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Show lines' }));
    expect(screen.getByRole('button', { name: 'Remove Vehicle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save line' })).toBeInTheDocument();
  });
  it('FR-IMP-071 a Submitted plan is read-only for its author', async () => {
    const user = userEvent.setup();
    h.plans = ok({ rows: [plan({ status: 'Submitted' })], truncated: false });
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Show lines' }));
    expect(screen.queryByRole('button', { name: 'Save line' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit plan' })).toBeNull();
  });
  it('FR-IMP-071 another approver decides a Submitted plan after a confirm; the custodian cannot', async () => {
    const user = userEvent.setup();
    h.userId = 'u-other'; h.realRole = 'Finance';
    h.plans = ok({ rows: [plan({ status: 'Submitted' })], truncated: false });
    const { unmount } = renderIt();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(h.m.transitionPlan.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.m.transitionPlan.mutateAsync).toHaveBeenCalledWith({ id: 'pl1', to: 'Approved' }));
    unmount();
    h.userId = 'u-cust';
    renderIt();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
  it('FR-IMP-071 a failed plans read shows an error, not an empty list', () => {
    h.plans = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText("Couldn't load plans")).toBeInTheDocument();
  });
});
