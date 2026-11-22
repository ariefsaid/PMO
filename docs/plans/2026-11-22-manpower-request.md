# Plan: Manpower request (2026-11-22)

Spec: `docs/specs/manpower-request.spec.md`. Test-first throughout; DB is not run by the builder (the wave run does it). Migrations 1740-1742, rollbacks in `supabase/migrations/rollback/`.

## Tasks (each 2-5 min units grouped)
1. **pgTAP first** `supabase/tests/1740_manpower_request.test.sql` (AC-MPR-001..011), red.
2. **1740_manpower_requests.sql**: tables `manpower_requests`, `manpower_request_needs`, `manpower_assignments`; code trigger `MP-NNNN` (copy the `people_assign_code` advisory-lock shape, `1042`); org stamp triggers; RLS + FORCE, select for active members, no write grants; view `manpower_need_progress` (security_barrier). Rollback `rollback/1740_manpower_requests_down.sql`.
3. **1741_manpower_request_rpcs.sql**: `mpr_submit(project, needed_by, note, needs jsonb)`, `mpr_approve`, `mpr_reject(id, reason)`, `mpr_cancel`, `mpr_assign(need, person)`, `mpr_release(assignment)`. One shared `mpr_assert_approver` (copy of `qcr_assert_approver` shape, `1177:19`). Row lock on the request/need before count checks. `log_audit` and `notify_workflow_user` calls. Rollback down file.
4. **1742_manpower_waiting.sql**: `my_waiting_manpower_requests()` (pending, decidable by me, not mine) and `my_manpower_to_fill()` (approved, open > 0, for people managers). Derived on read, stable, security definer. Rollback down file.
5. **Types**: hand-edit `pmo-portal/src/lib/database.types.ts` for the tables, view, functions; `check-typed-dals` stays zero.
6. **DAL + repository** `pmo-portal/src/lib/db/manpowerRequests.ts`, `pmo-portal/src/lib/repositories/manpowerRequests.ts`; hooks `pmo-portal/src/hooks/useManpowerRequests.ts` (query root, invalidation on every mutation). Unit tests with the real mapping of progress (asked/filled/open/met).
7. **Policy** `pmo-portal/src/auth/policy.ts`: `manpower_request` create (any active full member), approve (Admin, Executive, PM and not requester), assign (Admin, PM). UX only; tests in the policy test file.
8. **Needs-you**: add `waitingManpower` and `manpowerToFill` facts + items in `useNeedsYou.ts` / `buildNeedsItems` (pointer to `/manpower`); unit tests extend `useNeedsYou.test.ts`.
9. **Refusals**: `pmo-portal/src/lib/refusals.ts` plus locale files, codes in FR-MPR-011, en + id; unit test AC-MPR-013.
10. **Page** `pmo-portal/pages/Manpower.tsx` + `pmo-portal/src/components/manpower/*` (list, request form via `EntityFormModal`/`FormGrid`/`Combobox` for discipline, `ConfirmDialog` for cancel/reject, progress bar per need, assign drawer using `people_directory`), route in `pmo-portal/App.tsx`, nav entry, en + id strings, `restructure` skill, DESIGN.md tokens, 390 px and 1440 px. RTL tests AC-MPR-012.
11. **Glossary**: `docs/glossary.md` terms Manpower request, Need, Filled/Open, Met (EN, Bahasa).
12. **E2E** `pmo-portal/e2e/AC-MPR-014-manpower-request-journey.spec.ts` per `docs/e2e-parallel-conventions.md`; written, not run.
13. **Gates**: `npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run` on changed sources, `npm run check:restated-functions`.

## Traceability
AC-MPR-001..011 pgTAP (task 1; AC-MPR-011 also task 8) · AC-MPR-012 task 10 · AC-MPR-013 task 9 · AC-MPR-014 task 12.

## Rollbacks
1742 down drops the two functions; 1741 down drops the six RPCs and the assert function; 1740 down drops the view, then tables in reverse order. Reverse order 1742, 1741, 1740.

## Risks
- Double-fill race: lock the need row `for update` before counting live assignments.
- Existing tests reversed: none.
- A restated function: none (all new objects).
