// @e2e-isolation: self-isolated — unique issue type (Date.now()), an Engineer raises it on a phone viewport; feature-flagged skip.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-SIL-010  Raise a site issue from a phone with a camera photo (docs/specs/site-issue-log.spec.md).
 * Given a phone viewport, when an Engineer raises an issue with a photo, it is saved with the photo and appears in the register.
 *
 * QUARANTINE: feature flag incidents=false (src/lib/features.ts) — /incidents redirects home. Un-skip when the flag is on;
 * the allowlist entry in scripts/check-e2e-skips.mjs names the restore path.
 */
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 800 } });

test.skip('AC-SIL-010: an Engineer raises an issue with a camera photo and finds it in the register (QUARANTINE: incidents flag off)', async ({ page }) => {
  const type = `E2E-Issue-${Date.now()}`;
  await login(page, 'engineer@acme.test');
  await page.goto('/incidents');
  await page.getByRole('button', { name: /file incident/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).fill(type);
  // The phone camera input; a tiny valid JPEG stands in for the capture.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  await dialog.getByTestId('incident-photo-input').setInputFiles({ name: 'rail.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(dialog.getByText('rail.jpg')).toBeVisible();
  await dialog.getByRole('button', { name: /^file incident$/i }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('button', { name: new RegExp(`open ${type}`, 'i') }).click();
  await expect(page.getByTestId('incident-evidence').getByText('rail.jpg')).toBeVisible({ timeout: 20_000 });
});
