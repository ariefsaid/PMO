# Plan: expiry-to-manager (spec docs/specs/expiry-to-manager.spec.md)

Migrations (range 1760-1764): 1760 and 1761. Restate functions from the database at head (`pg_get_functiondef`); `npm run check:restated-functions` must pass.

## Tasks
1. **1760_document_type_notify_manager.sql** (+ `rollback/1760_document_type_notify_manager_down.sql`)
   - `alter table document_types add column notify_manager boolean not null default true`.
   - `alter table document_types alter column notify_roles drop default` (NOT NULL stays; the BEFORE INSERT trigger runs before the check).
   - Restate `document_types_defaults()`: apply role defaults only when `new.notify_roles is null`.
   - Restate `run_document_expiry_warnings(date)`: recipient test becomes `(d.notify_manager and p.id = d.manager_id) or p.role::text = any(d.notify_roles)` (select `t.notify_manager`).
   - Column grants: add `notify_manager` to the insert/update grants on `document_types` (mirror the existing `notify_roles` grant).
   - Rollback: restore previous function bodies, default `'{}'`, drop column.
   - Test (write first): `supabase/tests/document_expiry_manager.test.sql` for AC-EXM-001/002/003.
2. **1761_expiry_renewal_notice.sql** (+ rollback): AFTER UPDATE OF expires_on trigger on `expiry_documents` (security definer, org-checked) that, when `new.expires_on > old.expires_on` and the subject is a person with an active linked profile, calls `notify_workflow_user`; medical types send title only with the date. Test: `supabase/tests/document_expiry_renewal.test.sql` (AC-EXM-004), including negative cases and a mutation check (flip `>` to `<`, test must go red).
3. **Types + DAL**: `pmo-portal/src/lib/supabase/database.types.ts` (hand edit), `pmo-portal/src/lib/db/documentExpiry.ts` and its repository: carry `notify_manager`. Vitest in `documentExpiry.admin.test.ts` / `repositories/documentExpiry.admin.test.ts`.
4. **UI**: `pmo-portal/pages/admin/DocumentTypes.tsx` manager checkbox (default on), roles column lists "Direct manager", explicit "no one is warned" text; EN + ID locale strings. Test: `DocumentTypes.test.tsx` (AC-EXM-005).
5. **e2e**: extend `pmo-portal/e2e/JOB-F14-expiry-warning-recipients.spec.ts` with a second test (manager box off -> manager not warned) following docs/e2e-parallel-conventions.md; left for the wave run.
6. **Docs**: update FR-DEX-003 and the HR/recipients line in `docs/specs/document-expiry.spec.md`; add "direct manager" to `docs/glossary.md`.

## Traceability
AC-EXM-001/002/003 pgTAP (1); AC-EXM-004 pgTAP (2); AC-EXM-005 Vitest (4) + e2e (5).

## Mutation check plan
Make the recipient clause `true` for manager (ignore `notify_manager`): AC-EXM-002 red. Flip the renewal comparison: AC-EXM-004 red.

## Gates
`npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run` on changed files. No DB run (wave run does pgTAP/e2e).
