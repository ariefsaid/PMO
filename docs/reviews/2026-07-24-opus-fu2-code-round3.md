VERDICT: NO SHIP

# Adversarial money/security review — FU-2 budget fiscal-year, round 3

**Subject:** `feat/budget-fiscal-year` (`origin/dev..HEAD`, 44 commits) — migrations `0153`/`0154`/`0156`,
the four round-2 fixes (`3265121b`, `a2709953`, `882a320b`, `6b28b328`).
**Position:** fallback for the capped cross-family gate (gpt-5.6-luna). Same family as the builders —
see **CROSS-FAMILY BLIND SPOT**.
**Mode:** read-only. No implementation file was modified. Gates not re-run (per brief).

I replayed the state machines rather than following the prose, as round 2 instructed. **All four
round-2 findings are genuinely and correctly fixed**, and two of them are fixed better than the review
asked for. The single reason this is not a SHIP is a defect *introduced by the BLOCK-2 fix itself*: the
new fifth reason string was inserted into a four-branch ladder whose first two branches were written
when `attribution_known` could only mean one thing. It now means two, and the ladder picks the wrong
sentence in a reachable, ordinary state — asserting to the operator that spend on a category PMO cannot
place is "not an overspend".

It is one function, six lines, and the data it needs is already fetched.

---

## SHOULD-FIX 1 — the absence ladder tells a partly-unplaceable category it is "budgeted in FY2027 … not an overspend"

**File:** `pmo-portal/pages/BudgetProjection.tsx:422-430` (`budgetReasonFor`), branch 1 at `:424`.
**Supporting file:** `pmo-portal/src/lib/repositories/budgetProjection.ts:208-223`
(`fetchActiveBudgetCategoryYears`), the `if (!row.fiscal_year) continue;` at `:218`.

`0153:331-338` collapses **two different facts** into one `attribution_known = false`:

| bool_or | bool_and | meaning | honest sentence |
|---|---|---|---|
| false | true | every line phased to ANOTHER year | "budgeted in FY2027" (fully known) |
| true  | false | some lines here, at least one un-placeable | "some lines are not phased" (unknown) |
| false | false | **phased elsewhere AND an un-placeable line** | *neither of the above* |

Row 3 is reachable and the ladder has no branch for it. `budgetReasonFor` tests `elsewhere.length > 0`
**first** (`:424`) and `elsewhere` is derived from PMO's phased lines only — `fetchActiveBudgetCategoryYears`
drops un-phased rows at `:218`, so the un-placeable line is invisible to the branch that wins.

**Reproduction (inputs → wrong statement about money).**
1. Project P, `start_date` 2025-08-01, `end_date` 2027-03-31 (multi-FY on a Jul–Jun calendar).
2. Active version V, category `Labor`: one line **$100,000 phased `'2027'`**, one line **$50,000 un-phased**
   (the PM phased most lines and missed one — the ordinary shape of the `budget-multi-fiscal-year-unphased`
   refusal). Any other category phased to `'2026'` (e.g. `Materials $60,000`) so FY2026 is `on_record` via F-C.
3. The push is **refused** (`budget-multi-fiscal-year-unphased`, `budgetGate.ts:228-236`) — no `pushed`
   mirror row, so `attributed_null` is empty.
4. FY2026 GL posts $30,000 against Labor's mapped account.
5. `get_budget_projection(P,'2026')`, Labor: `bool_or` = false (2027-line and un-phased line both fail P),
   `bool_and` = false (the un-phased line is un-placeable) ⇒ `attribution_known = false`, amount NULL,
   variance NULL, utilization NULL. **All the numbers are correct and correctly withheld.**
6. The surface: `categoryYears['Labor'] = ['2027']` ⇒ `elsewhere = ['2027']` ⇒ branch 1 fires and the
   Budget cell, the Projected-final cell, the Variance cell and the Utilization cell all read:

> "Not budgeted in this fiscal year: this category is budgeted in 2027. **Spend posted here is a timing
> difference, not an overspend** — switch the fiscal year above to compare it against its own budget."

**Money consequence.** PMO holds $150,000 of Labor on this project, $50,000 of which it *cannot place in
any year*. The screen states as fact that none of it belongs to FY2026 and that the $30,000 posted there
is not an overspend — a claim PMO does not hold and the RPC has just refused to make. The remedy named
("switch the fiscal year") is not the remedy (the remedy is "phase the un-phased line", which is what
`BUDGET_ATTRIBUTION_PARTIAL` was written two commits ago to say). This is precisely the class the fifth
string was added to close, one branch to the left of where it was inserted.

**Second, same ladder (`:425`).** `staleForSelectedYear` is a **project-year** flag (`:405`) applied to a
**per-category** question, and it is tested before the per-category `attributionKnown` (`:428`). On any
project with a drifted witness, a category with **no budget line at all** — whose variance is a correct,
deliberately loud `-EAC` — has its Budget cell explained as *"this budget's fiscal-year attribution is
stale … Phase these lines to their fiscal years"*, about lines that do not exist. The genuine
unbudgeted-spend alarm is explained away as a phasing bookkeeping issue.

**Smallest fix** (no new query, no RPC change — `fetchActiveBudgetCategoryYears` already reads the
un-phased rows and throws them away at `:218`):

```ts
// repositories/budgetProjection.ts — return the fact instead of dropping it
export type BudgetCategoryFiscalYears = Partial<Record<BudgetCategory, string[]>>;
export interface ActiveBudgetCategoryPhasing {
  years: BudgetCategoryFiscalYears;
  unphased: Partial<Record<BudgetCategory, true>>;   // ← :218 currently `continue`s past this
}

// BudgetProjection.tsx:422-430
const budgetReasonFor = (row: BudgetProjectionCellRow): string => {
  const elsewhere = (categoryYears[row.category] ?? []).filter((y) => y !== fiscalYear);
  // "budgeted elsewhere" is a KNOWN fact only when nothing of this category is un-placeable.
  if (elsewhere.length > 0 && !unphasedByCategory[row.category]) return budgetedInOtherYears(elsewhere);
  // staleness is a statement about THIS category's suppression, not about the project-year.
  if (row.attributionKnown === false && staleForSelectedYear) return BUDGET_ATTRIBUTION_STALE;
  if (row.attributionKnown === false) return BUDGET_ATTRIBUTION_PARTIAL;
  return budgetYearOnRecord ? NO_BUDGET_LINE : NO_BUDGET_FOR_YEAR;
};
```

**Test gap (why no test can catch it today).** `bfy_attribution_partial.test.sql:56-58` gives project B's
`Subcontractors` lines phased **only** to 2027 and `Materials` lines phased to **both** years — neither
fixture has a category with a phased-elsewhere line **and** an un-phased sibling, so the `(false,false)`
row of the table above appears in no fixture at any layer. `BudgetProjection.test.tsx:964-976` pins the
new string with `categoryYearsMock.mockResolvedValue({ Labor: ['2026'] })` — deliberately "phased HERE —
nothing is 'elsewhere'", i.e. the one arrangement that cannot reach branch 1. Add the mixed fixture to
`bfy_attribution_partial.test.sql` (assert `attribution_known` false with `categoryYears = ['2027']`) and
a `BudgetProjection.test.tsx` case with `{ Labor: ['2027'] }` + `attributionKnown: false` asserting the
PARTIAL sentence and **not** the "timing difference" one.

---

## What I attacked and found clean

**1. The upgraded fake is faithful within its stated scope.** `budgetOutboxOrphan.test.ts:59-129`. I
checked it against real supabase-js/PostgREST semantics rather than against its comment:
- `update()` stashes the payload and records on `then` (`:110-127`) — correct: the PostgREST builder is a
  lazy thenable and the filters are not complete until the chain resolves. The write is recorded even when
  **zero** rows match, which is right (an UPDATE statement *was* issued) and is exactly what makes the
  no-year test at `:315-327` able to fail.
- The mutation applies to `rowsFor()` evaluated **before** `Object.assign`, so a predicate is judged
  against pre-mutation state. Correct.
- The three new tests are genuinely mutation-sensitive: dropping `.eq('fiscal_year', …)` from
  `erpnext-sweep/index.ts:1120` makes FY2026 `held` and fails `:285-292`; dropping the `:1114` guard
  records a mirror write and fails `:319-325`.
- I could construct **no** behaviour it asserts that the real client does not have. The remaining
  divergences are all in the *permissive* direction (see NOTE 5).

**2. The BLOCK-1 fix is complete, not just at the named site.** Both callers (`:1234` no-outbox-candidate,
`:1258` attempts-exhausted) route through the one CAS. `fiscal_year` is `text NOT NULL` (0137 §1), so the
`!fiscalYear` early return can only fire for a synthetic `absent` orphan — and that branch already took the
same posture at `:1092`. `listPendingBudgetPushes` carries the year onto every candidate (`:1160`, `:1201`).
No bare-version budget-mirror mutation survives anywhere in `erpnext-sweep/index.ts`.

**3. The `bool_or ∧ bool_and` conjunction is arithmetically right, in both directions.** I enumerated all
four line shapes against `0153:331-338`:

| line | P (`bool_or`) | Q (`bool_and`) |
|---|---|---|
| phased to `p_fiscal_year` | T | T |
| phased to another year | F | **T** ← "knowably elsewhere", the no-over-suppression case |
| un-phased, `attributed_null` non-empty | T | T |
| un-phased, `attributed_null` empty | F | F |

- **All-phased-elsewhere still FALSE** (row 2 alone ⇒ `bool_or` F): preserved, and the conjunction cannot
  resurrect it. Pinned by `bfy_attribution_partial.test.sql:103-114`.
- **Phased across BOTH years is NOT suppressed** (rows 1+2 ⇒ T ∧ T): pinned by `:129-136`, and that
  assertion asserts a **non-null $60,000**, so it also proves the fixture is reachable.
- I could not construct a case that *should* state a figure and now reads unavailable. When
  `attributed_null` is empty, `bool_and` true ⇒ every line phased ⇒ the sum is the year's honest share.
  When it is non-empty, Q is true for every line and nothing is suppressed at all.
- **The amount withholding is at the right layer.** `0153:386-388` nulls the amount from
  `coalesce(c.attribution_known, true) = false`, while the variance/utilization branches (`:406`, `:413`)
  read the **raw** `c.pmo_budget_amount`. That is correct, not an oversight: branch 2 precedes every
  amount-dependent branch, so the raw value can never leak. A category with no line arrives as NULL and
  `coalesce(…, true)` keeps its `-EAC` alarm (`bfy_attribution_known.test.sql:158-172`, an **independent
  oracle** recomputed over the base tables — the strongest assertion in the suite).
- **The JS twin agrees line-for-line.** `budgetProjection.ts:127-129` (amount), `:159-161` (variance,
  utilization), `:170`. Every SQL branch has an identical JS branch and the precedence matches. Round-2
  NOTE 10 (the comment overstating the code) is now true of the code.

**4. Fixture reachability, checked deliberately (the hunt for a third defect).** Both known defects are
fixed and the reasoning behind each is right: `budgetOutboxOrphan.test.ts:164` moves the mirror row to
`failed` because the now-faithful `.in('push_state', …)` would otherwise drop a `pushed` row from **both**
dedup sets and let the version-only dedup pass. I then re-derived reachability for every new oracle:
- `bfy_attribution_partial.test.sql` — assertions 1, 6, 11 and 12 assert **non-NULL** values (`false`,
  `false`, `true`, `60000.00`), so a silently-empty result set fails them. The five NULL assertions cannot
  pass vacuously behind them.
- `bfy_attribution_known.test.sql` — half 1 asserts `100000.00`/`true` before the drift, so the fixture is
  proven live before the NULLs are asserted; the `-EAC` oracle is computed from base tables.
- `0156_release_outbox_hold.test.sql:180-184` asserts `count(*) = 1` over `pg_proc` — a real structural
  oracle for the overload-ambiguity hazard, not a comment.
- The third defect I expected is **not** in the fixtures; it is SHOULD-FIX 1, one layer up.

**5. `0156` — the drop is correct and cannot strand a caller.** `0137` is byte-identical to `origin/dev`
(`git diff origin/dev..HEAD -- …0137…` is empty). The Supabase CLI runs each migration in one transaction,
so `drop` + `create or replace` are atomic: a concurrent session sees the 2-arg or the 3-arg, never
neither. Every 2-arg call resolves through `p_expected_domain default null` with `p_expected_domain is not
null` short-circuiting the new check (`0156:74`) — byte-for-byte the shipped body, verified line by line
against `0137:198-258`. `0156_release_outbox_hold.test.sql` exercises both arities (`:50-103` 2-arg,
`:165` 3-arg wrong-domain) plus the uniqueness proof.

**6. `'nothing-to-push'` cannot be misclassified, in either direction.** `budgetUnits` is assigned for
every budget command that clears the gate (`index.ts:857`), so `!budgetUnits` never routes a budget push
down the legacy branch; the fan-out loop appends exactly one `yearOutcomes` entry per unit (`:1338`,
`:1347`); and `if (firstFailure) return firstFailure` (`:1351`) means a **200 with `years` can only ever
carry all-`pushed: true`**. Therefore `years: []` ⟺ an empty plan ⟺ nothing attempted. A named-year retry
whose year is not in the plan throws before the loop (`:849-856`), so it becomes a 422/`'failed'`, never a
false `'nothing-to-push'`. A single-FY version with zero lines is *not* misreported: `buildPlan` returns
one entry with `line_items: []` and `bodies/budget.ts` throws on an empty `accounts` array before any ERP
request, so it lands as an honest `'failed'` with a mirror row.
`activateVersion`'s refinement (`db/budgets.ts:253`) is safe for the same reason — `pushStateForYear(…, null)`
sees only all-true arrays on a resolved dispatch, and an absent `years` (pre-BFY server, or the
`org-not-employing-erpnext` 200 at `index.ts:812-816`) still returns `'pushed'`, which the surface renders
as the neutral "Version activated" (`ProjectBudget.tsx:753`) — no ERPNext claim is made.

**7. `0154`'s revert arithmetic.** `UPDATE … SET` expressions read OLD values, so `split_part(pmo_record_id,
':', 1)` in both assignments at `0154:236-239` uses the qualified id; the epoch recovery
`regexp_replace(idempotency_key, '^.*:', '')` is greedy and correct for a token that itself contains `:`.
The `record_outbox_ref` derivation from the locked row (`0154:313-333`) is a no-op for every
already-consistent caller and closes exactly the deploy-race window it claims.

---

## NOTE 2 — carried from round 2, unaddressed (each still correct, each still a NOTE)

- **`fiscalYearOf` fails OPEN** (`fiscalYearEncoding.ts:125-133`): an undecodable trailer yields `null` and
  the budget feed silently reverts to bare-FK, all-years scoping. Not reachable through the shipped
  encoder; the fail-open *direction* is still wrong for the highest-cost query in the module.
- **`0154`'s fence does not cover `budget_version_erp_mirror`** (`0154:69` vs `:132-137`) — the table the
  re-key reads the year from. Deploy quiescence covers it; the migration's "total and unambiguous by
  construction" (`:129-131`) still overstates the fence.
- **The JS twin has no production consumer** (`budgetProjection.ts:120`) — imported only by its own test
  and `budgetNeverPushesProjection.test.ts`. SQL/JS agreement is enforced by two test suites and nothing
  else. Say so in the header, or wire it.
- **Duplicate DOM id** `budget-fiscal-year-options` (`ProjectBudget.tsx:241` and `:393`) — `adding` and
  `editingId` are independent state, so both can mount; `axe-core` `duplicate-id` class.
- **The span witness is over-strict for an open-ended project** (`0153:269-271`, `readModelWriters.ts:877-880`):
  setting an `end_date` *inside the same fiscal year* still blanks the budget column. Fail-closed, never
  wrong, still a self-inflicted blank on a routine edit.

## NOTE 3 — the upgraded fake's remaining blind spots, worth naming in its header

`budgetOutboxOrphan.test.ts`: `org_id` is exempt from `matchesMirror` (`:81`, documented); `not()` is a
no-op (`:92`); `limit()` ignores its count (`:94`) — the "fake with no cap" from the P3b/P3c program's
lesson 3/8; and `maybeSingle()` returns `opts.outboxRow` for `external_command_outbox` **regardless of the
filters** (`:96-99`), so the per-year identity/key derivation in `driveBudgetPush` (`index.ts:1223-1228`)
— the load-bearing round-1 fix — is not observable in this file. None of these makes an assertion wrong;
all four are permissive. Two lines of comment stating what the fake is structurally unable to see would
stop the next maintainer reasoning from it.

## NOTE 4 — structure: the budget fan-out has outgrown `adapter-dispatch/index.ts`

`+199` lines to a file now at **1362**; `erpnext-sweep/index.ts` `+196` to **1961**. The fan-out is two
disjoint blocks (`:811-892` plan/unit construction, `:1301-1355` the loop) around 400 lines of unrelated
gates, and `runOneDispatch` is a closure that re-binds the outer `command` per year (`:1330`) — the one
piece of this change I could not reason about locally. `budgetGate.ts` already demonstrates the right
shape (pure orchestration over injected readers, unit-provable with no client). Extracting
`budgetFanOut.ts` with the same posture would make the per-year loop testable without stubbing
`Deno.serve`. Not blocking; the 5-year cost is real.

## NOTE 5 — `hold_releasable`'s legacy-bare acceptance is wider in the repository than in the RPC

`0153` accepts the bare `<vid>` only *on a year that has a mirror row*; `repositories/budgetProjection.ts:308`
accepts it unconditionally via `.in('pmo_record_id', [qualified, bare])`. Post-`0154` no bare budget outbox
row can exist (the preflight aborts rather than leaving one), so this is unreachable today. Tighten or
delete the legacy arm once `0154` is applied everywhere.

---

## WHAT I COULD NOT VERIFY

- **I ran nothing.** Per the brief I judged the code and did not re-run verify / pgTAP / deno / e2e.
  SHOULD-FIX 1's reproduction is derived by hand from `0153:331-338` + `BudgetProjection.tsx:422-430`; I
  did not observe it in a query result or a browser.
- **Changed-code coverage.** Not measured. I can state something stronger and narrower: every changed
  module on this branch has a test file, and I traced the specific oracles for each of the four fixes to
  a mutation that turns them red. The one gap I found is named above with the exact missing fixture.
- **Rendered UI.** `BudgetProjection.tsx` and `ProjectBudget.tsx` were read, not rendered. The
  reason-string claims and the duplicate-datalist claim are from source.
- **Live ERPNext semantics.** The bench 18/18, the unowned-live-occupant witness, whether a Desk cancel
  and an amend both return 200 on frappe 15.96.0 — taken on faith. I have no bench.
- **Deploy-time behaviour of `0154`.** The advisory-lock fence, a genuine two-session old-finalizer race,
  and the unfenced mirror write in NOTE 2 cannot be proven by pgTAP and I did not simulate them.
- **Whether `supabase migration up` really wraps each file in one transaction** on the CLI version pinned
  here — I asserted it from the CLI's documented behaviour, not from a strace. `0156`'s in-flight-caller
  safety turns on it (though the failure mode would be a transient `PGRST202`, not wrong money).

---

## CROSS-FAMILY BLIND SPOT

Round 2's diagnosis — anchoring on the prose — held, and the concrete shape it took this round is
**anchoring on the fix's own framing**. Every one of the four commits states the defect it closes with
real precision, and each closes it. My instinct was to verify the four claims and stop, because the claims
were true. SHOULD-FIX 1 exists in the gap *between* two of them: BLOCK 2 made `attribution_known` carry a
second meaning, and the fifth reason string was added at the branch where that second meaning arrives —
but not at the branch that was already consuming the first meaning and now wins over it. I found it only
by refusing to accept "which absence is this?" (`:407-421`) as an enumeration and instead building the
2×2 of `(bool_or, bool_and)` and asking which cell each branch claims. A reviewer without this house
style in its training would have had to build that table to read the ladder at all.

Specifically, a different family would more likely catch:
1. **Ordering defects in the other precedence ladders.** I built the truth table for `budgetReasonFor` and
   for the variance `case` (`0153:399-411`). I did **not** do it for `BLOCKED_STATES`/`QUIET_STATES`
   (`BudgetProjection.tsx:123-141`) or for `dispatchErrorStatus`. The class is "a new state added to a
   ladder whose earlier branches predate it" and I have now demonstrated it exists on this branch once.
2. **The ERPNext-side semantics I accepted.** Whether the recovery probe surfaces a cancelled Budget and
   whether `amended_from` behaves as the comments assert are load-bearing for the replay guard, and I
   verified neither.
3. **Whether `attribution_known` should be a boolean at all.** I again accepted the vocabulary and only
   questioned its aggregation — the same blind spot round 2 named, and it is the direct cause of
   SHOULD-FIX 1: the surface cannot distinguish two states because the RPC returns one bit for them. A
   model with different priors would ask for the *reason* (an enum: `phased-elsewhere` / `unplaceable` /
   `stale`) rather than a bit the client must re-derive from a second query. If the fix is going to be
   touched anyway, that is the better shape, and it removes `fetchActiveBudgetCategoryYears` from the
   money-explanation path entirely.
4. **The `runOneDispatch` closure re-binding `command` per year** (`index.ts:1330`) — I noticed the shape
   and did not push on it, because it is the shape I would have written.

Fix SHOULD-FIX 1 with the two fixtures that can fail it, and this ships. Everything else above is a NOTE.
Three rounds of real, decreasing defects: 4 BLOCKER → 2 BLOCK → 1 SHOULD-FIX, and this round's finding is
in the *fix*, not in the original design — which is the expected shape of a program converging.
Re-review should be cross-family if the cap has lifted.
