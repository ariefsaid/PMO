import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-AUTH-011 — Non-Admin does not see the impersonation control (FR-AUTH-033)
test('Finance user has no "View as role" control', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await expect(page.getByRole('button', { name: /view as role/i })).toHaveCount(0);
});
