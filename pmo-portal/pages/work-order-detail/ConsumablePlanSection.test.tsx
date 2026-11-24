import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import i18n from '@/src/lib/i18n';

const q = (data: unknown, over: Record<string, unknown> = {}) => ({ data, isPending: false, isError: false, isSuccess: true, refetch: vi.fn(), ...over });
const h = vi.hoisted(() => ({
  plan: null as unknown, inputs: null as unknown,
  can: { generate: true, adjust: true, approve: false } as Record<string, boolean>,
  seenCtx: null as unknown,
  generate: { mutateAsync: vi.fn(), isPending: false }, adjust: { mutateAsync: vi.fn(), isPending: false }, approve: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, _e: string, ctx: unknown) => { h.seenCtx = ctx; return h.can[action] ?? true; } }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@/src/hooks/useStock', () => ({ useStockItems: () => q([{ id: 'rod', code: 'ROD', name: 'Welding rod', unit_id: 'u1', archived_at: null }, { id: 'gas', code: 'GAS', name: 'Gas', unit_id: 'u1', archived_at: null }]) }));
vi.mock('@/src/hooks/useUsageStandards', () => ({
  useConsumablePlan: () => h.plan, usePlanInputs: () => h.inputs, useConsumablePlanMutations: () => ({ generate: h.generate, adjust: h.adjust, approve: h.approve }),
}));

import { ConsumablePlanSection } from './ConsumablePlanSection';

const line = (over: Record<string, unknown> = {}) => ({
  itemId: 'rod', itemCode: 'ROD', itemName: 'Welding rod', unitCode: 'KG', generatedQty: '8.800', adjustedQty: null, adjustReason: null, adjustedBy: null, adjustedAt: null,
  plannedQty: '8.800', priorQty: '3.000', source: 'standard',
  basis: [{ boqItemId: 'b1', code: 'WLD-01', unit: 'dia-inch', workQty: '120.000', standardId: 's1', qtyPerUnit: '0.050000', marginPct: '10.00', result: '6.6' }], ...over,
});
const plan = (over: Record<string, unknown> = {}) => ({ workOrderId: 'w1', workOrderStatus: 'Issued', generatedAt: '2026-11-20T01:00:00Z', outOfDate: false,
  approval: { authorId: 'eng-1', authorIsPcm: false, approved: false, approvedBy: null, approvedAt: null }, lines: [line()], noStandard: [], unplanned: [], ...over });
const renderSection = (status = 'Issued') => render(<ToastProvider><ConsumablePlanSection workOrderId="w1" workOrderStatus={status} project={{ project_manager_id: 'pm-1' }} /></ToastProvider>);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.plan = q(plan());
  h.inputs = q({ lines: [{ boqItemId: 'b1', code: 'WLD-01', unit: 'dia-inch', quantity: '120' }], standards: [{ id: 's1', itemId: 'rod', workUnit: 'dia-inch', boqCodePrefix: 'WLD', qtyPerUnit: '0.05', marginPct: '10' }] });
  h.can = { generate: true, adjust: true, approve: false };
  h.generate.mutateAsync = vi.fn().mockResolvedValue(1);
  h.adjust.mutateAsync = vi.fn().mockResolvedValue(undefined);
  h.approve.mutateAsync = vi.fn().mockResolvedValue(undefined);
});

describe('consumable plan section (#2577)', () => {
  it('FR-CUS-014 shows per item the planned quantity, already requested, remaining and the source', () => {
    renderSection();
    const row = screen.getByTestId('consumable-row-rod');
    expect(row).toHaveTextContent('Plan 8.8 KG');
    expect(row).toHaveTextContent('Requested 3');
    expect(screen.getByTestId('consumable-remaining-rod')).toHaveTextContent('Remaining 5.8');
    expect(row).toHaveTextContent('From standards');
  });

  it('AC-CUS-013 remaining is shown negative when over-requested, never clamped to zero', () => {
    h.plan = q(plan({ lines: [line({ priorQty: '9.000' })] }));
    renderSection();
    expect(screen.getByTestId('consumable-remaining-rod')).toHaveTextContent('Remaining -0.2');
  });

  it('FR-CUS-014 an item with no plan says "No plan" instead of a plan of zero', () => {
    h.plan = q(plan({ unplanned: [{ itemId: 'gas', itemCode: 'GAS', itemName: 'Gas', unitCode: 'KG', plannedQty: '0.000', priorQty: '1.000', source: 'none' }] }));
    renderSection();
    const row = screen.getByTestId('consumable-row-u-gas');
    expect(row).toHaveTextContent('No plan');
    expect(row).not.toHaveTextContent('Plan 0');
  });

  it('FR-CUS-010 contract lines no standard covers are listed as a gap', () => {
    h.plan = q(plan({ noStandard: [{ boqItemId: 'b3', itemCode: 'CIV-01', description: 'Concrete', unit: 'm3', quantity: '10.000' }] }));
    renderSection();
    expect(within(screen.getByTestId('consumable-no-standard')).getByText(/CIV-01: Concrete/)).toBeInTheDocument();
  });

  it('AC-PEO-003 an out-of-date plan says material requests fall back until approval', () => {
    h.plan = q(plan({ outOfDate: true }));
    renderSection();
    expect(screen.getByTestId('consumable-out-of-date')).toHaveTextContent('Material requests use the allowance until the plan is regenerated and approved');
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument();
  });

  it('AC-PEO-003 shows the decider route and sends approval only when the policy allows it', async () => {
    h.can.approve = true;
    renderSection();
    expect(screen.getByTestId('consumable-approval')).toHaveTextContent('Waiting for a Project Control Manager.');
    await userEvent.click(screen.getByRole('button', { name: 'Approve plan' }));
    expect(h.approve.mutateAsync).toHaveBeenCalledOnce();
  });

  it('AC-PEO-003 a PCM-authored plan names its Admin or project-manager route', () => {
    h.plan = q(plan({ approval: { authorId: 'pcm', authorIsPcm: true, approved: false, approvedBy: null, approvedAt: null } }));
    renderSection();
    expect(screen.getByTestId('consumable-approval')).toHaveTextContent(/Waiting for an Admin or this project.s Project Manager\./);
  });

  it('AC-CUS-011 a user who may not plan sees the plan but no generate, regenerate, add or adjust control', () => {
    h.can = { generate: false, adjust: false, approve: false };
    renderSection();
    expect(screen.getByTestId('consumable-row-rod')).toBeInTheDocument();
    for (const name of [/regenerate/i, /generate plan/i, /add item/i, /^adjust$/i]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('AC-CUS-011 the permission record is the work order\'s project (it carries the manager)', () => {
    renderSection();
    expect(h.seenCtx).toMatchObject({ record: { project_manager_id: 'pm-1', viewOnly: false } });
  });

  it('FR-CUS-006 a closed work order offers no change, even to a planner', () => {
    renderSection('Closed');
    expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^adjust$/i })).not.toBeInTheDocument();
  });

  it('FR-CUS-005 with no plan yet, Generate plan calls the server once', async () => {
    h.plan = q(plan({ generatedAt: null, lines: [] }));
    renderSection();
    expect(screen.getByText(/No consumable plan yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate plan' }));
    expect(h.generate.mutateAsync).toHaveBeenCalledOnce();
  });

  it('FR-CUS-007 regenerate shows the old and new generated quantity first, and only a confirm calls the server', async () => {
    h.inputs = q({ lines: [{ boqItemId: 'b1', code: 'WLD-01', unit: 'dia-inch', quantity: '170' }], standards: [{ id: 's1', itemId: 'rod', workUnit: 'dia-inch', boqCodePrefix: 'WLD', qtyPerUnit: '0.05', marginPct: '10' }] });
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(screen.getByTestId('consumable-preview')).toHaveTextContent('ROD: 8.8 to 9.35');
    expect(h.generate.mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
    expect(h.generate.mutateAsync).toHaveBeenCalledOnce();
  });

  it('AC-CUS-007 an adjustment cannot be saved without a reason; with one it reaches the server with the typed quantity', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    const qtyField = screen.getByLabelText(/^Planned quantity/);
    await userEvent.clear(qtyField);
    await userEvent.type(qtyField, '12');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.adjust.mutateAsync).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/^Why is this different/), 'extra spools');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.adjust.mutateAsync).toHaveBeenCalledWith({ itemId: 'rod', adjustedQty: '12', reason: 'extra spools' });
  });

  it('FR-CUS-009 an adjusted line shows the generated figure and the reason, and offers to go back to the generated quantity', async () => {
    h.plan = q(plan({ lines: [line({ adjustedQty: '12.000', plannedQty: '12.000', adjustReason: 'extra spools', source: 'adjusted' })] }));
    renderSection();
    expect(screen.getByTestId('consumable-row-rod')).toHaveTextContent('Generated 8.8; adjusted: extra spools');
    await userEvent.click(screen.getByRole('button', { name: 'Use generated quantity' }));
    expect(h.adjust.mutateAsync).toHaveBeenCalledWith({ itemId: 'rod', adjustedQty: null, reason: null });
  });

  it('FR-CUS-005 the basis of a quantity is open to inspection', () => {
    renderSection();
    expect(screen.getByText('How this was worked out')).toBeInTheDocument();
    expect(screen.getByText(/WLD-01: 120 dia-inch x 0\.05 per unit, \+10% = 6\.600/)).toBeInTheDocument();
  });

  it('a failed plan read is an error with a retry, not an empty plan', () => {
    h.plan = q(undefined, { isError: true, isSuccess: false });
    renderSection();
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No consumable plan yet/)).not.toBeInTheDocument();
  });
});
