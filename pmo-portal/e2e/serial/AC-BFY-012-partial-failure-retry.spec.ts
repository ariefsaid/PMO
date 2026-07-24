// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-BFY-012 — a PARTIAL fan-out failure: year 1 enforcing, year 2 actionable, and the retry is not a
 * duplicate (FR-BFY-033, 034, 056).
 *
 * A fan-out is N pushes, and N pushes can half-succeed. The money question is what the client's ledger
 * and PMO's screen say in between: year 1 must be genuinely ENFORCING (not rolled back to protect a
 * tidy all-or-nothing story), year 2 must be nameable and actionable, and the retry must reconcile —
 * never create a second `Budget` for the year that already worked.
 *
 * The failure here is a REAL, producible one, not an injected fault: an accountant has already
 * authored and SUBMITTED their own `Budget` on the (company, FY2, project) grain in the Desk. PMO does
 * not own that document, so FR-BFY-076 refuses to amend it (`budget-unowned-live-occupant`) — never
 * fight the operator — while FY1, which is free, pushes normally.
 *
 * Given that state, When the user activates the two-year version, Then FY1 is on the ledger and
 * enforcing, FY2 is recorded `failed` naming the occupying document, and the accountant's own Budget
 * is untouched. When the accountant then cancels their draft-in-error and the push is retried, Then
 * FY2 lands, FY1 is still exactly ONE Budget, and no year has two.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-BFY-012
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  ACTIVATOR_EMAIL,
  ERP_COMPANY,
  LABOR_ACCOUNT,
  MATERIALS_ACCOUNT,
  accountAmount,
  activateVersionAs,
  benchCancel,
  benchPost,
  benchSubmit,
  budgetIdentityFor,
  cleanupBud,
  dispatchBudgetPushRaw,
  listLiveErpBudgets,
  readBudgetMirror,
  readBudgetMirrors,
  readBudgetRefs,
  readErpBudget,
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
  throw new Error('AC-BFY-012: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-BFY-012: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-BFY-012: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(300_000);

test.describe('AC-BFY-012: half a fan-out is still a state a client has to live in', () => {
  test('AC-BFY-012 year 1 enforces while year 2 is blocked by a Desk-authored Budget; the retry lands year 2 and duplicates nothing', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [fy1, fy2] = await twoAdjacentFiscalYears();
    const projectStart = fy1.year_end_date;
    const projectEnd = fy2.year_start_date;
    const seeded = await seedBud(admin, suffix, { projectStart, projectEnd });
    let deskBudget: string | null = null;

    try {
      // ── The accountant got there first, in their own Desk, for the SECOND year only. ──
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
      const first = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, versionId);
      expect(first.ok, 'a fan-out with a blocked year answers with the failure, never a silent 200').toBe(false);

      // ── ⚑ THE HALF-STATE, ON THE CLIENT'S LEDGER. ──
      const liveAfterPartial = await listLiveErpBudgets(seeded.erpProject);
      const pmoYear1 = liveAfterPartial.filter((b) => b.name !== deskBudget);
      expect(pmoYear1, `year 1 is ENFORCING even though year 2 failed: ${JSON.stringify(liveAfterPartial)}`).toHaveLength(1);
      const year1Doc = await readErpBudget(pmoYear1[0].name);
      expect(year1Doc.fiscal_year).toBe(fy1.name);
      expect(accountAmount(year1Doc, LABOR_ACCOUNT), 'year 1 carries its own amount, in force').toBe(50000);

      const deskDoc = await readErpBudget(deskBudget);
      expect(deskDoc.docstatus, "the accountant's own Budget is untouched — PMO never fights the operator").toBe(1);
      expect(accountAmount(deskDoc, MATERIALS_ACCOUNT), 'and its amount is theirs, not overwritten with PMO\'s 25,000').toBe(9999);

      // ── …and PMO says which year, and why, per year. ──
      const partialMirrors = await readBudgetMirrors(admin, versionId);
      expect(partialMirrors.map((m) => m.fiscal_year).sort(), 'both years are reported — the failed one is not omitted').toEqual([fy1.name, fy2.name].sort());
      expect(partialMirrors.find((m) => m.fiscal_year === fy1.name)?.push_state).toBe('pushed');
      const failedYear = partialMirrors.find((m) => m.fiscal_year === fy2.name)!;
      expect(failedYear.push_state, `the SPECIFIC failing year is stamped failed: ${JSON.stringify(failedYear)}`).toBe('failed');
      expect(failedYear.push_error ?? '', 'the recorded reason names the state, not a generic error').toContain('budget-unowned-live-occupant');

      const partialRefs = await readBudgetRefs(admin, versionId);
      expect(partialRefs.map((r) => r.pmo_record_id), 'PMO claims a mapping only for the year it actually created').toEqual([
        budgetIdentityFor(versionId, fy1.name),
      ]);

      // ── The accountant cancels their document in error. The operator retries THE SAME version. ──
      await benchCancel('Budget', deskBudget);
      const retry = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, versionId);
      expect(retry.status, `the retry must land now the grain is free: ${await retry.text()}`).toBe(200);

      // ── ⚑ THE GOAL: one Budget per year, and not one more. ──
      const finalLive = await listLiveErpBudgets(seeded.erpProject);
      expect(finalLive, `exactly one LIVE Budget per phased year after the retry: ${JSON.stringify(finalLive)}`).toHaveLength(2);
      const finalDocs = await Promise.all(finalLive.map((b) => readErpBudget(b.name)));
      expect(finalDocs.map((d) => d.fiscal_year).sort()).toEqual([fy1.name, fy2.name].sort());
      expect(
        finalDocs.filter((d) => d.fiscal_year === fy1.name),
        'the year that already worked was NOT duplicated by the retry',
      ).toHaveLength(1);

      const settled = await readBudgetMirror(admin, versionId, fy2.name);
      expect(settled?.push_state, `year 2 settles as pushed: ${JSON.stringify(settled)}`).toBe('pushed');
      const finalRefs = await readBudgetRefs(admin, versionId);
      expect(finalRefs.map((r) => r.pmo_record_id).sort(), 'now BOTH years are mapped, each under its own identity').toEqual(
        [budgetIdentityFor(versionId, fy1.name), budgetIdentityFor(versionId, fy2.name)].sort(),
      );
      for (const ref of finalRefs) {
        expect(
          finalLive.map((b) => b.name),
          `each retained mapping points at a LIVE Budget, never an orphan: ${JSON.stringify(finalRefs)}`,
        ).toContain(ref.external_record_id);
      }
    } finally {
      if (deskBudget) {
        try {
          await benchCancel('Budget', deskBudget);
        } catch {
          /* already cancelled by the journey — the cleanup is best-effort on the operator's own doc */
        }
      }
      await cleanupBud(admin, seeded);
    }
  });
});
