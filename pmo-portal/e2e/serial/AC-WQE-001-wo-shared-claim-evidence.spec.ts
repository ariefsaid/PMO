// @e2e-isolation: serial — enables and restores an organisation-wide setting.
import { signIn } from '../helpers';
import { test, expect } from '@playwright/test';
import { siteRole, siteWorkOrder } from '../support/siteRoleJourney';
import { ORG_ID, PM_ID, inDays, need } from '../support/jobJourney';

test('AC-WQE-001 quality document filed once on work order appears as evidence on every claim without re-upload', async ({ page }) => {
  const actor = await siteRole('quality_inspector');
  const db = actor.db;
  const fixture = await siteWorkOrder(db);
  const must = need('AC-WQE-001');
  const before = must('setting', await db.from('organizations').select('work_order_evidence_reuse_enabled').eq('id', ORG_ID).single());
  try {
    must('enable reuse', await db.from('organizations').update({ work_order_evidence_reuse_enabled: true }).eq('id', ORG_ID).select('id').single());
    const step = must('quality step', await db.from('work_order_billing_steps').insert({
      org_id: ORG_ID, work_order_id: fixture.wo, project_id: fixture.project,
      position: 1, name: 'Quality evidence', owner_role_key: 'quality_inspector', started_on: inDays(0),
    }).select('id').single()).id;
    const document = must('proof', await db.from('project_documents').insert({
      id: fixture.run, org_id: ORG_ID, project_id: fixture.project, category: 'Acceptance',
      title: `QC report ${fixture.run}`, status: 'Approved', revision: 'A', author_id: PM_ID,
      file_path: `${ORG_ID}/${fixture.project}/${fixture.run}/qc-report.pdf`,
    }).select('id').single()).id;
    const claims: Array<{ id: string }> = [];
    for (let index = 0; index < 2; index++) {
      claims.push(must('claim', await db.from('progress_claims').insert({
        org_id: ORG_ID, project_id: fixture.project, work_order_id: fixture.wo,
        kind: 'progress', currency: 'IDR', gross_amount: 1000, created_by: PM_ID,
      }).select('id').single()));
    }

    // Quality Inspector files the quality document once on the work order's billing step.
    await actor.login(page);
    await page.goto(`/work-orders/${fixture.wo}`);
    const row = page.getByTestId('wo-billing-step').filter({ hasText: 'Quality evidence' });
    await row.getByRole('combobox', { name: 'Additional document' }).selectOption(document);
    await row.getByRole('button', { name: 'Attach additional document' }).click();
    await expect(row.getByRole('link', { name: `QC report ${fixture.run}` })).toBeVisible();

    // Finance opens both claims on Billing -> Claims -> [Claim]: the quality document is already attached in Evidence
    // and satisfies the claim's evidence requirement (Raise invoice is available without re-uploading or attaching again).
    await signIn(page, 'finance@acme.test');
    for (const claim of claims) {
      await page.goto(`/projects/${fixture.project}?tab=billing&open=${claim.id}&openType=billingClaim`);
      await expect(page).toHaveURL(new RegExp(`open=${claim.id}`));
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('button', { name: `Preview QC report ${fixture.run}` })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Raise invoice' })).toBeVisible();
    }

    const evRows = must('claim evidence rows', await db.from('progress_claim_evidence').select('claim_id,document_id').in('claim_id', claims.map((c) => c.id)));
    expect(evRows).toHaveLength(2);
    expect(evRows.every((r) => r.document_id === document)).toBe(true);
    const stepDoc = must('step doc once', await db.from('work_order_billing_step_documents').select('document_id').eq('step_id', step).single());
    expect(stepDoc.document_id).toBe(document);
  } finally {
    must('restore reuse', await db.from('organizations').update({ work_order_evidence_reuse_enabled: before.work_order_evidence_reuse_enabled }).eq('id', ORG_ID).select('id').single());
    await fixture.cleanup();
    await actor.cleanup();
  }
});
