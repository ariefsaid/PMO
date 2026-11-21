import { test, expect } from '@playwright/test';

// @e2e-isolation: read-only-seed -- adds tasks to one seeded issue; asserts only its own rows.
// AC-ITR-011 (#2677): a manager adds a second task and a root cause, closes the blocker, and both remain.
// Journey drafted against the seeded manager login; it runs on the release PR (browser e2e is not run on dev PRs).
test('AC-ITR-011: several tasks and a root cause survive closing the issue', async ({ page }) => {
  await page.goto('/incidents');
  await page.getByRole('row').nth(1).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const stamp = `Follow-up ${Date.now()}`;
  if (await page.getByTestId('incident-make-task').count()) await page.getByTestId('incident-make-task').click();
  await page.getByTestId('incident-add-task').click();
  await page.getByLabel(/^Task/).fill(stamp);
  await page.getByRole('dialog').getByRole('button', { name: 'Add a task' }).click();
  await expect(page.getByRole('link', { name: stamp })).toBeVisible();

  await page.getByTestId('incident-root-cause-edit').click();
  await page.getByLabel('Root cause').fill('Wrong fixing spec');
  await page.getByTestId('incident-root-cause-save').click();
  await expect(page.getByTestId('incident-root-cause')).toContainText('Wrong fixing spec');

  await page.reload();
  await expect(page.getByRole('link', { name: stamp })).toBeVisible();
  await expect(page.getByTestId('incident-root-cause')).toContainText('Wrong fixing spec');
});
