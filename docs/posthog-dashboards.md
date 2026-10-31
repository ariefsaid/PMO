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

_Owned by slice S3 (#1532)._

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
