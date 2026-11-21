import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppError } from '@/src/lib/appError';
import type { ClaimBillingTrace } from '@/src/lib/db/billingStages';

const h = vi.hoisted(() => ({ role: 'Project Manager' as string, trace: null as unknown, skip: vi.fn() }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useBillingStages', () => ({
  useClaimBillingTrace: () => ({ data: h.trace, isPending: false, isError: false, refetch: vi.fn() }),
  useBillingStageMutations: () => ({
    attachDocument: { mutateAsync: vi.fn(), isPending: false },
    completeStage: { mutateAsync: vi.fn(), isPending: false },
    skipStage: { mutateAsync: h.skip, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('../RetentionReleases', () => ({ RetentionReleases: () => null }));
import { ClaimBillingStages } from '../ClaimBillingStages';

// Stage 1 completed; stage 2 (optional, target 5) current since 1 March, so 12 days old on 13 March; stage 3 waiting.
function trace(skipped = false): ClaimBillingTrace {
  return {
    stages: [
      { id: 's1', position: 1, name: 'Measure', clientSide: false, targetDays: 10, optional: false, startedOn: '2026-02-20', completedOn: '2026-03-01',
        skippedOn: null, skippedReason: null, clientReference: null, note: null, documents: [] },
      { id: 's2', position: 2, name: 'Review', clientSide: false, targetDays: 5, optional: true, startedOn: '2026-03-01', completedOn: null,
        skippedOn: skipped ? '2026-03-13' : null, skippedReason: skipped ? 'Not applicable to this claim' : null, clientReference: null, note: null,
        documents: [{ id: 'i1', position: 1, name: 'Review minutes', required: true, documentId: null }] },
      { id: 's3', position: 3, name: 'Approve', clientSide: false, targetDays: null, optional: false, startedOn: skipped ? '2026-03-13' : null, completedOn: null,
        skippedOn: null, skippedReason: null, clientReference: null, note: null, documents: [] },
    ],
    retention: null,
    deadline: null,
  };
}

function renderIt() {
  render(<MemoryRouter><ClaimBillingStages claimId="c1" projectId="p1" currency="IDR" invoiced={false} withdrawn={false} today="2026-03-13" /></MemoryRouter>);
  return userEvent.setup();
}

beforeEach(() => { h.role = 'Project Manager'; h.trace = trace(); h.skip.mockReset().mockResolvedValue(undefined); });

describe('ClaimBillingStages target days and optional stages (#2592)', () => {
  it('AC-BSX-012 a Project Manager sees the overdue stage with its age and target, and no way to mark it not needed', () => {
    renderIt();
    const review = screen.getByRole('listitem', { name: 'Review' });
    expect(within(review).getByText(/Overdue/)).toHaveTextContent('Overdue · 12 days, target 5');
    expect(within(review).queryByRole('button', { name: /not needed/i })).not.toBeInTheDocument();
  });

  it('AC-BSX-012 a stage within its target is not shown as overdue', () => {
    h.trace = { ...trace(), stages: trace().stages.map((s) => (s.id === 's2' ? { ...s, targetDays: 12 } : s)) };
    renderIt();
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it('AC-BSX-012 Finance marks the optional current stage not needed with a reason', async () => {
    h.role = 'Finance';
    const user = renderIt();
    expect(within(screen.getByRole('listitem', { name: 'Measure' })).queryByRole('button', { name: /not needed/i })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('listitem', { name: 'Review' })).getByRole('button', { name: 'Mark Review as not needed' }));
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Not applicable to this claim');
    await user.click(screen.getByRole('button', { name: 'Mark not needed' }));
    expect(h.skip).toHaveBeenCalledWith({ stageId: 's2', reason: 'Not applicable to this claim' });
  });

  it('AC-BSX-012 a refusal from the database is explained in the dialog and the dialog stays open', async () => {
    h.role = 'Admin';
    h.skip.mockRejectedValue(new AppError('refused', 'skip-reason-invalid'));
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Mark Review as not needed' }));
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Mark not needed' }));
    expect(await screen.findByText('Give a reason of 3 to 500 characters.')).toBeInTheDocument();
  });

  it('AC-BSX-012 a skipped stage shows as not needed with its reason, counts as complete, and its required item is not asked for', () => {
    h.trace = trace(true);
    renderIt();
    const review = screen.getByRole('listitem', { name: 'Review' });
    expect(within(review).getByText('Not needed 13 Mar 2026')).toBeInTheDocument();
    expect(within(review).getByText('Reason: Not applicable to this claim')).toBeInTheDocument();
    expect(within(review).getByText('Not needed')).toBeInTheDocument();
    expect(within(review).queryByText('Overdue', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('2 of 3 complete')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Approve' })).getByText('Current')).toBeInTheDocument();
  });
});
