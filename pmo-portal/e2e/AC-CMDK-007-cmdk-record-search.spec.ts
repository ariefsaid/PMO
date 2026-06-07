import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-CMDK-007 — ⌘K record search jumps straight to a record's detail page.
// Curated cross-stack journey (ADR-0010): real sign-in, the real cached project
// list (RLS-scoped), the real palette filter + navigate, and the real detail
// route render. Uses P001 "Innovate Corp HQ Fit-Out" — a read-only seed project
// no mutation spec touches, so this is ordering-independent.
test('AC-CMDK-007: ⌘K → type a project name → Enter opens its detail page', async ({ page }) => {
  await signIn(page, 'exec@acme.test');

  // Open the command palette via the global ⌘K / Ctrl-K shortcut.
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: /command palette/i });
  await expect(dialog).toBeVisible();

  // Type a substring of the seeded project name; the Records group surfaces it
  // after the 120ms debounce (records are searched from the cached list).
  await page.getByRole('combobox').fill('Innovate Corp HQ');
  const row = page.getByRole('option', { name: /Innovate Corp HQ Fit-Out/i });
  await expect(row).toBeVisible();

  // Enter runs the selected (top) record row → navigate to its detail route.
  await page.keyboard.press('Enter');

  // The palette closed and the project detail page rendered at /projects/:id.
  await page.waitForURL('**/projects/**');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('heading', { name: /Innovate Corp HQ Fit-Out/i })
  ).toBeVisible();
});
