# PostHog operations runbook

Operating the service through PostHog: AI traces, error alerts, job health, ERP push outcomes, observed use, demo funnels (issue #1532, [spec](../specs/posthog-operations.spec.md), [plan](../plans/2026-10-31-posthog-operations.md), [ADR-0096](../adr/0096-server-operational-telemetry-vs-consent-gated-analytics.md)).

This repo is public. Evidence lives in `docs/private/` or the Director's memory; write the location here, never a screenshot of customer-identifying data, a key, a hostname or an organisation id.

## Evidence table

| AC | What was run | Date | Evidence location |
|---|---|---|---|
| AC-PHO-007 | | | |
| AC-PHO-010 | | | |
| AC-PHO-023 | | | |
| AC-PHO-051 | | | |

## S1 AI

_Owned by slice S1._

### Verified against live docs (2026-10-31)

Source: PostHog "manual capture" reference for LLM analytics.

| Event | Property | Type |
|---|---|---|
| `$ai_generation` | `$ai_trace_id` (required), `$ai_session_id`, `$ai_span_id`, `$ai_parent_id`, `$ai_model`, `$ai_provider` | string |
| `$ai_generation` | `$ai_input_tokens`, `$ai_output_tokens`, `$ai_http_status` | number |
| `$ai_generation` | `$ai_latency` (seconds), `$ai_total_cost_usd` (USD) | number |
| `$ai_generation` | `$ai_is_error` | boolean |
| `$ai_generation` | `$ai_input`, `$ai_output_choices` | array of `{role, content}` (demo org only here) |
| `$ai_span` | `$ai_trace_id`, `$ai_span_id`, `$ai_parent_id`, `$ai_span_name` | string |
| `$ai_span` | `$ai_latency`, `$ai_is_error`; `$ai_input_state` / `$ai_output_state` (demo org only here) | number, boolean, JSON |
| `$ai_trace` | `$ai_trace_id`, `$ai_session_id`, `$ai_latency`, `$ai_is_error`; `$ai_input_state` / `$ai_output_state` | as above |

Not documented by PostHog, so defined by us: the eval-result event (`ai_eval`, our own name; the docs name no external-capture event for evaluation results) and the extra keys `action`, `cached_tokens`, `reasoning_tokens`, `error_code`, `org_id`, `user_id`. Thumbs feedback in PostHog's own shape is a `survey sent` event carrying `$ai_trace_id`; that belongs to the surveys slice (S9). Until then `agent_feedback_rated` carries `run_id` and `$ai_trace_id`.

### AC-PHO-007: operator check of one live run

1. In a non-production session send one Assistant message that makes it call a tool.
2. Open [PMO] AI · Cost & Quality (and LLM analytics > Traces). Expect one trace with 1 or more generations and the tool span; model, tokens, cost, latency present; **no prompt or reply text** for a non-demo org.
3. Record date, org kind and result in the Evidence table above. Put any screenshot under `docs/private/`, never in the repo.

### AC-PHO-090 and 092: demo-org text and consent checks

1. Demo session, analytics on: the generation shows prompt and reply; the session replay link works; `user_id` set.
2. Same demo session after opting out on `/privacy`: new Assistant turns carry no text, no `user_id`, no `$session_id`.
3. A non-demo org with analytics on: `user_id` and `$session_id` set, still no text.

### Alerts

Cost per day and errored runs per day: see `docs/posthog-dashboards.md` S1 click-path 1. Thresholds are set after 7 days of data. Before relying on either alert, fire it once (lower the threshold temporarily) and confirm the destination receives it (an alert never proven to fire is a silent false signal).

### Online-eval notes

The judge runs inside `agent-chat` after the run completes, using the deployed (non-Claude) model, and costs one small model call per judged run (demo org: every run; other orgs: 1 in 4). It is not metered into `agent_usage` or credits. If the cost tile shows it matters, change `REAL_ORG_SAMPLE_MOD` in `agent-chat/aiJudge.ts`.

## S2 Alerts and source maps

_Owned by slice S2._

## S3 Jobs

What exists: every scheduled job emits one `job_run` per run (see `docs/analytics-events.md` S3); the `[PMO] Jobs` dashboard shows them; a CI check fails a registered job that lacks the wrapper (`scripts/check-edge-fn-error-reporting.mjs`, `JOB_FUNCTIONS`).

**Cadences** (from the cron migrations at build time; confirm against the live schedule before setting alert windows): `erpnext-sweep` every minute, `clickup-webhook-worker` every minute, `clickup-sweep` every 5 minutes, `agent-dispatch` hourly, `telegram-notify` hourly.

**Alerts** (click-path in `docs/posthog-dashboards.md` S3): a missing-run trend alert per job on `job_run` count by `job` "less than 1" over 3x its cadence (minute jobs 5 min, `clickup-sweep` 20 min, hourly jobs 3 h), plus one `status = failed` alert. The absence alert is the point: it fires when the tick never reaches the function.

**Statuses.** `failed` carries a stable `error_code`; a job that returns 200 but skipped its work (missing Telegram secrets) is `failed`. A job with nothing to do by design (zero ERP-bound orgs, i.e. standalone, ADR-0094) is `skipped`, never `failed`. Do not create the `erpnext-sweep` absence alert on an environment without an ERP binding.

**Positive control (AC-PHO-023, owner or Director, non-production):** an alert never proven to fire is a silent false signal. Disable one job's cron (a database write, run by the owner or Director, not a builder), wait past that job's window, confirm the alert arrives, re-enable the cron. Record the date and the evidence location in the Evidence table row AC-PHO-023.

**Quota check:** after one day of live emission, read the `job_run` count in PostHog and compare it with the sizing in the spec (~97k/month with `erpnext-sweep` and `clickup-webhook-worker` every minute). If it is on course to exceed that, apply the first lever (emit `ok` with zero items once per N runs on the two minute jobs, never thin failures) as a follow-up issue.

**Overhead.** Each run adds one bounded `fetch` (awaited up to 3 s) and one `res.clone().json()` of the already-small response body; PostHog down changes neither the response nor the rethrow (Deno test `jobRun.test.ts`).

## S4 Push outcomes

_Owned by slice S4._

## S5 Business events

_Owned by slice S5._

## S6 Demo funnels

_Owned by slice S6._

## S7 Logs (conditional)

_Owned by slice S7 (only if the Logs allowance check keeps it)._

## Q Quota fixture capture (slice Q, needs the operator's key)

Why: the quota check fails closed on shape, and its fixture must come from the live API, not from docs (the
earlier invented fixture passed against a shape the API never returned). Slice Q's remaining tasks
(unrecognised-resource guard, 85% cases for `events`, `exceptions`, `recordings`) start only from this capture.

1. Run the check exactly as in `docs/analytics-events.md` § Quota safety (same key fetch, same project id), adding `--dump`:
   `node scripts/posthog/check-quota.mjs --dump > /tmp/quota.live.json`
2. The output holds only `{ resource: { limited, usage, limit } }` (booleans and numbers). Read it once: no key, host or id belongs in it.
3. Save it as `pmo-portal/src/lib/analytics/quota.live.fixture.json` and tell the builder. Then: tests first in `quota.test.ts`
   (fixture exits 0; `events`, `exceptions`, `recordings` at 85% exit 1 naming the resource; an extra unknown resource exits 2 naming it),
   then `KNOWN_RESOURCES` in `quota.mjs` as a literal list with a "captured from a live response <date>" comment.
4. Residual risk, stated: a resource PostHog adds later turns the daily workflow red (exit 2, "could not run") until its name is added. That is the chosen fail-closed behaviour.
