// @e2e-isolation: serial — restores the organisation crew-loans setting; all workforce rows belong to this journey.
import { jobRoleUser } from '../support/jobRole';
import { test, expect } from '@playwright/test';
import { serviceClient, need, ORG_ID, PM_ID, ENGINEER_ID, inDays } from '../support/jobJourney';
const db = serviceClient('AC-SITE-017');
const must = need('AC-SITE-017');
test('AC-SITE-017 a supervisor creates a task from a project issue on its current work-order project', async ({ page }) => {
 const run = crypto.randomUUID();
 const user = await jobRoleUser({ jobRole: 'site_supervisor', role: 'Engineer', org: ORG_ID, service: db, run: `site-${run}`, displayName: 'Site supervisor' });
 const { email, password } = user;
 const setting = must('setting', await db.from('organizations').select('crew_loans_enabled').eq('id', ORG_ID).single());
 const crews: string[] = []; let project = ''; let wo = ''; let worker = '';
 try {
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
  const issue=must('issue',await db.from('incident_reports').insert({org_id:ORG_ID,project_id:project,incident_date:inDays(0),type:'Safety',severity:'Low',reported_by:user.id}).select('id').single());
  await page.goto(`/incidents/${issue.id}`);
  await page.getByRole('button',{name:'Add a task'}).click(); const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Task',exact:true}).fill(`Secure area ${run}`);
  await dialog.getByRole('button',{name:'Add a task'}).click(); await expect(dialog).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('link',{name:`Secure area ${run}`})).toBeVisible();
 } finally {
  await db.from('organizations').update({crew_loans_enabled:setting.crew_loans_enabled}).eq('id',ORG_ID);
  await db.from('incident_tasks').delete().eq('org_id',ORG_ID).eq('created_by',user.id);
  await db.from('incident_reports').delete().eq('project_id',project);
  await db.from('tasks').delete().eq('project_id',project);
  if(worker) { await db.from('crew_loans').delete().eq('worker_id',worker); await db.from('crew_members').delete().eq('worker_id',worker); }
  if(wo) await db.from('work_order_crews').delete().eq('work_order_id',wo);
  for(const id of crews) await db.from('crews').delete().eq('id',id);
  if(worker) await db.from('people').delete().eq('id',worker);
  if(wo) await db.from('work_orders').delete().eq('id',wo);
  if(project) await db.from('projects').delete().eq('id',project);
  await db.from('profiles').delete().eq('id',user.id); await db.auth.admin.deleteUser(user.id);
 }
});
