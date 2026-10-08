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
 *
 * #765 + OD-NAR-2 (2026-10-08): with Revenue on (now the default when no ERP owns revenue) the control
 * DOES the thing — it opens the management pack at /reports. The disabled "coming soon" branch (Revenue
 * off, or a role that cannot see the pack) is owned by the unit test AC-MMP-015 in BoardPackAction.test.tsx.
 * The goal oracle is unchanged: never a fake "Generating…" success.
 */
test('AC-IXD-DASH-003: Board pack opens the management pack — no fake success', async ({
  page,
}) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');

  // The seed org has Revenue on (OD-NAR-2 default) and the executive may see the pack, so the control is
  // live and really opens the management pack.
  const boardPack = page.getByRole('button', { name: /Board pack/i });
  await expect(boardPack).toBeEnabled();
  await boardPack.click();
  await expect(page).toHaveURL(/\/reports/);
  // Never a fake "Generating…" success toast.
  await expect(page.getByText(/Generating board pack/i)).toHaveCount(0);
});
