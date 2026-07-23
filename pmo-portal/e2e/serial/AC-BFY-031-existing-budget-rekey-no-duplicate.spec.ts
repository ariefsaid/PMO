// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-BFY-031 — a pre-existing mapped ERP `Budget` stays SINGULAR across the identity migration and a
 * re-activation (FR-BFY-037).
 *
 * ⚑ THE FAILURE THIS EXISTS TO CATCH, IN PLAIN TERMS. Budgets pushed before this release are filed
 * under the BARE `<budget_version_id>`; from this release PMO looks them up under
 * `<budget_version_id>:<encoded_fiscal_year>`. If migration 0154 misses a row — or re-creates instead
 * of re-keying it — then the next activation asks "is this record already mapped?", hears NO, and
 * dispatches a `create` for a project-year ERPNext ALREADY HOLDS. The client ends up with TWO Budget
 * documents on one grain, each with its own overspend controls, and PMO pointing at one of them.
 *
 * Given a budget pushed under the OLD bare mapping (produced here by a REAL push through the served
 * boundary, then filed back under the pre-release identity — the exact row the old code wrote),
 * When migration 0154's re-key runs and the same version is re-activated through the real served
 * boundary,
 * Then PMO still resolves the SAME ERP Budget, and ERPNext holds exactly ONE Budget on the
 * project-year grain — not a second one under the new identity.
 *
 * ⚑ Audit-program limit (from the spec): this AC cannot see malformed/unrecoverable migration rows or
 * the deploy fence — those are owned by AC-BFY-020 (pgTAP) and the release runbook.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-BFY-031
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  ACTIVATOR_EMAIL,
  ORG_ID,
  activateVersionAs,
  budgetIdentityFor,
  cleanupBud,
  dispatchBudgetPushRaw,
  fiscalYearContaining,
  listAllErpBudgets,
  listLiveErpBudgets,
  readBudgetRefs,
  seedBud,
  seedDraftVersion,
  signInAsBud,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-BFY-031: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-BFY-031: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-BFY-031: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(300_000);

const PROJECT_START = '2026-02-02';
const PROJECT_END = '2026-11-30';

test.describe('AC-BFY-031: the identity migration must not cost a client a duplicate budget', () => {
  test('AC-BFY-031 a budget mapped under the OLD bare identity survives the re-key and a re-activation as ONE ERP Budget', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedBud(admin, suffix, { projectStart: PROJECT_START, projectEnd: PROJECT_END });

    try {
      const fiscalYear = await fiscalYearContaining(PROJECT_START);
      const token = await signInAsBud(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL);

      // ── 1. A REAL push, so the ERP document and the mapping are the shipped writers' own output. ──
      const versionId = await seedDraftVersion(admin, seeded, {
        name: `Budget v1 ${suffix}`,
        version: 1,
        lines: [{ category: 'Labor', amount: '50000.00' }],
      });
      await activateVersionAs(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL, versionId);
      const push = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, versionId);
      expect(push.status, `precondition: the first push lands: ${await push.text()}`).toBe(200);

      const live = await listLiveErpBudgets(seeded.erpProject);
      expect(live, 'precondition: ERPNext holds exactly one Budget for this project-year').toHaveLength(1);
      const originalBudget = live[0].name;

      // ── 2. Put the mapping back into its PRE-RELEASE shape: the bare `<versionId>`, exactly what the
      //       old code wrote. Nothing about the ERP document or the mirror row is touched — those are
      //       identical before and after this release, and the mirror's recorded fiscal year is the
      //       fact the migration recovers the year from.
      const { error: unmigrateRefs } = await admin
        .from('external_refs')
        .update({ pmo_record_id: versionId })
        .eq('org_id', ORG_ID)
        .eq('domain', 'budget')
        .eq('pmo_record_id', budgetIdentityFor(versionId, fiscalYear));
      expect(unmigrateRefs, 'the pre-release mapping shape is reproducible').toBeNull();

      const { data: outboxRows } = await admin
        .from('external_command_outbox')
        .select('id, idempotency_key')
        .eq('org_id', ORG_ID)
        .eq('domain', 'budget')
        .eq('pmo_record_id', budgetIdentityFor(versionId, fiscalYear));
      for (const row of (outboxRows ?? []) as Array<{ id: string; idempotency_key: string }>) {
        // `bud:<vid>:<token>:<epoch>` → the old `bud:<vid>:<epoch>` (the token may itself contain ':',
        // so the epoch is everything after the LAST one).
        const epoch = row.idempotency_key.slice(row.idempotency_key.lastIndexOf(':') + 1);
        const { error } = await admin
          .from('external_command_outbox')
          .update({ pmo_record_id: versionId, idempotency_key: `bud:${versionId}:${epoch}` })
          .eq('id', row.id);
        expect(error, 'the pre-release outbox shape is reproducible').toBeNull();
      }

      // ── 3. THE MIGRATION. The same deterministic, preflighted re-key 0154 runs at deploy time. ──
      const { error: rekeyErr } = await admin.rpc('bfy_migration_0154_rekey');
      expect(rekeyErr, `the re-key must run cleanly on a recoverable population: ${JSON.stringify(rekeyErr)}`).toBeNull();

      const refsAfter = await readBudgetRefs(admin, versionId);
      expect(refsAfter, 'still exactly ONE mapping — re-keyed in place, not duplicated').toHaveLength(1);
      expect(refsAfter[0].pmo_record_id, 'now filed under the year-qualified identity').toBe(budgetIdentityFor(versionId, fiscalYear));
      expect(refsAfter[0].external_record_id, 'and still pointing at the SAME ERP Budget — the pointer was migrated, never re-made').toBe(
        originalBudget,
      );

      // ── 4. THE GOAL: a re-activation now resolves the retained mapping instead of creating a rival. ──
      const rePush = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, versionId);
      expect(rePush.status, `the re-activation is handled, not rejected: ${await rePush.text()}`).toBe(200);

      const liveAfter = await listLiveErpBudgets(seeded.erpProject);
      expect(
        liveAfter,
        `ERPNext holds exactly ONE live Budget on this project-year grain — never a second one under the new identity: ${JSON.stringify(
          await listAllErpBudgets(seeded.erpProject),
        )}`,
      ).toHaveLength(1);

      const refsFinal = await readBudgetRefs(admin, versionId);
      expect(refsFinal, 'and PMO still holds exactly one pointer to it').toHaveLength(1);
      expect(refsFinal[0].pmo_record_id).toBe(budgetIdentityFor(versionId, fiscalYear));
      expect(
        liveAfter[0].name,
        'PMO points at the Budget that is actually live (the upsert may amend it; it may never orphan it)',
      ).toBe(refsFinal[0].external_record_id);
    } finally {
      await cleanupBud(admin, seeded);
    }
  });
});
