# Issue Tasks and Root Cause Implementation Plan (#2677)

> Builder slice, Sonnet. Spec: `docs/specs/issue-tasks-root-cause.spec.md`. Read first: `supabase/migrations/1026_site_issue_log_columns.sql` (guard body to extend), `1028_site_issue_escalation_and_task.sql` (RPC pattern), `supabase/tests/0979_site_issue_log.test.sql`, `pmo-portal/pages/IncidentDetail.tsx`, `pmo-portal/src/lib/db/incidents.ts`, `pmo-portal/src/lib/repositories/incidents.ts`, the `restructure` skill. Migrations 1390-1392 only.

## Design
A junction table, not a column on `tasks` and not a second reuse of `incident_reports.task_id`: it needs no change to the task guards (`enforce_assignee_status_only` is being rewritten by #2587), allows many tasks per issue, and keeps the legacy column and RPC (and so every existing test) untouched. `incident_tasks` mirrors the full set of an issue's tasks (legacy one backfilled and kept in sync by trigger), so the screen reads one list.

## Migrations (each with `supabase/migrations/rollback/<n>_..._down.sql`)
- **1390_incident_tasks.sql**: table (FR-ITR-001), `revoke all ... from anon, authenticated` then `grant select` to authenticated, RLS select policy mirroring the `incident_reports` read policy with `(select helper())`; org stamp as other tables; index on `(incident_id, created_at)`; backfill from `incident_reports.task_id`; after-update trigger on `incident_reports` (when `task_id` changes to not null) inserting the row `on conflict do nothing`. Fragment `scripts/isolation-probe-denominator.d/2677-incident-tasks.json`.
- **1391_incident_root_cause.sql**: `root_cause text check (char_length <= 1000)`; `create or replace function guard_incident_issue_fields()` copied from 1026/1112's latest body (check `grep -ln guard_incident_issue_fields supabase/migrations`) adding `root_cause` to the assignee's allowed-changes list (manager path unchanged, so manager and assignee may write it; the Engineer reporter is refused by the existing "only a manager may change ..." branch). Rollback restores the previous body.
- **1392_add_task_to_incident.sql**: `add_task_to_incident(uuid, text, uuid, date)` security definer, `search_path = public, pg_temp`, same checks and message style as `create_task_from_incident`, plus Closed refusal, active-member assignee check, 100 cap (technical abuse bound) (lock the issue row `for update` so the count is race-safe), insert task then junction row; revoke from `public, anon`, grant `authenticated`. Fragment for the definer function.

## Slice 1: pgTAP first (red, then migrations)
`supabase/tests/1390_issue_tasks_root_cause.test.sql`: AC-ITR-001..007. Run chained:
`flock /tmp/db.lock bash -c 'npx -y supabase@2.122.1 db reset && npx -y supabase@2.122.1 test db supabase/tests/1390_issue_tasks_root_cause.test.sql supabase/tests/0979_site_issue_log.test.sql supabase/tests/0178_* supabase/tests/0646_rls_initplan.test.sql'` then `node scripts/check-isolation-denominator.mjs` and `--self-test`.
**Mutation checks**: (1) remove the role check in `add_task_to_incident`: AC-ITR-002 red; (2) let any role write `root_cause` in the guard: AC-ITR-006 red; (3) grant insert on `incident_tasks` to authenticated: AC-ITR-003 red. Restore each; report the red line.

## Slice 2: data access and policy
- `pmo-portal/src/lib/db/incidents.ts` (+ test): `addTaskToIncident`, `listIncidentTasks(incidentId)` (one query joining `tasks`), `root_cause` in read and update shapes. `pmo-portal/src/lib/repositories/incidents.ts` and its contract/`repositories/index.test.ts` shape. Regenerate `database.types.ts` with the repo's script (not hand-edited if a script exists).
- `pmo-portal/src/auth/policy.ts`: reuse the existing incident-task action if present; else register `createTask` on `incident`. Hook `src/hooks/useIncidentTasks` (react-query; invalidation after add).

## Slice 3: screen (`restructure` skill, DESIGN.md tokens, shared primitives)
- `pmo-portal/pages/IncidentDetail.tsx`: task list section (replaces the single link when more than one; the single-task case renders as today), "Add a task" through `EntityFormModal` (name, assignee, due day), root-cause field with save. Locale files `pmo-portal/public/locales/{en,id}/incidents.json`. Existing `IncidentDetail.test.tsx` stays green untouched; new cases in a new test file.
- Evidence: `docs/evidence/1215/2677/` phone 390 and desktop 1440 screenshots, committed.
- E2E: `pmo-portal/e2e/AC-ITR-011-issue-several-tasks-root-cause.spec.ts` (tag per `docs/e2e-parallel-conventions.md`).

## Traceability
| AC | Test | Layer |
|---|---|---|
| AC-ITR-001..007 | `supabase/tests/1390_issue_tasks_root_cause.test.sql` | pgTAP |
| AC-ITR-008 | existing `IncidentDetail.test.tsx` and register tests, untouched | Unit |
| AC-ITR-009, 010 | `pmo-portal/pages/IncidentDetail.tasks.test.tsx` | Unit |
| AC-ITR-011 | `pmo-portal/e2e/AC-ITR-011-issue-several-tasks-root-cause.spec.ts` | E2E |

## Glossary
Add to `docs/glossary.md`: **Issue task** (a task linked to an issue; many per issue); **Root cause** (the cause of an issue, recorded apart from the visible problem and the close note).

## Final gate
Per `docs/briefs` common: check:guards, typecheck, eslint on changed files, `vitest related --run`, pgTAP (files above + 0178 + 0646), denominator live and `--self-test`, touched e2e.
