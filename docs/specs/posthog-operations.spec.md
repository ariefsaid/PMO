# Spec: PostHog for operations (errors, jobs, AI) and product demos

Issue #1532. Status: **Draft for owner sign-off** (2026-10-31). Spec prefix: `PHO`
(`FR-PHO-###`, `NFR-PHO-###`, `AC-PHO-###`).

> The data already reaches PostHog. Nothing tells anyone when something breaks. This spec adds the
> alerts, the run/outcome signals and the AI view that turn the data into "I know before the client does".

- **Extends (does not replace):** `docs/specs/posthog-instrumentation.spec.md` (facade, modes, demo
  replay), `docs/specs/agent-posthog-events.spec.md` (nine `agent_*` events),
  `docs/specs/observability-analytics.spec.md` (§1.3 PostHog = triage surface, Postgres = record;
  friction events; quota alarm; consent), ADR-0066 (edge error choke point), ADR-0067 (friction +
  consent posture), `docs/posthog-dashboards.md`, `docs/analytics-events.md`.
- **Grounds:** ADR-0055 (adapter seam, SoT by domain), ADR-0058 (outbox), ADR-0052 (agent eval
  harness), ADR-0010 (test pyramid), ADR-0043 (agent persistence), DD-OPS-7 (`docs/decisions.md`:
  reuse the monitoring floor; one deployment, any alert is client-affecting).
- **Shipped files this spec extends (all verified present at `origin/dev` 4acce5091):**
  `pmo-portal/src/lib/analytics/{client,events,index,eventCallSites,safeTrack,AnalyticsProvider}.ts(x)`,
  `pmo-portal/src/lib/classifyMutationError.ts`, `pmo-portal/src/lib/features.ts`,
  `pmo-portal/src/lib/adapterSeam/{dispatch,pendingPush,pushErrorCopy}.ts`,
  `supabase/functions/_shared/{posthogError,reportEdgeError,serveWithErrorReporting,errorLog,errorEvent,usage,modelClient}.ts`,
  `supabase/functions/agent-chat/handler.ts` (`runToolLoop`), `supabase/functions/compose-view/handler.ts`,
  `supabase/functions/agent-dispatch/`, `supabase/functions/erpnext-sweep/index.ts`,
  `supabase/functions/clickup-sweep/index.ts`, `supabase/functions/clickup-webhook-worker/index.ts`,
  `supabase/functions/adapter-dispatch/index.ts`, `scripts/posthog/{provision-dashboards,quota,check-quota}.mjs`,
  `scripts/{check-dashboard-tiles,check-edge-fn-error-reporting}.mjs`, `.github/workflows/posthog-quota.yml`.
- **Shipped tables/jobs relied on:** `error_events` (0071), `agent_usage` (0047), `agent_runs`/
  `agent_events` (0046), `external_command_outbox` (0096; states `pending|committing|committed|confirmed|failed|quarantined|held`),
  `org_features` (0070), pg_cron ticks `erpnext-sweep-tick` (every minute, 0356), `clickup-sweep-tick`
  (5 min, 0094), `clickup-webhook-worker-tick` (every minute, 0143), `agent-dispatch-tick` (hourly, 0082),
  `telegram-notify-tick` (hourly, 0083).

---

## 0. Open questions for the owner (each with the default the builders will take)

**Director, 2026-10-31:** all eight defaults taken (#1532 is ready-for-agent; Director decides tactical scope). Slice 8 (flags) held pending an owner yes.

| # | Question | Default taken if no answer |
|---|---|---|
| OQ-1 | **Alert channel.** PostHog issue alerts go to Slack, Discord, Teams or an HTTP webhook; email exists only for trend alerts; Telegram has no native destination. Which channel? | Issue alerts (new error, spike) → HTTP-webhook destination pointed at the Telegram bot send call (no new PMO endpoint). Job-health and push-failure alerts → trend alerts by email. Owner action in PostHog settings (FR-PHO-004). Confirm the webhook route works at build; if not, email only. |
| OQ-2 | **Per-user AI cost in PostHog.** The issue asks for cost per org/user/day. A server event cannot see a browser's analytics opt-out, so a user id on it would bypass "consent rules unchanged". | AI events carry `org_id` only, no user id. Per-user cost stays in Administration › Usage (shipped, reads `agent_usage` by owner). Dashboard shows per org/day. Say "add user" and builders add the opaque user id, honour the opt-out via a request flag, and update `/privacy`. |
| OQ-3 | **Business events (item 8) reverse an earlier deferral.** OD-OBS-3 deferred customer-adoption metrics. | Lift it for exactly four events (budget activated, invoice issued, payment recorded, purchase approved), `org_id` as a plain property, **no** PostHog Group Analytics (paid). Consent-gated client events, same as today. |
| OQ-4 | **Feature flags (item 9) contradict a written non-goal** (`observability-analytics.spec.md` §1.4): when the flag quota runs out the SDK returns `false` for every flag, so a gated feature vanishes. Per-org rollout already exists via `org_features` and Administration › Features. | Do **not** build slice 8 until answered. If yes: PostHog flags only for **new, off-by-default** features (a lost flag fails safe to off); existing switches and `org_features` stay the authority; local fallback on SDK failure. Org targeting needs `org_id` as a person property on the identified user (non-personal; `identified_only` unchanged). |
| OQ-5 | **Logs (item 3).** PostHog Logs ingests OpenTelemetry. Free allowance and retention were not confirmable from public docs. | Slice 7 starts with a one-hour check of the live allowance. If there is no free allowance or retention is not materially longer than the platform's, drop slice 7 and record why. If kept: forward only the structured error lines (`logStructuredError` output: function, code, context id), never raw `console` output. |
| OQ-6 | **Surveys (issue item 10).** The brief lists nine items; the issue lists ten. | Out of scope here; separate issue after the demo funnels have run for a few demos. |
| OQ-7 | **Prompt/response text switch.** The issue says none "by default". | No switch is built. Content capture would be a new spec and a privacy review. |
| OQ-8 | **"Missing run" threshold per job.** | Alert when a job has zero `job_run` events for 3× its cadence (minute jobs: 5 min; 5-min job: 20 min; hourly jobs: 3 h), plus any `failed` run. Tunable in PostHog without a deploy. |

**Owner rulings on S1, 2026-10-31 (supersede OQ-2 and OQ-7 for the AI events).** Built as:

- **FR-PHO-090** The demo org (`organizations.lifecycle_state = 'demo'`, read under the caller's JWT, fail closed) captures prompt, reply and tool I/O text on `$ai_generation`/`$ai_span`/`$ai_trace`, only for a user whose browser sent the analytics-consent flag, linked to the session replay (`$session_id`). Any other org: numbers and codes only (FR-PHO-004 stands for them). *AC-PHO-090, AC-PHO-091.*
- **FR-PHO-092** AI events carry the opaque auth user id (`user_id`) and `$session_id` only with the consent flag; the browser sends the flag only while analytics is active (not opted out, no Do Not Track). *AC-PHO-092.*
- **FR-PHO-093** After a completed run, an in-function LLM judge (never a Claude model) scores `right_tool` and `answered_question`; only booleans reach PostHog as `ai_eval`. Demo org always, other orgs 1 in 4. *AC-PHO-093.*
- **FR-PHO-094** `/privacy` discloses the operational telemetry, the consent-gated user tag and demo-only prompt capture. *AC-PHO-094.*
- Thumbs feedback joins its trace (FR-PHO-005); the PostHog-native `survey sent` shape and the "what went wrong?" follow-up belong to S9.
- Cost and error alerts: runbook click-path (docs/posthog-dashboards.md § S1 AI), threshold after 7 days of data.

---

## 1. Problem and job story

**Problem.** PostHog already records ~24 named events, front-end and 25-edge-function exceptions, web
vitals, and demo-prospect replay. It does not notify anyone. A silent sweep, a failed money push or a
model that got worse is found by a client, not by us. Source maps are not uploaded, so front-end stack
traces are unreadable. Assistant tokens live in the database only, so model choice cannot be analysed
from production.

**Job story (operator).** *When something breaks in production or a demo, I want to be told which
thing, in which org, and how bad, so I fix it before the client notices and choose models and next
features on evidence.*

**Job story (owner, demo).** *When a prospect walks through a demo, I want to see how far down the
money path (project → budget → purchase → invoice) they got, so I know what resonated.*

## 2. Scope

**In (nine items, in build order):**

| Slice | Issue item(s) | What |
|---|---|---|
| S1 | 5, 6 | AI generation + tool-span + trace events from the edge, feedback link, AI dashboard |
| S2 | 1 | Error alerts (new issue, spike) + front-end source maps on deploy |
| S3 | 2 | Background-job run event + dashboard + missing/failing alert |
| S4 | 4 | ERP push outcome event per money flow + dashboard + alert |
| S5 | 8 | Four business events (usage per org) |
| S6 | 7 | Demo money-path funnel + heatmap/replay review recipe |
| S7 | 3 | Edge-function logs to PostHog Logs (conditional, OQ-5) |
| S8 | 9 | Feature flags (conditional, OQ-4) |

**Out of scope.** Prompt/response text (OQ-7). Surveys (OQ-6). Replay/autocapture for real users
(OD-OBS-1, unchanged). Group Analytics. A new operator UI over `error_events`. Any change to the
database record of truth (`error_events`, `agent_usage`, `external_command_outbox`) — PostHog is a view,
it replaces nothing. Dollar amounts or record contents in any property.

## 3. Domain terms (match `docs/glossary.md`)

- **Operator** — the vendor persona running PMO; the only audience of the PostHog project and its
  alerts. **Org** — tenant boundary. **Assistant** — the in-app agent (deputy). **Adapter** /
  **External tier** — per-system adapter behind the contract; events use PMO's domain words
  (`tier`, `domain`), never an ERP's vocabulary (Odoo-ready).
- **Operational event** — emitted by the server (edge function), about the system. **Product event** —
  emitted by the browser through the facade, about a user; consent-gated. This spec uses both and keeps
  them apart (§7).
- **Trace** — one Assistant run (`run_id`). **Generation** — one model call inside a run. **Span** — one
  tool call inside a run.
- **Job** — a scheduled or queue-driven worker: the five pg_cron-driven edge functions above (the
  webhook handlers are request-driven and covered by exception reporting, not `job_run`). **Run** — one
  invocation of a job.
- **Push outcome** — the terminal result of one outbox command to an external tier.
- **Triage surface** — PostHog. **Record** — Postgres (`error_events`, `agent_usage`, outbox). The
  record wins any disagreement (`observability-analytics.spec.md` §1.3).

## 4. Functional requirements (EARS)

### S1 — AI traces and dashboard (items 5, 6)

- **FR-PHO-001** — When an Assistant model call resolves (the point where `agent_usage` is recorded in
  `runToolLoop`, the compose-view handler, and the automation path through `agent-dispatch`), the system
  shall emit one `$ai_generation` event with: `$ai_trace_id` = the run id, `$ai_session_id` = the thread
  id, `$ai_model`, `$ai_provider`, `$ai_input_tokens`, `$ai_output_tokens`, `$ai_total_cost_usd`,
  `$ai_latency` (seconds), `$ai_is_error`, `$ai_http_status`, plus `org_id`, `action`
  (`chat|compose|automation`), `cached_tokens`, `reasoning_tokens`. Property names verified against
  PostHog's manual-capture reference on 2026-10-31; the builder re-checks before coding.
- **FR-PHO-002** — When a tool call finishes inside a run, the system shall emit one `$ai_span` with
  `$ai_trace_id`, `$ai_span_name` = tool name, `$ai_latency`, `$ai_is_error`, and `$ai_parent_id` = the
  generation that requested it. No tool arguments or results.
- **FR-PHO-003** — When a run reaches a terminal status, the system shall emit one `$ai_trace` with
  total latency, `$ai_is_error`, and `error_code` (the existing enum value, never message text).
- **FR-PHO-004** — The system shall never include `$ai_input`, `$ai_output_choices`, `$ai_input_state`,
  `$ai_output_state`, `$ai_tools`, a provider error message, a thread title or any user/model string.
  Enforcement is an **allowlist** of property keys in the emitter (unknown key → dropped; dropped in
  prod, thrown in test), not a denylist.
- **FR-PHO-005** — When a user rates a response, the system shall include `run_id` on
  `agent_feedback_rated` so the rating joins to its trace. **Amends FR-APH-011 and AC-APH-011** (which
  today assert "no `run_id`"): `run_id` is an opaque uuid already allowed on the other agent events.
  OBS-APH-003 holds: the DB feedback columns stay the record.
- **FR-PHO-006** — Where emission fails (network, missing key, PostHog down), the system shall swallow
  the failure and never delay or alter the model call, the stream, or the usage insert (fire-and-forget,
  bounded fetch, same posture as `capturePosthogException`).
- **FR-PHO-007** — The provisioning script shall create an **AI · Cost & Quality** dashboard: cost per
  org per day; error rate by tool (`$ai_span` by `$ai_span_name`); slowest tools (p95 `$ai_latency`);
  thumbs-down rate by model (feedback joined to generation on `run_id`/`$ai_trace_id`); tokens and cost
  by model.
- **FR-PHO-008** — The AI events shall be additive: `agent_usage`, `agent_runs`, `agent_events` and
  their RLS are unchanged; a run with PostHog disabled behaves byte-for-byte as today.

### S2 — Error alerts and source maps (item 1)

- **FR-PHO-010** — The system shall notify the operator channel (OQ-1) when PostHog error tracking
  opens a **new issue** or detects a **spike** on an existing one, for both front-end and edge
  exceptions. Owner/operator configuration in PostHog (alert rules + destination); the repo carries the
  runbook and a verification step, not the rule (PostHog has no config-as-code for it that is worth
  adopting here).
- **FR-PHO-011** — When the front end is built for deploy, the system shall upload that build's source
  maps to PostHog tagged with the release id (git SHA), and shall not serve the `.map` files publicly.
- **FR-PHO-012** — The front-end exception events shall carry the same release id so PostHog can
  symbolicate. The upload credential is a CI/build-time secret with upload scope only, never present in
  the browser bundle (NFR-PH-SEC-001 stands).
- **FR-PHO-013** — If a source-map upload fails, the build shall fail loudly (a deploy with unreadable
  stacks is the defect this fixes), except on forks/PRs without the secret, where it skips visibly.
- **FR-PHO-014** — Exception rate limits and suppression rules (FR-PHG-032, owner action) remain the
  volume guard; this slice adds the alert on top and confirms they exist.
- **FR-PHO-015** — The runbook shall include a **fire-drill**: a deliberately thrown test error in a
  non-production environment must produce a readable stack and a received alert. An alert never proven
  to fire is a silent false signal.

### S3 — Job health (item 2)

- **FR-PHO-020** — When a job run ends (success or failure), the system shall emit one `job_run` event:
  `job`, `status` (`ok|failed`), `items_processed`, `duration_ms`, `error_code` (when failed),
  `org_count` (when the job loops orgs). One event per run, not start+finish, to stay inside the
  allowance (NFR-PHO-QUOTA-001).
- **FR-PHO-021** — The system shall provide one shared helper in `supabase/functions/_shared/` that
  wraps a job's run body, measures it, emits `job_run`, and rethrows; all five jobs use it. A CI check
  (extending `scripts/check-edge-fn-error-reporting.mjs` or a sibling) shall fail when a function named
  as a job lacks the wrapper.
- **FR-PHO-022** — A job that "succeeds" while skipping all work (misconfigured, no orgs bound) shall
  report `status: failed` with a stable `error_code`, not `ok` with `items_processed: 0` — otherwise a
  broken job looks healthy.
- **FR-PHO-023** — The system shall alert the operator (OQ-1, OQ-8) when a job has no run in its
  window or a `failed` run. The absence alert is the point: it fires even when the tick never reaches
  the function.
- **FR-PHO-024** — The money outbox sweep is part of `erpnext-sweep`; its `job_run` carries the counts
  of recovered, held and quarantined commands in `items_processed` breakdown properties (integers only).
- **FR-PHO-025** — A **Jobs** dashboard shall show last run, runs per hour, failure rate and
  items processed per job.

### S4 — ERP push outcomes (item 4)

- **FR-PHO-030** — When an outbox command reaches a terminal or parked state (`confirmed`, `failed`,
  `quarantined`, `held`), the system shall emit one `erp_push_outcome`: `tier`, `domain`, `operation`,
  `outcome`, `error_code` (stable code, never ERP message text), `attempt_count`, `duration_ms`
  (claim to outcome), `org_id`, and the opaque `outbox_id`.
- **FR-PHO-031** — Emission shall be tied to the **state-transition result** (only when the RPC
  actually changed the row), so a sweep re-finalising an already-confirmed command does not double-count.
- **FR-PHO-032** — The money flows are the domains `budget`, `revenue` (invoice, payment), `procurement`
  (purchase) and `expenses`. A failed outcome in any of them shall raise an alert (OQ-1); a `held`
  command (Payment Entry, ADR-0058 C-1) shall raise it regardless of attempt count because it needs a
  human.
- **FR-PHO-033** — The event shall contain no amounts, document names, party names, ERP ids or response
  bodies. The ERP remains authority for the ledger; the outbox row remains the record of the command.
- **FR-PHO-034** — A **Money pushes** dashboard shall show outcomes per domain per day, failure rate,
  top `error_code`, and count currently `held`/`quarantined`.

### S5 — Business events (item 8)

- **FR-PHO-040** — When the server confirms that a budget is activated, an invoice is issued, a payment
  is recorded or a purchase is approved, the browser shall emit `budget_activated`, `invoice_issued`,
  `payment_recorded` or `purchase_approved` through the facade with `module`, `role`. Never on a
  failed or rolled-back mutation; the call sits in the success path only.
- **FR-PHO-041** — The four events shall be added to `AnalyticsEventName`, `EVENT_PRODUCERS`, a typed
  `track*` builder each, and the dashboard script, satisfying the tile/call-site CI gate
  (`scripts/check-dashboard-tiles.mjs`).
- **FR-PHO-042** — No amount, name, number or id is a property (`contract_value` and the other forbidden
  keys stay forbidden). Counts per org come from `org_id`.
- **FR-PHO-043** — The events respect the in-app analytics opt-out and `respect_dnt` unchanged.
- **FR-PHO-044** — A **Usage per org** dashboard shall show the four events per org per week.
- **FR-PHO-045** — Because the browser event is best-effort (ad blockers, opt-out), the dashboard shall
  be labelled "observed use", and nothing that matters commercially (billing, audit) reads from it; the
  database is the record.

### S6 — Demo funnels and heatmaps (item 7)

- **FR-PHO-050** — The system shall provision a **Demo · Money path** funnel: `project_detail_opened` →
  `budget_activated` → `purchase_approved` → `invoice_issued`, filtered to
  `demo_audience = prospect`, broken down by `demo_account`. (The existing `Demo · Prospect Funnel`,
  persona → login → module, is shipped and unchanged.)
- **FR-PHO-051** — Where a demo step needs a mutation the demo persona cannot perform by role, the
  funnel shall show the furthest reachable step and the dashboard note shall say so, rather than
  invent an event.
- **FR-PHO-052** — Heatmaps (`capture_heatmaps`, shipped for all users) and replay (prospect demo
  only, shipped) need no code. The slice adds a runbook recipe listing the demo screens to review and
  how to open the toolbar heatmap, and a check that the heatmap and replay quotas are inside
  NFR-PHO-QUOTA-001.

### S7 — Logs (item 3, conditional on OQ-5)

- **FR-PHO-060** — Where OQ-5 keeps the slice, `logStructuredError` shall also forward its line (fn,
  code, context id, org id) to PostHog Logs through the same bounded, fire-and-forget path as
  `capturePosthogException`. No raw `console` output, no request bodies.
- **FR-PHO-061** — Where the live allowance is exceeded or unknown, the system shall not forward
  (fail closed to the existing console + `error_events` path).

### S8 — Feature flags (item 9, conditional on OQ-4)

- **FR-PHO-070** — Where OQ-4 is approved, a new off-by-default feature may be gated by a PostHog flag
  read through the analytics facade, targeted per org, evaluated client-side only for UI gating.
- **FR-PHO-071** — When the flag cannot be evaluated (SDK blocked, quota exhausted, opted out), the
  system shall use the local default (off). Existing switches in `features.ts` and `org_features` are
  untouched and remain the authority; server-enforced access never depends on a PostHog flag.

## 5. Non-functional requirements

- **NFR-PHO-PRIV-001** — No prompt, response, tool argument/result, error message text, name, email,
  amount, document number or free-text value in any property of any new event. Server emitters use a key
  **allowlist**; the browser facade keeps `buildEventProperties` (24-key denylist).
- **NFR-PHO-PRIV-002** — Consent rules unchanged (ADR-0067, OD-OBS-1/2): browser events stay
  consent-gated and honour opt-out; no replay/autocapture for real users. Server operational events
  carry no user id (OQ-2; sole exception: the AI events with the user's analytics-consent flag, FR-PHO-092) and use a synthetic distinct id per function (existing `edge:<fn>` pattern),
  with `$process_person_profile: false`. `/privacy` copy is updated in S1 to state that operational
  system telemetry (errors, job runs, push outcomes, AI usage counts) is collected server-side without
  personal content.
- **NFR-PHO-SEC-001** — Browser bundle holds only the public ingestion key. Source-map upload and
  provisioning use separate write-scoped credentials held in CI/operator secrets, never in the bundle,
  never in the repo; no new credential name or location is written into this public repo.
- **NFR-PHO-SEC-002** — PostHog has no row-level security: anyone with project access sees every org's
  telemetry. Project membership is operator-only; no client user is invited. Event content is therefore
  limited to what an operator may see across orgs (counts, codes, durations).
- **NFR-PHO-REL-001** — Every emitter is fire-and-forget, bounded by a deadline, swallows its own
  failure, and is never awaited on a request/response critical path longer than the existing bounded
  fetch. An emission failure never changes an HTTP status, a stream, a usage insert or an outbox state.
- **NFR-PHO-QUOTA-001** — Stay inside the free allowances. Sizing (events/month, ~30 days): `job_run`
  ≈ 43k (erpnext-sweep) + 43k (clickup-webhook-worker) + 9k (clickup-sweep) + 1.5k (two hourly jobs) ≈
  **97k**; AI events ≈ (generations + spans + trace) per run, bounded by the existing 8-round cap, a few
  thousand runs → low tens of thousands; push outcomes and business events ≈ thousands. Total
  well under 20% of the 1M event allowance; the 80% alarm remains. If volume overshoots, the first lever is
  idle-run thinning on the two minute jobs (emit `ok` + zero items once per N runs), not dropping failures.
- **NFR-PHO-QUOTA-002** — `scripts/posthog/quota.mjs` must evaluate every resource the new events and
  products consume (events, exceptions, logs if S7, flags requests if S8). The resource names and
  response shape are captured from the **live** quota response (that script's own history: a fixture
  invented from the docs passed against a shape the API never returns), and the fail-closed rule stands:
  a resource it cannot recognise exits non-zero.
- **NFR-PHO-GATE-001** — Every provisioned tile has a producer. Extend the tile/call-site gate to
  **server-emitted** events (a registry beside `EVENT_PRODUCERS` for `job_run`, `erp_push_outcome`, the
  `$ai_*` set), so a tile whose event has no emitter fails CI (FR-PHG-013 extended).
- **NFR-PHO-TEST-001** — Edge-function tests import the shipped handler and mock `globalThis.fetch`
  (`check-edge-fn-test-binding.mjs`); no copied logic, no dependency injection added to production code.
- **NFR-PHO-MIG-001** — No database migration is required by any slice. If a builder finds one is
  needed, stop and ask (migration numbers are contended; the last shipped is 0409).

## 6. Acceptance criteria

Layer per ADR-0010: **D** = Deno unit (edge function, real handler + mocked fetch), **V** = Vitest
unit, **G** = CI gate/script test, **O** = owner/operator verification in PostHog (runbook step with
recorded evidence; not automatable against a third-party SaaS), **E** = Playwright (curated).

**S1**
- **AC-PHO-001 [D]** Given an Assistant run with two model rounds and one tool call, when it completes,
  then PostHog receives 2 `$ai_generation`, 1 `$ai_span`, 1 `$ai_trace`, all with the same
  `$ai_trace_id` = run id, tokens and cost equal to the `agent_usage` rows. *(FR-PHO-001..003)*
- **AC-PHO-002 [D]** Given a model call whose provider returns an error message containing user text,
  when it is reported, then the payload has `error_code` only, and no key outside the allowlist; a test
  that adds `$ai_input` to the emitter input sees it dropped (and thrown in test mode). Mutation check:
  loosening the allowlist turns the test red. *(FR-PHO-004, NFR-PHO-PRIV-001)*
- **AC-PHO-003 [D]** Given PostHog unreachable (fetch rejects/hangs past the deadline), when a run
  completes, then the stream, `agent_usage` insert and final status are identical to the control run.
  *(FR-PHO-006, NFR-PHO-REL-001)*
- **AC-PHO-004 [D]** Given the compose-view and automation paths, when each makes a model call, then
  each emits a generation with `action` = `compose` / `automation`. *(FR-PHO-001)*
- **AC-PHO-005 [V]** Given a thumbs-down on a response, when the facade builds the event, then it has
  `rating`, `downvote_reason`, `run_id` and the key set equals the amended FR-APH-011 set.
  *(FR-PHO-005; AC-APH-011/012/016 updated in the same change)*
- **AC-PHO-006 [G]** Given the dashboard script, when the gate runs, then every AI tile resolves to a
  registered server producer; deleting an emitter turns the gate red. *(FR-PHO-007, NFR-PHO-GATE-001)*
- **AC-PHO-007 [O]** Given a live run in a non-production environment, when the operator opens the AI
  dashboard, then the run appears with correct model, tokens, cost, latency and no text. Evidence: a
  screenshot path recorded in the runbook. *(FR-PHO-007)*

**S2**
- **AC-PHO-010 [O]** Given the fire-drill error in staging, when it is thrown, then an alert arrives on
  the chosen channel and the stack shows original file names and lines. *(FR-PHO-010, 011, 015)*
- **AC-PHO-011 [G]** Given a production build, when the source-map step runs, then maps are uploaded
  for the release id and absent from the deployed output; with the upload credential missing on a
  deploy build the build fails, on a fork build it skips with a visible message. *(FR-PHO-011..013)*
- **AC-PHO-012 [V]** Given the front-end exception event, then it carries the release id and the
  existing redaction (`redactExceptionText`) still applies. *(FR-PHO-012)*

**S3**
- **AC-PHO-020 [D]** Given each of the five job handlers, when a run succeeds, then exactly one
  `job_run` with `status: ok`, the item count and a duration is emitted; when the body throws, one
  `status: failed` with the code is emitted and the error still reaches `reportEdgeError`.
  *(FR-PHO-020, 021)*
- **AC-PHO-021 [D]** Given `erpnext-sweep` with no bound orgs or missing configuration, when it runs,
  then `status: failed` with a stable code, not `ok`. *(FR-PHO-022)*
- **AC-PHO-022 [G]** Given a new function registered as a job without the wrapper, when the check runs,
  then it fails. *(FR-PHO-021)*
- **AC-PHO-023 [O]** Given the cron tick disabled for one job in staging, when its window passes, then
  the absence alert arrives. Positive control for the alert itself. *(FR-PHO-023)*

**S4**
- **AC-PHO-030 [D]** Given an outbox command that ends `confirmed`, `failed`, `quarantined` and `held`
  respectively, when each transition completes, then one `erp_push_outcome` per transition with the
  matching `outcome`, stable `error_code`, and no amount/name/ERP id. *(FR-PHO-030, 033)*
- **AC-PHO-031 [D]** Given the sweep re-finalising an already-confirmed command, when it runs, then no
  second event. *(FR-PHO-031)*
- **AC-PHO-032 [D]** Given a Payment Entry parked `held`, when the transition occurs, then the event is
  marked for the always-alert rule. *(FR-PHO-032)*
- **AC-PHO-033 [D]** Given an emitter fault, when a command is claimed/committed, then outbox state and
  the SoD/idempotency guarantees are unchanged (the money tests that exist stay green untouched).
  *(NFR-PHO-REL-001; money-path primer invariants)*

**S5**
- **AC-PHO-040 [V]** Given a successful budget activation / invoice issue / payment record / purchase
  approval in the UI, when the mutation resolves, then the matching event is captured once with only
  `module` and `role`. *(FR-PHO-040, 042)*
- **AC-PHO-041 [V]** Given the same mutations failing, when the error is classified, then the business
  event is not captured. *(FR-PHO-040)*
- **AC-PHO-042 [V]** Given an opted-out user (real SDK, same pattern as `client.optInOut.realSdk.test.ts`),
  when the mutation succeeds, then no request is made to PostHog; the control without opt-out does make
  one. *(FR-PHO-043; absence ACs need a positive control)*
- **AC-PHO-043 [G]** The tile/call-site gate passes with the four events registered and fails when one
  producer call is removed. *(FR-PHO-041)*

**S6**
- **AC-PHO-050 [G]** The provisioning script is idempotent (second run `+0 / =all`) and creates the
  money-path funnel with its prospect filter. *(FR-PHO-050)*
- **AC-PHO-051 [O]** Given one scripted demo pass through project → budget → purchase → invoice as the
  demo personas, when the funnel is opened, then it shows the steps reached. *(FR-PHO-050, 051)*

**S7 (conditional)**
- **AC-PHO-060 [D]** Given a structured error line, when forwarded, then it contains fn, code, context
  id, org id only; with the key unset or allowance flagged exhausted nothing is sent. *(FR-PHO-060, 061)*

**S8 (conditional)**
- **AC-PHO-070 [V]** Given the SDK blocked or quota-exhausted, when a flagged feature renders, then it
  is off and existing env/`org_features` gates behave as before. *(FR-PHO-071)*
- **AC-PHO-071 [V]** Given a flag on for org A and off for org B, then only A sees the feature (per-org
  targeting through the facade). *(FR-PHO-070)*

**Cross-cutting**
- **AC-PHO-080 [G]** `quota.mjs` fed a captured live-shape payload containing the new resources at 85%
  exits non-zero naming the resource; fed a payload with an unrecognised resource it exits 2.
  *(NFR-PHO-QUOTA-002)*
- **AC-PHO-081 [E]** No new e2e journey. The existing opt-out journey (AC-CON-003) stays green and is
  the only browser-level proof that no PostHog request leaves an opted-out session.
  *(ADR-0010: nothing here is a cross-stack user journey.)*

## 7. Data ownership (ADR-0055) and consent split

| Data | Authority | PostHog's role |
|---|---|---|
| Errors | `error_events` (Postgres, tenant-joinable, 90-day retention) | Triage: grouping, stacks, alerts |
| AI usage and cost | `agent_usage`, `agent_runs`, `agent_events` | Analysis view; carries counts, never content |
| Job runs | pg_cron + the job's own tables; no new record | The only run history that outlives platform log retention; absence detection |
| Push outcomes | `external_command_outbox` (command), the external system (ledger) | Outcome stream only. PMO never recomputes or mirrors ledger numbers into PostHog |
| Business events | The domain tables | Observed use only, best effort |
| Flags (if S8) | `org_features` + `features.ts` | Rollout hint for new features only |

Adapter-neutral: `tier` and `domain` are PMO vocabulary, so an Odoo adapter (ADR-0094 route) emits the
same events with no schema change. When PMO is standalone (no external tier) there are no push
outcomes; the dashboard is empty by design and says so.

**Consent split.** Product events (browser) obey opt-out and DNT. Operational events (server) describe
the system, carry no personal content or user id, and are disclosed on `/privacy`. Both are subject to
the allowlist/denylist guards above.

## 8. Authorization and SoD

- No new write path, table, RLS policy, RPC or permission. Nothing here is an authorization input;
  `org_id` on events is context only (NFR-PH-SEC-002). RLS stays the tenant boundary.
- Emitters are observational: they run **after** the guarded action's outcome is known and never gate
  it. Server emission reuses the existing service-role context of the function it sits in; no new
  service-role surface, no new client construction.
- The deputy invariant (ADR-0036) is untouched: the Assistant's model call still runs under the caller's
  authority; the trace is a copy of metadata.
- Money-path SoD (author ≠ approver, draft-then-submit) and the outbox invariants (one record mints one
  ERP document; held is never reissued) are neither read nor changed. S4 touches the `adapter-dispatch`
  and `erpnext-sweep` money path: **Director-dispatched, shipped alone, with the security reviewer**, and
  the existing money tests must pass unmodified (AC-PHO-033).
- PostHog access: operator only (NFR-PHO-SEC-002). Alert channel contents are codes and counts.
- Provider cost is Operator-only in the app (AC-USE-007); the AI dashboard is an operator surface in
  the same posture.

## 9. Slice split (one builder each)

| Slice | Size | Touches | Notes |
|---|---|---|---|
| S1 AI traces + dashboard | L | New `_shared` server emitter (generalising `posthogError.ts`), `agent-chat/handler.ts` + `compose-view/handler.ts` call sites, feedback event, dashboard script, `/privacy` copy, server-event gate | Builds the shared emitter every later slice reuses; ship first |
| S2 Alerts + source maps | M | Build/deploy step, release id on FE exceptions, runbook + fire-drill, owner PostHog config | Needs owner action for rules (OQ-1) |
| S3 Job health | M | Shared job wrapper, five job entrypoints, CI check, dashboard, alert runbook | Minute-cadence jobs: keep wrapper overhead to one fetch |
| S4 ERP push outcomes | M | `adapter-dispatch`, `erpnext-sweep` transition points, dashboard | Money path: alone, Director-dispatched, security review |
| S5 Business events | S | Facade (4 events), success paths of the budget/invoice/payment/purchase mutations, dashboard | Builder locates the invoice/payment hooks; `useBudget.ts` and `useProcurementCrud.ts` are the known homes |
| S6 Demo funnels | S | Dashboard script, runbook recipe | Needs S5 events |
| S7 Logs | S | `logStructuredError` forward | Conditional (OQ-5) |
| S8 Flags | M | Facade flag reader | Conditional (OQ-4), likely dropped |

Rules for all slices: new events go through the typed catalog and the tile/call-site gate; every
dashboard tile has a producer; each slice updates `docs/analytics-events.md` and
`docs/posthog-dashboards.md`; docs-only runbook changes push direct to `dev`. S1 should file one ADR for
"server-side operational telemetry vs consent-gated product analytics" (number assigned by the planner);
no other slice needs an ADR.

## 10. Error handling

| Condition | Behaviour | User-facing |
|---|---|---|
| PostHog key absent / host down | Emitter no-ops or times out; request continues | None |
| Emitter throws | Caught at the call site (`safeTrack` in browser, try/catch tight around the emit in edge) | None |
| Source-map upload fails on a deploy build | Build fails | None (operator sees CI) |
| Unknown property key on a server event | Dropped in prod, throws in tests | None |
| Quota near/over limit | Existing alarm; `quota.mjs` fails closed on unknown shape | None |
| Alert rule missing | Caught by the fire-drill/runbook check, not by code | None |

## 11. Traceability

| AC | Layer | Intended owning test |
|---|---|---|
| AC-PHO-001..004 | Deno | `supabase/functions/_shared/posthogAi.test.ts`, `agent-chat/*.test.ts` |
| AC-PHO-005 | Vitest | `pmo-portal/src/lib/analytics/events.agent.test.ts` (amended) |
| AC-PHO-006, 022, 043, 080 | CI gate / script test | `scripts/*` self-tests |
| AC-PHO-007, 010, 023, 051 | Operator runbook | `docs/runbooks/posthog-operations.md` evidence table |
| AC-PHO-011 | CI gate | build-step script test |
| AC-PHO-012, 040..042, 070, 071 | Vitest | `pmo-portal/src/lib/analytics/*.test.ts` |
| AC-PHO-020, 021, 030..033, 060 | Deno | per-function `*.test.ts` |
| AC-PHO-050 | CI gate | provisioning idempotency test |
| AC-PHO-081 | Playwright | existing AC-CON-003 spec, unchanged |

Each AC has exactly one owning layer; none is pushed up a layer for convention.

## 12. Risks and sequencing notes

- The edge tick for the two minute-cadence jobs is the highest-volume emitter; measure after S3 and use
  the quota alarm, not guesswork.
- Server events cannot join to a browser person (by design, OQ-2), except the AI events carrying the consent-gated `user_id` / `$session_id` (FR-PHO-092). Dashboards join on `run_id` and
  `org_id` only.
- PostHog's alert and Logs capabilities were checked against public docs on 2026-10-31; items marked
  "confirm at build" must be re-verified by the builder against the live project, and the answer
  recorded in the runbook.
