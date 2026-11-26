// @e2e-isolation: serial — the organisation's close-out checklist is org-global (every Issued work order copies it at
// issue time, 1402): this journey replaces the list for one run and restores the previous list even on failure. It owns
// its project-control-manager login, project, work order and the items the issue created; deletes only its own rows.
// JOB-PC13b (project control): an Admin sets a close-out template naming an owner job role, the work order is issued,
// and the person holding that role finds the item under "Waits on you" and opens the work order from it (#2907).
import { test, expect } from '@playwright/test';
import { ok, ORG_ID, PM_ID, projectWithWorkOrders, runId, serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(120_000);

test('JOB-PC13b the owner job role sees the close-out item under waits-on-you and opens the work order', async ({ page }) => {
  const svc = serviceClient('JOB-PC13b');
  const run = runId('JOBPC13B');
  const pcm = await roleJobUser(svc, 'project_control_manager', run);
  const itemName = `${run} handover certificate`;

  let projectId = '';
  let woId = '';
  let previous: { position: number; name: string; required: boolean; target_days: number | null; owner_job_role: string | null }[] = [];

  try {
    // As an Admin would set the organisation's checklist: one item naming the project control manager as its owner role.
    // The list is replaced whole, so the previous list is snapshotted first and restored in finally.
    const prior = await svc.from('closeout_checklist_templates').select('position,name,required,target_days,owner_job_role').eq('org_id', ORG_ID);
    if (prior.error) throw new Error(`previous checklist: ${prior.error.message}`);
    previous = (prior.data ?? []) as typeof previous;
    ok('checklist cleared', await svc.from('closeout_checklist_templates').delete().eq('org_id', ORG_ID));
    ok('checklist set', await svc.from('closeout_checklist_templates').insert([
      { org_id: ORG_ID, position: 1, name: itemName, required: true, owner_job_role: 'project_control_manager' },
    ]));

    const fx = await projectWithWorkOrders(svc, run, []);
    projectId = fx.projectId;
    // The work order is issued the way the app does it: drafted, then issued — the issue-time copy (1402) is an
    // UPDATE trigger on Draft → Issued, so an insert already Issued would carry no checklist at all.
    woId = crypto.randomUUID();
    ok('draft work order', await svc.from('work_orders').insert({
      id: woId, org_id: ORG_ID, project_id: projectId, title: `${run} Handover`, status: 'Draft', wo_number: `WO-${run}-1`,
      issued_at: new Date().toISOString(), issued_by: PM_ID, order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }));
    ok('issue', await svc.from('work_orders').update({ status: 'Issued' }).eq('id', woId));
    // Issuing copied the list: the work order's item carries the owner job role.
    const items = await svc.from('work_order_closeout_items').select('id,name,owner_job_role,done_on').eq('work_order_id', woId);
    if (items.error) throw new Error(`issued checklist: ${items.error.message}`);
    const row = (items.data ?? []).find((i) => i.name === itemName);
    if (!row || row.owner_job_role !== 'project_control_manager' || row.done_on !== null) {
      throw new Error(`the issued item is not an open item owned by the project control manager: ${JSON.stringify(items.data)}`);
    }

    // Signed in AS that job role (never an Admin or a higher level): the item waits on them.
    await pcm.signIn(page);
    await page.goto('/');
    const waits = page.getByTestId('waits-on-you');
    const waiting = waits.getByRole('link', { name: /close-out items? waiting on your role/ });
    await expect(waiting).toContainText('1', { timeout: 30_000 });
    // Opening it lands on the work order with the item still open on its checklist.
    await waiting.click();
    await expect(page).toHaveURL(new RegExp(`/work-orders/${woId}$`), { timeout: 20_000 });
    await expect(page.getByTestId('closeout-summary')).toContainText('Required items not done: 1', { timeout: 30_000 });
    await expect(page.getByLabel(`Document for ${itemName}`)).toBeVisible({ timeout: 20_000 });
  } finally {
    await svc.from('tasks').delete().eq('work_order_id', woId || '00000000-0000-0000-0000-000000000000');
    await svc.from('work_order_closeout_items').delete().eq('work_order_id', woId || '00000000-0000-0000-0000-000000000000');
    await svc.from('work_orders').delete().eq('id', woId || '00000000-0000-0000-0000-000000000000');
    await svc.from('projects').delete().eq('id', projectId || '00000000-0000-0000-0000-000000000000');
    ok('checklist cleared again', await svc.from('closeout_checklist_templates').delete().eq('org_id', ORG_ID));
    if (previous.length > 0) {
      ok('checklist restored', await svc.from('closeout_checklist_templates').insert(previous.map((t) => ({
        org_id: ORG_ID, position: t.position, name: t.name, required: t.required,
        ...(t.target_days === null ? {} : { target_days: t.target_days }),
        ...(t.owner_job_role === null ? {} : { owner_job_role: t.owner_job_role }),
      }))));
    }
    ok('login cleanup', await svc.from('profiles').delete().eq('id', pcm.id));
    await pcm.cleanup();
  }
});
