import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SEED_PROJECT_ID, makeItem, runSuffix, userClient } from './stockFixture';

/** Material-request journeys: an issued work order + item on the seed delivery project, and the org's approval chain set. The chain and cut-off are org-wide, so journeys using this live in e2e/serial/. */
export async function mrqSetup(steps: Array<{ role: string; label: string }>, cutoff: string | null = null) {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const item = await makeItem(admin, sfx, 'M');
  const wo = await admin.from('work_orders').insert({
    org_id: orgId, project_id: SEED_PROJECT_ID, title: `JOB MRQ ${sfx}`, wo_number: `JOB-MRQ-${sfx}`, status: 'Issued',
    issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id, title, wo_number').single();
  if (wo.error) throw new Error('work order: ' + wo.error.message);
  const chain = await admin.rpc('mrq_set_chain', { p_steps: steps.map((s) => ({ ...s, only_over_plan: false })) });
  if (chain.error) throw new Error('chain: ' + chain.error.message);
  const cut = await admin.rpc('mrq_set_cutoff', { p_cutoff: cutoff });
  if (cut.error) throw new Error('cutoff: ' + cut.error.message);
  return { admin, item, wo: wo.data as { id: string; title: string; wo_number: string } };
}

/** A submitted request raised by `email`, needed `daysAhead` days out. */
export async function submittedRequest(email: string, workOrderId: string, itemId: string, daysAhead = 3): Promise<string> {
  const user = await userClient(email);
  const needed = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const saved = await user.rpc('mrq_save_draft', {
    p_request_id: null, p_header: { work_order_id: workOrderId, needed_by: needed, to_warehouse_id: null, note: null },
    p_lines: [{ item_id: itemId, quantity: '2', over_plan_reason: 'JOB journey' }], p_client_request_id: randomUUID(),
  });
  if (saved.error) throw new Error('draft: ' + saved.error.message);
  const sub = await user.rpc('mrq_submit', { p_request_id: saved.data, p_client_request_id: randomUUID() });
  if (sub.error) throw new Error('submit: ' + sub.error.message);
  return saved.data as string;
}

export async function clearStandIns(admin: SupabaseClient) {
  const { data } = await admin.from('approval_stand_ins').select('id');
  for (const r of data ?? []) await admin.rpc('mrq_revoke_stand_in', { p_id: r.id });
}

/** Press "Send for approval"; a line over plan asks for a reason first, so give one and press again. */
export async function sendForApproval(page: import('@playwright/test').Page) {
  const send = page.getByRole('button', { name: 'Send for approval' });
  const reason = page.getByLabel(/why do you need more than the plan/i);
  await send.click();
  if (await reason.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false) && !(await reason.inputValue())) {
    await reason.fill('Extra for the slab');
    await send.click();
  }
}
