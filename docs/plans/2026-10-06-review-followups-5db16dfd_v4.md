# Plan — #874 review follow-ups

## Scope and design

This is a test-hardening and documentation-correction slice across three already-shipped surfaces. It adds no UI, routes, tables, client contracts, or production behavior. The credential lifecycle is already correct in migration 0259; this issue adds a lifecycle proof that prevents its later regression.

### Decisions

1. **Keep the shipped record-history diff.** `record_change_capture()` may build `to_jsonb(OLD)` / `to_jsonb(NEW)` in memory after the exact no-op return; it writes only classified captured/flag values. The spec will say that, rather than claiming there is no whole-row comparison. Record this as `DD-CHG-1` in `docs/decisions.md`.
2. **Pin each `record_changes_select` gate independently.** In a transaction-only pgTAP fixture, add permissive source-table SELECT policies: one allows the org-B user to see org-A's source row (proving the history table's own `org_id = auth_org_id()` clause), and one allows the disabled same-org member to see the source row (proving the history table's own `is_active_member()` clause). The tests must continue to see zero history rows.
3. **Loader attribution is transaction-local only.** Future service-role loaders set an actor with `set_config('app.actor_id', '<uuid>', true)` in the same transaction as the business write. They must never use a session-level setting, and the trigger consults it only when `auth.uid()` is null.
4. **Do not change the reconnect implementation.** For a first-connect attempt, the first staged ref is the binding's current `secret_ref`; a later stage records it in `config.prev_binding`, and the already-shipped successful finalizer deletes that prior ref after its ownership commit. Add a pgTAP lifecycle proof only; no migration is needed.
5. **No scan optimization in this ticket.** The policy invokes source-RLS visibility per candidate history row. Document a required `EXPLAIN (ANALYZE, BUFFERS)` review using production-shaped history data when the History tab/read query is built; do not prematurely add an index or change authorization semantics here.

## Files to touch

- `supabase/tests/record_changes_visibility.test.sql`
- `supabase/tests/0259_connect_rotate_compensation.test.sql`
- `supabase/functions/_shared/erpAuthPair.test.ts`
- `docs/specs/record-change-history.spec.md`
- `docs/plans/2026-10-06-record-change-history-data.md`
- `docs/decisions.md`

No migration is required, so migration slot `0262` remains unused. No changes are required to `scripts/isolation-probe-denominator.json`, package manifests, or lockfiles.

## AC traceability

| Acceptance criterion | Owning proof after this work |
|---|---|
| AC-CHG-007 | `supabase/tests/record_changes_visibility.test.sql` — independent own-org policy predicate proof |
| AC-CHG-008 | `supabase/tests/record_changes_visibility.test.sql` — independent active-member policy predicate proof |
| AC-EAC-006 / AC-653-3 | `supabase/tests/0259_connect_rotate_compensation.test.sql` — successful later rotate revokes an abandoned attempt credential |
| AC-653-5 / NFR-EAC-SEC-002 | `supabase/tests/0259_connect_rotate_compensation.test.sql` — direct PostgreSQL caller is rejected by the body-level service-role guard |
| AC-ENA-082 / NFR-ENA-SEC-005 | `supabase/functions/_shared/erpAuthPair.test.ts` — Vault-read store-error log contains only the stable code, not an error message, binding reference, environment coordinate, or credential value |

## Implementation tasks

### 1. RED — independently pin the record-history policy clauses

**Files:** `supabase/tests/record_changes_visibility.test.sql`

**ACs:** AC-CHG-007, AC-CHG-008.

1. Change `plan(14)` to `plan(18)`.
2. After the existing disabled-member assertions and before the narrower-source-policy section, `reset role` and create exactly one temporary permissive source policy:

   ```sql
   create policy chg_test_project_source_permissive on public.projects
     for select to authenticated using (true);
   ```

3. As the org-B authenticated JWT, first assert the fixture project itself returns one row from `projects`, then assert its `record_changes` project rows return zero. Tag both assertions `AC-CHG-007`; the control proves source RLS permits the row and the denial pins only `record_changes_select`'s `org_id = public.auth_org_id()` conjunct.
4. As the disabled org-A authenticated JWT, first assert the same source project returns one row from `projects`, then assert its `record_changes` project rows return zero. Tag both assertions `AC-CHG-008`; the control proves source RLS permits the row and the denial pins only `public.is_active_member()` on `record_changes_select`.
5. `reset role` and drop `chg_test_project_source_permissive` before the existing restrictive-company-policy fixture. Retain every existing cross-org, disabled, narrower-source-policy, and hard-delete assertion unchanged.

**RED/binding proof before any implementation:**

```bash
scripts/with-db-lock.sh supabase test db supabase/tests/record_changes_visibility.test.sql

node scripts/check-isolation-denominator.mjs
```

On a scratch copy, temporarily remove only `org_id = public.auth_org_id()` from `record_changes_select`: the new org-B assertion must fail. Restore it, then temporarily remove only `public.is_active_member()`: the new disabled-member assertion must fail. Restore it and rerun green. These are regression tests for already-shipped behavior, so the mandated RED step is the clause mutation rather than a production implementation change.

### 2. Regression proof — reconnect cleanup and the body-level service-role guard

**File:** `supabase/tests/0259_connect_rotate_compensation.test.sql`

**ACs:** AC-EAC-006 / AC-653-3; AC-653-5 / NFR-EAC-SEC-002.

1. Increase the pgTAP plan from 41 by the exact number of new assertions.
2. After a point where the fixture has no binding for its `(org, clickup)` pair, add the requested first-connect lifecycle: stage `a259_abandoned_1` and intentionally do not finalize it; stage `a259_abandoned_2`; assert `config.prev_binding.secret_ref` is `a259_abandoned_1`; successfully finalize the second attempt. Assert the first secret is gone from Vault, the binding references the second secret, and `prev_binding` is absent. Delete the temporary second binding/secret before the existing disconnected-binding fixture inserts its own row. The fixture secret values remain synthetic and are never logged.
3. Add a direct-call proof: `reset role` to the grant-bypassing test-runner session and call `finalize_external_connect` with structurally valid fixture IDs. Assert SQLSTATE `42501` and the service-role-required message. This pins the in-body guard independently of the function-ACL assertions.
4. Keep the existing tests for ordinary successful rotation, failed finalize, explicit cleanup, disconnected binding restoration, and caller ACLs. Do not weaken their exact-prior-state comparisons.

**Binding proof:** both additions are regression tests for behavior already shipped in 0259. Temporarily remove the successful-finalize `delete_vault_secret(v_prev->>'secret_ref')` call: the first-connect abandoned-stage assertion must fail. Separately remove the first `service_role` body check in `finalize_external_connect`: the direct-call assertion must fail. Restore both and rerun green.

### 3. RED — independently pin code-only ERPNext store-error logging

**File:** `supabase/functions/_shared/erpAuthPair.test.ts`

**ACs:** AC-ENA-082; NFR-ENA-SEC-005.

1. Add a test titled `NFR-ENA-SEC-005: a Vault-read store error logs its code only` beside the existing env-pair-miss log test.
2. Use its existing `fakeDb` seam with a binding plus a Vault-read error containing a stable error code and a unique synthetic payload sentinel. Capture and restore `console.error`, then invoke the shipped `resolveErpAuthPair` imported from `./erpAuthPair.ts`; do not copy resolver code and do not move this proof into the edge handler suite.
3. Assert `resolveErpAuthPair` rejects with `AppError.code === 'config-rejected'`; one captured resolver log includes only the fixed `read_vault_secret failed` label and the stable code; the captured log contains neither the payload sentinel, the binding `secret_ref`, an environment-coordinate sentinel, nor a credential-value sentinel. The existing `erpnext-onboard/onboard.test.ts` keeps its handler-bound AC-ENA-091 fail-closed/no-ERP-call proof unchanged.

**RED/binding proof:** mutate `_shared/erpAuthPair.ts`'s Vault-read error branch to log the full RPC error (or `error.message`) instead of `error.code`; this new shared-resolver test must fail. Restore the code-only log and run green. The expected production behavior already exists; this mutation is the TDD proof that the new oracle binds it.

**Verify:**

```bash
cd supabase/functions/erpnext-sweep && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read
cd ../erpnext-onboard && deno test --config deno.json --allow-env --allow-net --allow-read onboard.test.ts
```

### 4. Amend record-history documentation to match shipped behavior

**Files:** `docs/specs/record-change-history.spec.md`, `docs/plans/2026-10-06-record-change-history-data.md`, `docs/decisions.md`

**Traceability:** documents AC-CHG-005, AC-CHG-007, AC-CHG-008 and NFR-CHG-005; no product behavior changes.

1. In spec D1, FR-CHG-005, and NFR-CHG-007, state the future-loader contract verbatim: a service-role loader that knows the human actor uses `select set_config('app.actor_id', <uuid>::text, true)` in the same business-write transaction; `true` is mandatory; session-scoped `SET` or `set_config(..., false)` is forbidden; the trigger reads it only when `auth.uid() IS NULL`; missing/empty is System (`NULL`).
2. Replace NFR-CHG-005’s inaccurate “not a whole-row compare / never serialized” wording with the shipped approach: exact no-op returns before JSON materialization; changed rows build whole-row JSONB in memory and loop only the registry’s captured/flag lists; `record_changes.changes` persists only classified output, with flags as `{"changed":true}` and omissions absent.
3. In D4, clarify `anon` and `authenticated` are the client roles denied DML, while `service_role` retains platform-default table writes to `record_changes` exactly as it does for `audit_events`. Correct denominator wording: add `record_changes` and `record_history_config`, but no function entry—`record_change_capture()` returns `trigger`, while `record_history_visible()` and `list_record_history()` are caller-run security-invoker functions. Apply the same correction to NFR-CHG-009, which currently overstates denominator coverage.
4. Change migration and rollback references from `0219` to shipped `0260` paths and correct the function count from two to three: capture, visibility, and list API.
5. Expand the AC-CHG-007/008 owning-test wording in the spec to name the independent own-org and active-member clause proofs; do not create new AC IDs.
6. In the data-layer plan decision 2, replace the broad `zz_` claim with the precise rule: the `zz_` suffix orders after triggers sharing the `<table>_` prefix; it makes no claim about unrelated trigger names. In decision 8, mirror the explicit `set_config(..., true)` future-loader contract. In the AC traceability/T3 text, name the two independent policy-clause cases.
7. Update the historical results in that plan from 105 to 109 assertions and mutation M1's `record_changes_visibility` red count from 6 to 8; these additions extend the shipped result record.
8. Add an explicit D3 History-tab handoff risk: before D5 ships, capture `EXPLAIN (ANALYZE, BUFFERS)` for representative own-record and project-with-children `list_record_history` calls, including audit-union volume, then reassess scan cost/indexes. The data-layer test suite proves semantics, not rendered-History scan cost.
9. Add `DD-CHG-1` to `docs/decisions.md` as directed: the shipped in-memory whole-row JSONB comparison is accepted because only classified changes persist, and the History-tab issue owns the production-shaped read-plan review.

**Verify:**

```bash
grep -nE 'set_config|transaction-local|0260|caller-run|service_role|EXPLAIN' docs/specs/record-change-history.spec.md docs/plans/2026-10-06-record-change-history-data.md docs/decisions.md
```

### 5. Run scoped database, edge-function, and local final gates

**Files:** all files above.

1. Run both changed pgTAP suites under one DB-lock hold while serializing the shared database (no reset: this issue changes no migration):

```bash
scripts/with-db-lock.sh bash -c 'supabase test db supabase/tests/record_changes_visibility.test.sql && supabase test db supabase/tests/0259_connect_rotate_compensation.test.sql'
node scripts/check-isolation-denominator.mjs
```

2. Run the changed edge-function suite and its function check:

```bash
cd supabase/functions/erpnext-sweep && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read
cd ../erpnext-onboard && deno check index.ts && deno test --config deno.json --allow-env --allow-net --allow-read onboard.test.ts
```

3. Run the mandatory local application gate without regenerating `package-lock.json`:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
cd pmo-portal && npx eslint --max-warnings=0 ../supabase/functions/_shared/erpAuthPair.test.ts
```

4. In the PR description, record the five mutation exercises and outcomes: record-history own-org clause removed, record-history active-member clause removed, successful-finalize prior-ref deletion removed, finalize body service-role check removed, and store-error log changed to include the RPC message. Record each test command and restored-green result. Do not include secrets, fixture emails, or raw error messages.

## Review focus

- Security reviewer: verify the existing 0259 finalizer remains service-role-only and actor-authorized, and the new lifecycle proof neither exposes credentials nor weakens compensation.
- Code-quality reviewer: verify the new pgTAP setup leaves subsequent fixture phases isolated and retains the existing exact-prior-state assertions.
- Spec reviewer: verify every requested stale-text correction is made, including the narrow trigger-order wording and the deferred History read-plan review.
