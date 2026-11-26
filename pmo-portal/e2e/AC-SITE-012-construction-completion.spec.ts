// @e2e-isolation: self-isolated — owns its CM login, project, work order, open checklist item and approved proof.
import {test,expect} from '@playwright/test';
import {siteRole,siteWorkOrder} from './support/siteRoleJourney';
import {signIn} from './helpers';
import {ORG_ID,PM_ID,inDays,need} from './support/jobJourney';
import { openRowUpdate, openWorkOrderArea } from './support/workOrderArea';
test('AC-SITE-012 Admin names the CM owner and the CM files proof and confirms physical completion',async({page})=>{
 const actor=await siteRole('construction_manager','Project Manager');const db=actor.db;const fixture=await siteWorkOrder(db);const must=need('AC-SITE-012');
 try{
  const item=must('item',await db.from('work_order_closeout_items').insert({org_id:ORG_ID,work_order_id:fixture.wo,project_id:fixture.project,position:1,name:'Physical completion',required:true,started_on:inDays(0)}).select('id').single()).id;
  must('proof',await db.from('project_documents').insert({id:fixture.run,org_id:ORG_ID,project_id:fixture.project,category:'Acceptance',title:`Proof ${fixture.run}`,status:'Approved',author_id:PM_ID,file_path:`${ORG_ID}/${fixture.project}/${fixture.run}/proof.pdf`}).select('id').single());
  await signIn(page,'admin@acme.test');await page.goto(`/work-orders/${fixture.wo}`);await openWorkOrderArea(page,'checks');
  await (await openRowUpdate(page,'Physical completion')).getByRole('combobox',{name:'Owner job role'}).selectOption('construction_manager');
  await expect.poll(async()=> (await db.from('work_order_closeout_items').select('owner_job_role').eq('id',item).single()).data?.owner_job_role).toBe('construction_manager');
  await page.context().clearCookies();await page.evaluate(()=>localStorage.clear());await actor.login(page);await page.goto(`/work-orders/${fixture.wo}`);await openWorkOrderArea(page,'checks');
  await openRowUpdate(page,'Physical completion');
  await page.getByRole('combobox',{name: 'Project documents'}).selectOption({label:`Proof ${fixture.run}`});await page.getByRole('button',{name:'Attach to Physical completion'}).click();await page.getByRole('button',{name:'Mark Physical completion done'}).click();
  // Walk F12-3: the ticked item shows who did it and on which day.
  const [dy,dm,dd]=inDays(0).split('-').map(Number);const doneLabel=`Done ${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dm-1]} ${dy}`;
  await expect(page.getByRole('listitem',{name:'Physical completion'})).toContainText('Test construction_manager');
  await expect(page.getByRole('listitem',{name:'Physical completion'})).toContainText(doneLabel);
  await page.reload();await expect(page.getByRole('listitem',{name:'Physical completion'})).toContainText('Test construction_manager');
  await expect(page.getByRole('listitem',{name:'Physical completion'})).toContainText(doneLabel);
  const saved=must('completion',await db.from('work_order_closeout_items').select('done_by,done_on').eq('id',item).single());expect(saved.done_by).toBe(actor.id);expect(saved.done_on).toBe(inDays(0));
 }finally{await fixture.cleanup();await actor.cleanup();}
});
