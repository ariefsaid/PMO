# Daily Safety Records Implementation Plan (#2596)

> Fresh Orca worker per slice. Spec: `docs/specs/daily-safety-records.spec.md`. Approved for the 15 December 2026 release (OD-SCOPE-12); OD-DSF defaults taken; owner layout sketch-glance is directional only. Not a money path; the summary is read-only. Builds on `daily_site_reports` (1040) and its supersede pattern, `attendance_days`/`attendance_photos`/`work_order_roster` and the `attendance-photos` bucket (1036), `incident_reports` (0001, 1026), `record_history_config` (0260), `org_current_month` (0245).

## Migrations (assigned range 1410-1414; each has `supabase/migrations/rollback/<n>_<slug>_down.sql`)
Additive only. Contents of the design below are split as follows.
- **1410_safety_settings_and_lost_time:** org setting `safety_records_enabled` (default false); org lists `safety_check_types`, `safety_permit_types`, `safety_checklist_items` (org_id stamped, RLS: read active members, write Admin only, soft-archive, empty by default; AC-DSF-017); `incident_reports.lost_time` + extended `guard_incident_issue_fields()` + history registry for it.
- **1411_safety_days_tables:** `safety_days` and the part tables (fitness checks, toolbox talks/attendees/photos, checklist answers, permits, safety officer entries), RLS per OD-DSF-6/015, guard trigger (Issued work order, roster, permit order, lock immutability).
- **1412_safety_day_rpcs:** `submit_safety_day`, `correct_safety_day`, "worked without a safety record" list function.
- **1413_safety_photos_storage_history:** private bucket `safety-photos` and its policies; `record_history_config` registration, triggers and `record_history_visible` arms.
- **1414_safety_summary:** `get_safety_summary` (security invoker, stable, one jsonb).
Isolation-probe fragments: `scripts/isolation-probe-denominator.d/2596-<slug>.json` for new org_id tables and definer functions.

### Design detail (carried from the Review 20 Nov plan)
One migration, additive (plus one column on `incident_reports`).
- Tables (each: `org_id` default via `coalesce(public.auth_org_id(), ...)`, `stamp_org_id` trigger, RLS on): `safety_days` (project_id derived from the work order, work_order_id, work_date, status check in `draft|locked`, version, supersedes_id unique references itself, correction_reason, author_id, submitted_at, archived_at; unique index one original per `(work_order_id, work_date)` where `supersedes_id is null and archived_at is null`, as `daily_site_reports_one_per_day`), `safety_fitness_checks` (day, worker_id references people or visitor_name, result, note), `safety_toolbox_talks` (day, topic, presenter, held_at) + `safety_toolbox_attendees` + `safety_toolbox_photos` (file_path), `safety_checklist_items` (org list: label, position, archived_at) + `safety_day_checklist_answers` (day, item label copy, answer, note), `safety_permits` (day, number, type, valid_from, valid_to, issued_by, status), `safety_officer_entries` (day, author_id, body <= 4000, near_misses, observations, incident_id references incident_reports; append-only).
- Guard trigger (security definer, `set search_path = public, pg_temp`): work order is `Issued` and on the row's own org; roster membership for attendees and fitness workers using the `members` returned by the shipped `work_order_roster(p_work_order_id uuid, p_date date)` (redefined by 1036); permit validity order; locked rows immutable except a new `safety_officer_entries` row.
- RPCs: `submit_safety_day(day)` (sets status to `locked`; author only), `correct_safety_day(day, reason)` (creates version n+1 with copies), `get_safety_summary(p_project uuid default null, p_month date default null)` `security invoker`, `stable`, returns one jsonb; every figure from the listed rows; as-of month from `org_current_month`; refuses non-members with `42501`.
- `alter table public.incident_reports add column lost_time boolean not null default false` (OD-DSF-3). Extend `guard_incident_issue_fields()` so only the existing manager roles (Admin, Executive, Finance, Project Manager) may set or change the marker; an assignee cannot change it. Register `lost_time` as a captured boolean in the existing `record_history_config` row for `incident_reports`. Preserve the existing table-level UPDATE grant and enforce this role distinction in the server guard, which already separates managers from assignees.
- RLS: write = Admin, Engineer, or the project's Project Manager via `(select helper())`; read per OD-DSF-6 (a second policy for the person and photo tables).
- Storage: private bucket `safety-photos` (png, jpeg, webp; 10 MB), policies keyed on the row's org, same shape as `attendance-photos` (1036).
- Record history: register all new safety tables in `record_history_config`, attach their `*_zz_record_change` triggers, add their entity arms to `record_history_visible`, and keep the history catalog gate green. Update the existing `incident_reports` registry entry to capture `lost_time` as a boolean.
- **Rollback:** `supabase/migrations/rollback/<number>_daily_safety_records_down.sql` drops functions, policies, tables, the column and the bucket in reverse order.
- ADR: none expected; if OD-DSF-2 becomes a hard gate on validation, record it as an ADR amending the daily site report's validation rules.

## Slice 1: pure derivation (Orca)
- [ ] Write first `pmo-portal/src/lib/safetyDay.test.ts` (AC-DSF-008, a supporting view test for the hidden-figure display in AC-DSF-012, and AC-DSF-014 export shape) then `pmo-portal/src/lib/safetyDay.ts`: `deriveSafetyDayStatus(day, attendance)` returns complete or the missing parts; `deriveSafetySummaryView(summary)` hides uncomputable figures with a reason. Integer minutes for hours; no float arithmetic. Verify: `cd pmo-portal && npx vitest run src/lib/safetyDay.test.ts`.

## Slice 2: database (Orca)
- [ ] pgTAP `supabase/tests/safety_days.test.sql`: AC-DSF-001..007, 009..013 (fixtures: Issued, Draft and Closed work orders; roster; Engineer, Viewer, another Project Manager, safety officer stand-in; organisation B; month-end in a UTC+7 organisation; a lost-time incident; a rostered work order with no locked or approved attendance rows). Chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/safety_days.test.sql'`.
- [ ] Migration as above. Mutation check (spec): remove the lock trigger, the roster check, the storage organisation test; each AC goes red; restore.
- [ ] `pmo-portal/src/lib/db/safetyDays.ts` (typed reads/writes; every figure validated, never defaulted to 0), `pmo-portal/src/lib/repositories/safetyDays.ts` (ADR-0017), `pmo-portal/src/hooks/useSafetyDays.ts`, regenerate `pmo-portal/src/lib/supabase/database.types.ts`. Unit tests with a mocked client.
- [ ] `pmo-portal/src/auth/policy.ts`: `safetyDay` actions (UX only).

## Slice 3: capture form (ui-implementer; `restructure` skill and `docs/ux/screen-rules.md`)
- [ ] Owner sketch-glance first (directional layout only).
- [ ] `pmo-portal/pages/work-order-detail/SafetySection.tsx` (per-day status, missing parts, "worked without a safety record" list) and `pmo-portal/pages/safetyDays/SafetyDayForm.tsx` (five parts; shared form primitives; phone-width first; photo capture through the existing upload helper used by `pages/siteReports/SiteReportPhotos.tsx`). Wire the section in `pmo-portal/pages/WorkOrderDetail.tsx` next to the other sections. Add the Admin checklist editor `pmo-portal/pages/admin/SafetyLists.tsx` (check types, permit types, checklist items) to the existing `/administration/projects` section in `pmo-portal/pages/Administration.tsx`.
- [ ] Strings: `pmo-portal/public/locales/en/safety.json` and `.../id/safety.json`, registered in the `/work-orders/:id` namespaces in `pmo-portal/App.tsx`.
- [ ] E2E `pmo-portal/e2e/AC-DSF-015-field-safety-day.spec.ts`. Read `docs/e2e-parallel-conventions.md` first and tag the isolation class.

## Slice 4: monthly summary (ui-implementer)
- [ ] `pmo-portal/pages/SafetySummary.tsx`, route `/safety` in `pmo-portal/App.tsx` behind `can('view', 'safetyDay')`: month picker, the counts, drill-down lists, one hidden-figures line, client export view (figures only). E2E `pmo-portal/e2e/AC-DSF-016-safety-summary-drilldown.spec.ts`; `pmo-portal/pages/SafetySummary.test.tsx` supplements the owning E2E journey with behaviour checks.
- [ ] `scripts/ux-proof.sh` on `/safety` and the work-order page.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-DSF-001..007, 009..011, 013, 017 | pgTAP | `supabase/tests/safety_days.test.sql` |
| AC-DSF-008, 014, 018 | Unit | `pmo-portal/src/lib/safetyDay.test.ts` |
| AC-DSF-012 | pgTAP | `supabase/tests/safety_days.test.sql` |
| AC-DSF-015 | E2E | `pmo-portal/e2e/AC-DSF-015-field-safety-day.spec.ts` |
| AC-DSF-016 | E2E | `pmo-portal/e2e/AC-DSF-016-safety-summary-drilldown.spec.ts` |

## Glossary and docs
- [ ] `docs/glossary.md`: safety day, safe hours, lost-time incident.
- [ ] Update the roadmap issue (#1571) and map #2516 in the session the build ships.

## Final gate
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, the touched pgTAP file and e2e journeys (`scripts/e2e-local.sh <fragment>`), `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh` on the touched routes. No full local suite.
