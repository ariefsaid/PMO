# Issue #629 — Per-organization ops alert drain

## Preflight result and scope

The required shipped-state check was run against `dev` at `c72b0c40f1bc9a375d0ef2d44c2a6c3f2e5fdda7`: `supabase/functions/telegram-notify/{index.ts,logic.ts}` and `supabase/migrations/0167_alert_send_log_and_job_heartbeats.sql` still use an error-code-only alert-log key. `git diff --quiet dev --` over those paths exited 0. This work is therefore not already shipped.

At build start, repeat:
```bash
git grep -n -E 'alert_send_log|org_id' dev -- supabase/functions/telegram-notify supabase/migrations
git log -1 --format='%H %s' dev -- supabase/functions/telegram-notify/index.ts supabase/functions/telegram-notify/logic.ts supabase/migrations/0167_alert_send_log_and_job_heartbeats.sql
```
If the resulting `dev` code and migration already use the `(org_id, error_code)` key, stop without editing and report that commit.

Scope is limited to the Telegram drain, its write-ahead log, its direct tests, generated database types, the isolation denominator, and the binding guard needed for the new edge-function test. Do not change alert payload contents, cron/liveness behavior, auth configuration, other alerting code, or package locks. No ADR is needed: this is a localized correction to the existing ops-table and edge-function contracts, not a new tenancy or public-API architecture.

## Plan-local acceptance traceability

The issue gives an executable outcome but no dedicated spec `AC-###`; these identifiers label that outcome for test traceability without adding product scope.

| AC | Requirement | Owning proof |
|---|---|---|
| AC-629-001 | A batch containing the same error code for separate organization scopes creates independent drain groups; a cooldown/delivery record in one scope cannot suppress or stamp the other scope. | `supabase/functions/telegram-notify/index.test.ts` Deno test importing the shipped handler and mocking `globalThis.fetch` |
| AC-629-002 | `alert_send_log` persists one record per organization scope plus error code, retains the service-role-only posture, and admits the nullable global scope used by optional `error_events.org_id`. | `supabase/tests/0258_alert_send_log_org_key.test.sql` pgTAP |

## Design

### Data model and migration

`error_events.org_id` is intentionally nullable (`0071_error_events.sql` defines it as optional ops metadata). Preserve that contract: `NULL` represents one global/non-organization scope; it is never merged with an organization UUID. Existing alert-log rows predate a scope dimension and remain `org_id NULL`; no historical organization is inferred.

Migration `0258_alert_send_log_org_key.sql` changes `public.alert_send_log` as follows:

* add `id uuid not null default gen_random_uuid()` as a stable surrogate primary key;
* add nullable `org_id uuid references public.organizations(id) on delete cascade`;
* replace the old `error_code` primary key with `alert_send_log_pkey primary key (id)`;
* add `alert_send_log_org_id_error_code_key unique nulls not distinct (org_id, error_code)`, which makes `(NULL, code)` and each `(organization UUID, code)` a distinct, single write-ahead key;
* add `alert_send_log_error_code_idx on public.alert_send_log (error_code)` for the drain’s bounded current-batch lookup; and
* revise the table comment to describe the scoped write-ahead key and nullable global scope.

The table remains RLS-enabled and forced with zero policies and the existing authenticated/anon revocations unchanged. This is ops bookkeeping, so it has no client-facing RLS policy; the organization column is a data-partition seam used by the service-role drain. The rollback file first raises rather than discarding data if any `error_code` has more than one scoped row, then drops the new index/unique key/surrogate and organization column and restores `error_code` as the primary key. This makes rollback lossless when it is possible and fails closed when it is not.

The catalog will therefore change `alert_send_log` from `{ "has_org": false, "pk": "error_code" }` to `{ "has_org": true, "pk": "id" }`.

### Drain flow

Define one shared pure `alertKey(orgId, errorCode)` representation (a collision-free serialized two-element tuple) in `logic.ts`. It is used only for in-memory cooldown lookup; the database authority is the scoped unique constraint.

`groupIntoMessages` groups on `(org_id, error_code)`, retains `orgId` on each `MessageGroup`, and evaluates cooldown against `lastSentByKey[alertKey(group.orgId, group.errorCode)]`. The Telegram payload remains unchanged and continues not to include organization identifiers.

`runDrain` requests send-log records only for distinct error codes in its bounded unnotified batch, maps returned `(org_id, error_code)` rows through `alertKey`, and changes dependency signatures to carry `orgId` through `recordSendAhead`, `markDelivered`, and `stampNotified`. The stamp call receives both the exact group IDs and the group organization scope. This preserves the existing write-ahead-before-send and delivered-only stamping rules while binding every read/write to the same key.

The entry handler selects `org_id` with send-log rows, filters that bounded lookup by the batch’s error codes, upserts with `onConflict: 'org_id,error_code'`, and filters delivery-mark and event-stamp updates by both the exact IDs and the group scope. For the nullable global scope, use `.is('org_id', null)`; for a UUID, use `.eq('org_id', orgId)`. Export `handleTelegramNotifyRequest(req)` and call `serveWithErrorReporting` only inside `if (import.meta.main)`, so the shipped handler can be imported safely by a Deno test. No dependency-injected production handler is introduced.

## Implementation plan

### Task 1 — Reconfirm the `dev` preflight before touching files

**Files:** none.  
**ACs:** precondition for AC-629-001 and AC-629-002.

1. Run the two commands in **Preflight result and scope** from the repository root.
2. If `dev` now has a scoped `alert_send_log` key and the handler uses it for grouping, cooldown, and stamping, make no edits and report the exact `dev` commit. Otherwise record the `dev` commit in the build evidence and continue.

**Verify:** both commands exit 0; only the latter case proceeds to Task 2.

---

### Task 2 — Add the pgTAP schema/tenancy contract first (RED)

**File:** `supabase/tests/0258_alert_send_log_org_key.test.sql` (new)  
**AC:** AC-629-002.

Write a transaction-scoped pgTAP test with two fixture organizations. Before creating the migration, assert all of the following:

1. `alert_send_log.org_id` exists, is nullable, and has a foreign key to `organizations`; `id` exists and is the primary-key identity.
2. Inserts of the same `error_code` for the two different fixture organizations both succeed; a duplicate for the same organization fails with `23505`.
3. One `org_id NULL` row for an error code succeeds and a second `(NULL, same error_code)` insert fails with `23505`, preserving the global scope for optional `error_events.org_id`.
4. Existing RLS posture remains: RLS enabled and forced, zero policies, service role has required read/write grants, and an authenticated role is denied access. Reuse the assertion style and isolated JWT fixture setup from `supabase/tests/0160_alert_ops_tables_lockdown.test.sql` rather than weakening that existing test.
5. Assert `alert_send_log_error_code_idx` exists, because the handler limits its log lookup by the error codes in its 500-row error-event batch.

Use descriptions beginning with `AC-629-002`, `begin; … rollback;`, and an exact `plan(n)` matching the assertions.

**Verify (RED):**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0258_alert_send_log_org_key.test.sql'
```
Expected: non-zero before migration `0258` exists. Do not reduce the assertions after the migration is written.

---

### Task 3 — Add the reversible scoped alert-log migration (GREEN)

**Files:**
- `supabase/migrations/0258_alert_send_log_org_key.sql` (new; slot 0258 only)
- `supabase/migrations/rollback/0258_alert_send_log_org_key_down.sql` (new)

**AC:** AC-629-002.

1. In `0258_alert_send_log_org_key.sql`, add `id uuid not null default gen_random_uuid()` and nullable `org_id uuid references public.organizations(id) on delete cascade` to `public.alert_send_log`; leave existing records `org_id NULL` rather than attributing them to an organization.
2. Drop the old `alert_send_log_pkey` on `error_code`; add `alert_send_log_pkey primary key (id)` and `alert_send_log_org_id_error_code_key unique nulls not distinct (org_id, error_code)`.
3. Create `alert_send_log_error_code_idx` on `error_code`; update the table comment to describe the `(org_id, error_code)` cooldown/write-ahead key and the global null scope.
4. Do not alter its RLS state, policies, or grants: the established forced-RLS, zero-policy, service-role-only posture survives an `ALTER TABLE` migration unchanged.
5. In the down migration, first use a `DO` block to raise a clear exception if `group by error_code having count(*) > 1` finds any scoped collision. Only then drop the lookup index and scoped unique constraint, drop the surrogate key and `org_id` column, and restore the original `error_code` primary key. The rollback must never choose a surviving organization row or delete a cooldown record.

**Verify (GREEN):**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0258_alert_send_log_org_key.test.sql supabase/tests/0160_alert_ops_tables_lockdown.test.sql'
```
Expected: exit 0.

---

### Task 4 — Write organization-scope drain tests before changing pure logic (RED)

**Files:**
- `pmo-portal/src/lib/agent/telegramNotify.test.ts`
- `pmo-portal/src/lib/agent/telegramDrain.test.ts`

**AC:** AC-629-001 (supporting unit proofs; the shipped-handler test in Task 6 owns the AC).

1. Extend the `ROW`/`row` helpers to accept stable non-null organization UUID fixtures.
2. In `telegramNotify.test.ts`, add a test titled with `AC-629-001` that supplies two rows with the same error code but different organization IDs and asserts two `MessageGroup`s, each retaining its own `orgId` and exact ID list. Add a cooldown fixture only for organization A and assert it suppresses A but not B.
3. In `telegramDrain.test.ts`, add a two-tick test with the same error code in organizations A and B. Seed a delivered cooldown record only for A; assert B still records ahead and sends, while `stampNotified` receives `(A, [a-id], at)` and `(B, [b-id], at)` as separate calls. Update in-memory test stores to use the shared scoped key rather than a code-only property.
4. Add a null-scope fixture proving `org_id: null` shares cooldown only with another null-scope event, never with organization A.

**Verify (RED):**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/agent/telegramNotify.test.ts src/lib/agent/telegramDrain.test.ts'
```
Expected: non-zero against the code-only implementation.

---

### Task 5 — Make pure grouping and orchestration scope-aware (GREEN)

**File:** `supabase/functions/telegram-notify/logic.ts`  
**AC:** AC-629-001.

1. Export `alertKey(orgId: string | null, errorCode: string): string`, using `JSON.stringify([orgId, errorCode])` so no delimiter in an error code can alias another organization/code pair.
2. Add `orgId: string | null` to `MessageGroup`; group rows by `alertKey(row.org_id, row.error_code)` instead of `error_code`; preserve the existing sort/count/sample/ID behavior inside each scoped group.
3. Rename the code-only cooldown data/dependency to `selectLastSentByKey(errorCodes: string[])`. Map selected `SendLogEntry` values by `alertKey(entry.orgId, entry.errorCode)` and build the distinct `errorCodes` array from the already bounded unnotified batch. An empty batch must pass `[]` and avoid relying on unrelated historical rows.
4. Extend `SendLogEntry` with `orgId` and `errorCode`; change `recordSendAhead`, `markDelivered`, and `stampNotified` signatures to take `orgId` before the existing key/ID/time arguments. Pass `group.orgId` on every call, including suppressed delivered-group stamps.
5. Keep all existing write-ahead, delivery-confirmation, liveness, error logging, and payload-redaction rules byte-for-byte in effect except for the new scoped key.

**Verify (GREEN):**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/agent/telegramNotify.test.ts src/lib/agent/telegramDrain.test.ts'
```
Expected: exit 0, including all existing cooldown/liveness regression tests.

---

### Task 6 — Add a shipped-handler test with mocked fetch (RED)

**File:** `supabase/functions/telegram-notify/index.test.ts` (new)  
**AC:** AC-629-001 (owning proof).

Create a Deno-native test that dynamically imports `handleTelegramNotifyRequest` from `./index.ts`; do not copy handler logic or introduce dependency injection. Set only synthetic test environment values and clear them in `finally` without reading any local environment file. Replace `globalThis.fetch` for the test and restore it in `finally`.

The fetch mock must emulate the Supabase REST calls and Telegram success for this scenario:

1. two unnotified `error_events` have the same error code and different organization IDs;
2. `alert_send_log` returns a recent delivered record only for organization A;
3. invoke the shipped handler with the synthetic authorization header;
4. assert the handler returns `200`, B gets one Telegram send and a write-ahead upsert with body `{ org_id: B, error_code, last_sent_at, delivered_at: null }` plus `on_conflict=org_id,error_code`, and no B action is suppressed by A’s record;
5. assert the delivery-mark and `error_events.notified_at` PATCH URLs constrain both error code/IDs and the matching organization scope: A’s suppressed row and B’s delivered row are stamped independently; no request uses an error-code-only filter.

Make unexpected fetch URLs fail the test so a new unmocked HTTP path cannot pass vacuously.

**Verify (RED):**
```bash
cd supabase/functions/telegram-notify && deno test --config deno.json --allow-env --allow-net --allow-read index.test.ts
```
Expected: non-zero because the current entry point does not export an import-safe shipped handler.

---

### Task 7 — Wire the scoped database calls through the import-safe shipped handler (GREEN)

**Files:**
- `supabase/functions/telegram-notify/index.ts`
- `scripts/check-edge-fn-test-binding.mjs`

**AC:** AC-629-001.

1. Refactor the current callback body into `export async function handleTelegramNotifyRequest(req: Request): Promise<Response>` without changing its authentication/error response semantics. Guard `serveWithErrorReporting('telegram-notify', handleTelegramNotifyRequest)` with `if (import.meta.main)`.
2. Select `org_id, error_code, last_sent_at, delivered_at` from `alert_send_log` and implement `selectLastSentByKey(errorCodes)` as `.in('error_code', errorCodes)` (returning an empty map without a request when the list is empty). Convert result rows to scoped `SendLogEntry` values.
3. Use `{ org_id: orgId, error_code: errorCode, last_sent_at: atIso, delivered_at: null }` with `{ onConflict: 'org_id,error_code' }` for write-ahead. For delivery marking and `error_events` stamping, branch exactly on `orgId === null`: use `.is('org_id', null)` for the global scope and `.eq('org_id', orgId)` otherwise; also retain the exact group `ids` filter on the event update.
4. Add `'supabase/functions/telegram-notify/index.test.ts': 'handleTelegramNotifyRequest'` to the `REQUIRED` map in `scripts/check-edge-fn-test-binding.mjs`. This makes the existing shipped-handler export/import-meta-main guard mechanically cover the new test.

**Verify (GREEN):**
```bash
cd supabase/functions/telegram-notify && deno test --config deno.json --allow-env --allow-net --allow-read index.test.ts
cd ../../.. && node scripts/check-edge-fn-test-binding.mjs
```
Expected: both commands exit 0.

---

### Task 8 — Regenerate derived schema artifacts and the isolation denominator

**Files:**
- `pmo-portal/src/lib/supabase/database.types.ts` (regenerated; never hand-edited)
- `scripts/isolation-probe-denominator.json` (regenerated with its existing formatter)

**AC:** AC-629-002.

After migration 0258 is applied to the local catalog, regenerate TypeScript types so `alert_send_log` exposes `id` and nullable `org_id` in Row/Insert/Update (and its organization relationship), and regenerate the checked-in denominator from the live catalog. The only expected denominator tuple change is `alert_send_log` to `has_org: true` with `pk: id`; investigate and stop on any unrelated catalog drift.

Run all catalog-dependent commands under one database lock hold:
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset \
  && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts \
  && node --input-type=module -e "import { readActualCatalog, formatDenominator } from \"./scripts/check-isolation-denominator.mjs\"; process.stdout.write(formatDenominator(readActualCatalog()) + \"\\n\")" > scripts/isolation-probe-denominator.json \
  && node scripts/check-isolation-denominator.mjs \
  && supabase test db supabase/tests/0258_alert_send_log_org_key.test.sql supabase/tests/0160_alert_ops_tables_lockdown.test.sql'
```

**Verify:** the command exits 0; inspect the denominator diff before proceeding and retain no unrelated generated drift.

---

### Task 9 — Run scoped local gates and record evidence

**Files:** none.  
**ACs:** AC-629-001, AC-629-002.

1. Run the changed Vitest suites and all Deno edge-function tests (the latter discovers the new Telegram test):
   ```bash
   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/agent/telegramNotify.test.ts src/lib/agent/telegramDrain.test.ts'
   scripts/deno-test-edge-fns.sh
   ```
2. Run the migration-aware database proof as one lock hold, then the denominator and binding guards:
   ```bash
   scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0258_alert_send_log_org_key.test.sql supabase/tests/0160_alert_ops_tables_lockdown.test.sql && node scripts/check-isolation-denominator.mjs'
   node scripts/check-edge-fn-test-binding.mjs
   ```
3. Run the required local final code gate (no lockfile regeneration, no e2e journey because no browser route changed):
   ```bash
   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 src/lib/agent/telegramNotify.test.ts src/lib/agent/telegramDrain.test.ts ../supabase/functions/telegram-notify/index.ts ../supabase/functions/telegram-notify/logic.ts ../supabase/functions/telegram-notify/index.test.ts ../scripts/check-edge-fn-test-binding.mjs && npx vitest run --changed origin/dev'
   ```

Every command must exit 0. Do not skip, weaken, delete, or rewrite a failing assertion; fix the implementation instead. CI remains the full-suite merge gate.

## Expected changed files

```text
supabase/migrations/0258_alert_send_log_org_key.sql
supabase/migrations/rollback/0258_alert_send_log_org_key_down.sql
supabase/tests/0258_alert_send_log_org_key.test.sql
supabase/functions/telegram-notify/logic.ts
supabase/functions/telegram-notify/index.ts
supabase/functions/telegram-notify/index.test.ts
pmo-portal/src/lib/agent/telegramNotify.test.ts
pmo-portal/src/lib/agent/telegramDrain.test.ts
pmo-portal/src/lib/supabase/database.types.ts
scripts/check-edge-fn-test-binding.mjs
scripts/isolation-probe-denominator.json
```
