// @e2e-isolation: self-isolated — owns a QC login, work order, current quality step and approved project document.
import {test,expect} from '@playwright/test';
import {siteRole,siteWorkOrder} from './support/siteRoleJourney';
import {ORG_ID,PM_ID,inDays,need} from './support/jobJourney';
test('AC-SITE-BQ10 QC attaches evidence once to its owned work-order quality step',async({page})=>{
 const actor=await siteRole('quality_inspector');const db=actor.db;const fixture=await siteWorkOrder(db);const must=need('AC-SITE-BQ10');
 try{
  const step=must('quality step',await db.from('work_order_billing_steps').insert({org_id:ORG_ID,work_order_id:fixture.wo,project_id:fixture.project,position:1,name:'Quality evidence',owner_role_key:'quality_inspector',started_on:inDays(0)}).select('id').single()).id;
  const document=must('proof',await db.from('project_documents').insert({id:fixture.run,org_id:ORG_ID,project_id:fixture.project,category:'Acceptance',title:`Quality proof ${fixture.run}`,status:'Approved',author_id:PM_ID,file_path:`${ORG_ID}/${fixture.project}/${fixture.run}/quality.pdf`}).select('id').single()).id;
  const claims=[]; for(let index=0;index<2;index++) claims.push(must('claim',await db.from('progress_claims').insert({org_id:ORG_ID,project_id:fixture.project,work_order_id:fixture.wo,kind:'progress',currency:'IDR',gross_amount:1000,created_by:PM_ID}).select('id,work_order_id').single()));
  await actor.login(page);await page.goto(`/work-orders/${fixture.wo}`);
  const row=page.getByTestId('wo-billing-step').filter({hasText:'Quality evidence'});
  await row.getByRole('combobox',{name:'Additional document'}).selectOption(document);await row.getByRole('button',{name:'Attach additional document'}).click();
  await expect(row.getByRole('link',{name:`Quality proof ${fixture.run}`})).toBeVisible();await page.reload();await expect(page.getByRole('link',{name:`Quality proof ${fixture.run}`})).toBeVisible();
  for(const claim of claims){await page.goto(`/work-orders/${claim.work_order_id}`);await expect(page.getByRole('link',{name:`Quality proof ${fixture.run}`})).toBeVisible();}
  const evidence=must('evidence saved once',await db.from('work_order_billing_step_documents').select('document_id,attached_by').eq('step_id',step).single());expect(evidence.document_id).toBe(document);expect(evidence.attached_by).toBe(actor.id);
 }finally{await fixture.cleanup();await actor.cleanup();}
});
