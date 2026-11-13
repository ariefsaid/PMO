import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { MemoryRouter, Route, Routes } from 'react-router';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const mut = () => ({ mutateAsync: vi.fn().mockResolvedValue('x'), isPending: false });
const h = vi.hoisted(() => ({
  userId: 'u-adm', role: 'Admin' as string, changes: null as unknown,
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloatChanges: () => h.changes, useDecideFloatChange: () => h.m.decide, useProposeFloatAmount: () => h.m.propose,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { FloatAmountSection } from './FloatAmountSection';

const change = (over: Record<string, unknown> = {}) => ({ id: 'c1', float_id: 'f1', proposed_amount: 5000000, proposed_by: 'u-fin', proposer: { full_name: 'Finn Finance' }, decider: null, status: 'Proposed', proposed_at: '2026-11-02T00:00:00Z', notes: null, ...over });
const page = () => {
  const tree = () => (
    <MemoryRouter initialEntries={['/float']}><Routes><Route path="/float" element={
      <ToastProvider><FloatAmountSection floatId="f1" custodianId="u-cust" currency="IDR" floatAmount={0} /></ToastProvider>
    } /></Routes></MemoryRouter>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
};

describe('FloatAmountSection — floor (floor-tests/imprest-float-record.md 11, 12, 16)', () => {
  beforeEach(() => {
    h.userId = 'u-adm'; h.role = 'Admin';
    h.changes = ok({ rows: [change()], truncated: false });
    h.m = { decide: mut(), propose: mut() };
  });

  it('floor: Reject confirmed records the proposal as rejected', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(h.m.decide.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.m.decide.mutateAsync).toHaveBeenCalledWith({ changeId: 'c1', approve: false }));
  });

  it('floor: a rejection note reaches the decision', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/Note/), 'Not the agreed rate');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.m.decide.mutateAsync).toHaveBeenCalledWith({ changeId: 'c1', approve: false, notes: 'Not the agreed rate' }));
  });

  it('floor: the float-amount history Retry refetches and renders the decided row', async () => {
    const view = page();
    h.changes = { data: undefined, isPending: false, isError: true, refetch: vi.fn(async () => {
      h.changes = ok({ rows: [change({ status: 'Approved', decider: { full_name: 'Sam Senior' } })], truncated: false });
      view.rerender();
    }) };
    view.rerender();
    const alert = screen.getByText("Couldn't load the float amount changes").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    const row = await screen.findByRole('row', { name: /5,000,000/ });
    expect(within(row).getByText(/decided by Sam Senior/)).toBeInTheDocument();
  });
});
