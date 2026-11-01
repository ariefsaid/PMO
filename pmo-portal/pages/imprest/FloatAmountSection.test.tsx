import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

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

const change = (over: Record<string, unknown> = {}) => ({ id: 'c1', float_id: 'f1', proposed_amount: 5000000, proposed_by: 'u-fin', status: 'Proposed', proposed_at: '2026-11-02T00:00:00Z', notes: null, ...over });
const renderIt = () => render(<ToastProvider><FloatAmountSection floatId="f1" custodianId="u-cust" currency="IDR" floatAmount={0} /></ToastProvider>);

describe('FR-IMP-002 float amount', () => {
  beforeEach(() => {
    h.userId = 'u-adm'; h.role = 'Admin';
    h.changes = ok({ rows: [change()], truncated: false });
    h.m = { decide: mut(), propose: mut() };
  });

  it('FR-IMP-002 an approver other than the proposer approves the proposed amount after a confirm', async () => {
    const user = userEvent.setup();
    renderIt();
    expect(screen.getByText(/awaiting a senior approver/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(h.m.decide.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.m.decide.mutateAsync).toHaveBeenCalledWith({ changeId: 'c1', approve: true }));
  });

  it('FR-IMP-002 the proposer and the custodian cannot decide their own amount', () => {
    h.userId = 'u-fin'; h.role = 'Finance';
    const { unmount } = renderIt();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    unmount();
    h.userId = 'u-cust'; h.role = 'Project Manager';
    renderIt();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('FR-IMP-002 Admin or Finance proposes a new amount only when none is open', async () => {
    const user = userEvent.setup();
    h.changes = ok({ rows: [change({ status: 'Approved' })], truncated: false });
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Propose new amount' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/New float amount/), '6000000');
    await user.click(within(dialog).getByRole('button', { name: 'Propose amount' }));
    await waitFor(() => expect(h.m.propose.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', amount: 6000000 }));
  });

  it('FR-IMP-002 no propose button while a change is open or for a non-setup role', () => {
    const { unmount } = renderIt();
    expect(screen.queryByRole('button', { name: 'Propose new amount' })).toBeNull();
    unmount();
    h.changes = ok({ rows: [], truncated: false });
    h.role = 'Executive';
    renderIt();
    expect(screen.queryByRole('button', { name: 'Propose new amount' })).toBeNull();
  });

  it('FR-IMP-002 a failed read shows an error, not a missing amount', () => {
    h.changes = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText("Couldn't load the float amount changes")).toBeInTheDocument();
  });
});
