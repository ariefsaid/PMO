// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-BFY-011 — a multi-fiscal-year activation creates ONE ERP `Budget` PER PHASED YEAR (FR-BFY-030).
 *
 * Before this issue a project spanning two of the client's fiscal years was flatly refused
 * (`budget-multi-fiscal-year`, FR-BUD-124): honest — PMO has no basis to pro-rate a split (ADR-0048) —
 * but it left a finance lead with NO route to an enforced ERP budget at all. Phasing gives each line
 * its own year, and the push then fans out.
 *
 * Given a project spanning two CONSECUTIVE `Fiscal Year`s from the client's own calendar, and a Draft
 * version whose every line names one of those years,
 * When the user activates the version through the real Budget tab (the real served `adapter-dispatch`
 * — no `page.route`, no forged command),
 * Then ERPNext holds exactly TWO live `Budget`s for this project — one per year — each carrying ONLY
 * that year's own accounts and amounts; PMO records one `external_refs` mapping per year under the
 * YEAR-QUALIFIED identity `<versionId>:<encoded_fy>`; and each mirror row says `pushed` with the
 * push-time span witness stamped (FR-BFY-080).
 *
 * ⚑ The GOAL oracle is ERP STATE, not PMO's opinion of it: a fan-out that wrote two mirror rows but
 * one ERP Budget would be exactly the failure this AC exists to catch.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-BFY-011
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import {
  ACTIVATOR_EMAIL,
  ERP_COMPANY,
  LABOR_ACCOUNT,
  MATERIALS_ACCOUNT,
  ORG_ID,
  accountAmount,
  activateSelectedVersion,
  budgetIdentityFor,
  cleanupBud,
  listLiveErpBudgets,
  openBudgetTab,
  readBudgetMirrors,
  readBudgetRefs,
  readErpBudget,
  seedBud,
  seedDraftVersion,
  selectVersion,
  twoAdjacentFiscalYears,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-BFY-011: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-BFY-011: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-BFY-011: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(240_000);

test.describe('AC-BFY-011: a two-year project finally reaches the ledger — as two budgets', () => {
  test('AC-BFY-011 activating a version phased across two fiscal years puts ONE Budget per year on the client ledger', async ({ page }) => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [fy1, fy2] = await twoAdjacentFiscalYears();
    // A span that genuinely crosses the boundary: starts inside FY1, ends inside FY2.
    const projectStart = fy1.year_end_date;
    const projectEnd = fy2.year_start_date;
    const seeded = await seedBud(admin, suffix, { projectStart, projectEnd });
    const versionName = `Budget v1 ${suffix}`;

    try {
      expect(await listLiveErpBudgets(seeded.erpProject), 'the fresh ERP project starts with no Budget').toHaveLength(0);

      // ⚑ EVERY line is phased. A single un-phased line would (rightly) refuse the whole push — that is
      // AC-BFY-005's job, and it is deliberately NOT the state under test here.
      const versionId = await seedDraftVersion(admin, seeded, {
        name: versionName,
        version: 1,
        lines: [
          { category: 'Labor', amount: '50000.00', fiscalYear: fy1.name },
          { category: 'Materials', amount: '25000.00', fiscalYear: fy2.name },
        ],
      });

      // ── The user's journey: the same three clicks as a single-year budget. ──
      await login(page, ACTIVATOR_EMAIL);
      await openBudgetTab(page, seeded.projectId);
      await selectVersion(page, versionName);
      await activateSelectedVersion(page);

      // ── THE GOAL ORACLE: the client's ERP. ──
      const budgets = await listLiveErpBudgets(seeded.erpProject);
      expect(budgets, `ERPNext holds exactly ONE live Budget PER PHASED YEAR: ${JSON.stringify(budgets)}`).toHaveLength(2);

      const docs = await Promise.all(budgets.map((b) => readErpBudget(b.name)));
      const byYear = new Map(docs.map((d) => [d.fiscal_year, d]));
      expect([...byYear.keys()].sort(), 'one Budget for each of the two phased years — no third, no merge').toEqual([fy1.name, fy2.name].sort());

      const first = byYear.get(fy1.name)!;
      const second = byYear.get(fy2.name)!;
      for (const [year, doc] of [[fy1.name, first], [fy2.name, second]] as const) {
        expect(doc.company).toBe(ERP_COMPANY);
        expect(doc.project).toBe(seeded.erpProject);
        expect(doc.budget_against, 'each year is budgeted on the PROJECT dimension').toBe('Project');
        expect(doc.docstatus, `the ${year} Budget must be SUBMITTED — a draft enforces nothing`).toBe(1);
        expect(doc.action_if_annual_budget_exceeded, 'each year gets its own overspend controls').toBe('Warn');
      }

      // ⚑ EACH YEAR CARRIES ONLY ITS OWN LINES. A fan-out that sent the whole budget to both years
      // would double the client's committed budget — the single most expensive way to get this wrong.
      expect(accountAmount(first, LABOR_ACCOUNT), `${fy1.name} carries its own Labor line`).toBe(50000);
      expect(accountAmount(first, MATERIALS_ACCOUNT), `${fy1.name} must NOT carry ${fy2.name}'s Materials line`).toBeUndefined();
      expect(accountAmount(second, MATERIALS_ACCOUNT), `${fy2.name} carries its own Materials line`).toBe(25000);
      expect(accountAmount(second, LABOR_ACCOUNT), `${fy2.name} must NOT carry ${fy1.name}'s Labor line`).toBeUndefined();

      // ── PMO's durable record: one mapping per year, under the YEAR-QUALIFIED identity. ──
      const refs = await readBudgetRefs(admin, versionId);
      expect(refs, `one external_refs mapping per year: ${JSON.stringify(refs)}`).toHaveLength(2);
      expect(refs.map((r) => r.pmo_record_id).sort()).toEqual(
        [budgetIdentityFor(versionId, fy1.name), budgetIdentityFor(versionId, fy2.name)].sort(),
      );
      expect(
        refs.find((r) => r.pmo_record_id === budgetIdentityFor(versionId, fy1.name))?.external_record_id,
        'each identity points at ITS OWN year\'s ERP Budget',
      ).toBe(first.name);
      expect(refs.find((r) => r.pmo_record_id === budgetIdentityFor(versionId, fy2.name))?.external_record_id).toBe(second.name);

      // ── …and one mirror row per year, each with the push-time span witness (FR-BFY-080). ──
      const mirrors = await readBudgetMirrors(admin, versionId);
      expect(mirrors.map((m) => m.fiscal_year).sort(), 'the side mirror reports BOTH years').toEqual([fy1.name, fy2.name].sort());
      for (const m of mirrors) {
        expect(m.push_state, `the ${m.fiscal_year} push succeeded: ${JSON.stringify(m)}`).toBe('pushed');
        expect(m.pushed_project_start_date, 'a successful push NEVER leaves the span witness NULL (FR-BFY-080)').toBe(projectStart);
        expect(m.pushed_project_end_date).toBe(projectEnd);
      }

      // Belt and braces on the org seam: nothing landed under another org.
      const { count } = await admin
        .from('external_refs')
        .select('id', { count: 'exact', head: true })
        .eq('domain', 'budget')
        .like('pmo_record_id', `${versionId}%`)
        .neq('org_id', ORG_ID);
      expect(count ?? 0, 'no budget mapping was written outside the acting org').toBe(0);
    } finally {
      await cleanupBud(admin, seeded);
    }
  });
});
