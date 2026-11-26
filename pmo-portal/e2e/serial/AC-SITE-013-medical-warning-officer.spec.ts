// @e2e-isolation: serial — invokes the scheduled warning job; owns its person, type and document, then removes their notices.
import { test, expect } from '@playwright/test';
import { roleJobUser } from '../support/roleJobUser';
import { siteRole } from '../support/siteRoleJourney';
import { need, ORG_ID, inDays, sql } from '../support/jobJourney';
test('AC-SITE-013 HR officer receives medical warning through its medical right',async({page})=>{
 const actor=await siteRole('hr_officer'); const db=actor.db; const must=need('AC-SITE-013'); const run=crypto.randomUUID();
 const manager=await roleJobUser(db,'construction_manager',`sr-manager-${run}`);
 const worker=await roleJobUser(db,'field_user',`sr-worker-${run}`);
 let person='';let type='';let document='';
 try {
  person=must('person',await db.from('people').insert({org_id:ORG_ID,name:`Worker ${run}`,manager_id:manager.id,profile_id:worker.id}).select('id').single()).id;
  type=must('type',await db.from('document_types').insert({org_id:ORG_ID,name:`Medical ${run}`,applies_to:'person',is_medical:true,notify_roles:['Project Manager'],notify_person:false}).select('id').single()).id;
  document=must('document',await db.from('expiry_documents').insert({org_id:ORG_ID,subject_kind:'person',person_id:person,type_id:type,expires_on:inDays(7),medical_status:'fit'}).select('id').single()).id;
  sql('select public.run_document_expiry_warnings();');
  await actor.login(page); await page.getByRole('button',{name:/^notifications/i}).click();
  await expect(page.getByRole('list',{name:'Notifications'}).getByText(`Medical ${run} expires in 7 days`)).toBeVisible();
  await manager.signIn(page); await page.getByRole('button',{name:/^notifications/i}).click();
  await expect(page.getByRole('list',{name:'Notifications'}).getByText(`Medical ${run} expires in 7 days`)).toBeVisible();
  const plain=must('manager notice',await db.from('notifications').select('metadata').eq('owner_id',manager.id).eq('title',`Medical ${run} expires in 7 days`).single());
  expect(plain.metadata.entity.id).toBeNull(); expect(plain.metadata.email_owner_only).toBe(true);
  // The worker is a field account: it reads its own notices on My work, not in the shell's bell.
  await worker.signIn(page);
  const noticesLoaded = page.waitForResponse(r => r.url().includes('/rest/v1/notifications?') && r.url().includes('limit=21') && r.ok());
  await page.goto('/');
  await noticesLoaded;
  await expect(page.getByRole('heading',{name:'My work'})).toBeVisible({timeout:20_000});
  await expect(page.locator('#my-notices-h')).toBeHidden({timeout:20_000});
  await expect(page.getByText(`Medical ${run} expires in 7 days`)).toHaveCount(0);
 } finally {
  if(document){await db.from('notifications').delete().eq('title',`Medical ${run} expires in 7 days`);await db.from('document_expiry_notices').delete().eq('document_id',document);await db.from('expiry_documents').delete().eq('id',document);}
  if(person)await db.from('people').delete().eq('id',person);if(type)await db.from('document_types').delete().eq('id',type);await actor.cleanup();await manager.cleanup();await worker.cleanup();
 }
});
