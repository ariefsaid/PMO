import { expect, type Page } from '@playwright/test';
import { serviceClient, need, ORG_ID } from './jobJourney';
import { jobRoleUser } from './jobRole';

export async function siteRole(jobRole: string, role: 'Engineer' | 'Project Manager' | 'Finance' = 'Engineer') {
  const db = serviceClient(jobRole);
  const actor = await jobRoleUser({ service: db, jobRole, role, displayName: `Test ${jobRole}` });
  return {
    id: actor.id,
    db,
    async login(page: Page) {
      await actor.signIn(page);
      await expect(page).toHaveURL(jobRole === 'foreman' ? /\/my$/ : /\/$/);
    },
    cleanup: actor.cleanup,
  };
}

export async function siteWorkOrder(db: ReturnType<typeof serviceClient>) {
 const must=need('site work order');const run=crypto.randomUUID();
 const project=must('project',await db.from('projects').insert({org_id:ORG_ID,name:run,status:'Ongoing Project'}).select('id').single()).id;
 const wo=must('work order',await db.from('work_orders').insert({org_id:ORG_ID,project_id:project,title:run,status:'Issued',order_value:1000,tax_treatment:'exclusive',tax_amount:0}).select('id').single()).id;
 return {run,project,wo,async cleanup(){
  await db.from('work_order_billing_step_documents').delete().eq('work_order_id',wo);await db.from('work_order_billing_steps').delete().eq('work_order_id',wo);
  await db.from('work_order_closeout_items').delete().eq('work_order_id',wo);
  const woClaims=await db.from('progress_claims').select('id').eq('work_order_id',wo);
  const claimIds=(woClaims.data ?? []).map((c)=>c.id);
  if(claimIds.length>0) await db.from('progress_claim_evidence').delete().in('claim_id',claimIds);
  await db.from('progress_claims').delete().eq('work_order_id',wo);
  await db.from('project_documents').delete().eq('project_id',project);await db.from('work_orders').delete().eq('id',wo);await db.from('projects').delete().eq('id',project);
 }};
}
