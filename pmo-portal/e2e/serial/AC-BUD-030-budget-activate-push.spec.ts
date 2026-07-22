// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-BUD-030 — activation pushes the mapped budget WITH ITS OVERSPEND CONTROLS (FR-BUD-120,
 * FR-BUD-114, FR-BUD-130/131, ADR-0055 §6).
 *
 * Given an employing org, a complete category→account map, a single-fiscal-year project and a Draft
 * version,
 * When the user activates the version through the app (the real Budget tab → the real served
 * `adapter-dispatch` — no `page.route`),
 * Then ERPNext holds ONE `Budget` for (company, FY, project) with `budget_against='Project'`, one
 * `accounts[]` row per mapped non-zero category at the exact amounts, and the configured
 * `action_if_*` overspend controls — which are the POINT of the feature: a Budget pushed without them
 * is inert in ERP. `external_refs('budget')` records the mapping and the side mirror says `pushed`.
 *
 * ⚑ FR-BUD-131: the default must be `Warn`, never `Stop`. `Stop` makes ERP BLOCK a client's purchase
 * orders org-wide — a blast radius that must be a deliberate Admin opt-in, never an integration side
 * effect. The seed deliberately leaves `budget_overspend_action` unset so the DEFAULT is what lands.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-BUD-030
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import {
  ORG_ID,
  ACTIVATOR_EMAIL,
  ERP_COMPANY,
  LABOR_ACCOUNT,
  MATERIALS_ACCOUNT,
  accountAmount,
  activateSelectedVersion,
  cleanupBud,
  fiscalYearContaining,
  listLiveErpBudgets,
  openBudgetTab,
  readBudgetMirror,
  readErpBudget,
  seedBud,
  seedDraftVersion,
  selectVersion,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (!READY && process.env.CI) {
  throw new Error('AC-BUD-030: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-BUD-030: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-BUD-030: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(240_000);

const PROJECT_START = '2026-02-02';
const PROJECT_END = '2026-11-30';

test.describe('AC-BUD-030: activating a budget version puts it on the client ledger, with controls', () => {
  test('AC-BUD-030 the user activates the version in the app and ERPNext holds ONE project Budget with the mapped account amounts and Warn overspend controls', async ({ page }) => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedBud(admin, suffix, { projectStart: PROJECT_START, projectEnd: PROJECT_END });
    const versionName = `Budget v1 ${suffix}`;

    try {
      const expectedFy = await fiscalYearContaining(PROJECT_START);
      expect(await listLiveErpBudgets(seeded.erpProject), 'the fresh ERP project starts with no Budget').toHaveLength(0);

      const versionId = await seedDraftVersion(admin, seeded, {
        name: versionName,
        version: 1,
        lines: [
          { category: 'Labor', amount: '50000.00' },
          { category: 'Materials', amount: '25000.00' },
        ],
      });

      // ── The user's journey. ──
      await login(page, ACTIVATOR_EMAIL);
      await openBudgetTab(page, seeded.projectId);
      await selectVersion(page, versionName);
      await activateSelectedVersion(page);

      // PMO's own authority committed.
      const { data: version } = await admin.from('budget_versions').select('status, activated_at').eq('id', versionId).maybeSingle();
      expect((version as { status: string }).status, 'the version is Active in PMO').toBe('Active');
      expect((version as { activated_at: string | null }).activated_at, 'the activation stamp the push key is derived from').not.toBeNull();

      // ⚑ THE GOAL ORACLE — the client's ERP, read back from the live bench.
      const budgets = await listLiveErpBudgets(seeded.erpProject);
      expect(budgets, 'ERPNext holds exactly ONE live Budget for this project').toHaveLength(1);
      const doc = await readErpBudget(budgets[0].name);
      expect(doc.company).toBe(ERP_COMPANY);
      expect(doc.fiscal_year, "the fiscal year comes from the CLIENT'S own Fiscal Year calendar").toBe(expectedFy);
      expect(doc.budget_against, 'the budget is scoped to the PROJECT dimension, never a cost centre').toBe('Project');
      expect(doc.project).toBe(seeded.erpProject);
      expect(doc.docstatus, 'a Draft Budget enforces nothing — the push must submit it').toBe(1);

      // One accounts[] row per MAPPED category, at the exact amount (never a defaulted/suspense account).
      const pairs = doc.accounts.map((a) => [a.account, Number(a.budget_amount)]).sort();
      expect(pairs).toEqual([[LABOR_ACCOUNT, 50000], [MATERIALS_ACCOUNT, 25000]].sort());
      expect(accountAmount(doc, LABOR_ACCOUNT)).toBe(50000);
      expect(accountAmount(doc, MATERIALS_ACCOUNT)).toBe(25000);

      // ⚑ The overspend controls — the reason the budget is pushed at all. Default Warn, never Stop.
      expect(doc.action_if_annual_budget_exceeded, 'the annual control is set (an unset control inherits ERP\'s Stop)').toBe('Warn');
      expect(doc.action_if_annual_budget_exceeded_on_po, 'the purchase-order control must never silently inherit Stop').toBe('Warn');
      expect(doc.action_if_accumulated_monthly_budget_exceeded).toBe('Warn');

      // The mapping + the durable state PMO reports from.
      const { data: refRow } = await admin
        .from('external_refs').select('external_record_id')
        .eq('org_id', ORG_ID).eq('domain', 'budget').eq('pmo_record_id', versionId).maybeSingle();
      expect((refRow as { external_record_id: string } | null)?.external_record_id, 'external_refs maps the version to its ERP Budget').toBe(doc.name);

      const mirror = await readBudgetMirror(admin, versionId);
      expect(mirror?.push_state, `the side mirror reports the push: ${JSON.stringify(mirror)}`).toBe('pushed');
      expect(mirror?.fiscal_year).toBe(expectedFy);
      expect(mirror?.erp_budget_name).toBe(doc.name);
    } finally {
      await cleanupBud(admin, seeded);
    }
  });
});
