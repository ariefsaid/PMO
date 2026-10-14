# Plan: Record ERPNext sweep doctype failures (#998)

## Scope and design

The cron response is not an operational-recording channel: `sweepOrgDoctypesLive()` catches a failed per-doctype walk, puts its free-text message only in its return value, then continues. The existing attempt upsert still refreshes `external_sync_watermarks.updated_at`, so a continuously failed cursor appears recently attempted without an actionable durable signal.

Add nullable operational-state columns to the existing per-`(org_id, external_tier, domain)` watermark row. The existing `external_sync_watermarks` select policy, forced RLS, and machine-only write posture remain unchanged: members retain their own-org read of the already-visible row and only the service-role sweep writes the fields. The migration is additive and its down migration drops only the new columns.

Within the existing `sweepOrgDoctypesLive()` loop, preserve the current kind order, tick budgets, cursor reads, attempt stamp, `runSweep` call, and apply logic. On a caught failure, update that doctype's already-attempted watermark row with a safe message and a cooldown timestamp; then await the existing `recordErrorEvent()` helper with the injected service-role client. `recordErrorEvent()` already self-contains insert failures, so telemetry failure cannot stop siblings or the next cron tick. On a fully completed `runSweep` walk, the existing cursor-advance upsert clears both error fields atomically with the cursor update.

`last_error_at` is the alert cooldown stamp: the first failure writes it; a duplicate inside one hour updates the scrubbed `last_error` but retains the prior timestamp, which is necessary for a later failure to pass the one-hour test and emit a fresh event. A successful completed walk clears both values. This gives one alert per persistent failure episode per hour while retaining the current error text. The attempt `updated_at` continues to be written before every walk and is not changed by the failure-state update.

Use the already-importable shared `redactErrorForOutbox()` function rather than a second ad-hoc redactor. Extend it compatibly with an optional maximum length (default remains 240 for its existing money-outbox callers) and redact HTTP(S) URLs before its existing token-shaped-run redaction. The sweep passes `500`; the error text is never put in `error_events`, whose stable values are `fn: 'erpnext-sweep'`, `error_code: 'sweep-doctype-failed'`, `context_id: sweepWatermarkDomain(kind)`, and `org_id: org.orgId`.

No ADR is required: this is a reversible additive operational-state change using the existing watermark and error-event seams. No UI, API endpoint, cache, RLS policy, grants, sweep ordering, budget, cursor semantics, or apply behavior changes.

## Acceptance traceability

The issue supplies the acceptance behavior; these IDs make its owning proofs discoverable.

| Acceptance criterion | Owning layer | Canonical proof |
|---|---|---|
| AC-998-001 — Given the watermark table, when migration 0285 is applied, then nullable `last_error text` and `last_error_at timestamptz` exist while the existing own-org read, machine-only write, and service-role upsert contracts remain true. | pgTAP | `supabase/tests/external_sync_watermarks_rls.test.sql` |
| AC-998-002 — Given a doctype list/apply walk fails, when the sweep catches it, then its watermark holds a URL/secret-scrubbed error of at most 500 characters and a timestamp; when a later walk completes, both fields are cleared without changing cursor, ordering, budget, or apply semantics. | Deno unit | `supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts` |
| AC-998-003 — Given a failed doctype, when it has no alert timestamp or its prior timestamp is at least one hour old, then one `error_events` row has the stable function/code/domain/org values; when it fails again within one hour, no second row is emitted; an error-event insert failure does not abort the sweep. | Deno unit | `supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts` |
| AC-998-004 — Given arbitrary upstream error text, when it is persisted through the shared redactor for the sweep, then URLs and token-shaped secret material are redacted and the supplied 500-character bound is enforced, while existing callers keep their 240-character default. | Vitest | `pmo-portal/src/lib/adapterSeam/dispatch.money.test.ts` |

## TDD implementation tasks

### 1. Add the failing watermark schema/RLS proof (AC-998-001)

**File:** `supabase/tests/external_sync_watermarks_rls.test.sql`

**Test first:** change `select plan(5)` to `select plan(11)`. Before the existing two-org fixture, add two `has_column` assertions for `last_error` and `last_error_at`; two `col_type_is` assertions for `text` and `timestamp with time zone`; and two `information_schema.columns.is_nullable = 'YES'` assertions. Retain, unchanged, the existing org-A own-row read, org-B invisibility, authenticated insert refusal, service-role conflict upsert uniqueness, and cursor-advance assertions. This proves the additive columns and that the selected row/security contract did not regress.

**Expected RED:** the four shape assertions and two nullability assertions fail before migration 0285 exists.

**Verify RED:**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/external_sync_watermarks_rls.test.sql'
```

### 2. Add reversible migration 0285 and its rollback (AC-998-001)

**Files:**
- `supabase/migrations/0285_erpnext_sweep_error_watermarks.sql`
- `supabase/migrations/rollback/0285_erpnext_sweep_error_watermarks_down.sql`

**Implementation:** in migration 0285, run one `alter table public.external_sync_watermarks` adding exactly `last_error text` and `last_error_at timestamptz`, both nullable and without defaults. Do not add an index, policy, trigger, grant, or data backfill: the row's existing unique key is the write/read key, RLS is already forced, and service-role writes already have table access. In the paired down file, run one `alter table public.external_sync_watermarks` dropping exactly `last_error` and `last_error_at`; do not touch the table, its unique key, its RLS policy, or its grants.

**Verify GREEN:**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/external_sync_watermarks_rls.test.sql'
```

### 3. Check generated-type workflow; do not regenerate without a defined script (AC-998-001)

**Files:** none unless the check finds a repository-defined generation script.

**Action:** inspect `pmo-portal/package.json` scripts and repository scripts for a declared database-type generation command. The current package scripts have no type-generation command, so leave `pmo-portal/src/lib/supabase/database.types.ts` unchanged as required by the issue fence; no application client consumes these fields in this slice. If a declared generation script is found on the builder's branch, run that declared script under `scripts/with-db-lock.sh` after the migration reset and commit only its resulting `external_sync_watermarks` Row/Insert/Update additions.

**Verify current expected branch state:**
```bash
node -e "const p=require('./pmo-portal/package.json'); if (Object.keys(p.scripts).some((k) => /gen.*type|type.*gen/i.test(k))) process.exit(1)"
```

### 4. Add failing shared-redactor coverage for URL scrubbing and the 500-character override (AC-998-004)

**File:** `pmo-portal/src/lib/adapterSeam/dispatch.money.test.ts`

**Test first:** extend the existing `redactErrorForOutbox` describe block with an `AC-998-004` test that passes an error containing an HTTP(S) URL with a query string and a long token-shaped marker to `redactErrorForOutbox(error, 500)`. Assert neither marker nor the URL remains, the redaction marker remains, and the returned value is at most 500 characters. Add a second assertion in that test (or a separately titled `AC-998-004` test) that a long non-secret error passed without the second argument remains at most 241 characters, preserving the existing default contract.

**Expected RED:** the URL is still retained and the function does not accept the 500-character parameter.

**Verify RED:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/dispatch.money.test.ts
```

### 5. Extend the shared redactor without changing existing outbox callers (AC-998-004)

**File:** `pmo-portal/src/lib/adapterSeam/dispatch.ts`

**Implementation:** change the signature to `redactErrorForOutbox(error: unknown, maxLength = 240): string`. Preserve the current source-message selection and token-shaped-run replacement. Before token replacement, replace every HTTP(S) URL, including its path/query/fragment, with `[redacted-url]`; then apply the existing token replacement. Return the scrubbed string unchanged when its length is at most `maxLength`, otherwise return `scrubbed.slice(0, maxLength) + '…'`. Do not change any existing call site, so default outbox persistence stays bounded at 240 plus its existing ellipsis behavior.

**Verify GREEN:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/dispatch.money.test.ts
```

### 6. Add a failing shipped-sweep failure-state/event test harness (AC-998-002, AC-998-003)

**File:** `supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts` (new)

**Test first:** follow `companyScopedSweep.test.ts`/`sweepWedge.test.ts`: stub `Deno.serve` before dynamically importing `sweepOrgDoctypesLive` from `./index.ts`, mock `globalThis.fetch`, and use a stateful fake service client that models watermark `select`, `upsert`, `update(...).eq(...)`, and `error_events.insert` calls. Keep all fixture identifiers synthetic.

Add three AC-tagged Deno tests that drive the shipped function, not a copied helper:

1. **AC-998-002 failed walk:** make one selected doctype list request reject, seed no watermark error, and assert its watermark has a non-null ISO timestamp and a scrubbed, at-most-500-character error while the original cursor remains unchanged; assert the healthy sibling still polls, preserving failure containment.
2. **AC-998-002 recovery:** seed the same watermark with non-null error fields, make its next list walk complete, and assert the successful cursor-advance payload has `last_error: null` and `last_error_at: null` while still advancing the cursor normally.
3. **AC-998-003 alert cooldown and resilience:** run the same failed walk twice with injected `nowMs` values less than one hour apart, assert exactly one `error_events` insert with `fn: 'erpnext-sweep'`, `error_code: 'sweep-doctype-failed'`, the namespaced watermark domain context ID, and the organization ID; then make the fake `error_events.insert` return an error and assert the sweep still returns its ordinary contained doctype failure and continues its healthy sibling. Also execute a third failure at exactly one hour after the retained cooldown timestamp and assert a second event is inserted.

**Expected RED:** no durable error fields are written or cleared, and no error event is inserted.

**Verify RED:**
```bash
cd supabase/functions/erpnext-sweep && deno test sweepErrorVisibility.test.ts --config deno.json --allow-env --allow-net --allow-read
```

### 7. Wire durable, scrubbed failure state and throttled event recording into the shipped sweep (AC-998-002, AC-998-003)

**File:** `supabase/functions/erpnext-sweep/index.ts`

**Implementation:**

1. Import `redactErrorForOutbox` from `pmo-portal/src/lib/adapterSeam/dispatch.ts` and `recordErrorEvent` plus `ErrorEventSupabaseLike` from `../_shared/errorEvent.ts`.
2. Keep the current watermark query predicates and attempt upsert in the same position, but select `watermark_cursor, last_error_at` so the caught branch has the prior cooldown timestamp. Do not change the existing attempt `updated_at` write.
3. In `advanceWatermark`, add `last_error: null` and `last_error_at: null` to the existing success upsert payload. This makes clearing conditional on `runSweep` completing and keeps it in the existing cursor write; do not alter the cursor value, conflict target, or recency stamp.
4. In the existing per-doctype `catch`, keep the current `doctypeErrors.push(...)` and `continue`. Before them, produce `const safeError = redactErrorForOutbox(err, 500)`. Best-effort update only the matching `org_id`, `external_tier`, and `domain` watermark row with `last_error: safeError`; set `last_error_at` to `new Date(nowMs()).toISOString()` only when the prior value is absent or is at least 3,600,000 milliseconds old. Preserve the prior timestamp on a within-hour duplicate so cooldown can expire. If this status update returns or throws an error, emit only a stable, data-free console code and continue; never surface raw failure text.
5. In the same absent/expired branch, `await recordErrorEvent(serviceClient as unknown as ErrorEventSupabaseLike, { fn: 'erpnext-sweep', errorCode: 'sweep-doctype-failed', contextId: wmDomain, orgId: org.orgId })`. Do not put `safeError` in the event. Do not throw on its result: `recordErrorEvent` is the shared failure-contained writer, so a sink failure cannot stop the sweep. Do not use `reportEdgeError`, construct a second client, alter the HTTP response, or change the loop's ordering, budgets, cursors, or apply path.

**Verify GREEN:**
```bash
cd supabase/functions/erpnext-sweep && deno test sweepErrorVisibility.test.ts --config deno.json --allow-env --allow-net --allow-read
```

### 8. Run the required event-write mutation check (AC-998-003)

**Files:** temporarily modifies then restores `supabase/functions/erpnext-sweep/index.ts`; no mutation is committed.

**Mutation:** after the green test, copy `index.ts` to a temporary file. Use the following script to replace only the new `recordErrorEvent` call containing the stable `sweep-doctype-failed` code with a no-op, run the owning test, require it to fail, then restore the exact original file.

```bash
set -euo pipefail
tmp="$(mktemp)"
cp supabase/functions/erpnext-sweep/index.ts "$tmp"
python3 - <<'PY'
from pathlib import Path
p = Path('supabase/functions/erpnext-sweep/index.ts')
s = p.read_text()
start = s.index('await recordErrorEvent(')
end = s.index(');', start) + 2
assert "errorCode: 'sweep-doctype-failed'" in s[start:end]
p.write_text(s[:start] + 'await Promise.resolve({ ok: true });' + s[end:])
PY
set +e
(
  cd supabase/functions/erpnext-sweep
  deno test sweepErrorVisibility.test.ts --config deno.json --allow-env --allow-net --allow-read --filter 'AC-998-003'
)
status=$?
set -e
mv "$tmp" supabase/functions/erpnext-sweep/index.ts
test "$status" -ne 0
```

**Expected mutation result:** the AC-998-003 test is red because its expected `error_events` insertion is absent; `test "$status" -ne 0` is green only when that failure occurred. Re-run the unmodified owning test afterwards:

```bash
cd supabase/functions/erpnext-sweep && deno test sweepErrorVisibility.test.ts --config deno.json --allow-env --allow-net --allow-read
```

### 9. Run the requested final gates after all targeted tests are green (AC-998-001 through AC-998-004)

**Files:** none.

**Verify in this order; stop at the first nonzero exit:**

```bash
cd pmo-portal && npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 ../supabase/functions/erpnext-sweep/index.ts ../supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts src/lib/adapterSeam/dispatch.ts src/lib/adapterSeam/dispatch.money.test.ts
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed "$(git merge-base origin/dev HEAD)"
cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read
cd pmo-portal && npm run check:edge-test-binding
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```

The last command deliberately holds the one shared database lock across both reset and the full pgTAP suite, preventing another worktree from replacing the schema between migration application and proof.

### 10. Commit only after every gate and the mutation check are green

**Files to stage explicitly:**
- `supabase/migrations/0285_erpnext_sweep_error_watermarks.sql`
- `supabase/migrations/rollback/0285_erpnext_sweep_error_watermarks_down.sql`
- `supabase/tests/external_sync_watermarks_rls.test.sql`
- `pmo-portal/src/lib/adapterSeam/dispatch.ts`
- `pmo-portal/src/lib/adapterSeam/dispatch.money.test.ts`
- `supabase/functions/erpnext-sweep/index.ts`
- `supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts`
- `docs/plans/2026-10-14-sweep-error-recording-7612d5ab.md`

**Commit procedure:** inspect `git diff --check` and `git status --short`; stage only the listed files; then commit with no attribution trailer and without bypassing hooks.

```bash
git diff --check
git add supabase/migrations/0285_erpnext_sweep_error_watermarks.sql supabase/migrations/rollback/0285_erpnext_sweep_error_watermarks_down.sql supabase/tests/external_sync_watermarks_rls.test.sql pmo-portal/src/lib/adapterSeam/dispatch.ts pmo-portal/src/lib/adapterSeam/dispatch.money.test.ts supabase/functions/erpnext-sweep/index.ts supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts docs/plans/2026-10-14-sweep-error-recording-7612d5ab.md
git commit -m "fix(erpnext): record sweep doctype failures (#998)"
```

Do not push or open a pull request. In the builder report, include the RED→GREEN commands/results, the required mutation-check result, the final-gate results, the commit SHA, and make the final line exactly `B998-DONE`.

## Builder guardrails

- Never persist or emit raw upstream response text, URLs, query strings, credentials, token-shaped values, personal data, or arbitrary error payloads. The watermark has own-org read access, so its stored message must remain safe even when read by a member.
- Keep the service-role client already created by the sweep. Do not create a client in the loop or make telemetry availability a precondition of syncing.
- Do not convert per-doctype containment back into an early return/throw. A failed doctype must still leave sibling doctypes eligible for this tick.
- Do not change sweep kind ordering, fairness reads, page limits, tick document/time budgets, cursor filters, conflict target, cursor advancement conditions, or any apply/feed logic.
- Do not regenerate `package-lock.json`; do not use `--no-verify`; do not push or open a PR.
