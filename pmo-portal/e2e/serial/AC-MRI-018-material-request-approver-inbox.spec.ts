// @e2e-isolation: serial - switches the organisation's approvals-inbox setting for material requests on (it adds a section to every approver's /approvals page) and sets the chain; it switches the setting back off in finally.
/** AC-MRI-018 — goal: when a material request needs an approver, that approver finds it in the approvals inbox and is notified; once they decide, both are gone and the next approver has it. */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { inDays } from '../support/jobJourney';
import { SEED_PROJECT_ID, makeItem, runSuffix, userClient } from '../support/stockFixture';

test.setTimeout(180_000);

test('AC-MRI-018: an approver is told and sees the request in the approvals inbox; deciding clears it and hands it to the next approver', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  try {
    // Fixture: an issued work order, a two-step chain (Project Manager, then Finance), and a request from the Engineer.
    const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
    const item = await makeItem(admin, sfx, 'N');
    const draft = await admin.from('work_orders').insert({ org_id: orgId, project_id: SEED_PROJECT_ID, title: `E2E MRI ${sfx}`, order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single();
    if (draft.error) throw new Error('work order: ' + draft.error.message);
    let issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued' });
    if (issue.error && /acknowledg/i.test(issue.error.message)) issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued', p_over_commit_ack: true });
    if (issue.error) throw new Error('work order issue: ' + issue.error.message);
    const chain = await admin.rpc('mrq_set_chain', { p_steps: [
      { role: 'Project Manager', label: 'Plan check', only_over_plan: false },
      { role: 'Finance', label: 'Billable change', only_over_plan: false },
    ] });
    if (chain.error) throw new Error('chain: ' + chain.error.message);

    // An Admin switches the setting on under Administration › Modules (Stock).
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/modules');
    const toggle = page.getByRole('checkbox', { name: /Show material request approvals in the approvals inbox/ });
    await expect(toggle).toBeEnabled({ timeout: 15_000 });
    if (!(await toggle.isChecked())) await toggle.click();
    await expect(toggle).toBeChecked();

    const engineer = await userClient('engineer@acme.test');
    const saved = await engineer.rpc('mrq_save_draft', {
      p_request_id: null,
      p_header: { work_order_id: draft.data.id, needed_by: inDays(5) },
      p_lines: [{ item_id: item.id, quantity: 7, over_plan_reason: 'Extra pour' }],
    });
    if (saved.error) throw new Error('draft: ' + saved.error.message);
    const sent = await engineer.rpc('mrq_submit', { p_request_id: saved.data });
    if (sent.error) throw new Error('submit: ' + sent.error.message);
    const number = (await engineer.from('material_requests').select('number').eq('id', saved.data).single()).data?.number as string;

    // Step 1's approver: the request is in the approvals inbox and in the bell.
    await signIn(page, 'pm@acme.test');
    await page.goto('/approvals');
    const section = page.getByRole('region', { name: 'Material requests awaiting you' });
    await expect(section.getByText(number)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /notifications/i }).click();
    await expect(page.getByRole('button', { name: /material request awaiting your approval/i }).filter({ hasText: number })).toBeVisible();
    await page.keyboard.press('Escape');

    // They open it from the inbox and approve step 1.
    await section.getByRole('link').filter({ hasText: number }).click();
    await expect(page).toHaveURL(new RegExp(`/material-requests/${saved.data}$`));
    // The router keeps /approvals on screen while the lazy detail route loads: act only once the request's own page is up.
    await expect(page.getByTestId('mrq-chain')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Decided: gone from their inbox and their bell.
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('region', { name: 'Material requests awaiting you' }).getByText(number)).toHaveCount(0);
    await page.getByRole('button', { name: /notifications/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /material request awaiting your approval/i }).filter({ hasText: number })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Step 2's approver now has it.
    await signIn(page, 'finance@acme.test');
    await page.goto('/approvals');
    await expect(page.getByRole('region', { name: 'Material requests awaiting you' }).getByText(number)).toBeVisible({ timeout: 15_000 });
  } finally {
    await admin.rpc('mrq_set_approver_inbox', { p_on: false });
  }
});
