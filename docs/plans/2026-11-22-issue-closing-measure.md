# Plan: issue-closing-measure
Spec: `docs/specs/issue-closing-measure.spec.md`. Size S. Test-first; owner approval of the spec before any build. Migrations 1820-1829, each with `supabase/migrations/rollback/<n>_<name>_down.sql`.

## Database
1. `supabase/migrations/1820_incident_types.sql` (+ `rollback/1820_incident_types_down.sql`): table `incident_types` modelled on `0950_cost_disciplines.sql` (policies with `(select helper())`, `stamp_org_id` trigger, column-scoped grants: insert (label), update (label, archived_at)); unique live label index; new-organisation trigger that adds the single entry "Other" (modelled on `dsr_seed_default_lists`, 1041:424-440; no coded type names); isolation-probe fragment `scripts/isolation-probe-denominator.d/1820-incident-types.json` plus fixtures in `scripts/isolation-fixtures.sql` (find the pattern by `scripts/prior-art.sh`).
2. `supabase/migrations/1821_incident_type_id.sql` (+ rollback): add `incident_reports.type_id`; backfill per FR-ICM-007 (idempotent `insert ... on conflict do nothing`, most-frequent spelling); before insert/update trigger resolving the type (FR-ICM-003) added into the existing guard ordering. `guard_incident_issue_fields` is NOT restated unless needed: use a separate trigger named so it fires before `incident_reports_zz_issue_guard`. Rename propagation trigger on `incident_types` (FR-ICM-004), updating `issue_department_groups.issue_types` too. Any restated function body is taken from the latest migration defining it (stated in the file); `npm run check:restated-functions`.
3. `supabase/migrations/1822_closing_report_by_type_list.sql` (+ rollback; the rollback restores the 1424 body): restates `get_issue_closing_time_report` from `1424_issue_closing_report.sql:96-220` (latest definition; orchestrator verifies with `pg_get_functiondef`), joining `incident_types` for the label.
4. `supabase/migrations/1823_work_order_effective_hours.sql` (+ rollback): new `get_work_order_effective_hours` (security invoker, stable; revoke from public, anon).
5. Update `pmo-portal/src/lib/supabase/database.types.ts` by hand: `incident_types` table, `incident_reports.type_id`, the new function (mirror the generated style).

## pgTAP (written, not run; orchestrator runs)
`supabase/tests/1820_incident_types.test.sql` (AC-ICM-001..005), `supabase/tests/1822_closing_report_types.test.sql` (AC-ICM-006), `supabase/tests/1823_effective_hours.test.sql` (AC-ICM-007..009). Mutation checks: delete the list-membership check in the 1821 trigger, AC-ICM-002 must go red; change `greatest(.., 0)` or the `status = 'validated'` filter in 1823, AC-ICM-008 must go red; drop the Admin check in the 1820 insert policy, AC-ICM-005 must go red.

## Front end (`pmo-portal/`)
- DAL `src/lib/db/incidentTypes.ts` and `src/lib/db/workOrderEffectiveHours.ts` (typed, no casts), repositories `src/lib/repositories/incidentTypes.ts`, `workOrderEffectiveHours.ts` (+ contracts, `types.ts`), hooks in `src/hooks/`. Unit tests next to each (AC-ICM-010..012).
- Admin card `pages/admin/OrgIssueTypes.tsx` (+ test), wired where `IssueClosingReportSettings` is mounted (`App.tsx`/the admin hub registry, found at build); shared primitives, `ConfirmDialog` for archive.
- `components/IncidentFormModal.tsx:251-259`: `TextField` becomes `SelectField`/`Combobox` over live types; `type` sent as the label, `type_id` resolved by the database from the label (no org_id or id logic in the client beyond the picked option).
- `pages/incidents/ClosingTimeReport.tsx`: add the `EffectiveHoursPanel` (new file `pages/incidents/EffectiveHoursPanel.tsx`) beside the table; work-order picker reuses the existing work-order Combobox.
- `src/lib/refusals.ts` and locale files: `ICM_TYPE_NOT_IN_LIST` and the range-cap refusal, English + Bahasa Indonesia; i18n keys for the card, form, panel (en + id); `npm run check:i18n`.
- Glossary: add "Issue type" and "Effective working hours" to `docs/glossary.md`.

## E2E (written for the orchestrator)
`pmo-portal/e2e/AC-ICM-013-issue-closing-measure.spec.ts`, following `docs/e2e-parallel-conventions.md` (isolation class and tag).

## Gates (builder)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed sources>` plus touched tests, `npm run check:restated-functions`.

## Screenshots to capture (orchestrator)
`/incidents` closing report with the effective-hours panel (empty, populated, times-not-entered), Admin issue-types card, issue form picker (empty and filled), phone 390 px and desktop 1440 px, English and Bahasa Indonesia.

## As built
Migrations 1820-1823 as above; the isolation fragment is `scripts/isolation-probe-denominator.d/1820-incident-types.json` (no fixture row needed: every organisation has "Other"). pgTAP: `1820_incident_types`, `1822_closing_report_types`, `1823_effective_hours`. E2E: `pmo-portal/e2e/serial/AC-ICM-013-issue-closing-measure.spec.ts` (serial: it enables the org's report setting and restores it). Existing tests whose steps changed are named in the spec, section 5.
