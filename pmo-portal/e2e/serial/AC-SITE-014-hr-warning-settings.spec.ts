// @e2e-isolation: serial — changes organisation warning days, restores them in finally and owns its HR Manager login.
import {visibleToast} from '../helpers';
import {test,expect} from '@playwright/test';
import {siteRole} from '../support/siteRoleJourney';
import {need,ORG_ID} from '../support/jobJourney';
test('AC-SITE-014 HR Manager finds Document types directly and saves warning days',async({page})=>{
 const actor=await siteRole('hr_manager','Project Manager');const db=actor.db;const must=need('AC-SITE-014');
 const setting=must('setting',await db.from('organizations').select('document_warning_days').eq('id',ORG_ID).single());
 try {
  await actor.login(page);await page.goto('/administration/people');
  await page.getByRole('link',{name:'Document types',exact:true}).click();await expect(page).toHaveURL(/\/administration\/document-types$/);
  await page.getByLabel('Warn this many days before expiry').fill('31, 15, 8');await page.getByRole('button',{name:'Save warning days'}).click();
  await expect(visibleToast(page,'Warning days saved')).toBeVisible();
  await page.reload();await expect(page.getByLabel('Warn this many days before expiry')).toHaveValue('31, 15, 8');
 }finally{await db.from('organizations').update({document_warning_days:setting.document_warning_days}).eq('id',ORG_ID);await actor.cleanup();}
});
