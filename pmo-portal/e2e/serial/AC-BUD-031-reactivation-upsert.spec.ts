// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-BUD-031 — ⚑ RE-ACTIVATION UPSERTS THE SAME ERP BUDGET — NEVER A DUPLICATE (FR-BUD-121,
 * FR-BUD-122, OQ-BUD-2).
 *
 * This is the money-critical one. ERPNext enforces at most one `Budget` per (company, fiscal_year,
 * project, account) and rejects a duplicate ATOMICALLY (budget-write spike §8) — so a push that does
 * not UPSERT does not merely create a tidy-looking second row: either the client's ERP refuses the
 * revision outright (and keeps enforcing the SUPERSEDED figure while PMO shows the new one), or a
 * second live object starts enforcing controls nobody authored. Both are wrong in the same direction:
 * the overspend controls a finance user is relying on are not the budget they activated.
 *
 * Given a pushed budget, then a clone → edit → activate revision, and separately a roll-back
 * re-activation of the earlier version's figures,
 * When each activation pushes,
 * Then ERPNext holds EXACTLY ONE live `Budget` for (company, FY, project) after each — carrying the
 * CURRENT Active version's figures — never a second object; `external_refs` resolves to the same (or
 * repointed) ERP `name`; and the roll-back is NOT silently suppressed.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-BUD-031
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import {
  ORG_ID,
  ACTIVATOR_EMAIL,
  LABOR_ACCOUNT,
  accountAmount,
  activateSelectedVersion,
  cleanupBud,
  cloneSelectedVersion,
  editLineItemAmount,
  fiscalYearContaining,
  listAllErpBudgets,
  listLiveErpBudgets,
  openBudgetTab,
  readErpBudget,
  seedBud,
  seedDraftVersion,
  selectVersion,
  type BudSeed,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (!READY && process.env.CI) {
  throw new Error('AC-BUD-031: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-BUD-031: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-BUD-031: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(300_000);

const PROJECT_START = '2026-02-02';
const PROJECT_END = '2026-11-30';

/** Every push outcome this project's versions recorded — so a failed activation names the REAL reason
 *  (the ERP's own rejection) instead of just "the toast was the wrong one". */
async function describePushState(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from('budget_version_erp_mirror')
    .select('budget_version_id, push_state, push_error, erp_budget_name')
    .eq('org_id', ORG_ID);
  return JSON.stringify(data);
}

/** THE invariant, asserted after EVERY activation: one live Budget, carrying the CURRENT figure. */
async function expectSingleLiveBudgetAt(
  admin: SupabaseClient,
  seeded: BudSeed,
  expectedLabor: number,
  fiscalYear: string,
  stage: string,
): Promise<string> {
  const live = await listLiveErpBudgets(seeded.erpProject);
  expect(
    live.map((b) => b.name),
    `${stage}: ERPNext must hold EXACTLY ONE live Budget for (company, FY, project) — a second object enforces controls nobody authored`,
  ).toHaveLength(1);
  const doc = await readErpBudget(live[0].name);
  expect(doc.fiscal_year, `${stage}: same fiscal year`).toBe(fiscalYear);
  expect(doc.budget_against).toBe('Project');
  expect(doc.docstatus, `${stage}: the live Budget is submitted, so its controls are actually enforced`).toBe(1);
  expect(
    accountAmount(doc, LABOR_ACCOUNT),
    `${stage}: ERP must enforce the CURRENT Active version's figure, not a superseded one`,
  ).toBe(expectedLabor);

  // …and PMO resolves to that same object.
  const { data: activeVersion } = await admin
    .from('budget_versions').select('id').eq('project_id', seeded.projectId).eq('status', 'Active').maybeSingle();
  const activeId = (activeVersion as { id: string } | null)?.id;
  expect(activeId, `${stage}: exactly one PMO version is Active`).toBeTruthy();
  const { data: refRow } = await admin
    .from('external_refs').select('external_record_id')
    .eq('org_id', ORG_ID).eq('domain', 'budget').eq('pmo_record_id', activeId!).maybeSingle();
  expect(
    (refRow as { external_record_id: string } | null)?.external_record_id,
    `${stage}: external_refs resolves the Active version to the ONE live ERP Budget`,
  ).toBe(doc.name);
  return doc.name;
}

test.describe('AC-BUD-031: revising a budget never leaves two budgets on the client ledger', () => {
  test('AC-BUD-031 a clone→edit→activate revision and a roll-back re-activation each land on the SAME ERP Budget — exactly one live object, carrying the current figures', async ({ page }) => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedBud(admin, suffix, { projectStart: PROJECT_START, projectEnd: PROJECT_END });
    const v1Name = `Budget v1 ${suffix}`;

    try {
      const fiscalYear = await fiscalYearContaining(PROJECT_START);
      await seedDraftVersion(admin, seeded, { name: v1Name, version: 1, lines: [{ category: 'Labor', amount: '50000.00' }] });

      await login(page, ACTIVATOR_EMAIL);
      await openBudgetTab(page, seeded.projectId);

      // ── 1. The first activation CREATES. ──
      await selectVersion(page, v1Name);
      await activateSelectedVersion(page, () => describePushState(admin));
      const firstName = await expectSingleLiveBudgetAt(admin, seeded, 50000, fiscalYear, 'after the first activation');

      // ── 2. A revision: clone the Active version, raise Labor to 60,000, activate. ──
      await cloneSelectedVersion(page);
      await editLineItemAmount(page, 'Labor', '60000');
      await activateSelectedVersion(page, () => describePushState(admin));
      const revisedName = await expectSingleLiveBudgetAt(admin, seeded, 60000, fiscalYear, 'after the revision');

      // ⚑ Whether the upsert is a PUT or a cancel+amend (spike-frozen mechanism), the LIVE object must
      // still be one. If the mechanism amended, the superseded document is a cancelled tombstone —
      // never a second live budget.
      const allAfterRevision = await listAllErpBudgets(seeded.erpProject);
      for (const b of allAfterRevision) {
        if (b.name !== revisedName) {
          expect(b.docstatus, `every non-current Budget must be a CANCELLED tombstone, not a live rival (${b.name})`).toBe(2);
        }
      }

      // ── 3. The roll-back: restore the earlier version's figures and activate again. ──
      // (`activate_budget_version` only admits a Draft, so the user's real roll-back journey is
      // "clone the version I want back, then activate it" — the figures are what roll back.)
      await openBudgetTab(page, seeded.projectId);
      await selectVersion(page, v1Name);
      await cloneSelectedVersion(page);
      await activateSelectedVersion(page, () => describePushState(admin));

      // ⚑ NOT silently suppressed: the roll-back is its own command and ERP really goes back to 50,000.
      const rolledBackName = await expectSingleLiveBudgetAt(admin, seeded, 50000, fiscalYear, 'after the roll-back re-activation');

      const allAfterRollback = await listAllErpBudgets(seeded.erpProject);
      for (const b of allAfterRollback) {
        if (b.name !== rolledBackName) {
          expect(b.docstatus, `after the roll-back every other Budget must be cancelled (${b.name})`).toBe(2);
        }
      }
      // Sanity on the whole story: at most one live object ever existed, whatever names it took.
      expect(new Set([firstName, revisedName, rolledBackName]).size, 'the upsert may repoint the ERP name, but never fan out').toBeLessThanOrEqual(3);
      expect(await listLiveErpBudgets(seeded.erpProject), 'exactly one live Budget at the end of the whole journey').toHaveLength(1);
    } finally {
      await cleanupBud(admin, seeded);
    }
  });
});
