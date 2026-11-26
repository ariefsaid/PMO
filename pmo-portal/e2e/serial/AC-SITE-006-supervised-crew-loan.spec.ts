// @e2e-isolation: serial — restores the organisation crew-loans setting; all workforce rows belong to this journey.
import { jobRoleUser } from '../support/jobRole';
import { test, expect } from '@playwright/test';
import { serviceClient, need, ORG_ID, PM_ID, inDays } from '../support/jobJourney';
import { siteRole } from '../support/siteRoleJourney';
import { markEveryonePresent } from '../support/crewJourney';
const db = serviceClient('AC-SITE-006');
const must = need('AC-SITE-006');
test('AC-SITE-006 a supervisor lends between work-order crews controlled by a separate foreman', async ({ page }) => {
 const foreman = await siteRole('foreman');
 const run = crypto.randomUUID();
 const user = await jobRoleUser({ jobRole: 'site_supervisor', role: 'Engineer', org: ORG_ID, service: db, run: `site-${run}`, displayName: 'Site supervisor' });
 const { email, password } = user;
 const setting = must('setting', await db.from('organizations').select('crew_loans_enabled').eq('id', ORG_ID).single());
 const crews: string[] = []; let project = ''; let wo = ''; let hostWo = ''; let worker = '';
 try {
  must('enable loans', await db.from('organizations').update({crew_loans_enabled:true}).eq('id',ORG_ID).select('id').single());
  project=must('project',await db.from('projects').insert({org_id:ORG_ID,name:run,status:'Ongoing Project',project_manager_id:PM_ID}).select('id').single()).id;
  wo=must('work order',await db.from('work_orders').insert({org_id:ORG_ID,project_id:project,title:run,status:'Issued',order_value:1000,tax_treatment:'exclusive',tax_amount:0,responsible_person_id:user.id,start_date:inDays(-1),end_date:inDays(1)}).select('id').single()).id;
  hostWo=must('host work order',await db.from('work_orders').insert({org_id:ORG_ID,project_id:project,title:`${run} Host work`,status:'Issued',order_value:1000,tax_treatment:'exclusive',tax_amount:0,responsible_person_id:user.id,start_date:inDays(-1),end_date:inDays(1)}).select('id').single()).id;
  for (const name of ['Home','Host']) {
   const id=must(name,await db.from('crews').insert({org_id:ORG_ID,code:`${run.slice(0,8)}${name}`,name:`${run} ${name}`,field_controller_id:foreman.id}).select('id').single()).id;
   crews.push(id); must('roster',await db.from('work_order_crews').insert({org_id:ORG_ID,work_order_id:name === 'Home' ? wo : hostWo,crew_id:id,valid_from:inDays(-1)}).select('id').single());
  }
  worker=must('worker',await db.from('people').insert({org_id:ORG_ID,name:`${run} Worker`,kind:'own'}).select('id').single()).id;
  must('placement',await db.from('crew_members').insert({org_id:ORG_ID,crew_id:crews[0],worker_id:worker,valid_from:inDays(-1)}).select('id').single());
  await page.goto('/login'); await page.getByLabel(/email/i).fill(email); await page.getByLabel(/password/i).fill(password); await page.getByRole('button',{name:/sign in/i}).click(); await expect(page).toHaveURL(/\/$/);
  await page.goto('/crews'); await page.getByTestId('crew-loans').getByRole('button',{name:'Lend worker'}).first().click();
  const dialog=page.getByRole('dialog'); await dialog.getByRole('combobox',{name:'Home crew'}).selectOption(crews[0]); await dialog.getByRole('combobox',{name:'Person'}).selectOption(worker); await dialog.getByRole('combobox',{name:'Host crew'}).selectOption(crews[1]);
  await dialog.getByLabel(/^From/).fill(inDays(0));await dialog.getByLabel(/^From/).press('Tab');await dialog.getByLabel(/^To/).fill(inDays(0));await dialog.getByLabel(/^To/).press('Tab');
  await dialog.getByRole('button',{name:'Lend worker'}).click(); await expect(dialog).toHaveCount(0);
  await page.reload(); await expect(page.getByTestId('crew-loans').getByRole('row',{name:new RegExp(`${run} Worker`)})).toContainText(`${run} Host`);
  await page.goto(`/crews?view=roster&wo=${hostWo}`);await expect(page.getByText(`${run} Worker`,{exact:true})).toBeVisible();
  await page.goto(`/crews?view=roster&wo=${wo}`);await expect(page.getByText(`${run} Worker`,{exact:true})).toHaveCount(0);
  await page.evaluate(()=>localStorage.clear());await page.context().clearCookies();await foreman.login(page);
  const host=page.getByRole('region', { name: 'My crew today' }).getByText(`${run} Host work`,{exact:true}).locator('..');
  await host.getByRole('textbox',{name:'Hours for the crew'}).fill('8');await markEveryonePresent(host);await host.getByRole('button',{name:'Save attendance'}).click();
  await expect.poll(async()=> (await db.from('attendance_days').select('hours').eq('worker_id',worker).eq('work_order_id',hostWo).single()).data?.hours).toBe(8);
  const homeDays=must('home hours',await db.from('attendance_days').select('id').eq('worker_id',worker).eq('work_order_id',wo));expect(homeDays).toHaveLength(0);
  const loan=must('recorded actor',await db.from('crew_loans').select('created_by').eq('worker_id',worker).single()); expect(loan.created_by).toBe(user.id);
 } finally {
  await db.from('organizations').update({crew_loans_enabled:setting.crew_loans_enabled}).eq('id',ORG_ID);
  if(worker) await db.from('attendance_days').delete().eq('worker_id',worker);
  if(worker) { await db.from('crew_loans').delete().eq('worker_id',worker); await db.from('crew_members').delete().eq('worker_id',worker); }
  if(hostWo) await db.from('work_order_crews').delete().eq('work_order_id',hostWo);
  if(wo) await db.from('work_order_crews').delete().eq('work_order_id',wo);
  for(const id of crews) await db.from('crews').delete().eq('id',id);
  if(worker) await db.from('people').delete().eq('id',worker);
  if(hostWo) await db.from('work_orders').delete().eq('id',hostWo);
  if(wo) await db.from('work_orders').delete().eq('id',wo);
  if(project) await db.from('projects').delete().eq('id',project);
  await db.from('profiles').delete().eq('id',user.id); await db.auth.admin.deleteUser(user.id); await foreman.cleanup();
 }
});
