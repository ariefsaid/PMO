# Timed Site Checkpoints Implementation Plan (#2594)

> Fresh Orca worker per slice; the database slice is Director-dispatched (server-stamped evidence, role gates, jobs) with security-auditor. Spec: `docs/specs/site-timed-checkpoints.spec.md`. Ships in the 15 December 2026 release (OD-SCOPE-1); OD-STC-1..8 and OQ-STC-1..2 take the spec's recommended defaults. No light-account entry (OD-SCOPE-4). Not money path. Builds on 1035 (crews roster), 1040 and 1041 (daily site report) and the job shape of 1028.

## Migrations (assigned range 1385-1389; additive; each with a rollback in `supabase/migrations/rollback/`)
- `1385_site_checkpoint_tables.sql`: the two tables, indexes, RLS, the access helper, `set_site_checkpoint_list`, record-history registry rows.
- `1386_site_checkpoint_record.sql`: `site_checkpoint_photo_stored`, `record_site_checkpoint`, the immutability trigger, the `site-checkpoint-photos` bucket and its storage policies.
- `1387_site_checkpoint_jobs.sql`: `materialise_site_checkpoints`, `remind_late_site_checkpoints`, both `cron.schedule` entries.
- `1388_site_checkpoint_reads.sql`: `work_order_checkpoint_flag`, `site_checkpoints_for_day`, `crew_start_punctuality`, `site_lost_time_by_cause` (FR-STC-060).
- `1389`: held in reserve (corrections found in test); unused numbers stay unused.
Content of the numbered files below:
- `site_checkpoint_templates (id, org_id, position smallint 1..12, name text 1..120, kind text check in ('arrival','pre_work','start','after_break','progress','other'), due_time time not null, grace_minutes smallint 0..120 default 0, photo_required boolean default true, unique(org_id, position))` plus a partial unique index on `(org_id) where kind = 'start'`.
- `site_checkpoints (id, org_id, work_order_id references work_orders, crew_id references crews, work_date date, position, name, kind, due_at timestamptz, grace_minutes, photo_required, recorded_at timestamptz, recorded_by uuid references profiles(id), note text <= 500, photo_path text, late_notified_at timestamptz, unique(work_order_id, crew_id, work_date, position), check ((recorded_at is null) = (recorded_by is null)))`; indexes on `(work_order_id, work_date)` and a partial index `(due_at) where recorded_at is null and late_notified_at is null`.
- RLS on both tables: select only through the access rule of FR-STC-050 as one `security definer` helper `site_checkpoint_may_read(p_work_order uuid, p_crew uuid)` called as `(select ...)`; no client write grant; `org_id` stamped by the server.
- `set_site_checkpoint_list(p_items jsonb) returns integer`: Admin only, whole list, validation as in AC-STC-001, audit row (shape of `set_billing_stage_template`).
- `materialise_site_checkpoints() returns integer` (job): for each organisation, local date from `organizations.default_timezone`; for each `Issued` work order with a `work_order_crews` row covering the date, insert the template's rows `on conflict do nothing`, `due_at = (date + due_time) at time zone <tz>`. `security definer`, `revoke all ... from public, anon, authenticated`.
- `record_site_checkpoint(p_checkpoint uuid, p_photo_path text, p_note text) returns void`: member, role gate per FR-STC-020 (crew's `field_controller_id`, or Admin, Engineer, the project's manager), lock the row `for update`, refuse recorded or future-day or non-Issued, require the photo when `photo_required` and verify the object through a new `site_checkpoint_photo_stored(p_path)` helper scoped to `site-checkpoint-photos`. Do not reuse `dsr_photo_stored(text)`: it is hard-coded to `site-report-photos` (1041). Stamp `recorded_at = now()`, `recorded_by = auth.uid()`, audit row. A trigger refuses any later update of the recorded columns.
- `remind_late_site_checkpoints() returns integer` (job): rows with `recorded_at is null`, `late_notified_at is null`, `now() > due_at + grace_minutes * interval '1 minute'`, `work_date` equal to the organisation's local today; `for update skip locked`; stamp; recipient = the crew's `field_controller_id` if an active member, else the project's manager, else active Admins; `notify_workflow_user(org, who, 'Checkpoint is late', <name and crew>, 'warning', 'work_order', work_order_id, <wo label>)`; audit row.
- `work_order_checkpoint_flag(p_work_order uuid, p_date date default null) returns boolean` and `site_checkpoints_for_day(p_work_order uuid, p_date date)` (security invoker reads, the access helper decides).
- `crew_start_punctuality(p_from date, p_to date, p_project uuid default null, p_work_order uuid default null) returns jsonb` (security invoker; one JSON value, bounds 200 crews and 92 days, `truncated` flag; share is a count of days).
- Storage: bucket `site-checkpoint-photos` (private, 10485760 bytes, `image/png`, `image/jpeg`, `image/webp`, `image/heic`) with read and insert policies on `storage.objects` modelled on `storage_objects_site_report_photo_read/write` (1041), the path `<org>/<work order>/<crew>/<date>/<file>` checked against an existing `site_checkpoints` row through `site_checkpoint_may_read`; every helper wrapped `(select ...)`.
- Record history: add `site_checkpoint_template` and `site_checkpoint` registry rows, capture their user-authored fields and omit server stamps, attach `*_zz_record_change` triggers, and add both entity arms to `record_history_visible`; the catalog test must cover both.
- `site_lost_time_by_cause(p_from date, p_to date, p_project uuid default null, p_work_order uuid default null) returns jsonb` (security invoker; sums `dsr_idle_periods.minutes` by `dsr_idle_reasons` over `daily_site_reports` with status `submitted` or `validated` and no later report superseding it; one JSON value with `rows`, `total_minutes`, `report_count`; 92-day bound refused with `22023`; role gate Admin, Executive, Engineer, project manager). Reads existing tables only; no new setting table because the cause list is the shipped `dsr_idle_reasons` (Admin-maintained, `Administration` already edits it).
- Schedule: `cron.schedule('site-checkpoint-materialise', '*/15 * * * *', ...)` and `cron.schedule('site-checkpoint-late', '*/15 * * * *', ...)`; the late job runs after materialise in the same minute list so a new row is never reminded before it exists.
- **Rollback:** `supabase/migrations/rollback/<number>_site_timed_checkpoints_down.sql`: unschedule both jobs, drop the functions, policies, bucket policies and tables; delete the bucket's objects first (a header note says recorded evidence is lost).

## Slice 1: pure rule (Orca)
- [ ] Test first `pmo-portal/src/lib/siteCheckpoints.test.ts` (AC-STC-011), then `pmo-portal/src/lib/siteCheckpoints.ts`: `checkpointState(row, now)` returning `on_time | late | pending | not_started`, and `startedOnTimeShare(days)` by counts. Reuse the org-local date helpers already in `src/lib/` rather than adding a date library.

## Slice 2: database (Director-dispatched Orca worker, Opus)
- [ ] pgTAP `supabase/tests/1385_site_timed_checkpoints.test.sql` (and `1387_...` if split): AC-STC-001..010 and 014. Fixtures follow `supabase/tests/dsr_report.test.sql` and the crews tests (owner-written rows; client checks as `authenticated`); include a UTC+7 organisation, a crew with and without a controller, a Draft and a Closed work order, a second organisation, Admin, Engineer, Finance, Project Manager, a controller.
- [ ] Mutation checks: let a non-controller record (AC-STC-004 red); accept a client-supplied time (AC-STC-004 red); drop the `late_notified_at is null` filter (AC-STC-006 red); count a start recorded after grace as on time (AC-STC-009 red); restore each.
- [ ] Run under `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` as one lock hold. Security-auditor reads the storage policies and the access helper.

## Slice 3: data seam and screens (ui-implementer; `restructure` skill, `docs/ux/screen-rules.md`)
- [ ] `pmo-portal/src/lib/db/siteCheckpoints.ts` (typed calls; validates every field, never defaults a missing one), repository `src/lib/repositories/siteCheckpoints.ts` with a contract in `src/lib/repositories/contracts/`, hook `src/hooks/useSiteCheckpoints.ts`; photo upload through the pattern of `pmo-portal/pages/siteReports/SiteReportPhotos.tsx`; mocked-client tests for error classification.
- [ ] `can()` entries in `pmo-portal/src/auth/policy.ts` (UX only; the database is the authority): record for the controller identities, view for Admin, Executive, Engineer, Project Manager; list edit for Admin.
- [ ] Screens: owner sketch-glance first. `pmo-portal/pages/siteReports/SiteCheckpoints.tsx` (phone-first day list with camera capture and a recorded/late state, used from `SiteReportDetail.tsx`); `pmo-portal/pages/siteReports/CrewPunctuality.tsx` (static route `/site-reports/crews` registered in `pmo-portal/App.tsx` ahead of `/site-reports/:reportId`, with its preload entry and namespace); `pmo-portal/pages/siteReports/LostTimeByCause.tsx` (a section of the `/site-reports/crews` page, same static route, so one route and one preload entry), `pmo-portal/pages/work-order-detail/SiteCheckpointFlag.tsx`, mounted from `pmo-portal/pages/WorkOrderDetail.tsx`; Admin list editor `pmo-portal/pages/admin/SiteCheckpointTemplate.tsx` in the existing `/administration/projects` section (`pmo-portal/pages/Administration.tsx`), using the shared form primitives. RTL `pmo-portal/pages/siteReports/SiteCheckpoints.test.tsx` (AC-STC-012), behaviour only.
- [ ] Strings in `pmo-portal/public/locales/en/siteReport.json` and `.../id/siteReport.json` (or a new `siteCheckpoint` namespace registered where the others are); Bahasa Indonesia confirmed by the owner.
- [ ] E2E `pmo-portal/e2e/AC-STC-013-checkpoint-start-on-time.spec.ts` (job invoked by a test hook, as the issue-log journey does; read `docs/e2e-parallel-conventions.md` and tag isolation class).
- [ ] `scripts/ux-proof.sh` on `/site-reports/:reportId` and `/site-reports/crews`, at phone width.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-STC-001..010, 014 | pgTAP | `supabase/tests/1385_site_timed_checkpoints.test.sql` |
| AC-STC-011 | Unit | `pmo-portal/src/lib/siteCheckpoints.test.ts` |
| AC-STC-012 | RTL | `pmo-portal/pages/siteReports/SiteCheckpoints.test.tsx` |
| AC-STC-013 | E2E | `pmo-portal/e2e/AC-STC-013-checkpoint-start-on-time.spec.ts` |

## Glossary and docs
- [ ] `docs/glossary.md`: Checkpoint, Day checkpoint, Started on time. Add the checkpoint section to `docs/specs/daily-site-report.spec.md`. ADR: none expected.
- [ ] Update the roadmap issue (#1571) in the same session as the build ships.

## Final gate
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, the touched pgTAP file, the touched e2e journey (`scripts/e2e-local.sh <fragment>`), `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh`. No full local suite. Reviewers: spec, code quality, security-auditor.
