// @e2e-isolation: self-isolated — unique issue type, own project and work order; the issue, its files and the fixture rows are removed in afterEach.
// JOB-PC18 (issue capturer): one person logs issues that arrive by message or call, attaching the screenshot as proof. Goal: the issue on the work
// order shows the attachment and another viewer of the issue can open it.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickComboboxOption, signIn } from './helpers';
import { cleanSiteIssue } from './siteIssueFixture';
import { cleanupAll, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';

test.setTimeout(150_000);

let admin: SupabaseClient;
let issueType = ''; let projectId = ''; let woIds: string[] = [];
test.afterEach(async () => {
  await cleanSiteIssue(issueType);
  if (admin) await cleanupAll(admin, [['work_orders', 'id', woIds], ['projects', 'id', projectId ? [projectId] : []]]);
  issueType = ''; projectId = ''; woIds = [];
});

test('JOB-PC18 an issue logged on a work order with a screenshot shows the attachment to another viewer', async ({ page }) => {
  admin = serviceClient('JOB-PC18');
  const run = runId('JOBPC18');
  const fx = await projectWithWorkOrders(admin, run, ['Coating']);
  projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
  const type = issueType = `E2E-Issue-${run}`;

  await signIn(page, 'engineer@acme.test');
  await page.goto('/incidents');
  await page.getByRole('button', { name: /file incident/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).fill(type);
  await pickComboboxOption(dialog, page, /^project/i, new RegExp(`${run} project`));
  await pickComboboxOption(dialog, page, /work order/i, new RegExp(fx.workOrders[0].number));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await dialog.getByTestId('incident-photo-input').setInputFiles({ name: 'whatsapp-proof.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByText('whatsapp-proof.png')).toBeVisible();
  await dialog.getByRole('button', { name: /^file incident$/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('link', { name: new RegExp(`open ${type}`, 'i') }).click();
  await expect(page.getByTestId('incident-evidence').getByText('whatsapp-proof.png')).toBeVisible({ timeout: 20_000 });
  const issueUrl = page.url();

  // Another viewer opens the same issue and sees the attachment and the work order.
  await signIn(page, 'pm@acme.test');
  await page.goto(issueUrl);
  await expect(page.getByTestId('incident-evidence').getByText('whatsapp-proof.png')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(fx.workOrders[0].number)).toBeVisible();
});
