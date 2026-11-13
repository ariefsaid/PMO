import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const mut = () => ({ mutateAsync: vi.fn().mockResolvedValue('x'), isPending: false });
const h = vi.hoisted(() => ({
  userId: 'u-fin', realRole: 'Finance' as string,
  floats: null as unknown, position: null as unknown, plans: null as unknown, planLines: null as unknown,
  reps: null as unknown, counts: null as unknown, claims: null as unknown, postings: null as unknown,
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
vi.mock('./imprest/FloatAmountSection', () => ({ FloatAmountSection: () => null }));
vi.mock('./imprest/CashAccountSection', () => ({ CashAccountSection: () => null }));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloat: () => h.floats,
  useImprestPosition: () => h.position,
  useImprestPlans: () => h.plans,
  useImprestPlanLines: () => h.planLines,
  useImprestReplenishments: () => h.reps,
  useImprestCounts: () => h.counts,
  useImprestFloatClaims: () => h.claims,
  useImprestPostingStates: () => h.postings,
  useCreatePlan: () => h.m.createPlan,
  useSavePlanLine: () => h.m.savePlanLine,
  useDeletePlanLine: () => h.m.deletePlanLine,
  useTransitionPlan: () => h.m.transitionPlan,
  useRequestReplenishment: () => h.m.requestReplenishment,
  useTransitionReplenishment: () => h.m.transitionReplenishment,
  useRecordCount: () => h.m.recordCount,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole as Role, effectiveRole: h.realRole as Role }) }));

import ImprestFloatDetail from './ImprestFloatDetail';

const FLOAT = { id: 'f1', project_id: 'p1', custodian_id: 'u-cust', currency: 'IDR', float_amount: 5000000, project: { name: 'Site Alpha' }, custodian: { full_name: 'Cass Custodian' } };
const POSITION = {
  float_id: 'f1', float_amount: 5000000, cash_book: 1000000, advances_out: 500000, receipts_waiting: 3500000, replenishment_in_flight: 0,
  gap: 0, funded_total: 5000000, last_count_at: null, last_count_variance: null, month: '2026-11-01', plan_lines: [],
};
const REP = { id: 'r1', number: 'REP-1', kind: 'replenishment', amount: 3500000, status: 'Requested', requested_by: 'u-cust', approved_by: null, requested_at: '2026-11-02T00:00:00Z', float_id: 'f1' };
const setViewer = (userId: string, role: string) => { h.userId = userId; h.realRole = role; };
const RouteName = ({ kind }: { kind: 'expense' | 'imprest' }) => {
  const { claimId, floatId } = useParams();
  return <p>{kind === 'expense' ? `Expense record ${claimId}` : `Float record ${floatId}`}</p>;
};
const page = () => {
  const tree = () => (
    <MemoryRouter initialEntries={['/imprest/f1']}><ToastProvider><Routes>
      <Route path="/imprest/:floatId" element={<ImprestFloatDetail />} />
      <Route path="/imprest" element={<p>Site cash list</p>} />
      <Route path="/expenses/:claimId" element={<RouteName kind="expense" />} />
    </Routes></ToastProvider></MemoryRouter>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
};

describe('ImprestFloatDetail — floor (floor-tests/imprest-float-record.md)', () => {
  beforeEach(() => {
    setViewer('u-fin', 'Finance');
    h.floats = ok(FLOAT);
    h.position = ok(POSITION);
    h.plans = ok({ rows: [], truncated: false });
    h.planLines = ok([]);
    h.reps = ok({ rows: [REP], truncated: false });
    h.counts = ok({ rows: [], truncated: false });
    h.claims = ok({ rows: [], truncated: false });
    h.postings = ok({ rows: [], truncated: false });
    h.m = { createPlan: mut(), savePlanLine: mut(), deletePlanLine: mut(), transitionPlan: mut(), requestReplenishment: mut(), transitionReplenishment: mut(), recordCount: mut() };
  });

  it('floor: the phone Back bar opens the Site cash list', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Back to Site cash' }));
    expect(screen.getByText('Site cash list')).toBeInTheDocument();
  });

  it('floor: the float read Retry shows the float header after refetch', async () => {
    const view = page();
    h.floats = { data: undefined, isPending: false, isError: true, refetch: vi.fn(async () => { h.floats = ok(FLOAT); view.rerender(); }) };
    view.rerender();
    const alert = screen.getByText("Couldn't load this float").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: /Float f1 · Site Alpha/ })).toBeInTheDocument();
  });

  it('floor: Request funding confirmed sends the funding request once', async () => {
    const user = userEvent.setup();
    setViewer('u-cust', 'Finance');
    h.position = ok({ ...POSITION, cash_book: 0, advances_out: 0, receipts_waiting: 0, gap: 5000000, funded_total: 0 });
    h.reps = ok({ rows: [], truncated: false });
    page();
    await user.click(screen.getByRole('button', { name: 'Request funding' }));
    const dialog = await screen.findByRole('dialog');
    expect(h.m.requestReplenishment.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Request funding' }));
    await waitFor(() => expect(h.m.requestReplenishment.mutateAsync).toHaveBeenCalledTimes(1));
    expect(h.m.requestReplenishment.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', kind: 'funding' });
  });

  it('floor: a plan exception link opens that expense record', async () => {
    h.position = ok({ ...POSITION, plan_lines: [
      { budget_category: 'Materials', planned: 0, drawn: 700000, remaining: 0, exceptions: [{ id: 'c9', number: 'EXP-9', kind: 'claim', amount: '700000.00', status: 'Approved' }] },
    ] });
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('link', { name: 'EXP-9' }));
    expect(screen.getByText('Expense record c9')).toBeInTheDocument();
  });

  it('floor: a receipt link opens that expense record', async () => {
    h.claims = ok({ rows: [{ id: 'c1', claim_number: 'EXP-1', kind: 'claim', title: 'Fuel', amount: 100000, status: 'Paid', is_plan_exception: false, currency: 'IDR' }], truncated: false });
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('link', { name: 'EXP-1' }));
    expect(screen.getByText('Expense record c1')).toBeInTheDocument();
  });

  it('floor: the replenishments Retry shows its rows after refetch', async () => {
    const view = page();
    h.reps = { data: undefined, isPending: false, isError: true, refetch: vi.fn(async () => { h.reps = ok({ rows: [REP], truncated: false }); view.rerender(); }) };
    view.rerender();
    const alert = screen.getByText("Couldn't load replenishments").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('row', { name: /REP-1/ })).toBeInTheDocument();
  });

  it('floor: Approve confirmed on a Requested replenishment targets Approved', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.m.transitionReplenishment.mutateAsync).toHaveBeenCalledWith({ id: 'r1', to: 'Approved' }));
  });

  it('floor: rejecting a replenishment records its reason', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/reason/i), 'Attach receipts first');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.m.transitionReplenishment.mutateAsync).toHaveBeenCalledWith({ id: 'r1', to: 'Rejected', notes: 'Attach receipts first' }));
  });

  it('floor: Cancel confirmed on a Requested replenishment targets Cancelled', async () => {
    const user = userEvent.setup();
    setViewer('u-cust', 'Finance');
    page();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getAllByRole('button', { name: 'Cancel' })[1]);
    await waitFor(() => expect(h.m.transitionReplenishment.mutateAsync).toHaveBeenCalledWith({ id: 'r1', to: 'Cancelled' }));
  });
});
