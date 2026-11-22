# Plan: people import update (people-import-update)

Spec: `docs/specs/people-import-update.spec.md`. No migration (range 1765-1767 unused). No rollback needed. Test-first for every task; each task = red, green, refactor.

## Tasks

1. **Types** (`pmo-portal/src/lib/import/types.ts`): add optional `matchExisting` on `ImportDescriptor` and `action`/`changes` on `RowValidation`. Test: `pmo-portal/src/lib/import/__tests__/validateRows.matchExisting.test.ts` (AC-PIU-001,004,005,006,007; AC-PIU-012 by leaving existing validateRows tests unchanged). Extend `validateRows.ts` to classify new/update/same from the loaded map.
2. **DAL + repository** (`pmo-portal/src/lib/db/people.ts`, `src/lib/repositories/people.ts`, `contracts/people.ts`): `updatePersonFields(id, {name?, job_title?})` sending only provided keys. Test in `src/lib/db/__tests__/people.updateFields.test.ts` asserts the exact payload never holds `code`/`profile_id`/`manager_id` and that a blank is omitted (AC-PIU-002,004). Uses `assertWriteLanded`.
3. **Wizard** (`useImportWizard.ts`, `ImportWizard.tsx`): load the map on preview (retry on failure, confirm disabled: AC-PIU-010), counts New/Update/No change/Invalid, status pills with text, change lines "Field: old to new", button wording, commit calls `update` for update rows, result counts. Tests: `src/components/import/__tests__/matchExisting.wizard.test.tsx` (AC-PIU-001,002,003,005,010) and a locale test (AC-PIU-011). Phone-card rendering reuses the existing card with the change lines.
4. **People descriptor** (`employeeDescriptor.ts`): add optional Job title field (template version 2; the importer still accepts version 1 files per the existing previous-version rule), `matchExisting` wired to `repositories.people.list()` (live only) and `updatePersonFields`; remove `existingKeys` for people. Test: extend `fieldDataDescriptors.test.ts` and a new `employeeDescriptor.update.test.ts`.
5. **Refusals + strings**: add the refusal sentence ("only an Admin or Project Manager can change people; ask one to run this import") in EN and ID to `src/lib/refusals.ts` and its locale files, plus `import:` namespace strings (statuses, change line, button, template headers/notes) in both locales. Test: locale parity test already in repo plus AC-PIU-011.
6. **pgTAP** `supabase/tests/people_update_roles.test.sql`: proof of the existing RLS (AC-PIU-009): Admin and Project Manager update name and job_title; Finance, Executive and Member get zero rows; `code` unchanged by the import payload shape is a DAL test, not SQL. Left for the wave run.
7. **e2e** `pmo-portal/e2e/AC-PIU-002-people-import-update.spec.ts` (follow `docs/e2e-parallel-conventions.md`, unique codes per run): upload file with one existing, one new, one unchanged row; preview counts and change line; confirm; register shows the new name and the added person; re-import shows all No change; a person absent from the file remains (AC-PIU-002,003,005,008).
8. **Docs**: glossary entry, FR-IMT-012 pointer in the field-data spec to this spec, `docs/product-expectations.md` untouched.

## Traceability

| AC | Owning layer / file |
|---|---|
| 001, 004, 005, 006, 007 | unit `validateRows.matchExisting.test.ts` |
| 002 | e2e `AC-PIU-002-...` + unit DAL payload |
| 003, 008 | e2e |
| 009 | pgTAP `people_update_roles.test.sql` + unit refusing fake |
| 010 | unit wizard |
| 011 | unit locale |
| 012 | existing descriptor/wizard tests, unchanged |

## Gates (in pmo-portal/)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>` plus touched tests. Mutation checks per the spec.

## Steering addendum (2026-11-22): manager column and person document import

- The role-capabilities branch is NOT merged into this lane (it lands on its own). The document import gate is the base's `can('create','expiryDocument',{record:{kind:'person',medical:false}})`, which follows that rule when it lands. This item adds no migration (1765-1767 unused).
- Task 9 (done): people descriptor gains Job title and Manager email (`src/lib/import/employeeDescriptor.ts`); DAL `createPerson`/`updatePersonFields` take `manager_id`; `PersonListRow.manager_id`; People page loads active profiles for the manager lookup.
- Task 10 (done): `src/lib/import/personDocumentDescriptor.ts`, DAL `listPersonDocuments` plus repository seam, `pages/admin/PersonDocumentImport.tsx` (gated by `can('create','expiryDocument',{record:{kind:'person',medical:false}})`, via a new optional `permissionCtx` on `ImportButton`).
- Tests: `people.updateFields.test.ts`, `matchExisting.test.ts`, `matchExisting.wizard.test.tsx`, `peopleImportUpdate.test.ts`, `personDocumentDescriptor.test.ts`, `peopleImportUpdate.wizard.test.tsx`, `PersonDocumentImport.test.tsx`.
- pgTAP: no new database rule. People-document write access is owned by the database policies and the role-capabilities work's own tests. Task 6's people update role proof stays.
- No client-callable SECURITY DEFINER function is added, so no anon-definer inventory file.
- Mutation checks (to run in the wave): blank cell writes null; `changes` always reports; update payload carries `code`; medical type allowed; gate widened to every role. Each must turn a named test red.
