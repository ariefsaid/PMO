# Spec: Observability floor (GTM / MVP-viability program, item 3)

Establishes the minimum, vendor-consolidated observability layer the PMO Portal needs **before/at
the first paying client**: edge-function failures reach the owner via a Telegram alert, frontend
exceptions land in PostHog, outside-in uptime is monitored by BetterStack, and two PostHog
dashboards make org usage and agent activity legible. This is intentionally a *floor*, not a
platform — log aggregation, APM, tracing, and Sentry are explicitly out (owner CUT list).

- **Grounds (READ FIRST, this worktree):** `docs/backlog.md` §"GTM / MVP-viability program" item 3
  + the **BUILD-LOOP AUTHORIZED** block (locked inputs: alerts → Telegram bot; uptime/status =
  BetterStack; no Sentry — PostHog rides the existing SDK) · `supabase/functions/_shared/errorLog.ts`
  (the #224 structured `errorCode` choke point this consumes) · `docs/analytics-events.md`
  (safe-properties + `property_denylist` lessons) · `pmo-portal/src/lib/analytics/{client,config,events,safeTrack,index}.ts`
  (PostHog init + gated `safeTrack`) · ADR-0022 (PostHog adoption; error tracking was a *deferred*
  follow-up — this spec delivers it) · ADR-0047 (per-client Supabase Cloud Pro topology → secrets +
  runbooks are per-deployed-project) · `supabase/migrations/0048_agent_automations_notifications.sql`
  (the proven `pg_cron` → `net.http_post` → `app.settings.dispatch_url` seam this reuses) ·
  `supabase/migrations/0047_agent_usage_credits.sql` (the `agent_usage.cost` / `credits.amount`
  ledgers the agent-cost dashboard cross-references) · `pmo-portal/src/components/ErrorBoundary.tsx`
  (the `componentDidCatch` wire-point for FE exception capture) · `scripts/check-agent-prod-readiness.mjs`
  (the existing outside-in edge-fn probe pattern) · `docs/environments.md` (which already flags the
  "durable error-events table / webhook alert" with `errorLog.ts` errorCodes as the hook point —
  this spec IS that flagged next step) · CLAUDE.md "Spec & test conventions".
- **Grill status:** DONE (owner-approved 2026-07-04). This spec **encodes** the locked decisions; it
  does not re-open them. No `AskUserQuestions` round is authored here.

## Overview & user value

**Job story.** When an edge function fails in a deployed client project (missing secret, dispatch
tick failure, automation mint/audit/fire failure, model/credit-rate error), the **Operator** (the
platform persona; for this program = `arief.said@gmail.com`) wants to **learn about it within
minutes from a channel they already watch** (Telegram), so that they can respond before a client
notices — *without* the alert path ever being able to block, slow, or crash the very function it is
reporting on. Separately, when the frontend throws, the **engineer** wants those exceptions
aggregated in the same analytics tool already in the bundle (PostHog), so a second vendor (Sentry)
is never added. And before any of that, the **Operator** wants an outside-in "is it up?" answer
(BetterStack status page) they can show a prospect, because uptime *is* the MVP SLA answer.

**Why these four pieces, together:** they are the smallest closed loop — *detect* (uptime + error
capture), *notify* (Telegram), *understand* (PostHog dashboards). Any one alone leaves a blind
spot; together they are the floor under "we will know when production is broken."

**User value:** minutes-to-awareness of a production failure (Telegram); a credible client-facing
status page (BetterStack); a single privacy-safe error sink (PostHog); and legible usage/cost
signals (dashboards) — all on vendors already chosen, with zero new SDK weight on the client.

## Scope

**IN (this issue — four pieces):**

1. **Telegram alert webhook** — a durable `error_events` table fed by the edge functions'
   `logStructuredError` call sites, drained to a Telegram chat by a `pg_cron`-triggered
   `telegram-notify` edge function, with per-`errorCode` cooldown dedupe (a burst of identical
   errors becomes one message, not a flood). Secrets `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are
   function secrets on `telegram-notify` (env seam; values wired per deployed project, later).
2. **PostHog error tracking (FE)** — enable `posthog-js` exception capture through the existing
   `analyticsClient` boundary, gated by the existing analytics flags, scrubbed by the existing
   safe-properties/`property_denylist` discipline (no PII/content in captured errors). Wired into
   the app-level `ErrorBoundary` + global unhandled-exception/rejection handlers.
3. **Uptime/status (BetterStack)** — config deliverable: two monitors (FE URL + one edge-fn health
   endpoint) + a client-facing status page. No cheap public health endpoint exists today, so this
   issue ships a minimal **`health` edge function** (`GET` only, no auth, returns `{ok, version, ts}`
   — no data, no secrets). Documented as NFR + a new **runbook section in `docs/environments.md`**
   ("Observability & alerting").
4. **Two PostHog dashboards** — config deliverable, spec'd as a checklist: **(a) org usage**
   (weekly actives, top pages) and **(b) agent activity/cost** (volume over the 9 typed agent event
   builders, #215/AC-APH-016, cross-referenced to the `agent_usage.cost` / `credits.amount` ledgers
   surfaced by the Ops-Admin usage view, GTM item 1c).

**OUT (owner CUT list — do NOT add):** Sentry · log aggregation (Loki/Datadog/CloudWatch logs) ·
APM · distributed tracing / OpenTelemetry · browser console-log capture · SLA penalties / SLO
budgets · a sixth enum role for the Operator (Operator = a platform-level grant, per GTM item 1d) ·
any monitoring vendor beyond BetterStack + PostHog + Telegram · PostHog feature-flags/surveys/reverse-proxy
(still deferred per ADR-0022) · in-app alert UI (the Telegram chat IS the surface at this scale).

## Locked Decisions (grill, 2026-07-04 — encoded, not re-opened)

- **LD-OF-001 (alert channel):** Telegram bot → a single owner-watched chat. No email/Slack/PagerDuty
  at this scale.
- **LD-OF-002 (uptime/status vendor):** BetterStack (owner priority order: professional client-facing
  status page > reliability > ease). BetterStack is also the monitor source; PostHog is **not** an
  outside-in uptime tool.
- **LD-OF-003 (no Sentry):** PostHog error tracking rides the SDK already in the bundle. A second
  error vendor is never introduced.
- **LD-OF-004 (alert must be fire-and-forget AND loss-less):** the alert path may never block, slow,
  or crash the calling edge function, AND may never silently drop an alert on a transient Telegram
  outage / isolate termination. These two constraints together rule out "fetch Telegram from inside
  the failing function" (see Design choice DC-OF-001).
- **LD-OF-005 (per-errorCode cooldown, not per-stack):** dedupe is keyed on the structured
  `errorCode` (the #224 contract), not on a stack hash, because `errorLog.ts` is deliberately
  stack-free and a burst of the same `errorCode` is one operational incident.
- **LD-OF-006 (secrets seam):** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are **function secrets**
  on the `telegram-notify` edge function (Deno env), not DB GUCs — read via `Deno.env.get(...)`,
  values wired per deployed project later (1Password vault `AS` per ADR-0047). The `pg_cron` → fn
  trigger URL + service-role auth ride the same GUC seam as agent-dispatch (`app.settings.*`).
- **LD-OF-007 (no PII/content in any captured signal):** Telegram messages and PostHog exceptions
  carry only the structured `errorCode` / error type / redacted message — never prompt text, user
  content, names, monetary values, or secrets (consistent with `docs/analytics-events.md` and the
  `errorLog.ts` compile-time-scrub design).
- **LD-OF-008 (dashboards read existing signals; they add no new events):** the two PostHog
  dashboards are built from events already in the contract (route/login events; the 9 agent builders).
  No new analytics event is introduced by this spec.

## Design choices (recorded per the dispatch brief)

### DC-OF-001 — Telegram delivery path: **(a) durable `error_events` table + `pg_cron` → `telegram-notify` edge-fn drain** (CHOSEN) over (b) direct `fetch` to Telegram from `errorLog.ts`

The brief asked to evaluate and recommend the "simplest reliable path." Evaluated against the two
binding constraints from LD-OF-004 (**cannot lose the alert** AND **cannot block/crash the calling
function**):

| | (a) table + pg_cron → edge-fn drain | (b) direct `fetch` from `errorLog.ts` |
|---|---|---|
| Cannot lose the alert | ✅ Durable `INSERT` lands before any network call; a Telegram outage just leaves `notified_at IS NULL` → retried next tick | ❌ The in-flight `fetch` is killed when the edge-fn isolate returns/errors (Deno terminates the isolate); a Telegram outage during the call drops the alert entirely |
| Cannot block/crash the caller | ✅ Caller does one fast fire-and-forget `INSERT` (sub-ms, service-role); the Telegram POST happens in a *separate* cron-triggered isolate | ⚠️ Even "fail-quiet" adds latency and an unawaited promise inside the failing function's own runtime |
| Cross-invocation dedupe (LD-OF-005) | ✅ Cooldown is a SQL window over `error_events` — state survives across invocations | ❌ Edge-fn isolates are stateless between invocations → no real cooldown, only per-invocation debounce (a burst across N requests still spams N messages) |
| Keeps `errorLog.ts` pure | ✅ The #224 choke point is **untouched** — still a pure console-error logger, no Deno globals, importable in Vitest (ADR-0039 decision-7 pattern) | ❌ Would inject `Deno.env` + `fetch` into the one file explicitly documented as "Pure: takes a plain object, no Deno globals" — breaking its testability contract and its compile-time secret-scrub guarantee |
| Reuses a proven seam | ✅ Identical shape to agent-dispatch (`0048_agent_automations_notifications.sql`: `pg_cron` `net.http_post` → `app.settings.dispatch_url` w/ service-role bearer) | — (new pattern) |
| Parts count | table + migration + RLS + 1 RPC/schedule + 1 thin edge fn | 1 mutated function |

**Recommendation: (a).** (b) is *fewer files* but fails both binding constraints: it can lose the
alert (isolate termination) and cannot really dedupe (no cross-invocation memory), and it pollutes
the pure `errorLog.ts` choke-point. (a) is the simplest path that **provably** satisfies
"fire-and-forget" AND "cannot lose." The cost is one append-only table + one cron schedule reusing
the already-deployed `pg_cron`/`pg_net` extensions.

**Concrete shape (a):**

1. **`errorLog.ts` stays pure and unchanged.** Every existing call site keeps `logStructuredError({fn, errorCode, contextId?})`
   for the human/ops console line. (OBS-OF-001.)
2. **A new fire-and-forget companion** — `recordErrorEvent(supabase, {fn, errorCode, contextId?, orgId?})`
   in `supabase/functions/_shared/errorEvent.ts` (pure-logic + injected client, mirroring
   `usage.ts`/`modelResolution.ts`) — is called **immediately after** `logStructuredError(...)` in
   the three agent edge functions (`agent-chat`, `compose-view`, `agent-dispatch`). It does one
   service-role `INSERT` into `public.error_events` and **swallows its own failure** (logged via
   `logStructuredError({fn:'telegram-notify'-independent, errorCode:'ERROR_EVENT_INSERT_FAILED'})`,
   never rethrown). The real error path the user is on is never perturbed.
3. **`public.error_events`** (migration) — append-only: `id, fn, error_code, context_id, org_id?,
   created_at, notified_at`. `force row level security`; **no SELECT/INSERT policy for any `auth.role()`**
   — writes are service-role-only (the edge fns), reads are service-role-only (the notifier).
   Client/anon cannot read or write it (it is operator telemetry, never user-facing).
4. **`pg_cron` schedule** (migration, guarded like 0048's) — every **2 minutes**, `net.http_post` to
   `app.settings.telegram_notify_url` (the deployed `telegram-notify` fn URL) with the
   `app.settings.service_role_key` bearer — exactly the agent-dispatch GUC seam, just a second URL.
5. **`telegram-notify` edge function** — reads unnotified `error_events` (service-role) **and**, in
   the same tick, issues a second query `SELECT error_code, MAX(notified_at) AS last_notified FROM
   error_events WHERE notified_at IS NOT NULL GROUP BY error_code` (the cross-drain cooldown input,
   I-2). It passes both result sets to the pure helpers, which apply the **per-`errorCode` cooldown**
   (default 15 min; configurable via `app.settings.telegram_cooldown_seconds`): a code whose
   `last_notified` is within the window is suppressed this tick and its new rows are marked
   `notified_at` without a send. The remaining rows are grouped (one message per `errorCode`
   carrying a `count` + first/last `created_at` + a sample `context_id`), POSTed once per group to
   the Telegram Bot API (`https://api.telegram.org/bot<token>/sendMessage`, `chat_id` + `text` +
   `parse_mode=Markdown`), then marks `notified_at = now()` for the whole group. Reads
   `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from `Deno.env`. A Telegram non-2xx / network error
   leaves `notified_at NULL` → retried next tick (at most 2-min latency, never lost). **On each
   successful tick completion** it fire-and-forget `GET`s an optional `HEARTBEAT_URL` function
   secret (a BetterStack heartbeat monitor, FR-OF-021) — no-op when unset, never blocks — so a dead
   cron/alert path surfaces as a missed heartbeat rather than silence (I-3).
6. **Pure, unit-tested helpers** extracted from the fn (the dedupe/cooldown windowing + the
   message-builder) live in `telegram-notify/logic.ts` — importable in Vitest with mocked `fetch`,
   per ADR-0039 decision-7 and the brief's "webhook logic = unit-testable pure functions + mocked
fetch."

### DC-OF-002 — PostHog error tracking: capture through `analyticsClient`, gated + scrubbed, wired at the boundaries

`posthog-js` already ships exception capture; ADR-0022 deliberately **deferred** it. This spec
turns it on, but **through the existing boundary** so the privacy discipline in
`docs/analytics-events.md` is honored:

- **One new method on `analyticsClient`:** `captureException(input: { name: string; message: string; componentStack?: string })`.
  It is a **no-op unless the full capture gate passes** — `if (!initialized || !activeConfig?.enabled)
  return;`, mirroring `capture` exactly (M-6: a config-enabled-but-not-yet-init'd client must still
  no-op; same two conditions as the `capture` path in `client.ts`). This means **local/dev default
  and any session without a valid key send nothing** — errors are only captured in deployed/demo/prod
  builds that already opted into analytics. (FR-OF-010.)
- **Ingest contract = `posthog.captureException(error)`, NOT a hand-rolled event (M-4):** the method
  builds a synthetic `Error` from `{ name, message, componentStack }` (componentStack attached) and
  calls `posthog.captureException(err)`, so the event is ingested under PostHog's documented
  exception schema and lands in the **Error Tracking** UI. A manual `posthog.capture('$exception',
  {...})` with hand-rolled `$exception_*` props is explicitly **not** used — it is not guaranteed to
  appear in the Errors tab.
- **Redaction via a `before_send` / payload-transform hook, not at the call site:** a `before_send`
  hook registered at init applies the safe-properties discipline to **every** outbound event,
  including exceptions — (i) strip URL query strings from `$exception_message` / `$exception_stacktrace`,
  (ii) drop anything matching the `FORBIDDEN_PROPERTY_KEYS` shapes (emails, tokens, etc.), (iii)
  **truncate** the stack to a bounded length. The captured exception is **never raw user content,
  prompt text, or PII** (NFR-OF-PRIV-002). The `property_denylist` lesson from `client.ts` (denylist
  must exclude `token` because PostHog's own API key rides as `properties.token`) is preserved — we
  scrub `token` in the transform, we do NOT add it to the SDK denylist.
- **Wire-points (no new UX):** (i) `ErrorBoundary.componentDidCatch` (currently only `console.error`)
   → `safeTrack(() => analyticsClient.captureException(...))` (reuses the fire-and-forget guard,
   NFR-APH-REL-001); (ii) a one-time `window.addEventListener('error'|'unhandledrejection')`
   registered inside `AnalyticsProvider` after init. Both go through `safeTrack` so a PostHog fault
   can never white-screen the app.

### DC-OF-003 — Health endpoint: a dedicated minimal `health` edge function (none exists today)

`scripts/check-agent-prod-readiness.mjs` confirms there is **no public GET health endpoint** today —
the agent fns are auth-gated POST/SSE, and the readiness probe infers "alive" from an
`OPTIONS`-preflight + a "401-without-auth" response. BetterStack needs a plain anonymous `GET → 200`,
so this issue ships **`supabase/functions/health/index.ts`**: `GET` (and `HEAD`) only, **no auth**,
**CORS-open for GET/HEAD only**, returns `200 { ok: true, service: 'pmo-edge', version: <Deno.env DEPLOY_VERSION|'unknown'>, ts: <iso> }`.
It reads **no** secrets, queries **no** tables, and exposes **no** data — it proves only "the edge
runtime is deployed and serving." The response-builder is a pure helper (unit-tested); the deployed
`200` is a live-verify step.

### DC-OF-004 — Dashboards are config deliverables over existing events; $$ cost stays in the ledger view

Per LD-OF-008, the dashboards add **no** new events. **(a) Org usage** is built over
`app_route_viewed` (top pages by `route`/`module`) and `auth_login_succeeded` (weekly actives =
distinct `$user_id` with ≥1 event in 7d), filterable by `org_id`. **(b) Agent activity/cost** is
built over the **9 typed agent event builders** (#215, AC-APH-016): `agent_panel_opened`,
`agent_run_started`, `agent_run_completed`, `agent_run_errored`, `agent_approval_shown`,
`agent_approval_decided`, `agent_thread_resumed`, `agent_feedback_rated`,
`agent_compose_view_saved` — counts by type, run completion/error rate, the approval funnel, and the
feedback rating split, segmented by `org_id`. The **authoritative $$ cost/margin** (credits granted
vs `agent_usage.cost` burned) lives server-side in `agent_usage` + `credits` and is surfaced by the
**Ops-Admin usage view** (GTM item 1c) — the PostHog dashboard cross-references activity *volume*
against it and links to that view as the $$ source of truth. This keeps monetary data out of
PostHog entirely (NFR-OF-PRIV-001) while still answering "how much agent activity per org."

## Observed / legacy behavior to preserve (OBS)

- **OBS-OF-001 — `errorLog.ts` stays pure.** Its signature `logStructuredError({fn, errorCode, contextId?})`,
  its "no Deno globals / importable in Vitest" invariant, and its compile-time-scrub design (no slot
  for an arbitrary payload) are **unchanged** by this spec. The durable `error_events` write is a
  *separate* companion (`errorEvent.ts`) invoked alongside it, never a mutation of `errorLog.ts`.
- **OBS-OF-002 — `analyticsClient` boundary is the only `posthog-js` import.** Exception capture is
  added as a method on the existing facade (`client.ts`), not a new direct SDK import elsewhere
  (AC-PH-016 stays green).
- **OBS-OF-003 — `safeTrack` is the fire-and-forget guard for FE analytics.** Exception capture
  call sites use `safeTrack(() => analyticsClient.captureException(...))`, inheriting
  NFR-APH-REL-001 (fail-safe, logged, never rethrown) — the same guard already wrapping the 9
  `trackAgent*` builders.
- **OBS-OF-004 — agent-dispatch's `pg_cron` → `net.http_post` → `app.settings.dispatch_url` seam
  is the template.** The Telegram drain reuses it verbatim with a second URL GUC
  (`app.settings.telegram_notify_url`); no new infra pattern is introduced.

## Functional Requirements (EARS)

### Piece 1 — Telegram alert webhook

- **FR-OF-001** — When any agent edge function (`agent-chat`, `compose-view`, `agent-dispatch`)
  reaches a failure path that calls `logStructuredError({fn, errorCode, contextId?})`, the system
  shall, in the same handler invocation, also attempt a fire-and-forget `INSERT` into
  `public.error_events` carrying `{fn, error_code, context_id, org_id?}` via the service-role
  client.
- **FR-OF-002** — When the `error_events` insert itself fails (DB down, RLS, etc.), the system
  shall swallow the failure (log a structured `ERROR_EVENT_INSERT_FAILED` line, never rethrow) so
  the user's original error path is unaffected.
- **FR-OF-003** — The `public.error_events` table shall be append-only and enforce row-level
  security with **no policy for any authenticated/anon role**; only the service role may read or
  write it.
- **FR-OF-004** — Where `pg_cron` and `pg_net` are available, the system shall register an
  idempotent schedule (default every 2 minutes) that `net.http_post`s to
  `app.settings.telegram_notify_url` with the `app.settings.service_role_key` bearer.
- **FR-OF-005** — When the `telegram-notify` edge function is invoked, it shall select unnotified
  `error_events` (`notified_at IS NULL`) **and** issue a second query
  `SELECT error_code, MAX(notified_at) FROM error_events WHERE notified_at IS NOT NULL GROUP BY
  error_code`, pass both result sets to its pure helpers, collapse the *unsuppressed* rows into one
  group per `error_code` within the configured cooldown window (a code whose last `notified_at` is
  within the window is suppressed this drain — cross-drain cooldown), and send **at most one Telegram
  message per `error_code`** per drain.
- **FR-OF-006** — When a Telegram message is built, the system shall include only: environment,
  `fn`, `error_code`, burst `count`, first/last `created_at`, and a sample `context_id` — and shall
  **never** include `org_id` raw-UUID in the message text (it is telemetric noise + a soft
  identifier), prompt text, user content, or any secret.
- **FR-OF-007** — When the Telegram Bot API returns non-2xx or the request errors, the system
  shall leave the group's `notified_at` `NULL` so it is retried on the next tick, and shall not
  raise.
- **FR-OF-008** — The `telegram-notify` edge function shall read `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_CHAT_ID` from `Deno.env` (function secrets) and shall fail closed (skip the send, leave
  `notified_at NULL`, log `TELEGRAM_SECRET_MISSING`) when either is unset, rather than sending to a
  default chat.
- **FR-OF-009** — The cooldown window and drain cadence shall be configurable via
  `app.settings.telegram_cooldown_seconds` (default 900) and the cron schedule respectively,
  without a code change.
- **FR-OF-021 (Piece 1 addition — dead-man's-switch for the alert path, I-3)** — When the
  `telegram-notify` drain completes a successful tick (groups either sent or intentionally suppressed
  within cooldown), the system shall fire-and-forget `GET` an optional `HEARTBEAT_URL` function
  secret (a BetterStack heartbeat monitor URL). It shall no-op when `HEARTBEAT_URL` is unset, shall
  never block on the request, and shall swallow any network/non-2xx error (the heartbeat is
  best-effort telemetry, never on the alert path). If the cron/alert path dies (`pg_cron` stops,
  `telegram-notify` persistently errors, bot token revoked), the missed heartbeat is what surfaces
  it — closing the persistent-silence gap (NFR-OF-REL-002).

### Piece 2 — PostHog error tracking (FE)

- **FR-OF-010** — The `analyticsClient` shall expose `captureException({name, message, componentStack?})`
  that no-ops unless the **full** capture gate passes (`if (!initialized || !activeConfig?.enabled)
  return;`, mirroring `capture` exactly — M-6), and shall ingest via `posthog.captureException(error)`
  (not a hand-rolled `$exception` event — M-4) so the event appears in PostHog **Error Tracking**.
- **FR-OF-011** — When `captureException` is called and analytics is enabled, the system shall
  redact the exception message and component stack (strip query strings, drop forbidden-key shapes,
  truncate) via a `before_send` / payload-transform hook before they leave the SDK — applied to the
  `captureException` payload as part of the safe-properties discipline.
- **FR-OF-012** — When the app-level `ErrorBoundary` catches a render error, the system shall call
  `safeTrack(() => analyticsClient.captureException({name, message, componentStack}))` once per
  caught error, in addition to the existing `console.error`.
- **FR-OF-013** — Where analytics is enabled, the `AnalyticsProvider` shall register global
  `error` and `unhandledrejection` listeners (once) that route through the same
  `safeTrack(captureException)` path.
- **FR-OF-014** — When analytics is disabled, neither `ErrorBoundary` nor the global listeners
  shall make any network call or import `posthog-js` indirectly beyond the existing no-op facade.

### Piece 3 — Uptime/status (BetterStack) + health endpoint

- **FR-OF-015** — The system shall provide a public `GET /functions/v1/health` endpoint
  (`supabase/functions/health/index.ts`) requiring no auth, returning `200
  { ok: true, service: 'pmo-edge', version, ts }` on `GET`/`HEAD`, and `405` otherwise.
- **FR-OF-016** — The `health` endpoint shall read no secrets, query no tables, and expose no user
  or business data; `version` comes from `Deno.env.get('DEPLOY_VERSION') ?? 'unknown'`.
- **FR-OF-017** — The `health` endpoint shall set permissive CORS for `GET`/`HEAD` only and shall
  not reflect any request body or header back in the response.

### Piece 4 — PostHog dashboards (config deliverable)

- **FR-OF-018** — The system shall deliver a PostHog **Org usage** dashboard with at minimum:
  weekly-active-users (distinct identified users with ≥1 event in 7d), top pages
  (`app_route_viewed` by `route`), and an `org_id` breakdown filter.
- **FR-OF-019** — The system shall deliver a PostHog **Agent activity/cost** dashboard with at
  minimum: total + per-`org_id` counts for each of the 9 agent builders, run completion rate
  (`agent_run_completed` / `agent_run_started`), error rate (`agent_run_errored` /
  `agent_run_started`), the approval funnel (`agent_approval_shown` → `agent_approval_decided`),
  and feedback rating split — plus a text panel linking to the Ops-Admin usage view as the $$
  source of truth.
- **FR-OF-020** — The dashboards shall be documented (name + URL + panel definitions) in the
  `docs/environments.md` "Observability & alerting" section so they are reproducible per deployed
  project.

## Non-Functional Requirements

### Security (OWASP / STRIDE)

- **NFR-OF-SEC-001** — `error_events` shall be service-role-only (no client/anon read or write);
  a forged client JWT can neither enumerate operator telemetry nor inject fake alerts (pgTAP proof,
  AC-OF-004).
- **NFR-OF-SEC-002** — The `telegram-notify` edge function shall authenticate its caller via the
  service-role bearer on the `pg_cron` `net.http_post` (same as agent-dispatch); an anonymous
  direct POST to `telegram-notify` shall be rejected `401`.
- **NFR-OF-SEC-003** — Telegram secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) shall never
  appear in logs, Telegram message text, the `error_events` row, or a git-tracked file; they are
  function secrets wired per deployed project via the 1Password `AS` vault (ADR-0047).
- **NFR-OF-SEC-004** — The `health` endpoint shall disclose no secret, token, internal URL, user
  id, or business value — only `ok`, `service`, `version`, `ts`.
- **NFR-OF-SEC-005 (STRIDE — Tampering/Replay):** the alert path is idempotent per
  `error_code`-cooldown window; a duplicate/cron-retry cannot produce duplicate Telegram messages
  for the same window, and a `notified_at` stamp makes a drain at-most-once-per-group.

### Privacy

- **NFR-OF-PRIV-001** — No PostHog event or dashboard panel shall include monetary values; the
  authoritative credit/usage $$ stays in `agent_usage`/`credits` (server-side), surfaced by the
  Ops-Admin usage view — PostHog shows activity volume only.
- **NFR-OF-PRIV-002** — Captured FE exceptions shall contain no PII or user content: messages and
  stacks are redacted (query strings stripped, forbidden-key shapes dropped, length-truncated)
  before capture (AC-OF-007).
- **NFR-OF-PRIV-003** — Telegram messages shall carry only structured codes and timestamps, never
  prompt text, user content, names, or `org_id` raw UUIDs in the text body (AC-OF-006/AC-OF-010).

### Reliability

- **NFR-OF-REL-001** — The alert path shall be fire-and-forget from every consumer: an
  `error_events` insert failure, a Telegram outage, or a PostHog capture fault shall never throw
  into, block, or crash the calling edge function or the FE render (AC-OF-003, AC-OF-008).
- **NFR-OF-REL-002** — The alert path shall be loss-less against **transient** Telegram
  outages / isolate termination only: unnotified rows are retried on the next cron tick (AC-OF-005).
  It is **not** loss-less against persistent alert-path failure (`pg_cron` stops firing,
  `telegram-notify` persistently 5xx's, or the bot token is revoked) — that single-point-of-silence
  is closed by the drain's success-tick heartbeat to a BetterStack heartbeat monitor (FR-OF-021,
  AC-OF-015), which alerts when the cron/alert path stops reporting; it is not closed by retry alone.
- **NFR-OF-REL-003** — The health endpoint shall have no upstream dependency (no DB, no secret
  read) so that it stays green when the DB is down — its job is "is the edge runtime up", not "is
  the DB up" (the DB layer has its own Supabase status).

### Performance

- **NFR-OF-PERF-001** — The `error_events` insert shall add ≤ a single indexed service-role
  `INSERT` to the failing request's latency budget (target < 50 ms p99 on Supabase Pro); the
  Telegram POST happens off the request path entirely.
- **NFR-OF-PERF-002** — FE exception capture shall not block first render, auth resolution, or
  route transitions (inherits NFR-PH-PERF-001 via `safeTrack`).
- **NFR-OF-PERF-003 (M-5) — Health endpoint rate-limit / abuse posture:** the `health` endpoint
  applies **no app-level rate limit** at MVP scale — the handler is a no-op-cheap pure response
  (no DB, no secret read), and Supabase edge-function invocation quotas are the backstop against
  abuse / cost amplification. Revisit (add a per-IP cap or short CDN cache) only on observed abuse.

### Maintainability

- **NFR-OF-MAINT-001** — Cooldown/cadence shall be env-configurable (`app.settings.telegram_cooldown_seconds`,
  cron schedule) with no redeploy for a tuning change (FR-OF-009).
- **NFR-OF-MAINT-002** — New `errorCode`s from future edge functions shall flow into the alert
  channel with zero code change (they are data in `error_events`), as long as the emitting fn
  calls `recordErrorEvent`.

### Test (ADR-0010 pyramid — one owning layer per AC)

- **NFR-OF-TEST-001** — Webhook logic (dedupe/cooldown windowing, message build, fire-and-forget
  swallow, Telegram non-2xx → retry) shall be owned by **Unit (Vitest)** over pure helpers in
  `telegram-notify/logic.ts` + `errorEvent.ts` with **mocked `fetch`/supabase**.
- **NFR-OF-TEST-002** — The `error_events` service-role-only RLS contract shall be owned by
  **Integration (pgTAP, `supabase test db`)**.
- **NFR-OF-TEST-003** — PostHog exception capture (gating, redaction, `ErrorBoundary`/global wiring)
  shall be owned by **Unit (Vitest/RTL)** with the SDK mocked.
- **NFR-OF-TEST-004** — The `health` response-builder shall be owned by **Unit (Vitest)**; the
  deployed `200`/CORS/`405` behavior has **no CI runtime** (Deno edge) and is covered by the
  **live-verify runbook** section (NFR-OF-RUN-001).
- **NFR-OF-TEST-005** — Edge-function `index.ts` files (`telegram-notify`, `health`) are
  integration-only and **not unit-tested in CI**, mirroring ADR-0039 decision-7 for
  `agent-chat/index.ts`; they pass `deno check` in CI (the #227 gate) and their runtime behavior is
  proven by the live-verify runbook.
- **NFR-OF-TEST-006 (AC-id tagging, binding):** every owning test shall name its `AC-OF-###` in its
  title/description so `grep -r AC-OF-` finds the canonical proof at whatever layer owns it (Vitest
  in the `it(...)` title; pgTAP as the leading token of the test description).

### Runbook (deliverable)

- **NFR-OF-RUN-001** — This issue shall add an **"Observability & alerting"** section to
  `docs/environments.md` covering: BetterStack monitors (FE URL + `/functions/v1/health` + one
  **heartbeat monitor** whose URL is the `telegram-notify` `HEARTBEAT_URL` function secret,
  FR-OF-021) + status page; the Telegram alert path + secret wiring
  (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` + optional `HEARTBEAT_URL` function secrets,
  `app.settings.telegram_notify_url` + cooldown GUCs, set per deployed project); the PostHog
  dashboards (names, panel definitions, per-project repro); and the **live-verify steps** (trigger
  a real `errorCode` → confirm the Telegram message arrives; fire a burst → confirm one deduped
  message; `curl /functions/v1/health` → `200`; force an FE throw → confirm a redacted PostHog
  exception appears; **from a real browser, confirm a route event lands in PostHog** (re-confirming
  existing analytics capture, M-7)). This section is the seed that the future
  `docs/runbooks/inccident-response.md` (GTM item 5) will consume.

## Acceptance Criteria (Given/When/Then)

> Owning layer is annotated per AC (ADR-0010). Edge-fn `index.ts` runtime behavior with no CI
> runtime is marked **[live-verify]** and proved by the NFR-OF-RUN-001 runbook step, not a test.

### Piece 1 — Telegram alert webhook

- **AC-OF-001 — Burst of identical errorCodes yields one message.** *(FR-OF-005/006, LD-OF-005;
  owning layer: Unit/Vitest, `telegram-notify/logic.test.ts`)*
  Given five `error_events` rows with the same `error_code='TICK_FAILED'` within the cooldown
  window and two rows of a different `error_code='MISSING_OPENROUTER_API_KEY'`, When the drain
  logic runs, Then it produces exactly two outbound Telegram messages (one per `error_code`), each
  carrying `count=5` and `count=2` respectively, and the `it(...)` title begins with `AC-OF-001`.

- **AC-OF-002 — Cooldown suppresses repeats across drains.** *(FR-OF-005/009; owning layer:
  Unit/Vitest)*
  Given the drain's second query returns `lastNotifiedByCode = { 'TICK_FAILED': <5 min ago> }`
  (cooldown 15 min) and new unnotified rows for `TICK_FAILED` arrive, When `selectNotifiedCandidates`
  / `groupIntoMessages` run with `lastNotifiedByCode` as an explicit input, Then no new message is
  sent for `TICK_FAILED` (suppressed within the window) and the rows are marked `notified_at`
  without a send — proving cross-drain suppression is computable from the pure-fn inputs alone
  (I-2), and the `it(...)` title begins with `AC-OF-002`.

- **AC-OF-003 — Insert failure never crashes the caller.** *(FR-OF-002, NFR-OF-REL-001; owning
  layer: Unit/Vitest, `errorEvent.test.ts`)*
  Given a service-role insert that rejects, When `recordErrorEvent` is called from a failing edge-fn
  handler, Then the rejection is swallowed, a structured `ERROR_EVENT_INSERT_FAILED` line is logged,
  and the handler returns its original (error) response unchanged — the insert fault does not propagate.

- **AC-OF-004 — `error_events` is service-role-only.** *(FR-OF-003, NFR-OF-SEC-001; owning layer:
  Integration/pgTAP)*
  Given an authenticated client JWT and an anon request, When each attempts `SELECT` and `INSERT`
  on `public.error_events`, Then all four attempts are rejected by RLS (0 rows / permission denied)
  and the pgTAP test description leads with `AC-OF-004`.

- **AC-OF-005 — Telegram non-2xx leaves the row for retry.** *(FR-OF-007, NFR-OF-REL-002; owning
  layer: Unit/Vitest with mocked `fetch`)*
  Given unnotified rows and a mocked Telegram API returning `502`, When the drain runs, Then
  `fetch` is called once for the group, `notified_at` stays `NULL`, and the function does not throw.

- **AC-OF-006 — Message body is code+meta only, no secret/PII.** *(FR-OF-006, NFR-OF-PRIV-003;
  owning layer: Unit/Vitest)*
  Given rows with `context_id='run_abc'` and `org_id` set, When the message builder runs, Then the
  text contains `fn`, `error_code`, `count`, timestamps, and `context_id`, and contains **no**
  `TELEGRAM_BOT_TOKEN`, no `org_id` UUID, no prompt/user text.

- **AC-OF-007 (live-verify) — A real errorCode reaches Telegram.** *(FR-OF-001..008; owning layer:
  live-verify runbook, NFR-OF-RUN-001)*
  Given a deployed project with the secrets + GUCs wired, When an operator triggers a real
  `errorCode` (e.g. temporarily unset `OPENROUTER_API_KEY` and fire one agent request), Then within
  ≤ one cron tick a Telegram message arrives in the chat, and a deliberate burst produces exactly
  one deduped message.
- **AC-OF-015 — Heartbeat pings on success, no-ops when unset.** *(FR-OF-021; owning layer:
  Unit/Vitest, `telegram-notify/logic.test.ts`)*
  Given a successful drain tick and `HEARTBEAT_URL` set, When the tick completes, Then the drain
  issues exactly one fire-and-forget `GET` to that URL and never blocks on it; and given
  `HEARTBEAT_URL` unset, Then no `GET` is issued (no-op). A network/non-2xx error on the heartbeat
  does not raise and does not affect `notified_at` stamping, and the `it(...)` title begins with
  `AC-OF-015`.

### Piece 2 — PostHog error tracking (FE)

- **AC-OF-008 — Disabled analytics captures nothing.** *(FR-OF-010/014, NFR-OF-REL-001; owning
  layer: Unit/Vitest)*
  Given `VITE_DEMO_MODE` and `VITE_ANALYTICS_ENABLED` both unset (or an invalid key), When
  `ErrorBoundary` catches an error and the global listeners fire, Then `posthog.capture`/exception
  capture is never called and no network request is made.

- **AC-OF-009 — Enabled analytics captures a redacted exception via `captureException`.** *(FR-OF-010/011/012;
  owning layer: Unit/Vitest with mocked SDK)*
  Given analytics is enabled and `ErrorBoundary.componentDidCatch` receives
  `{message: 'Cannot read props of /projects/abc?token=x'}`, When capture runs, Then the SDK's
  `captureException` is invoked (not a hand-rolled `$exception` capture — M-4), and the `before_send`
  transform yields an exception whose message has the query string (`?token=x`) stripped and the
  `token` shape dropped, and the `it(...)` title begins with `AC-OF-009`.

- **AC-OF-010 — Global listeners route through `safeTrack`.** *(FR-OF-013, OBS-OF-003; owning
  layer: Unit/Vitest)*
  Given analytics is enabled, When a synthetic `unhandledrejection` is dispatched, Then
  `captureException` is invoked exactly once and a thrown mock-PostHog does not propagate to the
  dispatcher (the `safeTrack` guard swallows it).

### Piece 3 — Health endpoint + BetterStack

- **AC-OF-011 — Health response shape + no data.** *(FR-OF-015/016/017; owning layer: Unit/Vitest
  for the response builder; deployed behavior [live-verify])*
  Given the `health` response-builder, When invoked, Then it returns `{ ok: true, service:
  'pmo-edge', version: <env|'unknown'>, ts: <iso> }` and contains no other field; the deployed
  `GET /functions/v1/health` → `200`, `HEAD` → `200`, `POST` → `405` is confirmed by the runbook
  live-verify (`curl`).

- **AC-OF-012 (config) — BetterStack monitors + status page configured.** *(FR-OF-015/021; owning
  layer: config-deliverable checklist in `docs/environments.md`, NFR-OF-RUN-001)*
  Given the deployed FE URL and `/functions/v1/health` URL, When the operator completes the
  BetterStack checklist, Then **three** monitors exist (FE URL, health URL, and one **heartbeat
  monitor** whose URL is wired as the `telegram-notify` `HEARTBEAT_URL` function secret — it alerts
  if the cron/alert path stops reporting, closing the persistent-silence gap per FR-OF-021 / I-3), a
  public status page exists, and on-call/owner notification targets the Telegram chat (or owner
  email, per BetterStack config).

### Piece 4 — Dashboards

- **AC-OF-013 (config) — Org usage dashboard.** *(FR-OF-018; owning layer: config-deliverable
  checklist)*
  Given the deployed project's PostHog, When the operator completes the dashboard checklist, Then a
  dashboard exists with weekly-actives, top-pages-by-route, and an `org_id` breakdown, documented
  in `docs/environments.md`.

- **AC-OF-014 (config) — Agent activity/cost dashboard.** *(FR-OF-019, LD-OF-008; owning layer:
  config-deliverable checklist)*
  Given the 9 agent event builders are emitting (#215), When the operator completes the dashboard
  checklist, Then a dashboard exists with per-builder counts, run completion/error rates, the
  approval funnel, the feedback split, an `org_id` breakdown, and a text panel pointing to the
  Ops-Admin usage view as the $$ source of truth — and **no** monetary field is sent to PostHog.

## Traceability (AC → owning layer → FR/NFR)

| AC | Owning layer | FR / NFR | Artifact |
|---|---|---|---|
| AC-OF-001 | Unit / Vitest | FR-OF-005/006, LD-OF-005 | `supabase/functions/telegram-notify/logic.test.ts` |
| AC-OF-002 | Unit / Vitest | FR-OF-005/009 | `telegram-notify/logic.test.ts` |
| AC-OF-003 | Unit / Vitest | FR-OF-002, NFR-OF-REL-001 | `supabase/functions/_shared/errorEvent.test.ts` |
| AC-OF-004 | Integration / pgTAP | FR-OF-003, NFR-OF-SEC-001 | `supabase/tests/error_events_test.sql` |
| AC-OF-005 | Unit / Vitest (mocked fetch) | FR-OF-007, NFR-OF-REL-002 | `telegram-notify/logic.test.ts` |
| AC-OF-006 | Unit / Vitest | FR-OF-006, NFR-OF-PRIV-003 | `telegram-notify/logic.test.ts` |
| AC-OF-007 | **live-verify runbook** | FR-OF-001..008 | `docs/environments.md` §Observability & alerting |
| AC-OF-008 | Unit / Vitest | FR-OF-010/014, NFR-OF-REL-001 | `pmo-portal/src/lib/analytics/client.test.ts` |
| AC-OF-009 | Unit / Vitest | FR-OF-010/011/012, NFR-OF-PRIV-002 | `client.test.ts` (+ `ErrorBoundary.test.tsx`) |
| AC-OF-010 | Unit / Vitest | FR-OF-013, OBS-OF-003 | `AnalyticsProvider.test.tsx` |
| AC-OF-011 | Unit / Vitest (+ live-verify) | FR-OF-015/016/017 | `supabase/functions/health/health.test.ts` + runbook |
| AC-OF-012 | config-deliverable checklist | FR-OF-015/021, NFR-OF-RUN-001 | `docs/environments.md` |
| AC-OF-013 | config-deliverable checklist | FR-OF-018, LD-OF-008 | `docs/environments.md` |
| AC-OF-014 | config-deliverable checklist | FR-OF-019, NFR-OF-PRIV-001 | `docs/environments.md` |
| AC-OF-015 | Unit / Vitest | FR-OF-021, NFR-OF-REL-002 | `supabase/functions/telegram-notify/logic.test.ts` |

> **Residual risk — config-deliverable drift (M-8).** AC-OF-012/013/014 (BetterStack monitors, the
> two PostHog dashboards) are **reproducible-from-docs** checklists in `docs/environments.md`,
> **not** regression-protected: if someone deletes a dashboard or removes a monitor, no automated
> test fails. This is an accepted MVP residual (external SaaS + edge fns have no CI runtime); the
> `docs/environments.md` checklist + per-deployed-project sign-off is the control, not CI.

## Error Handling

| Error Condition | System Behavior | User-Facing / Ops Behavior |
|---|---|---|
| `error_events` insert fails (DB down / RLS) | Swallowed; `ERROR_EVENT_INSERT_FAILED` logged via `logStructuredError` | None to end user; operator may miss this one alert (acceptable — the originating error is still in edge logs) |
| Telegram API non-2xx / network error | Group left `notified_at IS NULL`; retried next cron tick | Delayed (≤ 2 min) alert, never lost |
| `TELEGRAM_BOT_TOKEN`/`CHAT_ID` unset | Drain skips send, logs `TELEGRAM_SECRET_MISSING`, leaves rows for retry | No alert until wired; visible in edge logs + the readiness check |
| PostHog capture fault | `safeTrack` swallows; `console.debug('[analytics] …')` | None — FE never affected |
| Analytics disabled | `captureException` no-ops; global listeners do nothing | None |
| `health` hit on unsupported method | `405 Method Not Allowed` | None |
| Burst of identical errorCodes | Collapsed to one message per cooldown window | One Telegram message (with `count`) |
| `pg_cron`/`pg_net` GUC unset (CI/local) | `net.http_post` queues a request that never resolves (no-op) — same as agent-dispatch 0048 | None (CI/local); wired per deployed project |

## Implementation TODO

> No placeholders. Exact paths, real verify commands. Edge-fn `index.ts` files are integration-only
> (ADR-0039 decision-7); pure helpers are unit-tested. Values for secrets/GUCs are wired per
> deployed project later — the code reads them from `Deno.env` / `app.settings.*`.

### Backend — `error_events` table + RLS + pgTAP

- [ ] Migration `supabase/migrations/<NNNN>_error_events.sql`: `create table public.error_events (
      id uuid primary key default gen_random_uuid(), fn text not null, error_code text not null,
      context_id text, org_id uuid, created_at timestamptz not null default now(),
      notified_at timestamptz)`; `enable + force row level security`; **no** SELECT/INSERT policy
      for any role (service-role-only by omission); index on `(error_code, notified_at, created_at)`.
- [ ] pgTAP `supabase/tests/error_events_test.sql` (leading token `AC-OF-004`): assert anon +
      authenticated client `SELECT`/`INSERT` are RLS-denied; service-role succeeds.
- [ ] pg_cron schedule (guarded like 0048): every 2 min, `net.http_post` to
      `app.settings.telegram_notify_url` w/ `app.settings.service_role_key` bearer. Idempotent;
      no-op when GUC unset (CI/local).
- [ ] Verify: `supabase db reset && supabase test db` (pgTAP gate green, 0001..0060+ intact).

### Backend — `telegram-notify` edge function (pure logic + thin entry)

- [ ] `supabase/functions/telegram-notify/logic.ts` (pure): `selectNotifiedCandidates(rows,
      lastNotifiedByCode, cooldownSec)`, `groupIntoMessages(rows, lastNotifiedByCode, env, cooldownSec)`,
      `buildTelegramPayload(group)`, `pingHeartbeat(url)` — where `rows` are the unnotified events and
      `lastNotifiedByCode` is the `Record<error_code, MAX(notified_at)>` from the drain's second query
      (the cross-drain cooldown input, I-2); importable in Vitest.
- [ ] `supabase/functions/telegram-notify/logic.test.ts`: AC-OF-001/002/005/006/015 (mocked `fetch`
      for the non-2xx retry case; assert message body has no token/PII/org_id-UUID; heartbeat `GET`
      on success + no-op when `HEARTBEAT_URL` unset).
- [ ] `supabase/functions/telegram-notify/index.ts` (integration-only): service-role client read of
      unnotified rows **plus** the second `SELECT error_code, MAX(notified_at) … WHERE notified_at IS
      NOT NULL GROUP BY error_code` query → `logic` → `fetch` Telegram Bot API → `update … set
      notified_at=now()`; on successful tick completion, fire-and-forget `GET HEARTBEAT_URL` (unset →
      no-op, FR-OF-021); `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`/`HEARTBEAT_URL` from `Deno.env`; `401`
      unless bearer service-role.
- [ ] `supabase/functions/_shared/errorEvent.ts` (pure logic + injected client):
      `recordErrorEvent(supabase, ctx)` — one service-role insert, swallows rejection, logs
      `ERROR_EVENT_INSERT_FAILED` on fault.
- [ ] `supabase/functions/_shared/errorEvent.test.ts`: AC-OF-003.
- [ ] Wire `recordErrorEvent(...)` next to every existing `logStructuredError(...)` call site —
      verified against the code (I-1): `supabase/functions/agent-chat/index.ts:84`,
      `supabase/functions/compose-view/index.ts:79`,
      `supabase/functions/agent-dispatch/index.ts:49, 81, 171` (the request-path errors), and
      `supabase/functions/agent-dispatch/dispatcher.ts:475` (the cron/fire-path `AUTOMATION_*_FAILED`
      codes). There is **no** `handler.ts` containing `logStructuredError` — do not invent one.
- [ ] Verify: `cd pmo-portal && npm run verify`; `for fn in telegram-notify health; do deno check
      --config supabase/functions/$fn/deno.json supabase/functions/$fn/index.ts; done` (the #227 gate).

### Backend — `health` edge function

- [ ] `supabase/functions/health/health.ts` (pure response builder) + `health.test.ts`: AC-OF-011
      (shape, no extra fields, `version` from env-or-`'unknown'`).
- [ ] `supabase/functions/health/index.ts` (integration-only): `GET`/`HEAD` → `200` builder output +
      permissive CORS for those methods; `POST`/others → `405`; no auth, no DB, no secret read.
- [ ] Verify: `deno check --config supabase/functions/health/deno.json supabase/functions/health/index.ts`;
      `node --test scripts/check-agent-prod-readiness.test.mjs` (unchanged, regression-safe).

### Frontend — PostHog exception capture

- [ ] `pmo-portal/src/lib/analytics/client.ts`: add `captureException({name, message, componentStack?})`
      gated on the **full** `if (!initialized || !activeConfig?.enabled) return;` (M-6); ingest via
      `posthog.captureException(new Error(...))` (M-4) — **not** a hand-rolled `$exception` capture.
      Register a `before_send` payload-transform hook at init that redacts **all** events (incl.
      exceptions): strip query strings, drop `FORBIDDEN_PROPERTY_KEYS` shapes, truncate stacks. Keep
      `POSTHOG_PROPERTY_DENYLIST` unchanged (token lesson).
- [ ] `client.test.ts`: AC-OF-008/009 (disabled no-op; enabled redacts `?token=x` + drops token shape).
- [ ] `pmo-portal/src/components/ErrorBoundary.tsx`: in `componentDidCatch`, add
      `safeTrack(() => analyticsClient.captureException({name: error.name, message: error.message,
      componentStack: info.componentStack}))` after the existing `console.error`.
- [ ] `ErrorBoundary.test.tsx`: extend with AC-OF-009 assertion (capture called with redacted payload;
      gated off when disabled).
- [ ] `pmo-portal/src/lib/analytics/AnalyticsProvider.tsx`: register `error` + `unhandledrejection`
      listeners once post-init through `safeTrack(captureException)`; deregister on unmount.
- [ ] `AnalyticsProvider.test.tsx`: AC-OF-010 (listener routes through `safeTrack`; SDK fault doesn't
      propagate).
- [ ] Verify: `cd pmo-portal && npm run verify` (typecheck + lint:ci + test + build).

### Config + runbook deliverables (Piece 3 + 4)

- [ ] `docs/environments.md`: add **"Observability & alerting"** section (NFR-OF-RUN-001) — BetterStack
      monitors (FE URL + `/functions/v1/health`) + status page; Telegram secret/GUC wiring per
      deployed project; PostHog dashboard panel definitions + repro; live-verify steps (AC-OF-007/011/012/013/014).
- [ ] BetterStack: FE-URL monitor + health-URL monitor + **heartbeat monitor** (its URL wired as
      the `telegram-notify` `HEARTBEAT_URL` function secret, FR-OF-021) + public status page
      (owner-configured; doc'd in `docs/environments.md`).
- [ ] PostHog: build the **Org usage** dashboard (AC-OF-013) and **Agent activity/cost** dashboard
      (AC-OF-014); record panel definitions in `docs/environments.md`.
- [ ] Final pre-PR gate: `cd pmo-portal && npm run verify` (full suite — never just touched files).

## Deferred / Out of Scope (owner CUT list — do NOT add)

- **Sentry** (or any second error vendor) — PostHog is the single FE error sink (LD-OF-003).
- **Log aggregation / APM / distributed tracing / OpenTelemetry** — not in MVP (backlog GTM item 3).
- **Browser console-log capture** to PostHog — stays off (privacy + noise).
- **SLA penalties / SLO error-budget machinery** — the status page + alert IS the MVP SLA answer;
  no penalty regime.
- **In-app alert UI / admin alert console** — the Telegram chat is the surface at this scale
  (<~5 deployments, per ADR-0047).
- **PostHog feature flags / surveys / reverse proxy / Group Analytics** — still deferred (ADR-0022).
- **Per-client Telegram chat routing** — one owner chat for all deployed projects in this floor;
  multi-tenant alert routing is a fast-follow when client count demands it.
- **Self-hosted PostHog / BetterStack alternatives** — revisit only on data-residency / cost trigger
  (ADR-0047 exit path).

## Contradictions / conflicts flagged against existing code & locked decisions

- **ADR-0022 listed "error tracking" as deferred and "evaluate vs Sentry."** This spec resolves it:
  PostHog error tracking IS delivered here; Sentry is permanently declined (LD-OF-003). No
  contradiction — the ADR's "evaluate" is now answered.
- **`docs/environments.md` already flags the error-events/webhook as "next step not yet built."**
  This spec builds exactly that, consuming the `errorLog.ts` errorCodes it names as the hook point.
  No conflict; this is the flagged follow-through.
- **`docs/specs/posthog-instrumentation.spec.md` "Deferred Follow-Up #8" names UptimeRobot/Uptime
  Kuma for external uptime.** The grill (2026-07-04) superseded that with **BetterStack** (LD-OF-002).
  No code conflict (that item was never built); the posthog spec's stale vendor suggestion is
  overridden by this newer owner decision.
- **`errorLog.ts` is documented "Pure: no Deno globals."** Honored: this spec does **not** modify
  `errorLog.ts` (OBS-OF-001); the durable write is a separate companion. No conflict.
- **`property_denylist` must exclude `token`** (client.ts lesson). Honored: exception redaction
  scrubs `token` in our own redactor; the SDK denylist is left as-is. No conflict.
- **`pg_cron`/`pg_net` GUCs are unset in CI/local.** Honored: the schedule is guarded and no-ops
  when `app.settings.telegram_notify_url` is unset (mirrors 0048's documented behavior). No CI
  breakage.

## Open Questions

None. The grill (owner, 2026-07-04) locked the channel (Telegram), the uptime vendor (BetterStack),
the no-Sentry decision, the fire-and-forget + loss-less constraint, and the secrets seam. Dashboard
$$ source-of-truth (server-side ledgers, not PostHog) is resolved by LD-OF-008/NFR-OF-PRIV-001. All
runtime values (secrets, GUCs, dashboard configs) are explicitly wired per deployed project later
(ADR-0047), not in this issue.

## Self-verification against the brief

- **READ FIRST consumed:** backlog GTM item 3 + BUILD-LOOP AUTHORIZED block (LD-OF-001/002/003) ·
  `errorLog.ts` (OBS-OF-001, FR-OF-001) · `docs/analytics-events.md` (NFR-OF-PRIV-002, redaction) ·
  `analytics/{client,config,events,safeTrack,index}.ts` (FR-OF-010..014, OBS-OF-002/003) · ADR-0022
  (error-tracking delivery + dashboard follow-up) · ADR-0047 (per-project secrets/runbooks) ·
  `0048` cron seam (OBS-OF-004) · `0047` ledgers (DC-OF-004) · `ErrorBoundary.tsx` (FR-OF-012) ·
  `check-agent-prod-readiness.mjs` (DC-OF-003, no health endpoint today) · CLAUDE.md conventions
  (EARS, Given/When/Then, one owning layer per AC, AC-id tagging).
- **Four pieces covered:** (1) Telegram webhook with (a) vs (b) evaluated + (a) recommended with
  rationale tied to the loss-less + fire-and-forget constraint (DC-OF-001); (2) PostHog error
  tracking gated + scrubbed, no-PII NFR (FR-OF-010..014, NFR-OF-PRIV-002); (3) BetterStack as NFR +
  runbook section deliverable + a minimal `health` edge fn because none exists (DC-OF-003,
  FR-OF-015..017, NFR-OF-RUN-001); (4) two PostHog dashboards as checklists referencing the 9 typed
  agent builders (FR-OF-018/019, DC-OF-004).
- **Secrets seam:** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` as function secrets on `telegram-notify`,
  values wired later (LD-OF-006, FR-OF-008).
- **Conventions:** EARS FR-OF-###/NFR-OF-###; AC-OF-### Given/When/Then; one owning layer per AC
  (traceability table); webhook logic = unit-testable pure fns + mocked fetch (NFR-OF-TEST-001);
  edge-fn code has no CI runtime → live-verify runbook (NFR-OF-TEST-004/005, NFR-OF-RUN-001);
  AC-id tagging mandated (NFR-OF-TEST-006). No placeholders (exact paths, real verify commands).
- **OUT honored:** Sentry, log aggregation, APM, tracing all in the CUT list. No vendor beyond
  BetterStack/PostHog/Telegram.
- **Did NOT:** implement · touch other files · re-litigate the grill.

### Deviations from the brief

1. **Runbook location.** The brief offered "`docs/environments.md` or `docs/runbooks/`" for the
   runbook section. `docs/runbooks/` does not exist in this worktree and `docs/runbooks/incident-response.md`
   (the eventual consumer) is not present either. I placed the deliverable as a new **"Observability &
   alerting"** section in `docs/environments.md` (which already owns per-deployed-project config +
   flags the error-events webhook as the next step) and noted it seeds the future incident-response
   runbook (GTM item 5). This avoids creating a half-empty runbooks dir and co-locates the alert
   wiring with the secrets/environments docs the operator already uses.
2. **Secrets location vs "function secrets."** The brief's option (a) was phrased as "errorLog.ts
   writing to an error_events table + pg_cron notifier." A pure-SQL `pg_cron` notifier cannot read
   Deno **function secrets** (it would need DB GUCs instead). Because the brief *also* locks
   `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` as **function secrets** (LD-OF-006), I reconciled the two
   by making the notifier a thin **`telegram-notify` edge function** triggered by `pg_cron` via
   `net.http_post` (the agent-dispatch seam) — so the durable table + cron half of option (a) is
   preserved AND the secrets stay as function secrets. This is a faithful merge of the two locked
   inputs, not a re-litigation.
3. **`errorLog.ts` left pure.** The brief's option (a) literally says "errorLog.ts writing to an
   error_events table." I did **not** put the DB write inside `errorLog.ts`, because that file's
   documented contract is "Pure: no Deno globals" (OBS-OF-001) and mutating it would break its
   Vitest import + compile-time secret-scrub guarantee. Instead the durable write is a separate
   pure-logic companion (`errorEvent.ts`) invoked alongside `logStructuredError` at the same call
   sites. Net behavior is identical to option (a)'s intent; the choke-point purity is preserved.

## Fix-round finding → resolution mapping (2026-07-04, review `/tmp/obs-spec-review.txt`)

- **I-1 (wrong call-site file paths)** → Implementation TODO now names the four real files + line
  refs, verified against the code: `agent-chat/index.ts:84`, `compose-view/index.ts:79`,
  `agent-dispatch/index.ts:49/81/171`, `agent-dispatch/dispatcher.ts:475` (the cron/fire
  `AUTOMATION_*_FAILED` path); explicitly notes no `handler.ts` contains `logStructuredError`.
- **I-2 (cross-drain cooldown uncomputable)** → option (a) applied: FR-OF-005 + DC-OF-001 step 5 now
  specify the drain's second query `SELECT error_code, MAX(notified_at) FROM error_events WHERE
  notified_at IS NOT NULL GROUP BY error_code`; the pure-fn signatures
  `selectNotifiedCandidates(rows, lastNotifiedByCode, cooldownSec)` /
  `groupIntoMessages(rows, lastNotifiedByCode, env, cooldownSec)` (TODO) take it as an explicit
  input, and AC-OF-002 exercises it — so cross-drain cooldown is unit-owned.
- **I-3 (loss-less over-claimed; no dead-man's-switch)** → (1) NFR-OF-REL-002 rescoped to
  **transient** failures with the persistent-silence gap named; (2) new FR-OF-021 + AC-OF-015 + a
  heartbeat monitor in AC-OF-012/NFR-OF-RUN-001: the drain pings an optional `HEARTBEAT_URL`
  BetterStack heartbeat on each successful tick (no-op unset, fire-and-forget, never blocks) — a
  dead cron/alert path surfaces via the missed heartbeat.
- **M-4 (PostHog exception may miss Error Tracking UI)** → ingest contract is now
  `posthog.captureException(error)`; redaction moved to a `before_send` / payload-transform hook;
  hand-rolled `$exception` capture dropped (DC-OF-002, FR-OF-010/011, AC-OF-009, FE TODO).
- **M-5 (health rate-limit posture unstated)** → new NFR-OF-PERF-003 states the no-app-level-rate-
  limit / Supabase-quota-backstop posture + revisit trigger.
- **M-6 (`captureException` gate omitted `initialized`)** → FR-OF-010 + DC-OF-002 now mirror the
  **full** `if (!initialized || !activeConfig?.enabled) return;` gate; FE TODO updated.
- **M-7 (real-browser analytics spot-check only partial)** → NFR-OF-RUN-001 live-verify extended
  with "from a real browser, confirm a route event lands in PostHog" (existing analytics capture).
- **M-8 (config-deliverable ACs have no regression gate)** → residual risk recorded after the
  traceability table (reproducible-from-docs, not regression-protected; accepted at MVP).

SPEC-FIX-DONE
