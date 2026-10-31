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
