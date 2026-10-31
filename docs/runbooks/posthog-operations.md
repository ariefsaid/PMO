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

The judge runs inside `agent-chat` after the run completes, using the deployed (non-Claude) model, and costs one small model call per judged run (demo org: every run; other orgs: 1 in 4). It is not metered into `agent_usage` or credits; its spend is reported to PostHog as a `$ai_generation` with `action = eval` (tile "AI judge (eval) cost per day"). If that tile shows it matters, change `REAL_ORG_SAMPLE_MOD` in `agent-chat/aiJudge.ts`. The judge asks for no model fallbacks and drops any verdict from a Claude model.

## S2 Alerts and source maps

**Verified 2026-11-01** against PostHog's Error tracking docs (alerts; source-map upload CLI).

- **Issue alerts** (error tracking > Configuration > **Alerting** > **New notification**): "issue created or reopened" and spike. Destinations: Slack, Discord, Teams, **HTTP webhook**. Email exists only for trend alerts. So the webhook route to the Telegram send call (OQ-1) is supported; if the Telegram call rejects the webhook body shape, fall back to email via a trend alert on `$exception` count.
- **CLI**: `@posthog/cli`, pinned `0.19.0` in `scripts/upload-sourcemaps.mjs`. Steps: `sourcemap inject --directory <dist>`, then `sourcemap upload --directory <dist> --release-name <name> --release-version <sha7>`. It reads `POSTHOG_CLI_API_KEY` (personal key, scopes: error tracking write + organization read), `POSTHOG_CLI_PROJECT_ID`, optional `POSTHOG_CLI_HOST`. No other variables.
- **How it joins up**: PostHog symbolicates by the chunk ids that `inject` writes into the JS, so the injected files must be what is served. The `release` property on browser exceptions (the 7-char commit id, `src/lib/analytics/client.ts`) only filters issues by release.

### How the build behaves

`npm run build` runs `postbuild` (`scripts/upload-sourcemaps.mjs`). Only a Cloudflare Pages **production** build is a deploy build: it writes hidden maps, injects, uploads, then deletes every `.map` from `dist`. Any other build (CI `verify`, forks, local) prints `sourcemaps skipped: not a deploy build` and exits 0. A deploy build never fails on this step: a missing credential, no maps, or a failed inject or upload logs `sourcemaps WARNING: <reason>`, exits 0, and every `.map` is still deleted, so no map is served.

### Owner steps (PostHog / Cloudflare accounts; nothing is stored in the repo)

1. Cloudflare Pages > project settings > **Production** environment variables: add `POSTHOG_CLI_API_KEY` (secret) and `POSTHOG_CLI_PROJECT_ID`. Not Preview.
2. PostHog > error tracking > Configuration > **Alerting**: create "issue created or reopened" and a spike notification; destination per OQ-1 (webhook to the operator bot, or email); **Test function**; **Create & enable**.
3. Confirm exception rate limits and suppression rules (FR-PHG-032) exist; keep the screenshot under `docs/private/`.
4. Exception sources the alerts must cover: browser (`AnalyticsProvider` > `captureException`) and edge functions (`capturePosthogException`).

### Deploy rehearsal (Director, needs the credential)

In a scratch checkout: `CF_PAGES=1 CF_PAGES_BRANCH=production CF_PAGES_COMMIT_SHA=<sha> POSTHOG_CLI_API_KEY=… POSTHOG_CLI_PROJECT_ID=… npm run build` (from `pmo-portal`). Confirm `dist` has no `.map` and the maps appear under the release in PostHog. Record in the Evidence table.

### Fire-drill (AC-PHO-010)

No non-production deploy has source maps (Cloudflare previews are off). In a scratch checkout:

1. Add an uncommitted `throw new Error('fire-drill')` in a real route component's render path (a console-thrown error has no app frames and proves nothing).
2. Build with the rehearsal environment above and `CF_PAGES_COMMIT_SHA=fire-drill-<date>` style sha (any 7+ chars). Check the build log: no `sourcemaps WARNING` line, and `uploaded N maps`.
3. `npx vite preview`, load the route.
4. Confirm in PostHog: (a) the issue shows original file names and lines, (b) the alert arrived on the chosen channel.
5. Discard the checkout, resolve the drill issue, fill the AC-PHO-010 row of the Evidence table (evidence path in `docs/private/`).

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

### Funnel filter shape (S6-T1)

Not read against the live project (no key in a builder's hands). The shape follows PostHog's `FunnelsQuery`
schema and the shipped builder: `source.properties = [{ type: 'event', key: 'demo_audience', operator: 'exact',
value: ['prospect'] }]` and `breakdownFilter = { breakdown: 'demo_account', breakdown_type: 'event' }`.
**Operator check (owner or Director, once, after provisioning):** open the funnel; with a prospect-labelled
session recorded, the breakdown must list that session's `demo_account` and nothing else. If it is empty or
unfiltered, the filter belongs elsewhere (cohort or `filterTestAccounts`): change `demo.mjs`, do not guess.

### Heatmap and replay recipe (FR-PHO-052)

No code: `capture_heatmaps` is on for everyone, replay runs for the prospect demo only (`demo_audience = prospect`,
ADR-0022). Demo screens to review:

1. Projects list
2. A project's Budget tab
3. Procurement board
4. Receivables

For each: open the demo app on that route, open the PostHog toolbar (Toolbar, Heatmaps, set the URL to that
route), pick Clicks, then Rageclicks. Replays: Session replay, filter `demo_audience = prospect`, watch sessions
that visited the same route. Heatmaps are not billed against events (`client.ts`, comment at `capture_heatmaps`).
Heatmaps and replays exist only for demo sessions; do not point the toolbar at a real organisation.

### Role limits (FR-PHO-051)

Budget activation, purchase approval and invoice approval are role- and separation-of-duties-gated
(`src/auth/policy.ts`; the database is the authority). No single demo persona completes all four steps. The
funnel therefore reads as "furthest step reached per account"; a drop at a step can be a role limit, not a
usability problem. Read it with the persona chosen (`Demo personas chosen` tile) before drawing conclusions.

### Quota check (NFR-PHO-QUOTA-001)

Not run by the builder (needs the operator's key). Operator: run `node scripts/posthog/check-quota.mjs` exactly as
in `docs/analytics-events.md` § Quota safety, and write `recordings` and `events` as a percentage of the allowance
in the line below. Only `recordings` is at risk from this slice; the funnel adds no events.

- Quota read: not yet run (date, `recordings` %, `events` %).

### AC-PHO-051 (owner verification)

Scripted pass as the demo personas through project, budget, purchase and invoice; open the funnel and record
the reached steps in the Evidence table above (evidence location in `docs/private/`). Not automatable against a
third-party SaaS.

## S7 Logs (conditional)

_Owned by slice S7 (only if the Logs allowance check keeps it)._

## S9 Feedback and surveys

_Owned by slice S9._ Operator checks (the survey definitions are in `docs/posthog-dashboards.md` § S9).

1. **Published?** Header shows a Feedback button for a signed-in user; if not, the survey `[PMO] Feedback` is not launched or analytics is off for that browser.
2. **Never in a form.** Open any "New ..." page and an edit dialog, wait two minutes after the first core flow: no survey appears until the form is closed.
3. **One in 30 days.** After answering a prompted survey, reload in the same browser: no prompted survey for 30 days (the Feedback button still works). Another browser can show one: see the ceiling in `docs/analytics-events.md` § S9.
4. **Switch.** As an org Admin turn Feedback and surveys off (Administration > Organization integrations): the button disappears after the next page load. As any other role the row is read-only.
5. **Quota.** Survey answers count against the `survey_responses` resource in the quota check (`node scripts/posthog/check-quota.mjs`); a prompted survey every 30 days per user is far below any plan.

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
