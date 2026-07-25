# ⚑ ERPNext deploy-readiness — RESUME HERE (2026-07-24). Read this first.

Goal (owner): "make sure all ERPNext feature & capability AS SPEC'ED is safe and ready to deploy."
Three pillars: **SAFE ✅ · WORKS ✅ (48/48 live bench) · COMPLETE ⏳ (one fix mid-flight with a regression to close)**.

## ⚑⚑ THE ONE OPEN THING — a regression I introduced, needs fixing (branch `test/erpnext-p3c-coverage-gaps`, commit `1a1be8c9`, NOT pushed)
**Context:** The Option-A fix (below) moved the P3c budget-ERP feature-gate off the spec-forbidden
`domain_externally_owned('budget')` row and onto the **active erpnext binding**. Correct in principle, all
unit/pgTAP/verify green, AND 47/48 of the full live e2e pass. **The 1 failure is a REAL regression from the
sweep change, not environmental:**
- **`AC-BUD-032`** fails: `expect(received).toBe('quarantined')` — got `'committing'`. A stale `committing`
  budget outbox row that the sweep must QUARANTINE is no longer quarantined.
- **Root cause (diagnosed, not yet fixed):** in `supabase/functions/erpnext-sweep/index.ts`
  `reconcileOrgOutbox`, the Option-A change reordered so the `budget` skip
  (`if (candidate.domain === ERPNEXT_BUDGET_DOMAIN) continue;`) runs BEFORE the ownership gate. That skip
  short-circuits budget rows out of `reconcileOrgOutbox` — but the **stale-`committing` quarantine** for
  budget is not being performed by whatever now owns it (pass 5 `reconcileOrgBudgetPushes`, or a
  `quarantine_committing` step). Net: a stale budget claim stays `committing` and is never quarantined.
- **Why the fix-agent missed it:** its e2e run died at the bench-credential wall (isolated-worktree env
  trap) BEFORE reaching the sweep; this only surfaces once creds are provisioned and the sweep actually runs.
- **FIX DIRECTION:** ensure a stale `committing` budget row is still quarantined after the gate change —
  either (a) run the `committing`-quarantine BEFORE the budget skip in `reconcileOrgOutbox`, or (b) make
  pass 5 (`reconcileOrgBudgetPushes`) quarantine its own stale `committing` rows. Then re-run the full e2e
  (recipe below) → must be 48/48. TDD it; mutation-check; the pre-existing 48/48 is the oracle.

## HOW TO RE-RUN THE FULL LIVE E2E (the WORKS proof; needs bench creds — the harness gap is a deploy item)
Runner: `scratchpad/run-bud-complete.sh` (worktree `erp-complete`) / `run-erp-live.sh` (worktree `erp-live-test`).
It resets THIS worktree's migrations + seeds vault `local-bench` + serves fns + runs the AC-SAR/ENA/BUD/TSP/732
serial specs `--workers=1 --reporter=json`, all in ONE db-lock hold. Bench creds are minted in the erpnext
container at `/tmp/apicreds` (Administrator api_key:secret). ⚑ The suite needs a pile of env the `dev`
`serve-functions.sh` does NOT forward — `LOCAL_BENCH_KEY/SECRET`, `ERPNEXT_TEST_FAULTS(+_ALLOW_HOST)`,
`ERPNEXT_SWEEP_SECRET`, `DEMO_ERP_WEBHOOK_SECRET`, and the 3 per-spec refs (`E2E_INLINE_*`,
`AC_ENA_050_TEST_ONLY_*`, `AC_ENA_051_TEST_ONLY_*`). Both worktrees have serve-functions.sh locally patched to
forward them; **that patch MUST be ported to `dev` (pre-deploy item #2) or the acceptance suite is unrunnable
in CI = silent-skip class.** Parse per-test from the JSON, NEVER the summary line (a skip reads as a pass).

## THE THREE PILLARS — detail
### SAFE ✅  `docs/security/2026-07-24-erpnext-live-surface-audit.md` — SAFE TO EXPOSE, no Critical/High.
Webhook HMAC-before-side-effect + per-org Vault secret; service-role-only credential reader; RLS enable+force
on every machine table; org from JWT never client-supplied; sweep constant-time bearer. Residuals LOW/NOTE.
8-item PRE-LIVE CHECKLIST (two secret stores webhook=Vault vs dispatch=env — BOTH must be provisioned per org;
sweep secret; kill-switch; ref-uniqueness). ⚑ Budget-gate authz change (below) has a SEPARATE security pass
in flight → `docs/security/2026-07-24-budget-binding-gate-authz-review.md` (agent `a6853343646efc20d`).

### WORKS ✅ (base) / ⏳ (fix)  Full shipped ERPNext e2e = **48/48 vs a live bench** on unmodified `dev`
(4 runs, each a credential-provisioning gap, never a product defect). On the Option-A fix branch: 47/48 (the
AC-BUD-032 regression above). Close the regression → back to 48/48.

### COMPLETE ⏳  spec⇄code⇄test traceability (Explore audit): every P0/P2/P3a/P3b AC has an owning test.
2 P3c gaps were untested; both tests now written:
- **AC-BUD-001** (non-employing org → no push) — GREEN, proven. `supabase/tests/budget_non_employing_no_push.test.sql`.
- **AC-BUD-003** (budget NOT flipped, PMO SoT) — the finding. See below.

## THE AC-BUD-003 STORY (fully traced — I mischaracterised it TWICE before getting it right)
`docs/security/2026-07-24-BUD003-finding-CORRECTED.md` is authoritative. Short version: the P3c budget-ERP
feature-gate read `domain_externally_owned('budget')` — a row FR-BUD-006(a)+FR-BUD-010 EXPLICITLY forbid
(budget is Posture B; employment = the BINDING, never a flip). Prod was lose-lose: employ budget → forbidden
row exists; don't → feature invisible. **NOT money-unsafe** (budget never RLS-flipped, PMO stays SoT — verified).
Owner confirmed budget SHOULD stay PMO-owned (budgeting = versioned planning ERPNext can't hold; must work for
non-ERPNext customers too). **Ruling: Option A** — move the gate to the active erpnext binding, matching
`orgEmploysErpnext`. Done in `1a1be8c9`: FE `BudgetTab.tsx` + `useErpnextBinding.ts`, migration `0160`
(supersedes 0149's `get_budget_push_status` gate; adds `org_has_active_erpnext_binding`), **the money-path
`adapter-dispatch/authGuard.ts`** (budget → `BINDING_GATED_DOMAINS`, Posture-A domains byte-for-byte
unchanged), the sweep, and `seed.sql` (forbidden row removed, active binding seeded). The coupling ran into
4 places incl. the money-write authz gate — hence the security pass in flight. AC-BUD-003 test is now the
spec-faithful version (RED before the fix, GREEN after — no `domain_externally_owned('budget')` anywhere).

## THE TWO SHIP'D FOLLOW-UP LANES (built + reviewed to SHIP, NOT pushed, NOT merged)
- **FU-1a — timesheet Approved→Draft re-open (un-pushed only)** — branch `feat/timesheet-reopen`, 44 commits,
  migs `0151/0152/0155/0157/0158/0159`. **12 review rounds → SHIP** (opus fallback, Luna capped). Verdicts in
  `docs/reviews/2026-07-{23,24}-*fu1a*`. Slice B (ERP cancel of a PUSHED timesheet) = FU-1b, deferred.
- **FU-2 — budget fiscal-year / phasing dimension** — branch `feat/budget-fiscal-year`, 54 commits, migs
  `0153/0154/0156`. **4 review rounds → SHIP**. Verdicts `docs/reviews/2026-07-{23,24}-*fu2*`.
- ⚑ **CROSS-LANE RECONCILIATION — SETTLED, mechanical:** both lanes redefine `release_outbox_hold`. Exact
  reconciled function + 4-step merge procedure in `docs/handoffs/2026-07-24-release-outbox-hold-reconciliation.md`.
- ⚑ **MIGRATION-NUMBER COLLISIONS AT MERGE:** `dev` has advanced to `0151_m365_ciphertext_envelope_check.sql`
  since the FU lanes branched (they were numbered against 0150-head). So FU-1a's `0151/0152` AND FU-2's nothing-
  below-0153 will collide with dev's new `0151`. Each follow-up PR needs a **renumber pass against current dev**
  (`scripts/renumber-migration.sh`) before merge. This fix's `0160` was chosen to sit clear of all three lanes.

## PRE-DEPLOY BLOCKER LIST (bounded)
1. **Close the AC-BUD-032 sweep regression** (above) → full e2e 48/48 on the fix branch.
2. **Port the `serve-functions.sh` credential-forward-list patch to `dev`** (else acceptance suite un-runnable in CI).
3. **Security pass on the budget-gate authz change** (in flight) — must be authz-preserving for every Posture-A domain.
4. **AC-BUD-003 owner ruling = Option A, DONE** (this fix). Add AC-BUD-001 (green) + AC-BUD-003 (green post-fix) to dev.
5. Security audit's **8-item PRE-LIVE CHECKLIST** (owner/config — two secret stores etc.).
6. The two follow-up PRs + the settled `release_outbox_hold` reconciliation + the per-lane migration renumber.
7. Doc hygiene: clear the P3b/P3c **DRAFT** headers + the stale **OQ-TSP-1 "OPEN/BLOCKING"** marker (owner sign-off).

## GIT STATE (nothing pushed; `main` = the autonomous ceiling, untouched)
- Main checkout `/Users/ariefsaid/Coding/PMO` = on `main`; ⚑ owner has an in-progress dev→main promotion staged
  there (56 ERPNext migrations + `.env.example`) — restored intact by me after the auditor stashed it. Leave it.
- Worktrees: `erp-complete` (this fix + the 2 coverage tests), `erp-live-test` (dev + local harness patch, e2e sandbox),
  `feat/timesheet-reopen` (FU-1a), `feat/budget-fiscal-year` (FU-2).
