# PostHog product-analytics dashboards (as code)

The app's product analytics are provisioned **as code** by
[`scripts/posthog/provision-dashboards.mjs`](../scripts/posthog/provision-dashboards.mjs) — a single,
idempotent script that creates the dashboards + insights from the app's typed event catalog
([`pmo-portal/src/lib/analytics/events.ts`](../pmo-portal/src/lib/analytics/events.ts)). Closes the
IG-audit P2 "PostHog dashboards deferred" gap (2026-07-10).

## What it builds — 3 dashboards / 19 insights

| Dashboard | Tiles |
|---|---|
| **Agent · Adoption & Reliability** | panel opens · runs started/completed/errored · errors by `error_code` · approval funnel (shown→decided) · approval decisions · avg `duration_ms` · avg `tool_round_count` · feedback by `rating` · threads resumed |
| **Auth · Login Health** | logins success vs failed · failures by `reason_code` · logouts |
| **Product · Usage & Friction** | top routes (`route`) · detail opens (project/procurement) · search & filter · empty states by `module` · save failures by `reason_code` · permission-denied by `surface` · form-validation failures by `module` |

Every event/property referenced is one the app actually fires (the script is grounded in the typed
catalog — no invented events). Objects are prefixed `[PMO]` so they're greppable and upsert-keyed.

## Run it

The script never hard-codes secrets — it reads a **PostHog personal API key** (needs
`dashboard:write` + `insight:write` scope) and the project id from env. Fetch the key from 1Password
so it never touches disk:

```sh
export POSTHOG_API_KEY=$(op-get.sh posthog-personal-api AS credential)
export POSTHOG_PROJECT_ID=465502              # the target project/team id
export POSTHOG_HOST=https://us.i.posthog.com  # default; override for EU
node scripts/posthog/provision-dashboards.mjs
unset POSTHOG_API_KEY
```

**Idempotent** — dashboards + insights are upserted **by name**, so re-running never duplicates
(a second run reports `+0 / =all`). To force a rebuild of one tile, delete that insight in the
PostHog UI and re-run.

> The `posthog-personal-api` item in 1Password vault `AS` is the write-scoped management key
> (`phx_…`). `pmo-posthog-token` is the app's `phc_…` *ingestion* key (client-side, write-only) and
> **cannot** drive this API.

## Ceiling (ponytail)

Upsert-by-name skips existing insights — it does **not** re-push an edited query onto an insight that
already exists. That's the right trade for provisioning; edit-in-place would fight manual UI tweaks.
Add a `--force` re-push flag only if the spec starts changing often.

---

# Operations dashboards, alerts and click-paths (#1532)

Dashboard fragments live in `scripts/posthog/spec/{ai,jobs,pushes,usage,demo}.mjs`, one owner each. Settings that need the owner's PostHog login (alert destinations, survey publishing) are written here as click-paths, not done from code. Each slice edits only its own section below.

## S1 AI

_Owned by slice S1 (#1532)._ Dashboard **[PMO] AI · Cost & Quality** (`scripts/posthog/spec/ai.mjs`, provisioned by `provision-dashboards.mjs`).

| Tile | Source |
|---|---|
| AI cost per org per day / per day (alert source) | `$ai_generation` sum `$ai_total_cost_usd`, breakdown `org_id` |
| AI cost per user per day (consenting users only) | same, breakdown `user_id` (set only when the user's analytics is on) |
| AI tokens by model, cost by model, generations by model | `$ai_generation`, breakdown `$ai_model` |
| AI tool calls / tool errors by tool | `$ai_span` by `$ai_span_name`; errors filter `$ai_is_error = true` |
| AI slowest tools (p95 seconds) | `$ai_span` p95 of `$ai_latency` |
| AI runs per day, run errors per day (alert source), errors by code | `$ai_trace` |
| AI feedback by rating | `agent_feedback_rated` by `rating` |
| AI online-eval verdicts / failures by name | `ai_eval` by `eval_name`; failures filter `eval_pass = false` |

**Known limitation (thumbs-down rate by model).** A cross-event join of `agent_feedback_rated.run_id` to `$ai_trace_id` is not expressible in a `TrendsQuery`, so ratings and generations-by-model sit side by side. For an ad-hoc join use a SQL insight: `SELECT g.properties.$ai_model, countIf(f.properties.rating = 'down') FROM events g JOIN events f ON f.properties.run_id = g.properties.$ai_trace_id WHERE g.event = '$ai_generation' AND f.event = 'agent_feedback_rated' GROUP BY 1`.

**Owner click-paths (need the owner's PostHog login; not done from code):**

1. **Cost and error alerts.** Open insight "AI cost per day (alert source)" > Alerts > New alert: condition "value above", threshold set after 7 days of data (do not guess a number now), check daily. Repeat on "AI run errors per day (alert source)" (condition above, small threshold, check hourly). Destination per the S2 alert-channel setup.
2. **PostHog-native judge for the demo org (optional, only where text exists).** LLM analytics > Evaluations > New: type LLM judge, filter `org_id` equals the demo org's id (or event property `$ai_input` is set), run on every generation. Judge provider key: a non-Claude model (owner rule: no Claude via OpenRouter). Real-org traces carry no text, so this evaluator would have nothing to score there: their verdicts come from the in-function `ai_eval` events.
3. **Replay link.** On a demo-org generation open LLM analytics > the generation; the session link opens the replay when `$session_id` is set (consenting demo sessions).

## S2 Alerts and source maps

_Owned by slice S2 (#1532)._

## S3 Jobs

Dashboard `[PMO] Jobs` (tiles in `scripts/posthog/spec/jobs.mjs`, source `job_run`): runs by job, runs per hour, failure rate (all runs vs failed), failed runs by job and by error code, items processed, duration p95. Run `node scripts/posthog/provision-dashboards.mjs` to create it (idempotent).

### Alert click-path (owner account; not done by the build)

Alerts and destinations need the owner's PostHog account.

1. Open the `[PMO] Jobs` dashboard, then the tile `Jobs — runs per hour`. Insight menu, **Alerts**, **New alert**.
2. **Missing run** (one per job): series `job_run`, add a filter `job = <job>`, interval hour (minute jobs: use the tile's finest interval). Condition: value **is less than 1**, check **every hour**. Window per job (3x its cadence): `erpnext-sweep` 5 min, `clickup-webhook-worker` 5 min, `clickup-sweep` 20 min, `agent-dispatch` 3 h, `telegram-notify` 3 h. Use the finest check interval the alert offers; if it cannot go below an hour, the minute jobs' absence is caught within that hour, which is acceptable.
3. **Failed run**: tile `Jobs — failed runs by job`. Condition: value **is greater than 0**, check hourly.
4. Destination: the operator channel configured for error alerts (same as S2). Subscribers only; no customer addresses.
5. Do not create the `erpnext-sweep` missing-run alert on an environment without an ERP-bound org: that job reports `skipped` there, and an alert on absence of `ok` would never be satisfied.

## S4 Push outcomes

_Owned by slice S4 (#1532)._

## S5 Business events

`[PMO] Usage per org (observed use)` (`scripts/posthog/spec/usage.mjs`): one table tile, the four business
events (budgets activated, invoices issued, payments recorded, purchases approved) per week, broken down by
`org_id`. The dashboard description reads: "Observed use — browser events, best effort (ad blockers, opt-out).
Not a record; nothing commercial reads from it." No PostHog-side setting is needed; `node scripts/check-dashboard-tiles.mjs`
fails if any of the four events loses its call site.

## S6 Demo funnels

_Owned by slice S6 (#1532)._

## S7 Logs (conditional)

_Owned by slice S7 (#1532)._
