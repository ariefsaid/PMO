// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-BFY-026 — the push-status SURFACE reports PER YEAR (FR-BFY-034, 056).
 *
 * Before this issue the status surface read `data[0]` of a single-row RPC and rendered one banner for
 * "the project". On a fan-out that is a lie with a direction: the rows come back ordered, so a project
 * that is enforcing FY1 and enforcing NOTHING for FY2 could render as healthy — the failed year simply
 * did not appear. A finance lead would then read a green screen over an unenforced year.
 *
 * Given a two-year project where one year pushed and the other was blocked by a Desk-authored Budget,
 * When the user opens the Budget tab,
 * Then BOTH years are on screen: the pushed year states its enforcement, and the blocked year has its
 * OWN banner naming ITS fiscal year and its remedy. When the blocking document is cancelled and the
 * push runs again, the surface shows both years enforcing.
 *
 * ⚑ HONEST SCOPE. `budget-unowned-live-occupant` is deliberately NOT retryable (`pushErrorCopy.ts`) —
 * re-running the same command cannot help while someone else's document occupies the grain, and a
 * button that can only fail tells the operator the problem is transient when it is structural. So the
 * withheld-Retry contract is what this journey asserts. That the Retry button, WHERE IT IS OFFERED,
 * carries the ROW's fiscal year rather than the project's is owned by `pages/BudgetProjection.test.tsx`
 * ("Retry dispatches for the ROW's fiscal year"), which can drive a retryable failure directly.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-BFY-026
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import {
  ACTIVATOR_EMAIL,
  ERP_COMPANY,
  MATERIALS_ACCOUNT,
  activateVersionAs,
  benchCancel,
  benchPost,
  benchSubmit,
  cleanupBud,
  dispatchBudgetPushRaw,
  listLiveErpBudgets,
  openBudgetTab,
  seedBud,
  seedDraftVersion,
  signInAsBud,
  twoAdjacentFiscalYears,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
// ⚑ BOTH names, mirroring AUTH_URL above. Reading only VITE_ made these three specs SILENTLY
// SKIP under a runner that exports SUPABASE_ANON_KEY — and a skip is indistinguishable from a
// pass in the summary line (2026-07-23: the lane reported "15 passed" while three real specs,
// including this AC's owner, never executed).
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-BFY-026: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-BFY-026: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-BFY-026: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(300_000);

test.describe('AC-BFY-026: a fan-out reports one status per year, never one for "the project"', () => {
  test('AC-BFY-026 the blocked year gets its own banner naming its fiscal year, beside the year that is enforcing', async ({ page }) => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [fy1, fy2] = await twoAdjacentFiscalYears();
    const seeded = await seedBud(admin, suffix, { projectStart: fy1.year_end_date, projectEnd: fy2.year_start_date });
    let deskBudget: string | null = null;

    try {
      // The blocker: someone else's SUBMITTED Budget on the second year's grain.
      deskBudget = (
        (await benchPost('Budget', {
          company: ERP_COMPANY,
          fiscal_year: fy2.name,
          budget_against: 'Project',
          project: seeded.erpProject,
          accounts: [{ account: MATERIALS_ACCOUNT, budget_amount: 9999 }],
        })) as { name: string }
      ).name;
      await benchSubmit('Budget', deskBudget);

      const versionId = await seedDraftVersion(admin, seeded, {
        name: `Budget v1 ${suffix}`,
        version: 1,
        lines: [
          { category: 'Labor', amount: '50000.00', fiscalYear: fy1.name },
          { category: 'Materials', amount: '25000.00', fiscalYear: fy2.name },
        ],
      });
      await activateVersionAs(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL, versionId);
      const token = await signInAsBud(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL);
      const partial = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, versionId);
      expect(partial.ok, 'precondition: the fan-out half-failed').toBe(false);

      // ── The user opens the Budget tab and must be able to SEE both years. ──
      await login(page, ACTIVATOR_EMAIL);
      await openBudgetTab(page, seeded.projectId);

      const blocked = page.getByRole('alert').filter({ hasText: new RegExp(`Fiscal year ${fy2.name}`, 'i') });
      await expect(blocked, `the BLOCKED year has its own banner, naming ${fy2.name}`).toHaveCount(1);
      await expect(blocked, 'and it says what is actually true of that year in ERPNext').toContainText(
        /not enforcing any budget|still enforcing the previous budget/i,
      );
      await expect(
        blocked.getByRole('button', { name: /retry the push/i }),
        'Retry is WITHHELD for a failure a retry cannot fix — the remedy is a person cancelling their document',
      ).toHaveCount(0);

      // …and the healthy year is stated too, on the same screen, naming ITS year.
      await expect(
        page.getByText(new RegExp(`Fiscal year ${fy1.name}`, 'i')),
        `the year that DID push is reported as well, named — not collapsed into the failure`,
      ).toBeVisible();

      // ── The accountant cancels their document; the push runs again. ──
      await benchCancel('Budget', deskBudget);
      const retry = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, versionId);
      expect(retry.status, `the re-run must land now the grain is free: ${await retry.text()}`).toBe(200);
      expect(await listLiveErpBudgets(seeded.erpProject), 'both years are on the ledger, one Budget each').toHaveLength(2);

      // ── The surface follows the ledger: no year is left saying "blocked". ──
      await page.reload();
      await openBudgetTab(page, seeded.projectId);
      await expect(
        page.getByRole('alert').filter({ hasText: new RegExp(`Fiscal year ${fy2.name}`, 'i') }),
        'the blocked banner for that year is gone once the year actually pushed',
      ).toHaveCount(0);
      await expect(page.getByText(new RegExp(`Fiscal year ${fy2.name}`, 'i')).first()).toBeVisible();
    } finally {
      if (deskBudget) {
        try {
          await benchCancel('Budget', deskBudget);
        } catch {
          /* the journey already cancelled it — best effort on the operator's own document */
        }
      }
      await cleanupBud(admin, seeded);
    }
  });
});
