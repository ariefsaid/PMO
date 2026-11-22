import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import {
  assignWorkOrderStep, attachWorkOrderStepDocument, completeWorkOrderStep, getWaitingWorkOrderSteps, listWorkOrderSteps, setDefaultStepTemplate, skipWorkOrderStep,
} from './workOrderBillingSteps';

beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: null, error: null }); h.from.mockReset(); });

describe('work-order billing steps DAL (migrations 1770-1774)', () => {
  it('AC-WBS-007 sends every declared argument of the writes, null where the database allows it', async () => {
    await completeWorkOrderStep('s1', '2026-03-04');
    await skipWorkOrderStep('s1');
    await assignWorkOrderStep('s1', null);
    await attachWorkOrderStepDocument('s1', null, 'd1');
    await setDefaultStepTemplate(null);
    expect(h.rpc.mock.calls).toEqual([
      ['complete_work_order_step', { p_step: 's1', p_done_on: '2026-03-04' }],
      ['skip_work_order_step', { p_step: 's1' }],
      ['assign_work_order_step', { p_step: 's1', p_person: null }],
      ['attach_work_order_step_document', { p_step: 's1', p_slot: null, p_document: 'd1' }],
      ['set_default_billing_step_template', { p_template: null }],
    ]);
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
      started_on: '2026-03-01', done_on: null, skipped_on: null, assignee: { full_name: 'Dewi' },
      documents: [{ id: 'b', position: 2, name: 'B', required: false, document_id: null }, { id: 'a', position: 1, name: 'A', required: true, document_id: 'd1' }],
    }], error: null });
    h.from.mockReturnValue(chain);
    const rows = await listWorkOrderSteps('w1');
    expect(h.from).toHaveBeenCalledWith('work_order_billing_steps');
    expect(chain.eq).toHaveBeenCalledWith('work_order_id', 'w1');
    expect(rows[0]).toMatchObject({ id: 's1', assigneeName: 'Dewi', ownerRoleKey: 'quantity_surveyor' });
    expect(rows[0].documents.map((d) => d.id)).toEqual(['a', 'b']);
  });
});
