// A material request that waits at the first approval step, for the fix-waiting journeys (JOB-WAIT-*). Self-isolated: its own project, work order,
// allowance and stock item under a unique run name; the organisation's approval chain is replaced for the run and put back in `restore`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeItem, runSuffix, userClient } from './stockFixture';
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, serviceClient } from './jobFixtures';

export interface WaitingFixture {
  sfx: string; projectId: string; woIds: string[]; boqId: string; requestId: string; requestNumber: string; chainBefore: unknown[];
  workOrderLabel: string; project: string; itemLabel: string;
  restore: () => Promise<void>;
}

/** Plan 100 for the item; the request is for 120 with a reason, so it is over plan. `stepRole` holds the only step; `requester` raises and submits it. */
export async function submittedOverPlanRequest(who: string, stepRole: 'Engineer' | 'Project Manager' | 'Finance', requester: string, submit = true): Promise<WaitingFixture> {
  const admin: SupabaseClient = serviceClient(who);
  const sfx = runSuffix();
  const fx = await projectWithWorkOrders(admin, `${who}-${sfx}`, ['Concrete']);
  const wo = fx.workOrders[0];
  const adminUser = await userClient('admin@acme.test');
  ok('site location', await admin.from('stock_warehouses').insert({ code: `E2E-S${sfx}`, name: `E2E site ${sfx}`, kind: 'site', project_id: fx.projectId, org_id: ORG_ID }));
  const item = await makeItem(adminUser, sfx, 'W');
  const boqId = need('line', await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: fx.projectId, item_code: 'CONC', description: 'Concrete', unit: 'm3', quantity: 100, rate: 10 }).select('id').single()).id as string;
  ok('allocation', await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.id, boq_item_id: boqId, quantity: 100 }));
  ok('allowance', await admin.from('boq_material_allowances').insert({ org_id: ORG_ID, boq_item_id: boqId, item_id: item.id, planned_quantity: 100 }));
  const before = need('chain', await admin.from('approval_chain_steps').select('role, label, only_over_plan').eq('org_id', ORG_ID).order('position', { ascending: true }));
  ok('set chain', await adminUser.rpc('mrq_set_chain', { p_steps: [{ role: stepRole, label: 'Site check', only_over_plan: false }] }));

  const user = await userClient(requester);
  const neededBy = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const id = need('draft', await user.rpc('mrq_save_draft', {
    p_request_id: null, p_client_request_id: crypto.randomUUID(),
    p_header: { work_order_id: wo.id, needed_by: neededBy, note: null },
    p_lines: [{ item_id: item.id, quantity: 120, over_plan_reason: 'Extra pour on the east slab' }],
  })) as unknown as string;
  if (submit) ok('submit', await user.rpc('mrq_submit', { p_request_id: id, p_client_request_id: crypto.randomUUID() }));
  const number = need('number', await admin.from('material_requests').select('number').eq('id', id).single()).number as string;

  return {
    sfx, projectId: fx.projectId, woIds: fx.workOrders.map((w) => w.id), boqId, requestId: id, requestNumber: number, chainBefore: before,
    workOrderLabel: `${wo.number} · ${wo.title}`, project: `${who}-${sfx} project`, itemLabel: `${item.code} · ${item.name}`,
    restore: async () => {
      await admin.from('material_requests').delete().eq('id', id);
      await cleanupAll(admin, [
        ['boq_material_allowances', 'boq_item_id', [boqId]], ['work_order_lines', 'work_order_id', fx.workOrders.map((w) => w.id)],
        ['boq_items', 'id', [boqId]], ['work_orders', 'id', fx.workOrders.map((w) => w.id)], ['projects', 'id', [fx.projectId]],
      ]).catch(() => undefined);
      const steps = (before as Array<{ role: string; label: string; only_over_plan: boolean }>).map((s) => ({ role: s.role, label: s.label, only_over_plan: s.only_over_plan }));
      if (steps.length > 0) await adminUser.rpc('mrq_set_chain', { p_steps: steps });
    },
  };
}
