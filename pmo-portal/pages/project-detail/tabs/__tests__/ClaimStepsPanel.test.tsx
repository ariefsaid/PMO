import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppError } from '@/src/lib/appError';
import type { ClaimBillingStage } from '@/src/lib/db/billingStages';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  update: vi.fn(), add: vi.fn(), remove: vi.fn(), move: vi.fn(), load: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useBillingSteps', () => ({
  useClaimStepMutations: () => ({
    update: { mutateAsync: h.update, isPending: false },
    add: { mutateAsync: h.add, isPending: false },
    remove: { mutateAsync: h.remove, isPending: false },
    move: { mutateAsync: h.move, isPending: false },
    loadTemplate: { mutateAsync: h.load, isPending: false },
  }),
  useStepTemplates: () => ({ data: [{ id: 't1', name: 'Standard', steps: [] }] }),
}));
import { ClaimStepsPanel } from '../ClaimStepsPanel';

const stage = (over: Partial<ClaimBillingStage>): ClaimBillingStage => ({
  id: 's1', position: 1, name: 'Measure', clientSide: false, startedOn: '2026-03-01', completedOn: null, clientReference: null, note: null, documents: [], ...over,
});
const stages = (finished = false): ClaimBillingStage[] => [
  stage({ id: 's1', position: 1, name: 'Measure', completedOn: finished ? '2026-03-04' : null }),
  stage({ id: 's2', position: 2, name: 'Review', startedOn: finished ? '2026-03-04' : null }),
  stage({ id: 's3', position: 3, name: 'Approve', startedOn: null }),
];

function renderIt(list = stages(), open = true) {
  render(<QueryClientProvider client={new QueryClient()}><ClaimStepsPanel claimId="c1" projectId="p1" stages={list} open={open} /></QueryClientProvider>);
  return userEvent.setup();
}
const openEditor = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Edit steps' }));

beforeEach(() => {
  h.role = 'Finance';
  for (const f of [h.update, h.add, h.remove, h.move, h.load]) f.mockReset().mockResolvedValue(undefined);
});

describe('ClaimStepsPanel (AC-CBS-014)', () => {
  it('renders nothing without a data layer, so the host screen is unchanged', () => {
    const { container } = render(<ClaimStepsPanel claimId="c1" projectId="p1" stages={stages()} open />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an invoiced or withdrawn claim', () => {
    renderIt(stages(), false);
    expect(screen.queryByRole('button', { name: 'Edit steps' })).not.toBeInTheDocument();
  });

  it('Finance loads a template onto an untouched claim', async () => {
    const user = renderIt();
    await openEditor(user);
    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('button', { name: 'Replace steps with template' }));
    expect(h.load).toHaveBeenCalledWith('t1');
  });

  it('offers no template once a step is finished, and shows only the open steps', async () => {
    const user = renderIt(stages(true));
    await openEditor(user);
    expect(screen.queryByLabelText('Template')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: 'Measure' })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Review' })).toBeInTheDocument();
  });

  it('Finance renames a step, sets its owner role and adds a step', async () => {
    const user = renderIt();
    await openEditor(user);
    const review = screen.getByRole('listitem', { name: 'Review' });
    await user.selectOptions(within(review).getByLabelText('Owner role'), 'Finance');
    expect(h.update).toHaveBeenCalledWith({ stageId: 's2', patch: { ownerRole: 'Finance' } });
    const name = within(review).getByLabelText('Step name');
    await user.clear(name);
    await user.type(name, 'Joint review');
    await user.tab();
    expect(h.update).toHaveBeenCalledWith({ stageId: 's2', patch: { name: 'Joint review' } });
    await user.type(screen.getByLabelText('New step'), 'Survey');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(h.add).toHaveBeenCalledWith({ afterPosition: 3, step: { name: 'Survey' } });
  });

  it('Finance moves a step: the position counts the finished prefix', async () => {
    const user = renderIt(stages(true));
    await openEditor(user);
    await user.click(screen.getByRole('button', { name: 'Move Approve up' }));
    expect(h.move).toHaveBeenCalledWith({ stageId: 's3', position: 2 });
  });

  it('Finance removes a step only with a reason, and the refusal is explained', async () => {
    h.remove.mockRejectedValueOnce(new AppError('refused', 'claim-invoiced'));
    const user = renderIt();
    await openEditor(user);
    await user.click(screen.getByRole('button', { name: 'Remove Approve' }));
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Not part of this claim');
    await user.click(screen.getByRole('button', { name: 'Remove step' }));
    expect(h.remove).toHaveBeenCalledWith({ stageId: 's3', reason: 'Not part of this claim' });
    expect(await screen.findByText('This claim has an invoice; its list of steps can no longer change.')).toBeInTheDocument();
  });

  it('a Project Manager sets owner role and target date but cannot add, remove, move or load', async () => {
    h.role = 'Project Manager';
    const user = renderIt();
    await openEditor(user);
    const review = screen.getByRole('listitem', { name: 'Review' });
    await user.selectOptions(within(review).getByLabelText('Owner role'), 'Admin');
    expect(h.update).toHaveBeenCalledWith({ stageId: 's2', patch: { ownerRole: 'Admin' } });
    expect(within(review).getByLabelText('Target date')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New step')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Template')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Step name')).not.toBeInTheDocument();
  });

  it('an Engineer sees no editor', () => {
    h.role = 'Engineer';
    renderIt();
    expect(screen.queryByRole('button', { name: 'Edit steps' })).not.toBeInTheDocument();
  });
});
