// @e2e-isolation: self-isolated — owns an inspector, billing officer, client, work order, documents and claims.
// JOB-BQ10 (acceptance 04-hes-and-quality, TC-BQ-09): quality documents once per work order. Ruled path: the Quality Inspector files
// the document on the work order's quality step; the Billing Officer (the inspector cannot open claims) sees it already attached
// on the second claim. Same path as AC-WQE-001, written as the job.
import { expect, test } from '@playwright/test';
import { prepareQualityEvidence } from './support/qualityEvidenceSetup';
import { signIn } from './helpers';
import { jobRoleUser } from './support/jobRole';
import { signInJourneyActor } from './support/seedSession';
import { createBillingFixture, cleanupBilling } from './support/billingFixture';
import { ORG_ID, inDays, need, serviceClient } from './support/jobJourney';
import { openRowUpdate, openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(180_000);

let inspector: Awaited<ReturnType<typeof jobRoleUser>>;
let billingOfficer: Awaited<ReturnType<typeof jobRoleUser>>;
let db: ReturnType<typeof serviceClient>;
let must = need('JOB-BQ10');
let fixture: Awaited<ReturnType<typeof createBillingFixture>>;
let step = '';
test.beforeEach(async () => {
  db = serviceClient('JOB-BQ10');
  inspector = await jobRoleUser({ service: db, jobRole: 'quality_inspector', role: 'Engineer' });
  billingOfficer = await jobRoleUser({ service: db, jobRole: 'billing_officer', role: 'Finance' });
  must = need('JOB-BQ10');
  fixture = await createBillingFixture(db, `BQ10-${crypto.randomUUID()}`);
  step = must(
    'quality step',
    await db
      .from('work_order_billing_steps')
      .insert({
        org_id: ORG_ID,
        work_order_id: fixture.workOrderId,
        project_id: fixture.projectId,
        position: 1,
        name: 'Quality evidence',
        owner_role_key: 'quality_inspector',
        started_on: inDays(0),
      })
      .select('id')
      .single(),
  ).id;
});

test.afterEach(async () => {
  await db
    .from('work_order_billing_step_documents')
    .delete()
    .eq('work_order_id', fixture.workOrderId);
  await db.from('work_order_billing_steps').delete().eq('work_order_id', fixture.workOrderId);
  await cleanupBilling(db, fixture);
  await inspector.cleanup();
  await billingOfficer.cleanup();
});

test('JOB-BQ10 Admin selects the quality step whose documents count as claim evidence', async ({
  page,
}) => {
  // Admin chooses the step whose documents may count for a claim.
  await signIn(page, 'admin@acme.test');
  await page.goto(`/work-orders/${fixture.workOrderId}`);
  await openWorkOrderArea(page, 'billing');
  const stepRow = page.getByTestId('wo-billing-step').filter({ hasText: 'Quality evidence' });
  await expect(stepRow).toBeVisible({ timeout: 30_000 }); // first load of the work order route on the dev server
  const evidenceMark = (await openRowUpdate(page, 'Quality evidence')).getByRole('checkbox', {
    name: 'Documents here count as claim evidence',
  });
  await evidenceMark.click();
  await expect(evidenceMark).toBeChecked();
});

test('JOB-BQ10 the Quality Inspector files the evidence document once', async ({ page }) => {
  await prepareQualityEvidence(step, fixture, 'enabled');
  // The inspector files the document once on that step.
  await signInJourneyActor(page, inspector.email, inspector.password);
  await page.goto(`/work-orders/${fixture.workOrderId}`);
  await openWorkOrderArea(page, 'billing');
  const quality = page.getByTestId('wo-billing-step').filter({ hasText: 'Quality evidence' });
  await expect(quality).toBeVisible({ timeout: 30_000 });
  const qualityUpdate = await openRowUpdate(page, 'Quality evidence');
  await qualityUpdate
    .getByRole('combobox', { name: 'Additional document' })
    .selectOption(fixture.documentId);
  await qualityUpdate.getByRole('button', { name: 'Attach additional document' }).click();
  await expect(qualityUpdate.getByRole('link', { name: fixture.documentTitle })).toBeVisible();
});

for (const index of [0, 1]) {
  test(`JOB-BQ10 the Billing Officer inherits quality evidence on claim ${index + 1}`, async ({
    page,
  }) => {
    await prepareQualityEvidence(step, fixture, index === 0 ? 'attached' : 'firstClaim');
    // The billing officer makes each claim without attaching the document again.
    await signInJourneyActor(page, billingOfficer.email, billingOfficer.password);
    await page.goto(`/projects/${fixture.projectId}/contract`);
    const newClaim = page.getByRole('button', { name: 'New claim' });
    await expect(newClaim).toBeVisible({ timeout: 30_000 });
    await newClaim.click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Bills', { exact: true }).selectOption(fixture.workOrderId);
    await form.getByLabel(/SURVEY/).fill(index === 0 ? '2' : '3');
    await form.getByRole('button', { name: 'Create claim' }).click();
    const evidence = page.getByRole('dialog', { name: 'Attach billing evidence' });
    await expect(evidence).toBeVisible();
    await evidence.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(evidence).toBeHidden();
    const claims = must(
      'claims',
      await db
        .from('progress_claims')
        .select('id')
        .eq('work_order_id', fixture.workOrderId)
        .order('created_at'),
    );
    expect(claims).toHaveLength(index + 1);
    const row = page
      .getByRole('row')
      .or(page.getByRole('listitem'))
      .filter({ hasText: index === 0 ? '100,000' : '150,000' });
    await row.getByRole('button', { name: /^Open Progress claim/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(
      drawer.getByRole('button', { name: `Preview ${fixture.documentTitle}` }),
    ).toBeVisible();
    const raise = drawer.getByRole('button', { name: 'Raise invoice' });
    await expect(raise).toBeEnabled();
    await raise.click();
    const confirm = page.getByRole('dialog', { name: "Create this claim's invoice?" });
    await expect(confirm.getByRole('button', { name: 'Create invoice' })).toBeEnabled();
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    if (index === 1) {
      const claimRows = must(
        'claims',
        await db.from('progress_claims').select('id').eq('work_order_id', fixture.workOrderId),
      );
      const evidence = must(
        'claim evidence',
        await db
          .from('progress_claim_evidence')
          .select('claim_id,document_id')
          .in(
            'claim_id',
            claimRows.map((row) => row.id),
          ),
      );
      expect(evidence).toHaveLength(2);
      expect(evidence.every((row) => row.document_id === fixture.documentId)).toBe(true);
      const filed = must(
        'work-order evidence',
        await db
          .from('work_order_billing_step_documents')
          .select('document_id')
          .eq('step_id', step)
          .single(),
      );
      expect(filed.document_id).toBe(fixture.documentId);
    }
  });
}
