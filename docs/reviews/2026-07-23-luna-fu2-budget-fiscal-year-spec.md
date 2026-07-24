VERDICT: NO SHIP

# Luna adversarial money/security review

**Subject:** `docs/specs/budget-fiscal-year-phasing.spec.md`  
**Review mode:** read-only, source and shipped-path review; no implementation was assumed.

The existing controls are real and useful: `0149` projection reads are `SECURITY INVOKER`, `0005` has the Draft-only trigger and lifecycle authorization, `0137` has the correct mirror grain, and `0150` preserves snapshot-generation discipline. They do not close the findings below.

## Ranked findings

### 1. BLOCK — A failed gate row becomes a false budget attribution

**Reproduction.** Create a project spanning FY2026–FY2027 with a `$90,000` line phased to FY2026 and a `$50,000` NULL line. Run the push. The shipped failure writer in `supabase/functions/adapter-dispatch/index.ts:533-552` records a `failed` mirror row using `err.fiscalYear` (currently the start FY). The proposed SQL in spec §6.1/§6.2 tests only `exists (mirror row)`, not `push_state` or whether a valid plan entry existed. FY2026 therefore has `on_record=true` and the NULL branch includes the `$50,000`; FY2027 has no budget.

**Money impact.** PMO states `$140,000` against FY2026 although it has explicitly refused to allocate the NULL line. The same false scope feeds variance/utilization and can make FY2026 appear to have an ERP-enforced budget.

**Evidence.** Spec FR-BFY-010 requires a failed mirror row; the existing writer creates it. This contradicts AC-BFY-013/014's premise that a refused push has “no mirror row.”

**Smallest fix.** Separate “failure/status exists” from “budget attribution is known.” A pre-plan rejection must not authorize NULL-line attribution. Add an explicit attribution/plan-state field or equivalent predicate and test a real edge-function refusal; do not use bare mirror existence.

### 2. BLOCK — The stale-year fix still produces a false variance

**Reproduction.** Push an all-NULL single-FY budget of `$100,000` with a span witness, then extend the project into FY2. The proposed NULL branch correctly suppresses the budget row after witness drift, but `budget_year.on_record` remains true because the mirror exists. If the FY1 ledger has `$40,000` actuals, the existing/future SQL cell has `pmo_budget_amount=NULL` and `actuals_to_date=$40,000`; its `projected_variance` branch emits `-$40,000` whenever `on_record=true`.

**Money impact.** The screen says the spend is entirely unbudgeted, when the honest fact is that the budget attribution is unknown after drift. This is precisely the rejected “wrong and permissive in year 1” outcome in a different derived column. AC-BFY-019 checks the budget amount and reason, not variance/utilization.

**Evidence.** `0149_get_budget_projection.sql` uses `-EAC` when a year is on record but a category has no budget line; `budgetProjection.ts` mirrors that rule.

**Smallest fix.** Carry a separate `budget_attribution_known`/`category_budget_known` fact through the RPC and JS oracle. Use `-EAC` only for a genuinely known year with no line; return NULL for derived values when the line was suppressed because its attribution is stale or otherwise unknown.

### 3. BLOCK — The year-qualified identity is not end-to-end defined

**Reproduction.** The spec changes the key and `pmo_record_id`, but the shipped contracts still bind the identity to `command.record.id`:

- `pmo-portal/src/lib/db/budgets.ts:255-269` reads the activation stamp and dispatches `id=versionId` with the old `bud:<version>:<epoch>` key.
- `supabase/functions/adapter-dispatch/index.ts:722-745` rejects a missing key before the budget gate and validates the old deterministic shape.
- `pmo-portal/src/lib/adapterSeam/dispatch.ts:538-542` uses `command.record.id` as the outbox record ID.
- `readModelWriters.ts:836-857` uses `canonical.id` as the UUID `budget_version_id`.
- The sweep still searches bare IDs and derives the old key (`erpnext-sweep/index.ts:972-985, 1142-1144`).

Putting `v:FY2026` in `record.id` makes the gate query a non-UUID and the mirror FK invalid; leaving `record.id=v` makes the outbox/replay path use the bare identity and can pass the create guard after re-keying. Inbound budget feed code also treats the returned `external_refs.pmo_record_id` as a UUID: `erpnextFeedDeps.ts:72-104`; an ERP cancel for `v:FY2026` will error or match nothing instead of tombstoning the correct row.

**Money impact.** A retry can create a second ERP Budget or strand the original mapping; an ERP-side cancel can leave PMO reporting an active/pushed control.

**Additional identity hazard.** ERP Fiscal Year names are client data. A raw `<version>:<fiscal_year>` is ambiguous if a name contains `:`, and names such as `FY2026` do not fit the current `isOpaqueIdempotencyKey` deterministic-key regex. The current recovery probe is LIKE-escaped, but the new key shape is not specified as safely encoded or bounded.

**Smallest fix.** Define a typed budget command with separate bare `budget_version_id` and year-qualified outbox identity, or add an explicit outbox identity parameter to the generic dispatcher. Update foreground, sweep, replay, mirror writers, guards, external refs, feed, and authorization together. Canonically encode the year component and validate the final server-derived key at the served boundary. Add real served tests, not only a key helper test.

### 4. BLOCK — The identity migration has no in-flight fence and is not reversible after fan-out

**Reproduction.** Let old code have a budget request between gate/ERP commit and outbox finalization while the migration rewrites bare rows. Old code can still insert/finalize a bare `pmo_record_id` after the rewrite; new code resolves only `v:FY`, sees no mapping, and can pass `checkCreateTargetUnmapped`. A concurrent target row or an old outbox key that is not parseable as `bud:<version>:<epoch>` also has no defined migration path.

After a successful multi-FY push, rollback cannot meet NFR-BFY-REV-001: `external_refs` has two rows `v:FY1` and `v:FY2`, but both must become the single unique bare key `v`. The one-in-flight index has the same representational collision. Preserving both ERP names is impossible under the old identity.

**Money impact.** A deployment race can orphan an already-enforced ERP Budget and permit a duplicate create; rollback can lose one year’s ERP pointer.

**Evidence.** Spec §4 step 4 describes updates but no quiescence, advisory lock, migration fence, or old/new dual-write period. Its rollback claim explicitly rekeys all post-feature rows to a bare identity that cannot represent two years.

**Smallest fix.** Drain/disable budget dispatch and sweep while the migration runs, or add a database fence honored by both old and new code. Preflight malformed, orphaned, and already-year-qualified rows and fail the whole transaction with named conflicts. Limit rollback to pre-fan-out data and amend the reversibility claim, or retain a representation that can preserve per-year mappings.

### 5. BLOCK — The sweep can bypass the new fiscal-year gate

**Reproduction.** A per-year push reaches an outbox row and then fails. The current backstop checks only Active status and `activated_at` (`budgetBackstop.ts:108-116`); `buildReconcileDepsLive` reconstructs the frozen payload (`erpnext-sweep/index.ts:1642-1696`) and does not run `runBudgetGate`, read the current ERP Fiscal Year calendar, or validate the current project span. It then uses the old bare key path.

If project dates or the ERP calendar change before the sweep, the sweep can submit the frozen year/body that the foreground gate would now reject as out-of-span or unresolved. If the new mirror row has no outbox row, the current orphan/hold path also has no specified way to select the particular year.

**Money impact.** Recovery can install an ERP Budget for a year the project no longer occupies, or silently leave a failed year unenforced while reporting only a generic active-version state.

**Smallest fix.** Make the sweep call one shared server-side budget recovery gate, selecting the specific mirror/plan year and re-reading the same calendar, project, line, and map truth. Persist enough per-year plan data to recover an outbox orphan without guessing, while retaining replay actor authorization.

### 6. BLOCK — Partial failure is not represented by the status/retry surface

**Reproduction.** Let FY2026 push successfully and FY2027 fail. The spec requires two status rows, but the existing repository takes only the first RPC row (`src/lib/repositories/budgetProjection.ts:144-160`), and the page still queries a single `BudgetPushStatusRow` and offers project-level retry/release (`BudgetProjection.tsx:150-160, 259-287`; `budgets.ts:190-245`). The current SQL’s ordering would commonly select the pushed row because it has `pushed_at`, hiding the failed year. If the process dies before writing FY2027’s mirror, a mirror-row-only result omits FY2027 entirely.

**Money impact.** The operator can see “healthy” while one year has no overspend control, or retry/release the wrong year. A scalar `pushState` also cannot honestly report a fan-out that is partially complete.

**Evidence.** Spec §6.5 says per-year rows, but §8 does not enumerate the repository, page, hold RPC lookup, or retry API as changed consumers. `retryActiveBudgetPush(projectId)` and `releaseActiveBudgetPushHold(projectId)` have no fiscal-year argument.

**Smallest fix.** Derive the expected year set from the Active phased lines/plan and left-join mirror rows, returning explicit `never-pushed`/failed rows for absent years. Make the client status an array (an aggregate may be additional), and make retry/release take a validated fiscal year. Return per-year outcomes from activation.

### 7. BLOCK — A Desk-authored live Budget can still be overwritten

**Reproduction.** Create a submitted ERPNext Budget for the company/Fiscal Year/project directly in Desk, with no PMO `external_refs` mapping. `resolveBudgetRefs` in `dispatchFactory.ts:614-757` scans the grain, accepts the live document as `refs.self`, and the adapter’s `commitCreate` routes to cancel-and-amend (`adapter.ts:93-116`). This is not the safe draft-rival path: a submitted human document is amended with PMO’s body.

**Money impact.** PMO overwrites an accountant’s native budget and then records the resulting document as its push, violating PMO-SoT and potentially changing native overspend enforcement without PMO authorization.

**Evidence.** P3c’s never-adopt/never-fight-the-operator posture rejects Desk-authored content; the existing code refuses Desk drafts but does not prove ownership of a live grain occupant. The fiscal-year spec does not restate or test this invariant for every new year.

**Smallest fix.** Before using a live grain occupant as an amend target, require a PMO mapping/creation witness for that exact year. Otherwise fail closed with a named divergence/action-required state; never amend an unowned live Budget. Keep draft rivals zero-write as they are.

### 8. BLOCK — The category/account map has no fiscal-year history

**Reproduction.** For FY2026, map Labor to account A and load `$40,000` Labor actuals at A. Later change the org-global map to account B for FY2027. The current `budget_category_account_map` has only `(org, category)` and `(org, erp_account)` uniqueness (`0137:74-90`); `0149` joins actuals to the current map, not the map in force for the historical FY.

The FY2026 snapshot row at A no longer joins Labor. `reading.as_of` is nevertheless non-NULL, and `mapped` says Labor is mapped to B, so the projection’s `coalesce(a.actuals_to_date, 0)` reports `$0` instead of unknown. A pushed FY2026 Budget also remains allocated to A while PMO reads through B.

**Money impact.** At least `$40,000` of actual cost disappears from the historical year and variance/utilization become false.

**Smallest fix.** Make mappings effective-dated/per-Fiscal-Year or snapshot the category mapping with the actuals and push. If map changes are allowed without history, fail closed to NULL for historical actuals rather than coalescing to zero, and add a post-map-change multi-year test.

### 9. BLOCK — Push-time span witnesses are specified but not wired or proven

**Reproduction.** A successful post-migration push must stamp `pushed_project_start_date` and `pushed_project_end_date`. There is currently no writer for either column; the gate result only returns `projectId`, year, activation stamp, and line items (`budgetGate.ts:89-97`), and the dispatch rewrite at `index.ts:782-788` does not carry project dates. The existing mirror writer explicitly omits the analogous activation witness (`readModelWriters.ts:821-822`). AC-BFY-019 manually seeds a witness, so it cannot detect a successful push leaving it NULL.

**Money impact.** The real push has a NULL witness and receives the spec’s backward-compatibility exemption forever; extending the project later continues to attribute an all-NULL `$100,000` budget to the old year.

**Smallest fix.** Return the trusted project `date` values from the gate, carry them through a non-ERP/body command field, and write them on every successful/eligible mirror outcome. Use the database’s `date` type (or explicitly define UTC normalization); do not compare `timestamptz` to `date` implicitly. Add a served test that pushes, reads the mirror, changes dates, and checks the projection.

### 10. BLOCK — New RPC security modes are not acceptance-bound

**Reproduction.** Recreate `list_budget_fiscal_years` or `get_budget_push_status` as `SECURITY DEFINER` without an explicit `org_id`/project ownership check. An authenticated member of org A calls it with org B’s project UUID and receives B’s phased year labels, ERP Budget name, errors, or per-year enforcement state. AC-BFY-017 only tests direct line-item RLS; it does not bind these RPCs. The same mutation risk applies if a re-created lifecycle function drops the `0005` definer auth checks.

**Money impact.** This is primarily a tenant-isolation/security failure, but it exposes another client’s ERP budget/control metadata and can mislead operators; a definer write-path regression could become a cross-org money mutation.

**Evidence.** Current `0149` functions are `SECURITY INVOKER` with authenticated-only execution, while the spec says to drop/recreate them but does not require a security-mode/ACL/cross-org test for each changed function.

**Smallest fix.** Add pgTAP assertions for `prosecdef`, `proconfig/search_path`, ACLs, and cross-org reads for all three projection/status/year RPCs; retain the explicit authorization assertions on `clone_budget_version` and `activate_budget_version`.

### 11. HIGH / release-blocking — The AC mutation battery has material survivors

The spec claims every AC is mutation-checked, but several broken implementations survive its stated tests:

- AC-BFY-013/014 seed “no mirror after refusal,” while the shipped refusal writer creates a failed mirror; the dangerous failed-row predicate can remain wrong.
- AC-BFY-009 calls a pure key helper twice; the old client-minted foreground path and old sweep can remain unchanged.
- AC-BFY-010 duplicates the same `(pmo_record_id,key)`; removing the cross-record `external_command_outbox_key_single_use` index still passes. It also does not exercise `external_refs` or served replay.
- AC-BFY-015 compares two predicates that can both be changed to the same wrong predicate.
- AC-BFY-019 manually supplies the witness and does not test the mirror writer.
- No AC covers undated ERP actuals, historical map changes, arbitrary/colon-containing FY names, migration concurrency/rollback, live Desk ownership, sweep gate reuse, absent expected-year status rows, or fiscal-year-specific retry/release.

**Money impact.** A build can pass all named ACs while reporting a refused `$50,000` NULL line in FY1, showing `$0` for historical actuals, or hiding FY2’s failed ERP control.

**Smallest fix.** Add real served-boundary fault tests and DB tests for the above cases, with independent oracles (especially expected-year status and attribution-known state). Mutation-test the exact writer, sweep, RPC, and UI consumers rather than only pure helpers.

## WHAT I COULD NOT VERIFY

- No future migration or implementation exists in this worktree, so I could not run the proposed fan-out, real served partial-failure retry, or the final full verification suite.
- I did not inspect a live production/bench population to determine whether bare outbox/external-ref rows, orphan rows, non-standard idempotency keys, or pre-witness mirrors exist.
- I could not verify the client’s real ERP Fiscal Year naming grammar, whether names may contain delimiters/spaces, or whether administrators can change date ranges during a push.
- I did not run concurrent migration/edge-function traffic or a live Desk-authored Budget scenario.
- OQ-BFY-1, OQ-BFY-2, and OQ-BFY-3 remain owner decisions in a spec marked “DRAFT — awaiting owner sign-off”; the recommendations are not a signed contract.

The review is read-only; no production code, migration, or spec was changed.

LUNA-REVIEW-DONE
