# ADR-0089 — Per-organisation daily statement admission and a coalescing manual request

**Date:** 2026-10-19 · **Status:** Proposed for #1216, subject to spec/default sign-off.

## Context

The issue's owner direction separates daily organisation-local ERPNext statement refresh from hourly reconciliation and adds Finance/Admin queueing. The current handler gates the entire cycle (`supabase/functions/erpnext-sweep/index.ts:2954–2956`); its first-publication helper implements bounded activation/recent-batch exceptions (`index.ts:949–1051`). Native generation is already resumable under the org lease (`pmo-portal/src/lib/adapterSeam/erpnext/statementReportRefresh.ts:448–616`). The incremental opener already pins organisation-local planning date/timezone (`supabase/migrations/0321_financial_statement_incremental_refresh.sql:236–268`), and publication already commits catalogue replacement and dirty acknowledgement together (`0321_financial_statement_incremental_refresh.sql:879–945`).

This changes schema shape and a public write contract, so it merits an ADR. It does not revisit the native accounting source or existing read privacy.

## Decision (proposed)

1. Keep the five-minute trigger. Dispatch legacy stages hourly; independently dispatch only due orgs to the existing native collector, under the same per-org lease. A first-publication exception never accelerates other domains.
2. Add one internal `erp_financial_statement_refresh_schedule` row per org, not a job log. Store completed local day/timezone/current binding identity, one outstanding manual receipt/cooldown timestamp and one admitted run. Pin the run's identity, local day/timezone, first-admission time and captured request receipt. Bind each batch to its run. A pre-existing exact-current publication provides a lazy rollout baseline.
3. Determine due work in PostgreSQL with an explicit tick instant and `AT TIME ZONE organizations.default_timezone`. A local date boundary, not elapsed 24 hours, drives admission. One due-work helper owns binding eligibility, first-publication matching, initial fast windows and active-run continuation. Listing is advisory; fenced admission rechecks under the lease. Existing native-context guards remain the final authority over publication.
4. Expose a parameterless SECURITY DEFINER request RPC. It derives active membership, real role and org from the established auth helpers, accepts Finance/Admin only and never calls ERP. Serialize on the binding then schedule row; return the original outstanding receipt, or accept one new receipt after a five-minute cooldown. A request during an automatic run becomes one follow-up; a captured manual request coalesces. No requester identity, ERP context or credentials are stored in request state.
5. Keep the table behind forced RLS and RPC-only mutations. Expose a narrowly filtered security-barrier status view to active own-org Admin/Finance/Executive; the browser reads that view through the existing DAL/repository seam. Direct org or source selection is not part of the API.
6. Complete the admitted day and captured request in the existing publication transaction, before deleting its batch. Failure rolls everything back. Batch/run/receipt identity prevents a late or replayed publication from clearing a later request. Daily/manual work gets six hours of five-minute statement-only continuation, then hourly recovery without renewing that window.
7. Retain incremental native report selection and unchanged historical acquisition provenance. Dirty changes wait for the next admitted daily/manual batch; do not turn dirty markers into an extra refresh trigger.

## Alternatives and consequences

- **Rolling last-refresh + 24 hours:** smaller-looking predicate, but drifts away from local midnight and mishandles 23/25-hour days. Rejected.
- **Cron per timezone/org:** creates schedule lifecycle/operational fanout and still needs durable requests and retry state. Rejected.
- **Timestamp-only request column on the binding:** insufficient to distinguish a captured request from one arriving during acquisition or to acknowledge an admission day independently of publication completion. A single compact internal schedule row keeps those facts separate without a generic queue framework.
- **Browser calls the collector:** rejected by owner direction; the request is durable even after navigation and the browser never holds the worker open.

Costs: two reversible migrations, a small status surface, and explicit lane selection. Five-minute admission is approximate; a six-hour run may finish much later after recovery. A manual request does not force all historical native reports to be reacquired. Existing complete publications stay readable. Batch state is O(orgs); new request state is constant per org, not per user/click.

Scaling: batch schedule reads by at most 100 org IDs, use org primary keys and the existing lease, and preserve remaining-tick/native-stage budgets. The current fleet loader's fairness is based on legacy sweep watermarks (`supabase/functions/erpnext-sweep/index.ts:820–847`); the new lane must order due statements by their own last-attempt time instead of changing legacy order. Millions of users share org work, not per-user timers. Millions of organisations would require a separately measured scheduler/fleet-partitioning change, not a claim that the current whole-fleet loader is already sufficient.

Rollback restores pre-feature opener/publisher definitions and removes only scheduling/request metadata. It preserves native publications, dirty dates and existing read contracts; pending manual intent is checked before destructive rollback. No production operation is authorised by this ADR.

## Validation

See `docs/specs/statement-daily-refresh.spec.md` AC-001–013 and `docs/plans/2026-10-19-statement-daily-refresh.md`. Database tests own calendar, tenant, role, coalescing and atomic acknowledgement; shipped-handler unit tests own lane dispatch; RTL owns UI/cache states; one browser journey owns real queue persistence after reload.
