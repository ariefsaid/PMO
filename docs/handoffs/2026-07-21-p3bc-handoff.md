# P3b/P3c handoff — 2026-07-21

**Branch:** `feat/erpnext-adapter-p3` · **last commit:** `bc59ad19` · **HOLD — no PR yet.**
**Read this before touching P3b/P3c.** P3a already SHIPPED to `dev` (PR #338, merge `c7b4ad16`).

---

## 1. ⚑ OWNER RULINGS MADE THIS SESSION (binding — nowhere else in the repo yet)

These were given by the owner on 2026-07-21 and **supersede the "OPEN" status** in
`docs/specs/erpnext-adapter-p3c-budget.spec.md` §3. Fold them into the spec.

### OQ-BUD-3 (multi-fiscal-year budgets) — **RULED: option (a) now, option (c) as the next issue**
PMO's `budget_versions` has no fiscal-year dimension; ERP's `Budget` is per
`(company, fiscal_year, project)`. A project spanning two FYs would need two ERP Budget objects and
PMO holds no information about how to split it.

- **(a) — SHIP NOW:** the push targets the FY containing the project's `start_date`. A project
  spanning **more than one** FY is **rejected before any ERP call** (`commit-rejected` /
  `budget-multi-fiscal-year`); the side mirror goes `failed`; an `action-required` surface names the
  project + the spanned years. Rationale the owner endorsed: any automatic split (pro-rata by days,
  by milestones, front-loaded) is **PMO inventing an accounting allocation** — exactly what ADR-0048
  forbids — and would silently produce wrong overspend controls in **both** years. Honest refusal
  beats a plausible guess.
- **(c) — FILE AS THE NEXT ISSUE:** add a fiscal-year/phasing dimension to `budget_line_items` so a
  multi-FY budget splits by **author intent** rather than a guess. Pairs with `Monthly Distribution`
  (FR-BUD-180). This is a PMO product change (schema + UI + the OD-BUDGET rulings) → its own issue,
  per ADR-0059 §8. **It is not optional follow-up: 8 of 54 seeded projects span fiscal years**
  (measured this session), including the flagship `2025-09-01 → 2026-06-30`. Those get no ERP budget
  until (c) ships.

### OQ-BUD-3b (how the fiscal year is derived) — **RULED: resolve from ERPNext's `Fiscal Year` doctype**
- **⚠️ THIS IS AN OPEN DEFECT.** Lane C1 shipped **calendar-year** derivation
  (`fiscal year = calendar year of project.start_date`). That is only correct for a Jan–Dec client.
- **Required:** query the client's real `Fiscal Year` doctype for the FY whose range contains
  `start_date`, and **fail closed if none matches**. Correct for Apr–Mar, Jul–Jun, etc.
  Costs one extra read per push.
- **Why it matters:** this figure drives real overspend controls in the client's GL. Calendar-year
  derivation silently targets the **wrong ERP Budget object** for a non-calendar-FY client — a
  wrong-year control that looks like it worked.
- **Where:** `resolveFiscalYearOrFailClosed()` in `pmo-portal/src/lib/budget/budgetGate.ts` (~line 104).

#### ⚑ The consequence nobody has costed yet — read before implementing
The FY source does not just relabel the year; **it changes which projects get refused at all.**
The multi-FY span check compares `start_date`'s year to `end_date`'s year. Under calendar-year
derivation the flagship project (`2025-09-01 → 2026-06-30`) spans two years and is **refused**.
Under a **Jul–Jun** fiscal calendar that exact project sits **entirely inside one fiscal year** and
should push **normally**. So:
- The span check itself must be done in **real FY ranges**, not calendar years — otherwise we refuse
  budgets that are perfectly single-FY for that client, and (worse) accept some that aren't.
- The "8 of 54 seeded projects span fiscal years" figure in §1 is a **calendar-year** count. It is
  the *right* number only for a Jan–Dec client. Re-measure per client FY.

**Implementation note:** the gate is currently DB-only (a caller-scoped Supabase client); the
`Fiscal Year` doctype lives in ERPNext, so the gate has no client to read it with. Do **not** bolt a
fetch into `budgetGate.ts` — either resolve the FY in the adapter path where the ERP client already
exists (`dispatchFactory.ts`, budget section) and pass it in, or inject a resolver function. Keep
the gate's fail-closed ordering intact either way, and keep "no FY range contains `start_date`" as a
**refusal**, never a fallback to the calendar year.

---

## 2. State of the tree — 45 uncommitted files, four lanes, three died mid-verification

Four sonnet implementer lanes ran **concurrently in this one working tree** with a file-ownership
fence. **All work is on disk and the tree was verified intact** (stash list empty, both reserved
migrations present, every lane's artifacts accounted for). Three lanes hit the session quota at
their **final verification step** — their code is written, their own targeted tests were passing,
but the *final full sweep* never ran. **Do not assume their work is green — re-run the battery.**

| Lane | Scope | State |
|---|---|---|
| **C1** budget gate + activation | ✅ **COMPLETE, self-reported green** | reported 646 tests / 55 files pass, deno 214/214, boot-smoke OK |
| **B1** employee kind + adopt | ⚠️ died at final file-fence check | code written; targeted tests reported green |
| **B2** FE push + `can()` gates | ⚠️ died before final pgTAP sweep | code written; eslint clean |
| **C2** projection + surfaces | ⚠️ died at final typecheck sweep | code written |

**Reserved migration numbers (already used — do not reuse):**
`0140_confirm_erp_employee_link.sql` (B1) · `0141_get_budget_projection.sql` (C2).
Next free number is **0142**.

### What C1 actually built (the one lane that finished)
- `budgetGate.ts` — `runBudgetGate()` re-reads the version's `status`/`org_id`/`activated_at` via the
  **caller-scoped** client before adapter selection, before the outbox, before any ERP call
  (ADR-0059 §3.3: the precondition is re-asserted server-side, the payload is never trusted).
- Cross-org pre-flight on **both** the version's `org_id` and its project's `org_id`.
- Multi-FY fail-closed (per the ruling above — but with the wrong FY derivation, see §1).
- `recordBudgetGateFailure()` writes `push_state='failed'` + `push_error` + `unmapped_categories` to
  the mirror on gate rejections that have a fiscal-year grain to key on.
- `budgetPushConsequence.ts:activateAndPush` — activate (RPC untouched) → push as a **consequence**,
  push failure swallowed. **Activation never fails because ERP failed.** This is the binding
  Posture-B money invariant; there is a test for it.

---

## 3. Defects found this session (fixed, and still open)

### Fixed + committed in `bc59ad19`
1. **Impersonation hole in `0138_approved_timesheet_for_push.sql`.** `v_actor := coalesce(p_actor,
   auth.uid())` let `p_actor` **win** over the caller's own JWT, so any authenticated org member
   could pass the sheet's `approved_by` and satisfy actor-rule (c) — defeating the check FR-TSP-011
   exists to enforce. Fixed to `coalesce(auth.uid(), p_actor)` (`p_actor` is only for the
   service_role sweep, where `auth.uid()` is null). **Proven RED first** — pgTAP section G caught it
   with *"caught: no exception, wanted: 42501"*.
2. **`budget` missing from `ERP_DOMAINS`** in `transitionTargetGuard.ts` — it routed to the ERP
   adapter via `isErpDomain` but was absent from the guard's set, so BLOCK #2 and BLOCK #4 both
   returned OK on their first line. **Inert, not passing.**
3. **`budget` now rejects a caller-supplied `externalRecordId` outright** (joining `timesheets` in
   `REJECT_CLIENT_SUPPLIED_TARGET`). Nothing in the budget path reads one — the ERP Project comes
   from the binding's `project_map`, the upsert target from `external_refs` — so accepting one could
   only mean redirecting the write. Kills the "authorized PMO id + foreign ERP document" class **by
   construction** rather than by comparison. Three comparison-based budget tests were rewritten to
   the stronger contract; BLOCK #2's fail-closed-on-unmapped is now proven **without** a supplied
   target, where it is the only thing standing.

### Still open
- **The FY-derivation defect** (§1, OQ-BUD-3b) — highest priority.
- **`BudgetCategoryUnmappedError` is a plain `Error`**, not `AdapterError`/`AppError`
  (`src/lib/budget/categoryAccountMap.ts`). `dispatch.ts:toDispatchError()` only special-cases those
  two, so `.code`/`.unmappedCategories` would be silently dropped → a bare 500. C1 added a narrow
  budget-scoped reclassification in `adapter-dispatch/index.ts`'s final catch as defence-in-depth,
  but **`dispatch.ts` itself was not fixed** (outside C1's fence). Fix it properly.
- **C1 deviated from the plan's file list:** no `repositories/budgetPush.ts`; `db/budgets.ts` calls
  `dispatchDomainCommand` directly, following the `db/tasks.ts` precedent. Reasonable, but confirm
  it's the layering you want.
- **~17 app-wide `SECURITY DEFINER` functions still missing `is_active_member()`** (parked, pre-existing).
- Webhook config should emit anchor fields (parked).
- **OQ-TSP-5** (timezone) and **OQ-TSP-6** (correction path) are still unruled with the owner.

---

## 4. What is still NOT built (filesystem inventory, not plan checkboxes)

Verified by reading the tree, because the plans' own checkboxes were wrong.

**P3b remaining:** slice 5 (partial — `can()` gates were B2's, verify they landed), slice 6 (feed
never-adopt + desk-cancel), slice 8 (the served-fn serial e2e lane — `e2e/serial/*TSP*` is empty).
**P3c remaining:** slice 5 (sweep backstop + inbound never-adopt — `budget` sits in
`SWEEP_UNPOLLED_KINDS` with no dedicated pass), slice 7 (invariant proofs + bench e2e).

---

## 5. Working rules that bit us this session — carry these forward

- **The local Docker DB is ONE shared instance.** Wrap every DB-driving command:
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — **chain reset+test in
  ONE lock hold**, never as two calls.
- **Parallel lanes in one working tree need an explicit file-ownership fence and pre-assigned
  migration numbers.** This worked — zero collisions across four concurrent lanes.
- **`git stash` is forbidden for lane agents.** C1 ran one anyway; with three other lanes mid-edit
  that could have destroyed their work. It happened to restore cleanly. Verify the tree after.
- **Never `npm audit fix` a lockfile on macOS for a Linux CI repo** — it drops/changes the
  Linux-optional `@emnapi` entries; local `npm ci` passes and CI's fails.
- **Verify subagent claims by reading the code.** Every defect in §3 was found by checking a lane's
  work rather than trusting its report — including in the lane that reported success.
- **RED must be proven, not asserted.** Ask for the actual failing output. A test that passes before
  the change is vacuous.
- **Never read `.env` / `op.*.env` contents** (not even key names). Secrets only via
  `scripts/op-get.sh` piped straight into a consumer.
- **`main` is the autonomous ceiling.** Never promote to `production` without a direct,
  per-instance owner instruction naming production.

---

## 5b. Battery results at handoff time (measured, not claimed)

Run against the full 45-file working tree (all four lanes' work on disk):

- **pgTAP: 2016/2016 PASS**, 209 files — up from 1981/206 at `bc59ad19`. The three new pgTAP proofs
  from the lanes (`0155_confirm_erp_employee_link`, `budget_projection_rpc`,
  `erpnext_timesheets_module_unchanged_when_flipped`) all pass.
- **Typecheck: clean** — but only after a fix, see below.
- **`npm run verify`: was RED — 2 files / 11 tests — now fixed.** Both failures were **cross-file
  breakage from the lanes**, and both specs pass in isolation, which is exactly why a targeted run
  can't be trusted as the gate:
  1. `pages/__tests__/Approvals.inbox.test.tsx` (10 tests) — B2 added `PushAttentionSection` and
     `EmployeeLinkConfirmSection` to `Approvals.tsx`, but that pre-existing spec `vi.mock`s
     `@/src/hooks/useTimesheetApproval` **without** the two new exports, so the page threw on render.
     Fixed by adding `usePushesNeedingAttention` + `useEmployeeLinkConfirm` to the mock, both empty
     and settled so the sections render nothing and the spec's assertions stay about the queues.
  2. `src/lib/adapterSeam/dispatchGateWiring.test.ts` (1 test) — a **structural** test that greps
     `adapter-dispatch/index.ts`. C1 renamed `appError` → `budgetAppError` in the shared final catch,
     so the anchor `'const status = appError.code'` matched nothing: `indexOf` returned `-1`, the
     slice chain collapsed to `''`, and the assertion was checking an empty string.
     **The 409 behaviour it guards is intact** (verified by reading the mapping — `budgetAppError`
     falls back to `appError` for non-budget commands, so other domains are byte-for-byte).
     Re-anchored on the mapping's own unique content (`'external-unreachable'`, which appears only
     there — note `const status =` alone is ambiguous, the first one belongs to the JWT check) and
     added an explicit assertion that the anchor is **found**.
     ⚑ **Generalise this:** a structural/grep test whose anchor goes stale degrades to asserting
     against `''`. It failed loudly here, but the same shape with a `.not.toContain` assertion would
     have passed **vacuously** and reported a guard that no longer exists. Audit the other
     structural tests for this.
- Deno suites at `bc59ad19` were 214 (adapter-dispatch) + 72 (erpnext-sweep), all green. **Re-run
  them** — the lanes edited `erpnext-sweep/index.ts`, `erpnextFeedDeps.ts` and
  `adapter-dispatch/index.ts` after that.

### ⚑ A type lie the regen introduced (fixed — but know the pattern)
A lane regenerated `pmo-portal/src/lib/supabase/database.types.ts` (+685 lines) and the regen
**narrowed `margin_usd` from `number | null` to `number`** in two places. That broke two untouched
Administration-usage tests. The lane's report called those failures "pre-existing" — **they were
not**; they were caused by its own regen.

The *correct* resolution was to restore `number | null`, not to change the tests: migration
`0069_usage_summary_rpcs.sql` states outright that *"margin_usd is conditional on
app.credits_per_usd (null when unset)"*, and the tests exercise exactly that "pricing not yet
configured" state. Supabase's generator cannot infer nullability for an RPC's
`RETURNS TABLE (... numeric)` and defaults to non-null. **After any type regen, diff it for silently
narrowed nullability before trusting a typecheck.**

## 6. Resume here

1. Run the full battery — it is the ground truth, not any lane's report:
   `cd pmo-portal && npm run verify` · `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` ·
   `cd supabase/functions/adapter-dispatch && deno test . --config deno.json` (and `../erpnext-sweep`).
2. Fix whatever it turns up from the three lanes that died mid-verification.
3. **Fix the FY-derivation defect** (§1) — it is a wrong-money-figure bug, not a polish item.
4. Fix `BudgetCategoryUnmappedError`'s type in `dispatch.ts`.
5. Fold the two owner rulings into `docs/specs/erpnext-adapter-p3c-budget.spec.md` §3 and file
   option (c) as its own issue.
6. **Run the adversarial audit round — it is still OWED, nothing was produced.** Both attempts this
   session failed and the P3b/P3c money path has had **zero** adversarial review (contrast: P3a took
   nine rounds, each finding real defects the last missed):
   - `nvidia`/`nemotron-3-ultra` returned **14 bytes of `</tool_call>`** — the known mis-architecture.
     Don't retry it.
   - `zai`/`glm-5.2` **wedged**: ~0.02s CPU, zero bytes out, even with
     `--exclude-tools subagent,wait,intercom,contact_supervisor,subagent_supervisor`. Diagnose by
     **CPU delta, not elapsed time** — a wedged pi proc looks identical to a working one by clock.
   - The audit brief is worth reusing verbatim — it targets the eight defect classes that have each
     bitten this codebase in a prior round. It was at `/tmp/glm-audit-brief.md` (gone with the temp
     dir); its content is reproduced in §7 below.
   - Technique that worked well: run the auditor against a **detached `git worktree`** at the commit
     under audit, so concurrent build lanes can't confuse it and it can't touch their work.
7. Then, and only then, PR to `dev`.

---

## 7. The audit brief (reuse verbatim — it is tuned to this codebase's defect history)

> You are an ADVERSARIAL money-path auditor.
>
> **Context.** PMO Portal's ERPNext integration, phase P3. P3a (Sales Invoice / Payment Entry)
> already SHIPPED after nine audit rounds. What you are auditing is the NEWER, LESS-REVIEWED work:
> **P3b (Timesheets)** and **P3c (Budget)** — their seams into the already-hardened P3a dispatch
> machinery. Every prior round found real defects the previous round missed. Assume this one does too.
>
> **Binding architecture (read first — it is the contract):** ADR-0059 "Posture B" (PMO is the source
> of truth; the external system carries a side-mirror; a push is a CONSEQUENCE of a PMO state change,
> never a precondition for it; §3.3: the precondition is re-asserted SERVER-SIDE from the database
> before any external call, the command payload is NEVER trusted) · ADR-0058 (fenced money-idempotency
> outbox; mutable-anchor "held, never reissued") · ADR-0055 (source-of-truth by domain) · the two P3b/P3c
> plans in `docs/plans/`.
>
> **Surface:** migrations `0136`–`0141` · `supabase/functions/adapter-dispatch/`
> (`transitionTargetGuard.ts`, `authGuard.ts`, `approvalGuard.ts`, `index.ts`) ·
> `supabase/functions/erpnext-sweep/index.ts` · `supabase/functions/_shared/erpnextFeedDeps.ts` ·
> `pmo-portal/src/lib/adapterSeam/erpnext/` · `pmo-portal/src/lib/budget/` · the pgTAP proofs.
>
> **Hunt specifically for these eight classes — each has bitten this codebase before, one per round:**
> 1. A guard that is **INERT rather than passing** — a domain/kind missing from a Set or map, so the
>    guard returns OK on its first line and the tests still go green.
> 2. A test that passes **VACUOUSLY** — would it still pass if the code under test were deleted?
> 3. An idempotency key that is **not deterministic across its two originators**, or that **collides
>    across two legitimately-distinct commands** — a duplicate ERP money document, or a silently
>    suppressed legitimate one.
> 4. A `SECURITY DEFINER` function that fails to **re-assert a check RLS would have applied**
>    (definer BYPASSES RLS): tenancy, org, actor identity, `is_active_member`.
> 5. An **actor/identity parameter the CALLER can override** (an impersonation hole). One of exactly
>    this shape was found and fixed in `0138` — look for its siblings anywhere else.
> 6. A **failure path that leaves the mirror inconsistent** with what ERPNext actually holds, or a
>    status derivation that **only guards one direction**.
> 7. Separation-of-duties enforced **only in the UI** (a hidden button) rather than server-side.
> 8. A number crossing a boundary as a **float instead of a decimal string**.
>
> **Rules.** READ-ONLY — report only, no edits. Verify by READING THE CODE: do not trust comments,
> test names, or plan checkboxes, several have been wrong. For EVERY finding give the exact
> `file:line`, the **concrete exploit or failure scenario** (specific inputs/state → the wrong money
> outcome), and **why the existing tests do not catch it** — a finding without a concrete failure
> scenario is noise, drop it. Prefer 3 real defects over 20 speculative ones. If you conclude
> something is fine, say briefly WHY you are confident so the reasoning can be checked. End with an
> explicit **SHIP / NO SHIP**.
