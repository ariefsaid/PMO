VERDICT: NO SHIP

# Luna adversarial money/security review

**Subject:** `feat/budget-fiscal-year` (`origin/dev..HEAD`, 33 commits)  
**Authority:** `docs/reviews/2026-07-23-p3bc-audit-program.md`, `docs/specs/budget-fiscal-year-phasing.spec.md`, and `docs/plans/2026-07-23-budget-fiscal-year-phasing.md`  
**Review mode:** read-only; source, migration, shipped-path, tenancy, authorization, money-attribution, recovery, and test-effectiveness review. No implementation files were changed.

The branch fixes the earlier projection-attribution, server-derived identity, migration preflight, sweep-gate, ownership, span-witness, and RPC-security findings. The remaining defects below still cross the money identity and recovery boundaries and are release-blocking.

## Ranked findings

### 1. BLOCKER — Inbound budget feed loses the fiscal-year grain and mutates every mirror year

**Scenario.** A version has pushed FY2026 and FY2027. ERPNext emits an update, amend, or cancel for only the FY2027 Budget. `external_refs` resolves that ERP name to `'<version>:<encoded-FY2027>'`, but `mirrorLookupValue()` strips it to the bare version UUID. The subsequent mirror queries filter only `budget_version_id` and never `fiscal_year`.

**Evidence:**

- `supabase/functions/_shared/erpnextFeedDeps.ts:86-106` reduces the qualified identity to the bare FK.
- `supabase/functions/_shared/erpnextFeedDeps.ts:171-180` tombstones by bare `budget_version_id`; the update therefore affects all fiscal-year rows for the version.
- The same missing grain filter affects `readMirrorSourceMod`, `updateMirror`, and `stampAmended` (`:117-138`, `:199-238`, `:238-264`). With multiple rows, `maybeSingle()` can reject normal updates; cancel/amend paths can corrupt unrelated years.

**Impact.** Cancelling FY2027 can mark FY2026 `failed`/cancelled and set its `erp_cancelled_at`, excluding a still-live FY2026 control from the sweep. A normal multi-year feed event can fail to apply at all. PMO status and ERP enforcement then diverge by year.

**Required fix:** preserve `{versionId, fiscalYear}` when parsing the identity and add the exact fiscal-year predicate to every budget mirror read/update/tombstone/amend query. Add a two-mirror update and cancel test through `applyErpFeedEvent`, not only a one-row filter assertion.

**Test gap:** `erpnextFeedDeps.test.ts:788-810` asserts only that the bare UUID is used; its fake has one mirror row and cannot detect all-year mutation. The current `AC-BUD-041` test also supplies no fiscal-year multiplicity.

### 2. BLOCKER — Retrying a confirmed outbox row resurrects a Desk-cancelled ERP Budget

**Scenario.** A PMO Budget is pushed and its outbox row becomes `confirmed`. An accountant cancels the ERP document. The inbound path sets the mirror to `failed` and stamps `erp_cancelled_at`, but does not invalidate or transition the confirmed outbox row. The Budget page offers Retry for the resulting failed row (a null `push_error` is retryable). The retry derives the same activation-based key and reads the confirmed row.

**Evidence:**

- `supabase/functions/_shared/erpnextFeedDeps.ts:171-192` tombstones the mirror only; `cancelStatusPatch()` at `:487-499` changes `push_state` but does not change the outbox state.
- `pmo-portal/src/lib/adapterSeam/dispatch.ts:451-473` handles `confirmed` by calling `convergeReadModel()` with the stored canonical record; it does not re-probe ERP.
- `supabase/functions/adapter-dispatch/readModelWriters.ts:848-871` writes `push_state='pushed'` and unconditionally clears `erp_cancelled_at`.
- `pmo-portal/src/lib/db/budgets.ts:260-290` accepts a retry and reuses the same deterministic key; `pushErrorCopy.ts:190-220` treats an absent error as retryable.

**Impact.** PMO can report that ERPNext is enforcing a live budget while the ERP document remains cancelled. This directly defeats FR-BUD-142 (“never fight the operator”) and makes a failed status an unsafe false success.

**Required fix:** make a Desk cancel invalidate/retire the corresponding confirmed outbox intent, or make retry verify/recreate the cancelled ERP document under a new server-derived command identity. A confirmed replay must not clear a cancellation without a fresh ERP-side success. Add a served test: push → cancel in ERP → feed → retry → assert ERP docstatus and PMO mirror remain honest.

### 3. BLOCKER — The sweep drops an outbox-only orphan for a second fiscal year

**Scenario.** FY2026 has a mirror row. FY2027 reaches ERP or an outbox `committed` state, then crashes before `external_refs`/mirror finalization. The budget domain is intentionally skipped by pass 1, so pass 5 must find the FY2027 outbox orphan.

**Evidence:** `supabase/functions/erpnext-sweep/index.ts:1127-1171` builds `known` as `new Set(mirrored.map((r) => r.budget_version_id))` (`:1153`) and filters orphan candidates by version only (`:1158-1159`). The FY2027 candidate is discarded solely because FY2026 already has a mirror.

**Impact.** The orphan has no per-year mapping or mirror and is never reconciled/held. If ERP committed, PMO can report a missing/never-pushed year while an ERP Budget exists; if ERP did not commit, the intended control is never installed. This is exactly the multi-FY recovery case the orphan backstop was added to cover.

**Required fix:** deduplicate by `(budget_version_id, fiscal_year)`; only suppress an orphan when that exact year has a mirror. Add a multi-year test with one mirrored year and one outbox-only qualified identity.

**Test gap:** `budgetOutboxOrphan.test.ts:89-97` explicitly codifies the incorrect version-level invariant (“a version that already has a mirror row is never double-queued”). Existing orphan tests cover only one year.

### 4. BLOCKER — Migration 0154 fences outbox INSERT but not old-code finalization

**Scenario.** An old deployment inserts a bare budget outbox row before migration, commits that insert, and remains in flight. Migration 0154 rekeys the outbox row to the qualified identity. The old process then completes its ERP call and invokes `record_outbox_ref` using its old bare `p_pmo_record_id`.

**Evidence:**

- The only write fence is the budget `BEFORE INSERT` trigger in `supabase/migrations/0154_budget_identity_year_qualified.sql:271-296`.
- `supabase/migrations/0096_erpnext_seam_tables.sql:210-230` locks and validates the outbox generation/state but inserts `external_refs` using caller-supplied `p_pmo_record_id`; it never checks or derives `v.pmo_record_id` from the locked outbox row.
- Therefore the old finalizer can write a bare `external_refs` row after the migration has completed. The qualified mapping can be absent, allowing the new identity lookup/guard to reason from incomplete state.

**Impact.** A deployment race can leave stale bare mappings after the re-key, orphan a committed ERP Budget from the new identity, and permit a later duplicate/recovery path to make the wrong decision. The migration comments claim this in-flight window is fenced, but the shipped fence does not cover it.

**Required fix:** make `record_outbox_ref` derive and validate domain/identity from the locked outbox row, or acquire the same shared re-key lock for external-ref finalization; retain deploy-time quiescence. Add a two-session migration/finalizer test, including an outbox row inserted before the migration and finalized after it.

### 5. HIGH — The fiscal-year retry argument is display-only; the server retries the whole fan-out

`retryBudgetPush(versionId, fiscalYear)` accepts a year, but `pmo-portal/src/lib/db/budgets.ts:278-280` calls `dispatchBudgetPush(versionId)` without it. The served handler then derives every plan year and loops over every unit at `supabase/functions/adapter-dispatch/index.ts:1305-1325`. The selected year is used only by `pushStateForYear()` to interpret the response.

This violates FR-BFY-056 and lets a retry of FY2027 re-drive another failed/pending year. A confirmed year often converges without a new ERP write, so this is not itself proof of duplication, but it is not the required per-year operation and becomes unsafe when another year is still recoverable or has a changed blocker.

**Required fix:** make the server accept a validated fiscal-year target and derive/dispatch only that plan entry; retain a separate explicit whole-fan-out operation for activation. Add a served oracle that records every attempted identity and asserts a FY2027 retry never invokes FY2026.

**Test gap:** the repository test checks only that the mock receives the fiscal-year argument; AC-BFY-012 calls the raw whole-version dispatch and AC-BFY-026 does not assert served dispatch scope.

### 6. MEDIUM — Held-budget release lookup omits the domain boundary

`pmo-portal/src/lib/repositories/budgetProjection.ts:280-295` selects a held outbox row by `pmo_record_id` and state but never adds `.eq('domain', 'budget')`. The called `release_outbox_hold` RPC is deliberately domain-general (`supabase/migrations/0137_budget_push_seam.sql:198-244`) and also receives no expected domain. A held non-budget row with a colliding PMO identity can be released by the budget UI.

This is a cross-domain identity violation. It is unlikely with random UUIDs but is avoidable and conflicts with the repository’s claim that the button releases only the selected budget-year command.

**Required fix:** filter by `domain='budget'` and, preferably, pass/verify the expected domain in the release RPC. Add a test fixture containing a colliding held non-budget row.

## Coverage and verification gaps

- The required AC-BFY-029 sentinel, `supabase/tests/bfy_map_edit_reinterprets_history.test.sql`, is absent. Only `supabase/tests/budget_category_account_map_rls.test.sql` and `supabase/tests/bfy_unmapped_category_null.test.sql` cover adjacent map behavior; the specified historical map-edit behavior is unproven.
- No test covers a multi-year inbound budget update/cancel/amend, confirmed-outbox replay after a Desk cancel, or a two-session old-finalizer/migration race.
- The current orphan test suite contains a passing assertion for the defective version-only deduplication.
- The served Playwright lane could not complete: authentication setup hung on the login page. No zero-skipped, live ERP evidence was obtained for AC-BFY-011, AC-BFY-012, AC-BFY-026, or AC-BFY-031. The specs skip when the served lane is not configured locally; CI has an environment guard, but a local green summary is not evidence that these journeys ran.

## Verification performed

**Passed:**

- `cd pmo-portal && npm run verify:locked` — passed in the review environment (typecheck, lint, Vitest, build, and the configured edge-function gate).
- `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — BFY pgTAP and the full pgTAP suite passed.
- `deno test --allow-all supabase/functions/_shared/erpnextFeedDeps.test.ts supabase/functions/erpnext-sweep/budgetOutboxOrphan.test.ts --config supabase/functions/erpnext-sweep/deno.json` — **47 passed, 0 failed**; these passing tests are specifically insufficient for findings 1–3.
- `bash scripts/deno-typecheck-edge-fns.sh` — passed through the same discovery script used by CI/local verification.

**Not verified:**

- The live served ERPNext/Playwright journeys, due to the authentication hang noted above.
- Concurrent migration/finalizer behavior and malformed legacy populations in a live deployment. pgTAP cannot prove deploy-time quiescence or an old process running after migration.

The branch remains **NO SHIP** until findings 1–4 are fixed and independently tested; finding 5 and the release-scope finding must also be resolved before claiming conformance to the signed BFY plan. Review was read-only; no implementation files were modified.

LUNA-REVIEW-DONE
