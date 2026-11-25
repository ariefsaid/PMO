import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import {
  addWorkOrderStep, assignWorkOrderStep, attachWorkOrderStepDocument, completeWorkOrderStep, getWaitingWorkOrderSteps, getWorkOrderChecklistEnabled,
  listWorkOrderSteps, saveWorkOrderChecklistAsTemplate, setDefaultStepTemplate, setWorkOrderChecklistEnabled,
  setWorkOrderStepClaimEvidence, skipWorkOrderStep,
} from './workOrderBillingSteps';

beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: null, error: null }); h.from.mockReset(); });

describe('work-order billing steps DAL (migrations 1770-1774)', () => {
  it('AC-WBS-007 sends every declared argument of the writes, null where the database allows it', async () => {
    await completeWorkOrderStep('s1', '2026-03-04');
    await skipWorkOrderStep('s1', 'Client waived it');
    await assignWorkOrderStep('s1', null);
    await attachWorkOrderStepDocument('s1', null, 'd1');
    await setDefaultStepTemplate(null);
    expect(h.rpc.mock.calls).toEqual([
      ['complete_work_order_step', { p_step: 's1', p_done_on: '2026-03-04' }],
      ['skip_work_order_step', { p_step: 's1', p_reason: 'Client waived it' }],
      ['assign_work_order_step', { p_step: 's1', p_person: null }],
      ['attach_work_order_step_document', { p_step: 's1', p_slot: null, p_document: 'd1' }],
      ['set_default_billing_step_template', { p_template: null }],
    ]);
  });

  it('AC-WCE-001 adds a step with the work order, the place and the step the page collected', async () => {
    h.rpc.mockResolvedValue({ data: 'n1', error: null });
    await expect(addWorkOrderStep('w1', 2, { name: 'Joint survey sign-off', ownerRoleKey: 'quantity_surveyor' })).resolves.toBe('n1');
    expect(h.rpc).toHaveBeenCalledWith('add_work_order_step', {
      p_work_order: 'w1', p_after_position: 2, p_step: { name: 'Joint survey sign-off', owner_role_key: 'quantity_surveyor' },
    });
  });

  it('AC-WCE-001 a step with no owner role, target or flag carries only its name; a target and the optional flag travel with it', async () => {
    h.rpc.mockResolvedValue({ data: 'n2', error: null });
    await addWorkOrderStep('w1', 0, { name: 'Only', ownerRoleKey: null, targetDays: null, optional: false });
    await addWorkOrderStep('w1', 0, { name: 'Timed', ownerRoleKey: 'billing_officer', targetDays: 4, optional: true });
    expect(h.rpc.mock.calls.map((c) => c[1].p_step)).toEqual([
      { name: 'Only' },
      { name: 'Timed', owner_role_key: 'billing_officer', target_days: 4, optional: true },
    ]);
  });

  it('AC-WCE-005 sends null as the database-resolved end when the visible list does not reveal its tail', async () => {
    h.rpc.mockResolvedValue({ data: 'n3', error: null });
    await expect(addWorkOrderStep('w1', null, { name: 'Append after hidden steps' })).resolves.toBe('n3');
    expect(h.rpc).toHaveBeenCalledWith('add_work_order_step', {
      p_work_order: 'w1', p_after_position: null, p_step: { name: 'Append after hidden steps' },
    });
  });

  it('AC-WCE-002 saves the complete work-order list through the database copy RPC', async () => {
    h.rpc.mockResolvedValue({ data: 'template-1', error: null });
    await expect(saveWorkOrderChecklistAsTemplate('w1', 'Remote site')).resolves.toBe('template-1');
    expect(h.rpc).toHaveBeenCalledWith('save_work_order_steps_as_template', { p_work_order: 'w1', p_name: 'Remote site' });
  });

  it('AC-WCE-006 reads the organisation setting and writes it through its guarded RPC', async () => {
    const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn() };
    chain.limit.mockResolvedValue({ data: [{ work_order_checklist_enabled: true }], error: null });
    h.from.mockReturnValue(chain);
    await expect(getWorkOrderChecklistEnabled()).resolves.toBe(true);
    expect(h.from).toHaveBeenCalledWith('organizations');
    expect(chain.select).toHaveBeenCalledWith('work_order_checklist_enabled');
    await setWorkOrderChecklistEnabled(false);
    expect(h.rpc).toHaveBeenCalledWith('set_org_work_order_checklist_edit', { p_enabled: false });
  });

  it('AC-WQE-006 marks a work-order step through its guarded RPC', async () => {
    await setWorkOrderStepClaimEvidence('s1', true);
    expect(h.rpc).toHaveBeenCalledWith('set_work_order_step_claim_evidence', { p_step: 's1', p_enabled: true });
  });

  it('AC-WQE-006 preserves a refusal to change evidence designation', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'WBS_ADMIN_ONLY: Admin required', code: '42501' } });
    await expect(setWorkOrderStepClaimEvidence('s1', true)).rejects.toMatchObject({ message: 'WBS_ADMIN_ONLY: Admin required', code: '42501' });
  });

  it('AC-WCE-003 a refusal keeps its code for the refusals catalogue', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'WBS_STEP_CLOSED: a new step goes after the current step', code: '55000' } });
    await expect(addWorkOrderStep('w1', 0, { name: 'Too early' })).rejects.toMatchObject({ message: expect.stringContaining('WBS_STEP_CLOSED:'), code: '55000' });
  });

  it('AC-WBS-006 a refusal keeps its sentence and code for the refusals catalogue', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'WBS_DOCS_MISSING: attach every required document before finishing this step', code: '55000' } });
    await expect(completeWorkOrderStep('s1', '2026-03-04')).rejects.toMatchObject({ message: expect.stringContaining('WBS_DOCS_MISSING:'), code: '55000' });
  });

  it('AC-WBS-009 maps the waiting rows', async () => {
    h.rpc.mockResolvedValue({ data: [{ step_id: 's1', work_order_id: 'w1', project_id: 'p1', project_name: 'P', work_order_label: 'WO-1', step_name: 'Survey', started_on: '2026-03-01', target_days: 3 }], error: null });
    await expect(getWaitingWorkOrderSteps()).resolves.toEqual([
      { stepId: 's1', workOrderId: 'w1', projectId: 'p1', projectName: 'P', workOrderLabel: 'WO-1', stepName: 'Survey', startedOn: '2026-03-01', targetDays: 3 },
    ]);
  });

  it('AC-WBS-012 reads one work order\'s list in order with documents sorted', async () => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn() };
    chain.limit.mockResolvedValue({ data: [{
      id: 's1', work_order_id: 'w1', project_id: 'p1', position: 1, name: 'Survey', owner_role_key: 'quantity_surveyor', assignee_id: 'u1', target_days: 3, optional: false,
      started_on: '2026-03-01', done_on: null, skipped_on: '2026-03-02', skipped_reason: 'Client waived it', assignee: { full_name: 'Dewi' },
      documents: [{ id: 'b', position: 2, name: 'B', required: false, document_id: null }, { id: 'a', position: 1, name: 'A', required: true, document_id: 'd1' }],
    }], error: null });
    h.from.mockReturnValue(chain);
    const rows = await listWorkOrderSteps('w1');
    expect(h.from).toHaveBeenCalledWith('work_order_billing_steps');
    expect(chain.eq).toHaveBeenCalledWith('work_order_id', 'w1');
    expect(rows[0]).toMatchObject({ id: 's1', assigneeName: 'Dewi', ownerRoleKey: 'quantity_surveyor', skippedReason: 'Client waived it' });
    expect(rows[0].documents.map((d) => d.id)).toEqual(['a', 'b']);
  });
});
