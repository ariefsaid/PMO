// @e2e-isolation: self-isolated — creates its own unique project (Date.now()) and edits only that row; no seed coupling.
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption, openPipelineCard, waitForFonts } from './helpers';

/**
 * AC-CHG-019 — Project change history (record-change-history spec D5), real user journey.
 *
 * A PM creates a project, edits its header twice, then opens the project's History tab. GOAL ORACLE:
 * the top entry shows who changed it, that it just happened, and the change as `old → new`; the
 * second edit appears above the first. Mobile: the tab never scrolls the page sideways.
 */
test.setTimeout(120_000);

async function editName(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: /^Edit$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  const input = dialog.getByLabel(/project name/i);
  await input.clear();
  await input.fill(name);
  await dialog.getByRole('button', { name: /save project/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });
}

test('AC-CHG-019: a PM edits a project twice and the History tab shows who, when and old → new, newest first', async ({ page }) => {
  const runId = Date.now();
  const original = `E2E-History-${runId}`;
  const first = `${original}-B`;
  const second = `${original}-C`;

  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('button', { name: /new project/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.getByLabel(/project name/i).fill(original);
  await pickComboboxOption(dialog, page, /client company/i, 'first');
  await dialog.getByRole('button', { name: /^Create project$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  await page.goto('/sales');
  await openPipelineCard(page, original);
  const projectUrl = page.url().replace(/\/(history)?$/, '');

  await editName(page, first);
  await editName(page, second);

  await page.goto(`${projectUrl}/history`);
  await expect(page.getByRole('tab', { name: 'History', selected: true })).toBeVisible({ timeout: 15_000 });
  const events = page.getByTestId('history-event');
  await expect(events.first()).toBeVisible({ timeout: 15_000 });

  // Newest first: the second edit is on top, who + when + old → new.
  await expect(events.first()).toContainText('Diego Salvatierra');
  await expect(events.first()).toContainText(`${first} → ${second}`);
  await expect(events.first()).toContainText(/minute|second|now/i);
  await expect(events.nth(1)).toContainText(`${original} → ${first}`);

  // Mobile: no horizontal overflow (fonts settled before measuring).
  await page.setViewportSize({ width: 390, height: 800 });
  await waitForFonts(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
