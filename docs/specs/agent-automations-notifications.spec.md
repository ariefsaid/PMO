# Feature: Agent automations (cron + event-triggered) + notifications inbox

> **Authority:** ADR-0044 (Accepted, 2026-07-03). This spec **operationalizes** ADR-0044 — table
> shapes, RLS posture, the minted-owner-JWT dispatch model, NL-condition evaluation, and the
> notifications inbox are decided there; this document turns those decisions into FR/OBS/NFR/AC
> with test-layer ownership. Where this spec and ADR-0044 could be read to disagree, **ADR-0044
> wins** — file an issue, don't ship the divergence. Related: ADR-0036 (deputy invariant §2 + four
> ceilings), ADR-0039 (single LLM call site + untrusted-output boundary), ADR-0040 (Option A
> `AgentRuntime` port; 2026-07-03 addendum), ADR-0041 (model-calling-action seam), ADR-0043
> (`agent_threads`/`agent_runs`/`agent_events` persistence — automations produce ordinary runs;
> `docs/specs/agent-persistence.spec.md` is the sibling spec this one depends on), ADR-0018
> (soft-archive), ADR-0016/0017 (real-JWT + repository seam), ADR-0010 (test pyramid), ADR-0022
> (PostHog), ADR-0001 (org_id seam), ADR-0008 (impersonation is view-only).
> Glossary: Assistant (deputy invariant).

## Overview

Today every agent run executes under a **live user's JWT** streamed over SSE while the user
watches (ADR-0039/0040/0043) — there is no way for the assistant to act **on a schedule** ("every
Monday 8am, summarize my overdue tasks") or **in response to a business event** ("when a
procurement case sits >30 days in Ordered, notify me") without a live user present. There is also
no delivery surface for a run's output when nobody is watching — a completed background run or a
fired automation has nowhere to report back.

This feature adds two owner-scoped tenant entities — `agent_automations` (the trigger definition)
and `notifications` (the delivery inbox) — plus the infrastructure to fire automations safely with
**no always-on Node process**: a single per-minute `pg_cron` job invoking a dispatcher Supabase
Edge Function. The central engineering problem this spec operationalizes is ADR-0044 §3: a
background run has no live user, so it executes under a **minted, short-lived, owner-scoped JWT**
— `service_role` is quarantined to *minting* and to *enumerating which automations exist*, and
**never** touches business data. This keeps the deputy invariant (ADR-0036 §2) true for background
runs exactly as it is for interactive ones: RLS is the ceiling, by construction, not by app-level
filtering.

**User value:** *I want the assistant to watch for things and act (or tell me) even when I'm not
looking — on a schedule, or when something in my data changes — and I want a single place to see
what it found, so I don't have to remember to check.*

This is backlog "batteries-included A" item (5) / ADR-0044, the last item in the suggested build
order (needs ADR-0043 persistence + the credits preflight seam as inputs). Webhook/Slack/email
notification channels, shared automations, and deterministic (non-NL) trigger conditions are
explicitly out of scope (see Out of Scope).

---

## Functional Requirements

### Schema — `agent_automations` (ADR-0044 §1)

**FR-AAN-001 — `agent_automations` table.**
The system shall provide an `agent_automations` table with `id`, `org_id` (not null, default
seed-org), `owner_id` (not null, default `auth.uid()`), `kind` (constrained to
`'schedule'|'trigger'`), `prompt` (not null text), `schedule` (nullable text, cron expression),
`trigger_on` (nullable jsonb `{source, event}`), `condition` (nullable text, NL condition),
`enabled` (not null boolean, default true), `timeout_s` (not null integer, default 120),
`last_fired_at` (nullable timestamptz), `created_at`, `updated_at`, `archived_at` (nullable,
soft-archive per ADR-0018) — exactly the columns of ADR-0044 §1.

**FR-AAN-002 — `kind`-conditional required fields, enforced server-side.**
When `kind = 'schedule'`, the system shall require `schedule` to be a non-null, non-empty cron
expression and shall reject an insert/update with `kind='schedule'` and a null `schedule` via a
`CHECK` constraint. When `kind = 'trigger'`, the system shall require `trigger_on` to be a non-null
jsonb object carrying `source` and `event` keys and shall reject an insert/update with
`kind='trigger'` and a null `trigger_on` via a `CHECK` constraint.

**FR-AAN-003 — `runAs` is always the automation's own owner (v1, no sharing).**
The system shall never execute an automation as any identity other than its own `owner_id`; there
is no `runAs: creator|shared` distinction in v1 (ADR-0044 §1 — upstream's shared-automation concept
collapses to owner-only). No column or code path accepts a different runtime identity.

### RLS — `agent_automations` owner-only (ADR-0044 §1)

**FR-AAN-004 — Owner-only RLS.**
The system shall enable and force RLS on `agent_automations`, gating
`SELECT`/`INSERT`/`UPDATE`/`DELETE` to `owner_id = auth.uid() and org_id = auth_org_id()`; `INSERT`
shall pin both `org_id` and `owner_id` via column default + `with check` (mirrors
`user_views_insert` / `agent_threads` from ADR-0043 §1), so a user cannot create an automation
owned by someone else.

**FR-AAN-005 — Soft-archive hides an automation from dispatcher selection.**
The system shall exclude any `archived_at is not null` or `enabled = false` automation from the
dispatcher's due-automation selection query (§ Dispatcher below), regardless of its `schedule`
match or trigger match.

### Schema — `notifications` (ADR-0044 §5)

**FR-AAN-006 — `notifications` table.**
The system shall provide a `notifications` table with `id`, `org_id` (not null, default seed-org),
`owner_id` (not null, default `auth.uid()` — the recipient), `severity` (constrained to
`'info'|'warning'|'critical'`, default `'info'`), `title` (not null text), `body` (nullable text),
`metadata` (nullable jsonb `{source, automation_id?, run_id?, entity:{type,id,label}?}`), `read_at`
(nullable timestamptz — null means unread), `created_at` — exactly ADR-0044 §5.

**FR-AAN-007 — Index for the unread-badge fast path.**
The system shall index `notifications (owner_id) where read_at is null` (ADR-0044 §5).

### RLS — `notifications` owner-only (ADR-0044 §5)

**FR-AAN-008 — Owner-only RLS on `notifications`.**
The system shall enable and force RLS on `notifications`, gating
`SELECT`/`INSERT`/`UPDATE`/`DELETE` to `owner_id = auth.uid() and org_id = auth_org_id()`; `INSERT`
shall pin both via default + `with check` — a caller cannot create a notification addressed to
another user (ADR-0044 §5).

**FR-AAN-009 — The mark-read UPDATE touches only `read_at`.**
The system shall permit the owner to `UPDATE` a notification's `read_at` column only; a `WITH
CHECK` (or an equivalent narrow policy, mirroring the ADR-0043 §2 feedback-UPDATE pattern) shall
reject any UPDATE that changes `title`/`body`/`severity`/`metadata`/`owner_id`/`org_id`.

### Dispatcher — `pg_cron` → edge fn, schedule + event-trigger selection (ADR-0044 §2)

**FR-AAN-010 — A single per-minute `pg_cron` job invokes the dispatcher edge fn.**
The system shall register one `pg_cron` job, firing once per minute, that invokes the
`agent-dispatch` Supabase Edge Function (a new function; it does not touch `agent-chat`'s code).

**FR-AAN-011 — Schedule selection.**
On each tick, the dispatcher shall select every `enabled = true`, `archived_at is null`,
`kind = 'schedule'` automation whose `schedule` (a standard cron expression) matches the current
minute, and shall fire each as an ordinary agent run (ADR-0043 run/event shapes) under a minted
owner JWT (§ Minted-JWT dispatch below).

**FR-AAN-012 — Event-trigger selection is poll-since-watermark.**
On each tick, for every `enabled = true`, `archived_at is null`, `kind = 'trigger'` automation, the
dispatcher shall select rows from the automation's `trigger_on.source` status-event table (e.g.
`procurement_status_events`) created since the dispatcher's last-seen watermark for that source,
filter them to rows matching `trigger_on.event`, and — for each match — evaluate the automation's
optional `condition` (§ NL condition evaluation) before firing.

**FR-AAN-013 — The watermark advances monotonically and does not double-fire.**
The system shall persist, per event source, the id/`created_at` of the most recently processed
status-event row, and shall advance it only after successfully processing a tick's batch, so a
retried or overlapping tick does not re-fire an automation for an already-processed event.

**FR-AAN-014 — `service_role` is quarantined to selection/enumeration, never business data.**
The dispatcher's selection queries (which automations exist, their `owner_id`/`schedule`/
`trigger_on`/`condition`; which status-events are new since the watermark) shall run under
`service_role` **only** to read `agent_automations` metadata and the append-only status-event
tables for watermark comparison. No `service_role` query in the dispatcher shall read or write any
other tenant business table (ADR-0044 §2 — "this split is the whole safety argument").

**FR-AAN-015 — `last_fired_at` is stamped on fire.**
When the dispatcher fires an automation (schedule match, or a trigger match that passed its
condition), the system shall update that automation's `last_fired_at` to the fire time.

### Minted-JWT dispatch — the deputy invariant for background runs (ADR-0044 §3)

**FR-AAN-016 — Minting is scoped to exactly one row's `owner_id`.**
When the dispatcher fires an automation, the system shall call the Supabase Auth admin API, under
`service_role`, to mint a short-lived session/JWT for **only** the `owner_id` of the specific
`agent_automations` row being dispatched — never a request-supplied, model-supplied, or
otherwise-derived user id. No other user is reachable from a single automation-dispatch call.

**FR-AAN-017 — The minted JWT drives the standard deputy path, indistinguishable from interactive.**
The system shall hand the minted JWT to a caller-JWT-scoped Supabase client and invoke the same
`agentChatHandler`/`AgentAction` catalog, the same RLS ceiling, the same `can()` re-auth on writes
(ADR-0040 A3), and the same untrusted-output boundary (ADR-0039) used for interactive runs — no
automation-only code branch bypasses any of these gates.

**FR-AAN-018 — The minted JWT is bounded and never persisted.**
The system shall bound the minted JWT's lifetime to the firing automation's `timeout_s` and shall
never write the minted JWT (or its refresh token, if any) to any table, log, or long-lived cache.

**FR-AAN-019 — Every mint is audited.**
When the dispatcher mints a JWT, the system shall record an audit trail entry (an `agent_events`
`type='system'` row on the fired run, or an equivalent append-only record) carrying the automation
id, the `owner_id` minted for, and the mint timestamp — sufficient to detect a wrong-owner mint
after the fact.

**FR-AAN-020 — Automation runs produce ordinary `agent_runs`/`agent_events` rows.**
A fired automation shall create an `agent_threads` (if none scoped) + `agent_runs` row and stream
`agent_events` exactly as an interactive run does (ADR-0043 §2/§6), owned by the automation's
`owner_id`, so the owner can review a fired automation's transcript the same way they review any
conversation.

### NL trigger conditions — cheap-tier model, memoized, fail-quiet-but-visible (ADR-0044 §4)

**FR-AAN-021 — Condition evaluation uses the cheap-tier model map.**
When a `kind='trigger'` automation carries a non-null `condition`, the dispatcher shall evaluate it
against the triggering event's context using the small/cheap-tier entry of the per-action
`ModelClient` model map (the vendor-neutral seam, backlog batteries-A item 1), never the default
chat-tier model.

**FR-AAN-022 — Condition evaluation is memoized with a TTL.**
The system shall memoize a condition-evaluation result keyed on `(automation_id, condition,
event_id)` (or an equivalent stable key derived from the triggering event) for a bounded TTL, so a
burst of matching events for the same condition is not re-billed per event within the TTL window.

**FR-AAN-023 — True fires; false is silent no-fire.**
When condition evaluation returns true, the dispatcher shall fire the run. When it returns false,
the dispatcher shall not fire and shall emit no notification (the common, expected case).

**FR-AAN-024 — Failing or ambiguous evaluation is no-fire AND a warning notification.**
When condition evaluation errors (model call fails) or returns an unparseable/ambiguous result, the
dispatcher shall NOT fire the run and shall create a `severity='warning'` notification for the
automation's owner (e.g. "couldn't evaluate the condition for automation X") — never silently
swallowed, never fired on uncertainty (ADR-0044 §4, fail-quiet-but-visible).

**FR-AAN-025 — A condition is a grounding hint, never an authorization.**
The system shall treat a true condition evaluation as permission to *fire the run*, never as
permission for the run to read/write anything beyond what RLS under the minted owner JWT already
allows — a condition cannot expand what the fired run can touch.

### `notify` `AgentAction` — the notification producer (ADR-0044 §5)

**FR-AAN-026 — `notify` is a new `confirm:false` `AgentAction`.**
The system shall register a `notify` `AgentAction` in the agent-chat action catalog (small addition
to `supabase/functions/agent-chat/actions.ts`, alongside `query_entity`/`create_activity`/
`update_task_status`) with `confirm: false` — creating a notification is not a business write and
addresses only the calling identity's own `owner_id`, so it does not need the A3 approve-chip flow.

**FR-AAN-027 — `notify` writes under the caller's context (interactive or minted).**
When `notify` is dispatched, the system shall insert the `notifications` row using whichever
Supabase client is active for the run — the interactive caller's JWT for a live conversation, or
the minted owner JWT (§ Minted-JWT dispatch) for a background automation run — and shall stamp
`owner_id` to that identity's own uid, never a different recipient (v1: no cross-user notify path
exists, per ADR-0044 §5).

**FR-AAN-028 — Producers: automations and long-run completions.**
The first two notification producers are (a) a fired automation reporting its outcome via `notify`,
and (b) a long/background `agent_runs` row reaching a terminal state (`completed`/`errored`) that
the run itself chose to summarize via `notify` before finishing. No other producer exists in this
issue.

### `create_automation` `AgentAction` — the automation producer

**FR-AAN-029 — `create_automation` is a new `confirm:true` `AgentAction`.**
The system shall register a `create_automation` `AgentAction` in the agent-chat catalog with
`confirm: true` (surfaces an approve chip like `create_activity`/`update_task_status`, per ADR-0040
A3) so a user asking the assistant to "watch for X" sees and approves the automation definition
before it is created.

**FR-AAN-030 — `create_automation` input validation mirrors `kind`-conditional requirements.**
The `create_automation` action's `validate` function shall enforce FR-AAN-002's `kind`-conditional
requirements (schedule present iff `kind='schedule'`, `trigger_on` present iff `kind='trigger'`) at
the application layer, in addition to the DB `CHECK` constraint (defense-in-depth, mirroring the
`validateCreateActivity`/`validateUpdateTaskStatus` pattern in `actions.ts`).

**FR-AAN-031 — `create_automation` writes under the caller's JWT.**
The system shall insert the `agent_automations` row via `dispatchActionForced` under the caller's
JWT (the same single write-dispatch site ADR-0040's `NFR-AW-SEC-001` funnels all writes through),
never `service_role` — creating an automation is an ordinary owner write, identical in shape to
`create_activity`.

### Credits — automation runs meter against the owner's balance (ADR-0044 §6)

**FR-AAN-032 — Credit preflight runs for the automation's owner before firing.**
Before a fired automation's run starts, the dispatcher shall invoke the credits preflight (the
`RateGuard` injection point, `HandlerDeps.rateGuard`, extended per `docs/specs/agent-usage-credits.spec.md`)
for the automation's `owner_id`.

**FR-AAN-033 — Over-budget is no-start + a warning notification, not a partial run.**
When the preflight determines the owner's balance would be exceeded, the dispatcher shall NOT start
the run (no `agent_runs` row reaches `status='running'`) and shall create a `severity='warning'`
notification for the owner ("automation X skipped — out of credits"). Background spend is bounded
by the same per-user meter as interactive spend (ADR-0044 §6 — "no separate, unmetered cost
channel").

### Bell + inbox UI — the shell `ContextBar` (ADR-0044 §5)

**FR-AAN-034 — A bell with an unread-count badge in `ContextBar`.**
The system shall render a notification-bell control in `ContextBar` (`pmo-portal/src/components/shell/ContextBar.tsx`)
showing an unread-count badge driven by `count(*) where owner_id = caller and read_at is null`.
This re-instates the bell removed in B-5/AC-W2-IXD-008 ("no destination" — now it has one) behind
the `agentAssistant` flag.

**FR-AAN-035 — Opening the bell shows the inbox list, most-recent first.**
When the user activates the bell, the system shall open an inbox listing the caller's own
notifications ordered by `created_at desc`, each showing `severity`, `title`, `body` (if present),
relative timestamp, and read/unread visual state — scoped to the caller's own `owner_id`/`org_id`
(no other user's notifications ever appear).

**FR-AAN-036 — Selecting a notification marks it read and deep-links via `metadata`.**
When the user selects a notification, the system shall mark it read (the narrow FR-AAN-009 UPDATE)
and, where `metadata.entity` names a resolvable PMO record, navigate to it; where `metadata.run_id`
is present instead, it shall open that run's transcript (the persisted `AC-AGP-021` resume path);
absent both, selecting only marks it read.

**FR-AAN-037 — Channel abstraction — in-app only in this issue, seam left open.**
The system shall write every notification to the `notifications` table (the in-app channel) as the
sole implemented channel in this issue; the schema/producer boundary (a `notify` action writing one
durable row) is deliberately channel-agnostic so webhook/Slack/email can be added later as
additional consumers of the same row **without a redesign** (ADR-0044 §5) — no channel-selection
UI or column ships in this issue (see Out of Scope).

### Feature-flag gating

**FR-AAN-038 — `agentAssistant` gates the whole automations + notifications layer.**
The system shall gate `create_automation`/`notify` catalog registration and the `ContextBar` bell
behind the existing `agentAssistant` flag (`VITE_FEATURES_AGENT_ASSISTANT`,
`pmo-portal/src/lib/features.ts`) — the same flag gating the panel and the ADR-0043 persistence
layer. With the flag off, `agent_automations`/`notifications` tables and the `pg_cron` job/dispatcher
edge fn exist (migration is unconditional) but no chat action creates an automation and no UI
renders the bell; the `pg_cron` tick selecting 0 enabled automations is a no-op (ADR-0044
"Feature-flag gating").

---

## Observed / legacy behavior to preserve (OBS)

**OBS-AAN-001 — The `ContextBar` bell prop already exists, unwired.** `ContextBarProps.notificationCount`
is present in the interface today (kept for exactly this future use per its inline comment) but no
bell renders; this feature is the "future wired implementation" the comment anticipates. The prop's
default (`0`) and underscore-prefixed unused-param pattern are replaced by a real subscription/query,
not a new prop shape.

**OBS-AAN-002 — `agentChatHandler`/`dispatchAction`/`dispatchActionForced` remain the single write
sites (NFR-AW-SEC-001).** `create_automation`/`notify` are dispatched through the existing gates
exactly like `create_activity`/`update_task_status`; no parallel write path is introduced.

**OBS-AAN-003 — ADR-0043's persistence wrapper (`withPersistence`, journal, heartbeat, de-dupe)
applies unchanged to automation-fired runs.** A fired automation's run is, from `agentChatHandler`'s
perspective, an ordinary run — the only difference is which Supabase client/JWT is injected into
`HandlerDeps`. No automation-specific branch in `handler.ts`/`persistence.ts` is required beyond the
new `notify`/`create_automation` catalog entries.

**OBS-AAN-004 — Companies/`user_views`/`agent_threads` tenant-entity pattern reused, not reinvented.**
Table shape (`id`/`org_id`/`owner_id`/timestamps/`archived_at` on `agent_automations`), RLS phrasing
(`owner_id = auth.uid() and org_id = auth_org_id()`), and the INSERT-pins-both pattern mirror
`0045_user_views.sql`/`0046_agent_persistence.sql` exactly.

---

## Non-Functional Requirements

### Security (OWASP / STRIDE)

- **NFR-AAN-SEC-001 — The minting path is the single most security-sensitive surface in this
  feature.** Minting SHALL be constrained to exactly the dispatched row's `owner_id` (FR-AAN-016),
  audited (FR-AAN-019), and covered by a cross-tenant denial gate test identical in shape to the
  interactive deputy-invariant test (AC-AAN-020). Reviewed at full depth by security-auditor on
  every change (ADR-0044 Consequences — "must be reviewed as such on every change").
- **NFR-AAN-SEC-002 — `service_role` never issues a business-data query in the automation path.**
  Every `service_role` use in the dispatcher is provably limited to (a) minting via the Auth admin
  API and (b) reading `agent_automations` metadata / status-event tables for selection and watermark
  comparison — never a `SELECT`/`INSERT`/`UPDATE`/`DELETE` on any other tenant business table
  (FR-AAN-014). Verified by a handler-level test asserting the set of tables touched under
  `service_role` is exactly `{agent_automations, <status-event source tables>}`.
- **NFR-AAN-SEC-003 — `org_id`/`owner_id` are server-stamped, never client-trusted.** Both
  `agent_automations` and `notifications` INSERTs pin `org_id`/`owner_id` via column default +
  `WITH CHECK` (FR-AAN-004/FR-AAN-008); a client-supplied cross-owner value is preserved (not
  silently rewritten) so it hits `WITH CHECK` and is denied, per the `user_views`/ADR-0043 pattern.
- **NFR-AAN-SEC-004 — The mark-read UPDATE cannot alter notification content.** Enforced by RLS
  policy (not application discipline alone), so a direct PostgREST call is equally blocked
  (FR-AAN-009).
- **NFR-AAN-SEC-005 — A condition is never treated as an authorization signal.** No code path
  widens what a fired run can read/write based on the condition's outcome (FR-AAN-025); RLS under
  the minted owner JWT is the only authorization boundary, identical to the interactive path.
- **NFR-AAN-SEC-006 — Credits are enforced before start, not after.** The preflight (FR-AAN-032)
  runs and can veto before any `agent_runs` row reaches `running`; there is no path where a
  background run executes and is billed/reconciled after the fact past the owner's balance
  (FR-AAN-033).
- **NFR-AAN-SEC-007 — No prompt/event/notification content in logs.** Dispatcher logs on error
  carry automation id, source, and error codes/counts — never `prompt`/`condition` text or
  notification `title`/`body` content (mirrors NFR-AGP-SEC-005 / NFR-AR-SEC-005).
- **NFR-AAN-SEC-008 — The minted JWT is never persisted or logged.** No table, log line, or cache
  entry ever contains the minted JWT or a refresh token derived from it (FR-AAN-018).

### Performance

- **NFR-AAN-PERF-001 — Dispatcher tick is bounded.** A single dispatcher invocation completes
  within its own wall-clock budget regardless of the number of enabled automations at typical
  single-tenant scale (schedule selection is an indexed range/match query; event-trigger selection
  is a bounded, watermark-indexed range scan per source, FR-AAN-012/013).
- **NFR-AAN-PERF-002 — The unread-badge query is indexed.** `notifications (owner_id) where
  read_at is null` (FR-AAN-007) makes the badge count a single indexed lookup, not a table scan.
- **NFR-AAN-PERF-003 — Condition memoization bounds re-billing.** The TTL memoization (FR-AAN-022)
  caps the number of cheap-model calls per condition per burst window, independent of the number of
  matching events in that window.

### Accessibility (WCAG 2.1 AA)

- **NFR-AAN-A11Y-001 — The bell is keyboard-operable with a programmatic unread count.** The bell
  control has a visible focus ring and an `aria-label` that includes the unread count (e.g.
  "Notifications, 3 unread"), consistent with `ContextBar`'s existing button patterns.
- **NFR-AAN-A11Y-002 — The inbox list is a semantic list with accessible read/unread state.**
  Read/unread is conveyed by text/`aria-*` state, not color alone (mirrors NFR-AGP-A11Y-003's
  thread-list precedent).
- **NFR-AAN-A11Y-003 — A new unread notification is announced.** The bell's badge update (or an
  equivalent live region) uses `aria-live="polite"` so a screen-reader user learns a new
  notification arrived without needing to poll visually.

---

## Acceptance Criteria

> Layer per ADR-0010: **pgTAP** for RLS/tenancy/CHECK-constraint/mark-read contracts, including the
> cross-tenant minting-gate expectations (proving the minted-JWT path denies cross-tenant reads
> identically to the interactive path); **Unit** (Vitest, mocked auth-admin + Supabase + model) for
> dispatcher selection/watermark/condition/credits/mint-scoping logic; **E2E** (Playwright, ONE
> curated cross-stack journey per ADR-0044 Verification). Each AC names its owning layer; the
> traceability table records the canonical owner.

### Schema & constraints — `agent_automations`

**AC-AAN-001 — Table exists with required columns. [pgTAP]**
Given the migration is applied,
When the schema is inspected,
Then `agent_automations` exists with exactly the columns of ADR-0044 §1 (including `kind` CHECK
`'schedule'|'trigger'`, nullable `schedule`/`trigger_on`/`condition`/`last_fired_at`/`archived_at`).

**AC-AAN-002 — `kind='schedule'` requires a non-null `schedule`. [pgTAP]**
Given an insert with `kind='schedule'` and `schedule = null`,
When the insert is attempted,
Then it is rejected by the `CHECK` constraint.

**AC-AAN-003 — `kind='trigger'` requires a non-null `trigger_on`. [pgTAP]**
Given an insert with `kind='trigger'` and `trigger_on = null`,
When the insert is attempted,
Then it is rejected by the `CHECK` constraint.

**AC-AAN-004 — A valid `kind='schedule'` row and a valid `kind='trigger'` row both insert cleanly.
[pgTAP]**
Given a `kind='schedule'` row with a non-null `schedule` and a `kind='trigger'` row with a non-null
`trigger_on`,
When both are inserted,
Then both succeed.

### RLS — `agent_automations` tenancy

**AC-AAN-005 — Owner reads own automations; non-owner in the same org reads zero. [pgTAP]**
Given user A creates an automation,
When user B (same org, not the owner) queries for it,
Then user B's query returns zero rows.

**AC-AAN-006 — Cross-org read returns zero regardless of role, including Admin. [pgTAP]**
Given user A (org 1) owns an automation,
When a user in org 2 — including an org-2 Admin — queries for it,
Then zero rows are returned.

**AC-AAN-007 — INSERT pins org_id and owner_id; a spoofed owner_id is rejected. [pgTAP]**
Given user A is authenticated,
When user A inserts an automation with an explicit `owner_id` of another user,
Then the insert is denied by `WITH CHECK`.

**AC-AAN-008 — `enabled=false` and archived automations are excluded from the dispatcher's
selection query. [pgTAP]**
Given three automations — one `enabled=false`, one `archived_at` set, one live-and-due —
When the dispatcher's due-selection query runs (as a SQL query, independent of the edge fn),
Then only the live-and-due automation is returned.

### Schema & RLS — `notifications`

**AC-AAN-009 — Table exists with required columns and the unread index. [pgTAP]**
Given the migration is applied,
When the schema/index are inspected,
Then `notifications` exists with exactly the columns of ADR-0044 §5, and `notifications (owner_id)
where read_at is null` exists.

**AC-AAN-010 — Owner reads own notifications; non-owner in the same org reads zero. [pgTAP]**
Given a notification addressed to user A,
When user B (same org) queries for it,
Then zero rows are returned.

**AC-AAN-011 — Cross-org read returns zero regardless of role. [pgTAP]**
Given a notification addressed to user A (org 1),
When a user in org 2 (including Admin) queries for it,
Then zero rows are returned.

**AC-AAN-012 — INSERT pins owner_id; a caller cannot create a notification for another user.
[pgTAP]**
Given user A is authenticated,
When user A inserts a notification with `owner_id` set to another user,
Then the insert is denied by `WITH CHECK`.

**AC-AAN-013 — The mark-read UPDATE succeeds for the owner and touches only `read_at`. [pgTAP]**
Given a notification owned by the caller with `read_at is null`,
When the caller `UPDATE`s only `read_at`,
Then the update succeeds and `title`/`body`/`severity`/`metadata` are unchanged.

**AC-AAN-014 — The mark-read UPDATE is denied for a non-owner. [pgTAP]**
Given a notification owned by user A,
When user B attempts the mark-read UPDATE on it,
Then it is denied (zero rows affected).

**AC-AAN-015 — A direct UPDATE touching `title`/`body`/`severity`/`metadata` is rejected. [pgTAP]**
Given a notification owned by the caller,
When the caller attempts `UPDATE ... SET title = ...` (or `body`/`severity`/`metadata`) directly,
Then the update is denied — content is immutable even for the owner.

### The minted-JWT cross-tenant gate (the load-bearing test, ADR-0044 Verification)

**AC-AAN-016 — Minting is scoped to exactly the dispatched row's `owner_id`. [Unit]**
Given an automation owned by user A is selected for dispatch,
When the dispatcher mints a JWT for the fire,
Then the Auth admin API is called with exactly user A's uid — never a request-supplied or
model-supplied id, and never any other user's id present in the same dispatch call's scope.

**AC-AAN-017 — Every mint is audited. [Unit]**
Given a dispatch that mints a JWT,
When the mint completes,
Then an audit record (automation id, `owner_id`, minted-at) is created before the minted client is
used for anything else.

**AC-AAN-018 — `service_role` in the dispatcher never queries business data. [Unit]**
Given the dispatcher's full selection→mint→fire cycle for one tick,
When every Supabase call made under `service_role` is inspected,
Then the set of tables touched is exactly `{agent_automations}` ∪ the configured status-event
source tables — no other table appears under a `service_role` call.

**AC-AAN-019 — An automation owned by user A, run under the minted A-JWT, is denied any read/write
of user B's data by RLS — identical to the interactive deputy-invariant result. [pgTAP + Unit]**
Given automation owned by user A fires and mints A's JWT,
When the fired run (via the standard `AgentAction` catalog) attempts to read/write a row owned by
user B,
Then RLS denies it byte-for-byte identically to an interactive run authenticated as A attempting
the same operation (ports the retired branch's `deputy-invariant.gate.test` shape, extended to the
minted-JWT path, per ADR-0044 Verification).

**AC-AAN-020 — The minted JWT is never persisted. [Unit]**
Given a completed dispatch cycle,
When the automation row, the audit record, and the created `agent_runs`/`agent_events` rows are
inspected,
Then none contain the minted JWT or a refresh token derived from it.

### Dispatcher — schedule + event-trigger selection

**AC-AAN-021 — Cron selection fires due schedules only. [Unit]**
Given three `kind='schedule'` automations — one whose cron matches the current tick, two that do
not,
When the dispatcher's schedule-selection runs,
Then only the matching automation is fired.

**AC-AAN-022 — Watermark advances and does not double-fire. [Unit]**
Given a `kind='trigger'` automation and two ticks where the second tick's status-event window
overlaps the first (no new events since the watermark),
When both ticks run,
Then the automation fires at most once for the original matching event (the second tick sees zero
new events past the advanced watermark).

**AC-AAN-023 — An NL condition evaluating false does not fire and produces no notification. [Unit]**
Given a trigger automation with a `condition` and a matching event,
When the cheap-tier model evaluates the condition as false,
Then the run does not fire and no notification is created.

**AC-AAN-024 — An NL condition evaluating ambiguous/erroring does not fire and produces a warning
notification. [Unit]**
Given a trigger automation with a `condition` and a matching event,
When the cheap-tier model call errors or returns an unparseable result,
Then the run does not fire and a `severity='warning'` notification is created for the owner.

**AC-AAN-025 — Condition evaluation is memoized within the TTL. [Unit]**
Given a burst of N matching events for the same automation/condition within the TTL window,
When the dispatcher processes the burst,
Then the cheap-tier model is called at most once for that `(automation_id, condition)` key within
the window (subsequent events reuse the memoized result).

**AC-AAN-026 — A long-run completion produces a notification. [Unit]**
Given a run reaches a terminal state and calls `notify` before finishing,
Then a `notifications` row is created for the run's owner with `metadata.run_id` set to that run.

**AC-AAN-027 — Over-credit is no-start plus a warning notification. [Unit]**
Given the owner's credit balance would be exceeded by the automation's estimated run cost,
When the dispatcher's preflight check runs before firing,
Then no `agent_runs` row is created and a `severity='warning'` notification is created for the
owner ("automation X skipped — out of credits").

### `create_automation` / `notify` actions

**AC-AAN-028 — `create_automation` requires approval (confirm:true) like other writes. [Unit]**
Given the model proposes a `create_automation` tool call with valid args,
When the handler processes it,
Then a `needs-approval` status event is emitted (no row is written) — identical in shape to
`create_activity`'s approve-chip flow.

**AC-AAN-029 — Approving `create_automation` writes the row under the caller's JWT. [Unit]**
Given the user approves a pending `create_automation`,
When `dispatchActionForced` executes it,
Then an `agent_automations` row is inserted via the caller-JWT-scoped client (never
`service_role`), owned by the caller.

**AC-AAN-030 — `create_automation` args validation mirrors the kind-conditional DB constraint.
[Unit]**
Given a `create_automation` proposal with `kind='schedule'` and no `schedule` field,
When `validate` runs,
Then it returns `ok:false` with a descriptive error — no `needs-approval` event is emitted (mirrors
`AC-AW-005`'s invalid-args-no-approval-event pattern).

**AC-AAN-031 — `notify` is `confirm:false` and dispatches immediately. [Unit]**
Given the model (or the dispatcher, for a background run) calls `notify` with valid args,
When the handler processes it,
Then the `notifications` row is inserted immediately (no approval round-trip), addressed to the
calling identity's own `owner_id`.

### Bell + inbox UI

**AC-AAN-032 — The bell's badge reflects the caller's unread count. [Unit]**
Given the caller has 3 unread and 2 read notifications,
When `ContextBar` renders,
Then the bell shows an unread badge of 3.

**AC-AAN-033 — Opening the bell lists the caller's notifications, most recent first. [Unit]**
Given the caller has notifications created at distinct times,
When the inbox opens,
Then they render ordered `created_at desc`.

**AC-AAN-034 — Selecting a notification marks it read and updates the badge. [Unit]**
Given an unread notification is selected,
When the mark-read UPDATE resolves,
Then that notification's read state flips and the bell's unread badge decrements by one.

**AC-AAN-035 — Selecting a notification with `metadata.entity` navigates to that record. [Unit]**
Given a notification whose `metadata.entity = {type:'procurement_case', id, label}` resolves to an
existing record,
When the user selects it,
Then the app navigates to that record's page.

### Cross-stack — the curated e2e (ADR-0044 Verification, ONE journey)

**AC-AAN-036 — Create a scheduled automation via chat, a simulated fire produces a run + an in-app
notification; a second user never sees it. [E2E]**
Given a signed-in user asks the assistant to create a scheduled automation and approves the
resulting chip,
When the automation appears in the (chat-surfaced or future list) confirmation and a simulated
dispatcher fire runs against it,
Then a new run is created under the automation's owner and an in-app notification appears — the
bell's unread badge increments — and when a **second** user signs in, they see no trace of the
first user's automation or notification (no rows returned, bell shows their own count only).

---

## Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-AAN-001 | pgTAP | `AC-AAN-001 agent_automations table exists with required columns` (`supabase/tests/0094_agent_automations_schema.test.sql`) |
| AC-AAN-002 | pgTAP | `AC-AAN-002 kind=schedule requires non-null schedule` |
| AC-AAN-003 | pgTAP | `AC-AAN-003 kind=trigger requires non-null trigger_on` |
| AC-AAN-004 | pgTAP | `AC-AAN-004 valid schedule and trigger rows insert cleanly` |
| AC-AAN-005 | pgTAP | `AC-AAN-005 non-owner same-org reads zero` (`supabase/tests/0095_agent_automations_tenancy.test.sql`) |
| AC-AAN-006 | pgTAP | `AC-AAN-006 cross-org read zero incl admin` |
| AC-AAN-007 | pgTAP | `AC-AAN-007 insert pins org and owner, spoofed owner denied` |
| AC-AAN-008 | pgTAP | `AC-AAN-008 disabled/archived excluded from dispatcher selection` |
| AC-AAN-009 | pgTAP | `AC-AAN-009 notifications table + unread index exist` (`supabase/tests/0096_notifications_schema.test.sql`) |
| AC-AAN-010 | pgTAP | `AC-AAN-010 non-owner same-org reads zero` (`supabase/tests/0097_notifications_tenancy.test.sql`) |
| AC-AAN-011 | pgTAP | `AC-AAN-011 cross-org read zero` |
| AC-AAN-012 | pgTAP | `AC-AAN-012 insert pins owner_id, spoofed recipient denied` |
| AC-AAN-013 | pgTAP | `AC-AAN-013 mark-read update succeeds owner, only touches read_at` (`supabase/tests/0098_notifications_mark_read.test.sql`) |
| AC-AAN-014 | pgTAP | `AC-AAN-014 mark-read update denied non-owner` |
| AC-AAN-015 | pgTAP | `AC-AAN-015 direct content update rejected` |
| AC-AAN-016 | Unit | `AC-AAN-016 mint scoped to exactly dispatched row owner_id` (`supabase/functions/agent-dispatch/dispatcher.mint.test.ts`) |
| AC-AAN-017 | Unit | `AC-AAN-017 every mint audited before use` |
| AC-AAN-018 | Unit | `AC-AAN-018 service_role never queries business data` (`supabase/functions/agent-dispatch/dispatcher.deputy-invariant.test.ts`) |
| AC-AAN-019 | pgTAP + Unit | `AC-AAN-019 minted-JWT cross-tenant denial identical to interactive` (`supabase/tests/0099_agent_automations_minting_gate.test.sql` + `dispatcher.deputy-invariant.test.ts`) |
| AC-AAN-020 | Unit | `AC-AAN-020 minted JWT never persisted` |
| AC-AAN-021 | Unit | `AC-AAN-021 cron selection fires due schedules only` (`supabase/functions/agent-dispatch/dispatcher.schedule.test.ts`) |
| AC-AAN-022 | Unit | `AC-AAN-022 watermark advances, no double-fire` (`supabase/functions/agent-dispatch/dispatcher.watermark.test.ts`) |
| AC-AAN-023 | Unit | `AC-AAN-023 condition false no-fire no notification` (`supabase/functions/agent-dispatch/dispatcher.condition.test.ts`) |
| AC-AAN-024 | Unit | `AC-AAN-024 condition ambiguous no-fire plus warning notification` |
| AC-AAN-025 | Unit | `AC-AAN-025 condition evaluation memoized within TTL` |
| AC-AAN-026 | Unit | `AC-AAN-026 long-run completion produces notification` (`supabase/functions/agent-chat/actions.notify.test.ts`) |
| AC-AAN-027 | Unit | `AC-AAN-027 over-credit no-start plus warning notification` (`supabase/functions/agent-dispatch/dispatcher.credits.test.ts`) |
| AC-AAN-028 | Unit | `AC-AAN-028 create_automation requires approval` (`supabase/functions/agent-chat/actions.create_automation.test.ts`) |
| AC-AAN-029 | Unit | `AC-AAN-029 approved create_automation writes under caller JWT` |
| AC-AAN-030 | Unit | `AC-AAN-030 validate mirrors kind-conditional constraint` |
| AC-AAN-031 | Unit | `AC-AAN-031 notify confirm:false dispatches immediately` (`supabase/functions/agent-chat/actions.notify.test.ts`) |
| AC-AAN-032 | Unit | `AC-AAN-032 bell badge reflects unread count` (`pmo-portal/src/components/shell/__tests__/NotificationBell.test.tsx`) |
| AC-AAN-033 | Unit | `AC-AAN-033 inbox lists most recent first` |
| AC-AAN-034 | Unit | `AC-AAN-034 select marks read, badge decrements` |
| AC-AAN-035 | Unit | `AC-AAN-035 select with metadata.entity navigates` |
| AC-AAN-036 | E2E | `AC-AAN-036 create automation simulated fire notification second user cannot see` (`pmo-portal/e2e/AC-AAN-036-automation-notification.spec.ts`) |

---

## SoD & Security (OWASP / STRIDE)

**Elevation of privilege / the deputy invariant (STRIDE-E, ADR-0036 §2) — the central risk of this
feature.** A background run has no live user, which is the exact condition that has historically
tempted `service_role` execution. This spec's entire dispatcher design exists to avoid that: minting
(FR-AAN-016/017/018) is the **only** privileged operation, is scoped to exactly one row's
`owner_id`, is audited (FR-AAN-019), and hands off immediately to the ordinary caller-JWT-scoped
deputy path — RLS is the ceiling for a minted run exactly as for an interactive one (AC-AAN-019 is
the load-bearing proof). `service_role` is additionally quarantined to metadata
selection/enumeration (FR-AAN-014/NFR-AAN-SEC-002, AC-AAN-018) — it is provably never used to read
or write business data.

**Spoofing / tenancy (STRIDE-S, OWASP A01 broken access control).** Both new tables are
`enable`+`force` RLS, owner-only (`owner_id = auth.uid() and org_id = auth_org_id()`), with
`org_id`/`owner_id` server-stamped via column default + `WITH CHECK` re-pin, never client-trusted
(NFR-AAN-SEC-003).

**Tampering (STRIDE-T, OWASP A01/A08).** `notifications` content is immutable post-creation except
the single narrow mark-read UPDATE, itself `WITH CHECK`-constrained to the owner and to `read_at`
only (NFR-AAN-SEC-004) — a hand-crafted PATCH cannot alter a notification's title/body/severity or
reassign its recipient.

**Repudiation (STRIDE-R).** The mint audit record (FR-AAN-019) plus the fired run's ordinary
`agent_events` log (ADR-0043) together give a complete trail of every background execution: who it
ran as, when it was minted, and everything it did.

**Injection (OWASP A03).** No new user-controlled string is interpolated into SQL; cron-expression
and `trigger_on` values are stored as opaque text/jsonb and matched via parameterized comparisons,
never concatenated into dynamic SQL. The NL `condition` is sent to the model as untrusted content
(ADR-0039's untrusted-output boundary applies identically — a condition's model output is a
true/false/ambiguous verdict, never executable instructions).

**Denial of service / cost (OWASP A04 — resource exhaustion, PMO-specific).** The credits preflight
(NFR-AAN-SEC-006) bounds background spend on the same per-user meter as interactive spend; the
condition-evaluation TTL memoization (NFR-AAN-PERF-003) bounds cheap-model calls under an event
burst; `timeout_s` bounds a single fired run's wall-clock cost.

**Depth note (model-tiering).** This is the highest-security-sensitivity issue in the agent-native
program to date — a new privileged (minting) code path plus two new RLS-bearing tables plus a
new edge function. security-auditor runs at full depth on the migration, the dispatcher edge fn
in its entirety, and both new `agent-chat` catalog entries — not a light pass (ADR-0044
Consequences).

---

## Error Handling

| Error condition | Surface / code | User message |
|---|---|---|
| Cross-org or cross-owner automation/notification read | RLS (zero rows) | Row simply does not appear; no error surfaced (indistinguishable from non-existence). |
| `kind='schedule'` insert with null `schedule` (or `kind='trigger'` with null `trigger_on`) | DB CHECK violation (`23514`) via `create_automation`'s `validate` (caught before the DB round-trip) | "A scheduled automation needs a schedule" / "A trigger automation needs a source and event" — surfaced as the tool_result error to the model, which relays it conversationally. |
| Mint fails (Auth admin API error) | Dispatcher logs error code; automation not fired this tick | No user-facing error this tick; next tick retries (schedule) or the event remains unprocessed until the next successful tick (trigger, watermark not advanced past the failure). |
| NL condition evaluation errors/ambiguous | No-fire | `severity='warning'` notification: "couldn't evaluate the condition for automation X". |
| Over-credit at dispatch | No-start | `severity='warning'` notification: "automation X skipped — out of credits". |
| Mark-read UPDATE on a non-owned notification | RLS `42501` (zero rows affected) | Inbox item does not visually update; no destructive effect. |
| Direct content-mutating UPDATE on `notifications` | RLS `42501` | N/A (no client code path attempts this; a direct API call is denied silently by RLS). |
| `notify`/`create_automation` DB error (transient) | Structured `{error, code}` tool_result | Model relays "I couldn't create that automation / send that notification right now" — no raw DB error echoed (NFR-AAN-SEC-007). |

---

## Implementation TODO

### Backend (migration + RLS + pgTAP)

- [ ] Migration `0047_agent_automations_notifications.sql`: create `agent_automations` (columns,
      `kind`-conditional `CHECK`s, defaults, indexes — including one supporting the dispatcher's due
      selection) and `notifications` (columns, the unread partial index) exactly per ADR-0044 §1/§5;
      `enable`+`force` RLS; owner-only `select`/`insert`/`update`/`delete` policies on
      `agent_automations`; owner-only `select`/`insert`/`delete` + the narrow mark-read-only
      `update` policy on `notifications` (mirrors the ADR-0043 §2 feedback-UPDATE shape).
- [ ] Register the `pg_cron` job (per-minute) invoking `agent-dispatch` — migration or Supabase
      config, per the project's existing `pg_cron` setup convention (confirm at build time; no prior
      `pg_cron` job exists in this repo yet — first one).
- [ ] Watermark storage: a small table or a column on a singleton config row per event source
      (`{source, last_seen_id, last_seen_at}`) — eng-plan picks the exact shape (FR-AAN-013).
- [ ] pgTAP: `0094_agent_automations_schema.test.sql` (AC-AAN-001..004),
      `0095_agent_automations_tenancy.test.sql` (AC-AAN-005..008, mirrors
      `0092_agent_persistence_tenancy.test.sql` shape), `0096_notifications_schema.test.sql`
      (AC-AAN-009), `0097_notifications_tenancy.test.sql` (AC-AAN-010..012),
      `0098_notifications_mark_read.test.sql` (AC-AAN-013..015),
      `0099_agent_automations_minting_gate.test.sql` (AC-AAN-019, the load-bearing cross-tenant
      proof — sets up the minted-JWT session under `set local request.jwt.claims` exactly as an
      interactive session would, then asserts identical denial).

### Backend (dispatcher edge fn — NEW, does not touch `agent-chat`)

- [ ] `supabase/functions/agent-dispatch/` (new function): `index.ts` (Deno.serve entry, invoked by
      `pg_cron`), `dispatcher.ts` (pure selection/mint/fire logic, importable in Vitest — mirrors
      `agent-chat/handler.ts`'s pure-generator pattern), `watermark.ts` (read/advance watermark per
      source).
- [ ] Schedule-selection query (FR-AAN-011/AC-AAN-021) + event-trigger selection + watermark advance
      (FR-AAN-012/013/AC-AAN-022).
- [ ] Minting: call the Supabase Auth admin API under `service_role`, scoped to the dispatched row's
      `owner_id` only (FR-AAN-016), write the audit record (FR-AAN-019) before using the minted
      client, bound lifetime to `timeout_s` (FR-AAN-018), never persist the JWT (FR-AAN-020).
- [ ] Condition evaluation: cheap-tier `ModelClient` call + TTL memoization (FR-AAN-021/022) +
      true/false/ambiguous branching (FR-AAN-023/024).
- [ ] Credits preflight call before firing (FR-AAN-032/033) — extends the `RateGuard` seam per
      `docs/specs/agent-usage-credits.spec.md`.
- [ ] On fire: invoke `agentChatHandler` with the minted-JWT-scoped `HandlerDeps.supabase` +
      `deps.userId = owner_id`, exactly as index.ts does for an interactive request (FR-AAN-017/020).
- [ ] Unit tests: `dispatcher.mint.test.ts` (AC-AAN-016/017/020), `dispatcher.deputy-invariant.test.ts`
      (AC-AAN-018/019, port the retired sidecar's gate-test shape), `dispatcher.schedule.test.ts`
      (AC-AAN-021), `dispatcher.watermark.test.ts` (AC-AAN-022), `dispatcher.condition.test.ts`
      (AC-AAN-023/024/025), `dispatcher.credits.test.ts` (AC-AAN-027).

### Backend (agent-chat catalog — small touch, per the issue's scope)

- [ ] `actions.ts`: add `notifyAction` (`confirm:false`, `run` inserts into `notifications` under
      `ctx.supabase`) and `createAutomationAction` (`confirm:true`, `validate` mirrors
      FR-AAN-002/030, `summarize` renders a human-readable automation description, `run` inserts
      into `agent_automations`).
- [ ] `schema.ts`: `NOTIFY_SCHEMA`, `CREATE_AUTOMATION_SCHEMA` (JSON Schema, mirrors
      `CREATE_ACTIVITY_SCHEMA`/`UPDATE_TASK_STATUS_SCHEMA` style).
- [ ] `handler.ts`: register both in `BASE_ACTIONS`/`BASE_ACTION_BY_NAME`; add `create_automation`'s
      `getPermissionCheck` mapping if a `can()` gate is warranted (confirm at build time whether
      automation-creation needs a role check beyond ownership — default: any authenticated role may
      create their own automation, no additional `can()` gate, matching `create_activity`'s
      unchecked-by-role precedent... confirm against `policy.ts` at build time).
- [ ] Unit tests: `actions.notify.test.ts` (AC-AAN-026/031), `actions.create_automation.test.ts`
      (AC-AAN-028/029/030).

### Frontend (repository seam + bell/inbox UI)

- [ ] `src/lib/repositories/notifications.ts` / `agentAutomations.ts` (typed from regenerated DB
      types, not hand-cast).
- [ ] `NotificationBell` component (badge + inbox popover) wired into `ContextBar`, replacing the
      dead `notificationCount` prop wiring with a real unread-count query/subscription
      (FR-AAN-034/035, AC-AAN-032/033).
- [ ] Mark-read on select + deep-link resolution (`metadata.entity` → route,
      `metadata.run_id` → thread resume) (FR-AAN-036, AC-AAN-034/035).
- [ ] All of the above gated behind `isFeatureEnabled('agentAssistant')` (FR-AAN-038).
- [ ] Unit tests: `NotificationBell.test.tsx` (AC-AAN-032..035).

### E2E / gates

- [ ] `e2e/AC-AAN-036-automation-notification.spec.ts`: chat-create a scheduled automation (approve
      chip) → simulated dispatcher fire → run + in-app notification appear, bell badge increments →
      second user sees neither.
- [ ] Full `npm run verify` before PR; render the bell/inbox (empty, unread, read states) before
      promote — MEMORY durable rule (rendered-review-catches-what-tests-pass).
- [ ] security-auditor full-depth pass on the migration + `agent-dispatch` (entire function) + the
      two new `agent-chat` catalog entries (NFR-AAN-SEC-001, "Depth note" above).

---

## Out of Scope (deferred)

- **Webhook/Slack/email notification channels.** ADR-0044 §5 commits to a channel *seam* (the
  `notifications` row is the durable record); this issue implements the in-app channel only. No
  channel-selection UI, no outbound webhook/SMTP/Slack integration code.
- **Shared automations (`runAs: creator|shared`).** v1 is owner-only (FR-AAN-003); no sharing scope,
  no delegation of automation ownership.
- **Deterministic (non-NL) trigger conditions.** Only the NL `condition` text evaluated by the
  cheap-tier model is implemented; a structured/deterministic condition DSL is not built.
- **A dedicated UI list/editor for automations.** `create_automation` is chat-only in this issue
  (an approve chip via conversation); a standalone "My Automations" management page (edit/disable/
  delete via UI, not just via a follow-up chat message) is deferred.
- **Sub-minute event-trigger latency / a dedicated queue table.** Poll-since-watermark accepts
  up-to-one-tick (≤1 minute) latency (ADR-0044 §2); a `pg_trigger`→`pg_net`→edge-fn push path is a
  future option behind the unchanged automation contract, not built here.
- **PostHog analytics events for automations/notifications.** Not built in this issue (mirrors the
  ADR-0043 spec's identical deferral of item 4).

---

## Contradictions / conflicts flagged against existing code & locked decisions

**Dependency not yet present at spec time:** ADR-0044 §6 and this spec's credits requirements
(FR-AAN-032/033, NFR-AAN-SEC-006) consume the credits preflight seam described as
`docs/specs/agent-usage-credits.spec.md` in this issue's brief. That file does not exist in the repo
at spec-authoring time (only `docs/specs/agent-persistence.spec.md` — ADR-0043's operationalization
— is present; ADR-0043 itself is Accepted and its tables are already migrated as `0046_agent_persistence.sql`
on this branch). This spec references the credits spec **by name** for the preflight contract
(mirroring how ADR-0044 itself references it as "the existing `RateGuard` injection point"); the
eng-plan for this issue MUST confirm the credits spec's exact preflight function signature before
implementing FR-AAN-032/033 — if the credits issue has not shipped by the time this spec is built,
FR-AAN-032/033/AC-AAN-027 are blocked on it (the suggested build order in `docs/backlog.md` already
sequences credits (3) before automations (5) for this reason).

No other contradiction found. ADR-0044 is Accepted and is the controlling authority; this spec is a
direct operationalization of its §1–§6 with no attempted revision.

## Open Questions

Left to the eng-plan (not requiring owner adjudication, per the ADR-0043 spec's precedent of
letting the plan pick file names/exact SQL/mechanical choices):

- Exact migration number (assumed `0047_agent_automations_notifications.sql` — next after
  `0046_agent_persistence.sql` at spec time; the eng-plan confirms against `dev`/`main` at build
  time, since ADR-0043's persistence branch may have merged and advanced the sequence).
- Exact watermark-storage shape (a new small table vs. a column on an existing config/singleton row)
  — FR-AAN-013 fixes the behavior, not the storage shape.
- Whether `create_automation` needs a `can()`/role gate beyond ownership (the spec defaults to "any
  authenticated role may create their own automation," matching `create_activity`'s precedent of no
  additional role check) — confirm against `src/auth/policy.ts`'s existing policy map at build time;
  if a role restriction is wanted (e.g. only certain roles may create trigger-kind automations on
  sensitive sources), that is an owner-adjudicated policy decision, not a mechanical one, and should
  be raised before Build if discovered.
- Exact cron-expression parsing/matching library for the dispatcher's schedule-selection query
  (native Postgres `pg_cron` syntax vs. an app-side parser) — a mechanical implementation choice
  bounded by FR-AAN-011's behavior, not a design decision.
- The precise `timeout_s` enforcement mechanism (edge function wall-clock cap vs. an explicit
  `AbortController` deadline passed into `agentChatHandler`) — FR-AAN-018 fixes the bound, not the
  mechanism; the eng-plan should reuse whatever `MAX_TOOL_ROUNDS`-adjacent bounding `agent-chat`
  already has where possible (OBS-AAN-003).
