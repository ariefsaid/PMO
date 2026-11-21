import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));

import {
  addClaimStep, archiveStepTemplate, getOverdueStepsByClaim, getWaitingSteps, loadStepTemplateOntoClaim, loadStepTemplateOntoProject,
  moveClaimStep, removeClaimStep, saveStepTemplate, updateClaimStep,
} from './billingSteps';

beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: null, error: null }); });

/** Every argument the SQL function declares is sent (none has a default), so a missing one cannot reach the schema cache as "function not found". */
describe('billing steps DAL sends every declared argument (#2680)', () => {
  it('a NEW template sends p_template: null', async () => {
    h.rpc.mockResolvedValue({ data: 't1', error: null });
    await expect(saveStepTemplate(null, 'Standard', [{ name: 'Measure', ownerRole: 'Finance', targetDays: 5 }])).resolves.toBe('t1');
    expect(h.rpc).toHaveBeenCalledWith('save_billing_step_template', {
      p_template: null, p_name: 'Standard', p_steps: [{ name: 'Measure', owner_role: 'Finance', target_days: 5 }],
    });
  });

  it('an existing template sends its id', async () => {
    await saveStepTemplate('t9', 'Renamed', []);
    expect(h.rpc).toHaveBeenCalledWith('save_billing_step_template', { p_template: 't9', p_name: 'Renamed', p_steps: [] });
  });

  it('sends the declared arguments of the other writes', async () => {
    await archiveStepTemplate('t1');
    await loadStepTemplateOntoProject('p1', 't1');
    await loadStepTemplateOntoClaim('c1', 't1');
    await updateClaimStep('s1', { ownerRole: null, targetOn: '2026-03-12' });
    await addClaimStep('c1', 2, { name: 'Survey' });
    await removeClaimStep('s1', 'Not part of this claim');
    await moveClaimStep('s1', 3);
    expect(h.rpc.mock.calls).toEqual([
      ['archive_billing_step_template', { p_template: 't1' }],
      ['load_billing_step_template_onto_project', { p_project: 'p1', p_template: 't1' }],
      ['load_billing_step_template_onto_claim', { p_claim: 'c1', p_template: 't1' }],
      ['update_claim_billing_step', { p_stage: 's1', p_patch: { owner_role: null, target_on: '2026-03-12' } }],
      ['add_claim_billing_step', { p_claim: 'c1', p_after_position: 2, p_step: { name: 'Survey' } }],
      ['remove_claim_billing_step', { p_stage: 's1', p_reason: 'Not part of this claim' }],
      ['move_claim_billing_step', { p_stage: 's1', p_new_position: 3 }],
    ]);
  });

  it('reads map rows and take the declared arguments', async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ stage_id: 's', claim_id: 'c', project_id: 'p', project_name: 'P', step_name: 'S', due_on: null, days_over: 2 }], error: null });
    await expect(getWaitingSteps()).resolves.toEqual([{ stageId: 's', claimId: 'c', projectId: 'p', projectName: 'P', stepName: 'S', dueOn: null, daysOver: 2 }]);
    h.rpc.mockResolvedValueOnce({ data: [{ claim_id: 'c', step_name: 'S', days_over: 4 }], error: null });
    await expect(getOverdueStepsByClaim('p1')).resolves.toEqual([{ claimId: 'c', stepName: 'S', daysOver: 4 }]);
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'my_waiting_billing_steps');
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'overdue_billing_steps_by_claim', { p_project: 'p1' });
  });

  it('a database refusal becomes a coded error', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'refused', code: '55000', details: 'claim-invoiced' } });
    await expect(removeClaimStep('s1', 'reason')).rejects.toMatchObject({ code: 'claim-invoiced' });
  });
});
