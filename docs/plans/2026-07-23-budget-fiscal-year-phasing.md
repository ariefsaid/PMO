# Plan: Budget fiscal-year / phasing dimension (Issue BFY)

> **Spec (authority):** `docs/specs/budget-fiscal-year-phasing.spec.md` (round 2, the four-fact fence).
> **Review it answers:** `docs/reviews/2026-07-23-luna-fu2-budget-fiscal-year-spec.md` (findings 1–11).
> **Closes:** OQ-BUD-3 option (c) + **FR-BUD-152** (rewire `get_budget_projection` to PMO's own facts).
> **IDs:** `FR-BFY-###` / `NFR-BFY-###` / `AC-BFY-###`. **ADRs:** 0048 (no invented allocation), 0055 §6
> (one ERP `Budget` per project × FY), 0059 (Posture B), 0010 (test pyramid), 0011/0016/0017/0019.

## The fence — every money-attribution predicate names exactly one fact (the spine of this plan)
- **F-A** a push **SUCCEEDED** for the year → mirror row `push_state='pushed'`.
- **F-B** an **attempt** was made → any mirror row (`pushed`/`failed`/`held`). **Never a money-attribution test.**
- **F-C** PMO's **own** Active line items name the year → `li.fiscal_year = <year>`.
- **F-D** the attribution is **KNOWN** (per category-year) → the new `attribution_known` column.

**Binding invariants the plan enforces:** (1) `on_record` = **F-C ∨ F-A**, never F-B. (2) NULL-line
attribution = **F-A pushed + matching push-time span witness**, never on_record, never F-B. (3) When
`attribution_known` (F-D) is false, variance/utilization are **NULL** (not 0, not `-EAC`); `-EAC` fires
ONLY for a known year with genuinely no line. (4) The **SQL RPC and the JS twin change in the SAME task**.
(5) **`command.record.id` stays the bare `budget_version_id` UUID**; a separate server-derived
`outbox_identity = <vid>:<encoded-fy>` keys the outbox + external_refs; the mirror FK stays bare UUID.

## Migration numbers (decided — do not re-litigate)
- **`0153_budget_line_item_fiscal_year.sql`** — additive column + witness columns + `clone_budget_version`
  + the three RPC rewrites (§§1–5 of the spec). Additive; reversible for the single-FY population.
- **`0154_budget_identity_year_qualified.sql`** — the identity re-key (preflight + fence + deterministic
  re-key) + its companion **`0154_…_down.sql`** (staged, fail-closed on multi-FY). **The riskiest task.**
- `dev` is at `0150`; another lane holds `0151`/`0152`. **Do not use 0151/0152.**

## Conventions (binding)
- **TDD:** every task writes/extends the **failing test first**, then the production code.
- **DB work gate (ONE lock hold, chained):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
- **TS/FE inner loop:** `cd pmo-portal && npx vitest run <path>`. **Phase gate (full suite):**
  `cd pmo-portal && npm run verify:locked` (the shared-machine locked verify).
- **Served (Deno) tests:** import the **SHIPPED handler** from `./index.ts`, mock `globalThis.fetch` (per
  `scripts/check-edge-fn-test-binding.mjs` + Supabase unit-test guidance). Repo convention is **co-located
  `*.test.ts`** (camelCase TS, snake_case pgTAP); the spec's `__tests__/` paths map 1:1 to these.
- **DB-touching tasks MUST NOT run concurrently** with the other DB lane; pure-TS tasks may.

---

## Phase A — Pure TS/FE logic (no DB contention; concurrent-safe with the other lane)

### T1 — Canonical fiscal-year encoding + identity parser
**Test (fails first):** `pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.test.ts` —
`encodeFiscalYear`/`decodeFiscalYear` round-trip `'2026'`, `'2025-2026'`, `'A:B 2026'` (colon), `'FY 2026'`
(space); `''` rejected; `budgetVersionIdOf('<vid>:<enc>')` recovers the bare `<vid>`; an unparseable
identity throws.
**Code:** new `pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts` — URL-safe base32 of the UTF-8
name (no `:`/space/letter collision; round-trippable for any ERPNext `Fiscal Year` name), `budgetVersionIdOf(identity)`.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/fiscalYearEncoding.test.ts`.
*Cannot see: the served key guard (AC-BFY-030).*

### T2 — `budgetPushKey` becomes per-year, server-derived
**Test (fails first):** extend `pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.test.ts` —
`budgetPushKey(versionId, encodedFy, activatedAt)` === `bud:<vid>:<encodedFy>:<epochMs>`; rejects a
missing/unparseable stamp; a colon-bearing `encodedFy` survives.
**Code:** `pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts` — new 3-arg signature (drops the client
2-arg form). Callers updated in **T13/T14**.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/budgetPushKey.test.ts`.
*Cannot see: the served fan-out (AC-BFY-009).*

### T3 — Generic dispatcher `outboxRecordId` seam
**Test (fails first):** extend `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` —
`dispatchMoneyWrite({command, money, outboxRecordId})` keys `readOutbox`/`insertOutboxPending` on
`outboxRecordId ?? command.record.id`; every non-budget domain unchanged (defaults to `record.id`).
**Code:** `pmo-portal/src/lib/adapterSeam/dispatch.ts` — add optional `outboxRecordId` to
`DispatchMoneyWriteDeps`; thread into both outbox calls.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/dispatch.test.ts`.
*Cannot see: the budget path consuming it (T13).*

### T4 — Gate: per-year push plan + project span  (AC-BFY-004/005/006/007/008)
**Test (fails first):** `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` — single-FY + NULL lines →
one plan entry (all lines); multi-FY + any NULL → `budget-multi-fiscal-year-unphased` **naming the NULL
lines**; multi-FY all-phased → one entry per distinct phased year; a `fiscal_year` naming no `Fiscal Year`
→ `budget-fiscal-year-invalid` (names line+value); a phased year outside `[startFY,endFY]` →
`budget-fiscal-year-out-of-span`; result carries `projectStartDate`/`projectEndDate` (date strings).
Update the existing `budgetGate.test.ts` for the widened return shape.
**Code:** `pmo-portal/src/lib/budget/budgetGate.ts` — `runBudgetGate` returns `{ plan: [{fiscal_year,
line_items}], projectStartDate, projectEndDate, versionId, projectId, activatedAt }`; `readLineItems` now
returns `fiscal_year`; new error codes. `pmo-portal/src/lib/budget/categoryAccountMap.ts` —
`BudgetLineItem` gains optional `fiscal_year`.
**Verify:** `cd pmo-portal && npx vitest run src/lib/budget/budgetGate.fiscalYear.test.ts src/lib/budget/budgetGate.test.ts`.
*Cannot see: the served fan-out + failure writers (AC-BFY-009/011).*

### T5 — `budgetToBody` consumes a per-year slice (pin)
**Test (fails first):** extend `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.test.ts` —
`budgetToBody` builds exactly one body from a single year's `line_items` + resolved accounts; an empty
year slice → throws (`accounts` empty).
**Code:** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.ts` — confirm it reads
`record.line_items`/`record.fiscal_year` per call (already the case); no body-level split. Pin the contract.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/bodies/budget.test.ts`.
*Cannot see: the fan-out producing the per-year slice (T13).*

---

## Phase B — Schema + SQL (DB; ALL under `with-db-lock`, NOT concurrent with the other DB lane)

### T6 — 0153 §1+§4: additive column + mirror witness columns  (AC-BFY-001/016 partial)
**Test (fails first):** `supabase/tests/bfy_column_nullable.test.sql` — `budget_line_items.fiscal_year`
exists, nullable, no default, no CHECK; `budget_version_erp_mirror.pushed_project_start_date` /
`pushed_project_end_date` exist type `date` (NOT timestamptz — matches `projects.start_date/end_date`),
nullable; no new RLS policy on either table.
**Code:** `supabase/migrations/0153_budget_line_item_fiscal_year.sql` §1 (`alter table … add column
fiscal_year text` + comment) + §4 (`alter table budget_version_erp_mirror add column
pushed_project_start_date date, add column pushed_project_end_date date` + comments). No default, no NOT
NULL, no new policy (the mirror's force-RLS + the line-items policies cover them).
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*No predicate yet. Cannot see: that writers populate the witness (AC-BFY-019 served).*

### T7 — 0153 §2: `clone_budget_version` copies `fiscal_year`  (AC-BFY-003)
**Test (fails first):** `supabase/tests/bfy_clone_preserves_fiscal_year.test.sql` — clone a Draft with one
phased line (`fiscal_year='2025-2026'`) + one NULL line; assert clone's phased line keeps the year, NULL
line stays NULL, a fresh line is insertable with no `fiscal_year`. **Mutation:** drop `fiscal_year` from the
INSERT list → the clone's phased line is NULL → red.
**Code:** 0153 §2 — `drop function … clone_budget_version(uuid); create … ` re-created verbatim from `0005`
(its authz is org+role, NO `is_active_member` in 0005 — keep verbatim) with `fiscal_year` added to the
`INSERT … SELECT` column list.
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: the UI affordance (AC-BFY-016).*

### T8 — 0153 §3a: rewire `get_budget_projection` (SQL **and** JS twin, ONE task)  (AC-BFY-013/014/023/024/028)
**Facts named:** `on_record` = **F-C ∨ F-A**; `attributed_null` = **F-A pushed + witness match**;
`attribution_known` = **F-D**; `-EAC` fires ONLY when budget NULL **and** `attribution_known ≠ false`
**and** `on_record`.
**Test (fails first, pgTAP):** `supabase/tests/bfy_projection_refused_push.test.sql` (AC-013: a phased
year's `pmo_budget_amount` is stated via **F-C** even beside a producible `failed` mirror row — the row is
inserted with CHECK-valid `push_state='failed'`, a state the real writer produces, never a fictional "no
row"); `bfy_projection_null_lines.test.sql` (AC-014: a NULL line contributes to **no** year beside that
`failed` row; a year with no phased line + no `pushed` row → `pmo_budget_amount` NULL, never 0);
`bfy_on_record_excludes_failed.test.sql` (AC-024: failed-only year → `on_record=false`, variance NULL not
`-EAC`); `bfy_attribution_known.test.sql` (AC-023: suppressed category → `attribution_known=false`,
variance/utilization NULL; genuinely-no-line category in a known year → `-EAC` — independent oracle
recomputes both); `bfy_unmapped_category_null.test.sql` (AC-028: no map row → `actuals_to_date` NULL not 0,
both years).
**Code:** 0153 §3a — `drop function … get_budget_projection(uuid,text); create …` per spec §6.1/§6.2:
`budget_year.on_record` = `coalesce(p_fiscal_year,'')<>'' and (exists(phased Active line for year) [F-C] or
exists('pushed' Active mirror for year) [F-A])`; add `attributed_null` CTE (**F-A pushed** + (witness NULL
[backward-compat] or witness `is not distinct from` current `projects.start_date/end_date`)); `pmo_budget`
sums `filter (where li.fiscal_year=p_fiscal_year or (li.fiscal_year is null and exists(attributed_null)))`
+ `bool_or(same) as attribution_known`; variance/utilization `case when coalesce(attribution_known,true)=false
then null …` before the existing `-EAC`/subtraction branches; `projected_final_cost` (EAC) untouched.
**JS twin (SAME task, FENCE 3):** `pmo-portal/src/lib/budget/budgetProjection.ts` — add
`attributionKnown?: boolean` (per category, default `true`) to `ProjectionInput`; in `deriveProjectionCell`,
when `attributionKnown===false`, return `projectedVariance`/`projectedUtilization` `null` (EAC still
stated); update `budgetProjection.test.ts` twin cases.
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` then
`cd pmo-portal && npx vitest run src/lib/budget/budgetProjection.test.ts`.
*Cannot see: live ERP state (AC-011); a witness written by a REAL push (AC-BFY-019 served).*

### T9 — 0153 §3b: rewire `list_budget_fiscal_years`  (AC-BFY-015)
**Facts named:** `observed` unions **F-B** (all mirror years, including failed — legitimately inspectable)
∪ actuals ∪ etc ∪ distinct `li.fiscal_year` (**F-C**); `is_active_push` == `on_record` = **F-C ∨ F-A**.
**Test (fails first):** `supabase/tests/bfy_list_fiscal_years.test.sql` — the phased-but-refused project of
AC-013: FY2026 offered; `is_active_push=true`; the test **re-derives** the flag from FIRST PRINCIPLES
(`exists(phased Active line for fy)`) and asserts equality (mutation: if `is_active_push` and `on_record`
were the same wrong predicate, the independent re-derivation disagrees → red).
**Code:** 0153 §3b — re-create `list_budget_fiscal_years`: `observed` adds `select distinct fiscal_year
from budget_line_items where fiscal_year is not null` (any version); `is_active_push` =
`exists(phased Active line) or exists('pushed' Active mirror)` — byte-for-byte `on_record`.
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: the page rendering the flag (AC-BFY-026 e2e).*

### T10 — 0153 §3c: `get_budget_push_status` per-year  (AC-BFY-025)
**Facts named:** the expected-set LEFT-JOIN **includes F-B rows as status rows** (a `failed`/`held` year IS
a status row the surface renders) — attribution is NOT consulted here (that's T8).
**Test (fails first):** `supabase/tests/bfy_push_status_per_year.test.sql` — multi-FY Active phased to
FY2026+FY2027, FY2026 pushed, FY2027 has no mirror row → **two rows** (`pushed`, `never-pushed`); each row
carries `stale_attribution`. **Mutation:** `limit 1` → FY2027 omitted → red; an independent oracle
re-derives the expected set from `budget_line_items.fiscal_year`.
**Code:** 0153 §3c — re-create `get_budget_push_status`: expected = `select distinct fiscal_year from
budget_line_items where version=Active and fiscal_year is not null ∪ select fiscal_year from mirror where
version=Active`; LEFT-JOIN mirror (absent expected year → explicit `never-pushed`); add `stale_attribution
boolean` (the T8 drift result: NULL lines whose witness drifted); keep the `unrecorded` inference for a
version with no mirror rows AND no phased lines; add `hold_releasable` per year (outbox held for that
year-qualified `pmo_record_id`).
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: the page rendering (AC-BFY-026).*

### T11 — 0153 §5: RPC security modes acceptance-bound  (AC-BFY-017)
**Test (fails first):** `supabase/tests/bfy_fiscal_year_rls_and_rpc_security.test.sql` — cross-org
read/write of `fiscal_year` denied/empty; for all three RPCs assert `prosecdef=false`,
`proconfig->>'search_path'='public, pg_temp'`, `authenticated`-only ACL, `anon`/`public` revoked;
`clone_budget_version`/`activate_budget_version` retain security-definer authz. **Mutation:** recreate a
function `SECURITY DEFINER` → `prosecdef` assertion red; drop `search_path` → `proconfig` assertion red.
**Code:** 0153 — ensure the three DROP+re-create statements carry `language sql stable security invoker set
search_path = public, pg_temp` + the `revoke … from public/anon; grant execute … to authenticated; revoke
… from anon` triplet (the 0149 idiom). `clone`/`activate` unchanged from T7/`0005`+`0139`.
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: the JS oracle's `attributionKnown` (AC-BFY-023 twin, owned by T8).*

### T12 — `database.types` regen + Draft guard covers `fiscal_year`  (AC-BFY-016)
**Test (fails first):** `supabase/tests/bfy_draft_guard_fiscal_year.test.sql` — set `fiscal_year` on a
Draft line OK; set/update it on an Active line → `P0001` (the existing `enforce_draft_line_item` trigger
covers the new column automatically — assert it).
**Code:** regen `pmo-portal/src/lib/supabase/database.types.ts`:
`scripts/with-db-lock.sh supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`.
(No trigger change — `enforce_draft_line_item` is column-agnostic.)
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` then
`cd pmo-portal && npm run typecheck`.
*Cannot see: the UI affordance (AC-BFY-016 e2e).*

---

## Phase C — Served boundary + FE consumers (TS; Deno tests mock fetch — no DB lock)

### T13 — Served boundary: budget fan-out, per-year identity/key, witness stamp, specific-year failures  (AC-BFY-009/030)
**Facts named:** the failure writers record **F-B** (an attempt) — and are **explicitly NOT consulted** for
attribution (T8 excludes F-B from `on_record`).
**Test (fails first, Deno):** `supabase/functions/adapter-dispatch/bfyTypedCommand.test.ts` (AC-009) +
`bfyColonFyRoundtrip.test.ts` (AC-030) — import the SHIPPED budget path from `./index.ts`, mock
`globalThis.fetch`; drive `dispatchBudgetPush(versionId)` (the client sends **no** key); assert each year's
outbox row has `pmo_record_id=<vid>:<enc-fy>`, `idempotency_key=bud:<vid>:<enc-fy>:<epoch>`; mirror rows
carry the **bare** UUID FK + the correct year + **non-NULL witness**; a colon-bearing FY (`'A:B 2026'`)
round-trips with no guard rejection. **Mutation:** year in `record.id` → gate's `budget_versions.id =`
returns nothing → "version not readable" red; year in the FK → uuid violation red.
**Code:**
- `supabase/functions/adapter-dispatch/index.ts` budget path — run the gate; **loop the plan**; per year:
  `encodedFy=encodeFy(fy)`, `identity=<vid>:<encodedFy>`, `key=budgetPushKey(vid,encodedFy,activatedAt)`;
  validate via the extended guard; set `command.record={...record, fiscal_year:fy, line_items:entry.lines,
  outbox_identity:identity, project_start_date:gate.projectStartDate, project_end_date:gate.projectEndDate}`;
  call `dispatchMoneyWrite` with `outboxRecordId=identity` (T3). **Skip the client-key pre-check for
  `domain='budget' && operation='create'`** (server derives). `recordBudgetGateFailure`/
  `recordBudgetPushFailure` stamp the **specific** failing year (from `command.record.fiscal_year`), not the
  start FY.
- `transitionTargetGuard.ts` — extend `isOpaqueIdempotencyKey` to accept a 4-segment
  `bud:<uuid>:<token>:<epoch>` and validate the encoded-fy decodes non-empty; `checkCreateTargetUnmapped`
  resolves the budget domain's year-qualified identity (`command.record.outbox_identity`) for the
  external_refs lookup.
- `readModelWriters.ts` `budgetWriter` — FK stays `budget_version_id=canonical.id` (bare UUID); year from
  `canonical.fiscal_year`; **stamp `pushed_project_start_date`/`pushed_project_end_date`** (date) from
  `canonical.project_start_date`/`project_end_date` on **every** outcome (`pushed` and `failed`).
- external_refs writer — `pmo_record_id=identity` (year-qualified).
**Verify:** `cd supabase/functions/adapter-dispatch && deno test --allow-all`.
*Cannot see: live ERP `Budget` creation (AC-BFY-011 e2e).*

### T14 — Foreground dispatch + repository: server fan-out, per-year status array, FY-arg retry/release
**Test (fails first):** extend `pmo-portal/src/lib/db/budgets.test.ts` — `dispatchBudgetPush(versionId)`
takes no client key; `retryBudgetPush(versionId, fiscalYear)` derives the per-year identity; extend
`pmo-portal/src/lib/repositories/budgetProjection.test.ts` — `fetchBudgetPushStatus` returns
`BudgetPushStatusRow[]`; `releaseActiveBudgetPushHold(projectId, fiscalYear)` filters the outbox by the
year-qualified `pmo_record_id`.
**Code:** `pmo-portal/src/lib/db/budgets.ts` — drop the client-minted key; `dispatchBudgetPush(versionId)`
issues the bare-UUID create (server fans out); `retryBudgetPush(versionId, fiscalYear)`; `pushActivatedBudget`.
`pmo-portal/src/lib/repositories/budgetProjection.ts` — `fetchBudgetPushStatus` maps the RPC rows to an
array; retry/release helpers take a validated `fiscalYear`.
**Verify:** `cd pmo-portal && npx vitest run src/lib/db/budgets.test.ts src/lib/repositories/budgetProjection.test.ts`.
*Cannot see: the page rendering (AC-BFY-026).*

### T15 — BudgetProjection page: per-year status + FY-arg retry/release  (AC-BFY-026)
**Test (fails first):** `pmo-portal/pages/BudgetProjection.test.tsx` (RTL) — `pushQuery` yields an array;
every expected year renders; a failed year is not hidden by ordering; retry dispatches for the row's
year; release targets the row's year.
**Code:** `pmo-portal/pages/BudgetProjection.tsx` — render per-year rows; `retryMutation`/
`releaseMutation` carry the row's `fiscalYear`.
**Verify:** `cd pmo-portal && npx vitest run pages/BudgetProjection.test.tsx`.
*Cannot see: the RPC expected-set derivation (AC-BFY-025 pgTAP).*

### T16 — Budget UI per-line FY affordance (Draft only) + CRUD carries `fiscal_year`
**Test (fails first):** extend `pmo-portal/pages/ProjectBudget.test.tsx` + `pmo-portal/src/hooks/useBudget.test.ts`
— a Draft line shows an FY affordance (select of known client FYs when an erpnext binding is active, else
free text); an Active line's affordance is disabled/hidden; `createLineItem`/`updateLineItem` carry
`fiscal_year`.
**Code:** `pmo-portal/src/hooks/useBudget.ts` (`NewLineItem` gains optional `fiscal_year`);
`pmo-portal/src/lib/db/budgets.ts` (`createLineItem`/`updateLineItem` persist `fiscal_year`);
`pmo-portal/pages/ProjectBudget.tsx` (the affordance, `<CanWrite>`-gated, Draft-only).
**Verify:** `cd pmo-portal && npx vitest run pages/ProjectBudget.test.tsx src/hooks/useBudget.test.ts`.
*Cannot see: the Draft-only DB enforcement (AC-BFY-016 pgTAP).*

### T17 — `resolveBudgetRefs` ownership check + sweep gate reuse + feed parser  (AC-BFY-022/027)
**Facts named:** `resolveBudgetRefs` requires a **PMO ownership witness** (external_refs for the
year-qualified identity) — not bare grain occupancy; the sweep re-runs the gate (**F-C/F-A/calendar/span**)
before POSTing.
**Test (fails first, Deno):** `supabase/functions/adapter-dispatch/bfyUnownedLiveOccupant.test.ts` (AC-027)
— a Desk-authored live Budget (docstatus=1) with NO external_refs mapping → `budget-unowned-live-occupant`
naming doc+year, ERP holds exactly the one Desk Budget; a PMO-mapped live occupant → amended (regression).
Import the shipped handler, mock `fetch`. `supabase/functions/erpnext-sweep/bfySweepGate.test.ts` (AC-022)
— a pending outbox row for `<vid>:<fy1>` whose project `end_date` was later extended past fy1 → the sweep
re-runs the gate for fy1, finds the rejection, HOLDS with `budget-sweep-gate-held` (no POST).
**Code:**
- `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` `resolveBudgetRefs` — before accepting a
  docstatus=1 grain occupant as `refs.self`, require a PMO `external_refs` mapping for
  (domain='budget', the year-qualified identity); else throw `budget-unowned-live-occupant`. Draft rivals
  unchanged (`budget-draft-rival-on-grain`).
- `supabase/functions/erpnext-sweep/index.ts` `buildReconcileDepsLive` + `budgetBackstop.ts` — re-run
  `runBudgetGate` for the specific year (parse fy from the year-qualified `pmo_record_id` via
  `budgetVersionIdOf`+decode); on rejection, HOLD with `budget-sweep-gate-held`; the orphan backstop
  selects the specific mirror/plan year.
- `supabase/functions/_shared/erpnextFeedDeps.ts` — the budget feed lookup calls
  `budgetVersionIdOf(identity)` (T1) **before** `.eq('budget_version_id', …)` (FR-BFY-038).
**Verify:** `cd supabase/functions/erpnext-sweep && deno test --allow-all` and
`cd supabase/functions/adapter-dispatch && deno test --allow-all`.
*Cannot see: live ERP naming grammar (AC-BFY-030); the orphan-backstop year-selection (adjacent served AC).*

---

## Phase D — Identity re-key migration (DB; RISKIEST; own pgTAP + rollback)

### T18 — 0154 preflight: fail-closed on unrecoverable rows  (AC-BFY-020)
**Test (fails first):** `supabase/tests/bfy_migration_preflight.test.sql` — seed each of (a) a bare
`external_refs` whose version has **>1** mirror fiscal_year, (b) a bare row with **no** mirror row, (c) an
**already-year-qualified** `pmo_record_id`, (d) an outbox `idempotency_key` not parseable as
`bud:<vid>:<epochMs>`; run 0154 → it RAISES naming the offender and leaves the DB unchanged (one transaction).
**Mutation:** preflight absent → case (a) picks one FY and orphans the other → red.
**Code:** `supabase/migrations/0154_budget_identity_year_qualified.sql` §preflight — a `DO $$ … $$` block
that `RAISE`s on each of the four invariants, before any rewrite.
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: deploy-time quiescence enforcement (the release runbook).*

### T19 — 0154 re-key + fence  (AC-BFY-018)  ← the riskiest task
**Test (fails first):** `supabase/tests/bfy_external_refs_rekey.test.sql` — seed OLD bare
`external_refs`+outbox rows + a mirror row recording `<fy>`; run 0154 under fence; assert
`external_refs.pmo_record_id` re-keyed **IN PLACE** to `<vid>:<enc-fy>` (the bare `<vid>` resolves NULL;
`<vid>:<fy>` resolves the **same** `external_record_id`); the outbox key now carries the year; a subsequent
`create` for `<vid>:<fy>` is **BLOCKED** by the mapped-record guard. **Mutation:** re-key as a NEW insert
leaving the orphan, or skipped → the guard passes a duplicate → red.
**Code:** 0154 §rekey — `perform pg_advisory_xact_lock(hashtext('pmo_budget_identity_rekey'));` then
`UPDATE external_refs SET pmo_record_id = <vid>||':'||encodeFy(fy) …` and the outbox rewrite, recovering
`<fy>` from the version's mirror row and the epoch from the old key. **Fence (binding):** the OLD budget
write path (foreground dispatch + sweep) is amended **in the SAME release** to attempt
`pg_try_advisory_xact_lock(hashtext('pmo_budget_identity_rekey'))` nowait before any budget outbox insert —
so an in-flight old-code push cannot land a bare `pmo_record_id` after the rewrite. **Primary mechanism is
deploy-time quiescence** (release-engineer drains/disables budget dispatch + sweep); the advisory lock is
defence-in-depth. Blast radius (honest): ERPNext is dark outside the bench, so the real population is
bench + demo (no seeded budget outbox/external_refs rows).
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: live ERP one-vs-two Budgets (AC-BFY-011/012).*

### T20 — 0154 reversibility (honestly bounded)  (AC-BFY-021)
**Test (fails first):** `supabase/tests/bfy_migration_reversibility.test.sql` — (a) a single-FY
year-qualified row reverts 1:1 to bare `<vid>`; (b) a multi-FY fan-out (two year-qualified rows for one
version) → rollback **FAILS CLOSED** naming the version (it does not silently drop a year).
**Mutation:** rollback that collapses two rows to one bare key → the second year's pointer is lost → red.
**Code:** `supabase/migrations/0154_budget_identity_year_qualified_down.sql` (staged, **not** run by
`supabase db reset`) — reverts single-FY rows by recovering `<vid>`/`<fy>` from the year-qualified identity
+ mirror; `RAISE` if any version has >1 year-qualified row.
**Rollback statement (binding):** dev/bench = `supabase db reset` to pre-0154; prod = run `0154_down` ONLY
if no multi-FY version exists (the down-migration itself fail-closes). **Named irreversibility:** once a
multi-FY push has happened, the identity is year-qualified for good.
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: live ERP pointer survival — named irreversibility, not a test gap.*

---

## Phase E — Backward compat, e2e, ship

### T21 — Backward-compat proof (all-NULL == pre-issue)  (AC-BFY-001/002)
**Fact named:** F-A satisfied ⇒ NULL lines attribute via the witness (FR-BFY-070 backward-compat).
**Test:** `supabase/tests/bfy_backward_compat.test.sql` — an all-NULL Active version with a `pushed` mirror
row → `get_project_budget`, `get_budget_projection(p, that year)`, `list_budget_fiscal_years`,
`get_budget_push_status` are byte-identical to the pre-issue values (snapshot the figures).
**Mutation:** if `pmo_budget` stopped attributing NULL lines via F-A+witness, this goes red. Also confirm
the shipped suites stay green unchanged: `0008`–`0012`, `0060`, `0075`, `budget_projection_rpc.test.sql`.
**Code:** none (proof).
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
*Cannot see: live ERP (AC-BFY-011).*

### T22 — e2e: multi-FY fan-out, partial failure, per-year status/retry  (AC-BFY-011/012/026)
**Test:** `pmo-portal/e2e/serial/AC-BFY-011-multi-fy-fan-out.spec.ts`, `AC-BFY-012-partial-failure-retry.spec.ts`,
`AC-BFY-026-per-year-status-retry.spec.ts` — real served `adapter-dispatch` boundary (**no `page.route`**);
assert ERP **STATE**: one `Budget` per phased year; partial failure leaves year 1 enforcing + year 2
`action-required`; retrying year 2 is not a duplicate; the page shows both years and retry acts on year 2.
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && cd pmo-portal && npx playwright test e2e/serial/AC-BFY-011-multi-fy-fan-out.spec.ts e2e/serial/AC-BFY-012-partial-failure-retry.spec.ts e2e/serial/AC-BFY-026-per-year-status-retry.spec.ts'` (e2e is DB-driving → lock).
*Cannot see: unit-level predicate mutation proofs (the pgTAP/Vitest ACs own those).*

### T23 — Ship gate (full verify, binding) + release
**Verify (binding, WHOLE suite):** `cd pmo-portal && npm run verify:locked` **and**
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`. Regenerate `database.types` once
more; `npm run typecheck` zero errors; `npm run lint:ci` zero warnings.
**Ship:** `release-engineer` → one PR to `dev` (one issue, one PR). **⛔ HARD STOP at `main` (the autonomous
ceiling); `main`→`production` is ALWAYS a separate, explicit, owner-gated action.**

---

## Traceability — AC-BFY-### → owning layer → exact test file (ADR-0010)

| AC | FR(s) | Layer | Owning file |
|---|---|---|---|
| AC-BFY-001 | 070, 050 | pgTAP | `supabase/tests/bfy_backward_compat.test.sql` |
| AC-BFY-002 | 070 | regression | existing suites (verified T21) |
| AC-BFY-003 | 001, 062, 071 | pgTAP | `supabase/tests/bfy_clone_preserves_fiscal_year.test.sql` |
| AC-BFY-004 | 011 | Vitest | `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` |
| AC-BFY-005 | 010 | Vitest | (same) |
| AC-BFY-006 | 030 | Vitest | (same) |
| AC-BFY-007 | 021 | Vitest | (same) |
| AC-BFY-008 | 021 | Vitest | (same) |
| AC-BFY-009 | 030, 031, 032, 036 | served | `supabase/functions/adapter-dispatch/bfyTypedCommand.test.ts` |
| AC-BFY-010 | 032, 034 | pgTAP+served | `supabase/tests/bfy_outbox_year_qualified.test.sql` + `bfyOutboxReplay.test.ts` (served) |
| AC-BFY-011 | 030 | e2e | `pmo-portal/e2e/serial/AC-BFY-011-multi-fy-fan-out.spec.ts` |
| AC-BFY-012 | 033, 034, 056 | e2e | `pmo-portal/e2e/serial/AC-BFY-012-partial-failure-retry.spec.ts` |
| AC-BFY-013 | 050 | pgTAP | `supabase/tests/bfy_projection_refused_push.test.sql` |
| AC-BFY-014 | 010, 052 | pgTAP | `supabase/tests/bfy_projection_null_lines.test.sql` |
| AC-BFY-015 | 051 | pgTAP | `supabase/tests/bfy_list_fiscal_years.test.sql` |
| AC-BFY-016 | 060, 061 | pgTAP | `supabase/tests/bfy_draft_guard_fiscal_year.test.sql` |
| AC-BFY-017 | 001; 090; SEC-001 | pgTAP | `supabase/tests/bfy_fiscal_year_rls_and_rpc_security.test.sql` |
| AC-BFY-018 | 035 | pgTAP | `supabase/tests/bfy_external_refs_rekey.test.sql` |
| AC-BFY-019 | 053, 080, 055 | served+pgTAP | `supabase/functions/adapter-dispatch/bfyWitnessDrift.test.ts` (+ pgTAP drift read) |
| AC-BFY-020 | 035b | pgTAP | `supabase/tests/bfy_migration_preflight.test.sql` |
| AC-BFY-021 | REV-001 | pgTAP | `supabase/tests/bfy_migration_reversibility.test.sql` |
| AC-BFY-022 | 075 | served | `supabase/functions/erpnext-sweep/bfySweepGate.test.ts` |
| AC-BFY-023 | 054, 055 | pgTAP+Vitest | `supabase/tests/bfy_attribution_known.test.sql` + `budgetProjection.test.ts` twin |
| AC-BFY-024 | 050, 052 | pgTAP | `supabase/tests/bfy_on_record_excludes_failed.test.sql` |
| AC-BFY-025 | 056 | pgTAP | `supabase/tests/bfy_push_status_per_year.test.sql` |
| AC-BFY-026 | 034, 056 | e2e | `pmo-portal/e2e/serial/AC-BFY-026-per-year-status-retry.spec.ts` |
| AC-BFY-027 | 076 | served | `supabase/functions/adapter-dispatch/bfyUnownedLiveOccupant.test.ts` |
| AC-BFY-028 | C-1 | pgTAP | `supabase/tests/bfy_unmapped_category_null.test.sql` |
| AC-BFY-029 | finding 8 / OQ-BFY-5 | pgTAP | `supabase/tests/bfy_map_edit_reinterprets_history.test.sql` |
| AC-BFY-030 | 031, 038 | served | `supabase/functions/adapter-dispatch/bfyColonFyRoundtrip.test.ts` |

> AC-BFY-010's `bfy_outbox_year_qualified.test.sql` + `bfyOutboxReplay.test.ts`, and AC-BFY-019's
> `bfyWitnessDrift.test.ts`, and AC-BFY-029's `bfy_map_edit_reinterprets_history.test.sql`, are added in the
> same tasks as their sibling tests (T13/T17/T8 respectively) — each with its own mutation check.

## SEQUENCING RISK
- **Pure TS/FE — concurrent-safe with the other lane (no DB):** T1, T2, T3, T4, T5 (Phase A); T13, T14, T15,
  T16, T17 (Phase C, Deno tests mock `fetch` + use stubs, no `db reset`); the FE halves of T22 prep.
- **DB-touching — MUST hold `with-db-lock`, NOT concurrent with the other DB lane:** T6, T7, T8, T9, T10,
  T11, T12 (build 0153), T18, T19, T20 (build 0154), T21 (proof), T22 (e2e drives the DB). Each runs as
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — chained inside ONE lock hold so
  a sibling worktree's reset cannot land between your reset and your test.
- **The single serialize-everything point is 0154 (T18–T20):** it acquires the advisory lock and rewrites
  budget-domain identity rows. No other DB-driving task in this plan (or the other lane) may run while it
  holds the lock; the release-engineer quiesces budget dispatch + sweep for its window.
- **Cross-phase dependency:** T13 (served fan-out) depends on T1/T2/T3/T4 + T6 (witness columns) — do not
  start T13 until Phase A's four + T6 land. T8 (projection) depends on T6's column. T17 depends on T1's
  parser + T13's identity shape.

## Self-verification (the brief's check)
- **Exact path + verify command on every task:** yes — each task names its file(s) and a runnable command.
- **Every predicate task names its fact:** T8 (`on_record`=F-C∨F-A; `attributed_null`=F-A;
  `attribution_known`=F-D; `-EAC` guarded by attribution_known≠false); T9 (`is_active_push`=F-C∨F-A,
  `observed` unions F-B — stated why correct); T10 (expected-set includes F-B as status rows — stated why
  correct); T13 (failure writers = F-B, never consulted for attribution); T17 (ownership witness; sweep
  gate = F-C/F-A/calendar/span); T19 (fence).
- **JS twin changes in the SAME task as its SQL:** T8 carries both the RPC rewrite and
  `budgetProjection.ts` `attributionKnown`.
- **Re-key has its own pgTAP proof + stated rollback:** T18 (preflight), T19 (re-key), T20 (reversibility)
  each have a dedicated pgTAP; the rollback statement names `supabase db reset` (dev/bench) and the
  fail-closed `0154_down` (prod, single-FY only).
- **Every test task states what it cannot see:** yes — each ends with a "*Cannot see: …*" line.
- **No AC passes a hand-seeded unreachable state:** AC-013/014/024 insert a CHECK-valid `failed`/`pushed`
  mirror row (a state the real writers **do** produce); AC-019 obtains the witness from a REAL served push;
  AC-009/022/027/030 drive the real served boundary; the served tests import the shipped handler + mock
  `fetch` (binding checker).

PLAN-DONE
