# ⛔ SUPERSEDED — P3 IS COMPLETE (2026-07-23)

> This was a **resume-here** handoff written mid-flight on 2026-07-21. **The work it describes shipped
> in [PR #360](https://github.com/ariefsaid/PMO/pull/360).** Do NOT use it to plan work: its "what is
> still NOT built" and "resume here" sections are historical, and several defects it lists as OPEN were
> closed by audit rounds 4-11 (some of the fixes it recommends were later found wrong and replaced).
>
> **Current truth:** `docs/backlog.md` (status) and
> `docs/reviews/2026-07-23-p3bc-audit-program.md` (the full 11-round record).
>
> Kept because its per-defect reasoning still explains WHY parts of the code look the way they do —
> particularly the impersonation hole in `0138` and the load-phantom signature in §5c.

---

# P3b/P3c handoff — 2026-07-21

**Branch:** `feat/erpnext-adapter-p3` · **last commit:** `305a6f72` · **HOLD — no PR yet.**
**Status 2026-07-22: THREE adversarial audit rounds, all NO SHIP; round 4 not yet run.**
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

### OQ-BUD-3b (how the fiscal year is derived) — **RULED + ✅ FIXED 2026-07-21**
- Lane C1 had shipped **calendar-year** derivation
  (`fiscal year = calendar year of project.start_date`), correct only for a Jan–Dec client. **Now fixed.**
- **Required:** query the client's real `Fiscal Year` doctype for the FY whose range contains
  `start_date`, and **fail closed if none matches**. Correct for Apr–Mar, Jul–Jun, etc.
  Costs one extra read per push.
- **Why it matters:** this figure drives real overspend controls in the client's GL. Calendar-year
  derivation silently targets the **wrong ERP Budget object** for a non-calendar-FY client — a
  wrong-year control that looks like it worked.
- **What shipped:** `BudgetGateDeps.readFiscalYears()` (new), wired in `adapter-dispatch/index.ts`'s
  `readErpFiscalYears()` to `GET /api/resource/Fiscal Year`. `resolveFiscalYearOrFailClosed(project,
  fiscalYears)` returns the FY **name** and judges the multi-FY span in real ranges. Inclusive
  boundary compare, lexicographic on ISO dates (no `Date` parsing — a timezone shift at a boundary is
  the exact class of bug being removed). The dead `calendarYear()` helper is gone.
- **⚑ It was worse than a wrong label:** `fiscal_year` is a Link **by name**, so a Jul–Jun client
  sending `"2025"` names *no Fiscal Year at all* — an invalid Link, not an off-by-one.
- **Fails closed** on an empty/unreadable calendar or a project outside every declared year
  (`budget-fiscal-year-unresolved`). It never falls back to the calendar year — that fallback *was*
  the bug.
- **Six new tests** pin it, including the mirror-image pair so neither can pass by never refusing:
  the flagship project **pushes** under Jul–Jun and **is refused** under Jan–Dec.

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

## 1b. ⚑ OWNER RULING 2026-07-22 — no prod data; graceful escalation for both classes

**There is NO production data** — the ERPNext bench is local-only for this feature's development. So a
corrupted watermark row is cleaned by a plain `supabase db reset`; no prod migration or data repair is
owed. **But neither condition may be handled silently if it is met later**, and the owner confirmed the
SAME answer applies to the `company` case as to `NaN`:

| Condition | Handling (shipped in `305a6f72`) |
|---|---|
| An unusable stored watermark (`NaN`/`null`/`undefined`/`±Infinity`) | Adopted over (self-heals) **and warned** — a non-empty unusable value is a healed CORRUPTION, so it is observable, not silent. `''` (the fresh-org default) stays quiet. The root-cause coercion is fixed, so no NEW `NaN` can be minted; this heals legacy rows once. |
| A company-scoped ERP doc stating **no** company while our binding names one | **Escalates** — `surfaceActionRequired('erp-doc-missing-company')`. This is an ERP webhook-config gap (the config should send `company`), not another tenant. |
| A doc stating a **different** company | **Stays SILENT, by design.** It is another tenant's document; surfacing it would be noise AND would leak their company name into this org. `companyRefusalReason` exists precisely to keep these two apart. |

Both refusals still ack `200` (the event is genuine, just not ours to mirror, so Frappe must not retry) —
the escalation is a side effect, never a status change.

---

## 1c. Audit history — three rounds, three NO SHIPs, ~15 real defects

**Every round found defects the previous round missed, including two in the Director's own fixes.**
Do not treat any single round as convergence; P3a needed nine.

| Round | Verdict | Notable |
|---|---|---|
| 1 | NO SHIP | Mirror updates matched ZERO rows silently (`.eq('id')` vs the FK column); post-gate budget failure recorded nowhere; Desk-editable `work_email` → `.ilike` wildcard; two new definer RPCs missing the offboarding gate; unordered `.find()` over fiscal years. |
| 2 | NO SHIP | One Desk-created doc **wedged the whole sweep** (never-adopt throws, no per-change catch, `return` not `continue`) — so removing `budget` from `SWEEP_UNPOLLED_KINDS` was NOT safe; `COMPANY_SCOPED_KINDS` inert for the two new kinds; `escapeLikePattern` reopened by PostgREST's `*`→`%`; dead `applyBudgetFeedEvent` whose "proofs" tested code that never ran. **Plus a HIGH neither audit found: `Number(nextCursor)` made every ERPNext watermark the literal `'NaN'` — the per-doctype cursor had NEVER worked.** |
| 3 | NO SHIP | The `'NaN'` fix could not recover `'NaN'` (`'NaN' > '2026-…'` is lexically TRUE ⇒ stuck forever); the budget backstop bypassed `0131`'s replay bounds (re-POST every tick forever). **H-1/H-2 fixed in `305a6f72`; H-3, H-4, M-1, M-2, L-1 still open** (see §6). |

**Recurring defect classes, ranked by how often they actually bit here:**
1. **A guard that is INERT rather than passing** — a kind/domain missing from a `Set`/map, so the guard
   returns OK on its first line while its tests stay green. Hit **three times in one day**.
2. **A test that passes VACUOUSLY** — ask of every key assertion: *would this still pass if the code under
   test were deleted?* Stale grep anchors degrade to asserting against `''`; under-specified fixtures
   (a "unique work-email match" seeded with no email) pass only because the fake ignores the input.
3. **A fix that is correct in its own file and wrong end-to-end** — the FY fix landed on the write side
   and left the read side (H-4); the escape covered SQL's metacharacters but not the transport's.

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
- ~~`BudgetCategoryUnmappedError` loses its code through the seam~~ — **✅ FIXED 2026-07-21.** The
  real bug was upstream and wider than budget: `dispatch.ts:toDispatchError()`'s `Error` branch
  returned `new AppError(error.message)`, **discarding a `.code` that was already there**, so ANY
  error class that is not `AppError`/`AdapterError` arrived code-less and fell through the edge fn's
  status mapping to a bare 500 — an opaque, retryable-looking server error in place of a precise
  NON-RETRYABLE refusal. Fixed by preserving a structural string `.code` (the same rule
  `appError.ts:toAppError` already applied). Widening `AdapterErrorCode` was rejected: it is a closed
  2-value union in the **shipped P3a contract**. RED proven (`{ code: undefined }`).
  C1's budget-scoped reclassification in `index.ts` is now redundant but harmless — left in place.
- **C1 deviated from the plan's file list:** no `repositories/budgetPush.ts`; `db/budgets.ts` calls
  `dispatchDomainCommand` directly, following the `db/tasks.ts` precedent. Reasonable, but confirm
  it's the layering you want.
- **~17 app-wide `SECURITY DEFINER` functions still missing `is_active_member()`** (parked, pre-existing).
- Webhook config should emit anchor fields (parked).
- **OQ-TSP-5** (timezone) and **OQ-TSP-6** (correction path) are still unruled with the owner.

---

## 4. What is still NOT built (filesystem inventory, not plan checkboxes)

> ⚑ **The P3b/P3c plan HEADERS say "NOT STARTED" and are WRONG** — the cores are built. Plan checkboxes
> and headers have been unreliable in BOTH directions all program. Everything below was verified by
> reading code/filesystem on 2026-07-22.

### ⚠️ BEFORE building 6.4 — two blockers found 2026-07-22 by reading the code

**(a) `timesheetPushKey` is in the WRONG MODULE for the sweep to use.**
It is defined at `pmo-portal/src/lib/repositories/index.ts:551` — a CLIENT module with 38 imports
including `@/src/lib/supabase/client` (the browser singleton). The Deno sweep cannot import that.
Contrast `budgetPushKey.ts`, deliberately placed under `adapterSeam/` with a header saying exactly
why: *"so both originators (FE consequence path and the Deno sweep) can import it."*
**Move it to `adapterSeam/erpnext/timesheetPushKey.ts` FIRST.** If the sweep instead re-implements the
key, the two originators can drift — and a drifted key is precisely a DUPLICATED WEEK OF HOURS.

**(b) ✅ RESOLVED — NOT a defect. Probed 2026-07-22, and the probe REFUTED the concern.**
`timesheetPushKey` embeds the RAW timestamp (`ts:<id>:<approved_at>`) whereas `budgetPushKey`
normalises to epoch-ms, and `budgetPushKey`'s header warns that two transports can render one instant
differently — so the worry was that the FE (which reads `approved_at` from the **RPC return**) and the
6.4 sweep (which reads it from a **column select**) would derive DIFFERENT keys, the outbox 4-tuple
would not collide, and the client would be billed a DUPLICATED WEEK of hours.

**Measured against the live DB — they are identical:**
```
column select : "2026-07-19T02:55:21.340995+00:00"
RPC return    : "2026-07-19T02:55:21.340995+00:00"
IDENTICAL     : true
```
Reason: **both paths go through PostgREST**, which serialises `timestamptz` the same way whether it is
a column or an RPC's returned field. `budgetPushKey`'s warning is about a *server-side/SQL* read
(`2026-07-16 10:00:00+00`, space-separated) — a transport neither timesheet originator uses.

**So 6.4 may proceed without changing the key.** ⚠️ The residual risk is narrow but real and worth a
comment at the definition: the raw-string key is safe ONLY while every originator reads `approved_at`
through PostgREST. If any future originator uses a non-PostgREST path (raw SQL, a Deno pg driver, a
report export), the raw string breaks and duplicates hours. `budgetPushKey` is robust to that by
construction; `timesheetPushKey` is not. Probe script:
`scratchpad/probe-key.mjs` (re-runnable under `scripts/with-db-lock.sh`).

*(Recorded as a HIGH earlier the same day and disproved by measurement — kept here deliberately so
nobody re-raises it from the code shape alone. It was flagged must-PROVE, not must-fix; this is the
proof.)*

### The 9 MISSING served-fn e2e journeys — exact worklist (paths are the SPEC's own, §1010+)
None of these exist. `e2e/serial/` currently has `AC-732-budget-activate.spec.ts` and the P3a
`AC-SAR-*` set only. Idiom to copy: `AC-SAR-010-pe-receive-idempotency.spec.ts` (serial-isolation
header, `ERPNEXT_TEST_FAULTS`, live bench @ `localhost:8080`, served fns).

| AC | File the spec names | Proves |
|---|---|---|
| AC-TSP-010 | `AC-TSP-010-approved-only-gate.spec.ts` | a non-Approved sheet NEVER reaches ERP, whatever the command claims |
| AC-TSP-011 | `AC-TSP-011-timesheet-push.spec.ts` | approval pushes; the ERP doc lands submitted with hours + project |
| AC-TSP-020 | `AC-TSP-020-push-idempotency.spec.ts` | **the sweep and the user cannot both create a Timesheet** |
| AC-TSP-022 | `AC-TSP-022-sweep-backstop.spec.ts` | the backstop recovers a stranded push |
| AC-TSP-031 | `AC-TSP-031-cross-org.spec.ts` | cross-org links rejected BEFORE the external write |
| AC-TSP-040 | `AC-TSP-040-native-timesheet-not-adopted.spec.ts` | a natively-created ERP Timesheet is never adopted |
| AC-TSP-041 | `AC-TSP-041-desk-cancel-tombstone.spec.ts` | desk-cancel reopens + tombstones |
| AC-BUD-030 | `AC-BUD-030-*.spec.ts` | activation pushes the mapped budget with its overspend controls |
| AC-BUD-031 | `AC-BUD-031-*.spec.ts` | **re-activation upserts the SAME ERP Budget — never a duplicate** |

⚑ **Dependency:** `AC-TSP-020` and `AC-TSP-022` both exercise the SECOND originator, so **slice 6.4
(the timesheet backstop) must be built FIRST** — otherwise those two specs have nothing to test and
would either be skipped or written to assert the one-originator status quo (which would then pin the
defect, defect class 2). Order: 6.4 → 6.5 → the 9 e2e journeys.

⚑ **These need the live bench + served fns + the shared DB, so they are STRICTLY SERIAL** with any
other DB-driving lane (`scripts/with-db-lock.sh`). Do not run an e2e lane and a build lane at once.

### P3b slice 6 — re-verified 2026-07-22 (the earlier "partial" was imprecise)
- ✅ **6.2 never-adopt** — `native-timesheet-not-adopted` in `_shared/erpnextFeedDeps.ts`.
- ✅ **6.3 desk-cancel reopen** — AC-TSP-040 + AC-TSP-041 proven in `_shared/erpnextFeedDeps.test.ts`.
- ❌ **6.4 the TIMESHEET sweep backstop** (FR-TSP-045 → AC-TSP-022). `grep
  'reconcileOrgTimesheetPushes|timesheetBackstop'` in `erpnext-sweep/` returns NOTHING. Budget got its
  backstop (P3c slice 5); timesheets never did.
  **⚑ Why this is a money gap, not missing coverage:** the timesheet push then has exactly ONE
  originator (the Approvals UI). A push that fails after the browser dies is **stranded with no
  automatic recovery** — the same class as budget's HIGH-C, which audit round 3 rated HIGH. The
  operator Retry affordance (`usePushesNeedingAttention`) is a manual path, not a backstop.
- ❌ **6.5 webhook trust boundary for the new kinds** (FR-TSP-081 → AC-TSP-042, "stale/out-of-order
  events are no-ops"). No AC-TSP-042 proof exists — only 040 and 041 are present. Spec §1024 assigns it
  to `erpnext-webhook/index.test.ts` + `_shared/erpnextFeedDeps.test.ts`.
  **Note:** the staleness guard this AC tests (`readMirrorSourceMod`) was BROKEN by the `.eq('id')`
  defect until round-1 HIGH-1 fixed it — so this AC may never have been provable, which is likely why
  it was skipped.


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
- **Deno: all 21 edge functions green** — adapter-dispatch 214 · erpnext-sweep 76 · erpnext-webhook
  30 · external-disconnect 19 · erpnext-onboard 8 · agent-chat 3 · clickup-sweep 3 · the six
  `external-*` singles · the rest have no tests.

  ⚑ **Invocation gotcha:** the six `external-*` functions need
  `deno test . --config deno.json --allow-env --allow-net --allow-read`. A bare
  `deno test . --config deno.json` reports `0 passed | 1 failed` with
  `NotCapable: Requires env access to "SUPABASE_URL"` — that is the **harness missing permission
  flags, not a code failure**. Don't chase it as a regression.

**So the full battery is GREEN at `a1a486e1`:** verify 737 files / 5990 tests exit 0 · pgTAP
2016/2016 · deno all green. **What is missing is not test coverage — it is ADVERSARIAL review** (§6).

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

## 5c. ⚑ Load-induced phantom failures — do not chase them as regressions

Running several build/audit agents concurrently drives this Mac to **load average 250+**, and at that
point `npm run verify` produces failures that look real and are not.

**The signature — all three must hold before you dismiss anything:**
1. Every failure takes **~5000-5300ms** (the `userEvent`/async timeout boundary), rather than failing
   on an assertion with a value diff.
2. The failing specs are in areas **completely unrelated** to the change under test (this session:
   a11y on `/administration`, auth-floor analytics, the panel-editor form — while the change touched
   only the budget gate and the dispatch seam).
3. `uptime` shows a load average in the hundreds.

**What to do:** let the agents finish, confirm load has dropped, and re-run. Do NOT "fix" the tests
and do NOT revert the change. The cost of getting this wrong is high in both directions — bending a
real failing test to green, or burning hours on a phantom.

**Prevention:** run the FULL verify as a quiet, exclusive gate — not while lanes are mid-edit. A
verify that overlaps another agent's writes is also not cleanly attributable to your own change even
when it passes.

## 6. Resume here (as of `305a6f72`, 2026-07-22)

**Round-3 findings still OPEN** (a fix lane is in flight for these; verify its work, do not trust it):
- **H-3 (HIGH)** — `0139` adds `activated_at` with NO backfill, so a pre-existing Active version is
  BOTH unpushable (`budgetPushKey` throws, and `retryBudgetPush`'s bare `catch` swallows it) AND
  invisible (`0141:88`'s never-pushed alarm requires `activated_at is not null`). Clean screen, zero
  ERP enforcement, no reachable retry. ⚑ Whatever backfills it must be **stable forever** — the stamp
  feeds the deterministic idempotency key, so a value derived at read time from a mutable column would
  change the key and mint a SECOND ERP Budget.
- **H-4 (HIGH)** — the READ-SIDE TWIN of the FY fix. `BudgetProjection.tsx:47/~167` offers CALENDAR
  years while `0141` matches the ERP Fiscal Year **name**, so a Jul–Jun client sees actuals 0.00 and
  variance = +the whole budget on the primary money screen. Existing tests feed the same string to both
  sides — vacuous by construction.
- **M-1** — MEDIUM-G's assumed "one clearing writer" for `erp_cancelled_at` does not exist, so a
  once-cancelled version is excluded from the backstop queue permanently.
- **M-2** — a benign `COMMAND_IN_FLIGHT_FOR_RECORD` 409 is recorded as a budget push failure (false
  money alarm on a normal concurrent retry).
- **L-1** — `stampAmended` (`erpnextFeedDeps.ts:~204`) still uses a bare `.eq('id', …)`; round 2 called
  it benign but that claim is unverified.

**Then:**
1. Run the FULL battery yourself — it is the ground truth, not any lane's report:
   `cd pmo-portal && npm run verify` (at LOW LOAD — see §5c) ·
   `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` ·
   `deno test .` in `adapter-dispatch`, `erpnext-sweep`, `erpnext-webhook` · boot-smoke.
2. **Run audit round 4** with §7's brief. Three rounds have each found real defects; P3a needed nine.
   Point it hardest at what changed since round 3 and at the H-3/H-4 fixes.
3. Remaining BUILD gaps (filesystem-verified, not plan checkboxes): the P3b/P3c **e2e journeys** vs the
   live bench (`e2e/serial/` has `AC-732-budget-activate.spec.ts` only — no TSP journey), and P3b
   slice 6's feed/desk-cancel coverage.
4. Only then PR to `dev`. **`main` is the autonomous ceiling; never touch `production`.**

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
