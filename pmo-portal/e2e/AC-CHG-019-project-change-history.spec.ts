// @e2e-isolation: self-isolated — creates its own unique project (Date.now()), edits only that row, and archives it at the end; reads the seed client companies without writing them.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, pickComboboxOption, openPipelineCard, waitForFonts, visibleToast } from './helpers';

/**
 * AC-CHG-019 — Project change history (record-change-history spec D5), real user journey.
 *
 * A PM creates a project for one client with an expected end date, then edits its CLIENT and END DATE
 * in one save, then moves the end date again, and opens the project's History tab. GOAL ORACLE: the top
 * entry is the latest save — the PM's name, "just now", `End date: old → new`; the save below it shows
 * `Client: <A> → <B>` and the first date move, both as names / formatted dates (never uuids or ISO).
 * Mobile: the tab never scrolls the page sideways. Cleanup: an Executive archives the project.
 */
test.setTimeout(150_000);

// Seed client companies (read, never written here). Matched by prefix: the shared local DB may carry a
// suffix another session gave the legal name — the oracle is "a company NAME, not a uuid".
const CLIENT_A = 'Meridian Steelworks';
const CLIENT_B = 'Cascade Foods Processing';

/** Open the header edit form, apply `edit`, save, and wait for the dialog to close. */
async function editProject(page: Page, edit: (dialog: Locator) => Promise<void>) {
  await page.getByRole('button', { name: /^Edit$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await edit(dialog);
  await dialog.getByRole('button', { name: /save project/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
}

test('AC-CHG-019: a PM edits a project\'s client and end date and the History tab shows who, when and old → new, newest first', async ({ page }) => {
  const name = `E2E-History-${Date.now()}`;

  // ── The PM creates a project for client A, ending 30 Nov 2026 ─────────────────────────────────
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('button', { name: /new project/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.getByLabel(/project name/i).fill(name);
  await pickComboboxOption(dialog, page, /client company/i, new RegExp(CLIENT_A));
  await dialog.getByLabel(/expected end/i).fill('2026-11-30');
  await dialog.getByRole('button', { name: /^Create project$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  await page.goto('/sales');
  await openPipelineCard(page, name);
  const projectUrl = page.url().match(/^.*\/projects\/[^/?#]+/)![0];

  // ── Save 1: client A → B and end date 30 Nov → 31 Dec, in one save ─────────────────────────────
  await editProject(page, async (d) => {
    await pickComboboxOption(d, page, /client company/i, new RegExp(CLIENT_B));
    await d.getByLabel(/expected end/i).fill('2026-12-31');
  });
  // ── Save 2: end date 31 Dec 2026 → 15 Jan 2027 ─────────────────────────────────────────────────
  await editProject(page, async (d) => {
    await d.getByLabel(/expected end/i).fill('2027-01-15');
  });

  await page.goto(`${projectUrl}/history`);
  await expect(page.getByRole('tab', { name: 'History', selected: true })).toBeVisible({ timeout: 15_000 });
  const events = page.getByTestId('history-event');
  await expect(events.first()).toBeVisible({ timeout: 15_000 });

  // Newest first: save 2 on top — who, when, the date move as formatted dates.
  await expect(events.first()).toContainText('Diego Salvatierra');
  await expect(events.first()).toContainText(/minute|second|now/i);
  await expect(events.first()).toContainText(/End date: \D*31\D*2026 → \D*15\D*2027/);
  // Save 1 below it: the client by name, and the first date move.
  await expect(events.nth(1)).toContainText(new RegExp(`Client: ${CLIENT_A}[^→]* → ${CLIENT_B}`));
  await expect(events.nth(1)).toContainText(/End date: \D*30\D*2026 → \D*31\D*2026/);
  await expect(events.nth(1)).toContainText('Diego Salvatierra');

  // Mobile: no horizontal overflow (fonts settled before measuring).
  await page.setViewportSize({ width: 390, height: 800 });
  await waitForFonts(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // ── Cleanup (self-isolated): an Executive archives the project so reruns leave no live rows ────
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await login(page, 'exec@acme.test');
  await page.goto('/sales');
  await openPipelineCard(page, name);
  await page.getByRole('button', { name: /Archive/i }).click();
  const archiveDialog = page.getByRole('alertdialog');
  await expect(archiveDialog).toBeVisible({ timeout: 8_000 });
  await archiveDialog.getByRole('button', { name: /archive project/i }).click();
  // The confirm closes only once the archive has saved (a refusal keeps it open with a toast).
  await expect(archiveDialog).not.toBeVisible({ timeout: 15_000 });
  await expect(visibleToast(page, 'Project archived')).toBeVisible({ timeout: 15_000 });
});
