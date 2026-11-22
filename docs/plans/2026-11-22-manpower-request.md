# Plan: Manpower need (2026-11-22)

Spec: `docs/specs/manpower-request.spec.md`. Built test-first; the builder does not run a database (the wave run does). Migrations 1740 to 1742 (range 1740-1749), rollbacks in `supabase/migrations/rollback/`.

## Built
1. `supabase/migrations/1740_manpower_needs.sql`: tables `manpower_needs`, `manpower_need_people`; `manpower_can_manage()` (`crew_can_manage()` or the HR capability); guard triggers (live same-org references, work order of the need's project, link cap with a row lock, closed-need refusal, head count not below links); RLS + FORCE, select for active members, writes for `manpower_can_manage()`, column grants. Rollback `1740_manpower_needs_down.sql`.
2. `supabase/migrations/1741_manpower_need_progress.sql`: `manpower_need_progress()` security definer, counts only, joining `person_clearance_summary()`, scoped to callers who can read the need. Rollback `1741_manpower_need_progress_down.sql`.
3. `supabase/migrations/1742_manpower_need_notices.sql`: `my_manpower_to_fill()` and the outcome notice trigger. Rollback `1742_manpower_need_notices_down.sql`.
4. `supabase/tests/1740_manpower_need.test.sql` (AC-MPN-001 to 007, 010, 011) and the anon-definer inventory fragment `supabase/tests/inventory/anon-executable-definers/manpower-request.txt`.
5. Types by hand in `pmo-portal/src/lib/supabase/database.types.ts`; DAL `pmo-portal/src/lib/db/manpowerNeeds.ts`; contract and repository `pmo-portal/src/lib/repositories/{contracts/,}manpowerNeeds.ts`; hooks `pmo-portal/src/hooks/useManpowerNeeds.ts`.
6. No `can()` entry: the screen asks the database (`manpower_can_manage()` through the repository) so the authority is defined once.
7. Needs-you pointer: `pmo-portal/src/lib/waitingManpower.ts`, the `waitingManpower` fact and item in `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts`, strings in `pmo-portal/public/locales/{en,id}/dashboard.json`.
8. Manpower tab on the Crews page: `pmo-portal/pages/crews/ManpowerNeeds.tsx`, `ManpowerNeedForm.tsx`, `manpowerErrors.ts`; strings in the `crews` namespace; refusals in `pmo-portal/public/locales/{en,id}/refusals.json`.
9. Glossary entry "Manpower need".
10. E2E `pmo-portal/e2e/AC-MPN-010-manpower-need-journey.spec.ts` (written, not run).

## Owning test per AC
AC-MPN-001..007, 010 pgTAP `1740_manpower_need.test.sql` · AC-MPN-004 also the mutation check · AC-MPN-008 `ManpowerNeeds.test.tsx`, `ManpowerNeedForm.test.tsx` · AC-MPN-009 `check:i18n` · AC-MPN-011 pgTAP plus `src/lib/waitingManpower.test.ts` · AC-MPN-012 the e2e journey. DAL: `src/lib/db/manpowerNeeds.test.ts`.

## Rollbacks
Reverse order: 1742 (trigger, notice function, to-fill function), 1741 (progress function), 1740 (link table, need table, guard functions, `manpower_can_manage`).
