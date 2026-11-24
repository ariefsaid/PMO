// @e2e-isolation: serial — restores the organisation crew-loans setting; all workforce rows belong to this journey.
import { test, expect } from '@playwright/test';
import { serviceClient, need, ORG_ID, PM_ID, ENGINEER_ID, inDays } from '../support/jobJourney';
const db = serviceClient('AC-SITE-004');
const must = need('AC-SITE-004');
test('AC-SITE-004 a supervisor sees attendance saved by the separate foreman', async ({ page }) => {
 const run = crypto.randomUUID(); const email = `site-${run}@example.invalid`; const password = `${run}-Aa1!`;
 const created = await db.auth.admin.createUser({ email, password, email_confirm: true }); if(created.error || !created.data.user) throw new Error(created.error?.message ?? 'User not created'); const user = created.data.user;
 const setting = must('setting', await db.from('organizations').select('crew_loans_enabled').eq('id', ORG_ID).single());
 const extraWorkers: string[] = []; const crews: string[] = []; let project = ''; let wo = ''; let worker = '';
 try {
  must('profile', await db.from('profiles').insert({ id:user.id, org_id:ORG_ID, email, full_name:'Site supervisor', role:'Engineer', built_in_role:'site_supervisor' }).select('id').single());
  must('enable loans', await db.from('organizations').update({crew_loans_enabled:true}).eq('id',ORG_ID).select('id').single());
  project=must('project',await db.from('projects').insert({org_id:ORG_ID,name:run,status:'Ongoing Project',project_manager_id:PM_ID}).select('id').single()).id;
  wo=must('work order',await db.from('work_orders').insert({org_id:ORG_ID,project_id:project,title:run,status:'Issued',order_value:1000,tax_treatment:'exclusive',tax_amount:0,responsible_person_id:user.id,start_date:inDays(-1),end_date:inDays(1)}).select('id').single()).id;
  for (const name of ['Home','Host']) {
   const id=must(name,await db.from('crews').insert({org_id:ORG_ID,code:`${run.slice(0,8)}${name}`,name:`${run} ${name}`,field_controller_id:ENGINEER_ID}).select('id').single()).id;
   crews.push(id); must('roster',await db.from('work_order_crews').insert({org_id:ORG_ID,work_order_id:wo,crew_id:id,valid_from:inDays(-1)}).select('id').single());
  }
  worker=must('worker',await db.from('people').insert({org_id:ORG_ID,name:`${run} Worker`,kind:'own'}).select('id').single()).id;
  must('placement',await db.from('crew_members').insert({org_id:ORG_ID,crew_id:crews[0],worker_id:worker,valid_from:inDays(-1)}).select('id').single());
  await page.goto('/login'); await page.getByLabel(/email/i).fill(email); await page.getByLabel(/password/i).fill(password); await page.getByRole('button',{name:/sign in/i}).click(); await expect(page).toHaveURL(/\/$/);
  for(let index=2;index<=3;index++) {
   const id=must('extra person',await db.from('people').insert({org_id:ORG_ID,name:`${run} Person${index}`,kind:'own'}).select('id').single()).id;extraWorkers.push(id);
   must('extra placement',await db.from('crew_members').insert({org_id:ORG_ID,worker_id:id,crew_id:crews[0],valid_from:inDays(-1)}).select('id').single());
  }
  must('foreman attendance',await db.from('attendance_days').insert([worker,...extraWorkers].map((id,index)=>({org_id:ORG_ID,worker_id:id,crew_id:crews[0],work_order_id:wo,work_date:inDays(0),status:index===2?'absent':'present',hours:index===2?null:8,source:'roster_tick',project_id:project,recorded_by:ENGINEER_ID}))).select('id'));
  await page.goto(`/crews?view=attendance&wo=${wo}`);
  await expect(page.getByRole('row',{name:new RegExp(`${run} Worker`)})).toContainText('Present');
  await expect(page.getByRole('row',{name:new RegExp(`${run} Person2`)})).toContainText('Present');
  await expect(page.getByRole('row',{name:new RegExp(`${run} Person3`)})).toContainText('Absent');
  await page.reload(); await expect(page.getByRole('row',{name:new RegExp(`${run} Worker`)})).toContainText('Present');
 } finally {
  await db.from('organizations').update({crew_loans_enabled:setting.crew_loans_enabled}).eq('id',ORG_ID);
  for(const id of extraWorkers){await db.from('attendance_days').delete().eq('worker_id',id);await db.from('crew_members').delete().eq('worker_id',id);await db.from('people').delete().eq('id',id);}
  if(worker) await db.from('attendance_days').delete().eq('worker_id',worker);
  if(worker) { await db.from('crew_loans').delete().eq('worker_id',worker); await db.from('crew_members').delete().eq('worker_id',worker); }
  if(wo) await db.from('work_order_crews').delete().eq('work_order_id',wo);
  for(const id of crews) await db.from('crews').delete().eq('id',id);
  if(worker) await db.from('people').delete().eq('id',worker);
  if(wo) await db.from('work_orders').delete().eq('id',wo);
  if(project) await db.from('projects').delete().eq('id',project);
  await db.from('profiles').delete().eq('id',user.id); await db.auth.admin.deleteUser(user.id);
 }
});
