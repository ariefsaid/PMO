# Followed crew implementation plan

Spec: `docs/specs/crew-followed.spec.md`. One builder, test first. Money-adjacent (attendance feeds cost): the DB rule is mutation-checked. No setting.

## Migrations (range 1768 to 1769; rollbacks in `supabase/migrations/rollback/`)
- `1768_attendance_followed_crew.sql`: `alter table attendance_days add column followed_crew_id uuid references crews(id)`; check `followed_crew_id is null or followed_crew_id = crew_id`; partial unique index `(worker_id, work_date) where followed_crew_id is not null` (one follow per person-day, which also stops two work orders disagreeing). Helper `worker_followed_crew(worker, date)` security definer (returns only the crew id, org-checked, so the home foreman's roster read also drops the worker though RLS hides the row); `revoke ... from public, anon`; grant authenticated. Restate `worker_effective_crew` (take body from `pg_get_functiondef` at head, 1246): loan host crew, else followed crew, else placement. Restate `work_order_roster` (head body, 1247): add a union arm for followed rows into rostered crews, flagged `"followed": true` (no standard role), and keep the existing `worker_effective_crew = crew` filter. Column grant for the table stays RPC-only (no direct insert grant on the new column).
- `1769_attendance_record_followed.sql`: restate `attendance_record` whole from head (1465 body via `pg_get_functiondef`). Only change: per row read optional `followed_crew_id` in the `jsonb_to_recordset`; when present run FR-FOL-001/002/005 checks (source not phone, crew rostered on this WO that day and live and different from effective crew, worker placed that day, no loan to another crew), set `v_crew := followed`, and write `followed_crew_id` on insert/update; authority stays `attendance_can_record(v_crew)`. ACL statements unchanged. `npm run check:restated-functions` must pass.
- Rollbacks `rollback/1768_*_down.sql` and `1769_*_down.sql`: restore the 1246/1247/1465 bodies, drop helper, index, check, column (header notes followed marks are lost).

## Tests (written first)
- pgTAP `supabase/tests/1768_crew_followed.test.sql`: AC-FOL-001 to 006 (fixtures modelled on `supabase/tests/1245_crew_loans.test.sql`; foremen of A and B, second org). Existing `1245_crew_loans`, `attendance_days`, `1465_attendance_phone_path`, `crews_roster` run untouched (AC-FOL-007); gate files `0178_anon_executable_definers`, `0646_rls_initplan`; isolation denominator fragment for the new definer.
- Mutation checks (quote red then green): (1) `attendance_can_record(v_crew)` replaced by `true` on the followed branch, AC-003 red; (2) resolver ignores followed rows, AC-002 red; (3) drop the loan-conflict check, AC-005 red.
- Unit: `pmo-portal/pages/crews/AttendanceTick.test.tsx` (AC-008), `src/lib/db/attendance.test.ts` (followed field passes through, typed), refusals i18n parity (AC-009).
- E2E (written, run in the wave): `pmo-portal/e2e/AC-FOL-010-followed-crew.spec.ts` per `docs/e2e-parallel-conventions.md`.

## Front end
`pmo-portal/src/lib/db/attendance.ts` row type + `buildTickRows` gain optional `followed_crew_id`; `AttendanceTick.tsx` gets an "Add someone from another crew" control (shared `Combobox`, gated by the existing tick permission, disabled-with-reason when none placed elsewhere) and a "followed from <crew>" tag on roster rows carrying `followed`; `src/lib/supabase/database.types.ts` hand-edited (column, roster JSON, RPC rows) with no casts; refusal sentences in `public/locales/{en,id}/refusals.json` and the `crewErrors.ts` mapping; glossary term "Followed crew" in `docs/glossary.md`; pointer line in the roster spec. `restructure` skill and `docs/ux/screen-rules.md` read first; 390px and 1440px.

## Gates
`npm run check:guards`, `npm run typecheck`, eslint on touched files, `vitest related` + touched tests; no DB run by the builder (orchestrator's wave run).
