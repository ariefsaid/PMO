import { expect, type Page } from '@playwright/test';
import { serviceClient, need, ORG_ID } from './jobJourney';
export async function siteRole(jobRole: string, role: 'Engineer' | 'Project Manager' = 'Engineer') {
 const db=serviceClient(jobRole); const must=need(jobRole); const suffix=crypto.randomUUID();
 const email=`site-${suffix}@example.invalid`; const password=`${suffix}-Aa1!`;
 const created = await db.auth.admin.createUser({email,password,email_confirm:true}); if(created.error || !created.data.user) throw new Error(created.error?.message ?? 'User not created'); const user = created.data.user;
 must('profile',await db.from('profiles').insert({id:user.id,org_id:ORG_ID,email,full_name:`Test ${jobRole}`,role,built_in_role:jobRole}).select('id').single());
 return {id:user.id, db, async login(page:Page) {
  await page.goto('/login'); await page.getByLabel(/email/i).fill(email); await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button',{name:/sign in/i}).click(); await expect(page).toHaveURL(/\/$/);
 }, async cleanup() { await db.from('profiles').delete().eq('id',user.id); await db.auth.admin.deleteUser(user.id); }};
}

export async function siteWorkOrder(db: ReturnType<typeof serviceClient>) {
 const must=need('site work order');const run=crypto.randomUUID();
 const project=must('project',await db.from('projects').insert({org_id:ORG_ID,name:run,status:'Ongoing Project'}).select('id').single()).id;
 const wo=must('work order',await db.from('work_orders').insert({org_id:ORG_ID,project_id:project,title:run,status:'Issued',order_value:1000,tax_treatment:'exclusive',tax_amount:0}).select('id').single()).id;
 return {run,project,wo,async cleanup(){
  await db.from('work_order_billing_step_documents').delete().eq('work_order_id',wo);await db.from('work_order_billing_steps').delete().eq('work_order_id',wo);
  await db.from('work_order_closeout_items').delete().eq('work_order_id',wo);await db.from('progress_claims').delete().eq('work_order_id',wo);
  await db.from('project_documents').delete().eq('project_id',project);await db.from('work_orders').delete().eq('id',wo);await db.from('projects').delete().eq('id',project);
 }};
}
