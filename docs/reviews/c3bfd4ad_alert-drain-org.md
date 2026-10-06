# Per-organization Telegram alert drain

## What changed

Issue #629 is implemented for the Telegram ops alert drain. The preflight recorded in the plan found that `dev` still used an error-code-only key, so this change adds organization scope rather than being a no-op.

The drain now groups events, applies cooldowns, records write-ahead attempts, marks deliveries, and stamps `error_events.notified_at` by `(org_id, error_code)`. Nullable `org_id` remains a distinct global scope. Telegram message contents remain unchanged and do not expose organization IDs.

## Where it lives

- `supabase/functions/telegram-notify/logic.ts` adds the collision-free `alertKey`, organization-aware `MessageGroup`/`SendLogEntry` types, bounded send-log lookup, and scoped orchestration.
- `supabase/functions/telegram-notify/index.ts` wires scoped REST filters, upserts with `on_conflict=org_id,error_code`, and exports the import-safe `handleTelegramNotifyRequest`; serving is guarded by `import.meta.main`.
- `supabase/migrations/0258_alert_send_log_org_key.sql` adds nullable `org_id`, a surrogate `id` primary key, the nulls-not-distinct `(org_id, error_code)` unique key, and an error-code lookup index. `supabase/migrations/rollback/0258_alert_send_log_org_key_down.sql` fails closed on rollback if scoped rows would collide under the old key.
- `supabase/tests/0258_alert_send_log_org_key.test.sql` verifies schema, uniqueness for organization and global scopes, foreign-key/RLS/grant posture, and the lookup index.
- `pmo-portal/src/lib/agent/telegramNotify.test.ts` and `pmo-portal/src/lib/agent/telegramDrain.test.ts` cover independent organization/global grouping, cooldown, stamping, and bounded lookup behavior.
- `supabase/functions/telegram-notify/index.test.ts` imports the shipped handler and mocks `globalThis.fetch` to verify that one organization’s delivered cooldown does not suppress another’s send or stamp.
- `pmo-portal/src/lib/supabase/database.types.ts` reflects the migrated table; `scripts/isolation-probe-denominator.json` records `alert_send_log` as org-scoped with `id` primary key.
- `scripts/check-edge-fn-test-binding.mjs` requires the new edge-function test to import `handleTelegramNotifyRequest`.
- `docs/plans/2026-10-06-alert-drain-per-org-c3bfd4ad.md` contains the implementation plan and acceptance traceability.

## Verification

Run the changed Vitest suites under `scripts/with-test-lock.sh`, the edge-function tests via `scripts/deno-test-edge-fns.sh`, and the migration/pgTAP checks under `scripts/with-db-lock.sh`. The plan also specifies running `node scripts/check-edge-fn-test-binding.mjs`, `node scripts/check-isolation-denominator.mjs`, typecheck, and targeted ESLint; CI remains the full-suite merge gate.

The edge-function test uses synthetic environment values and a fetch mock; it does not read local environment files. The migration slot is 0258 and no package-lock change is included.
