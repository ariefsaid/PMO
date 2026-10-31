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

_Owned by slice S1 (#1532)._

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

_Owned by slice S5 (#1532)._

## S6 Demo funnels

_Owned by slice S6 (#1532)._

## S7 Logs (conditional)

_Owned by slice S7 (#1532)._
