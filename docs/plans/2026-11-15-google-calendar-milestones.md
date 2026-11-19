# Google sign-in and Calendar milestone push implementation plan

> Planning artifact. Build only after owner sign-off; executor is an Orca worker (`docs/orca-dispatch.md`).
> Auth/token custody: Director-dispatched, Opus builder, all three reviewers, **ships alone**.

**Goal:** Google sign-in, plus one-way all-day Calendar events for dated phases and project end dates.
**Spec:** `docs/specs/google-calendar-milestones.spec.md`. **Stack:** Postgres/pgTAP, Deno edge function, React/Vitest.

## Architecture
Copy the shipped M365 custody shape; do not invent. New table `google_calendar_connections` (forced RLS, no
policy, ciphertext via the shared `graphTokenCrypto`). New outbox `calendar_push_outbox` filled by triggers on
`project_milestones` and `projects`. New edge function `google-calendar` (initiate, callback, calendars, revoke,
status) plus a sweep entry modelled on `supabase/functions/clickup-sweep`. Deterministic event id =
base32hex of the PMO row id (Google allows 5-1024 chars of `a-v0-9`), so inserts are idempotent. Reuse the
`org_features` two-switch (`google_calendar`). Sign-in is configuration plus one button; no new auth code.

## Migration
`NNNN_google_calendar_connections.sql` and `rollback/NNNN_google_calendar_connections_down.sql` — **number on
request** (recheck `git ls-tree -r --name-only origin/dev supabase/migrations` first; above 0882 today). Contents:
the connections table, the outbox, enqueue triggers, widened `org_features` check with `google_calendar`.

## Tasks (2-5 minutes each unless noted)
1. **pgTAP red:** `supabase/tests/google_calendar_connections.test.sql` — client roles cannot select/insert/
   update/delete; org_id stamped; unique active per org. Run: `scripts/with-db-lock.sh supabase test db supabase/tests/google_calendar_connections.test.sql`.
2. **Migration green:** table + forced RLS + revokes + rollback; rerun task 1.
3. **pgTAP red/green:** `calendar_push_outbox.test.sql` — phase insert/date change/clear/delete and project
   end-date change each enqueue exactly one row in the same transaction; archived project enqueues delete; an
   untouched save enqueues nothing; org isolation.
4. **Feature key:** widen `org_features` check; add `google_calendar` to `pmo-portal/src/lib/features.ts` (default
   off) with its unit test in `features.test.ts`.
5. **Pure mapper (Vitest red/green):** `pmo-portal/src/lib/googleCalendar/eventMap.ts` — row → event body
   (title, all-day `date`, link, no amounts) and deterministic id; test `eventMap.test.ts` incl. long names, null
   dates, id charset/length.
6. **Edge function skeleton:** `supabase/functions/google-calendar/{index,initiate,callback,status,revoke}.ts`
   mirroring `m365-token-custody` (auth, state store, audit). Tests import the shipped handler and mock
   `globalThis.fetch` (binding rule; `scripts/check-edge-fn-test-binding.mjs`). `cd supabase/functions/google-calendar && deno test`.
7. **Callback security tests:** reused/expired/foreign state rejected; no token in any response or log; ciphertext
   only stored (AC-004/005). Mutation-check: force `allowed = true` on state check, tests must go red.
8. **Sweep:** `sweep.ts` — claim a bounded batch, refresh token, insert-or-patch/delete per row, 409→patch,
   429/5xx backoff, invalid-grant→stale + audit/error event, per-row outcome codes (AC-007/009/010). Unit tests
   with mocked fetch and clock.
9. **Backfill + calendar list:** on connect enqueue all dated rows; `calendars` action lists writable calendars
   (AC-006/012).
10. **Disconnect:** best-effort revoke, delete ciphertext, status revoked (AC-011).
11. **Repository + hook:** `pmo-portal/src/lib/repositories/googleCalendar.ts` and `useGoogleCalendar.ts`;
   Vitest.
12. **Status card UI:** Admin-only card in the Integrations area using `can()`/`useFeature`, shared form
   primitives, all states (off, not connected, active, stale, failed items); RTL tests for each state and the
   non-Admin absence (AC-003/012); `scripts/ux-proof.sh` on the touched route.
13. **Sign-in:** `signInWithGoogle` in `AuthProvider.tsx`, button in `LoginPage.tsx`, hidden when unconfigured;
   update `LoginPage.test.tsx` (AC-001/002); commented local template in `supabase/config.toml`; cloud dashboard
   steps added to `docs/environments.md` (names no secrets).
14. **Two-org pgTAP/unit proof** (AC-013) and one curated e2e journey: Admin connects against a stubbed Google
   (`pmo-portal/e2e/AC-GCAL-006-google-calendar-push.spec.ts`; gate on the stub dependency, never `process.env.CI`).
15. **Docs:** `docs/glossary.md` term "Calendar push", short runbook section, roadmap update.
16. **Final gate (per CLAUDE.md local gate):** `npm run check:guards`, `npm run typecheck`, eslint on touched
   files, touched tests only, touched pgTAP only, `node scripts/affected-e2e.mjs`.
17. **Reviews:** spec-reviewer, code-quality-reviewer, security-auditor (mandatory; OWASP/STRIDE on callback,
   state, custody, outbox RLS, cross-org drain).

## Traceability (ADR-0010)
| AC | Owning layer | Test |
|---|---|---|
| AC-GCAL-001 | Unit | `LoginPage.test.tsx` |
| AC-GCAL-002 | Unit (client message) + provider config | `LoginPage.test.tsx`; refusal itself is Supabase's `enable_signup=false`, verified in the manual dev check |
| AC-GCAL-003 | pgTAP + Deno + Unit | feature-gate pgTAP, function `featureEnforcement.test.ts`, card RTL test |
| AC-GCAL-004 | pgTAP + Deno | `google_calendar_connections.test.sql`, callback test |
| AC-GCAL-005 | Deno | callback state tests |
| AC-GCAL-006 | E2E | `AC-GCAL-006-google-calendar-push.spec.ts` (mapper detail in Unit) |
| AC-GCAL-007 | Deno | sweep idempotency test |
| AC-GCAL-008 | pgTAP + Unit | outbox triggers; mapper |
| AC-GCAL-009 | Deno | sweep backoff test |
| AC-GCAL-010 | Deno | sweep invalid-grant test |
| AC-GCAL-011 | Deno | revoke test |
| AC-GCAL-012 | Unit | status card RTL |
| AC-GCAL-013 | pgTAP | `calendar_push_outbox.test.sql` |

## Risks
Google "sensitive scope" verification is required before any external (multi-org) client; an internal-type
app avoids it for a single org. Production Google credentials are an owner/operator step, never committed.

## Owner questions (recommended answer in brackets)
1. Per-org shared connection by an Admin pushing to one chosen calendar, or per-user personal calendars? [Per-org shared; per-user later.]
2. Push only phases and project end dates, or also task due dates and work-order dates? [Phases and end dates only; add the rest on demand.]
3. Is the first client an internal Google Workspace app (no Google review) or must we pursue sensitive-scope verification now? [Internal first; verify only when a second org needs it.]
