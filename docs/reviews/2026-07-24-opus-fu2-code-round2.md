VERDICT: NO SHIP

# Adversarial money/security review — FU-2 budget fiscal-year, round 2

**Subject:** `feat/budget-fiscal-year` (`origin/dev..HEAD`, 40 commits) — the fiscal-year/phasing dimension,
migrations `0153`/`0154`, an in-place edit to shipped `0137`, and the six claimed FU-2 fixes.
**Position:** fallback for the capped cross-family reviewer (gpt-5.6-luna). Same family as the builders —
see **CROSS-FAMILY BLIND SPOT**.
**Mode:** read-only. No implementation file was modified. Gates were not re-run (per brief).

The six FU-2 findings are genuinely fixed. B1's `scopeMirrorQuery` seam, B2's `isReplay`, B3's
`(version, fiscal_year)` orphan dedup, B4's locked-row derivation, H5's per-year dispatch and M6's domain
fence all do what they claim, and I traced each rather than trusting its comment. Two defects the fixes did
not reach are release-blocking: one is the SAME year-grain class B1/B3 closed, surviving in the sweep's hold
writer; the other is a set-logic choice inside the new F-D fact that lets a partially-unattributable
category state a confident, understated budget.

---

## BLOCK 1 — the sweep's budget hold is still version-scoped: one year's exhaustion permanently parks every other year

**File:** `supabase/functions/erpnext-sweep/index.ts:1105-1112` (`holdBudgetMirrorRow`, UPDATE branch).

```
  return serviceClient
    .from('budget_version_erp_mirror')
    .update({ push_state: 'held', push_error: reason })
    .eq('org_id', orgId)
    .eq('budget_version_id', budgetVersionId)
    .in('push_state', ['pending', 'failed'])
    .is('erp_cancelled_at', null);
```

The mirror grain is `(budget_version_id x fiscal_year)`. `fiscalYear` is destructured one line above
(`:1071`) and used **only** by the `absent`/INSERT branch. The UPDATE branch has no `fiscal_year` predicate —
the exact bare-version path FU-2 BLOCKER 1 and BLOCKER 3 were raised to remove, in the one budget mirror
writer that lives outside `scopeMirrorQuery`.

**Reproduction (inputs -> wrong money state).**
1. Project P, Active version V, lines phased to FY2026 and FY2027. Both years' pushes fail (ERP unreachable);
   two mirror rows, both `push_state='failed'`.
2. A sweep tick. `listPendingBudgetPushes` (`:1163-1173`) returns both rows. FY2026's outbox row still has
   attempts left; FY2027's is attempts-exhausted.
3. FY2027's candidate reaches `holdBudgetMirrorRow(..., row=FY2027, 'budget-push-attempts-exhausted')`
   (`:1247`). The UPDATE matches `org_id + budget_version_id + push_state in (pending,failed)` — i.e. **both
   rows**. FY2026 is set to `push_state='held'`, `push_error='budget-push-attempts-exhausted'`.

**Money consequence.** `listPendingBudgetPushes` filters `push_state in ('pending','failed')`, so FY2026 is
now excluded from the backstop's work queue **forever** — the automatic recovery for a year whose push was
still perfectly recoverable is dead. ERPNext holds no overspend control for FY2026's budget and nothing will
ever install one. The screen reports FY2026 as `held` carrying *FY2027's* reason, and `hold_releasable`
(0153 §3c) is `false` for it because its own outbox row is not `held` — so the Release affordance is
withheld too. The same defect fires from the `budget-push-no-outbox-candidate` caller (`:1223`).

**Smallest fix.** Scope the CAS to the grain, and refuse to write at all with no knowable year (the INSERT
branch already takes that posture at `:1092`):

```
    .eq('budget_version_id', budgetVersionId)
    .eq('fiscal_year', fiscalYear)      // the grain — a hold is about ONE year
```
with an early `if (!fiscalYear) return { error: null };` guarding the update path.

**Why no test caught it — and why no test in that file *can*.** `budgetOutboxOrphan.test.ts:55-79`'s `fakeDb`
defines `eq: () => builder` and records only the write *payload*, never the filters. Every assertion in that
file (including the two new, correct BLOCKER-3 tests) is structurally blind to a missing predicate on an
update. Compare `erpnextFeedDeps.test.ts`'s new `statefulBudgetClient`, which *does* apply `eq` filters to
select rows — that is the shape this file needs before its holds can be trusted.

---

## BLOCK 2 — `attribution_known` is `bool_or`, so a partially-unattributable category states a confident, understated budget

**File:** `supabase/migrations/0153_budget_line_item_fiscal_year.sql:299-314` (the `pmo_budget` CTE).

`attribution_known` is defined as "TRUE iff **at least one** of this category's lines is honestly attributed
here" (`:288-289`). The `sum(...) filter` and the `bool_or(...)` share one predicate, and the `coalesce(...,
false)` NULL-safety is correct — the defect is one level up, in the choice of `bool_or`. A category whose
lines are **partly** attributable and **partly** suppressed reports F-D = TRUE, and the fence's own rule
("derived money is NULL when attribution is not known") never engages.

**Reproduction (inputs -> wrong money figure).**
- Project P: single fiscal year at push time. Active version V:
  - line `Labor` $100,000 with `fiscal_year = '2026'`
  - line `Labor` $50,000 with `fiscal_year = NULL` (un-phased)
  (`budgetGate.buildPlan`'s single-FY branch explicitly permits this mix — it only rejects a line phased to a
  *different* year.)
- The push is **refused** — say `budget-category-unmapped`, the shipped, common blocker. So there is no
  `push_state='pushed'` mirror row.
- `get_budget_projection(P, '2026')` then computes:
  - `budget_year.on_record` = TRUE via **F-C** (the phased line names 2026) — this is FR-BUD-152 working as
    intended;
  - `attributed_null` = empty (it requires **F-A**, a successful push);
  - `sum(...) filter` counts only the phased line -> `pmo_budget_amount = 100000.00`;
  - `bool_or(...)` = TRUE, because the phased line satisfied the predicate -> `attribution_known = TRUE`;
  - `projected_variance` = `100000 - EAC`.

**Money consequence.** PMO holds **$150,000** of Labor budget for this project-year and can place only
$100,000 of it. The primary money screen states $100,000 as a fact and reports a variance $50,000 more
negative than PMO can support. Nothing marks the cell unavailable. `stale_attribution` is `false` (no
`pushed` row), so the FR-BFY-056 explanation never fires; the only banner on screen is the
`budget-category-unmapped` push failure, whose stated remedy ("map these categories, then retry") is
unrelated to the missing $50,000.

The drift variant reaches the same wrong number by a different route: same version, push **succeeded**, then
the PM extends `end_date` into FY2027. `attributed_null` goes false on the witness check (`:269-271`), the
un-phased $50,000 drops out, `bool_or` is still TRUE from the phased line, and the grid keeps printing
$100,000. Here a "stale attribution" banner *is* raised — but it explains a blank cell, and this cell is not
blank.

**Smallest fix.** F-D must mean "no line of this category is un-attributable in this year", while keeping the
deliberate all-phased-elsewhere FALSE (`:295-298`). Conjoin the existing fact with a suppression check:

```
           bool_or(
             coalesce(li.fiscal_year = p_fiscal_year, false)
             or (li.fiscal_year is null and exists (select 1 from attributed_null))
           )
           and bool_and(
             li.fiscal_year is not null                              -- phased: knowably elsewhere
             or exists (select 1 from attributed_null)               -- un-phased AND attributable
           ) as attribution_known
```

and null the amount alongside the derived figures, so the pair `(amount stated, attribution unknown)` cannot
appear at all — `budgetProjection.ts:150-156` already declares that pair impossible ("the SQL twin cannot
produce that pair"), which is true today only because `bool_or` never produces the FALSE.

**Test gap.** `supabase/tests/bfy_attribution_known.test.sql` fixtures a category with exactly **one**
(un-phased) line, so its 10 assertions cannot reach a mixed category. Add the mixed fixture in both variants
(refused push, and drifted witness) and assert `pmo_budget_amount IS NULL` + `projected_variance IS NULL`.

---

## SHOULD-FIX 3 — a multi-FY version with no line items reports "Budget pushed to ERPNext" having pushed nothing

**Files:** `pmo-portal/src/lib/budget/budgetGate.ts` (`buildPlan`, multi-FY branch) ->
`supabase/functions/adapter-dispatch/index.ts` fan-out loop -> `pmo-portal/src/lib/db/budgets.ts`
(`pushStateForYear`).

For a multi-FY project, `buildPlan`'s `unphased` filter is empty over an empty line list, the out-of-span loop
is a no-op, and the group-by yields `[]`. `budgetUnits = []`, the fan-out loop body never runs, `firstFailure`
is null, and the boundary answers `200` with `{ years: [] }`. `pushStateForYear` treats an empty/absent
`years` as success (`if (!Array.isArray(years) || years.length === 0) return 'pushed'`), so the toast says
"ERPNext is now enforcing the active budget" — no ERP Budget was created and no mirror row was written. The
per-year banner does subsequently render `never-pushed`, so the operator is given two contradictory
statements rather than one silent lie. Fix: treat an empty plan as a refusal in the gate (a plan with no
entries is not a push), or make `pushStateForYear` distinguish "no `years` key" (pre-BFY server) from
"`years: []`".

## SHOULD-FIX 4 — the `release_outbox_hold` change edits a shipped migration, so it can never reach a migrated database

**File:** `supabase/migrations/0137_budget_push_seam.sql:206` (signature) and `:272-274` (grants).

`0137` is a shipped migration. `supabase db push` / `migration up` apply only *unapplied* versions, so any
database already at >= 0137 keeps the 2-arg `release_outbox_hold` and never gets the 3-arg overload — while
`repositories/budgetProjection.ts:308-313` now always calls it with `p_expected_domain: 'budget'`. On such a
database the Release affordance dies with PostgREST `PGRST202` (function not found), which is invisible
locally because `db reset` replays from scratch.

The branch demonstrates the correct pattern twice, two files over: `record_outbox_ref` (defined in `0096`) is
redefined in the **new** `0154`, and `get_budget_projection` (`0149`) is redefined in **new** `0153`. Do the
same here: move the `release_outbox_hold` definition into `0154` (or a `0155`) verbatim and revert `0137`.

I rate this SHOULD-FIX rather than BLOCK because `docs/backlog.md` records the prod Cloud DB at roughly
migration 0081 — 0137 is not applied anywhere live today. **If any environment is already at >= 0137,
re-rate it to BLOCK.**

**Cross-lane hazard (flagged, not judged).** `feat/timesheet-reopen` rewrites the *body* of the same
2-arg `release_outbox_hold`. This branch's change is correct in isolation (`p_expected_domain` defaults to
NULL; every 2-arg caller is byte-for-byte unaffected; the check sits after the `FOR UPDATE` and before the
authz block, which is the right place). The incompatibility is structural: if the reconciliation lands the
two as *separate* function definitions, a database ends up with both `release_outbox_hold(uuid,text)` and
`release_outbox_hold(uuid,text,text default null)`, and every 2-arg call becomes ambiguous (`42725`). Whoever
merges must land ONE definition and explicitly `drop function if exists public.release_outbox_hold(uuid, text);`.

---

## NOTE 5 — `mirrorFiscalYear` fails **open**: an undecodable trailer silently restores version-wide scoping

`supabase/functions/_shared/erpnextFeedDeps.ts:110-113` -> `fiscalYearEncoding.ts:125-133`. `fiscalYearOf`
"never throws — a malformed/undecodable trailer yields `null` so a caller falls back to the bare-FK
behaviour". For the budget kind that fallback is precisely the all-years mutation BLOCKER 1 removed:
`scopeMirrorQuery` omits the `fiscal_year` predicate entirely and a Desk cancel of one year tombstones every
year. Not reachable through the shipped writers (the encoder only emits alphabet symbols in even-length
tokens), so it needs a hand-edited or half-migrated `external_refs` row. But the fail-open direction is wrong
for the highest-cost query in the module: when `kind === 'budget'` and the identity carries a `:`, a `null`
decode should throw, exactly as `budgetVersionIdOf` already does for a bad leading segment.

## NOTE 6 — the span witness is over-strict for an open-ended project

`0153:269-271` + `readModelWriters.ts:882`. An open-ended project pushes with `pushed_project_end_date` NULL
(single-FY by construction). Later setting an `end_date` **inside the same fiscal year** makes
`pushed_project_end_date is distinct from proj.end_date` true, attribution for every un-phased line stops, the
budget column blanks and a "stale attribution" banner fires — for a project that is still single-FY and still
the same year. Withheld, never wrong, so it is a NOTE; but it is a self-inflicted blank on a routine edit.
Comparing the *resolved fiscal-year span* rather than the raw dates would keep the fence and lose the false
alarm.

## NOTE 7 — 0154's fence does not cover the table it reads the year from

`0154:69` takes the exclusive advisory lock; `0154:292-296` makes budget **outbox INSERTs** take the shared
half. `budget_version_erp_mirror` is unfenced — and it is the table the preflight (`:99-101`) and the re-key
(`:132-137`) recover the fiscal year from. A concurrent `readModelWriters.budgetWriter` upsert landing between
the preflight loop and the UPDATE changes what `min(m.fiscal_year)` returns, and the row is re-keyed to the
wrong year, pointing PMO at the wrong ERP Budget. Deploy quiescence covers this; the migration's own claim
that the scalar subquery is "total and unambiguous **by construction**" (`:129-131`) overstates the fence.
Say so in the header, or take the mirror rows under the same lock.

Related, and correctly fail-closed: preflight (2) **aborts the whole migration** if any budget mapping has no
mirror row — which is exactly the outbox-orphan state the sweep's own pass 5 exists to handle. That is the
right posture, but it means an orphan present at deploy time blocks the deploy. Worth naming in the runbook.

## NOTE 8 — the "JS twin" has no production consumer

`pmo-portal/src/lib/budget/budgetProjection.ts` `deriveProjectionCell` is imported by nothing outside its own
test. The SQL/JS agreement the fence requires is therefore enforced by two independently-written test suites
and by nothing else — a divergence produces no user-visible symptom. I checked them line by line and they
**do** agree today (attribution-unknown -> variance NULL + utilization NULL; budget-unknown-for-year ->
variance NULL; EAC untouched by both guards). Either wire it or say plainly in its header that it is a spec
oracle, not the read path, so a maintainer does not reason from it.

## NOTE 9 — duplicate DOM id on the fiscal-year datalist

`pmo-portal/pages/ProjectBudget.tsx:241` and `:393` both render `<datalist id="budget-fiscal-year-options">`.
`adding` and `editingId` are independent state, so opening the add row while a line is being edited mounts
both: duplicate id (an `axe-core` `duplicate-id` violation class), and the second input silently binds to the
first list. Hoist one datalist above the table.

## NOTE 10 — a comment overstates the code

`budgetProjection.ts:150-156` says the attribution guard "outranks a stated amount, fail-closed ... refused
rather than silently preferred", but the function still returns `pmoBudgetAmount` unchanged when
`attributionKnown === false`; only the derived figures are nulled. Harmless today (the SQL cannot produce that
pair), but it is the kind of comment a future maintainer will trust instead of the code.

---

## What I attacked and found clean

- **`record_outbox_ref` deriving identity from the locked row — no cross-domain regression.** The only caller
  is `moneyOutboxDeps.ts:225-236`, whose `mapping.pmoRecordId` is `deps.outboxRecordId ?? command.record.id` —
  byte-identical to the value `insertOutboxPending` wrote onto that row (`dispatch.ts:560-570`), and on the
  sweep path literally `row.pmoRecordId` (`erpnext-sweep/index.ts:1859`). `p_domain` is likewise always
  `command.domain`, which is the row's own domain. clickup/`tasks`, timesheets, revenue (SI/PE) and
  procurement (PI/PO) all pass caller values that already equal the locked row's. No caller legitimately
  passes a different identity, so the derivation is a no-op for every domain except the deploy-race window it
  was written for. `encodeExternalRecordId` still runs caller-side on `mapping.domain` and is untouched.
- **`isReplay`, both directions.** TRUE is set at exactly two sites, both genuine replays: the `confirmed`
  branch (`dispatch.ts:476`) and the `committed` finalize (`:482`). FALSE on the fresh-commit finalize
  (`:429-434`). The one candidate for a missed replay — `claimAndCommit`'s `probed` adoption, which performs
  no fresh ERP write yet finalizes with `isReplay=false` — is unreachable for a Desk-cancelled budget: that
  path requires the outbox row to be `pending`/`failed`/`quarantined`, and a cancelled-after-confirm budget's
  row is `confirmed`, which routes to the guarded branch. No non-replay path sets it.
- **`scopeMirrorQuery` coverage.** All five feed-side budget mirror queries go through it
  (`readMirrorSourceMod`, `updateMirror`, `mirrorExists`, `tombstoneMirror`, `stampAmended`). No bare-version
  path left on that side. Conversely, `repointExternalRef` and `recordLineage` correctly use the raw
  year-qualified id (the `external_refs`/lineage grain) and are *not* scoped — that is right, not a miss.
- **Three-valued logic, systematically.** I re-derived every predicate in `0153`: `budget_year.on_record`
  (both operands are `exists`, non-null), `attributed_null` (NULL comparisons exclude, which is the wanted
  direction), the `filter`/`bool_or` pair (`coalesce(...,false)` makes it two-valued), `stale_attribution`
  (`coalesce(...,false)` over a left join), `hold_releasable` (`expected` can never carry a NULL year, since
  `phased` filters `is not null` and `mirror.fiscal_year` is NOT NULL). No further NULL leak. BLOCK 2 is a
  set-logic choice, not a NULL leak.
- **Per-year key guard.** `judgeBudgetPerYearKey` splits at the **last** colon, which is correct for a token
  that itself contains `:` (nibble 15) because the epoch is decimal-only, and it rejects the empty token
  `bud:<uuid>::<epoch>` that the general regex would have waved through. The legacy 3-segment key correctly
  falls through.
- **0154 collisions.** Two old rows cannot merge into one new key: `external_refs` is unique on
  `(org_id, domain, pmo_record_id)`, so a version has at most one bare row; outbox rows keep their distinct
  epochs, so `bud:<vid>:<tok>:<epoch>` stays unique. `SET` expressions read the OLD `pmo_record_id`, so the
  key rebuild is correct. The revert's `regexp_replace('^.*:')` is greedy and correctly yields the epoch.
- **The two new feed tests are real oracles.** `statefulBudgetClient` actually applies `eq` filters to select
  rows and mutates them in place, so removing the `fiscal_year` predicate would fail them. That is the
  standard the sweep tests should be held to.
- **The Draft guard on `fiscal_year`** was mutation-proved (commit `5aadc920`) rather than asserted.

---

## WHAT I COULD NOT VERIFY

- **I ran nothing.** Per the brief I judged the code and did not re-run verify / pgTAP / deno / e2e. Every SQL
  finding above is derived by reading the CTE text; BLOCK 2's figures are computed by hand from `0153:299-319`,
  not observed from a query result.
- **Live ERPNext semantics.** The unowned-live-occupant witness, the claim that a cancel and an amend both
  return 200 on frappe 15.96.0, whether the recovery probe can see a cancelled Budget, and the 18/18 bench
  e2e — all taken on faith. I have no bench.
- **Deploy-time behaviour of 0154.** A genuine two-session old-finalizer race, a concurrent activation during
  the migration, and the mirror-write race in NOTE 7 cannot be proven by pgTAP and I did not simulate them.
- **Whether any environment is already at migration >= 0137.** SHOULD-FIX 4's severity turns entirely on this.
  I read `docs/backlog.md`'s prod-at-~0081 evidence; I did not query a live database, and I did not read any
  `.env` (per the standing rule).
- **Rendered UI.** I read `BudgetProjection.tsx` and `ProjectBudget.tsx` but did not render them. The
  duplicate-datalist and per-year-banner claims are from source, not from a screenshot or an axe run.
- **Coverage.** I did not compute changed-line coverage. I can state that two specific oracles are blind
  (`budgetOutboxOrphan.test.ts`'s filter-less fake; `bfy_attribution_known.test.sql`'s single-line fixture),
  which is a stronger statement than a percentage, but it is not a coverage measurement.

---

## CROSS-FAMILY BLIND SPOT

I share the builders' training, and the concrete way that showed up here is **anchoring on the prose**. This
codebase writes unusually dense, self-justifying comments, and both blocks I found are places where the
comment is confidently right about one thing and silent about the adjacent thing: the sweep hold's "the SAME
eligibility `listPendingBudgetPushes` asserted" is true about `push_state` and says nothing about the year;
`0153:300-306` argues the `coalesce(...,false)` NULL-safety so thoroughly that the `bool_or`-vs-`bool_and`
choice underneath it reads as already settled. I caught these two only by forcing myself to re-derive each
predicate; I cannot claim I did that with equal rigour everywhere, and a reviewer without this house style in
its training would not have had to fight the anchor at all.

Specifically, a different family would more likely catch:
1. **Remaining "the comment says it is scoped" sites.** I checked every `budget_version_erp_mirror` query in
   the repo, but the same class could exist in a table I did not enumerate. A model that greps by *invariant*
   rather than by table name would be more thorough.
2. **The ERPNext-side semantics I accepted.** Whether the recovery probe surfaces a cancelled Budget, and
   whether `amended_from` behaves as the comments assert, are load-bearing for BLOCKER 2's completeness and I
   verified neither.
3. **The vocabulary itself.** I accepted "attribution known" as a per-category fact and only questioned its
   aggregation. A model with different priors would more readily ask whether F-D belongs per *line*, which
   would have made BLOCK 2 obvious from the type signature rather than from a reproduction.
4. **Structure/naming decisions I found self-evidently right** — because they are the decisions I would have
   made. `outboxRecordId` as an optional dep threaded through eight call sites, and `runOneDispatch` as a
   closure re-binding the outer `command`, are both places where I noticed the shape and did not push on it.

Fix BLOCK 1 and BLOCK 2 (each with the test that can actually fail), resolve SHOULD-FIX 3 and 4, and this is
shippable. Re-review should be cross-family if the cap has lifted.
