// @e2e-isolation: self-isolated — unique issue type and cleanup, an Engineer raises it on a phone viewport.
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { addIssueType, cleanSiteIssue } from './siteIssueFixture';

/**
 * AC-SIL-010  Raise a site issue from a phone with a camera photo (docs/specs/site-issue-log.spec.md).
 * Given a phone viewport, when an Engineer raises an issue with a photo, it is saved with the photo and appears in the register.
 *
 */
let issueType = '';
test.afterEach(async () => { await cleanSiteIssue(issueType); });

test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 800 } });

test('AC-SIL-010: an Engineer raises an issue with a camera photo and finds it in the register', async ({ page }) => {
  const type = issueType = `E2E-Issue-${crypto.randomUUID()}`;
  await addIssueType(type);
  await login(page, 'engineer@acme.test');
  await page.goto('/incidents');
  await page.getByRole('button', { name: /file incident/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).selectOption({ label: type });
  // The phone camera input; a tiny valid JPEG stands in for the capture.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  await dialog.getByTestId('incident-photo-input').setInputFiles({ name: 'rail.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(dialog.getByText('rail.jpg')).toBeVisible();
  await dialog.getByRole('button', { name: /^file incident$/i }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('link', { name: new RegExp(`open ${type}`, 'i') }).click();
  await expect(page.getByTestId('incident-evidence').getByText('rail.jpg')).toBeVisible({ timeout: 20_000 });
});
