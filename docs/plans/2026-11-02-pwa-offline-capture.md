# Plan: app-wide offline capture and targeted notifications (#1520)

**Gate:** proposed spec `docs/specs/pwa-offline-capture.spec.md`; no implementation until owner signs its nine defaults and relevant domain contracts. #1501 is binding. This is a slice map, not a claim that future domain tables exist. Director dispatches fresh Orca workers; auth/identity, stock/money and SoD slices ship alone. No production action is authorized. Migration allocation for this plan is **0545–0547 only**, each with `supabase/migrations/rollback/<name>_down.sql`; check collision against fresh origin/dev before building. Individual domain changes requiring other migrations belong to their owning issue, not this range.

## Design and boundaries

One versioned static shell and a private IndexedDB queue per origin. The queue stores an envelope `{id, schemaVersion, actorId, orgId, type, capturedAt, payload, state, reason}` plus blobs, transactionally. States are `queued`, `sending`, `unknown`, `needs_fixing`, `confirmed`. A per-tab lease prevents needless concurrent sends; server uniqueness is the actual correctness boundary. Offline status is a hint; failed requests still preserve the item. Never cache authenticated data. Display queued as local, not approved or posted.

A domain adapter registers `validateLocal`, `submit` and `reconcile`; no generic arbitrary RPC dispatcher. Submit uses an operation UUID and a canonical payload digest; the existing domain server authority atomically inserts its own operation receipt and domain row in the same transaction. Receipt key is `(org_id, actor_id, operation_id)` and stores kind, digest and resulting ID. Active membership and domain authorization are checked on initial write and on receipt reads; another actor cannot retrieve a result. Same key with different content is rejected. A definite rejection permits a new key on correction; an unknown response must resolve the old key first. For stock, offline capture is an **intent**, not locally authoritative stock and not approval or valuation: #1512's live issue authority checks project, BoQ, stock and permissions; #1508 owns connected ERP outcome. Do not send a client org ID as authority.

Photo upload is staged under an operation-derived object key with a content digest; the owning domain authority associates only objects belonging to the actor/org/operation, then confirms the whole operation. Retry uses the same object key; cleanup selects only old, unreferenced stages after a grace period and must serialize against association. The exact domain object and upload contract must be reconciled with #1522 before its adapter ships. Do not create a second document system.

Existing `notifications` (0048) and workflow handoffs (0237, current function bodies must be rechecked at build head) remain inbox and recipient authority. Extend event production with a stable event identity and a durable per-recipient intent; existing informational inbox entries need not all become push. Snapshot one configured channel, not one per device; a phone channel may have multiple registered devices but logical event identity must be shared. To respect the one-message ruling, recommended first release permits **one active push endpoint per user/org**, replaced deliberately on new registration. A provider acceptance is not proof of display: use provider idempotency where available, hold ambiguous sends for reconciliation, never automatically change channels. Existing external notification paths must be audited at build time to ensure the same event does not also send there. Lark setup/identity depends on #1521, and low-cash emission on #1515; absent dependencies render the channel/event unavailable. A device-only rejection cannot generate remote notification until connectivity allows it to report a safe event.

## Slice map

| Slice | Depends on | Deployment and ownership |
|---|---|---|
| S1 shell and queue | owner sign-off | app foundation, no migration; no claims about absent domain forms |
| S2 receipt authority | S1, owner sign-off | 0545; auth/SoD, ships alone |
| S3 attachments and domain adapters | S2; #1517 clock, #1522 report/photo, #1512 stock, #1519 equipment | each owning domain supplies its authority; stock/SoD ships alone; no fabricated schema |
| S4 notification identity/preferences | owner sign-off | 0546; auth/identity, ships alone |
| S5 intent and dispatch | S4, workflow producers; #1515 low cash, #1521 Lark | 0547; auth/notification, ships alone |
| S6 UI, recovery and journey | S1–S3 as available, S4–S5 | per-domain staged release; user sees unavailable features honestly |

## Execution tasks

Tasks below are intended as small red/green steps; run paths from repo root unless stated. New tests must import the actual implementation, and every migration has a down migration restoring preexisting function bodies. Builders inspect the latest actual domain command and update tests to its real signature before implementation; if that contract has not shipped, leave that adapter blocked rather than invent it.

### S1: shell and device queue (AC-PWA-001, 002, 003, 007, 009, 010, 016)

1. **Red:** create `pmo-portal/src/lib/offline/queue.test.ts` asserting atomic `enqueue`, `listFor(actor, org)`, `markUnknown`, `correct` and quota failure; verify `cd pmo-portal && npx vitest run src/lib/offline/queue.test.ts` fails. **Green:** create `pmo-portal/src/lib/offline/queue.ts` with IndexedDB transactions and those methods; `correct` refuses `unknown` and issues a new UUID for `needs_fixing`. Run the same command.
2. **Red:** in `pmo-portal/src/lib/offline/queue.test.ts` assert another actor/org receives no items, cannot mutate them, and quota failure preserves form data. **Green:** bind every lookup and mutation to both fields; repeat the command in task 1.
3. **Red:** create `pmo-portal/src/lib/offline/sync.test.ts` asserting same-key retry, bounded retry and no background-only dependency. **Green:** add `pmo-portal/src/lib/offline/sync.ts` with foreground startup/connectivity handlers and per-operation lease; verify `cd pmo-portal && npx vitest run src/lib/offline/sync.test.ts`.
4. **Red:** create `pmo-portal/src/lib/offline/capabilities.test.ts` asserting offline approval, money and shared edit are refused before enqueue. **Green:** create `pmo-portal/src/lib/offline/capabilities.ts` with explicit allowed new-record discriminants; wire the relevant form entry points through their domain permissions. Verify `cd pmo-portal && npx vitest run src/lib/offline/capabilities.test.ts`.
5. **Red:** create `pmo-portal/src/lib/offline/shell.test.ts` asserting manifest/shell include only static assets and no authenticated API route. **Green:** add `pmo-portal/public/manifest.webmanifest`, `pmo-portal/public/service-worker.js`, register from `pmo-portal/index.tsx`, and version caches without touching IndexedDB. Verify `cd pmo-portal && npx vitest run src/lib/offline/shell.test.ts && npm run build`.
6. **Red:** add sign-out guard cases to `pmo-portal/src/auth/AuthProvider.test.tsx`: pending items offer cancel or explicit discard. **Green:** integrate the existing sign-out flow with queue count and confirmation; no automatic deletion. Verify `cd pmo-portal && npx vitest run src/auth/AuthProvider.test.tsx`.

### S2: server idempotency (AC-PWA-005, 006)

7. **Red:** create `supabase/tests/pwa_receipts.test.sql` with two concurrent same-key attempts, same-key changed digest, another actor/org and revoked membership. Verify `scripts/with-db-lock.sh supabase test db supabase/tests/pwa_receipts.test.sql` fails, inspecting TAP body and Parse errors.
8. **Green:** create `supabase/migrations/0545_pwa_receipts.sql` and `supabase/migrations/rollback/0545_pwa_receipts_down.sql`: receipt table with org, actor, operation UUID, domain kind, digest and result ID; unique key above, RLS forced, no direct client writes. Add private helpers invoked *inside* each domain transaction; no client-callable generic writer. Test grants and same-org active membership, then rerun task 7. A receipt and domain write must commit or roll back together.
9. **Mutation:** remove the unique key or bypass actor validation locally and verify task 7 goes red; restore and rerun. Check `supabase/tests/0137*`, `0136*`, `0178*` inventories and update as needed, never weaken their assertions.

### S3: domain adapters and photos (AC-PWA-004, 008, 015)

10. **Red:** create `pmo-portal/src/lib/offline/adapters.test.ts`, using fake domain repositories, asserting an operation routes only to its registered type and preserves identity, capture time and evidence. **Green:** add `pmo-portal/src/lib/offline/adapters.ts` with explicit typed registration and `submit`/`reconcile`, rejecting unknown versions. Verify `cd pmo-portal && npx vitest run src/lib/offline/adapters.test.ts`.
11. **Red:** create `pmo-portal/src/lib/offline/photos.test.ts` for interrupted upload, repeated upload, association failure and retained blob. **Green:** add `pmo-portal/src/lib/offline/photos.ts` using the owning repository's staged object contract and operation-derived key; do not delete local blob until association is confirmed. Verify `cd pmo-portal && npx vitest run src/lib/offline/photos.test.ts`. Owning-domain server tests must prove race-safe orphan cleanup and cross-org denial before enabling photos.
12. For **each** domain after its owning issue lands (#1517, #1522, #1512, #1519): add a failing pgTAP case to that domain's existing test for current permissions, changed state and same-key retry; add a failing adapter test in `pmo-portal/src/lib/offline/adapters.test.ts`; extend that domain's real transaction with receipt helper and register its existing repository command; rerun its named pgTAP under `scripts/with-db-lock.sh` and the adapter test. For stock explicitly test project/BoQ and insufficient/current stock, and run the money/SoD mutation check. The domain owner supplies actual file and function names at dispatch from shipped artifacts; do not merge an adapter to a speculative function.

### S4: identity and channel preferences (AC-PWA-011, 013, 014)

13. **Red:** create `supabase/tests/pwa_notification_identity.test.sql` for own preference, one active phone endpoint, cross-user/org refusal and revoked membership. Verify `scripts/with-db-lock.sh supabase test db supabase/tests/pwa_notification_identity.test.sql` fails.
14. **Green:** add `supabase/migrations/0546_pwa_notification_identity.sql` and matching rollback: user/org/category preference (`phone|lark|email`), one active endpoint per user/org, timestamped revocation, owner-scoped RLS, server-stamped actor/org and narrowly scoped writes. Rerun task 13 and mutation-test cross-user denial. Do not store credentials in a notification payload.
15. **Red:** create `pmo-portal/src/lib/db/notificationPreferences.test.ts` for preference read/save, unavailable provider and stale endpoint. **Green:** add `pmo-portal/src/lib/db/notificationPreferences.ts`, `pmo-portal/src/lib/repositories/notificationPreferences.ts` and `pmo-portal/src/hooks/useNotificationPreferences.ts`; preserve repository seam, invalidate user/org scoped keys. Verify `cd pmo-portal && npx vitest run src/lib/db/notificationPreferences.test.ts`.

### S5: event identity and delivery (AC-PWA-011, 012, 013)

16. **Red:** create `supabase/tests/pwa_delivery_intents.test.sql` proving duplicate producer and worker-race create one `(event, recipient)` intent, selected channel is snapshotted, and other tenants cannot read. Verify `scripts/with-db-lock.sh supabase test db supabase/tests/pwa_delivery_intents.test.sql` fails.
17. **Green:** add `supabase/migrations/0547_pwa_delivery_intents.sql` and rollback: intent keyed by stable event identity and recipient, channel snapshot, status `pending|claimed|sent|failed|unknown`, lease and provider reference. RLS limits owner reads; workers alone claim; producers reuse existing inbox and authoritative recipient logic. Rerun task 16 and mutation-test uniqueness and org checks.
18. **Red:** create `supabase/functions/pwa-notify/index.test.ts` importing `./index.ts`, mocking `globalThis.fetch`: one selected adapter only, inactive recipient, provider timeout, safe retry with provider idempotency, unknown without it. **Green:** implement `supabase/functions/pwa-notify/index.ts` with claim/recheck/send/reconcile state machine, no fallback, minimal push body; invoke existing email/Lark integrations only once verified available. Run `scripts/deno-test-edge-fns.sh` for this function and `node scripts/check-edge-fn-test-binding.mjs`.
19. **Red:** extend owning workflow tests for approval waiting, rejection, sync failure and low-cash event identity and responsible recipient. **Green:** connect each owning producer to the intent transaction, preventing duplicate existing external sends; run each directly touched test. #1515 determines cash recipient and threshold; #1521 supplies verified Lark identity. Do not activate unavailable providers.

### S6: UI and end-to-end (AC-PWA-001, 002, 004, 014, 015, 016)

20. **Red:** create `pmo-portal/src/components/offline/NeedsFixing.test.tsx` for offline/queued/unknown/rejected/confirmed states, retry, correction, accessible reasons and stale link. **Green:** implement `pmo-portal/src/components/offline/NeedsFixing.tsx` and `pmo-portal/src/hooks/useOfflineQueue.ts`, connect the app shell, and add strings to both `pmo-portal/public/locales/en/` and `id/`. Run `cd pmo-portal && npx vitest run src/components/offline/NeedsFixing.test.tsx`.
21. **Red:** create `pmo-portal/e2e/AC-PWA-001-installable-shell.spec.ts`, `AC-PWA-002-offline-queue.spec.ts`, `AC-PWA-004-sync.spec.ts` and `AC-PWA-015-needs-fixing.spec.ts`; read `docs/e2e-parallel-conventions.md`, tag isolation and use one real available domain journey. Cover offline enqueue/reload, live revalidation, rejection/correction and attachment where that domain has shipped. **Green:** fix application behavior; run `scripts/e2e-local.sh AC-PWA-001`, `scripts/e2e-local.sh AC-PWA-002`, `scripts/e2e-local.sh AC-PWA-004`, `scripts/e2e-local.sh AC-PWA-015` under the documented DB lock. Unsupported browser install prompts are tested as capability state, not synthetic proof of actual installation.
22. For touched UI run `scripts/ux-proof.sh` on the actual routes under the DB lock; owner judges captures. Final gates in `pmo-portal`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <actual touched files>` and directly touched Vitest files. Use exact changed paths at dispatch, not a near-full local suite. CI supplies the full gate. Verify migrations with touched pgTAP under lock; no reset unless migrations changed, then reset and test in one hold.

## AC → owning layer (ADR-0010)

| AC | Owner and proof | Slice |
|---|---|---|
| 001 | Playwright `e2e/AC-PWA-001-installable-shell.spec.ts` | S1/S6 |
| 002 | Playwright `e2e/AC-PWA-002-offline-queue.spec.ts` | S1/S6 |
| 003 | Vitest `src/lib/offline/capabilities.test.ts` | S1 |
| 004 | Playwright `e2e/AC-PWA-004-sync.spec.ts` | S2/S3/S6 |
| 005 | pgTAP owning domain's server test | S2/S3 |
| 006 | pgTAP `supabase/tests/pwa_receipts.test.sql` | S2 |
| 007 | Vitest `src/lib/offline/queue.test.ts` | S1 |
| 008 | Vitest `src/lib/offline/photos.test.ts` with repository transport integration | S3 |
| 009 | Vitest `src/lib/offline/queue.test.ts` | S1 |
| 010 | Vitest `src/lib/offline/queue.test.ts` | S1 |
| 011 | pgTAP `supabase/tests/pwa_delivery_intents.test.sql` | S5 |
| 012 | Deno `supabase/functions/pwa-notify/index.test.ts` | S5 |
| 013 | Deno `supabase/functions/pwa-notify/index.test.ts` | S5 |
| 014 | Vitest `src/components/offline/NeedsFixing.test.tsx` | S6 |
| 015 | Playwright `e2e/AC-PWA-015-needs-fixing.spec.ts` | S3/S6 |
| 016 | Vitest `src/auth/AuthProvider.test.tsx` | S1 |

AC IDs in table abbreviate `AC-PWA-`. Each has one owning layer; lower-level contract proofs may support a cross-stack journey. Domain integration and recipient selection remain blocked until their actual owning APIs and decisions exist. One active push endpoint is a proposed implementation of the single-message requirement and requires owner approval with OD-PWA-9.
