# Spec: Budget fiscal-year / phasing dimension on `budget_line_items`

> **Status:** DRAFT (round 2) — awaiting owner sign-off. **This round re-roots the design on the
> "name the fact, then test that fact" fence** (round 1 used "a mirror row exists" as a proxy for "PMO
> has a budget on record for this year"; those are different facts, and the shipped refusal writer makes
> the proxy lie — Luna round-2 review `docs/reviews/2026-07-23-luna-fu2-budget-fiscal-year-spec.md`).
> **Issue:** the **OQ-BUD-3 option (c)** follow-up from `docs/specs/erpnext-adapter-p3c-budget.spec.md`
> (owner ruling 2026-07-21). Adds a fiscal-year dimension to PMO budget line items so multi-fiscal-year
> projects are no longer flatly refused at the ERPNext budget push, and — while the line items finally
> carry a year — closes the **FR-BUD-152** tension in `get_budget_projection`.
> **IDs:** `FR-BFY-###` / `NFR-BFY-###` / `AC-BFY-###`. EARS requirements; Given/When/Then acceptance
> criteria; ADR-0010 traceability (one owning test per AC at its lowest sufficient layer).
>
> **Authority / grounds:** the P3c budget spec (`erpnext-adapter-p3c-budget.spec.md` §3 OQ-BUD-3 ruling +
> second ruling on derivation; FR-BUD-124, FR-BUD-152, FR-BUD-153, FR-BUD-110..113), the shipped gate
> `pmo-portal/src/lib/budget/budgetGate.ts` (`resolveFiscalYearOrFailClosed` / `fiscalYearContaining`),
> the shipped **failure writer** `supabase/functions/adapter-dispatch/index.ts`
> (`recordBudgetGateFailure` / `recordBudgetPushFailure` — both write `budget_version_erp_mirror`
> `failed`/`pushed` rows stamped with a fiscal year), the shipped **mirror writer**
> `supabase/functions/adapter-dispatch/readModelWriters.ts` (`budgetWriter` — FK on `canonical.id`,
> year on `canonical.fiscal_year`, writes **no** date witness today), the **generic dispatch seam**
> `pmo-portal/src/lib/adapterSeam/dispatch.ts` (`dispatchMoneyWrite` — keys the outbox on
> `command.record.id`), the **sweep reconcile** `supabase/functions/erpnext-sweep/index.ts`
> (`buildReconcileDepsLive` — reconstructs the frozen payload, calls `dispatchMoneyWrite` directly,
> runs **no** budget gate), the **refs resolver** `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`
> (`resolveBudgetRefs` — adopts any docstatus=1 grain occupant as `refs.self` with no PMO-ownership
> check), the **inbound feed** `supabase/functions/_shared/erpnextFeedDeps.ts`
> (`.eq('budget_version_id', pmoRecordId)`), migration `0149_get_budget_projection.sql` (the
> `budget_year` / `pmo_budget` CTEs + the `-EAC` variance rule + `list_budget_fiscal_years` +
> `get_budget_push_status`), `0137_budget_push_seam.sql` (the `(org_id, budget_version_id, fiscal_year)`
> mirror grain + the **category→account map with `(org_id, category)`/`(org_id, erp_account)` uniqueness
> and NO fiscal-year history** — already shipped forward-compatible), `0005`
> (`get_project_budget` / `clone_budget_version` / `enforce_draft_line_item`), `0139` (`activated_at`
> witness), `0096` + `0134` (outbox uniqueness + one-in-flight), `0088` (`external_refs`), the push key
> `pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts`, the JS oracle
> `pmo-portal/src/lib/budget/budgetProjection.ts` (the `-EAC` twin), the page
> `pmo-portal/pages/BudgetProjection.tsx` + repository `pmo-portal/src/lib/repositories/budgetProjection.ts`
> (single-row status + project-level retry/release), **ADR-0048** (PMO never invents an accounting
> allocation — unchanged and binding), **ADR-0055 §6** (one ERP `Budget` per project × fiscal year),
> **ADR-0059** (Posture B; §8 — a change to the PMO process like this gets its own spec), **ADR-0011**
> (budget lifecycle writes via security-definer RPC), **ADR-0016** (RLS is the enforcement authority),
> **ADR-0010** (test pyramid), `docs/decisions.md` OD-BUDGET-1..5, and the defect-class catalog
> `docs/reviews/2026-07-23-p3bc-audit-program.md` (§2 #6 "a fake handed a state the shipped writers never
> produce"; #11 "a fixture giving every row its own `snapshot_id` — a state production cannot produce,
> hiding a defect that DOUBLED a client's actuals").
>
> **This spec edits no other file.** It does not modify the P3c spec, no ADR, no migration, no code.
> Migration numbers are **`≥ 0151`** (`ls supabase/migrations | tail -1` = `0150_replace_erp_snapshot.sql`
> at spec time — **re-verify at build**).

---

## 0. Job story

> **When a finance lead's project runs across two of the client's fiscal years,** the budget they approved
> in PMO **must reach ERPNext as one Budget per fiscal year** so each year's native overspend controls
> enforce the right figure — **without PMO inventing a split it has no basis to make** — and PMO's own
> per-year budget figure **must stay visible even when the push is refused or ERP is down**, so the team is
> never blind to a year of their own approved plan; **while every project that has not bothered to phase its
> lines keeps working byte-for-byte as it does the day this ships**, and **no derived figure (variance,
> utilization) is ever printed against a year whose budget attribution is unknown**.

---

## 1. Overview and user value

Today every line on a budget version is year-agnostic, so the push gate (`budgetGate.ts`) can only resolve
**one** fiscal year for a version (the year containing the project's `start_date`, from the client's own
`Fiscal Year` doctype) and **refuses any project spanning more than one** (`budget-multi-fiscal-year`,
FR-BUD-124). That refusal is honest — PMO has no basis to pro-rate a split (ADR-0048) — but it leaves a
finance lead whose project genuinely spans two years with **no route to an enforced ERP budget at all**.

This issue gives each line item an **optional** fiscal year. A line whose year is set is **phased** to that
year; a line whose year is unset (NULL) is **un-phased**. NULL is the default and every existing row keeps
it, so nothing about today's system changes on day one (F8). With that dimension present:

- A **single-FY** project's NULL lines unambiguously belong to that one year → push unchanged.
- A **multi-FY** project whose lines the user **has phased** → push fans out to **one ERP `Budget` per
  phased fiscal year** (ADR-0055 §6), each with its own accounts/amounts/overspend controls.
- A **multi-FY** project with **any** NULL line → **still fails closed** (PMO holds no basis to attribute
  it), but the refusal now names the actionable fix ("phase these lines") instead of a dead end.
- `get_budget_projection`'s read path is rewired to PMO's **own** line-item fact for phased years, so a
  phased year's budget is no longer suppressed by external push health (closes FR-BUD-152). **Crucially,
  the rewire does not relax the money-honesty invariant to make a figure appear, and it does not stop
  there:** every derived column — variance, utilization — is recomputed from the budget amount, and
  `0149`'s existing rule emits `-EAC` ("entirely unbudgeted") whenever a year is on record but a category
  has no line. A line whose budget attribution is *unknown* (a refused push, a stale mirror year) must
  therefore never print a confident `-EAC`; this round carries an explicit **`attribution_known`** fact
  through the RPC **and** its JS twin and NULLs every derived value when it is false (finding 2).

User value: the finance lead's multi-year project finally gets ERP enforcement per year; the team can see
each year's budget vs actuals regardless of push health; nobody who has not adopted phasing notices
anything changed; and no screen ever states a variance about a year whose budget it does not actually know.

### 1.1 The fence this round is built on (the round-1 root cause, stated once)

Round 1 used **"a mirror row exists"** as a proxy for **"PMO has a budget on record for this year."** Those
are different facts. `budget_version_erp_mirror` records push **ATTEMPTS** — `pushed`, `failed`, `held` —
not successes. The shipped refusal writer (`adapter-dispatch/index.ts:539-552`,
`recordBudgetGateFailure`) writes a `failed` mirror row stamped with the **start** fiscal year
(`err.fiscalYear`, populated on exactly the multi-FY and unmapped-category rejections — confirmed by the
Director against `budgetGate.ts`). So a project that was **refused** for being multi-FY still produces a
mirror row for FY1, and round-1's `exists(mirror row)` predicate was TRUE for a year PMO explicitly refused
to allocate. That single conflation was findings **1, 2, 6 and 9** of the round-2 review.

**The fence, applied everywhere in this spec:** every predicate that consults the mirror says **which of
these four facts** it means, and tests **exactly that** —

| Tag | Fact | Test |
|---|---|---|
| **F-A** | a push **SUCCEEDED** for this year | a mirror row with `push_state = 'pushed'` |
| **F-B** | an **attempt** was made for this year | any mirror row (`pushed` / `failed` / `held`) |
| **F-C** | PMO's **own line items** name this year | an Active line with `fiscal_year = <year>` |
| **F-D** | the attribution is **KNOWN** (per category-year) | the new `attribution_known` fact (§6.2) |

**Bare existence (F-B) is never the right test for a money attribution.** §14 lists every mirror-consulting
predicate in this spec with the specific fact it now tests; if any still reads bare existence, §14 says why.

---

## 2. Scope

### In scope
- A nullable `fiscal_year text` column on `budget_line_items` (NULL = un-phased; default NULL; F1).
- The **push gate** reworked from "resolve one year or refuse" to "produce a per-year push plan": fan out
  one ERP `Budget` per phased fiscal year; refuse multi-FY projects that still have NULL lines (F2, F4).
- A **typed budget command** carrying a **bare `budget_version_id`** (UUID — for the gate query, the mirror
  FK, and the feed lookup) **plus a separate server-derived year-qualified outbox identity**
  (`<vid>:<canonically-encoded-fy>`) and a **server-derived per-year idempotency key**
  (`bud:<vid>:<encoded-fy>:<epoch>`). The client stops minting the key; the server fans out. The year
  component is canonically encoded and validated at the served boundary (F4, finding 3).
- The **projection rewired** (`budget_year`, `pmo_budget` + the new `attribution_known` fact,
  `list_budget_fiscal_years`) so `on_record` is **F-C ∨ F-A** (never F-B), NULL lines attribute **only via
  F-A + a matching span witness**, and every derived value is NULL when `attribution_known` is false
  (FR-BFY-054/055). `get_budget_push_status` reports **per year** and the repository/page/retry/release
  consume a **per-year** array with a validated fiscal-year argument (F6, finding 6).
- The **gate returns the project's date span**; the dispatch carries it; the mirror writer stamps a
  `date`-typed push-time span witness on every mirror outcome (FR-BFY-080 — finding 9).
- The **sweep's budget recovery re-runs the shared server-side gate** for the specific year and HOLDS
  (does not POST) a frozen year/body the foreground gate would now reject (FR-BFY-075 — finding 5).
- **`resolveBudgetRefs` refuses a live (docstatus=1) grain occupant PMO does not own** (no `external_refs`
  mapping for that year) with a named `budget-unowned-live-occupant` state; draft rivals stay zero-write
  (FR-BFY-076 — finding 7).
- The **migration** quiesces budget dispatch/sweep (or a DB fence honored by old+new code), preflights
  malformed/orphaned/already-year-qualified rows, and states reversibility honestly (single-FY reversible;
  a multi-FY fan-out is not reversible to one bare key — FR-BFY-035/039, finding 4).
- The three re-created RPCs are **acceptance-bound** to `SECURITY INVOKER`, `search_path = public, pg_temp`,
  authenticated-only ACL, and cross-org reads return nothing (pgTAP on `prosecdef`/`proconfig`/ACL/cross-org
  — FR-BFY-090, finding 10).
- `clone_budget_version` copies `fiscal_year` onto cloned lines (F7).
- A per-line **fiscal-year write affordance** in the budget UI (Draft versions only, OD-BUDGET-3 roles).
- One migration; RLS + `org_id` seam intact (F9).

### Non-goals (named, not silently skipped)
- **Monthly / quarterly phasing within a fiscal year** (ERPNext `Monthly Distribution`, P3c FR-BUD-180) —
  out of scope. A line is attributed to **one whole fiscal year**, not split across months. A cost that
  genuinely straddles two years is expressed as **two line items** (one per year), not as a fractional
  split. (See §3 — why not a phasing table.)
- **Per-line cross-year splitting** ("60% to FY2026, 40% to FY2027" on one line) — out of scope; that is an
  authored allocation and is the domain of FR-BUD-180, not this issue.
- **Changing OD-BUDGET-1** (the Active version is still Σ its line items, now optionally year-filtered).
- **Changing the category→account bijection** (FR-BUD-110..113), the `pmo_etc` projection inputs, the
  overspend-control defaults, or the never-adopt / never-fight-the-operator inbound rules.
- **Backfilling `fiscal_year` on existing rows.** Every existing row stays NULL by design (F8). This is the
  same deliberate-not-backfilled posture as `0139`'s `activated_at`: a fabricated year is a false claim
  about the world on a money figure.
- **Effective-dated / per-fiscal-year history on `budget_category_account_map`** (finding 8). The map today
  has `(org_id, category)`/`(org_id, erp_account)` uniqueness and **no** fiscal-year dimension
  (`0137:90-91`), and `0149`'s `actuals` CTE joins the **current** map — so an Admin edit (Labor: account A
  → account B) **silently re-interprets PRIOR years' actuals**: a historical snapshot row at account A no
  longer joins "Labor", and at least that year's actual cost disappears from the projection. This is a
  **pre-existing** defect (it ships in 0149 today, single-FY), and this issue **does not create it** — but
  multi-FY phasing makes it **materially worse** (one map edit now re-interprets N years, not 1). The full
  fix (effective-dated map, or snapshotting the category mapping with the actuals at read time) is a
  **separate, larger rework of the category-account-map subsystem** and is **out of scope** for a
  budget-line-item phasing issue. **The consequence is named, not silent:** until that follow-up lands, an
  Admin map edit after actuals exist silently changes prior years' actuals on the projection, and the
  projection **cannot detect it** without map history. This issue's in-scope contribution is (a) to
  **not** coalesce a category's actuals to zero when its map row is absent (re-assert C-1, with a
  multi-year mutation AC), and (b) to add a **documenting regression sentinel** (AC-BFY-029) so the defect
  is visible and the follow-up (OQ-BFY-5) is tracked, never silent. Tracked as OQ-BFY-5.

---

## 3. The decided shape — and why not a phasing table

**The shape is a single nullable column** (`budget_line_items.fiscal_year text`, NULL = un-phased). This
expresses the requirement this issue actually has: *each line belongs to at most one fiscal year*. A line
that must cover two years is two lines.

A separate phasing table (`line_id × fiscal_year × fraction`) would express a richer requirement this issue
**does not have** and explicitly defers: a single line *fractionally* split across years. That is an
authored accounting allocation and belongs with `Monthly Distribution` (FR-BUD-180). Building it now would
(a) re-introduce exactly the "PMO invents a split" surface ADR-0048 forbids, only moved into a sub-table,
and (b) couple a budget UI rework to a schema this issue does not need. **The nullable column is
sufficient.** If a future issue needs per-line splitting, it can add the table then without disturbing this
column (a phased line has `fiscal_year` set and no split row; the two coexist).

`fiscal_year` is **`text`, not an enum and not a FK.** Values stored are **ERPNext `Fiscal Year` NAMES** —
the same Link-by-name values `budgetGate.ts` resolves from the client's `Fiscal Year` doctype (e.g.
`"2025-2026"` for a Jul–Jun client). A PMO-side enum cannot enumerate another system's calendar, and a FK
cannot reference a table that lives in ERPNext, not Postgres. Validation is therefore **push-time, against
the live doctype** (F3), not schema-time.

---

## 4. Schema / migration shape (F9)

**One migration** (`supabase/migrations/0151_budget_line_item_fiscal_year.sql` — number re-verify at
build). It is reversible by `supabase db reset` (pre-prod) or, manually, `alter table … drop column` +
restoring the re-created functions + reverting single-FY identity rows (see §4 step §6 / NFR-BFY-REV-001
for the **honest** reversibility boundary).

```sql
-- §1 the dimension (F1)
alter table public.budget_line_items add column if not exists fiscal_year text;
comment on column public.budget_line_items.fiscal_year is
  'ERPNext Fiscal Year NAME this line is phased to; NULL = un-phased (belongs to the project''s single '
  'fiscal year if the project is single-FY, else to NO year). Validated at PUSH time against the client''s '
  'Fiscal Year doctype (budgetGate.ts), never here. Copied by clone_budget_version.';
-- No default, no NOT NULL, no CHECK, no FK, no new index on the table's RLS. (A read-path index
-- (budget_version_id, fiscal_year) MAY be added for projection hot paths — perf note, not a correctness
-- requirement; the sum is per Active version, already bounded by version id.)

-- §2 clone preserves phasing (F7) — re-create clone_budget_version from 0005 with `fiscal_year` in the
--    INSERT list (verbatim otherwise; the security-definer authz + search_path + anon-revoke unchanged).

-- §3 rewire the projection (F6) — DROP + re-create get_budget_projection, list_budget_fiscal_years,
--    get_budget_push_status (0149 bodies, modified per §6 below: on_record = F-C ∨ F-A; pmo_budget gains
--    attribution_known; variance/utilization NULL when attribution_known is false; list_fiscal_years
--    is_active_push == on_record; push_status returns per-year rows).

-- §4 the projection's stale-year guard (FR-BFY-053 / FR-BFY-080). budget_version_erp_mirror gains TWO
--    nullable push-time span witnesses — pushed_project_start_date / pushed_project_end_date — typed
--    DATE (NOT timestamptz: projects.start_date/end_date are `date`, 0001:80-81, and an implicit
--    timestamptz↔date compare is a silent-TZ-bug waiting to happen). They are stamped from the project's
--    dates exactly as the gate read them, on EVERY mirror outcome (pushed AND failed — FR-BFY-080),
--    carried from the gate result through a NON-body command field (FR-BFY-080). get_budget_projection's
--    NULL-via-mirror branch (§6.2) attributes ONLY while the project's CURRENT start_date/end_date match
--    the witness; on drift, NULL lines are attributed to NO year and get_budget_push_status states the
--    actionable reason. Existing mirror rows (pre-this-issue pushes) carry a NULL witness ⇒ backward-compat
--    attribution (FR-BFY-070) with the residual risk named (bench + demo); a span is never invented to
--    fill a NULL witness.

-- §5 re-key the budget domain's identity (FR-BFY-035/036). See §5.1 for the typed-command design. The
--    re-key moves external_refs.pmo_record_id and external_command_outbox.pmo_record_id +
--    idempotency_key from the bare <vid> / `bud:<vid>:<epochMs>` form (0088/0096/0134;
--    budgetPushKey.ts) to the year-qualified form, recovering <fiscal_year> from the mirror (0137).
--    The mirror's budget_version_id FK is UNCHANGED (stays the bare <vid>); only the OUTBOX/external_refs
--    identity becomes year-qualified. QUIESCE + PREFLIGHT required (§4 step §5a/5b) — finding 4.

-- §6 reversibility (NFR-BFY-REV-001, honestly bounded): drop the column + the two witness columns,
--    restore the four functions, and revert identity rows. A single-FY row (one year-qualified
--    external_refs/outbox row per version) reverts 1:1 to the bare key. A multi-FY fan-out (two
--    year-qualified rows <vid>:<fy1>, <vid>:<fy2>) CANNOT collapse to one bare key without losing a
--    year's ERP pointer — so rollback FAILS CLOSED if any multi-FY version exists (names it), rather than
--    silently dropping a year. Full reversibility is guaranteed ONLY for the pre-issue (all-single-FY)
--    population; once a multi-FY push has happened, the identity is year-qualified for good and the
--    rollback is refused. This is a NAMED, accepted irreversibility — the feature's own capability —
--    never a silent loss.

-- No RLS migration. budget_line_items already has force-RLS + select/write policies (0002/0004); a new
-- nullable column is covered by the existing `for all` / `for select` policies. No domain_externally_owned
-- row, no flip (Posture B, FR-BUD-006 — unchanged). The two additive nullable mirror witness columns
-- (§4) inherit the mirror's existing machine-only force-RLS (0101 idiom) — no new policy.
```

**`org_id` seam intact:** the new column carries no org dimension; `stamp_org_id()` (0074) and the
`org_id` default are untouched.

### 4.5 Migration safety — quiescence, fence, preflight, reversibility (finding 4)

Round 1 described the re-key updates with **no quiescence, no fence, no preflight, and a rollback claim
that could not represent two years.** All four are now binding:

- **Quiescence / DB fence (FR-BFY-035a).** Budget dispatch AND the sweep are **drained/disabled** while
  the migration runs (a deploy-time quiescence the release-engineer performs), OR the migration acquires
  a `pg_advisory_xact_lock` that BOTH old and new code check on the budget write path (the old code path
  is amended in the SAME release so the fence is honored on both sides). Rationale: a budget request
  in flight between gate/ERP-commit and outbox-finalization under OLD code can still insert a bare
  `pmo_record_id` AFTER the rewrite; new code then resolves only `<vid>:<fy>`, sees no mapping, and the
  served create-guard (`checkCreateTargetUnmapped`) PASSES a duplicate create. The fence makes that
  unreachable.
- **Preflight (FR-BFY-035b).** Before any rewrite, the migration ASSERTS, in one transaction, and FAILS
  CLOSED (RAISE, naming the offender) on: (i) a budget-domain `external_refs`/outbox row whose
  `pmo_record_id` is already year-qualified (a partial prior run); (ii) a bare `pmo_record_id` whose
  version has **>1** mirror fiscal_year (not reachable for any P3c push — single-FY-only — but a hard
  guard, not an assumption); (iii) a bare `pmo_record_id` with **no** mirror row at all (cannot recover
  the year); (iv) an outbox `idempotency_key` not parseable as `bud:<vid>:<epochMs>` (the old shape). The
  whole migration is one transaction; a named conflict aborts it wholesale, leaving the DB unchanged.
- **Reversibility (NFR-BFY-REV-001, amended above).** Single-FY rows revert 1:1. A multi-FY fan-out does
  not — rollback refuses (fail-closed) and names the multi-FY versions. This is honest: the feature's
  whole point is the multi-FY capability; once exercised, two ERP pointers cannot collapse to one.

**Blast radius (stated honestly):** ERPNext is dark outside the local bench, so the real population is the
bench + demo data (no seeded budget `external_refs`/outbox rows); the requirements stand regardless.

---

## 5. The push gate: from "one year or refuse" to a per-year plan (F2, F4)

`runBudgetGate` (`pmo-portal/src/lib/budget/budgetGate.ts`) today resolves **one** fiscal year and throws
`budget-multi-fiscal-year` on any span. It is reworked (order of fail-closed checks unchanged; a new step
inserted after the span is known):

1. Re-read version (Active + `activated_at`) — unchanged (FR-BUD-100).
2. Re-read project; cross-org check — unchanged (FR-BUD-014).
3. Resolve the project's **span** from the client's `Fiscal Year` doctype:
   `startFY = fiscalYearContaining(start_date)`, `endFY = fiscalYearContaining(end_date)` (or `== startFY`
   when `end_date` is null). Refuse `budget-fiscal-year-unresolved` / `…-ambiguous` exactly as today.
4. Read the line items **with their `fiscal_year`**.
5. **Validate every non-NULL `fiscal_year`** against the client's calendar (F3): a value naming no `Fiscal
   Year` in `readFiscalYears()` ⇒ throw `budget-fiscal-year-invalid`, naming the line and the bad year.
6. **Build the push plan** — the set `{fiscal_year → lines}`:
   - **Single-FY project** (`startFY == endFY`): one plan entry for `startFY` containing **all** the
     version's lines (NULL or phased). A line phased to a year ≠ `startFY` ⇒ throw
     `budget-fiscal-year-out-of-span`.
   - **Multi-FY project** (`startFY != endFY`): one plan entry **per distinct phased `fiscal_year`**. **Any
     NULL line ⇒ throw `budget-multi-fiscal-year-unphased` naming those lines** ("phase these lines" — F2).
     A line phased outside `[startFY, endFY]` ⇒ `budget-fiscal-year-out-of-span`.
7. Resolve the category→account map over the plan's union of categories; unmapped ⇒
   `budget-category-unmapped` (FR-BUD-113, unchanged).
8. **Return the plan AND the project's date span** (FR-BFY-080, finding 9):
   `[{ fiscal_year, line_items, accounts }]` PLUS `projectStartDate` / `projectEndDate` — the `date`
   values re-read in step 2, exactly as the gate saw them. The span is the push-time witness source;
   without it returned, the mirror writer cannot stamp the witness and FR-BFY-053's drift detection can
   never fire (round-1 finding 9: the witness stayed NULL forever and the backward-compat exemption
   applied permanently).

The gate stays **pure orchestration over injected readers** (unit-testable with no live client);
`readLineItems` now returns `fiscal_year` too, and the result type widens to carry the project span. The
activation itself still succeeds regardless of any push outcome (FR-BUD-008 — the push is a consequence;
unchanged).

### 5.1 The typed budget command, the year-qualified outbox identity, and the server-derived key (F4, finding 3)

Round 1 said "put `<vid>:<fy>` in `record.id`." That **does not work**, and the review proved it on four
load-bearing seams:

- `pmo-portal/src/lib/db/budgets.ts:255-269` dispatches `id = versionId`; the served boundary
  (`adapter-dispatch/index.ts:783`) does `String(command.record.id)` as the gate's `versionId` — a
  `v:FY2026` there is a **non-UUID**, the `budget_versions.id =` query returns nothing, and **every push
  fails "version not readable."**
- `supabase/functions/adapter-dispatch/readModelWriters.ts:838` writes `budget_version_id: canonical.id`
  as the mirror FK — `v:FY2026` is a **non-UUID against a `uuid` FK** ⇒ FK violation.
- `pmo-portal/src/lib/adapterSeam/dispatch.ts:538` keys the outbox on `command.record.id`; making it
  year-qualified there is the *intent*, but it collides with the two seams above that need the **bare**
  UUID.
- `supabase/functions/_shared/erpnextFeedDeps.ts:79` does `.eq('budget_version_id', pmoRecordId)` where
  `pmoRecordId` comes from `external_refs` — a year-qualified value is a **non-UUID against a `uuid`
  column** ⇒ a Desk cancel errors or matches nothing instead of tombstoning the right row.
- The served key guard `isOpaqueIdempotencyKey` (`transitionTargetGuard.ts:190`,
  `/^[a-z]{1,8}:<uuid>:[0-9TZ:.+-]{4,40}$/`) accepts the OLD `bud:<uuid>:<epoch>` but a year bearing
  letters/spaces (`FY2026`, `FY 2026`) **fails the charset**; a year bearing `:` **breaks the structure**.

**The design (binding).** The budget domain gets a **typed command** that carries **both** identities
separately, and the year is **canonically encoded**:

- `command.record.id` **stays the bare `budget_version_id` (UUID)** — used unchanged by the gate query,
  the mirror FK, and the feed lookup. **Round 1's "put the year in `record.id`" is rejected.**
- A new, separate **`outbox_identity`** (text) = `<budget_version_id>:<canonically_encoded_fiscal_year>`
  is carried on the budget command and threaded into `external_command_outbox.pmo_record_id` and
  `external_refs.pmo_record_id`. Encoding is **canonical and round-trippable** (URL-safe base32 of the
  UTF-8 name, or documented percent-encoding — picked at build; the property that matters is: any ERPNext
  `Fiscal Year` name, including ones containing `:`, spaces, or letters, encodes to a token with none of
  those, and decodes back to the exact name). A `budgetVersionIdOf(outbox_identity)` parser recovers the
  bare `<vid>`; the inbound feed uses it before its `.eq('budget_version_id', …)` lookup (FR-BFY-038).
- The **idempotency key** = `bud:<budget_version_id>:<encoded_fy>:<activated_at_epoch_ms>`, derived
  **server-side** from the gate's plan (the client cannot know the years — the calendar is a live ERP API
  call only the gate can make). `dispatchBudgetPush(versionId)` becomes a single call the server fans out
  (a contract change from today's client-minted key — OQ-BFY-3).
- The **generic dispatcher** (`dispatchMoneyWrite`, `dispatch.ts:525`) gains an **optional
  `outboxRecordId`** param that **defaults to `command.record.id`** for every non-budget domain (zero
  change to them). The budget path passes `outbox_identity`. `readOutbox`/`insertOutboxPending` use
  `outboxRecordId ?? command.record.id`.
- The **served boundary key guard** is extended (or a budget-specific validation branch is added) to
  accept the year-bearing budget key shape AND to validate the encoded year decodes to a non-empty token;
  an unparseable/short/collision-prone key is rejected fast (`commit-rejected`), never reaching the
  outbox. The final server-derived key is validated at the served boundary, not trusted from the payload.
- The **mirror writer** (`readModelWriters.budgetWriter`) is **unchanged on the FK** (`budget_version_id =
  canonical.id`, bare UUID) and unchanged on the year (`fiscal_year = canonical.fiscal_year`); it gains
  the **witness stamp** from `canonical.project_start_date`/`canonical.project_end_date` (FR-BFY-080). The
  **`external_refs` writer** uses `outbox_identity` (year-qualified).

**Why both originators land on the same string.** Foreground (`dispatchBudgetPush`) and sweep
(`buildReconcileDepsLive`) both derive `outbox_identity` + key **server-side** from the same DB truth
(version id + gate-resolved year + `activated_at`), so the outbox `unique`/one-in-flight/key-single-use
(0096/0134) and `external_refs unique` (0088) all scope **per year** naturally — two years can be in-flight
concurrently without colliding, each maps to one ERP `Budget.name`, and a retry of year 2 (year 1
terminal) is allowed, not a duplicate.

**Partial failure:** if year 1 confirms and year 2 fails, year 1's ERP `Budget` exists and is enforcing;
year 2 is `failed` + `action-required`; the activation still succeeded. A retry re-drives **year 2 only**.
Both `recordBudgetGateFailure` and `recordBudgetPushFailure` write their mirror row at the per-year grain
(stamped with the **specific** failing year, not the start FY — see FR-BFY-033), so a partial failure
leaves one `pushed` and one `failed` row, never a single misleading row.

**Consumer list updated together (binding — finding 3):** foreground dispatch (`budgets.ts`), the generic
seam (`dispatch.ts dispatchMoneyWrite`), the served boundary (`adapter-dispatch/index.ts`: key guard, gate
wiring, fan-out, outbox insert), the mirror writer (`readModelWriters.ts`: witness only), the
`external_refs` writer, the sweep reconcile (`erpnext-sweep/index.ts buildReconcileDepsLive`) **and** the
budget backstop (`budgetBackstop.ts`), the inbound feed (`erpnextFeedDeps.ts` + the parser), the
create-guard (`transitionTargetGuard.checkCreateTargetUnmapped` resolves the year-qualified key), and
authorization. Each is enumerated in §8 and bound by an AC.

---

## 6. Closing FR-BUD-152 — rewire the projection to PMO's own fact, with the attribution fence (F6)

`0149_get_budget_projection.sql` today uses `budget_version_erp_mirror.fiscal_year` as the **only**
in-database authority for "does PMO have a budget for `p_fiscal_year`". The consequence (FR-BUD-152): a
refused push leaves **no mirror row**, so PMO's **own** budget figure is suppressed on a year with real GL
actuals. Once line items carry a fiscal year, PMO has its own in-database answer. **But the rewire must not
repeat round 1's mistake** (using bare mirror existence as the attribution proxy): the mirror records
ATTEMPTS, and the shipped refusal writer produces a `failed` row. So this section re-derives every
mirror-consulting predicate against the §1.1 fence.

### 6.1 `budget_year.on_record` (the scope flag) — F-C ∨ F-A, NEVER F-B
```sql
-- PMO has a budget ON RECORD for p_fiscal_year ⇔ PMO's OWN line items name this year (F-C)
-- OR a push actually SUCCEEDED for this year (F-A: a 'pushed' mirror row). NOT a bare mirror
-- existence (F-B: 'failed'/'held' are ATTEMPTS, not a budget on record — round-1 finding 1).
select coalesce(p_fiscal_year,'') <> ''
   and (
     exists (select 1 from budget_versions v join budget_line_items li on li.budget_version_id = v.id
             where v.project_id = p_project_id and v.status = 'Active'
               and li.fiscal_year = p_fiscal_year)                                   -- F-C: PMO's own phased line
     or exists (select 1 from budget_version_erp_mirror em
                join budget_versions v on v.id = em.budget_version_id
                where v.project_id = p_project_id and v.status = 'Active'
                  and em.fiscal_year = p_fiscal_year
                  and em.push_state = 'pushed')                                      -- F-A: a push that SUCCEEDED
   ) as on_record
```
**Why F-B is excluded.** A `failed`/`held` row means PMO *tried* and ERP does **not** hold a budget for
that year. Counting it as "on record" made round-1 finding 1: a refused multi-FY push wrote a `failed`
FY1 row, `on_record` went true, and the un-phased NULL lines were attributed to a year PMO had explicitly
refused. Excluding F-B means a year with *only* a failed/held row (no phased line, no `pushed` row) has
`on_record = false` ⇒ its actuals are still stated, its budget is honestly "unavailable," and **no false
`-EAC`** is printed (§6.2).

### 6.2 `pmo_budget` (the Σ to display) — year-scoped, with the `attribution_known` fact (finding 2)
```sql
-- The NULL-line backward-compat attribution gate: NULL lines attribute to p_fiscal_year ONLY via a
-- push that SUCCEEDED for this year (F-A) AND whose push-time span witness still matches the project's
-- CURRENT dates (FR-BFY-053). NOT on_record, NOT F-B — a failed/held row never attributes NULL lines.
attributed_null as (
  select 1
    from budget_version_erp_mirror em
    join budget_versions vv on vv.id = em.budget_version_id
    join projects proj on proj.id = vv.project_id
   where vv.project_id = p_project_id and vv.status = 'Active'
     and em.fiscal_year = p_fiscal_year
     and em.push_state = 'pushed'                                              -- F-A (NOT F-B)
     and ( em.pushed_project_start_date is null                                -- NULL witness ⇒ backward-compat
           or (em.pushed_project_start_date is not distinct from proj.start_date -- present witness ⇒ must match
               and em.pushed_project_end_date   is not distinct from proj.end_date) --   CURRENT dates (FR-BFY-053)
         )
),
pmo_budget as (
  select li.category,
         sum(li.budgeted_amount)
           filter (where li.fiscal_year = p_fiscal_year                                  -- phased ⇒ always attributed (F-C)
                        or (li.fiscal_year is null and exists (select 1 from attributed_null)))
                                                                                         -- NULL ⇒ only via F-A + witness
           as pmo_budget_amount,
         -- attribution_known (F-D): TRUE iff this category has ≥1 line honestly attributed to
         -- p_fiscal_year; FALSE iff its only lines are NULL and their attribution was SUPPRESSED
         -- (push not 'pushed', or witness drifted) and there is no phased line to state instead.
         -- A category with NO line on the Active version does not appear here (coalesced to TRUE
         -- downstream — the genuine 'no line in a known year' ⇒ -EAC case).
         bool_or(li.fiscal_year = p_fiscal_year
                 or (li.fiscal_year is null and exists (select 1 from attributed_null))) as attribution_known
    from budget_versions v
    join budget_line_items li on li.budget_version_id = v.id
   where v.project_id = p_project_id and v.status = 'Active'
     and (select by.on_record from budget_year by)
   group by li.category
)
```
**The variance / utilization rule (finding 2 — the money-honesty invariant one level deeper):**
```sql
case when c.actuals_to_date is null then null                                    -- C-2: actuals unobtainable
     when coalesce(c.attribution_known, true) = false then null                  -- F-D false: budget attribution
                                                                                   --   SUPPRESSED ⇒ say nothing (NOT -EAC)
     when c.pmo_budget_amount is null and not (select by.on_record from budget_year by) then null -- year not on record
     when c.pmo_budget_amount is null then -(c.actuals_to_date + c.pmo_etc)       -- genuine 'no line in a known year' ⇒ -EAC
     else c.pmo_budget_amount - (c.actuals_to_date + c.pmo_etc) end as projected_variance,
case when c.actuals_to_date is null then null
     when coalesce(c.attribution_known, true) = false then null                  -- F-D false ⇒ no utilization claim
     else (c.actuals_to_date + c.pmo_etc) / nullif(c.pmo_budget_amount, 0) end as projected_utilization
-- projected_final_cost (EAC = actuals + etc) is UNAFFECTED — it never depends on the budget.
```
**Why this is the fence, applied one level deeper.** Round 1 suppressed the budget **amount** after drift
but left `on_record` true (the mirror exists), so `0149`'s `-EAC` branch fired and the screen said
"**$40,000 entirely unbudgeted**" when the honest fact was "**attribution unknown after drift**." The
`attribution_known` fact distinguishes the two NULL-budget states — *suppressed* (⇒ NULL) vs. *genuinely
no line in a known year* (⇒ `-EAC`) — and NULLs every value derived from the budget when it is false. EAC
is untouched (it does not depend on the budget). The JS twin (`budgetProjection.ts`) gains an
`attributionKnown` input (per category, default `true`) and mirrors the identical branch ordering
(FR-BFY-055); the repository continues to read the RPC's final derived columns.

**Why NULL lines still go via the mirror (not relaxed):** a NULL line has no year of its own; the only
in-database record of "which year the gate resolved for this project" is a **successful** push act
(F-A). For a **single-FY** project that pushed, F-A records its one year and NULL lines honestly belong
there. For a **multi-FY** project, the gate refuses any NULL line, so a multi-FY project that pushed has
**no** NULL lines — the NULL branch is a 0-row no-op for it. The **staleness guard (FR-BFY-053):**
"single-FY at push" is a fact about the project's dates *as they were at push time*; a project whose
`end_date` is later extended into a second fiscal year turns F-A's witness STALE — and `attributed_null`
goes false, so the NULL lines contribute to **no** year and `attribution_known` is false for any category
whose only lines they were. A mirror row with a NULL witness (a push that pre-dates this issue) cannot be
drift-checked, so it attributes per backward-compat (FR-BFY-070) and the residual risk is named (bench +
demo). The `reading` / `mapped` / `actuals` / `etc` CTEs and the `current_snapshot` generation scoping
(HIGH-1) are **untouched**; the money inputs `actuals_to_date` and `pmo_etc` are unaffected.

### 6.3 What stops being suppressed vs. what correctly remains unstated
- **STOPS being suppressed (the F6 win):** a phased year's `pmo_budget_amount` is stated from PMO's own
  line items **regardless of push health** — a multi-FY project whose lines are phased but whose push was
  refused (unmapped category / unresolved year / ERP unreachable / never-pushed / `held` / `failed`)
  shows each phased year's budget (F-C stands on its own).
- **CORRECTLY remains unstated (invariant held):** (a) a year with **no phased line and no `pushed` mirror
  row** → `pmo_budget_amount` NULL (PMO has no fact for it — never `0`); a year with only a `failed`/`held`
  row counts as "not on record" for budget (its actuals are still stated); (b) **NULL lines on a multi-FY
  project** → excluded from every year (F2); (c) a year with actuals but no budget line at all → budget
  NULL, actuals stated (today's C-1 behavior, unchanged); (d) **NULL lines on a project whose dates
  drifted past its push-time span** → attributed to NO year (`attributed_null` false ⇒ `attribution_known`
  false ⇒ `pmo_budget_amount` NULL and variance/utilization NULL, never `-EAC`), and the surface states
  the actionable reason. **No figure is manufactured, and no confident derived figure is printed against
  an unknown attribution.**

### 6.4 `list_budget_fiscal_years` — stays byte-consistent (F6)
Its `is_active_push` is rewired to the **same predicate** as `budget_year.on_record` (0149's comment
demands they be one question — F-C ∨ F-A), and `observed` gains **phased line-item years** and **all
mirror years** (a failed push is legitimately inspectable, so `observed` keeps F-B; only the *flag*
excludes it):
```sql
observed_fy  = mirror_fy(all versions) ∪ actuals_fy ∪ etc_fy ∪ distinct li.fiscal_year (non-null, any version)
is_active_push = EXISTS(phased Active line for fy) OR EXISTS('pushed' Active mirror row for fy)   -- == budget_year.on_record
```
(The column name `is_active_push` becomes a mild misnomer — it now means "Active version has a budget on
record for this year". The build may rename to `is_active_budget` or keep the name with the comment; either
is fine as long as the predicate matches `budget_year` exactly.)

### 6.5 `get_budget_push_status` — per year, and its consumers (F4/F6, finding 6)
Today it does `limit 1` on the mirror, and the repository (`budgetProjection.ts:144-160`) takes `data[0]`
while the page (`BudgetProjection.tsx:155-160, 259-287`) reads a single `BudgetPushStatusRow` and offers
**project-level** retry/release. Round 1 said "return per-year rows" but did **not** change those
consumers — so a partial failure (year 1 `pushed`, year 2 `failed`) would commonly select the `pushed` row
(ordering by `pushed_at desc`) and **hide the failed year**, or omit it entirely if the process died before
writing year 2's mirror. This round binds the whole chain:

- **`get_budget_push_status`** returns **one row per expected (Active × fiscal_year)**, where the expected
  year set is **derived from the Active version's phased lines ∪ the gate-resolved plan ∪ mirror rows**,
  **LEFT-JOINed** to the mirror so an absent year is an explicit `never-pushed` row (not a silent omit).
  Each row carries its own `push_state` / `push_error` / `unmapped_categories` / `erp_budget_name` /
  `fiscal_year` / `pushed_at` / `hold_releasable` / and a `stale_attribution` flag (the §6.2 drift result,
  so the surface can name it). The `unrecorded` inference is preserved for a version with no mirror rows
  AND no phased lines at all.
- **The repository** returns an **array** (`BudgetPushStatusRow[]`); an aggregate scalar may be derived
  additionally but the per-year array is the contract.
- **The page** renders per-year status (every expected year is a row; a failed year is never hidden by
  `limit 1`), and **retry/release take a validated fiscal-year argument** — `retryBudgetPush(versionId,
  fiscalYear)` / `releaseBudgetPushHold(versionId, fiscalYear)` — so the operator acts on the specific
  year. (Shape decision: OQ-BFY-2.)

---

## 7. Functional requirements (EARS)

### The dimension (F1, F8, F9)
- **FR-BFY-001 (ubiquitous)** — `budget_line_items` shall carry a nullable `fiscal_year text` column;
  NULL shall be the default; every row that exists at migration time shall remain NULL; and the column
  shall introduce no new RLS policy, no `NOT NULL`, no `CHECK`, and no flip (`domain_externally_owned`).
- **FR-BFY-002 (ubiquitous)** — NULL `fiscal_year` shall mean **un-phased**: the line is attributed to no
  specific fiscal year by PMO. (Whether it belongs to a year is resolved by the gate for the push, and by
  F-A + the span witness for the projection — never invented.)

### SoD / no-invented-allocation (F2)
- **FR-BFY-010 (event-driven)** — When the project spans more than one fiscal year **and** the Active
  version contains **any** line item whose `fiscal_year` is NULL, the push shall be rejected **before any
  ERP call** (`commit-rejected` / `budget-multi-fiscal-year-unphased`), the side mirror shall record
  `push_state='failed'` naming those NULL lines **at the start fiscal year's grain** (the shipped writer
  behavior), and an `action-required` surface shall name the actionable fix ("phase these lines"). The
  system **shall never** pro-rate, split, or default an un-phased line across years (ADR-0048). **The
  projection shall NOT attribute those NULL lines to the start year via that `failed` row** (§6.2: NULL
  attribution requires F-A `pushed`, never F-B).
- **FR-BFY-011 (state-driven)** — While the project occupies exactly one fiscal year, the push shall
  accept all of the Active version's line items (NULL **and** phased) as belonging to that one year and
  shall target that one year.

### The year is the client's own (F3)
- **FR-BFY-020 (ubiquitous)** — Values stored in `fiscal_year` shall be ERPNext `Fiscal Year` **names**
  (the Link-by-name values `budgetGate.ts` resolves from the client's `Fiscal Year` doctype). The system
  shall never store a calendar year, never mint a PMO-side year, and never store a value the client did not
  declare.
- **FR-BFY-021 (event-driven)** — When the push runs, the gate shall validate every non-NULL `fiscal_year`
  against the client's live `Fiscal Year` doctype (via `readFiscalYears()`), and a value naming **no**
  Fiscal Year shall fail closed (`budget-fiscal-year-invalid`, naming the line and the value) — never a
  default, never a silent omission. A line phased to a valid year outside `[startFY, endFY]` shall fail
  closed (`budget-fiscal-year-out-of-span`) (OQ-BFY-1).
- **FR-BFY-022 (state-driven)** — While a `fiscal_year` is being written (create/update line item), the
  system shall accept any text or NULL (it cannot reach the client's calendar from the write path). A
  stored value shall never be silently changed; a value that **later** becomes unresolvable (the client
  renamed/deleted the Fiscal Year) shall fail closed at the **next push** (FR-BFY-021), with the stored
  value left intact for the user to correct.

### Multi-FY push fan-out + identity (F4, finding 3)
- **FR-BFY-030 (event-driven)** — When the project spans more than one fiscal year **and** every line item
  on the Active version is phased, the push shall create **one ERP `Budget` per distinct phased fiscal
  year**, each carrying that year's mapped accounts/amounts and the configured overspend controls, and the
  side mirror shall carry one row per year.
- **FR-BFY-031 (ubiquitous)** — The push idempotency key shall be `bud:<budget_version_id>:<encoded_fiscal_year>:<activated_at_epoch_ms>`,
  derived **server-side** from the gate's plan, so that the foreground and sweep originators derive the
  identical per-year string and two different years never collide. The encoded fiscal year shall be
  canonical and round-trippable for **any** ERPNext `Fiscal Year` name (including names containing `:`,
  spaces, or letters), and the final server-derived key shall be validated at the served boundary.
- **FR-BFY-032 (ubiquitous)** — Each year's outbox command shall carry a **year-qualified outbox identity**
  (`<budget_version_id>:<encoded_fiscal_year>`) as its `external_command_outbox.pmo_record_id` and
  `external_refs.pmo_record_id`, while `command.record.id` shall remain the **bare** `budget_version_id`
  (UUID) for the gate query, the mirror FK, and the feed lookup. The outbox uniqueness (0096), the
  one-in-flight index (0134), the key-single-use index (0134), and `external_refs` (0088) shall all scope
  **per fiscal year**.
- **FR-BFY-033 (event-driven)** — When one year's push confirms and another year's fails, the confirmed
  year's ERP `Budget` shall exist and enforce; the failed year shall be `failed` + `action-required`
  **at that year's grain** (the failure writers stamp the **specific** failing year, never silently the
  start year); the activation shall have succeeded regardless; and the surface shall state the per-year ERP
  consequence.
- **FR-BFY-034 (event-driven)** — When a failed year is retried (operator or sweep), the retry shall derive
  the same per-year identity + key and **reconcile** to the existing result; it shall **not** re-push a
  confirmed year and shall **not** create a duplicate ERP `Budget` for any year.
- **FR-BFY-035 (event-driven — identity-key continuity + migration safety, finding 4)** — When this
  issue's migration changes the budget-domain outbox/`external_refs` identity from the bare
  `<budget_version_id>` to the year-qualified form (FR-BFY-032), the migration SHALL (a) **quiesce**
  budget dispatch and sweep OR acquire a DB fence honored by both old and new code (FR-BFY-035a); (b)
  **preflight** and FAIL CLOSED (RAISE, naming the offender) on any already-year-qualified row, any bare
  row whose version has >1 mirror fiscal_year, any bare row with no mirror row, or any outbox key not
  parseable as the old `bud:<vid>:<epochMs>` shape (FR-BFY-035b); (c) **deterministically re-key** every
  budget-domain `external_refs` and `external_command_outbox` row from the bare `pmo_record_id` to the
  year-qualified form, recovering `<fiscal_year>` from the `budget_version_erp_mirror` row (0137) — a
  migration of an EXISTING mapping's identity from data PMO holds, NOT an invention (distinct from §2's
  no-backfill posture). **The fence (binding):** after the migration, a re-activation of an already-pushed
  budget SHALL resolve to its EXISTING `external_refs` mapping under the new key, so the served create-guard
  (`transitionTargetGuard.checkCreateTargetUnmapped`) BLOCKS a duplicate `create` and PMO never loses its
  pointer to the existing ERP `Budget`. **Reversibility is honestly bounded (NFR-BFY-REV-001):** single-FY
  rows revert 1:1; a multi-FY fan-out (two year-qualified rows) CANNOT collapse to one bare key, so
  rollback FAILS CLOSED if any multi-FY version exists rather than silently dropping a year. **Blast radius
  (stated honestly):** ERPNext is dark outside the local bench today, so the real population is the bench +
  demo data; the requirement stands regardless.
- **FR-BFY-036 (ubiquitous, finding 3)** — The budget domain shall use a **typed command** carrying both
  the bare `budget_version_id` (UUID, = `record.id`) AND the separate year-qualified `outbox_identity`
  (text). The generic dispatcher's outbox record-id seam shall default to `record.id` for every non-budget
  domain (zero change) and accept `outbox_identity` for the budget domain. The foreground dispatch, the
  served boundary, the sweep reconcile, the sweep backstop, the mirror writer, the `external_refs` writer,
  the create-guard, the inbound feed, and authorization shall all be updated together.
- **FR-BFY-038 (event-driven, finding 3)** — When the inbound feed resolves a budget `external_refs` row
  to a year-qualified `pmo_record_id`, it shall **parse the bare `budget_version_id`** out
  (`budgetVersionIdOf(outbox_identity)`) before any `.eq('budget_version_id', …)` lookup, so a Desk cancel
  for a year-qualified record tombstones the correct mirror row (it shall not error or match nothing). The
  parser shall round-trip every canonical encoding.
- **FR-BFY-075 (event-driven, finding 5)** — When the sweep's budget recovery (the outbox reconcile path
  via `buildReconcileDepsLive` OR the orphan backstop via `driveBudgetPush`) drives a budget push, it shall
  re-run the **shared server-side budget gate** (`runBudgetGate`, or a replay-equivalent that re-reads the
  same truth) **for the specific year**, re-reading the current ERP `Fiscal Year` calendar, the project's
  current span, the current line items, and the current category map. A frozen year/body the foreground
  gate would now reject (the project no longer occupies that year, the calendar changed, a line became
  unmapped) shall be **HELD** with a named `budget-sweep-gate-held` state and surfaced — **never POSTed**.
  The orphan path shall select the **specific** mirror/plan year and persist enough per-year plan data to
  recover an outbox orphan without guessing, while retaining replay actor authorization.

### Closing FR-BUD-152 + the attribution fence (F6)
- **FR-BFY-050 (ubiquitous)** — `get_budget_projection`'s `budget_year.on_record` shall be **F-C ∨ F-A**
  (a phased Active line for the year OR a `pushed` Active mirror row for the year) — **never F-B** (a
  `failed`/`held` row is an attempt, not a budget on record). `pmo_budget_amount` for a phased year shall
  derive from PMO's own line items (F-C) regardless of push health. NULL lines shall attribute to a year
  **only via F-A (`pushed`) and a matching push-time span witness** — never via on_record, never via F-B.
- **FR-BFY-051 (ubiquitous)** — `list_budget_fiscal_years` shall offer phased line-item years (and all
  mirror years, including failed) in `observed`, and its `is_active_push` shall be **byte-for-byte the same
  predicate** as `budget_year.on_record` (F-C ∨ F-A).
- **FR-BFY-052 (ubiquitous — the invariant, re-asserted one level deeper)** — The money-honesty invariant
  shall be **unchanged**: a money figure may be stated only when its inputs are known. A year with no
  phased line and no `pushed` mirror row ⇒ `pmo_budget_amount` NULL (never `0`); NULL lines on a multi-FY
  project ⇒ excluded from every year; NULL lines on a project whose attribution is suppressed (refused
  push, or stale witness) ⇒ excluded AND their category's derived values NULL. **No figure shall be
  manufactured to make a number appear, and no confident derived figure (variance, utilization) shall be
  printed against an attribution that is unknown.**
- **FR-BFY-053 (state-driven — stale mirror year ⇒ fail closed)** — While the Active version's NULL
  (un-phased) line items are being attributed to a fiscal year via the mirror (§6.2), the projection SHALL
  attribute them ONLY while the project's CURRENT fiscal-year span matches the span the mirror recorded at
  push time (the `pushed_project_*_date` witness). When the project's current span has DRIFTED beyond the
  mirror's recorded year, the projection SHALL STOP attributing the NULL lines to the stale recorded year,
  the NULL lines shall contribute to NO year's `pmo_budget_amount`, the affected category's
  `attribution_known` shall be **false**, and `get_budget_push_status` SHALL carry the actionable reason
  ("phase these lines" — the budget's fiscal-year attribution is stale after a project-date change). The
  system SHALL NOT manufacture a split (ADR-0048). **Mechanism / residual risk:** the projection RPC cannot
  reach the client's `Fiscal Year` doctype (0149's premise), so the mirror carries the push-time span
  witness stamped from the project's dates exactly as the gate read them (FR-BFY-080). Mirror rows from
  pushes that pre-date this issue carry a NULL witness ⇒ backward-compat (FR-BFY-070); the residual risk
  is the bench + demo population. A span is never invented to fill a NULL witness.
- **FR-BFY-054 (ubiquitous, finding 2)** — The projection RPC's `pmo_budget` CTE shall expose, per
  category-year, an explicit **`attribution_known`** fact (F-D): true iff the category has a line honestly
  attributed to the year (phased, or NULL via F-A + witness); false iff the category's only lines are NULL
  and their attribution was suppressed (push not `pushed`, or witness drifted).
- **FR-BFY-055 (ubiquitous, finding 2)** — Every figure **derived** from the budget amount
  (`projected_variance`, `projected_utilization`) shall be **NULL** when `attribution_known` is false. The
  `-EAC` signal shall fire ONLY for a genuine "no line in a known year" (a known year, this category has
  no line at all) — never for a suppressed/unknown attribution. `projected_final_cost` (EAC = actuals +
  etc) is unaffected (it does not depend on the budget). The JS oracle (`budgetProjection.ts`) shall carry
  an `attributionKnown` input (per category, default `true`) and mirror the identical branch ordering.
- **FR-BFY-056 (event-driven, finding 6)** — `get_budget_push_status` shall return **one row per expected
  (Active × fiscal_year)**, where the expected set is derived from the Active phased lines ∪ the
  gate-resolved plan ∪ mirror rows, LEFT-JOINed to the mirror so an absent expected year is an explicit
  `never-pushed` row (never a silent omit). Each row shall carry its own `push_state` / `push_error` /
  `unmapped_categories` / `erp_budget_name` / `fiscal_year` / `pushed_at` / `hold_releasable` /
  `stale_attribution`. The repository shall return an **array**; the page shall render every expected year;
  retry/release shall take a **validated fiscal-year** argument.

### Never fight the operator (finding 7)
- **FR-BFY-076 (event-driven)** — Before the adapter amends a live (docstatus=1) ERP `Budget` on the
  (company, fiscal_year, project) grain as the upsert target (`refs.self`), it SHALL verify PMO **owns**
  that document: a PMO `external_refs` mapping SHALL exist for this domain × the year-qualified
  `pmo_record_id` (i.e., PMO created it, or has a recorded creation witness). A live grain occupant with
  **no** PMO mapping SHALL NOT be amended; the push SHALL fail closed with a named
  `budget-unowned-live-occupant` state and an operator-actionable message naming the document and the year.
  Draft rivals (docstatus=0) SHALL remain zero-write (refused with `budget-draft-rival-on-grain`,
  unchanged) — an unowned live occupant is the symmetric refusal for the submitted case.

### Writes + the span witness (F7, finding 9)
- **FR-BFY-060 (event-driven)** — When an OD-BUDGET-3 user creates or updates a line item, the system
  shall accept an optional `fiscal_year`, governed by the existing `budget_line_items_write` RLS policy
  (org + 4-role) and the existing `enforce_draft_line_item` trigger.
- **FR-BFY-061 (state-driven)** — While the owning version's status is not `Draft`, any write to a line
  item's `fiscal_year` shall be rejected by `enforce_draft_line_item` (`P0001`); re-phasing an Active
  version shall require clone → edit → activate (OD-BUDGET-5).
- **FR-BFY-062 (event-driven)** — When `clone_budget_version` copies a version's line items, it shall copy
  `fiscal_year` onto each cloned line (no silent loss of phasing on a revision).
- **FR-BFY-080 (ubiquitous, finding 9)** — The gate result SHALL carry the project's `start_date` /
  `end_date` (re-read in step 2, `date`-typed). The dispatch SHALL carry them through a **non-body**
  command field (they are not ERP `Budget` fields). The mirror writer SHALL stamp
  `pushed_project_start_date` / `pushed_project_end_date` (`date`, NOT timestamptz — matching
  `projects.start_date`/`end_date`) on **every** mirror outcome (`pushed` and `failed`) from those values.
  A successful push SHALL NEVER leave the witness NULL. (FR-BFY-053's drift detection depends on this; a
  NULL witness on a `pushed` row is a defect, not a backward-compat case.)

### RPC security modes (finding 10)
- **FR-BFY-090 (ubiquitous)** — The three re-created RPCs (`get_budget_projection`, `list_budget_fiscal_years`,
  `get_budget_push_status`) shall be `SECURITY INVOKER` with `set search_path = public, pg_temp`,
  `grant execute … to authenticated`, and `revoke … from public/anon`. A cross-org call (an authenticated
  member of org A passing org B's project UUID) shall return no rows / all-NULL (RLS on the source tables is
  the org boundary). `clone_budget_version` and `activate_budget_version` shall retain their existing
  security-definer authorization assertions (ADR-0011).

### Existing consumers (F5)
- **FR-BFY-040 (ubiquitous)** — Every shipped consumer that sums `budget_line_items.budgeted_amount` of the
  Active version **without** a fiscal-year filter — `get_project_budget` (0005), the dashboard margin /
  at-risk / top-projects / delivery RPCs (0009/0027/0032/0033/0044/0141/0145), and the procurement
  decision-support budget layer (transitive via `get_project_budget`) — shall remain **byte-for-byte
  unchanged**, because a nullable column does not alter `sum(li.budgeted_amount)`. (Full verdict table §8.)

### Backward compatibility (F8)
- **FR-BFY-070 (ubiquitous)** — Where every line item on a version has `fiscal_year IS NULL` (every
  existing project and seeded org on day one), the system shall behave byte-for-byte identically to the
  pre-this-issue system across `get_project_budget`, `get_budget_projection`, `list_budget_fiscal_years`,
  `get_budget_push_status`, the dashboard/at-risk/delivery RPCs, and the ERP push (single-FY → one Budget).
  For such a version that pushed, F-A is satisfied and (where the witness is NULL) the backward-compat
  attribution applies; where the witness is present and matches, the identical attribution applies.
- **FR-BFY-071 (event-driven)** — When an all-NULL version is cloned, the clone's lines shall be all-NULL.

---

## 8. Consumer enumeration — every existing consumer of `budget_line_items` + the budget push chain (F5, finding 3)

Produced by `grep -rn "budget_line_items\|budget_version_erp_mirror\|dispatchBudgetPush\|record.id\|pmo_record_id" supabase/migrations pmo-portal/src pmo-portal/pages pmo-portal/hooks pmo-portal/components supabase/functions`. Every match is listed; none was guessed.

| Consumer | Where | Reads `fiscal_year` / identity? | Verdict |
|---|---|---|---|
| `get_project_budget(p_project_id)` | `0005` (the Σ-Active RPC, OD-BUDGET-1) | **No** — sums `budgeted_amount` over the Active version with no year filter | **Unchanged.** A nullable column does not change `sum(li.budgeted_amount)`. |
| Dashboard margin `pipeline.active_budget` | `0009` → superseded by `0033` | No | **Unchanged.** |
| At-risk budget `active_committed.budget` + `projects_at_risk` | `0033` | No | **Unchanged.** |
| `top_projects.budget` | `0032` → `0033` | No | **Unchanged.** |
| Dashboard status helpers (3 Σ reads) | `0044` | No | **Unchanged.** |
| `get_projects_delivery(.budget)` | `0033` → `0141` → **`0145`** | No | **Unchanged.** |
| `get_budget_projection` `budget_year` / `pmo_budget` CTEs | **`0149`** | **Yes (after)** | **Changed — §6.** `on_record` = F-C ∨ F-A; `pmo_budget` year-scoped + `attribution_known`; variance/utilization NULL when attribution_known false. |
| `list_budget_fiscal_years` | `0149` | Yes (after) | **Changed — §6.4.** Adds phased-line years; `is_active_push` = on_record. |
| `get_budget_push_status` | `0149` | Yes (after) | **Changed — §6.5.** Returns per-year rows, expected-set LEFT-JOIN. |
| `clone_budget_version` | `0005` | **Yes (after)** | **Changed — FR-BFY-062.** INSERT list gains `fiscal_year`. |
| `enforce_draft_line_item` trigger | `0005` | No | **Unchanged.** Covers `fiscal_year` automatically. |
| RLS `budget_line_items_select` / `_write` | `0002` + force `0004` | No | **Unchanged.** |
| `stamp_org_id()` / grants | `0074` / `0075` | No | **Unchanged.** |
| Procurement "reserved budget" layer | `DecisionSupportPanel` → `get_project_budget` | No (transitive) | **Unchanged.** *(Brief's "0015" is a comment-only ref; the real consumer is `get_project_budget`.)* |
| `listBudgetVersions`/`createLineItem`/`updateLineItem`/`deleteLineItem` | `src/lib/db/budgets.ts` | **Yes (after)** | **Changed.** CRUD carries `fiscal_year`. |
| `activateVersion` / `retryBudgetPush` / `dispatchBudgetPush` | `src/lib/db/budgets.ts:190-269` | **Yes (after)** | **Changed — FR-BFY-032/056.** `dispatchBudgetPush(versionId)` → server fans out; retry takes a **fiscal-year** arg; `record.id` stays bare UUID. |
| `useBudget` hook + `NewLineItem` type | `src/hooks/useBudget.ts` | After (type) | **Changed (type only).** |
| Budget page UI | `pages/ProjectBudget.tsx` | **Yes (after)** | **Changed.** Per-line FY affordance (Draft only). |
| Projection JS oracle | `src/lib/budget/budgetProjection.ts` | **Yes (after)** | **Changed — FR-BFY-055.** Gains `attributionKnown`; variance/utilization NULL when false. |
| Push gate | `src/lib/budget/budgetGate.ts` | **Yes (after)** | **Changed — §5.** Per-year plan; result carries project span (FR-BFY-080). |
| `BudgetLineItem` type | `src/lib/budget/categoryAccountMap.ts` | After (type) | **Changed (type only).** |
| `budgetToBody` | `src/lib/adapterSeam/erpnext/bodies/budget.ts` | **Yes (after)** | **Changed.** One body per fiscal year. |
| `readBudgetLineItems` (paged) | `src/lib/adapterSeam/erpnext/dispatchFactory.ts` | **Yes (after)** | **Changed.** Reads `fiscal_year`. |
| `resolveBudgetRefs` | `src/lib/adapterSeam/erpnext/dispatchFactory.ts:614-757` | identity (grain) | **Changed — FR-BFY-076.** Refuses an unowned live occupant. |
| `commitCreate` upsert-on-grain | `src/lib/adapterSeam/erpnext/adapter.ts:93-116` | n/a | **Changed (guarded by FR-BFY-076 upstream).** |
| `budgetPushKey` | `src/lib/adapterSeam/erpnext/budgetPushKey.ts` | **Yes (after)** | **Changed — §5.1.** Key gains encoded year; derived server-side. |
| Generic dispatch seam `dispatchMoneyWrite` | `src/lib/adapterSeam/dispatch.ts:525-565` | **Yes (after)** | **Changed — FR-BFY-036.** Optional `outboxRecordId` (defaults to `record.id`). |
| Served boundary: gate wiring / fan-out / failure writers / key guard | `supabase/functions/adapter-dispatch/index.ts:533-552, 722-745, 774-800, 955-991` | **Yes (after)** | **Changed — §5/§5.1.** Fan-out per year; failure writers stamp the **specific** year; key guard accepts the year-bearing budget key. |
| Mirror writer `budgetWriter` | `supabase/functions/adapter-dispatch/readModelWriters.ts:821-857` | identity (FK) | **Changed — FR-BFY-080.** FK stays bare UUID; stamps the `date` witness. |
| `external_refs` writer | `supabase/functions/adapter-dispatch/*` | **Yes (after)** | **Changed — FR-BFY-032.** `pmo_record_id` = year-qualified identity. |
| create-guard `checkCreateTargetUnmapped` | `supabase/functions/adapter-dispatch/transitionTargetGuard.ts` | **Yes (after)** | **Changed.** Resolves the year-qualified key. |
| Sweep reconcile `buildReconcileDepsLive` | `supabase/functions/erpnext-sweep/index.ts:1642-1696` | **Yes (after)** | **Changed — FR-BFY-075.** Re-runs the shared gate for the specific year; derives year-qualified identity. |
| Sweep backstop `driveBudgetPush` / `listPendingBudgetPushes` | `supabase/functions/erpnext-sweep/budgetBackstop.ts` | **Yes (after)** | **Changed — FR-BFY-075.** Selects the specific year; gate-gated. |
| Inbound feed `erpnextFeedDeps` (budget) | `supabase/functions/_shared/erpnextFeedDeps.ts:72-104` | **Yes (after)** | **Changed — FR-BFY-038.** Parses bare vid out of the year-qualified identity before the FK lookup. |
| Projection repository `fetchBudgetProjection` / `fetchBudgetPushStatus` | `src/lib/repositories/budgetProjection.ts:120-160` | **Yes (after)** | **Changed — FR-BFY-056.** Status returns an array. |
| Projection page | `pages/BudgetProjection.tsx:150-287` | **Yes (after)** | **Changed — FR-BFY-056.** Per-year status; FY-arg retry/release. |

**A consumer not named here is a consumer not checked** — this table is exhaustive against the grep.

---

## 9. Non-functional requirements

- **NFR-BFY-SEC-001** — RLS is the enforcement authority (ADR-0016); the new column adds no policy and no
  flip; `org_id` seam intact; cross-org read/write of `fiscal_year` stays denied by the existing policies.
  The three re-created RPCs stay `SECURITY INVOKER` + `search_path=public,pg_temp` + authenticated-only,
  proven by pgTAP on `prosecdef`/`proconfig`/ACL/cross-org (FR-BFY-090).
- **NFR-BFY-MONEY-001** — Money discipline unchanged: every budget amount is a decimal-string end-to-end;
  the projection's year-scoped sum is SQL `numeric`; no monetary value passes through JS float math. The
  money-honesty invariant (0149 header) is **re-asserted one level deeper** (FR-BFY-052/054/055): an unknown
  attribution NULLs every derived figure, never prints `-EAC`.
- **NFR-BFY-IDEM-001** — The per-year deterministic key + year-qualified `outbox_identity` shall make a
  duplicate ERP `Budget` impossible under retry / 429 / two-originator race / partial-failure retry /
  lease-expiry, proven at the real served boundary (the `after-commit-before-mirror` fault seam) AND through
  the sweep reconcile path (which must derive the identical identity server-side).
- **NFR-BFY-REV-001 (honestly bounded)** — One migration; `alter table … drop column fiscal_year`, `alter
  table budget_version_erp_mirror … drop column pushed_project_start_date/pushed_project_end_date`,
  restoring the re-created functions, and reverting identity rows. **Single-FY rows revert 1:1 to the bare
  key (recoverable from the mirror). A multi-FY fan-out CANNOT revert to one bare key** — rollback FAILS
  CLOSED (names the multi-FY versions) rather than silently dropping a year. Full reversibility is
  guaranteed ONLY for the pre-issue (all-single-FY) population; once a multi-FY push has happened the
  identity is year-qualified for good. RLS + `org_id` intact.
- **NFR-BFY-TEST-001** — Each AC has exactly one owning test at its lowest sufficient layer; every push e2e
  uses the real served `adapter-dispatch` boundary + the named server-side fault seams — never `page.route`
  (NFR-BUD-TEST-001). **No AC hand-seeds a state the shipped writers cannot produce** (finding 11 / p3bc
  audit-program §2 #6/#11): ACs that need a mirror row obtain it from the REAL failure/push writer; ACs
  that need a witness obtain it from a REAL push; ACs that need a status row obtain it from the REAL RPC.

---

## 10. Acceptance criteria (Given/When/Then) + traceability

> Layer key: **[pgTAP]** DB contract / RPC / RLS / constraints · **[Vitest]** pure logic (gate, projection
> oracle) · **[e2e]** cross-stack ERP journeys · **[served]** a Deno test against the real
> `adapter-dispatch` boundary (no `page.route`). Each AC asserts the **user's goal**, not the mechanism.
> Each AC states, in one line, **what it is structurally unable to see** (finding 11). pgTAP/served/e2e ACs
> hit the REAL DB / writer / served boundary (no fakes → not p3bc shapes #3/#6/#8/#9/#10/#11); e2e ACs
> assert ERP **state**, not the request body (#5 avoided); every AC carries a mutation check (#7 avoided);
> fixtures obtain mirror/witness/status state from the REAL writers, never hand-seeded (#2/#6 avoided).

### Backward compatibility (F8)
- **AC-BFY-001** — An un-phased budget behaves exactly as before. **[pgTAP]**
  **Given** a project with an Active version whose line items are all `fiscal_year IS NULL`, and a `pushed`
  mirror row for its one fiscal year,
  **When** `get_project_budget`, `get_budget_projection(p, that year)`, `list_budget_fiscal_years`, and
  `get_budget_push_status` are called,
  **Then** the budget total, the projection cells, the year list, and the push status are **identical** to
  the pre-this-issue system (F-A satisfied ⇒ the whole un-phased budget attributed to its one year).
  *(Mutation: if `pmo_budget` stopped attributing NULL lines via F-A+witness, this goes red.)* (FR-BFY-070, 050)
  *Structurally unable to see: the live ERP state — owned by e2e AC-BFY-011.*
- **AC-BFY-002** — The shipped budget + projection suites stay green for all-NULL data. **[cross-layer regression]**
  **Given** the column + rewired functions are installed, **When** the shipped budget pgTAP suite
  (`0008`–`0012`, `0060`, `0075`) and the projection RPC tests (`budget_projection_rpc.test.sql`) run
  unchanged, **Then** every previously-passing test still passes. (FR-BFY-070) *(Meta-AC.)*

### The dimension + clone (F1, F7)
- **AC-BFY-003** — The column is nullable; clone preserves phasing. **[pgTAP]**
  **Given** a Draft version with a phased line (`fiscal_year='2025-2026'`) and a NULL line, **When** it is
  cloned, **Then** the clone's phased line carries `fiscal_year='2025-2026'`, its NULL line carries NULL,
  and a brand-new line can be inserted with no `fiscal_year`. *(Mutation: if `clone_budget_version`
  omitted `fiscal_year` from the INSERT list, the clone's phased line would be NULL → red.)* (FR-BFY-001, 062, 071)
  *Structurally unable to see: the UI affordance — owned by an e2e/write AC.*

### The gate (F2, F3)
- **AC-BFY-004** — A single-FY project with NULL lines still pushes one year. **[Vitest]** (FR-BFY-011)
- **AC-BFY-005** — A multi-FY project with any NULL line fails closed, naming them. **[Vitest]** (FR-BFY-010)
- **AC-BFY-006** — A multi-FY project with all lines phased produces a per-year plan. **[Vitest]** (FR-BFY-030)
- **AC-BFY-007** — A line phased to a year that names no Fiscal Year fails closed. **[Vitest]** (FR-BFY-021)
- **AC-BFY-008** — A line phased to a valid year outside the project's span fails closed. **[Vitest]** (FR-BFY-021, OQ-BFY-1)
  *AC-004..008 structurally unable to see: the served-boundary fan-out + the failure writer — owned by AC-BFY-009/011.*

### Fan-out, identity, partial failure, migration, sweep (F4, finding 3/4/5/11)
- **AC-BFY-009** — The typed budget command threads the year-qualified identity + per-year key end-to-end;
  the REAL served boundary accepts it. **[served]**
  **Given** a two-year phased plan, **When** `dispatchBudgetPush(versionId)` is driven through the real
  `adapter-dispatch` boundary (the client no longer mints the key), **Then** the gate runs per year, the
  outbox rows carry `pmo_record_id = <vid>:<encoded-fy>` and `idempotency_key = bud:<vid>:<encoded-fy>:<epoch>`,
  the mirror rows carry the **bare** `budget_version_id` FK + the correct year, and a colon-bearing FY name
  (e.g. `'A:B 2026'`) round-trips without a key-guard rejection or a collision. *(Mutation: if `record.id`
  carried the year, the gate's `budget_versions.id =` query returns nothing → "version not readable" → red;
  if the FK carried the year, the mirror insert violates the uuid FK → red.)* (FR-BFY-030, 031, 032, 036)
  *Structurally unable to see: the live ERP Budget creation — owned by AC-BFY-011.*
- **AC-BFY-010** — Year-qualified identity lets two years be in-flight concurrently AND a served replay
  reconciles to the existing `external_refs` (no duplicate). **[pgTAP + served]**
  **Given** the outbox uniqueness (0096) + one-in-flight (0134) + key-single-use (0134) + `external_refs`
  (0088), **When** two budget outbox rows are inserted concurrently for `<vid>:<fy1>` and `<vid>:<fy2>`,
  AND a served replay for `<vid>:<fy1>` runs after `external_refs` already maps it, **Then** both concurrent
  rows are accepted, the replay BLOCKS a duplicate create (the mapping resolves non-NULL), and removing the
  cross-record `external_command_outbox_key_single_use` index makes the duplicate-rejection assertion go red.
  *(Mutation: if `pmo_record_id` were not year-qualified, the second violates one-in-flight → red; if the
  replay re-created instead of reconciling, the `external_refs`-resolves-non-NULL assertion → red.)* (FR-BFY-032, 034)
  *Structurally unable to see: the live ERP state — owned by AC-BFY-011/012.*
- **AC-BFY-011** — A multi-FY activation creates one ERP `Budget` per phased year. **[e2e]** (FR-BFY-030)
  *(No `page.route`; asserts ERP STATE.)*
- **AC-BFY-012** — Partial failure leaves year 1 enforcing and year 2 actionable; retrying year 2 is not a
  duplicate, and the status surface shows BOTH years. **[e2e]** (FR-BFY-033, 034, 056)
- **AC-BFY-018** — The identity re-key migration runs in place under fence; a post-migration re-activation
  does not become a duplicate. **[pgTAP]**
  **Given** a budget-domain `external_refs` + outbox row under the OLD bare `pmo_record_id = <vid>` with a
  mirror row recording `<fy>`, **When** the migration runs (under fence), **Then** the `external_refs` row's
  `pmo_record_id` is `<vid>:<encoded-fy>` **re-keyed in place** (bare `<vid>` resolves NULL; `<vid>:<fy>`
  resolves the SAME `external_record_id`), the outbox row carries the year component, and a subsequent
  `create` for `<vid>:<fy>` is BLOCKED by the mapped-record guard. *(Mutation: if re-key were a NEW INSERT
  leaving the orphan, or skipped, the guard PASSES a duplicate → red.)* (FR-BFY-035)
  *Structurally unable to see: live ERP one-vs-two Budgets — owned by AC-BFY-011/012.*
- **AC-BFY-020** — The migration preflight FAILS CLOSED on unrecoverable rows. **[pgTAP]**
  **Given** (a) a bare `external_refs` row whose version has >1 mirror FY, (b) a bare row with no mirror,
  (c) an already-year-qualified row, (d) an outbox key not parseable as `bud:<vid>:<epochMs>`,
  **When** the migration runs, **Then** it RAISES naming the offender and leaves the DB unchanged.
  *(Mutation: if the preflight were absent, case (a) would pick one FY and orphan the other → red.)* (FR-BFY-035b)
  *Structurally unable to see: the quiescence fence enforcement at deploy — owned by the release runbook.*
- **AC-BFY-021** — Reversibility is honestly bounded. **[pgTAP]**
  **Given** (a) a single-FY year-qualified row and (b) a multi-FY fan-out (two year-qualified rows),
  **When** rollback runs, **Then** the single-FY row reverts 1:1 to bare `<vid>`, and rollback for the
  multi-FY version FAILS CLOSED naming it (it does not silently drop a year). *(Mutation: if rollback
  collapsed two rows to one bare key, the second year's `external_refs` pointer is lost → red.)* (NFR-BFY-REV-001)
  *Structurally unable to see: live ERP pointer survival — named irreversibility, not a test gap.*
- **AC-BFY-022** — The sweep re-runs the shared budget gate for the specific year; a now-untenable frozen
  year/body is HELD, not POSTed. **[served]**
  **Given** a pending budget outbox row for `<vid>:<fy1>` whose project's `end_date` was LATER extended so
  the project no longer occupies fy1, **When** the sweep reconcile drives it, **Then** the sweep re-reads
  the current calendar + span + lines + map, finds the foreground gate would now reject, and HOLDS the row
  with `budget-sweep-gate-held` (no ERP POST). *(Mutation: if the sweep POSTed the frozen body unchanged,
  ERP gains a Budget for a year the project no longer occupies → red via the served ERP-state assertion.)*
  (FR-BFY-075)
  *Structurally unable to see: the orphan-backstop year-selection — owned by an adjacent served AC that
  creates a mirror row with no outbox row and asserts the specific year is selected.*

### Closing FR-BUD-152 + the attribution fence (F6, finding 1/2/11)
- **AC-BFY-013** — A phased year's budget shows despite a refused push — seeded via the REAL failure
  writer (not "no mirror row"). **[pgTAP]**
  **Given** a multi-FY project whose Active version has lines phased to FY2026, **and** a refused push
  obtained by driving the REAL served boundary (so `recordBudgetGateFailure` writes a `failed` mirror row
  for FY2026 — the state production actually produces), **and** a second variant where no push was ever
  dispatched (no mirror row),
  **When** `get_budget_projection(p, 'FY2026')` is called for both,
  **Then** in both variants the FY2026 phased lines' `pmo_budget_amount` is stated from PMO's own line
  items (F-C), non-NULL, and `on_record` is true **via F-C** (not via the `failed` row).
  *(Mutation: if `on_record` used bare mirror existence, the never-attempted variant would go red; if the
  phased amount depended on push health, the refused variant would be NULL → red.)* (FR-BFY-050)
  *Structurally unable to see: the live ERP state — owned by AC-BFY-011.*
- **AC-BFY-014** — NULL lines on a multi-FY project are excluded from every year EVEN WHEN the real failure
  writer left a `failed` FY1 row. **[pgTAP]**
  **Given** a multi-FY project with a phased FY2026 line + a NULL line, **and** a `failed` FY2026 mirror
  row from the REAL failure writer, **When** `get_budget_projection` runs for FY2026 and any other year,
  **Then** the NULL line contributes to **no** year's `pmo_budget_amount` (the `failed` row does not
  satisfy F-A), and a year with no phased line and no `pushed` row yields `pmo_budget_amount` NULL (never 0).
  *(Mutation: if NULL attribution used F-B or on_record, the NULL line would land in FY2026 → red.)* (FR-BFY-010, 052)
  *Structurally unable to see: that the failure writer is the producer of the `failed` row — bound by
  obtaining it from the served boundary, not a hand-insert.*
- **AC-BFY-015** — `list_budget_fiscal_years` offers a phased year; `is_active_push` == `on_record` via an
  INDEPENDENT oracle. **[pgTAP]**
  **Given** the phased-but-refused project of AC-BFY-013, **When** `list_budget_fiscal_years(p)` runs,
  **Then** FY2026 is offered and its `is_active_push` is true, AND the test re-derives `on_record` from
  FIRST PRINCIPLES in SQL (a separate `exists(phased Active line)` query — not a call to the same
  predicate) and asserts equality. *(Mutation: if `is_active_push` and `on_record` were both the same wrong
  predicate, the independent re-derivation disagrees → red.)* (FR-BFY-051)
  *Structurally unable to see: the page's rendering of the flag — owned by an e2e.*
- **AC-BFY-019** — Drift detection via the REAL push witness (no hand-seeded witness). **[served + pgTAP]**
  **Given** an all-NULL single-FY Active version, **When** it is pushed through the REAL served boundary
  (so `budgetWriter` stamps `pushed_project_start_date`/`pushed_project_end_date` non-NULL) and the mirror
  is read back (witness non-NULL), **and then** the project's `end_date` is extended into FY2,
  **When** `get_budget_projection(p,'FY1')` and `get_budget_push_status(p)` run,
  **Then** FY1's `pmo_budget_amount` is NOT the whole (now multi-year) budget — NULL lines attribute to NO
  year — the affected category's `attribution_known` is false, variance/utilization are NULL (NOT `-EAC`),
  and the status carries the actionable reason; no split is manufactured for FY2. *(Mutation: if the witness
  were never written, it stays NULL and the backward-compat path attributes the whole budget to FY1 → red;
  if the NULL branch ignored drift, FY1 = whole budget → red; if variance printed -EAC, the "variance is
  NULL" assertion → red.)* (FR-BFY-053, 080, 055)
  *Structurally unable to see: the pre-witness (bench/demo) population — named residual risk in FR-BFY-053.*
- **AC-BFY-023** — `attribution_known` distinguishes suppressed from genuinely-unbudgeted. **[pgTAP]**
  **Given** a project where category X's only line is a NULL line whose attribution is suppressed (drift,
  per AC-BFY-019's setup) AND category Y has actuals but NO line at all in a known year (on_record via
  another phased line),
  **When** `get_budget_projection` runs,
  **Then** X has `pmo_budget_amount` NULL, `attribution_known` false, `projected_variance` NULL,
  `projected_utilization` NULL; AND Y has `pmo_budget_amount` NULL, `projected_variance` = `-(actuals+etc)`
  (`-EAC`), `projected_utilization` NULL. *(Mutation: if the variance rule collapsed both NULL-budget states,
  X would print `-EAC` → red; an independent oracle recomputes both.)* (FR-BFY-054, 055)
  *Structurally unable to see: the JS oracle — owned by a Vitest twin AC that feeds `attributionKnown:false`
  and asserts variance NULL.*
- **AC-BFY-024** — `on_record` excludes failed/held rows. **[pgTAP]**
  **Given** a year with ONLY a `failed` mirror row (no phased line, no `pushed` row) and a category with
  actuals but no line, **When** `get_budget_projection(p, that year)` runs, **Then** `on_record` is false,
  the category's `pmo_budget_amount` is NULL, and `projected_variance` is NULL (NOT `-EAC` — a failed
  attempt is not a budget on record). *(Mutation: if `on_record` included F-B, variance would be `-EAC` →
  red.)* (FR-BFY-050, 052)
  *Structurally unable to see: the held-row symmetric case — owned by an adjacent AC seeding `held`.*

### Per-year push status + retry/release (finding 6)
- **AC-BFY-025** — `get_budget_push_status` returns one row per expected year; absent expected years are
  explicit `never-pushed`. **[pgTAP]**
  **Given** a multi-FY Active version phased to FY2026 + FY2027 where FY2026 pushed and FY2027 has no mirror
  row (the process died before writing it), **When** `get_budget_push_status(p)` runs, **Then** it returns
  TWO rows (FY2026 `pushed`, FY2027 `never-pushed`), derived from the Active phased lines LEFT-JOINed to the
  mirror — never `limit 1`. *(Mutation: if it took the first row, FY2027 is omitted → red; an independent
  oracle re-derives the expected set from `budget_line_items.fiscal_year`.)* (FR-BFY-056)
  *Structurally unable to see: the page rendering — owned by AC-BFY-026.*
- **AC-BFY-026** — The page surfaces both years; retry/release act on a specific year. **[e2e]**
  **Given** the partial-failure state of AC-BFY-012, **When** the operator opens the projection page and
  retries FY2027, **Then** both years' status render (the failed year is not hidden), and the retry
  dispatches for FY2027 only (the key/identity carry FY2027), never re-pushing FY2026. *(Asserts ERP STATE
  + the per-year dispatch.)* (FR-BFY-034, 056)
  *Structurally unable to see: the RPC's expected-set derivation — owned by AC-BFY-025.*

### Never fight the operator (finding 7)
- **AC-BFY-027** — A Desk-authored live Budget with no PMO mapping is NOT amended. **[served]**
  **Given** a submitted (docstatus=1) ERP `Budget` on the (company, FY, project) grain with NO PMO
  `external_refs` mapping (created directly in Desk), **When** PMO pushes for that grain through the served
  boundary, **Then** the push fails closed with `budget-unowned-live-occupant` naming the document and year,
  and ERP still holds exactly the one Desk Budget (PMO did not amend it). **And given** a PMO-mapped live
  occupant, **When** PMO re-pushes, **Then** it IS amended (regression). *(Mutation: if the ownership check
  were absent, the Desk Budget is cancelled+amended → red via ERP-state assertion.)* (FR-BFY-076)
  *Structurally unable to see: the draft-rival path — owned by the existing `budget-draft-rival-on-grain` AC
  (unchanged).*

### Category map history (finding 8)
- **AC-BFY-028** — A category whose map row is absent renders actuals NULL (no coalesce-to-zero) for a
  multi-year project. **[pgTAP]**
  **Given** a two-year project where category Z has snapshot actuals but no `budget_category_account_map`
  row, **When** `get_budget_projection` runs for either year, **Then** Z's `actuals_to_date` is NULL (not 0)
  for both years. *(Mutation: if the actuals CTE coalesced to 0, Z shows $0 → red.)* (re-asserts C-1)
  *Structurally unable to see: the map-EDIT re-interpretation — owned by AC-BFY-029.*
- **AC-BFY-029** — A map EDIT silently re-interprets prior years' actuals (documenting sentinel; named
  non-goal). **[pgTAP]**
  **Given** FY2026 actuals at account A mapped to "Labor", **When** the Admin edits the map to Labor→B
  (A now unmapped), **Then** the projection for FY2026 drops Labor's actuals at A (they no longer join) —
  **this AC DOCUMENTS the current defective behavior** and is the regression sentinel for OQ-BFY-5; it must
  NOT silently flip green when the follow-up lands without the map-history machinery. *(Mutation: this AC is
  intentionally assertions-on-current-behavior; the follow-up issue replaces it with a fail-closed/effective
  -dated assertion.)* (finding 8, OQ-BFY-5)
  *Structurally unable to see: whether the follow-up has shipped — that is the point (it's a sentinel).*

### Writes + security (F7, F9, finding 10)
- **AC-BFY-016** — `fiscal_year` is settable on a Draft line and immutable on an Active line. **[pgTAP]**
  (FR-BFY-060, 061)
- **AC-BFY-017** — The column inherits RLS AND the three re-created RPCs are acceptance-bound. **[pgTAP]**
  **Given** orgs A and B each with phased line items, **When** an org-A member reads/writes org-B's
  `budget_line_items.fiscal_year`, and an authenticated org-A member calls `get_budget_projection` /
  `list_budget_fiscal_years` / `get_budget_push_status` with org-B's project UUID,
  **Then** the cross-org read/write is denied/empty, AND pgTAP asserts `prosecdef = false`,
  `proconfig->>'search_path' = 'public, pg_temp'`, `authenticated`-only ACL, `anon`/`public` revoked for all
  three RPCs; `clone_budget_version`/`activate_budget_version` retain their definer authz. *(Mutation:
  recreate a function as `SECURITY DEFINER` → the `prosecdef` assertion → red; drop the search_path → the
  `proconfig` assertion → red.)* (FR-BFY-001, 090; NFR-BFY-SEC-001)
  *Structurally unable to see: the JS oracle's handling of `attributionKnown` — owned by AC-BFY-023's twin.*

### Inbound feed (finding 3)
- **AC-BFY-030** — Colon/delimiter-bearing FY names round-trip through key + identity + feed parser.
  **[served]**
  **Given** a Fiscal Year named `'A:B 2026'`, **When** a push + an ERP cancel flow through, **Then** the
  encoded identity round-trips (the cancel resolves to the correct mirror row and tombstones it), and the
  key passes the served guard. *(Mutation: if the parser dropped the year or the guard rejected letters,
  red.)* (FR-BFY-031, 038)
  *Structurally unable to see: the live ERP naming grammar — named in "WHAT I COULD NOT VERIFY."*

### Traceability

| AC | FR(s) | Layer | Owning file |
|---|---|---|---|
| AC-BFY-001 | 070, 050 | pgTAP | `supabase/tests/bfy_backward_compat.test.sql` |
| AC-BFY-002 | 070 | regression | (existing budget + projection suites) |
| AC-BFY-003 | 001, 062, 071 | pgTAP | `supabase/tests/bfy_clone_preserves_fiscal_year.test.sql` |
| AC-BFY-004 | 011 | Vitest | `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` |
| AC-BFY-005 | 010 | Vitest | `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` |
| AC-BFY-006 | 030 | Vitest | `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` |
| AC-BFY-007 | 021 | Vitest | `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` |
| AC-BFY-008 | 021 (OQ-BFY-1) | Vitest | `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` |
| AC-BFY-009 | 030, 031, 032, 036 | served | `supabase/functions/adapter-dispatch/__tests__/bfy_typed_command.test.ts` |
| AC-BFY-010 | 032, 034 | pgTAP+served | `supabase/tests/bfy_outbox_year_qualified.test.sql` + served replay |
| AC-BFY-011 | 030 | e2e | `pmo-portal/e2e/serial/AC-BFY-011-multi-fy-fan-out.spec.ts` |
| AC-BFY-012 | 033, 034, 056 | e2e | `pmo-portal/e2e/serial/AC-BFY-012-partial-failure-retry.spec.ts` |
| AC-BFY-013 | 050 | pgTAP | `supabase/tests/bfy_projection_refused_push.test.sql` |
| AC-BFY-014 | 010, 052 | pgTAP | `supabase/tests/bfy_projection_null_lines.test.sql` |
| AC-BFY-015 | 051 | pgTAP | `supabase/tests/bfy_list_fiscal_years.test.sql` |
| AC-BFY-016 | 060, 061 | pgTAP | `supabase/tests/bfy_draft_guard_fiscal_year.test.sql` |
| AC-BFY-017 | 001; 090; SEC-001 | pgTAP | `supabase/tests/bfy_fiscal_year_rls_and_rpc_security.test.sql` |
| AC-BFY-018 | 035 | pgTAP | `supabase/tests/bfy_external_refs_rekey.test.sql` |
| AC-BFY-019 | 053, 080, 055 | served+pgTAP | `supabase/functions/adapter-dispatch/__tests__/bfy_witness_drift.test.ts` |
| AC-BFY-020 | 035b | pgTAP | `supabase/tests/bfy_migration_preflight.test.sql` |
| AC-BFY-021 | REV-001 | pgTAP | `supabase/tests/bfy_migration_reversibility.test.sql` |
| AC-BFY-022 | 075 | served | `supabase/functions/erpnext-sweep/__tests__/bfy_sweep_gate.test.ts` |
| AC-BFY-023 | 054, 055 | pgTAP | `supabase/tests/bfy_attribution_known.test.sql` (+ Vitest twin) |
| AC-BFY-024 | 050, 052 | pgTAP | `supabase/tests/bfy_on_record_excludes_failed.test.sql` |
| AC-BFY-025 | 056 | pgTAP | `supabase/tests/bfy_push_status_per_year.test.sql` |
| AC-BFY-026 | 034, 056 | e2e | `pmo-portal/e2e/serial/AC-BFY-026-per-year-status-retry.spec.ts` |
| AC-BFY-027 | 076 | served | `supabase/functions/adapter-dispatch/__tests__/bfy_unowned_live_occupant.test.ts` |
| AC-BFY-028 | (C-1 re-assert) | pgTAP | `supabase/tests/bfy_unmapped_category_null.test.sql` |
| AC-BFY-029 | finding 8 / OQ-BFY-5 | pgTAP | `supabase/tests/bfy_map_edit_reinterprets_history.test.sql` |
| AC-BFY-030 | 031, 038 | served | `supabase/functions/adapter-dispatch/__tests__/bfy_colon_fy_roundtrip.test.ts` |

---

## 11. Risks — what could go wrong with money

1. **A line double-counted across years.** A phased line contributes to exactly one year; a NULL line to at
   most one (via F-A + witness). Phased lines have non-NULL `fiscal_year` so they are excluded from the NULL
   branch; a multi-FY project that pushed has no NULL lines (the gate refuses them). Guarded by AC-BFY-014
   (NULL excluded everywhere, even beside a `failed` row) + AC-BFY-013 (phased counted once).
2. **A confident derived figure printed against an unknown attribution.** *(New headline risk, finding 2.)*
   A suppressed NULL line (refused push, stale witness) must NULL variance/utilization, never `-EAC`.
   Guarded by AC-BFY-023 (suppressed ⇒ NULL) + AC-BFY-024 (failed-only year ⇒ NULL) + AC-BFY-019 (drift ⇒
   NULL).
3. **A partially-pushed fan-out enforcing overspend for one year and none for the other, hidden by
   `limit 1`.** Guarded by AC-BFY-012 (per-year state) + AC-BFY-025/026 (per-year status + retry).
4. **A clone silently un-phases the budget.** Guarded by AC-BFY-003 (mutation-checked).
5. **The outbox one-in-flight index blocking concurrent years.** The year-qualified `outbox_identity` is the
   fix; guarded by AC-BFY-010 (mutation-checked, exercises `external_refs` + served replay).
6. **A `fiscal_year` that becomes an invalid Link later.** Fails closed at next push (FR-BFY-021); guarded
   by AC-BFY-007. *(The projection does not validate — an invalid year matches nothing, honestly.)*
7. **Stale mirror year after the project's dates change — FIXED.** The push-time span witness (FR-BFY-080,
   written by the REAL push — finding 9) lets the projection detect drift and stop attributing (FR-BFY-053).
   Guarded by AC-BFY-019 (served, witness from a real push, not hand-seeded). **Residual risk:** NULL-witness
   (pre-issue) rows cannot be drift-checked; that population is bench + demo.
8. **Overlapping Fiscal Years.** `fiscalYearContaining` refuses ambiguity. Carried forward unchanged.
9. **The projection rewire breaking the generation scoping (HIGH-1).** The rewire touches only `budget_year`
   + `pmo_budget`; `current_snapshot`/`reading`/`actuals` and their `snapshot_id` predicates are untouched.
   *(Re-verify at build: the new `pmo_budget` must not drop the `snapshot_id` discipline on the actuals
   side — it does not.)*
10. **`database.types.ts` regeneration wiping nullability.** Regenerate deliberately (process note).
11. **The category→account map has no fiscal-year history (finding 8).** An Admin map edit re-interprets
    prior years' actuals; undetectable without history. Named non-goal (OQ-BFY-5); sentinel AC-BFY-029; the
    in-scope guard (no coalesce-to-zero) is AC-BFY-028.
12. **The sweep POSTing a frozen year/body the foreground gate would now reject (finding 5).** Guarded by
    AC-BFY-022 (sweep re-runs the shared gate; holds).
13. **PMO amending a Desk-authored live Budget (finding 7).** Guarded by AC-BFY-027 (ownership check).
14. **A migration race orphaning an enforced ERP Budget / rollback losing a year (finding 4).** Guarded by
    AC-BFY-018/020/021 (fence, preflight, honest reversibility).
15. **A re-created RPC dropping to `SECURITY DEFINER` and leaking cross-org (finding 10).** Guarded by
    AC-BFY-017 (pgTAP on `prosecdef`/`proconfig`/ACL/cross-org).

---

## 12. Open questions for the Director / owner

1. **OQ-BFY-1 — A line phased to a valid Fiscal Year *outside* the project's `[startFY, endFY]` span.**
   **Recommendation: fail closed** (`budget-fiscal-year-out-of-span`). Encoded as FR-BFY-021's branch +
   AC-BFY-008; flip if the owner disagrees.
2. **OQ-BFY-2 — `get_budget_push_status` return shape after fan-out.** **Recommendation: one row per
   expected (Active × fiscal_year)**, expected-set LEFT-JOINed to the mirror (FR-BFY-056). Confirmed in this
   round (round 1 said it but did not bind the consumers; this round does — §6.5/AC-BFY-025/026).
3. **OQ-BFY-3 — The fiscal-year write affordance + the client→server key-derivation move.** **Recommendation:**
   a select of the client's known Fiscal Years when an `erpnext` binding is active; free text otherwise;
   validation always push-time. **And:** the client stops minting the key; the server derives it per year
   from the gate's plan (§5.1). Confirm the Director is OK with that contract change.
4. **OQ-BFY-4 — Index on `(budget_version_id, fiscal_year)`.** **Recommendation: defer** unless profiling
   shows a need.
5. **OQ-BFY-5 — The category→account map has no fiscal-year history (finding 8).** **Recommendation: a
   separate follow-up issue** that either (a) makes `budget_category_account_map` effective-dated/per-FY, or
   (b) snapshots the category mapping into `erp_actuals_snapshot` at read time, so an Admin map edit no
   longer re-interprets prior years' actuals. **This issue's scope is the budget-line-item phasing
   dimension, not the category-map subsystem;** the defect is named here (§2 non-goals, risk 11,
   AC-BFY-029 sentinel) and the in-scope guard (no coalesce-to-zero, AC-BFY-028) is retained. Owner to
   confirm the follow-up is tracked.

---

## 13. Self-verification (re-read against the brief)

- **The root-cause fence (round 2).** Every mirror-consulting predicate now names its fact (§1.1, §14):
  `on_record` = F-C ∨ F-A; NULL attribution = F-A + witness; `attribution_known` = F-D; `is_active_push` =
  F-C ∨ F-A; `observed` unions F-B (inspectable) but the flag excludes it. FR-BFY-050/054/055; AC-BFY-013/
  014/023/024. ✔
- **F2 (PMO never invents; multi-FY NULL fails closed).** FR-BFY-010 (`budget-multi-fiscal-year-unphased`,
  names the NULL lines, "phase these lines"); FR-BFY-011; ADR-0048. ✔
- **F3 (year is the client's own).** FR-BFY-020/021/022. ✔
- **F4 (one ERP Budget per FY; deterministic key; mirror grain; partial failure; re-push not duplicate;
  end-to-end identity; migration safety).** FR-BFY-030/031/032/033/034/035/036/038; §5.1; §4.5; AC-BFY-009/
  010/011/012/018/020/021/030. ✔
- **F5 (enumerate every consumer).** §8 table (grep-exhaustive, now includes the full push chain). ✔
- **F6 (close FR-BUD-152; rewire to PMO's own fact; invariant not relaxed, applied one level deeper).**
  §6; FR-BFY-050/051/052/053/054/055/056. ✔
- **F7 (writes; Draft-only; clone).** FR-BFY-060/061/062. ✔
- **F8 (backward compat proved).** FR-BFY-070/071; AC-BFY-001/002. ✔
- **F9 (one reversible migration, RLS + org_id).** §4 + §4.5; NFR-BFY-REV-001 (honestly bounded). ✔
- **Finding 5 (sweep gate reuse).** FR-BFY-075; AC-BFY-022. ✔
- **Finding 7 (never fight the operator).** FR-BFY-076; AC-BFY-027. ✔
- **Finding 8 (category map history).** Named non-goal + OQ-BFY-5 + AC-BFY-028/029. ✔
- **Finding 9 (witness wired).** FR-BFY-080; AC-BFY-019 (witness from a real push). ✔
- **Finding 10 (RPC security modes).** FR-BFY-090; AC-BFY-017. ✔
- **Finding 11 (AC battery re-derived; no hand-seeded unreachable states).** Each AC obtains mirror/witness/
  status state from the REAL writers; each states what it cannot see; AC-BFY-013/014 use the real failure
  writer; AC-BFY-019 uses a real-push witness; AC-BFY-015/023 use independent oracles; AC-BFY-010 exercises
  `external_refs` + served replay + the cross-record index. ✔
- **Every AC names exactly one owning layer + what it cannot see.** §10 traceability + per-AC note. ✔

**Deviations reported:** (a) F5 "procurement reserved budget (0015)" — grep shows 0015 is comment-only;
the real consumer is `DecisionSupportPanel` via `get_project_budget` (transitive, unchanged) — §8. (b) The
round-1 `exists(mirror row)` proxy is rejected wholesale and replaced by the §1.1 fence — this is a
correctness deviation from round 1, not from the brief. (c) OQ-BFY-5 (category-map history) is genuinely
larger than this issue; I ruled it out of scope as a full fix, named the consequence, and retained the
in-scope guard + a sentinel — reported, not hidden.

---

## 14. The fence, applied — every mirror-consulting predicate and the fact it tests

| Predicate (location) | Fact it now tests | Was (round 1) |
|---|---|---|
| `budget_year.on_record` (§6.1) | **F-C** (phased Active line for year) **∨ F-A** (`pushed` mirror row) | `exists(mirror row)` (F-B) — **FIXED** |
| `pmo_budget` NULL-line attribution (§6.2 `attributed_null`) | **F-A** (`pushed`) **+ witness match** | `on_record` (which included F-B) — **FIXED** |
| `pmo_budget.attribution_known` (§6.2, NEW) | **F-D** (per category-year: a line is honestly attributed) | did not exist — **ADDED** |
| variance/utilization `-EAC` branch (§6.2) | fires ONLY when budget NULL **and** `attribution_known ≠ false` **and** `on_record` | fired whenever budget NULL **and** `on_record` — **FIXED** |
| `list_budget_fiscal_years.observed` (§6.4) | **F-B ∪ actuals ∪ etc ∪ F-C** (all are *inspectable*; the *flag* is the gate) | F-B only ∪ actuals ∪ etc — **widened** (F-C added) |
| `list_budget_fiscal_years.is_active_push` (§6.4) | **== `on_record`** (F-C ∨ F-A) | `exists(mirror row)` (F-B) — **FIXED** |
| `get_budget_push_status` expected-set (§6.5) | Active phased lines ∪ plan ∪ **mirror rows (F-B)**, LEFT-JOINed (a failed row IS a status row) | `limit 1` on F-B — **FIXED (per-year + expected-set)** |
| The failure writers' mirror row (FR-BFY-010/033) | records **F-B** (an attempt) — and is **explicitly NOT consulted** for attribution | round 1 treated its output as attributable — **FIXED** |
| The sweep reconcile's frozen payload (FR-BFY-075) | re-runs the **gate** (F-C/F-A/calendar/span) before POSTing; holds if it would fail | POSTed the frozen body with no gate — **FIXED** |
| `resolveBudgetRefs` live-occupant amend (FR-BFY-076) | requires a **PMO ownership witness** (`external_refs`) before amending | amended any docstatus=1 occupant — **FIXED** |
| Feed `.eq('budget_version_id', pmoRecordId)` (FR-BFY-038) | parses the **bare vid** out of the year-qualified identity (the FK fact) | would receive a year-qualified value against a uuid column — **FIXED** |

**Predicates that still read bare mirror existence (F-B) and why they are correct:**
- `list_budget_fiscal_years.observed` unions F-B — **correct**: a failed/held push IS an inspectable year
  (an operator may legitimately view it); the *flag* `is_active_push`, not the *offer*, is what excludes
  F-B from money attribution.
- `get_budget_push_status`'s expected-set LEFT-JOIN includes mirror rows — **correct**: a `failed`/`held`
  row IS a status row the surface must render ("FY2027 failed"); it is not consulted for budget
  *attribution* (§6.1/§6.2), only for push *status*.
- The failure writers WRITE an F-B row — **correct and required**: a refused push must be durable,
  operator-visible state and sweep-recoverable. The fix is not to stop writing it; the fix is that **no
  attribution predicate treats its existence as a budget on record** (§6.1 excludes F-B from `on_record`;
  §6.2 requires F-A for NULL attribution).

**No predicate in this spec uses bare mirror existence (F-B) as a proxy for a money attribution.** Every
attribution consults F-C (PMO's own line items), F-A (a succeeded push), or F-D (the known-attribution
fact). The two F-B reads that remain (§6.4 `observed`, §6.5 expected-set) are *display/inspection* reads,
not attribution reads, and §14 states why each is correct.
