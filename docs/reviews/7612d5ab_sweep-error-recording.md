# ERPNext sweep failure recording

## What changed

Issue #998 is implemented across the ERPNext sweep, shared error redaction, and watermark schema:

- Migration `0285` adds nullable `last_error text` and `last_error_at timestamptz` to `public.external_sync_watermarks`; the paired rollback removes only those columns. The pgTAP contract now checks their existence, types, nullability, and retains the existing watermark/RLS assertions.
- `sweepOrgDoctypesLive` reads the prior error timestamp, records a scrubbed and bounded (500-character) failure on the doctype watermark, and preserves the existing cursor and sibling-doctype continuation behavior. A completed walk clears both fields during the existing cursor-advance upsert.
- Failed doctypes emit the stable `erpnext-sweep` / `sweep-doctype-failed` event with the watermark domain and organization ID. Events are throttled to one per doctype per hour; the existing `recordErrorEvent` path remains best-effort. The returned doctype error is also data-free (`sweep failed`).
- `redactErrorForOutbox` now scrubs HTTP(S) URLs and accepts an optional length limit while retaining its existing 240-character default for current callers.

## Files carrying the change

- `supabase/functions/erpnext-sweep/index.ts`
- `supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts`
- `pmo-portal/src/lib/adapterSeam/dispatch.ts`
- `pmo-portal/src/lib/adapterSeam/dispatch.money.test.ts`
- `supabase/migrations/0285_erpnext_sweep_error_watermarks.sql`
- `supabase/migrations/rollback/0285_erpnext_sweep_error_watermarks_down.sql`
- `supabase/tests/external_sync_watermarks_rls.test.sql`
- `docs/plans/2026-10-14-sweep-error-recording-7612d5ab.md`

The new Deno tests import the shipped sweep module, mock fetch and the service client, and cover failure persistence, cursor preservation, recovery clearing, sibling continuation, hourly event suppression, exactly-one-hour re-alerting, and event-write failure containment. The Vitest addition covers URL/token scrubbing and the override bound.

## Verification

The plan records these checks for the change:

```bash
cd pmo-portal && npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 ../supabase/functions/erpnext-sweep/index.ts ../supabase/functions/erpnext-sweep/sweepErrorVisibility.test.ts src/lib/adapterSeam/dispatch.ts src/lib/adapterSeam/dispatch.money.test.ts
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed "$(git merge-base origin/dev HEAD)"
cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read
cd pmo-portal && npm run check:edge-test-binding
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```

For focused checks, run `sweepErrorVisibility.test.ts` from `supabase/functions/erpnext-sweep` and `dispatch.money.test.ts` from `pmo-portal` as described in the plan. The plan also specifies a temporary mutation removing the `sweep-doctype-failed` event call; the AC-998-003 test must fail, after which the original file is restored and the owning test rerun.
