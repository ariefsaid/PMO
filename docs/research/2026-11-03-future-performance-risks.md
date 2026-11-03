# Future performance risks — what breaks as clients, users and data grow (2026-11-03)

Deep-research pass over the code at `origin/dev` (`7a5a389912ad`, branch
`ariefsaid/research-future-perf`). Scope: risks that are **not problems at today's scale** but
become real as org count, users per org, projects per org, and rows per table grow. Read-only:
every repo claim cites `file:line`; every external claim cites a primary doc URL fetched on
2026-11-03. One measurement was taken locally (a production-shaped `npm run build`, §FPR-14);
no database was queried, no reset was run.

**Already filed elsewhere and not re-reported here** (cited where a finding lands on them):
#1741 (slow-query/payload audit, virtualization), #1745 (deployments), #1746 (DB growth →
summary tables/partitioning), #1747 (server cache), #1748 (sync job queue), #1749 (Supabase
plan limits), #1750 (frontend vitals/animations), #1751 (assistant cost/routing), #1752 (RAG),
#1753 (free plans), #1754 (ERPNext hosting), #1755 (log retention), #1756 (snapshot full
rewrites), #1520 (PWA/offline), #1254 (RLS auth lookups evaluated per row).

## Today's baseline (context given by the dispatch)

| Metric | Value |
|---|---|
| Live clients | 1 (ADR-0047: one Supabase Pro project per paying client — load is per-project, not shared) |
| Cloud DB size | ~133 MB |
| Largest table | ~4.5k rows |
| Migrations / policies / RPC defs | 431 / 439 `create policy` / 880 `create or replace function public.*` |
| Client bundle (measured, `npm run build`, pmo-portal 0.30.0) | 253 chunks, 6.67 MB JS raw / 1.93 MB gzip, 7.5 MB assets total |
| Client cache | TanStack Query v5, `staleTime` 30 s, `gcTime` 5 min (`pmo-portal/src/lib/queryClient.ts:6-9`) |
| PostgREST `max_rows` | 1000 (`supabase/config.toml:18`) |

---

## Findings

### FPR-01 — Executive dashboard aggregates the whole org live, with per-project correlated subqueries
- **What it is:** `get_executive_dashboard()` (security invoker, recomputed on every dashboard
  load) runs correlated subqueries **per project** over `procurements` and
  `budget_versions ⋈ budget_line_items` in four CTEs, and then `top_projects` recomputes the
  same two aggregates again for its 5 rows.
- **Evidence:** `supabase/migrations/0286_executive_at_risk_active_delivery.sql:27-38`
  (`active_committed`: per-project budget sum + committed-spend sum), `:42-45` (`on_hand`),
  `:50-57` (`pipeline`), `:79-100` (`top_projects` re-runs both sums per row). Under invoker
  every scanned row also evaluates RLS (#1254 amplifies this). Cost ≈
  O(projects × (versions × line_items + procurements)).
- **Today:** trivial at ~4.5k rows total.
- **Trigger:** any of: procurements > 10k rows/org, budget line items > 50k rows/org, or
  dashboard RPC p95 > 1.5 s in observability.
- **Fix when triggered:** per-project rollup maintained incrementally by trigger, or a
  materialized summary refreshed on a short cron (the direction already filed as #1746).
- **Severity when hit:** High (dashboard is the landing surface).

### FPR-02 — Whole-set reads pull entire org partitions into the browser
- **What it is:** the shared `fetchAllPages` loop (offset paging until short page) is used to
  read **complete sets** into client memory: all budget versions + all line items + all editors
  per project; all meetings × 3; all documents; all profiles; all incidents; all revenue rows;
  all agent threads; a run's full transcript.
- **Evidence:** `pmo-portal/src/lib/pagedRead.ts:57-58` (the loop contract);
  `src/lib/db/budgets.ts:155-189` (4 whole-set reads per budget page open);
  `src/lib/db/meetings.ts:300,328,377`; `src/lib/db/documents.ts:65`; `src/lib/db/adminUsers.ts:41-43`;
  `src/lib/db/incidents.ts:54`; `src/lib/db/revenue.ts:190,259`; `src/lib/db/agentThreads.ts:50-63`;
  `src/lib/db/agentEvents.ts:25-33`. `listProjects` is an unbounded full select
  (`src/lib/db/projects.ts:204-227`).
- **Today:** fine — the whole DB is ~4.5k rows across tables.
- **Trigger:** any single one of these reads > 20k rows or > 5 MB JSON, or a list route's
  data wait > 3 s on the richest client.
- **Fix when triggered:** move the listed surfaces to keyset-paged server reads with page
  sizes (the keyset helper already exists: `pagedRead.ts` `fetchAllRowsByKeyset`), and keep
  virtualization (filed as #1741) for rendering. The budget page can request per-version
  slices instead of the whole partition.
- **Severity when hit:** Medium → High (memory + mobile data, plus 5-min `gcTime` keeps the
  largest lists resident across navigation).

### FPR-03 — Odoo master-record directory: `count=exact` + OFFSET paging + leading-wildcard search
- **What it is:** the Odoo directory (products/partners/warehouses mirrored per org) pages
  with OFFSET and asks PostgREST for an **exact COUNT** on every page, and searches with
  `ilike '%term%'` on `name`/`code` — a leading wildcard cannot use the shipped btree indexes
  (the migration deliberately deferred the trigram index).
- **Evidence:** `pmo-portal/src/lib/repositories/odoo.ts:15` (`count: 'exact'`), `:23`
  (`.range(from, from+pageSize-1)` = OFFSET), `:9` (`likeAny` wraps `%…%`);
  `supabase/migrations/0421_odoo_master_records.sql:35-37` (btree indexes + the explicit
  "add pg_trgm when search is slow" note). PostgREST docs: exact count "the larger the table
  the slower this query runs" — https://docs.postgrest.org/en/v12/references/api/pagination_count.html;
  OFFSET requires skipping the preceding rows — https://www.postgresql.org/docs/current/queries-limit.html.
- **Today:** directory is a few hundred rows.
- **Trigger:** `external_master_records` > 50k rows/org (a real Odoo item+partner master
  reaches this), or directory search p95 > 500 ms.
- **Fix when triggered:** `pg_trgm` GIN index on `name`/`code`; switch the pager to
  `count=estimated`/`planned` or cache the header count (the sibling `masterSummary` already
  uses `head:true`, `odoo.ts:29`); keyset paging instead of OFFSET.
- **Severity when hit:** Medium.

### FPR-04 — RLS parent-guard `EXISTS` subqueries evaluate per row on child tables
- **What it is:** #1254 covers the unwrapped `auth_org_id()`/`auth_role()` calls. Distinct
  from that: the **parent-org guard** policies on child tables run a *correlated* `exists
  (select 1 from <parent> where <parent>.id = child.parent_id and …)` — a parent-table probe
  per candidate row — on `budget_versions`, `budget_line_items`, `tasks`, `task_dependencies`
  (twice), `project_documents`, `procurement_items`, `procurement_quotations`,
  `procurement_documents`.
- **Evidence:** `supabase/migrations/0002_rls.sql:72-77` (budget_versions → projects),
  `:82-87` (line items → versions), `:93-98` (tasks → projects), `:102-108`
  (task_dependencies → tasks ×2), `:131-136` (procurement_items → procurements), same shape
  for quotations/documents (`:144`, `:157`).
- **Today:** negligible.
- **Trigger:** a full-scan read of any guarded child table > 100k rows (the ERP mirrors and
  procurement records are the tables that grow into this first), or write throughput where
  each insert evaluates the guard per row.
- **Fix when triggered:** fold the parent org into the child row (org-stamped FK columns or
  an org column maintained by trigger, so the policy is a plain `org_id = (select
  auth_org_id())` equality) — the same one-migration rewrite as #1254 can carry this.
- **Severity when hit:** Medium on reads, High on mixed read/write scans.

### FPR-05 — Per-row triggers multiply write cost, and bulk paths inherit the multiplication
- **What it is:** every business-row INSERT runs the `stamp_org_id()` BEFORE trigger
  (a security-definer `auth_org_id()` profiles lookup per row), and every configured table's
  INSERT/UPDATE runs `record_change_capture()` (config lookup, `to_jsonb(old)` + `to_jsonb(new)`,
  optional parent lookup, one `record_changes` INSERT). On top sit the native-mirror guard
  triggers (`0097`–`0100`) and AFTER DELETE audit triggers (`0076`). A single row write passes
  2–4 trigger bodies; a 50k-row import/backfill executes 100k–200k extra statements.
- **Evidence:** `supabase/migrations/0074_org_id_stamp_trigger.sql:73-86` (function) and
  `:96-132` (attached to ~30 tables); `supabase/migrations/0260_record_change_history.sql:133-206`
  (capture body — note it correctly skips no-op updates, `:148-172`), `:216-222` (attached per
  configured table); `0097_companies_contacts_erpnext_flip.sql` (mirror guards);
  `supabase/migrations/0076_audit_events.sql:112-125` (delete-audit triggers).
- **Today:** invisible.
- **Trigger:** single-row write p95 > 150 ms, or any bulk import/sweep backfill batch
  > 50k rows in one tick window.
- **Fix when triggered:** set-based (statement-level) history capture for bulk paths, or
  route imports through a service-role loader that writes provenance once per batch (the
  `import_batch_id` seam already exists, `0072_import_provenance.sql`) instead of per-row
  triggers. Growth of `record_changes`/`audit_events` itself is #1755/#1746.
- **Severity when hit:** Medium.

### FPR-06 — Assistant aggregations silently cap at 5,000 rows and page them by OFFSET
- **What it is:** `query_entity` aggregate mode pulls `id, group_by, sum` columns through
  PostgREST 1,000 rows at a time — with a growing OFFSET — up to a hard 5,000-row cap, then
  reports "Totals are partial". The aggregation happens **in the edge function**, not in SQL,
  and each page re-evaluates RLS per row. The 5 s read timeout bounds it further.
- **Evidence:** `supabase/functions/agent-chat/readEntities.ts:77-79` (`AGENT_AGGREGATE_ROW_CAP = 5000`,
  `AGENT_AGGREGATE_PAGE_SIZE = 1000`, `AGENT_AGGREGATE_GROUP_CAP = 200`);
  `supabase/functions/agent-chat/actions.ts:148-186` (do/while paging, `q.range(offset, …)`),
  `:195-209` (partial-totals note).
- **Today:** nearest-to-trigger finding in this file — the largest table is ~4.5k rows, so one
  unfiltered aggregate is already close to the cap.
- **Trigger:** any single aggregate query matching > 5,000 caller-visible rows (e.g. "sum all
  PO amounts this year" once POs pass 5k).
- **Fix when triggered:** add a `group_by`-in-SQL RPC (one `select … group by` under RLS)
  exposed as an agent tool; keep the row cap for detail reads only.
- **Severity when hit:** High — answers become *wrong-ish* (partial totals) precisely as data
  grows, and each degraded call burns 5 PostgREST round trips.

### FPR-07 — Sequential per-org sweep inside a fixed edge wall clock
- **What it is:** `runErpSweepCycle` iterates employing orgs **sequentially**, each org running
  up to 11 passes (outbox recovery, money pushes ×4, connect advance/drain, doctype sweep,
  link repair, statement capture, ledger feed, purchases feed), with the hourly block hard-stopped
  at a 120 s in-invocation deadline (the free-plan wall clock is 150 s; paid is 400 s).
  Work that doesn't fit defers to the next tick — so **total sweep throughput is fixed while
  org count and per-org data grow**; latency of the last org in line grows linearly.
- **Evidence:** `supabase/functions/erpnext-sweep/index.ts:601-611` (sort by last-run, sequential
  for-loop), `:704-717` (deadline gates), `supabase/functions/erpnext-sweep/sweepCadence.ts:14-21`
  (`HOURLY_INVOCATION_DEADLINE_MS = 120_000`, 55-min full-sweep interval); tick fired every
  minute via pg_cron→pg_net (`supabase/migrations/0356_erpnext_sweep_every_minute.sql:14`,
  `0102_erpnext_sweep_cron.sql:44-60`). Edge limits (256 MB / wall clock 150 s free · 400 s paid /
  2 s CPU per request): https://supabase.com/docs/guides/functions/limits.
  pg_net queues requests in `net.http_request_queue` and keeps responses 6 h:
  https://supabase.com/docs/guides/database/extensions/pg_net. A failed tick simply waits for
  the next one — there is no retry queue beyond the cron cadence.
- **Today:** 1 employing org; passes complete far inside the deadline.
- **Trigger:** employing orgs > 20, or any single org's hourly block > 90 s consistently
  (visible as repeated `truncated`/`statement-lock-held` outcomes in sweep logs).
- **Fix when triggered:** the filed #1748 job queue (one queued job per org per pass,
  N workers) — or per-org function invocations fanned out by the tick instead of one loop.
- **Severity when hit:** Medium (money postings stay every-minute because the money passes
  run first per org; the inbound/statement work is what falls behind).

### FPR-08 — ClickUp rate budget is enforced per OS process, not per org
- **What it is:** the ClickUp limiter is an in-memory token bucket (100 req/min, interactive
  lane) instantiated **inside one edge-function invocation**. The sweep and the webhook worker
  each build their own instance, and every cold start resets the bucket — so the documented
  per-token budget is only approximated whenever two invocations overlap.
- **Evidence:** `pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts:11-15,38` (capacity
  default 100/min, in-memory state); consumer split: `clickup-sweep` vs
  `clickup-webhook-worker` (separate functions, `supabase/functions/clickup-webhook-worker/index.ts:308-314`
  — note the documented "no per-row backoff" ponytail). ClickUp's real budget is per token:
  100/min on Free/Unlimited/Business plans, 1,000 Business Plus, 10,000 Enterprise —
  https://developer.clickup.com/reference/rate-limits. Failure pressure is asymmetric: ClickUp
  marks a webhook Failing on error/>7 s and Suspends it at 100 failures
  (`supabase/functions/clickup-webhook/index.ts:7-13`).
- **Today:** one org, modest task churn.
- **Trigger:** sustained ClickUp API demand > ~80 req/min from one project, or the first
  genuinely concurrent sweep+webhook overlap.
- **Fix when triggered:** a DB-backed token bucket (one row per org, atomic claim) or a
  single serialized ClickUp lane owned by the #1748 queue.
- **Severity when hit:** Medium (429 storms slow sync; webhook suspension is the sharp edge).

### FPR-09 — Odoo Online's 1 call/second cap vs a growing sync surface
- **What it is:** the Odoo sweep ticks every 5 minutes; Odoo *Online* (SaaS) allows
  ~1 RPC/second with no parallel calls, so per-record pushes and large master-record pulls
  must stay batched and throttled as orgs/projects grow. The repo's own research file records
  this and its adapter implication (bulk arrays + throttle).
- **Evidence:** `docs/research/2026-10-30-odoo20-api.md:17,120-125` (quote of Odoo's
  Acceptable Use Policy; "a naive fine-grained sync will instantly fail against the 1 req/sec
  limit"); tick registration `supabase/migrations/0421_odoo_master_records.sql:169`;
  outbound batches flow through `external_command_outbox` (ADR-0058 pattern).
- **Today:** well inside the cap.
- **Trigger:** > ~250 Odoo calls queued per 5-min tick, or a client on Odoo Online adding
  per-document push at document-create rate.
- **Fix when triggered:** keep the outbox batching discipline (already in place), raise
  batch sizes, or move the client to Odoo.sh dedicated hosting (the research file's stated
  alternative); the generic queue is #1748.
- **Severity when hit:** Medium.

### FPR-10 — Agent transcript replay grows with the thread and loads fully into the browser
- **What it is:** the agent replays the whole transcript each round (stateless), and the
  client loads a run's **complete** event list (each event carries `text` + `payload` jsonb)
  on open; thread lists load every live thread. Compaction only trims old tool bodies once
  the transcript passes ~80k chars.
- **Evidence:** `supabase/functions/_shared/transcriptCompaction.ts:36-53` (trigger 80k chars,
  12-message recency window — raised after the re-query-loop regression);
  `pmo-portal/src/lib/db/agentEvents.ts:25-33` (full run load);
  `pmo-portal/src/lib/db/agentThreads.ts:50-63` (all threads via `fetchAllPages`).
  Cost/routing itself is #1751; retrieval/RAG is #1752.
- **Today:** chats are short.
- **Trigger:** threads > ~50 turns with tool payloads, or any single run > 500 KB of events.
- **Fix when triggered:** window the transcript server-side (paged history + summary anchor)
  and virtualize/paginate the panel's event list.
- **Severity when hit:** Low → Medium (chat latency and mobile memory).

### FPR-11 — FK-option comboboxes cache full org lists; RPC `p_ids` arrays grow with them
- **What it is:** every vendor/project/client picker loads the **complete** org list into the
  TanStack cache (5-min stale). Delivery/milestone RPCs take `p_ids` arrays of all visible
  project ids — request size and IN-list plan cost grow with project count.
- **Evidence:** `pmo-portal/src/hooks/useFkOptions.ts:24-25` (`FK_STALE_MS` 5 min), `:38-52`
  (vendor = whole company list), `:58-75` (projects = whole list, filtered client-side);
  `pmo-portal/src/lib/db/milestones.ts:98,147` (`get_projects_delivery`/`get_projects_milestone_dates`
  with `p_ids`).
- **Today:** fine.
- **Trigger:** vendors or projects > 5k rows/org, or visible-project id arrays > ~2k.
- **Fix when triggered:** server-search combobox (typeahead with `limit 20`), and pass the
  status filter into the RPCs instead of id arrays.
- **Severity when hit:** Low → Medium. (Rendering-side virtualization is #1741.)

### FPR-12 — Silent >1000-row truncation: the guard is per-call-site, and call sites grow
- **What it is:** PostgREST `max_rows = 1000` truncates **silently** (HTTP 200, short body,
  no error — `supabase/config.toml:18`, documented in `pmo-portal/src/lib/pagedRead.ts:1-22`).
  Reads that route through `pagedRead` are safe and CI-pinned (`pagedRead.config.test.ts`),
  but nothing stops a new DAL read from doing a plain un-paged `.select()` — the failure only
  appears once that table crosses 1,000 rows for the caller.
- **Evidence:** `supabase/config.toml:18`; `pmo-portal/src/lib/pagedRead.ts:1-22,41-58`
  (the "silently WRONG" catalog: understated money sums, inert dedupe guards, empty search
  results); the config pin test `pmo-portal/src/lib/pagedRead.config.test.ts`.
- **Today:** every known money/list read goes through the seam.
- **Trigger:** statistically, the first new list read added after a table passes 1k rows —
  make the trigger concrete: **any table an unpaged read touches > 1,000 org-visible rows**.
- **Fix when triggered:** a lint/grep gate that rejects `.from(...).select(...)` reads in
  `src/lib/db/**` without `.range()`/`limit`/`pagedRead` (same shape as the existing
  edge-fn test-binding guard), plus per-read page caps.
- **Severity when hit:** Medium (it is a correctness cliff that presents as "slow/wrong at scale").

### FPR-13 — Per-project platform ceilings: connections and compute tier
- **What it is:** ADR-0047 isolates clients onto separate Supabase Pro projects, so ceilings
  bind **per client project**. The base Micro tier allows 60 direct DB connections /
  200 pooler clients / default pool 15; Small 90/400; Medium 120/600. All app traffic flows
  browser → PostgREST (HTTP), so per-user connection cost is low; the consumers of direct
  connections are pg_cron, pg_net workers, migrations, and ops tooling. Supavisor transaction
  mode disallows prepared statements and pipelining —
  https://supabase.com/docs/guides/database/connecting-to-postgres (shared pooler sections).
  Connection table: https://supabase.com/docs/guides/platform/compute-add-ons.
- **Today:** 60–120 connections is far above the app's need.
- **Trigger:** sustained active connections > 80% of the tier's `max_connections` in
  dashboard observability, or > ~100 concurrent users on one project during a heavy report.
- **Fix when triggered:** up-tier compute (the add-on table prices the ladder: Micro ~$10 →
  Small ~$15 → Medium ~$60); point any future persistent backend at the transaction pooler;
  the VPS exit path in ADR-0047 triggers at ~$200/mo sustained.
- **Severity when hit:** Low (remote — the app's HTTP-only data path defers it), plan-limit
  cost angle is #1749.

### FPR-14 — Frontend bundle grows linearly with routes and shared code (measured)
- **What it is:** 52 `React.lazy` route imports (`pmo-portal/App.tsx:68-…`, count 52) over
  125 files in `pages/`; vendor chunks are deliberately split and tested
  (`pmo-portal/src/lib/build/vendorChunk.ts:24-29`). Growth accumulates in (a) the route-shared
  chunk — measured **ListState 598 KB raw / 174 KB gzip**, the largest non-vendor chunk — and
  (b) fat lazy route chunks (MinutesEditor 960 KB, exceljs 930 KB — the xlsx export path,
  loaded on demand). i18n catalogues are fetched JSON, never bundled
  (`src/lib/i18n/index.ts:23-30`), so languages don't grow the bundle.
- **Measured today** (`npm run build`, this branch): 253 chunks, **6.67 MB JS raw / 1.93 MB
  gzip** total; entry `index` 283 KB → 84 KB gzip; `vendor-react` 223 KB → 71 KB gzip;
  `vendor-supabase` 201 KB → 51 KB gzip.
- **Trigger:** first-load JS > 300 KB gzip or the shared (ListState) chunk > 400 KB gzip.
- **Fix when triggered:** audit what gravitates into the shared chunk each release (it is the
  default landing place for modules shared by ≥2 routes), move xlsx/OG-tooling further behind
  interaction, consider `build.chunkSizeWarningLimit` alerts in CI.
- **Severity when hit:** Low (mobile-first clients pay it most).

### FPR-15 — Write-path read-model cost: history renders re-read by replay, not by query
- **What it is:** record history pages assemble a trail by reading `record_changes` for the
  entity and re-resolving referenced rows; each trail row is small but the table is
  append-only (see FPR-05) and the entity index is `(org_id, entity_type, entity_id, seq desc)`
  — fine per record, but any future "all changes in period" view would be a full-table scan.
- **Evidence:** `supabase/migrations/0260_record_change_history.sql:126-127` (indexes are
  entity/parent-scoped only — there is no `(org_id, created_at)` index); reader
  `pmo-portal/src/lib/db/procurementHistory.ts` (per-record reads).
- **Today:** fine.
- **Trigger:** any shipped "org-wide change feed/audit search" feature, or `record_changes`
  > 1M rows.
- **Fix when triggered:** add `(org_id, created_at desc)` index or a daily-rolled summary
  (#1746's summary-table direction); retention is #1755.
- **Severity when hit:** Low until such a feature ships.

---

## Checked and clear (or deferred by design)

- **Realtime:** no `postgres_changes`/`.channel(` subscriptions anywhere in `src/`/`pages/`
  (grep, zero hits) — there is no per-change RLS evaluation cost today. If Realtime is added,
  budget per-subscriber WALRUSt cost per Supabase's Realtime docs before shipping.
- **Storage:** signed URLs are minted **on click**, not per list row
  (`src/lib/db/documents.ts:373-395`, `pages/procurement/LedgerFileCell.tsx:9`,
  `src/components/documents/DocumentViewer.tsx:41` renders one signed URL per opened preview);
  uploads are capped at 5 MB (`src/lib/fileConstants.ts:7`) with bucket-level
  `file_size_limit` in migrations (`0025`, `0028`, `0060`, `0247`). Remaining exposure is
  object count/egress — plan-limit territory (#1749).
- **Timesheet week save:** one atomic RPC per week save with changed-cells upserts + zeroed-cell
  deletes (`src/lib/db/timesheets.ts:140-165`) — bounded per user-week, no whole-week rewrite.
- **Offset paging discipline:** money sums already use keyset (`fetchAllRowsByKeyset`,
  `pagedRead.ts:17-22`); the known offset-loop caveat (dup under concurrent insert) is
  documented and restricted to cosmetic list contexts.
- **Snapshot rewrites** (#1756) and **log retention** (#1755) — excluded as filed.
- **i18n:** lazy per-namespace fetch from `/locales/<lng>/<ns>.json`, never bundled
  (`src/lib/i18n/index.ts:23-30`) — no growth risk.
- **Refetch storms:** 222 `invalidateQueries` call sites surveyed; the broadest key is
  `['integrations']` (29 sites), next `['procurement-item-eligibility']` (7) — each mutation
  busts a bounded aggregate root, and 30 s `staleTime` caps refetch frequency
  (`pmo-portal/src/lib/queryClient.ts:6-9`). Watch it if a key that many pages subscribe to
  (e.g. `integrations`) starts anchoring per-row queries; today nothing fan-outs per row.
- **Connection behavior of the client:** the SPA never opens direct Postgres connections —
  all reads go browser → PostgREST over HTTPS, so user count multiplies HTTP requests, not
  DB connections (deferred to FPR-13).
- **Assistant attachments:** text-extracted, bounded and truncated before entering the prompt
  (`supabase/functions/agent-chat/attachments.ts:95-101`), with an extraction cache column —
  not raw file replay.

## Ranked summary

| # | Risk | Trigger (measurable) | Severity when hit |
|---|---|---|---|
| FPR-06 | Agent aggregates cap at 5k rows (OFFSET-paged, edge-side) | any aggregate query > 5,000 matched rows | **High** |
| FPR-01 | Executive dashboard live per-project rollups | procurements > 10k or line items > 50k/org, or p95 > 1.5 s | **High** |
| FPR-02 | Whole-set reads into the browser | any read > 20k rows / > 5 MB, route wait > 3 s | Medium → High |
| FPR-04 | RLS correlated parent-guard EXISTS per row | guarded child table > 100k rows under full scan | Medium → High |
| FPR-12 | Silent >1000-row PostgREST truncation on new unpaged reads | first unpaged read on a table > 1k rows | Medium |
| FPR-07 | Sequential per-org sweep vs fixed wall clock | orgs > 20, or one org's hourly block > 90 s | Medium |
| FPR-08 | ClickUp rate budget enforced per process | sustained > ~80 req/min, or first sweep+webhook overlap | Medium |
| FPR-03 | Odoo directory: count=exact + OFFSET + `%like%` | master records > 50k/org, search p95 > 500 ms | Medium |
| FPR-09 | Odoo Online 1 req/s vs growing sync | > ~250 queued calls / 5-min tick | Medium |
| FPR-05 | Per-row trigger write amplification on bulk paths | write p95 > 150 ms, or import batch > 50k rows | Medium |
| FPR-10 | Agent transcript replay + full-run client load | threads > ~50 turns, run > 500 KB | Low → Medium |
| FPR-11 | FK pickers cache full org lists; `p_ids` arrays grow | vendors/projects > 5k/org | Low → Medium |
| FPR-15 | History table has no time index for future org-wide views | `record_changes` > 1M rows or a change-feed feature | Low |
| FPR-14 | Bundle growth in shared chunk | shared chunk > 400 KB gzip | Low |
| FPR-13 | Per-project connection/compute ceiling | connections > 80% of tier, > ~100 concurrent users | Low |

**Nearest-term watch item:** FPR-06 — the 5,000-row aggregate cap sits just above today's
largest table (~4.5k rows); any growth in procurement/PO counts degrades assistant answers
first, and the fix (a SQL `group by` RPC tool) is small.
