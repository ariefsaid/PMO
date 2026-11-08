// @e2e-isolation: read-only — signs in to the seeded author meeting and makes an unsaved browser-only edit; it performs no database write.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

const SEEDED_MEETING = 'ee000000-0000-0000-0000-000000000001';
const UNSAVED_LINE = 'Unsaved guard browser-only edit';

test('AC-MTG-300: dirty minutes breadcrumb offers Stay and Leave without losing the edit', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto(`/meetings/${SEEDED_MEETING}`);

  // #2062: the record opens as a READ view — the author enters the editor deliberately.
  await page.getByTestId('minutes-edit').click();
  const minutesEditor = page.getByTestId('minutes-blocknote').locator('.bn-editor');
  await expect(minutesEditor).toBeVisible({ timeout: 20_000 }); // lazy BlockNote chunk
  await minutesEditor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(UNSAVED_LINE);
  await expect(page.getByTestId('minutes-save')).toBeEnabled();

  const meetingsCrumb = page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Meetings', exact: true });
  await meetingsCrumb.click();

  const dialog = page.getByRole('dialog', { name: 'Unsaved meeting changes' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/meetings/${SEEDED_MEETING}$`));
  await expect(minutesEditor).toContainText(UNSAVED_LINE);
  await expect(page.getByTestId('minutes-save')).toBeEnabled();

  await meetingsCrumb.click();
  await expect(page.getByRole('dialog', { name: 'Unsaved meeting changes' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Unsaved meeting changes' }).getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(page.getByRole('heading', { name: /meetings/i }).first()).toBeVisible();
});

/**
 * #1525 — the browser's own Back button, not just an in-app link, must ask before discarding a
 * dirty editor. The list entry is reached in-app (a router PUSH), so Back is a real POP the
 * router holds; the oracle is the dialog plus where the user ends up.
 */
test('AC-MTG-301: browser Back on dirty minutes asks before discarding and keeps the edit on Stay', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/meetings');
  await page.getByText('Meridian PV — weekly site coordination').click();
  await expect(page).toHaveURL(new RegExp(`/meetings/${SEEDED_MEETING}$`), { timeout: 15_000 });

  // #2062: the record opens as a READ view — the author enters the editor deliberately.
  await page.getByTestId('minutes-edit').click();
  const minutesEditor = page.getByTestId('minutes-blocknote').locator('.bn-editor');
  await expect(minutesEditor).toBeVisible({ timeout: 20_000 }); // lazy BlockNote chunk
  await minutesEditor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(UNSAVED_LINE);
  await expect(page.getByTestId('minutes-save')).toBeEnabled();

  const dialog = page.getByRole('dialog', { name: 'Unsaved meeting changes' });
  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/meetings/${SEEDED_MEETING}$`));

  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/meetings/${SEEDED_MEETING}$`));
  await expect(minutesEditor).toContainText(UNSAVED_LINE);
  await expect(page.getByTestId('minutes-save')).toBeEnabled();

  // A second Back still asks, and Leave now honours the exit the user asked for.
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Unsaved meeting changes' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Unsaved meeting changes' }).getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings$/, { timeout: 10_000 });
});
