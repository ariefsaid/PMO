# Plan: Import templates for crews and crew members (#2551)

Spec: `docs/specs/crews-import.spec.md`. Test-first throughout. No migration: the existing atomic `create_crew_with_roles` and the membership insert already run under the caller's RLS.

1. **Shared import layer.** Bring the template download, failed-rows download and descriptor `template` field from #2530 into this branch byte-identical (types, importShared, templateFile, failedRowsFile, wizard, parsers, the shared `import:template`/`result`/`existing` strings), so the two branches merge without conflict. Verify: `npx vitest run src/lib/import src/components/import`.
2. **Reads.** Add `listCrewWorkerRefs` (id, name, code) and `listAllStandardRoles`, `listAllCrewMembers` to `src/lib/db/crews.ts`, exposed on `crewRepository`. Verify: `npx vitest run src/lib/db/crews.test.ts`.
3. **Descriptors (red first).** `src/lib/import/__tests__/crewDescriptors.test.ts`, then `crewDescriptor.ts` (`makeCrewImportDescriptor`, `makeCrewMemberImportDescriptor`), exported from `src/lib/import/index.ts`. Verify: that test file.
4. **Gate + mount.** `crew` gains `create` in `src/auth/policy.ts` (same roles as `manage`); `pages/crews/CrewImports.tsx` loads the reference lists once and renders two `ImportButton`s in the Crews page. Test in `pages/crews/CrewImports.test.tsx`. Verify: touched tests.
5. **Strings.** `import.json` (`crewImport`, `crewMemberImport`, `entity.*`) and `crews.json` in English and Bahasa Indonesia; the i18n completeness test must stay green.
6. **Gates.** `npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run` on every changed source file.

No pgTAP: no database object is added.
