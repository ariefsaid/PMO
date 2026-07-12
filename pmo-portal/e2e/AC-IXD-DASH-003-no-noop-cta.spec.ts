// @e2e-isolation: read-only — login + nav + disabled button assertion; no DB writes.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-IXD-DASH-003 (Area 4, plan task 19; OD-UX-3): a CTA either does the thing or is clearly
 * disabled — it never fakes success. The "Board pack" control on the exec dashboard was a no-op
 * that toasted "Generating board pack…" and did nothing. It is now a visibly DISABLED
 * "coming soon" affordance that fires no action and no toast. A real export lands with Reports.
 *
 * Natural journey: an executive lands on their dashboard, sees the Board pack control, and tries
 * it — the app must NOT pretend it generated something.
 */
test('AC-IXD-DASH-003: Board pack is a disabled "coming soon" affordance — no fake success', async ({
  page,
}) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');

  // The capability is discoverable (not removed) but visibly not-yet-available.
  const boardPack = page.getByRole('button', { name: /Board pack/i });
  await expect(boardPack).toBeVisible();
  await expect(boardPack).toBeDisabled();
  // The accessible name carries the honest reason (mirrors the doc/admin "coming soon" pattern).
  await expect(boardPack).toHaveAccessibleName(/coming soon/i);

  // A disabled button cannot be clicked into a fake "Generating…" success toast.
  await expect(page.getByText(/Generating board pack/i)).toHaveCount(0);
});
