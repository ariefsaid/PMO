// @e2e-isolation: read-only — signs in to the seeded author meeting and makes an unsaved browser-only edit; it performs no database write.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

const SEEDED_MEETING = 'ee000000-0000-0000-0000-000000000001';
const UNSAVED_LINE = 'Unsaved guard browser-only edit';

test('AC-MTG-300: dirty minutes breadcrumb offers Stay and Leave without losing the edit', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto(`/meetings/${SEEDED_MEETING}`);

  const minutesEditor = page.getByTestId('minutes-blocknote').locator('.bn-editor');
  await expect(minutesEditor).toBeVisible();
  await minutesEditor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(UNSAVED_LINE);
  await expect(page.getByTestId('minutes-save')).toBeEnabled();

  const meetingsCrumb = page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Meetings', exact: true });
  await meetingsCrumb.click();

  const dialog = page.getByRole('dialog', { name: 'Unsaved minutes' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/meetings/${SEEDED_MEETING}$`));
  await expect(minutesEditor).toContainText(UNSAVED_LINE);
  await expect(page.getByTestId('minutes-save')).toBeEnabled();

  await meetingsCrumb.click();
  await expect(page.getByRole('dialog', { name: 'Unsaved minutes' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Unsaved minutes' }).getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(page.getByRole('heading', { name: /meetings/i }).first()).toBeVisible();
});
