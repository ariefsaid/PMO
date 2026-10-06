# Plan — #874 review follow-ups

## Scope and design

This is a test-hardening and documentation-correction slice across three already-shipped surfaces. It adds no UI, routes, tables, or client contracts. The one production change is a reversible update to the ClickUp reconnect compensation functions: an in-flight credential superseded by a second stage is tracked only on the binding until the second attempt reaches a terminal outcome, then revoked. This preserves the existing invariant that an unsuccessful reconnect restores the prior binding exactly.

### Decisions

1. **Keep the shipped record-history diff.** `record_change_capture()` may build `to_jsonb(OLD)` / `to_jsonb(NEW)` in memory after the exact no-op return; it writes only classified captured/flag values. The spec will say that, rather than claiming there is no whole-row comparison. Record this as `DD-CHG-1` in `docs/decisions.md`.
2. **Pin each `record_changes_select` gate independently.** In a transaction-only pgTAP fixture, add permissive source-table SELECT policies: one allows the org-B user to see org-A's source row (proving the history table's own `org_id = auth_org_id()` clause), and one allows the disabled same-org member to see the source row (proving the history table's own `is_active_member()` clause). The tests must continue to see zero history rows.
3. **Loader attribution is transaction-local only.** Future service-role loaders set an actor with `set_config('app.actor_id', '<uuid>', true)` in the same transaction as the business write. They must never use a session-level setting, and the trigger consults it only when `auth.uid()` is null.
4. **Bound reconnect orphan cleanup to the attempt state.** Migration `0262` will retain superseded, still-in-flight secret refs in `external_org_bindings.config.abandoned_secret_refs`. A successful second finalize revokes the prior active ref and every recorded abandoned ref, then removes both transient keys. Failed finalization/explicit cleanup revokes abandoned refs while restoring the exact prior binding and removing both keys. This is a small function-only migration: no new table, RLS policy, or client seam.
5. **No scan optimization in this ticket.** The policy invokes source-RLS visibility per candidate history row. Document a required `EXPLAIN (ANALYZE, BUFFERS)` review using production-shaped history data when the History tab/read query is built; do not prematurely add an index or change authorization semantics here.

## Files to touch

- `supabase/tests/record_changes_visibility.test.sql`
- `supabase/migrations/0262_connect_rotate_abandoned_secret_cleanup.sql`
- `supabase/migrations/rollback/0262_connect_rotate_abandoned_secret_cleanup_down.sql`
- `supabase/tests/0259_connect_rotate_compensation.test.sql`
- `supabase/functions/erpnext-onboard/onboard.test.ts`
- `docs/specs/record-change-history.spec.md`
- `docs/plans/2026-10-06-record-change-history-data.md`
- `docs/decisions.md`

No changes are required to `scripts/isolation-probe-denominator.json`: migration `0262` creates no table, non-trigger public security-definer function, bucket, or edge-function directory. No package manifest or lockfile changes are permitted.

## AC traceability

| Acceptance criterion | Owning proof after this work |
|---|---|
| AC-CHG-007 | `supabase/tests/record_changes_visibility.test.sql` — independent own-org policy predicate proof |
| AC-CHG-008 | `supabase/tests/record_changes_visibility.test.sql` — independent active-member policy predicate proof |
| AC-EAC-006 / AC-653-3 | `supabase/tests/0259_connect_rotate_compensation.test.sql` — successful later rotate revokes an abandoned attempt credential |
| AC-653-5 / NFR-EAC-SEC-002 | `supabase/tests/0259_connect_rotate_compensation.test.sql` — direct PostgreSQL caller is rejected by the body-level service-role guard |
| AC-ENA-091 | `supabase/functions/erpnext-onboard/onboard.test.ts` — unreadable-store structured log contains only the stable code, not an error message or credential value |

## Implementation tasks

### 1. RED — independently pin the record-history policy clauses

**Files:** `supabase/tests/record_changes_visibility.test.sql`

**ACs:** AC-CHG-007, AC-CHG-008.

1. Change `plan(14)` to `plan(16)`.
2. Before the existing cross-org assertion, reset to the owner role and create a transaction-local, permissive `FOR SELECT TO authenticated USING (true)` policy on `public.projects`; then restore the org-B authenticated JWT and assert that its `chg_seen` total remains zero. Drop this policy before continuing. This makes the source-table visibility arm deliberately true for the foreign row, leaving `record_changes_select`'s own `org_id = public.auth_org_id()` as the only gate under test.
3. Before the existing disabled-member assertion, reset role and create a transaction-local, permissive project policy `FOR SELECT TO authenticated USING (org_id = public.auth_org_id())`; restore the disabled org-A JWT and assert that its `chg_seen` total remains zero. Drop this policy afterwards. This makes the source-table visibility arm true for the disabled caller, leaving `public.is_active_member()` on `record_changes_select` as the only gate under test.
4. Use explicit AC-tagged assertion descriptions saying “own org clause” and “active member clause”; retain all existing cross-org, disabled, narrower-source-policy, and hard-delete assertions unchanged.

**RED/binding proof before any implementation:**

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/record_changes_visibility.test.sql'
```

On a scratch copy, temporarily remove only `org_id = public.auth_org_id()` from `record_changes_select`: the new org-B assertion must fail. Restore it, then temporarily remove only `public.is_active_member()`: the new disabled-member assertion must fail. Restore it and rerun green. These are regression tests for already-shipped behavior, so the mandated RED step is the clause mutation rather than a production implementation change.

### 2. GREEN — add the bounded abandoned-secret cleanup migration and rollback

**Files:**
- `supabase/migrations/0262_connect_rotate_abandoned_secret_cleanup.sql`
- `supabase/migrations/rollback/0262_connect_rotate_abandoned_secret_cleanup_down.sql`

**ACs:** AC-EAC-006 / AC-653-3; AC-653-5 / NFR-EAC-SEC-002.

1. Create forward migration slot **0262 only**. Recreate (not overload) the three existing service-role-only functions with their exact current signatures and grants: `stage_vault_secret_for_org(uuid,text,text,text,uuid)`, `cleanup_external_connect_attempt(uuid,text,text,uuid)`, and `finalize_external_connect(uuid,text,text,boolean,boolean,uuid)`.
2. In `stage_vault_secret_for_org`, when replacing an already-staged active secret whose `config` already has `prev_binding`, append that currently bound secret ref to `config.abandoned_secret_refs` before repointing to the new secret. Preserve the original `prev_binding`; do not add the first attempt or a disconnected predecessor to the abandoned list.
3. In `finalize_external_connect(..., p_ready = true, ...)`, lock and read both `prev_binding` and `abandoned_secret_refs`. After the ownership commit, delete the prior active secret (the existing behavior) and each distinct abandoned ref that is neither the current `p_secret_ref` nor the prior ref. Clear both transient config keys atomically with the binding update.
4. In `cleanup_external_connect_attempt`, while holding the existing row lock, revoke every recorded abandoned ref, restore/delete the binding exactly as today, and remove both `prev_binding` and `abandoned_secret_refs`. Keep the caller’s existing responsibility for deleting the currently attempted `p_secret_ref`; `finalize(... p_ready = false ...)` still invokes cleanup then deletes that current attempt ref.
5. Preserve all current `current_setting('role', true) <> 'service_role'` body checks, actor checks, lock ordering, `log_audit` calls, ACL revokes/grants, and ClickUp-only tier validation. Extend the migration closing `DO` assertion to prove all three functions remain executable only by `service_role`.
6. The down migration must restore the exact `0259` definitions of these three functions (no `abandoned_secret_refs` handling), restore the same ACLs, and carry a header explaining that rollback loses only transient retry-cleanup behavior, not bindings or business rows.

**Verify after implementation:**

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0259_connect_rotate_compensation.test.sql'
```

### 3. RED then GREEN — prove reconnect cleanup and the body-level service-role guard

**File:** `supabase/tests/0259_connect_rotate_compensation.test.sql`

**ACs:** AC-EAC-006 / AC-653-3; AC-653-5 / NFR-EAC-SEC-002.

1. Increase the pgTAP plan from 41 by the exact number of new assertions.
2. Add an active-binding sequence separate from the existing failed-cleanup sequence: stage `a259_abandoned_1`, stage `a259_abandoned_2` before finalizing the first, then successfully finalize the second. Assert (a) the config records the first staged ref while the second is in flight, (b) success removes the first staged ref from Vault, (c) success removes the prior active ref, (d) the second/current ref remains, and (e) neither transient config key remains. The fixture secret values remain synthetic and are never logged.
3. Add a direct-call proof: after staging a valid attempt, `reset role` and call `finalize_external_connect` with the real fixture actor and ready inputs. Assert SQLSTATE `42501` and the service-role-required message. Then use `service_role` to clean the staged fixture state so later assertions remain isolated. This pins the in-body guard independently of EXECUTE grant denial.
4. Keep the existing tests for failed finalize, explicit cleanup, disconnected binding restoration, and caller ACLs. Do not weaken their exact-prior-state comparisons; the new migration must make those still pass.

**RED order:** write these assertions first; the abandoned-secret successful-finalize assertions fail on `0260` because the first staged ref is untracked and survives. Add migration `0262` only after that failure is observed.

**Mutation proof:** on the migrated scratch database, remove the loop that deletes `abandoned_secret_refs` during successful finalize; the abandoned-ref assertion must fail. Separately remove the first `service_role` body check in `finalize_external_connect`; the direct-call assertion must fail. Restore both and rerun green.

### 4. RED — make the ERPNext unreadable-store log oracle code-only

**File:** `supabase/functions/erpnext-onboard/onboard.test.ts`

**AC:** AC-ENA-091.

1. Extend `withWorld` so a test can capture and restore `console.error` alongside the existing fetch, environment, and interval restoration.
2. In the existing unreadable-Vault-store scenario, make the mocked RPC return an error with a stable code and a distinct human-readable message. Invoke the shipped `handleOnboardRequest` from `./index.ts` (do not copy resolver logic).
3. Assert the response remains `422 config-rejected`, no ERP request occurs, and the only captured resolver log has the fixed label plus the stable error code. Assert the serialized captured log contains neither the mocked human-readable store message nor the synthetic credential/env values.

**RED/binding proof:** the test should fail if `_shared/erpAuthPair.ts` logs the full RPC error/message instead of `error.code`. First mutate its vault-error branch to `console.error('read_vault_secret failed', error)` (or append `error.message`), observe this test red, restore the code-only log, and run green. The expected production behavior already exists; this mutation is the TDD proof that the new oracle binds it.

**Verify:**

```bash
cd supabase/functions/erpnext-onboard && deno test --config deno.json --allow-env --allow-net --allow-read onboard.test.ts
```

### 5. Amend record-history documentation to match shipped behavior

**Files:** `docs/specs/record-change-history.spec.md`, `docs/plans/2026-10-06-record-change-history-data.md`, `docs/decisions.md`

**Traceability:** documents AC-CHG-005, AC-CHG-007, AC-CHG-008 and NFR-CHG-005; no product behavior changes.

1. In spec D1, FR-CHG-005, and NFR-CHG-007, state the future-loader contract verbatim: use `select set_config('app.actor_id', '<actor uuid>', true)` in the business-write transaction; the third argument is transaction-local; use it only for a writer with no signed-in user; `auth.uid()` always wins when present.
2. Replace NFR-CHG-005’s inaccurate “not a whole-row compare / never serialized” wording with the shipped approach: exact no-op returns before JSON materialization; changed rows build whole-row JSONB in memory and loop only the registry’s captured/flag lists; `record_changes.changes` persists only classified output, with flags as `{"changed":true}` and omissions absent.
3. In D4, clarify `anon` and `authenticated` are the client roles denied DML, while `service_role` retains default write access to `record_changes` exactly as it does for `audit_events`. Correct denominator wording: the two tables are manifest entries; `record_change_capture` is a trigger function and `record_history_visible`/`list_record_history` are caller-run security-invoker functions, so no function entry belongs in the security-definer probe manifest.
4. Change migration and rollback references from `0219` to shipped `0260` paths. Do not describe a new migration in this section.
5. In the data-layer plan decision 2, replace the broad `zz_` claim with the precise rule: lexical name ordering only makes `<table>_zz_record_change` later than same-kind triggers that share that table-name prefix; it does not impose global ordering against arbitrary trigger names.
6. Add an explicit History-tab handoff risk: when the read path is introduced, capture `EXPLAIN (ANALYZE, BUFFERS)` for own and child-history queries at representative per-org cardinality and reassess the per-row source-RLS visibility scan before changing indexes or policy structure.
7. Add `DD-CHG-1` to `docs/decisions.md`: the shipped in-memory whole-row JSONB comparison is accepted because only classified changes persist, and the History-tab issue owns the production-shaped read-plan review.

**Verify:**

```bash
grep -nE 'set_config|transaction-local|0260|abandoned_secret_refs|caller-run|service_role|EXPLAIN' docs/specs/record-change-history.spec.md docs/plans/2026-10-06-record-change-history-data.md docs/decisions.md
```

### 6. Run scoped database, edge-function, and local final gates

**Files:** all files above.

1. Run the database reset and both changed pgTAP suites under one DB-lock hold so the migration and assertions use the same schema:

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/record_changes_visibility.test.sql && supabase test db supabase/tests/0259_connect_rotate_compensation.test.sql'
```

2. Run the changed edge-function suite and its function check:

```bash
cd supabase/functions/erpnext-onboard && deno check index.ts && deno test --config deno.json --allow-env --allow-net --allow-read onboard.test.ts
```

3. Run the mandatory local application gate without regenerating `package-lock.json`:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
cd pmo-portal && npx eslint --max-warnings=0 ../supabase/functions/erpnext-onboard/onboard.test.ts
```

4. In the PR description, record the five mutation exercises and outcomes: record-history own-org clause removed, record-history active-member clause removed, abandoned-ref deletion removed, finalize body service-role check removed, and store-error log changed to include the RPC message. Record each test command and restored-green result. Do not include secrets, fixture emails, or raw error messages.

## Review focus

- Security reviewer: verify `0262` preserves service-role-only function execution and actor authorization, never exposes a credential ref/value to client roles, and cannot delete the current or restored prior secret.
- Code-quality reviewer: verify the three recreated function definitions do not drift from `0259` outside abandoned-ref lifecycle handling, and the rollback faithfully restores the preceding deployed behavior.
- Spec reviewer: verify every requested stale-text correction is made, including the narrow trigger-order wording and the deferred History read-plan review.
