// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-BUD-032 — ⚑ THE BUDGET UPSERT'S FAILURE WINDOW IS RECOVERABLE, AND ITS VICTIM IS TOLD (HIGH-1,
 * money-safety audit round 5; FR-BUD-121, FR-BUD-141, ADR-0058 §4).
 *
 * AC-BUD-031 proves the upsert on a HEALTHY bench. This one proves the window AC-BUD-031 cannot reach.
 * The upsert is `cancel(old) → create(new) → submit(new)`, and it cannot be made atomic: Frappe has no
 * cross-document transaction, and creating first is not available either (ERP's duplicate guard refuses
 * a create while the old document is still live). So between the cancel and the create there is a real
 * instant in which ERPNext holds NO live Budget for the grain — every overspend control silently off.
 * Before the upsert existed, a failed budget push left the previous Budget live and enforcing; the
 * upsert turned a benign failure into a destructive one, and (until this round) an unrecoverable one:
 * the outbox held the row for an operator and nothing anywhere could un-hold it.
 *
 * Given a project whose ERP Budget is already live and enforcing,
 * When a revision is pushed and ERPNext becomes unreachable AFTER the cancel and BEFORE the replacement
 *   create (the `after-cancel-before-create` seam),
 * Then ERPNext holds ZERO live Budgets for that grain, PMO records that failure NAMING the cancelled
 *   document and the fact that nothing is being enforced, the outbox row stays recoverable (never
 *   terminally `held`), and the NEXT push — the sweep backstop's, with no human involved — restores
 *   exactly ONE live Budget carrying the REVISED figure.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-BUD-032 --project=serial --workers=1
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  ORG_ID,
  ACTIVATOR_EMAIL,
  ERP_COMPANY,
  LABOR_ACCOUNT,
  benchCancel,
  benchPost,
  accountAmount,
  activateVersionAs,
  budgetPushKeyFor,
  cleanupBud,
  dispatchBudgetPushRaw,
  fiscalYearContaining,
  listAllErpBudgets,
  listLiveErpBudgets,
  readActivatedAtBud,
  readBudgetMirror,
  readBudgetOutbox,
  readErpBudget,
  runSweepBud,
  seedBud,
  seedDraftVersion,
  signInAsBud,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-BUD-032: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-BUD-032: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-BUD-032: served-fn lane not configured — run via scripts/serve-functions.sh (ERPNEXT_TEST_FAULTS=1) against the ERPNext bench');

test.setTimeout(300_000);

const PROJECT_START = '2026-02-02';
const PROJECT_END = '2026-11-30';

test.describe('AC-BUD-032: the upsert never leaves a client\'s ERP unenforced AND unrecoverable', () => {
  test('AC-BUD-032 ERPNext dies between the cancel and the replacement create: the operator is told the control is OFF, and the backstop restores it unaided', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedBud(admin, suffix, { projectStart: PROJECT_START, projectEnd: PROJECT_END });

    try {
      const fiscalYear = await fiscalYearContaining(PROJECT_START);
      const token = await signInAsBud(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL);

      // ── 1. v1 is live and enforcing. (Activated server-side, then pushed through the REAL served fn
      //       so the whole assertion chain runs against the same boundary the app uses.) ──
      const v1 = await seedDraftVersion(admin, seeded, { name: `Budget v1 ${suffix}`, version: 1, lines: [{ category: 'Labor', amount: '50000.00' }] });
      await activateVersionAs(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL, v1);
      const v1Key = budgetPushKeyFor(v1, await readActivatedAtBud(admin, v1));
      const push1 = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, v1, v1Key);
      expect(push1.status, `the first push must land: ${await push1.text()}`).toBe(200);

      const liveBefore = await listLiveErpBudgets(seeded.erpProject);
      expect(liveBefore, 'precondition: ERPNext is enforcing exactly one Budget for this grain').toHaveLength(1);
      const cancelledName = liveBefore[0].name;
      expect(accountAmount(await readErpBudget(cancelledName), LABOR_ACCOUNT)).toBe(50000);

      // ── 2. The revision, with ERPNext failing AFTER the cancel and BEFORE the create. ──
      const v2 = await seedDraftVersion(admin, seeded, { name: `Budget v2 ${suffix}`, version: 2, lines: [{ category: 'Labor', amount: '65000.00' }] });
      await activateVersionAs(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL, v2);
      const v2Key = budgetPushKeyFor(v2, await readActivatedAtBud(admin, v2));

      const faulted = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, v2, v2Key, 'after-cancel-before-create');
      expect(faulted.status, 'a transient ERP failure is a 502, not a terminal rejection').toBe(502);

      // ⚑ ERP-SIDE STATE IN THE WINDOW — this is the state the whole finding is about.
      expect(
        await listLiveErpBudgets(seeded.erpProject),
        'the window is real: ERPNext is enforcing NO budget for this project/FY right now',
      ).toHaveLength(0);
      const allInWindow = await listAllErpBudgets(seeded.erpProject);
      expect(allInWindow.find((b) => b.name === cancelledName)?.docstatus, 'the predecessor is a cancelled tombstone').toBe(2);
      expect(allInWindow.filter((b) => b.docstatus === 0), 'no orphan draft was left behind either').toHaveLength(0);

      // ⚑ AND PMO SAYS SO. "The push failed" is not the same sentence as "your overspend control is off".
      const mirror = await readBudgetMirror(admin, v2);
      expect(mirror?.push_state, `the failure is durable, never a silent drop: ${JSON.stringify(mirror)}`).toBe('failed');
      expect(mirror?.push_error, 'the recorded reason names the cancelled document').toContain(cancelledName);
      expect((mirror?.push_error ?? '').toLowerCase(), 'the recorded reason states that NOTHING is being enforced').toContain('enforcing no budget');

      // ⚑ AND IT IS STILL RECOVERABLE. A `held` row here would be terminal — that was the regression.
      const outbox = await readBudgetOutbox(admin, v2);
      expect(outbox?.state, `the outbox row must stay recoverable, got ${JSON.stringify(outbox)}`).not.toBe('held');

      // ── 3. ERPNext comes back. NOBODY intervenes: only the sweep backstop runs. ──
      // ⏩ The outbox's recovery is deliberately SLOW: a 60 s claim lease then a 300 s quarantine
      // visibility window (ADR-0058 §4 — the margin that makes a duplicate money document impossible).
      // Sleeping six minutes inside a test proves nothing extra, so we AGE THE ROW'S OWN TIMESTAMPS and
      // run the REAL sweep at each step: tick 1 must quarantine the stale claim, tick 2 must resolve it.
      // Nothing else is simulated — both ticks are the shipped `erpnext-sweep` against the live bench.
      const stale = new Date(Date.now() - 120_000).toISOString();
      const { error: ageErr } = await admin.from('external_command_outbox')
        .update({ updated_at: stale }).eq('id', outbox!.id);
      expect(ageErr).toBeNull();

      const quarantineTick = await runSweepBud(FUNCTIONS_URL);
      expect(quarantineTick.status, `sweep tick failed: ${JSON.stringify(quarantineTick.body)}`).toBe(200);
      expect(
        (await readBudgetOutbox(admin, v2))?.state,
        'the stale claim must be QUARANTINED, never blindly re-POSTed',
      ).toBe('quarantined');

      const { error: dueErr } = await admin.from('external_command_outbox')
        .update({ reconcile_after: new Date(Date.now() - 1_000).toISOString() }).eq('id', outbox!.id);
      expect(dueErr).toBeNull();

      const sweep = await runSweepBud(FUNCTIONS_URL);
      expect(sweep.status, `sweep tick failed: ${JSON.stringify(sweep.body)}`).toBe(200);

      const liveAfter = await listLiveErpBudgets(seeded.erpProject);
      expect(
        liveAfter.map((b) => b.name),
        `the backstop must restore enforcement unaided — ERP state: ${JSON.stringify(await listAllErpBudgets(seeded.erpProject))}, mirror: ${JSON.stringify(await readBudgetMirror(admin, v2))}`,
      ).toHaveLength(1);

      const restored = await readErpBudget(liveAfter[0].name);
      expect(restored.docstatus, 'a draft enforces nothing — the replacement is SUBMITTED').toBe(1);
      expect(restored.fiscal_year).toBe(fiscalYear);
      expect(
        accountAmount(restored, LABOR_ACCOUNT),
        'the restored control is the REVISION\'s figure, never the superseded one',
      ).toBe(65000);
      expect(restored.name, 'and it is a new document — the tombstone is never resurrected').not.toBe(cancelledName);

      // PMO agrees with ERP: the mirror settles pushed and external_refs resolves to the live object.
      const settled = await readBudgetMirror(admin, v2);
      expect(settled?.push_state, `the mirror must settle: ${JSON.stringify(settled)}`).toBe('pushed');
      expect(settled?.erp_budget_name).toBe(restored.name);
      const { data: refRow } = await admin.from('external_refs').select('external_record_id')
        .eq('org_id', ORG_ID).eq('domain', 'budget').eq('pmo_record_id', v2).maybeSingle();
      expect((refRow as { external_record_id: string } | null)?.external_record_id).toBe(restored.name);

      // …and the recovery converged rather than fanning out: everything else is a tombstone.
      for (const b of await listAllErpBudgets(seeded.erpProject)) {
        if (b.name !== restored.name) {
          expect(b.docstatus, `every non-current Budget must be a cancelled tombstone (${b.name})`).toBe(2);
        }
      }
    } finally {
      await cleanupBud(admin, seeded);
    }
  });

  // ⚑ EMPIRICAL FINDING (this round, on the live bench): a live Budget and a DRAFT Budget can never
  // COEXIST on one grain — ERPNext's duplicate guard counts `docstatus < 2`, so creating the draft while
  // the live one exists is itself refused with `DuplicateBudgetError`. The reachable draft-rival state is
  // therefore always "no live Budget + a draft": either OUR OWN orphan (a create that landed and failed
  // to submit) or, as here, a Desk author starting a replacement after cancelling the old one. That is
  // exactly the state that used to poison the grain forever — a `docstatus = 1` grain read could not see
  // the draft, so PMO cancelled nothing (there was nothing live), created, and took an opaque ERP 417.
  test('AC-BUD-033 a DRAFT Budget on the grain refuses the push BY NAME with ZERO ERP writes — never an opaque duplicate error, and never a clobbered draft', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedBud(admin, suffix, { projectStart: PROJECT_START, projectEnd: PROJECT_END });

    try {
      const token = await signInAsBud(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL);
      const v1 = await seedDraftVersion(admin, seeded, { name: `Budget v1 ${suffix}`, version: 1, lines: [{ category: 'Labor', amount: '50000.00' }] });
      await activateVersionAs(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL, v1);
      const push1 = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, v1, budgetPushKeyFor(v1, await readActivatedAtBud(admin, v1)));
      expect(push1.status, `the first push must land: ${await push1.text()}`).toBe(200);
      const liveName = (await listLiveErpBudgets(seeded.erpProject))[0].name;
      const fiscalYear = (await readErpBudget(liveName)).fiscal_year;

      // An accountant cancels the Budget in the Desk and starts authoring its replacement by hand.
      await benchCancel('Budget', liveName);
      const draft = (await benchPost('Budget', {
        company: ERP_COMPANY,
        fiscal_year: fiscalYear,
        budget_against: 'Project',
        project: seeded.erpProject,
        accounts: [{ account: LABOR_ACCOUNT, budget_amount: '12345.00' }],
      })) as { name: string };
      expect((await readErpBudget(draft.name)).docstatus, 'precondition: an un-submitted Desk draft on the grain').toBe(0);

      // PMO now tries to push a revision onto that grain.
      const v2 = await seedDraftVersion(admin, seeded, { name: `Budget v2 ${suffix}`, version: 2, lines: [{ category: 'Labor', amount: '65000.00' }] });
      await activateVersionAs(AUTH_URL, ANON_KEY, ACTIVATOR_EMAIL, v2);
      const res = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, v2, budgetPushKeyFor(v2, await readActivatedAtBud(admin, v2)));

      const body = (await res.json()) as { error?: string; message?: string };
      expect(res.status, `a named business refusal is unprocessable-entity, got ${JSON.stringify(body)}`).toBe(422);
      expect(body.error).toBe('budget-draft-rival-on-grain');
      expect(body.message, 'the operator is told WHICH document blocks them, and what to do about it').toContain(draft.name);

      // ⚑ ZERO ERP WRITES: the accountant's draft is untouched, and no new Budget was minted.
      const after = await readErpBudget(draft.name);
      expect(after.docstatus, 'never fight the accountant — their draft is not submitted or cancelled by us').toBe(0);
      expect(accountAmount(after, LABOR_ACCOUNT), 'and its figures are theirs, not ours').toBe(12345);
      const all = await listAllErpBudgets(seeded.erpProject);
      expect(all.map((b) => b.name).sort(), 'no new Budget document was created').toEqual([draft.name, liveName].sort());

      // …and the refusal is durable + operator-visible, never a silent drop.
      const mirror = await readBudgetMirror(admin, v2);
      expect(mirror?.push_state, `the refusal is recorded: ${JSON.stringify(mirror)}`).toBe('failed');
      expect(mirror?.push_error).toBe('budget-draft-rival-on-grain');
    } finally {
      await cleanupBud(admin, seeded);
    }
  });
});
