// @e2e-isolation: self-isolated — unique issue type, own project and work order, and its own project-administrator and engineer logins; the issue, its files and the fixture rows are removed in finally.
// JOB-PC18 (issue capturer): one person logs issues that arrive by message or call, attaching the screenshot as proof. Goal: the issue on the work
// order shows the attachment and another viewer of the issue can open it.
import { test, expect } from '@playwright/test';
import { pickComboboxOption } from './helpers';
import { addIssueType, cleanSiteIssue } from './siteIssueFixture';
import { cleanupAll, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(150_000);

test('JOB-PC18 a project administrator logs an issue with a screenshot and another viewer opens the attachment', async ({ page }) => {
  const admin = serviceClient('JOB-PC18');
  const run = runId('JOBPC18');
  const capturer = await roleJobUser(admin, 'project_administrator', `${run}-pa`);
  const viewer = await roleJobUser(admin, 'engineer', `${run}-eng`);
  const type = `E2E-Issue-${run}`;
  let projectId = '';
  let woIds: string[] = [];

  try {
    const fx = await projectWithWorkOrders(admin, run, ['Coating']);
    projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);

    await addIssueType(type);
    await capturer.signIn(page);
    await page.goto('/incidents');
    await page.getByTestId('list-page-header').getByRole('button', { name: /file incident/i }).click();
    const dialog = page.getByRole('dialog', { name: /file incident/i });
    await dialog.getByLabel(/^type/i).selectOption({ label: type });
    await pickComboboxOption(dialog, page, /^project/i, new RegExp(`${run} project`));
    await pickComboboxOption(dialog, page, /work order/i, new RegExp(fx.workOrders[0].number));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await dialog.getByTestId('incident-photo-input').setInputFiles({ name: 'whatsapp-proof.png', mimeType: 'image/png', buffer: png });
    await expect(dialog.getByRole('list', { name: /photos/i }).getByText('whatsapp-proof.png')).toBeVisible();
    await dialog.getByRole('button', { name: /^file incident$/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    await page.getByRole('link', { name: new RegExp(`open ${type}`, 'i') }).click();
    await expect(page.getByTestId('incident-evidence').getByText('whatsapp-proof.png')).toBeVisible({ timeout: 20_000 });
    const issueUrl = page.url();

    // Another viewer opens the same issue and sees the attachment and the work order.
    await viewer.signIn(page);
    await page.goto(issueUrl);
    await expect(page.getByTestId('incident-evidence').getByText('whatsapp-proof.png')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(fx.workOrders[0].number)).toBeVisible();
    // The viewer opens the attachment: it opens in a new tab on a signed link that serves the file.
    const opened = page.context().waitForEvent('page');
    await page.getByTestId('incident-evidence').getByRole('button', { name: 'whatsapp-proof.png' }).click();
    const tab = await opened;
    await tab.waitForLoadState('domcontentloaded');
    expect(tab.url()).toMatch(/\/storage\/v1\/object\/sign\/incident-files\//);
    const served = await page.request.get(tab.url());
    expect(served.ok()).toBe(true);
    expect(served.headers()['content-type']).toContain('image/png');
  } finally {
    await cleanSiteIssue(type);
    await cleanupAll(admin, [['work_orders', 'id', woIds], ['projects', 'id', projectId ? [projectId] : []]]);
    await viewer.cleanup();
    await capturer.cleanup();
  }
});
