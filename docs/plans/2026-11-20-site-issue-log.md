# Plan: issue log for site work (#2521)

Spec: `docs/specs/site-issue-log.spec.md`. Depends on #2517 (work-order same-project rule) and #2531 (tasks carry `work_order_id`; if not yet
merged, the issue-to-task RPC builds the task without the link and a follow-up wires it; record that choice at dispatch).
Executor: Orca worker, Opus for the migration. Migration numbers assigned at dispatch; rollbacks required. Read `0043_incident_project_fk.sql`,
`0017` (reporter stamp), `0002_rls.sql` incident policies, `0237_workflow_notifications.sql`, `0356_erpnext_sweep_every_minute.sql` (cron pattern),
`pages/Incidents.tsx`, `pages/IncidentDetail.tsx`, `src/lib/db/incidents.ts`, `0028_procurement_files.sql`.

## Files
- Migrations: (a) columns + same-project work-order trigger + close stamps + assignee/due rules; (b) `incident_files` + bucket + storage RLS + High/Critical close-proof guard; (c) `escalate_overdue_incidents()` + cron schedule + `escalated_at`; (d) `create_task_from_incident(uuid)` RPC.
- Tests: `supabase/tests/<n>_site_issue_log.test.sql`; extend `incidents.test.ts`, `Incidents.test.tsx`, `IncidentDetail.test.tsx`, bahasa test.
- UI: raise form (camera, assignee `Combobox`, work order `SelectField`, due), detail (photos, close with proof, escalation banner, "Make a task"), register (Overdue filter/badge, assignee column), work-order page section (#2518).
- Locales `incidents.json` en/id; regenerate `database.types.ts`.

## Tasks (TDD)
1. pgTAP red AC-SIL-001/002/003 then migration (a); stamp trigger writes `closed_at/closed_by`, column grants withhold them.
2. pgTAP red AC-SIL-004/005 then migration (b). **Mutation-check AC-SIL-004** (guard always passes → red).
3. pgTAP red AC-SIL-006/007/008 then migration (c): job selects `status <> 'Closed' and due_at < now() and escalated_at is null` per org with the switch on, marks, notifies via `notify_workflow_user`, audits; cron every 15 minutes using the guarded-helper pattern. Test calls the function directly.
4. pgTAP/unit red AC-SIL-009 then migration (d), one transaction, unique `task_id`.
5. DAL + unit tests: AC-SIL-011/012/013; classify new errors.
6. UI per `restructure`: raise form on a phone first; AC-SIL-012; detail and register states (loading, empty, error, overdue).
7. E2E `e2e/AC-SIL-010-raise-issue-with-photo.spec.ts` and `AC-SIL-014-issue-lifecycle.spec.ts` (job triggered through a test-only SQL call in the e2e helper, not a sleep).
8. Locales; glossary entries "Issue (site)", "Escalation".

## Gates and review
CLAUDE.md local final gate; pgTAP touched files under the DB lock; `ux-proof.sh` on `/incidents` and `/incidents/:id` at 375 and 1280. Reviewers: spec, code-quality, security-auditor (reporter vs assignee vs manager, storage, definer job); design-reviewer on rich seed. Batch with #2518/#2531 after review.
