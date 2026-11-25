// @e2e-isolation: self-isolated — owns an inspector, client, work order, documents and claims.
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import { siteRole } from './support/siteRoleJourney';
import { createBillingFixture, cleanupBilling } from './support/billingFixture';
import { ORG_ID, inDays, need } from './support/jobJourney';

// The journey is two tests so each stays well inside its time budget: the inspector files the document once, then the
// billing officer's claims reuse it. The second starts from the filed document, set up as the first leaves it.
test('AC-WQE-001 the inspector files a quality document once on the step an admin marked as claim evidence', async ({ page }) => {
  const inspector = await siteRole('quality_inspector');
  const db = inspector.db;
  const must = need('AC-WQE-001');
  const fixture = await createBillingFixture(db, `WQE-${crypto.randomUUID()}`);
  try {
    const step = must('quality step', await db.from('work_order_billing_steps').insert({
      org_id: ORG_ID, work_order_id: fixture.workOrderId, project_id: fixture.projectId,
      position: 1, name: 'Quality evidence', owner_role_key: 'quality_inspector', started_on: inDays(0),
    }).select('id').single()).id;

    // Admin chooses the step whose documents may count for a claim.
    await signIn(page, 'admin@acme.test');
    await page.goto(`/work-orders/${fixture.workOrderId}`);
    const stepRow = page.getByTestId('wo-billing-step').filter({ hasText: 'Quality evidence' });
    const evidenceMark = stepRow.getByRole('checkbox', { name: 'Documents here count as claim evidence' });
    await evidenceMark.click();
    await expect(evidenceMark).toBeChecked();

    // The inspector files the document once on that step.
    await page.evaluate(() => localStorage.clear());
    await inspector.login(page);
    await page.goto(`/work-orders/${fixture.workOrderId}`);
    const quality = page.getByTestId('wo-billing-step').filter({ hasText: 'Quality evidence' });
    await quality.getByRole('combobox', { name: 'Additional document' }).selectOption(fixture.documentId);
    await quality.getByRole('button', { name: 'Attach additional document' }).click();
    await expect(quality.getByRole('link', { name: fixture.documentTitle })).toBeVisible();

    const marked = must('marked step', await db.from('work_order_billing_steps').select('claim_evidence_enabled').eq('id', step).single());
    expect(marked.claim_evidence_enabled).toBe(true);
    const filed = must('work-order evidence', await db.from('work_order_billing_step_documents').select('document_id').eq('step_id', step).single());
    expect(filed.document_id).toBe(fixture.documentId);
  } finally {
    await db.from('work_order_billing_step_documents').delete().eq('work_order_id', fixture.workOrderId);
    await db.from('work_order_billing_steps').delete().eq('work_order_id', fixture.workOrderId);
    await cleanupBilling(db, fixture);
    await inspector.cleanup();
  }
});

test('AC-WQE-001 a quality document filed once makes later claims invoice-eligible', async ({ page }) => {
  const inspector = await siteRole('quality_inspector');
  const billingOfficer = await siteRole('billing_officer', 'Finance');
  const db = inspector.db;
  const must = need('AC-WQE-001');
  const fixture = await createBillingFixture(db, `WQE-${crypto.randomUUID()}`);
  try {
    // What the first journey leaves behind: a marked step with the inspector's document already filed on it.
    const step = must('quality step', await db.from('work_order_billing_steps').insert({
      org_id: ORG_ID, work_order_id: fixture.workOrderId, project_id: fixture.projectId,
      position: 1, name: 'Quality evidence', owner_role_key: 'quality_inspector', started_on: inDays(0), claim_evidence_enabled: true,
    }).select('id').single()).id;
    must('filed document', await db.from('work_order_billing_step_documents').insert({
      org_id: ORG_ID, step_id: step, work_order_id: fixture.workOrderId, position: 1, name: fixture.documentTitle, required: false,
      document_id: fixture.documentId, attached_by: inspector.id, attached_at: new Date().toISOString(),
    }).select('id').single());

    // The billing officer makes each claim without attaching the document again.
    await billingOfficer.login(page);
    await page.goto(`/projects/${fixture.projectId}/contract`);
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: 'New claim' }).click();
      const form = page.getByRole('dialog');
      await form.getByLabel('Bills', { exact: true }).selectOption(fixture.workOrderId);
      await form.getByLabel(/SURVEY/).fill(index === 0 ? '2' : '3');
      await form.getByRole('button', { name: 'Create claim' }).click();
      const evidence = page.getByRole('dialog', { name: 'Attach billing evidence' });
      await expect(evidence).toBeVisible();
      await evidence.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(evidence).toBeHidden();
      const claims = must('claims', await db.from('progress_claims').select('id').eq('work_order_id', fixture.workOrderId).order('created_at'));
      expect(claims).toHaveLength(index + 1);
      const row = page.getByRole('row').or(page.getByRole('listitem')).filter({ hasText: index === 0 ? '100,000' : '150,000' });
      await row.getByRole('button', { name: /^Open Progress claim/ }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('button', { name: `Preview ${fixture.documentTitle}` })).toBeVisible();
      const raise = drawer.getByRole('button', { name: 'Raise invoice' });
      await expect(raise).toBeEnabled();
      await raise.click();
      const confirm = page.getByRole('dialog', { name: "Create this claim's invoice?" });
      await expect(confirm.getByRole('button', { name: 'Create invoice' })).toBeEnabled();
      await confirm.getByRole('button', { name: 'Cancel' }).click();
    }
    const claimRows = must('claims', await db.from('progress_claims').select('id').eq('work_order_id', fixture.workOrderId));
    const evidence = must('claim evidence', await db.from('progress_claim_evidence').select('claim_id,document_id').in('claim_id', claimRows.map((row) => row.id)));
    expect(evidence).toHaveLength(2);
    expect(evidence.every((row) => row.document_id === fixture.documentId)).toBe(true);
    const filed = must('work-order evidence', await db.from('work_order_billing_step_documents').select('document_id').eq('step_id', step).single());
    expect(filed.document_id).toBe(fixture.documentId);
  } finally {
    await db.from('work_order_billing_step_documents').delete().eq('work_order_id', fixture.workOrderId);
    await db.from('work_order_billing_steps').delete().eq('work_order_id', fixture.workOrderId);
    await cleanupBilling(db, fixture);
    await inspector.cleanup();
    await billingOfficer.cleanup();
  }
});
