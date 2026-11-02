# Daily Site Report Implementation Plan

> **For agentic workers:** Execute each slice with a fresh Orca worker under the project workflow. TDD steps below use checkboxes. This plan is proposed; owner must sign the spec decisions first.

**Goal:** Capture a phone-friendly daily report and photos offline, then sync or expose actionable failures without duplicating operational records.

**Architecture:** A small report aggregate stores the report and daily installed-volume deltas; it links to existing operational sources and shared attachments rather than mirroring their state. #1520 owns the durable device queue and retry; source creation goes through each domain's authorized interface. A report and each source/photo are separately acknowledged with visible status (OD-DSR-2 default).

**Tech stack:** React 19, TypeScript, Vite, Supabase Postgres/RLS, Vitest/RTL, pgTAP, Playwright, existing PWA/attachment infrastructure.

**Spec:** `docs/specs/daily-site-report.spec.md`.

## Global constraints and release gates

- Owner sign-off of OD-DSR-1–6 precedes execution; defaults are proposals, not rulings. Resolve contracts with #1512, #1516, #1519 and #1520 at their landed heads before dispatch; if their APIs cannot satisfy this spec, return to Director rather than inventing a bypass. #902 owns custom roles; register report actions in its catalog when available and use existing built-in policy until then.
- Migration slots **0530–0532 only**; check availability at execution, stop on collision. Each forward migration has `supabase/migrations/rollback/<number>_<slug>_down.sql`, preserves source records, stamps `org_id`, enables/forces RLS, grants service role, revokes public/anon, and has an indexed org/project/date read path. Do not run rollback against live data without the normal approval.
- `can()` is UX; server is authority (ADR-0016). Repository seam (ADR-0017); soft archive (ADR-0018); source SoD and posting rules (ADR-0019) remain intact. No offline approval, money, posted stock, or shared-record edit. No new billing, inventory, attachment or queue system.
- Screen: `DESIGN.md` tokens, shared form primitives, English and Indonesian, responsive 320px, keyboard and status announcements. No private data in fixtures. Dates are project-local dates; finite nonnegative quantities and source-specific units.
- DB commands from repo root under `scripts/with-db-lock.sh`; when a migration changes, reset and targeted test in one hold. Inspect output for `Parse errors`. No full local suite. For each slice, run `npm run check:guards`, `npm run typecheck`, eslint on touched TS/TSX, directly touched Vitest tests; run touched e2e and `scripts/ux-proof.sh` for UI. Run migration collision, isolation denominator, 0136/0137/0178 guards for DB changes; mutate authorization/idempotency guards to establish red and restore. CI is the full-suite gate.
- RLS, auth, SoD and money-related slices ship alone. UI/source wiring can be batched only where the project release rules allow. Each slice is independently reviewed by spec, quality and security reviewers; owner judges rendered UI.

## Interface preflight (blocking, no implementation)

1. Confirm #1520's landed queue API supplies stable request IDs, durable blobs, retry/correction, device-local Needs fixing and identity-scoped isolation; document exact imports and response semantics in this plan. Confirm #1516 assignment validity and whether it authorizes entering another person's sheet; default OD-DSR-1 is own hours only. Confirm #1512 supports offline-created **draft** issues with project/BoQ; connected posting stays in #1508. Confirm #1519 `save_equipment_usage(jsonb)` still returns the actual source identity and stays draft. Confirm photo attach mechanism and its authorization. Stop and reconcile any mismatch with the Director before coding.
2. Verify newest bodies and tests for `record_progress_assessment`, `create_stock_document`, `save_equipment_usage`, `timesheet_entries` and current attachment policy. A daily delta is not `quantity_to_date`; never call the monthly assessment writer on sync. Capture findings in the implementation PR, not a public weakness report.

## Slice map and file ownership

| Slice | Deliverable / dependency | Migration | Shipping |
|---|---|---|---|
| S1 | report, deltas, RLS, request idempotency and archive | 0530 | auth; alone |
| S2 | typed source links and authorization-safe reads, after S1 and #1512/#1516/#1519 | 0531 | auth/stock boundary; alone |
| S3 | attachment association if the landed shared attachment API needs one; after #1520 | 0532 | auth; alone; omit if existing association suffices |
| S4 | repository, hooks and #1520 queue integration, after S1–S3 and #1520 | none | batchable |
| S5 | responsive screen, filters and recovery, after S4 | none | UI lane |
| S6 | curated offline journey, after S5 | none | with S5 |

Each source is created independently with its own stable request ID. The link references a confirmed source ID, not a second copy of the source. Report creation may succeed before a source/photo; the user sees this distinction. If a source's landed API lacks retry-safe identity, S2 is blocked until its owning issue provides it; this plan does not add a shadow writer.

## Review focus

- Retry after server commit but before response: S1 idempotency test proves one report and returns its original ID.
- A formerly valid work item or assignment changes offline: S1/S4 reject and retain input without exposing another project.
- Two daily deltas in one month: S1 proves assessment remains unchanged.
- Local blob or storage failure: S4 tests the queue result and S5 announces the reason without a false success.
- Accepted report with failed source or photo: S4/S5 render independent results; retry never recreates accepted siblings.

## Tasks

Each numbered step is a 2–5 minute change/check; split further if the actual landed interfaces demand it. Tests name the AC in the title and exercise shipped functions, not copies.

### S1 — report aggregate, 0530 (alone)

**Files:** create `supabase/migrations/0530_daily_site_reports.sql`, `supabase/migrations/rollback/0530_daily_site_reports_down.sql`, `supabase/tests/daily_site_reports.test.sql`; update `scripts/isolation-probe-denominator.json` and `supabase/tests/0178_anon_executable_definers.test.sql` for any new client-callable definers.

**Interfaces:** `create_daily_site_report(p_request_id uuid, p_payload jsonb) returns uuid`; `archive_daily_site_report(p_report_id uuid) returns void`. Payload: `project_id`, `work_date`, `boq_item_id`, `activities`, `volumes` (each `quantity`, `unit`). The server derives org and author. Report IDs are returned on exact retries; hash a canonical payload scoped by org/author/request ID, reject changed-payload reuse. `daily_site_reports` holds header and archive timestamp; `daily_site_report_volumes` holds immutable dated deltas linked to report. A report may contain no volume.

- [ ] S1.1 **Red:** pgTAP `AC-DSR-002` submits a foreign-project work item and asserts rejection and zero new headers; `AC-DSR-008` asserts other-org and out-of-scope read/create denied. Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/daily_site_reports.test.sql'` from root; expect failures because objects do not exist.
- [ ] S1.2 **Green:** create tables, same-org/project validation, RLS and the create RPC; validate nonempty activities only if supplied, bounded length 2000, date and finite nonnegative quantities, and item project. Index `(org_id, project_id, work_date desc, id desc)`; no client DML grants. Re-run S1.1; expect both tests pass.
- [ ] S1.3 **Red→green:** `AC-DSR-003` repeats an identical request after simulated lost response and asserts same UUID and one row; reuse ID with changed payload is refused. Add atomic unique `(org_id, author_id, request_id)` and canonical payload comparison inside create RPC; concurrent duplicate returns same UUID. Re-run pgTAP; expect pass.
- [ ] S1.4 **Red→green:** `AC-DSR-006` records two deltas and asserts both persist and existing `progress_assessment_quantities` remains unchanged. `AC-DSR-012` archives header and asserts linked source lifecycle is unaffected. Implement archive authorized on server without cascade to sources. Re-run pgTAP; expect pass.
- [ ] S1.5 Add rollback in reverse dependency order with refusal if report data exists; add grants/denominator/0178 entries and rederive counts. Mutation: remove same-project check, then idempotency uniqueness; respective tests must fail, restore both. Run `scripts/check-migration-collisions.sh`, its `--self-test`, `node scripts/check-isolation-denominator.mjs`, its `--self-test`, and locked pgTAP for this file plus `supabase/tests/0136*`, `supabase/tests/0137*`, `supabase/tests/0178*`; inspect bodies and parse errors. Commit slice after project local gates.

### S2 — source references, 0531 (alone; after #1512/#1516/#1519)

**Files:** create `supabase/migrations/0531_daily_site_report_sources.sql`, matching rollback, `supabase/tests/daily_site_report_sources.test.sql`; update denominator and 0178 as required.

**Interfaces:** `link_daily_site_report_source(p_report_id uuid, p_kind text, p_source_id uuid) returns void`; kinds `timesheet`, `equipment`, `stock`. Unique `(report_id, kind, source_id)`. The RPC verifies author/report scope and the actual source's org, project and date and source visibility; it never creates, updates or posts the source. Work item attribution remains on the report/link and stock issue's own mandatory item; mismatches are rejected. The reader uses invoker/RLS-safe checks and returns a generic unavailable marker for inaccessible sources, never privileged payloads.

- [ ] S2.1 **Red:** `AC-DSR-005` creates allowed source drafts via their real interfaces, links them and asserts statuses unchanged and no ledger posting or approval; cross-project and unauthorized sources fail. Run locked reset + `supabase test db supabase/tests/daily_site_report_sources.test.sql`; expect missing object failure.
- [ ] S2.2 **Green:** add the typed link table, RLS, link RPC and indexes; use actual landed source identifiers and permissions from preflight; no DML into source tables. Re-run S2.1, expect pass.
- [ ] S2.3 **Red→green:** `AC-DSR-010` asserts project/date filter, stable pagination and generic unavailable source. Add bounded invoker reader `list_daily_site_reports(p_project_id uuid, p_from date, p_to date, p_before_date date, p_before_id uuid, p_limit integer)` with maximum 100 and `(work_date,id)` keyset. Re-run pgTAP; expect pass. Verify `AC-DSR-012` source preservation with actual linked rows.
- [ ] S2.4 Write rollback and guard inventory; mutate source project/permission check and prove test red, restore. Run S1.5 DB gates and both daily-report pgTAP files under one reset/lock; commit after local gates.

### S3 — photo association, 0532 (alone, conditional)

**Files:** `supabase/migrations/0532_daily_site_report_photos.sql`, matching rollback, `supabase/tests/daily_site_report_photos.test.sql` only if preflight finds the existing shared attachment association cannot link a report. If it can, use it and leave 0532 unused; never create a second blob store.

- [ ] S3.1 **Red:** test an authorized report/photo link and denial for another org or inaccessible photo, including repeat link with no duplicate. Run locked reset and this pgTAP file; expect missing association failure.
- [ ] S3.2 **Green:** add only a report-to-existing-attachment association, unique report/attachment pair, RLS and source-aware authorization; preserve photo on report archive. Run the test; expect pass. Write rollback, update denominator and guards, mutation-check access denial, run S1.5 gates, commit.

### S4 — repository and durable queue

**Files:** create `pmo-portal/src/lib/db/dailySiteReports.ts`, `pmo-portal/src/lib/repositories/dailySiteReports.ts`, `pmo-portal/src/hooks/useDailySiteReports.ts`, `pmo-portal/src/hooks/useDailySiteReports.test.tsx`, `pmo-portal/src/lib/dailySiteReportQueue.test.ts`; modify `pmo-portal/src/auth/policy.ts` and its test. Wire the landed #1520 queue, not a new persistence store.

**Interfaces:** repository `create(input: DailySiteReportInput, requestId: string): Promise<string>`, `list(projectId: string, from: string, to: string, cursor?: ReportCursor): Promise<ReportPage>`, `archive(id: string): Promise<void>`, `linkSource(reportId: string, kind: SourceKind, sourceId: string): Promise<void>`. Input has `projectId`, `workDate`, `boqItemId`, `activities`, `volumes`; convert once to RPC snake_case. Hooks key by org, project and filter; mutations invalidate report keys. Queue adapters follow #1520's actual typed API, preserving item IDs across retries and keeping blob until link acknowledgement.

- [ ] S4.1 **Red:** `AC-DSR-004` queue test simulates an assignment revoked after capture: server rejection produces Needs fixing with original input/reason; `AC-DSR-011` correction retries with new attempt identity and does not re-create accepted siblings. Run `cd pmo-portal && npx vitest run src/lib/dailySiteReportQueue.test.ts`; expect missing module failure.
- [ ] S4.2 **Green:** implement typed repository and queue integration, call existing source interfaces only on valid independent item processing, retain retry IDs and per-item states. Re-run test; expect pass.
- [ ] S4.3 **Red→green:** `AC-DSR-007` interrupted photo upload retains blob and retry state until link confirmed; `AC-DSR-009` tests storage-full and missing-cached-choice results, never success. Add the #1520 adapters and error mapping; run same Vitest file, expect pass.
- [ ] S4.4 **Red→green:** hook test asserts org-scoped keys and invalidation; policy test asserts view/create visibility by existing built-in policy and assignment, with no source authority implied. Run `cd pmo-portal && npx vitest run src/hooks/useDailySiteReports.test.tsx src/auth/policy.test.ts`; expect pass. Run local gates, commit.

### S5 — phone screen and recovery

**Files:** create `pmo-portal/pages/DailySiteReports.tsx`, `pmo-portal/pages/DailySiteReports.test.tsx`; modify `pmo-portal/App.tsx`, relevant navigation, `pmo-portal/public/locales/en/translation.json`, `pmo-portal/public/locales/id/translation.json` (use existing namespace layout at execution).

- [ ] S5.1 **Red:** RTL tests field capture for project, date, work item, activities, deltas and optional source/photo entries, keyboard labels and pending state; test the `AC-DSR-009` storage/cache message and `AC-DSR-010` unavailable source. Run `cd pmo-portal && npx vitest run pages/DailySiteReports.test.tsx`; expect missing component failure.
- [ ] S5.2 **Green:** build route `/daily-site-reports`, shared controls, source status/links, date filters, bounded next page, explicit pending/failed/synced per item and retry/correct/discard controls. Keep approved/shared record edits online in their own screens. Run RTL test and axe coverage; expect pass.
- [ ] S5.3 Add equal English/Indonesian strings and `can()`-gated affordances. Run touched Vitest, `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 pages/DailySiteReports.tsx pages/DailySiteReports.test.tsx src/hooks/useDailySiteReports.ts src/lib/db/dailySiteReports.ts src/lib/repositories/dailySiteReports.ts src/auth/policy.ts`. Run `scripts/ux-proof.sh /daily-site-reports` under the shared lock and review loading, empty, error, offline, pending, Needs fixing and success at phone/desktop; one review and one fix. Commit.

### S6 — real offline journey

**Files:** create `pmo-portal/e2e/AC-DSR-001-daily-site-report.spec.ts`. Read `docs/e2e-parallel-conventions.md`; use its isolation tag and real dependencies, no CI-env skip.

- [ ] S6.1 **Red:** with real signed-in field user and pre-cached assigned project/work item, go offline, capture report and photo, reload, reconnect, and assert both linked report and photo available; a deliberately invalid item appears in Needs fixing with its reason. Run `scripts/e2e-local.sh AC-DSR-001` under `scripts/with-db-lock.sh`; expect failure until integrated.
- [ ] S6.2 **Green:** fix integration in owning slice, never weaken the oracle; rerun same command and inspect output. Run touched gates, record output and render proof, commit. Do not run the full browser suite locally.

## AC → owning layer (ADR-0010)

| AC | Owner | File / slice |
|---|---|---|
| AC-DSR-001 | Playwright | `e2e/AC-DSR-001-daily-site-report.spec.ts` S6 |
| AC-DSR-002 | pgTAP | `daily_site_reports.test.sql` S1 |
| AC-DSR-003 | pgTAP | `daily_site_reports.test.sql` S1 |
| AC-DSR-004 | Vitest | `dailySiteReportQueue.test.ts` S4 |
| AC-DSR-005 | pgTAP | `daily_site_report_sources.test.sql` S2 |
| AC-DSR-006 | pgTAP | `daily_site_reports.test.sql` S1 |
| AC-DSR-007 | Vitest | `dailySiteReportQueue.test.ts` S4 |
| AC-DSR-008 | pgTAP | `daily_site_reports.test.sql` S1 |
| AC-DSR-009 | Vitest/RTL | `DailySiteReports.test.tsx` S5 |
| AC-DSR-010 | pgTAP | `daily_site_report_sources.test.sql` S2 |
| AC-DSR-011 | Vitest | `dailySiteReportQueue.test.ts` S4 |
| AC-DSR-012 | pgTAP | `daily_site_report_sources.test.sql` S2 |

Cross-layer references support, but do not replace, the single owner per AC. If #1520's actual interface requires a different boundary, update the plan and tests before building; acceptance is unchanged.
