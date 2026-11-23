import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import {
  addClaimStep, archiveStepTemplate, getOverdueStepsByClaim, getWaitingSteps, listStepTemplates, loadStepTemplateOntoClaim, loadStepTemplateOntoProject,
  moveClaimStep, removeClaimStep, saveStepTemplate, updateClaimStep,
} from './billingSteps';

beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: null, error: null }); h.from.mockReset(); });

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

  it('AC-WBS-010 a template with owner role keys or hidden-from roles also sends them through the roles function', async () => {
    h.rpc.mockResolvedValue({ data: 't1', error: null });
    await saveStepTemplate(null, 'Standard', [{ name: 'A', ownerRoleKey: 'quantity_surveyor' }, { name: 'B', hiddenFromRoleKeys: ['quality_manager'] }, { name: 'C' }]);
    expect(h.rpc.mock.calls[1]).toEqual(['set_billing_step_template_roles', { p_template: 't1', p_roles: [
      { position: 1, owner_role_key: 'quantity_surveyor', hidden_from_role_keys: [] },
      { position: 2, owner_role_key: null, hidden_from_role_keys: ['quality_manager'] },
      { position: 3, owner_role_key: null, hidden_from_role_keys: [] },
    ] }]);
  });

  it('AC-WBS-010 a template with no role fields makes no roles call', async () => {
    await saveStepTemplate('t9', 'Plain', [{ name: 'A' }]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
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

describe('listStepTemplates (#2680)', () => {
  it('reads only live templates, names-ordered, and maps steps sorted by position with their documents', async () => {
    const chain: Record<string, unknown> = {};
    const calls: Record<string, unknown[]> = { from: [], select: [], is: [], order: [], limit: [] };
    void calls;
    const next = { value: { data: null as unknown, error: null } };
    for (const m of ['select', 'is', 'order', 'limit'] as const) chain[m] = (...a: unknown[]) => { calls[m].push(a.length <= 1 ? a[0] : a); return chain; };
    (chain as unknown as { then: (res: (v: unknown) => unknown) => void }).then = (res) => res(next.value);
    h.from.mockImplementation((t: string) => { calls.from.push(t); return chain; });
    next.value = {
      data: [{
        id: 't1', name: 'Standard',
        steps: [
          { position: 2, name: 'Check', owner_role: 'Finance', target_days: 5, client_side: true, optional: false, documents: [{ position: 2, name: 'B', required: false }, { position: 1, name: 'A', required: true }] },
          { position: 1, name: 'Survey', owner_role: null, target_days: null, client_side: false, optional: true, documents: null },
        ],
      }],
      error: null,
    };
    const templates = await listStepTemplates();
    expect(templates).toHaveLength(1);
    const template = templates[0]!;
    expect(template.steps.map((s) => s.name)).toEqual(['Survey', 'Check']); // position order
    const check = template.steps[1]!;
    expect(check.documents!.map((d) => d.name)).toEqual(['A', 'B']);
    expect(check).toMatchObject({ ownerRole: 'Finance', targetDays: 5, clientSide: true, optional: false });
    expect(template.steps[0]).toMatchObject({ ownerRole: null, targetDays: null, optional: true, documents: [] });
    expect(calls.from).toEqual(['billing_step_templates']);
    expect(calls.is).toContainEqual(['archived_at', null]);
    expect(calls.order).toContain('name');
  });

  it('a template read refusal keeps its code', async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'order', 'limit'] as const) chain[m] = () => chain;
    (chain as unknown as { then: (res: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown) => void }).then = (res) => res({ data: null, error: { message: 'denied', code: '42501' } });
    h.from.mockImplementation(() => chain);
    await expect(listStepTemplates()).rejects.toMatchObject({ code: '42501' });
  });
});
