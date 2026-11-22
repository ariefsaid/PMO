# Plan: Manpower need (2026-11-22, simplified)

Spec: `docs/specs/manpower-request.spec.md`. Test-first; the builder does not run a database (the wave run does). Migrations 1740-1741 (range 1740-1749), rollbacks in `supabase/migrations/rollback/`.

## Tasks
1. pgTAP first `supabase/tests/1740_manpower_need.test.sql` (AC-MPN-001..007), red.
2. `1740_manpower_needs.sql`: tables `manpower_needs`, `manpower_need_people`; `manpower_can_manage()` (`crew_can_manage()` or HR capability); guard triggers (same org, live refs, work order of the need's project, link cap with a row lock on the need, closed-need refusal, head count not below links); RLS + FORCE, select for active members, insert/update/delete for `manpower_can_manage()`, column grants. Rollback `1740_manpower_needs_down.sql`.
2b. `1741_manpower_need_progress.sql`: `manpower_need_progress()` security invoker joining `person_clearance_summary()`. Rollback `1741_manpower_need_progress_down.sql`.
3. Types by hand in `pmo-portal/src/lib/database.types.ts`; DAL `pmo-portal/src/lib/db/manpowerNeeds.ts`; repository `pmo-portal/src/lib/repositories/manpowerNeeds.ts`; hook `pmo-portal/src/hooks/useManpowerNeeds.ts`.
4. `can()` entry `manpowerNeed` in `pmo-portal/src/auth/policy.ts` (UX only): create/edit/link for Admin, Executive, Project Manager; HR capability via the built-in role mirror (`roleHasCapability`).
5. Refusals in `pmo-portal/public/locales/{en,id}/refusals.json`; page strings in a `manpower` namespace (en, id).
6. Page `pmo-portal/pages/Manpower.tsx` + components under `pmo-portal/src/components/manpower/`, route and nav, `restructure` skill, shared form primitives, DESIGN.md tokens; RTL tests AC-MPN-008; i18n test AC-MPN-009.
7. Glossary: Manpower need, Filled, In progress, Open.
8. E2E journey AC-MPN-010 (written, not run).
9. Gates: `check:guards`, `typecheck`, eslint on changed files, `vitest related`.

## Rollbacks
Reverse order: 1741 (drop function), 1740 (drop link table, need table, helper, triggers/functions).
