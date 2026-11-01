import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const mut = () => ({ mutateAsync: vi.fn().mockResolvedValue('x'), isPending: false });
const h = vi.hoisted(() => ({
  userId: 'u-fin', realRole: 'Finance' as string,
  floats: null as unknown, position: null as unknown, plans: null as unknown, planLines: null as unknown,
  reps: null as unknown, counts: null as unknown, claims: null as unknown,
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloats: () => h.floats,
  useImprestPosition: () => h.position,
  useImprestPlans: () => h.plans,
  useImprestPlanLines: () => h.planLines,
  useImprestReplenishments: () => h.reps,
  useImprestCounts: () => h.counts,
  useImprestFloatClaims: () => h.claims,
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
  gap: 0, last_count_at: '2026-10-30T00:00:00Z', last_count_variance: -5000, month: '2026-11-01',
  plan_lines: [
    { budget_category: 'Vehicle', planned: 800000, drawn: 300000, remaining: 500000, exceptions: [] },
    { budget_category: 'Materials', planned: 0, drawn: 700000, remaining: 0, exceptions: [{ id: 'c9', number: 'EXP-9', kind: 'claim', amount: '700000.00', status: 'Approved' }] },
  ],
};
const REP = { id: 'r1', number: 'REP-1', kind: 'replenishment', amount: 3500000, status: 'Requested', requested_by: 'u-cust', approved_by: null, requested_at: '2026-11-02T00:00:00Z', float_id: 'f1' };
const setViewer = (userId: string, role: string) => { h.userId = userId; h.realRole = role; };
const renderPage = () => render(
  <MemoryRouter initialEntries={['/imprest/f1']}><ToastProvider><Routes><Route path="/imprest/:floatId" element={<ImprestFloatDetail />} /></Routes></ToastProvider></MemoryRouter>,
);

describe('/imprest/:floatId (AC-IMP-082)', () => {
  beforeEach(() => {
    setViewer('u-fin', 'Finance');
    h.floats = ok({ rows: [FLOAT], truncated: false });
    h.position = ok(POSITION);
    h.plans = ok({ rows: [], truncated: false });
    h.planLines = ok([]);
    h.reps = ok({ rows: [REP], truncated: false });
    h.counts = ok({ rows: [], truncated: false });
    h.claims = ok({ rows: [], truncated: false });
    h.m = { createPlan: mut(), savePlanLine: mut(), deletePlanLine: mut(), transitionPlan: mut(), requestReplenishment: mut(), transitionReplenishment: mut(), recordCount: mut() };
  });

  it('AC-IMP-082 the detail shows the plan table with exception items marked', () => {
    renderPage();
    const vehicle = screen.getByRole('row', { name: /Vehicle/ });
    expect(within(vehicle).getByText(/800,000/)).toBeInTheDocument();
    expect(within(vehicle).getByText(/300,000/)).toBeInTheDocument();
    expect(within(vehicle).getByText(/500,000/)).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Materials/ })).getByText('Out of plan')).toBeInTheDocument();
    expect(within(vehicle).queryByText('Out of plan')).toBeNull();
  });

  it('AC-IMP-082 the custodian sees Request replenishment and not Approve', () => {
    setViewer('u-cust', 'Finance');
    renderPage();
    expect(screen.getByRole('button', { name: 'Request replenishment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('AC-IMP-082 a non-custodian Finance user sees Approve on a Requested replenishment', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request replenishment' })).toBeNull();
  });

  it('AC-IMP-082 a failed position read shows the error state, not zeros', () => {
    h.position = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("Couldn't load this float's position")).toBeInTheDocument();
    expect(screen.queryByText(/Books do not balance/)).toBeNull();
    expect(screen.queryByRole('row', { name: /Vehicle/ })).toBeNull();
  });

  it('AC-IMP-082 a non-zero gap is flagged in text', () => {
    h.position = ok({ ...POSITION, gap: 100000 });
    renderPage();
    expect(screen.getByText('Books do not balance')).toBeInTheDocument();
  });

  it('AC-IMP-082 paying a replenishment confirms and sends the payment reference', async () => {
    const user = userEvent.setup();
    h.reps = ok({ rows: [{ ...REP, status: 'Approved', approved_by: 'u-appr' }], truncated: false });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Payment reference/), 'REF-1');
    await user.click(within(dialog).getByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(h.m.transitionReplenishment.mutateAsync).toHaveBeenCalledWith({ id: 'r1', to: 'Paid', paymentReference: 'REF-1' }));
  });

  it('AC-IMP-082 requesting a replenishment confirms before sending', async () => {
    const user = userEvent.setup();
    setViewer('u-cust', 'Finance');
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Request replenishment' }));
    expect(h.m.requestReplenishment.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Request replenishment' }));
    await waitFor(() => expect(h.m.requestReplenishment.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', kind: 'replenishment' }));
  });

  it('AC-IMP-082 a count that differs from cash needs a note', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Record count' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Counted cash/), '990000');
    const confirm = within(dialog).getByRole('button', { name: 'Record count' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Note/), 'short by petty items');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(h.m.recordCount.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', counted: 990000, note: 'short by petty items' }));
  });

  it('AC-IMP-082 a settled receipt is marked replenished', () => {
    h.claims = ok({ rows: [
      { id: 'c1', claim_number: 'EXP-1', kind: 'claim', title: 'Diesel', amount: 300000, status: 'Paid', imprest_replenishment_id: 'r0', is_plan_exception: false, currency: 'IDR' },
      { id: 'c2', claim_number: 'EXP-2', kind: 'claim', title: 'Tyres', amount: 200000, status: 'Paid', imprest_replenishment_id: null, is_plan_exception: false, currency: 'IDR' },
    ], truncated: false });
    renderPage();
    expect(within(screen.getByText('EXP-1').closest('li') as HTMLElement).getByText('Replenished')).toBeInTheDocument();
    expect(within(screen.getByText('EXP-2').closest('li') as HTMLElement).getByText('Waiting')).toBeInTheDocument();
  });

  it('AC-IMP-082 a float the viewer cannot see is not found', () => {
    h.floats = ok({ rows: [], truncated: false });
    renderPage();
    expect(screen.getByText('Float not found')).toBeInTheDocument();
  });
});
