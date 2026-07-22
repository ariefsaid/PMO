/**
 * WIRE 2 + WIRE 4 + WIRE P3B — the dispatch ENTRY POINT actually calls the guards that were
 * otherwise inert, in an order that keeps them in front of the work they exist to prevent.
 *
 * `supabase/functions/adapter-dispatch/index.ts` is integration-only by contract: its handler is
 * registered inside a top-level `Deno.serve` and every gate before the ones under test needs a real
 * signed JWT + JWKS + Supabase. Its behavior is therefore proven by the pure guards it delegates to
 * (`projectGateGuard.test.ts`, `authGuard.test.ts`, `dispatch.money.test.ts`) plus the served-fn money
 * e2e. What NONE of those can catch is the exact defect this task exists to fix: a guard that is fully
 * proven and simply NEVER CALLED — `checkSiProjectGate` shipped with no caller, so a project-less Sales
 * Invoice could still be SUBMITTED and post revenue to the ERP GL with no project dimension
 * (FR-SAR-191), and the 0116 one-in-flight index surfaced as a raw 500 naming the index.
 *
 * These assertions are about the WIRING, read from the entry point's own source — the same idiom as
 * `handlerDeputyInvariant.test.ts` (which scans the agent-chat handler source for the deputy invariant)
 * and `erpnext/submitClearanceTtl.test.ts` (which asserts a constant relationship against the migration
 * that declares it). It lives under `src/lib/` per the repo's handler-unit-test convention: there is no
 * Vitest project rooted in `supabase/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/adapter-dispatch/index.ts'),
  'utf8',
);
/** The same source with comments stripped — a rule may be DESCRIBED in prose without being inlined. */
const CODE = INDEX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('WIRE 2: the SI project gate is wired into the dispatch entry point', () => {
  it('index.ts imports AND awaits checkSiProjectGate (the guard is not inert)', () => {
    expect(INDEX).toMatch(/import \{[^}]*checkSiProjectGate[^}]*\} from '\.\/projectGateGuard\.ts'/);
    expect(
      /await checkSiProjectGate\(/.test(CODE),
      'an imported-but-uncalled gate lets a project-less SI submit post revenue with no project dimension',
    ).toBe(true);
  });

  it("a gate refusal is returned with the guard's own status and message (never swallowed)", () => {
    const call = CODE.slice(CODE.indexOf('await checkSiProjectGate('));
    const block = call.slice(0, call.indexOf('\n  }\n') + 5);
    expect(block).toMatch(/if \(!projectGate\.ok\)/);
    expect(block).toMatch(/status: projectGate\.status/);
    expect(block).toMatch(/message: projectGate\.message/);
  });

  it('the inline half-rule is GONE — one authority for the gate, never two', () => {
    // The shipped copy read `get_process_gates` itself and covered ONLY the body-building operations
    // (create/update/amend), which is precisely why submit was unguarded.
    expect(CODE).not.toContain('require_project_on_si');
    expect(CODE).not.toContain('get_process_gates');
    // The body-building predicate is the guard's own scoping concern; an unused import here is dead weight.
    expect(CODE).not.toContain('buildsSalesInvoiceBody');
  });
});

describe('WIRE 4: the in-flight-for-record conflict is mapped to 409', () => {
  it('index.ts imports the classified code from dispatch.ts (never re-spells the string)', () => {
    expect(INDEX).toMatch(/import \{[^}]*COMMAND_IN_FLIGHT_FOR_RECORD[^}]*\} from '[^']*\/dispatch\.ts'/);
  });

  it('a second concurrent create for one PMO record answers 409, not a raw 500', () => {
    // ⚑ Anchor on `const status =` only — NOT on the error variable's name. P3c renamed it
    // `appError` -> `budgetAppError`, and the old anchor then matched nothing: `indexOf` returned -1,
    // the slice chain collapsed to '', and the assertion was checking an empty string. It failed
    // loudly here, but a `.not.toContain`-shaped assertion in the same position would have passed
    // VACUOUSLY and reported a guard that no longer exists. So assert the anchor is found first.
    // Anchor on the mapping's OWN unique content (`external-unreachable` appears only in this
    // expression), not on `const status =` — there is more than one of those in the file, and the
    // first belongs to the JWT check.
    const anchor = CODE.search(/const status =[\s\S]{0,80}'external-unreachable'/);
    expect(anchor, 'the dispatch-error status mapping in adapter-dispatch/index.ts was renamed or removed').toBeGreaterThan(-1);
    const statusExpr = CODE.slice(anchor, CODE.indexOf(';', anchor));
    expect(statusExpr).toContain('COMMAND_IN_FLIGHT_FOR_RECORD');
    expect(statusExpr).toMatch(/COMMAND_IN_FLIGHT_FOR_RECORD[\s\S]{0,40}409/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WIRE P3B — the Approved-only gate + the `timesheets` adapter route are LIVE at the entry point.
//
// `approvalGuard.test.ts` proves the gate's DECISION and `dispatchFactory.timesheetRefs.test.ts`
// proves the fail-closed ref pre-flight — but neither can observe whether `index.ts` calls them, or
// WHERE. Both failure modes are silent and severe: an uncalled gate pushes an unapproved week of
// hours into ERP costing (the owner's one binding ruling for P3b), and a gate placed after the
// service client / adapter select / outbox claim would refuse only AFTER the work it exists to
// prevent — the Luna BLOCK-6 class (validate before the external write, never after).
//
// Same source-scan idiom, and same justification, as WIRE 2/WIRE 4 above.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Character offset of `needle` in the comment-stripped source (−1 when absent). */
const at = (needle: string): number => CODE.indexOf(needle);

describe('WIRE P3B: the Approved-only timesheet gate is wired into the dispatch entry point', () => {
  it('FR-TSP-010 index.ts imports AND awaits enforceTimesheetApproved (the gate is not inert)', () => {
    expect(INDEX).toMatch(/import \{[^}]*enforceTimesheetApproved[^}]*\} from '\.\/approvalGuard\.ts'/);
    expect(INDEX).toMatch(/import \{[^}]*isTimesheetPush[^}]*\} from '\.\/approvalGuard\.ts'/);
    expect(
      /await enforceTimesheetApproved\(/.test(CODE),
      'an imported-but-uncalled gate lets an UNAPPROVED week of hours reach ERP costing',
    ).toBe(true);
    // Applicability is the guard's own predicate — never re-spelled here as a domain/kind if-chain.
    expect(CODE).toMatch(/if \(isTimesheetPush\(command\)\)/);
  });

  it('FR-TSP-010 the gate runs under the CALLER JWT client, never the service role', () => {
    expect(CODE).toMatch(/await enforceTimesheetApproved\(\s*callerClient/);
    expect(CODE).not.toMatch(/await enforceTimesheetApproved\(\s*serviceClient/);
  });

  it("FR-TSP-010 a refusal is returned with the guard's own status and message (never swallowed)", () => {
    const block = CODE.slice(at('await enforceTimesheetApproved('));
    const refusal = block.slice(0, block.indexOf('\n  }\n') + 5);
    expect(refusal).toMatch(/if \(!approved\.ok/);
    expect(refusal).toMatch(/status: approved\.status/);
    expect(refusal).toMatch(/message: approved\.message/);
    expect(refusal).toContain("error: 'commit-rejected'");
  });

  it('FR-TSP-050 the gate runs BEFORE the service client, the adapter select, and the outbox deps', () => {
    const gate = at('await enforceTimesheetApproved(');
    expect(gate).toBeGreaterThan(-1);
    for (const later of [
      'createClient(supabaseUrl, serviceRoleKey)', // no machine-write client exists before the refusal
      'ADAPTER_REGISTRY[command.domain]', // no adapter is selected for an unapproved sheet
      'await resolveErpMoneyOutboxDeps(', // no outbox row, therefore no ERP POST (the CALL, not the decl)
      'dispatchExternallyOwnedWrite(',
    ]) {
      expect(at(later), `${later} must come AFTER the Approved gate`).toBeGreaterThan(gate);
    }
  });

  it('FR-TSP-014 the DB-read sheet REPLACES the payload for every field the push is built from', () => {
    const block = CODE.slice(at('await enforceTimesheetApproved('), at('const serviceClient'));
    // FR-TSP-014 / ADR-0059 §3.3: author, witness and hours are server truth, so a forged payload can
    // decide neither whose cost this becomes nor which hours are posted.
    expect(block).toMatch(/command\.record = \{/);
    expect(block).toMatch(/user_id: approvedSheet\.user_id/);
    expect(block).toMatch(/approved_at: approvedSheet\.approved_at/);
    expect(block).toMatch(/entries: approvedSheet\.entries/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WIRE P3C (HIGH-2, Luna re-audit 2026-07-21) — a budget push failure AFTER the gate passes lands a
// durable `budget_version_erp_mirror` row, never silently dropped.
//
// `recordBudgetGateFailure` (proven elsewhere by reading the code) covers ONLY a rejection BY THE
// GATE ITSELF (unmapped category / multi-FY / unresolved fiscal year). The concrete gap: activating a
// REVISION of an already-pushed budget mints a NEW version id, so the gate + BLOCK #4 both pass, and
// ERP's own `(company, project, fiscal_year, account)` duplicate guard then rejects the POST — a
// failure from adapter-select OR the dispatch write itself, neither of which the gate's own recorder
// ever sees. Before this fix nothing wrote a mirror row for that case at all: `push_state` stayed
// NULL — indistinguishable from "never pushed" — and the sweep backstop (which only re-drives
// `pending`/`failed` rows) had nothing to pick up. Same source-scan idiom as WIRE 2/4/P3B above.
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('WIRE P3C: a post-gate budget push failure is recorded durably (HIGH-2)', () => {
  it('recordBudgetPushFailure is defined and gated on isBudgetPushCommand + a resolved fiscal_year', () => {
    const decl = at('const recordBudgetPushFailure = async');
    expect(decl, 'recordBudgetPushFailure must exist — a post-gate budget failure needs SOMEWHERE durable to land').toBeGreaterThan(-1);
    const body = CODE.slice(decl, CODE.indexOf('\n  };', decl) + 5);
    expect(body).toMatch(/if \(!isBudgetPushCommand\(command\)\) return;/);
    // Never invents a grain-less row: an earlier rejection (before the gate resolves a fiscal year)
    // has nothing to key the mirror's (org_id, budget_version_id, fiscal_year) row on.
    expect(body).toMatch(/typeof fiscalYear !== 'string'/);
    // ⚑ M-2 (audit r3) changed this DELIBERATELY: the recorded state is the policy's classification,
    // not the literal 'failed' this originally pinned — a benign in-flight 409 is not a push failure
    // and a held command belongs in 'held'. Every REAL failure still lands as 'failed'
    // (budgetPushOutcome.test.ts owns that oracle); the durability guarantee is unchanged.
    expect(body).toMatch(/push_state:\s*outcome\.pushState/);
    expect(body).toContain("onConflict: 'org_id,budget_version_id,fiscal_year'");
  });

  // ── M-2 (audit r3): the recorder consults the policy, so a benign 409 can never raise a money
  //    alarm. The DECISION is proven in `budgetPushOutcome.test.ts`; what no unit test can see is
  //    whether the handler asks it — an unconsulted policy leaves the old unconditional 'failed'.
  it('M-2 the recorder classifies the error through budgetPushOutcome instead of hardcoding failed', () => {
    expect(INDEX).toMatch(/import \{[^}]*classifyBudgetPushOutcome[^}]*\} from '\.\/budgetPushOutcome\.ts'/);
    const decl = at('const recordBudgetPushFailure = async');
    const body = CODE.slice(decl, CODE.indexOf('\n  };', decl) + 5);
    expect(body).toMatch(/classifyBudgetPushOutcome\(/);
    // A no-record outcome returns BEFORE any mirror write or notification.
    const guard = body.search(/if \(!outcome\.record\) return;/);
    expect(guard, 'M-2: a benign in-flight 409 must record nothing at all').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('.upsert('));
    expect(guard).toBeLessThan(body.indexOf('surfaceActionRequired'));
    // …and the recorded state is the policy's, never a literal.
    expect(body).toMatch(/push_state:\s*outcome\.pushState/);
    expect(body).not.toMatch(/push_state:\s*'failed'/);
  });

  it('is called from BOTH failure paths: adapter-select AND the dispatch/ERP-write catch', () => {
    const selectCatch = at('await recordTimesheetPushFailure(appError);\n    await recordBudgetPushFailure(appError);');
    expect(selectCatch, 'the adapter-select catch must also record a budget push failure').toBeGreaterThan(-1);
    const dispatchCall = CODE.indexOf('await recordBudgetPushFailure(budgetAppError);');
    expect(dispatchCall, 'the dispatch/ERP-write catch must record with the BEST-classified error (budgetAppError), not the generic one').toBeGreaterThan(-1);
    // The dispatch-catch recording must happen with the reclassified error already computed, and
    // strictly BEFORE the HTTP status/response is built (never after the caller already got an answer).
    const budgetAppErrorDecl = at('const budgetAppError =');
    const statusDecl = CODE.indexOf('const status = budgetAppError.code', dispatchCall);
    expect(budgetAppErrorDecl).toBeGreaterThan(-1);
    expect(dispatchCall).toBeGreaterThan(budgetAppErrorDecl);
    expect(statusDecl).toBeGreaterThan(dispatchCall);
  });
});

describe('WIRE P3B: the `timesheets` domain resolves an ERPNext adapter and rides every erp gate', () => {
  it('FR-TSP-005 ADAPTER_REGISTRY routes the timesheets domain to the ERPNext factory', () => {
    expect(INDEX).toMatch(/import \{[^}]*ERPNEXT_TIMESHEETS_DOMAIN[^}]*\} from '[^']*\/erpnext\/adapter\.ts'/);
    const registry = CODE.slice(at('const ADAPTER_REGISTRY'));
    expect(
      registry.slice(0, registry.indexOf('};')),
      'without a registry entry a timesheet command answers UNSUPPORTED_DOMAIN, never a push',
    ).toMatch(/\[ERPNEXT_TIMESHEETS_DOMAIN\]: resolveErpAdapter/);
  });

  it('FR-TSP-012/013 isErpDomain includes timesheets, so authz + idempotency + target binding all apply', () => {
    const decl = CODE.slice(at('const isErpDomain'));
    expect(decl.slice(0, decl.indexOf(';'))).toContain('ERPNEXT_TIMESHEETS_DOMAIN');
    // The three gates keyed on that predicate, each of which a timesheets push must pass.
    expect(CODE).toMatch(/await checkErpnextCommandAuthorization\(/);
    expect(CODE).toMatch(/await checkTransitionTargetBinding\(/);
    expect(CODE).toMatch(/isOpaqueIdempotencyKey\(command\.idempotencyKey\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// H-1 (audit r3) — the budget backstop re-drives ONLY reconcile-eligible outbox rows.
//
// `findBudgetOutboxRow` matches by deterministic key with NO state/attempt/age filter. Unguarded, the
// backstop re-POSTs a terminally-rejected budget EVERY cron tick forever, and re-creates the ERP
// Budget the day an operator clears the blocker. `outbox_reconcile_candidates` (0131) is the single
// authority for "may this row be reconciled now" — 0131's own words: the rule lives in the ONE place
// the sweep selects its work. A second, unfiltered door defeats it.
//
// Live wiring is integration-only by repo convention (every other *Live fn), so it is pinned by the
// same source-scan idiom as WIRE 2/4/P3B above. It lives HERE, not under supabase/, because
// `deno test` runs without --allow-read (a Deno.readTextFile scan fails NotCapable) and there is no
// Vitest project rooted in supabase/.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const SWEEP = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/erpnext-sweep/index.ts'),
  'utf8',
);
const SWEEP_CODE = SWEEP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('H-1: the budget backstop gates its re-POST on outbox eligibility', () => {
  it('driveBudgetPush checks eligibility BEFORE dispatchMoneyWrite (never re-POSTs a terminal row)', () => {
    const start = SWEEP_CODE.indexOf('driveBudgetPush:');
    expect(start, 'driveBudgetPush not found — the anchor moved').toBeGreaterThan(-1);
    const drive = SWEEP_CODE.slice(start, SWEEP_CODE.indexOf('reconcileOrgBudgetPushesLive', start));
    const guardAt = drive.indexOf('eligibleOutboxIds.has(');
    const postAt = drive.indexOf('dispatchMoneyWrite(');
    expect(guardAt, 'H-1: the eligibility guard is GONE — the backstop would re-POST any-state rows every tick').toBeGreaterThan(-1);
    expect(postAt, 'dispatchMoneyWrite call not found — the anchor moved').toBeGreaterThan(-1);
    expect(guardAt, 'H-1: the guard must run BEFORE the POST, or a terminal row is re-sent').toBeLessThan(postAt);
  });

  it('the eligible set comes from the outbox_reconcile_candidates SoT, not a duplicated predicate', () => {
    // A hand-rolled state/attempt filter here would be the "second door" 0131 exists to prevent.
    expect(SWEEP_CODE).toMatch(/eligibleOutboxIds[\s\S]{0,400}listCandidatesLive\(/);
  });
});
