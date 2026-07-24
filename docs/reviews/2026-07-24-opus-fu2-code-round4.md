VERDICT: SHIP

# Adversarial money/security review — FU-2 budget fiscal-year, round 4

**Subject:** `feat/budget-fiscal-year` (`origin/dev..HEAD`, 46 commits) — migrations `0153`/`0154`/`0156`,
attacking `c3c029f4` (the round-3 SHOULD-FIX) and `53dd939e` (the spec correction) hardest.
**Position:** fallback for the capped cross-family gate (gpt-5.6-luna). Same family as the builders.
**Mode:** read-only on the product. I did **not** re-run the gates. I *did* run three mutations against
the Vitest suite and restored the tree (`git status` clean, verified).

`c3c029f4` is correct. I enumerated the `(bool_or, bool_and)` truth table against the shipped SQL and
replayed every cell through the shipped ladder; each renders a sentence that is true for its state, and
the `-EAC` alarm on a genuinely lineless category survives untouched. **The one finding is not in the
code — it is that one of the tests guarding it cannot fail**, which I proved by mutation rather than by
reading. It is a one-line, test-only edit that I have already verified in both directions.

---

## FINDING 1 — SHOULD-FIX (test integrity, verified by mutation). The test that pins the Director's ruling passes with the ruling deleted

**File:** `pmo-portal/pages/BudgetProjection.test.tsx:953-961`
(`states "budgeted in 2027" for a category whose lines are ALL phased to ANOTHER year`).
**Guards:** `pmo-portal/pages/BudgetProjection.tsx:443-451`, branch 1 at `:445`.

The fixture inherits `attributionKnown: true` from `NO_BUDGET_ROW` (`:938-943` ← `ROW:74`). For the state
it claims to model — every line phased elsewhere, the `(F, T)` cell — `0153:331-338` returns
`attribution_known = **false**` (`bool_or` false, `bool_and` true). **The RPC never produces the pairing
this fixture hands the page.** That is P3b/P3c lesson 6 (*a fake handed a state the shipped writers never
produce*) at the exact cell the Director's ruling exists to protect.

Consequence: because `attributionKnown` is `true`, branches 2 and 3 are skipped no matter where branch 1
sits, so the test cannot observe branch 1's **precedence** — the only property that matters about it.

**Reproduction (I ran this).** Move branch 1 below the two suppression branches:

```ts
if (row.attributionKnown === false && staleForSelectedYear) return BUDGET_ATTRIBUTION_STALE;
if (row.attributionKnown === false) return BUDGET_ATTRIBUTION_PARTIAL;
if (elsewhere.length > 0 && fullyPlacedElsewhere(row.category)) return budgetedInOtherYears(elsewhere);
```

`npx vitest run pages/BudgetProjection.test.tsx` → **84 passed (84)**. In production that mutation makes an
ordinary multi-FY project — Labor $100,000 phased `'2027'`, every line placed, FY2026 selected and on
record, $30,000 of FY2026 GL — read *"some of this category's budget lines are not phased to a fiscal
year … Phase these lines to their fiscal years"* about a budget that is **fully phased**, and it names a
remedy the operator cannot perform. That is the round-3 defect in mirror image, and nothing in verify,
pgTAP (which explicitly delegates the sentence to this file, `bfy_attribution_partial.test.sql:143-145`),
deno or e2e sees it.

**Smallest fix — one line, test-only.** In that test, make the fixture the state the RPC actually emits:

```ts
fetchMock.mockResolvedValue([{ ...NO_BUDGET_ROW, attributionKnown: false }]);
categoryYearsMock.mockResolvedValue(phasing({ Labor: ['2027'] })); // every line placed — the claim holds
```

**Verified in both directions:** with that line added, the suite is **84/84 green on the shipped
implementation**, and **1 failed / 83 passed** under the precedence mutation above. No production code
changes; no re-review needed for it.

**Why this is SHIP and not NO SHIP.** No money figure and no sentence is wrong in the shipped build. I
constructed the `(F,T)`, `(T,F)`, `(F,F)`, `(T,T)`, no-lines, not-on-record and stale states and the
shipped ladder is right in all of them. What is missing is the *guard*, and the guard costs one line.

---

## FINDING 2 — MINOR. The fail-open guard's own precondition can be silently violated by PostgREST truncation

**File:** `pmo-portal/src/lib/repositories/budgetProjection.ts:224-231` — the phasing read has **no
`limit`/`range`**. `supabase/config.toml:18` sets `max_rows = 1000`, and PostgREST truncates **silently**
with no error and no defined row order.

**Reproduction (by construction).** An Active version with >1000 `budget_line_items` where the un-phased
line falls outside the returned window: `phasing.unphased['Labor']` is never set →
`fullyPlacedElsewhere('Labor')` returns `true` (`BudgetProjection.tsx:417-418`) → branch 1 fires and
states *"budgeted in 2027 … a timing difference, not an overspend"* about a category holding money PMO can
place in no year. That is exactly the claim `c3c029f4` removed, resurrected by truncation. The RPC is
unaffected (it aggregates server-side), so the **numbers stay correct and NULL** — only the sentence lies.

Likelihood is low (1000 line items on one version is a large-EPC shape, not the ordinary one), which is why
this is MINOR — but the failure *direction* is toward the false claim, and the guard was written to fail
the other way.

**Smallest fix** — reuse the fail-open path that already exists and is already tested:

```ts
const LIMIT = 1000; // PostgREST db-max-rows; a truncated read cannot answer "is anything un-phased?"
… .limit(LIMIT);
if ((data ?? []).length >= LIMIT) return { years: {}, unphased: undefined as never }; // fact unknown ⇒ no claim
```

(or, better long-term, return the reason as an enum from `get_budget_projection` and delete this second
query from the money-explanation path — round 3's cross-family note 3.)

---

## FINDING 3 — MINOR. A transient false sentence in the phasing query's loading window

`BudgetProjection.tsx:375-394` gates the page on `yearsQuery` + the projection query only.
`categoryPhasingQuery` is not in that gate, so there is a real render window where the grid is painted and
`categoryPhasing` is still `undefined`. In that window an all-phased-elsewhere category (`attributionKnown
= false`, `elsewhere` not yet known) falls to `BUDGET_ATTRIBUTION_PARTIAL` — *"some of this category's
budget lines are not phased to a fiscal year"* — which is **affirmatively false**, then flips to
"budgeted in 2027" when the read lands. Money is NULL throughout, and the text lives in `title`/`sr-only`,
so the blast radius is a tooltip and a screen-reader announcement.

Not a regression risk beyond that: the phasing read and `get_budget_projection` are both SECURITY INVOKER
under the same RLS, so a *persistent* divergence (phasing errors while the projection succeeds) is
effectively unreachable — the page's error state would already have fired.

**Smallest fix:** add `|| categoryPhasingQuery.isPending` to the loading gate at `:388`, or return a
neutral `NO_BUDGET_FOR_YEAR`/blank reason while `categoryPhasing === undefined`.

---

## What I attacked and found clean

**1. The four cells, replayed against the shipped SQL, not the prose.** `0153:319-338`, then
`BudgetProjection.tsx:443-451`:

| `bool_or` | `bool_and` | reachable state | shipped sentence | true? |
|---|---|---|---|---|
| T | T | lines land here, nothing un-placeable | *(no reason string — the amount is stated)* | ✓ |
| F | T | every line phased, none here | branch 1 "budgeted in FY-x … timing difference" | ✓ |
| T | F | a line here + an un-placeable sibling | STALE if the year drifted, else PARTIAL | ✓ |
| F | F | phased elsewhere **+** an un-placeable sibling | PARTIAL (branch 1 blocked by `unphased`) | ✓ |

`(T,F)` and `(F,F)` share PARTIAL and the copy (`:115-116`) is true of both: each genuinely holds ≥1
un-phased line, the total genuinely cannot be stated for this year, and "phase these lines" is genuinely
the remedy. `(F,F)` loses the *additional* true fact that $100,000 sits in 2027 — weaker, never false,
which is the correct trade under "say the strongest thing that is TRUE and no more".

**2. The reordering misses no stale explanation.** `stale_attribution` (`0153:634-640`) requires the
version to hold un-phased lines **and** a `pushed` row for that year whose span witness drifted. Any
category holding an un-phased line has `bool_and` false ⇒ `attribution_known` false, so the new
`row.attributionKnown === false &&` prefix cannot suppress it. A category with **no** un-phased line is
either fully attributable here (amount stated, no reason string) or all-phased-elsewhere (branch 1, which
outranks staleness and is the more specific truth). I could construct no drifted year that stopped saying
so. Where staleness *is* skipped because branch 1 won, branch 1's sentence is the stronger true one.

**3. The changed fixture (`attributionKnown: true → false`) is a correction, not a weakening.** I checked
the builder's reachability argument rather than accepting it. For the old pairing to render STALE you need
`budget = null` ∧ `attributionKnown = true` ∧ `stale`. `attribution_known` coalesces to `true` only for a
category with **no line on the Active version** (`0153:386-389`) — for which "phase these lines" names
lines that do not exist — or when `on_record` is false, which `stale` cannot co-occur with (staleness
requires a `pushed` row for the year, i.e. F-A, i.e. `on_record` true). The old pairing was unreachable
*and* its sentence was wrong. The new fixture (`attributionKnown: false`, `unphased: { Labor: true }`) is
what the RPC emits. Verified.

**4. The no-lines-on-a-drifted-project case is right.** A lineless category never enters the `pmo_budget`
CTE, coalesces to `attribution_known = true` (`0153:389`), skips both suppression branches and keeps its
`-EAC` (`0153:408`). It cannot be conflated with a suppressed category in either direction: suppressed
⇒ `attributionKnown === false` ⇒ the ladder can never reach `NO_BUDGET_LINE`, and the variance `case`
(`:405-409`) puts the F-D branch **before** the `-EAC` branch, so a suppressed category can never print
one. The new test kills the "staleness first" mutation (I ran it: 1 red).

**5. The other two mutations the commit message claims.** Both verified, exactly as claimed:
permissive guard (`categoryPhasing?.unphased?.[c] !== true`) → **1 red**; repository `continue` restored
(drop the un-phased fact) → **2 red** in `budgetProjection.test.ts`.

**6. SQL ↔ JS twin agreement, line by line.** `budgetProjection.ts:127-129` (amount withheld),
`:152` (`budgetUnknownForYear`), `:160-161` (utilization), `:170` (variance) match `0153:386-388`,
`:405-409`, `:412-414` branch for branch **and in the same precedence**, with EAC untouched by both guards
in both. `fetchBudgetProjection:151` (`row.attribution_known !== false`) and `fetchBudgetPushStatus:186`
(`=== true`) fail in opposite directions on purpose — open for suppression, closed for staleness — and
both directions are the safe one for their claim.

**7. Spec ↔ shipped agreement.** `budget-fiscal-year-phasing.spec.md:477-495` now carries the `bool_and`
conjunct verbatim as shipped, and the Director's ruling below it is scoped to the `(F,T)` cell with the
`(F,F)` cell called out explicitly. The spec no longer understates shipped behaviour on this path — the
mechanism by which the last two defects survived.

**8. The fan-out loop's `command` re-binding** (`adapter-dispatch/index.ts:1326-1350`), which round 3
flagged as the one thing it could not reason about locally. It is safe: the loop is sequential and fully
awaited, and each iteration replaces `record` **and** `idempotencyKey` wholesale with `unit`'s values,
which were built once from the *original* `command.record` at plan time (`:857-874`). No year-1 field can
survive into year-2's body, and the failure writers that close over `command` observe the year they are
writing about.

**9. Changed-code coverage, measured.** v8 over the changed FE modules
(`BudgetProjection.tsx`, `ProjectBudget.tsx`, `repositories/budgetProjection.ts`, `src/lib/budget/**`,
`fiscalYearEncoding.ts`, `budgetPushKey.ts`, `db/budgets.ts`): **93.93% lines / 87.33% branches**, 854
tests. Every file is ≥88% lines except `fiscalYearEncoding.ts` (79.41%), whose uncovered lines are
`fiscalYearOf`'s fail-open path — consumed only by `_shared/erpnextFeedDeps.ts` and covered by the deno
suite, which this run cannot see. Charter DoD (≥80% on changed code) met.

## NOTE — two of `bfy_attribution_partial.test.sql`'s five new assertions cannot fail

`:604-619` (`array_agg(... fiscal_year is not null)` = `['2027']`, and `exists(... fiscal_year is null)`
= `true`) query the base tables directly and re-assert the fixture. No implementation change can turn them
red; they document the datum the surface reads. That is fine and consistent with project B's existing
idiom — but `plan(16)` should not be read as 16 oracles, and the behaviour they gesture at is owned by
`BudgetProjection.test.tsx`, which is the file FINDING 1 shows was blind.

Carried, unchanged, from round 3 and still NOTEs: `fiscalYearOf`'s fail-open direction; `0154`'s fence not
covering `budget_version_erp_mirror`; the JS twin having no production consumer; the duplicate
`budget-fiscal-year-options` DOM id; the over-strict span witness on an open-ended project;
`hold_releasable`'s wider legacy-bare arm in the repository; and NOTE 4's structural point that the budget
fan-out has outgrown `adapter-dispatch/index.ts` (1362 lines) and `erpnext-sweep/index.ts` (1961). None
grew materially in `c3c029f4`/`53dd939e`.

---

## WHAT I COULD NOT VERIFY

- **I ran no SQL mutation.** FINDING 1 and the four-cell table are derived from reading `0153` and
  replaying it by hand; I did not execute pgTAP or mutate the RPC in a live database. If exactly one
  claim here deserves cross-family re-derivation, it is that `(F,T)` really is `attribution_known = false`
  in the running DB — everything in FINDING 1 rests on it. (`bfy_attribution_partial.test.sql:103-114`
  asserts it, and the gates are reported green, which is corroboration, not verification by me.)
- **The gates.** verify / pgTAP / deno / bench e2e were taken as reported per the brief. I ran only
  `pages/BudgetProjection.test.tsx`, `src/lib/repositories/budgetProjection.test.ts` and a scoped coverage
  pass.
- **Rendered UI.** Everything about the sentences is from source and from RTL `title` assertions. Nobody
  in four rounds has *looked* at this screen in the `(F,F)` state.
- **Live ERPNext semantics** (Desk cancel, `amended_from`, the recovery probe) — no bench, taken on faith.
- **`0154` deploy-time races** and the advisory-lock fence — not simulable in pgTAP, not simulated.
- **Whether FINDING 2's 1000-line version exists in any client's data.** I established the mechanism and
  the config value; I did not measure a real budget version's line count.

## CROSS-FAMILY BLIND SPOT

Rounds 2 and 3 named it as *anchoring on the prose*, then as *anchoring on the fix's own framing*. This
round it took a third shape: **I nearly accepted a passing test as evidence.** `c3c029f4`'s message lists
five mutations it ran and every one of them is real — I re-ran three and all three were red as claimed.
That precision is itself the trap: a mutation list proves the mutations it names are covered and says
nothing about the ones it does not name, and the *unnamed* one here was the precedence of the branch that
was **not** changed. I found it only by refusing to review the diff, and instead asking of the whole
`budgetReasonFor` function "for each branch, what is the smallest edit that breaks it, and does anything
go red?" — then running them. Reading would not have found it; the fixture reads correct.

A different family would more likely catch, in rough order of expected value:

1. **The remaining ladders nobody has truth-tabled.** I did `budgetReasonFor`, the variance `case`
   (`0153:405-409`) and the four `(bool_or, bool_and)` cells. `BLOCKED_STATES`/`QUIET_STATES`
   (`BudgetProjection.tsx:123-141`), `dispatchErrorStatus`, and `get_budget_push_status`'s `per_year`
   `coalesce` chain (`0153:627-643`) have not been enumerated by anyone in four rounds. The demonstrated
   class on this branch — *a new state added to a ladder whose earlier branches predate it* — has now
   produced a defect in two consecutive rounds.
2. **Every OTHER fixture that pairs an RPC output with a value the RPC cannot emit.** FINDING 1 is the
   second instance on this branch (the builder found and fixed the first, the stale test). A mechanical
   cross-check — for each mocked `BudgetProjectionCellRow`, is that `(pmoBudgetAmount, attributionKnown,
   projectedVariance)` triple producible by `0153`? — is cheap and I only did it for the six tests in the
   `NULL budget` describe block.
3. **The ERPNext-side semantics** (§ WHAT I COULD NOT VERIFY) — unchanged from round 3, still unverified
   by anyone without a bench.
4. **Whether a second query belongs on the money-explanation path at all.** I again accepted the
   two-read shape and only hardened it (FINDINGS 2 and 3 are both artefacts of it). A model with different
   priors would push to return the *reason* from `get_budget_projection` as an enum and delete
   `fetchActiveBudgetCategoryPhasing` from this path — which dissolves the loading window, the truncation
   risk, and the fail-open guard together.

Four rounds: 4 BLOCKER → 2 BLOCK → 1 SHOULD-FIX → 1 test-only SHOULD-FIX with no wrong money in the
shipped build. That is a program that has converged. Land the one-line fixture with the merge; re-review
cross-family only if the next change touches `budgetReasonFor` or `attribution_known` again.
