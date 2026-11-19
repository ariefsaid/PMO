# Import Templates Implementation Plan (#2530)

> Fresh Orca worker per slice. Spec: `docs/specs/field-data-import-templates.spec.md`. Read `docs/adr/` ADR-0027 and the reference descriptors `pmo-portal/src/lib/import/contractLineDescriptor.ts` and `budgetDescriptor.ts` first. Start only after #2520, #2526 and #2528 have landed (descriptors call their create repositories). No migrations in this ticket.

## Slice 1 — generic template and failed-rows files (one worker)
- [ ] Tests first: `pmo-portal/src/lib/import/__tests__/templateFile.test.ts` and `failedRowsFile.test.ts` for AC-IMT-001, 003, 004, 005, 006, 007 against a fake descriptor.
- [ ] `pmo-portal/src/lib/import/templateFile.ts` (headers, example row, Notes sheet, version cell, dropdown validations) and `failedRowsFile.ts` (original cells + "Row in your file" + "Reason", skipped on its own sheet), both on `src/lib/export/toWorkbookBuffer.ts` and `exportFilename.ts`; text-escape formula-leading cells (FR-IMT-006).
- [ ] Extend `ImportDescriptor` in `src/lib/import/types.ts` with optional `template?: { version: number; example: Record<string,string>; lists?: Record<string,string[]> }`; `autoMap.ts` ignores the two added columns and checks version.
- [ ] `ImportWizard.tsx`: "Download template" on step 1; "Download failed rows" on the result step via `src/lib/download.ts`; en + id strings in the import namespace; a11y: buttons labelled, results announced.
- [ ] Gate: `npx vitest run src/lib/import src/components/import`, typecheck, eslint on touched files.

## Slice 2..6 — descriptors (five parallel workers, one each)
Each: failing unit test for AC-IMT-002 (round trip), 012 (idempotent), plus the entity ones below; descriptor in `pmo-portal/src/lib/import/<entity>Descriptor.ts`, exported from `index.ts`, mounted with `ImportButton` on the entity's list screen behind `can('create', <entity>)` (AC-IMT-013).
- [ ] 2 Rates `rateCatalogueDescriptor.ts` — AC-IMT-008 (pgTAP on create path if #2520 left none: `supabase/tests/rate_import_conflict.test.sql`). Reference lookup for contract, location.
- [ ] 3 Stock items `stockItemDescriptor.ts`.
- [ ] 4 Equipment `equipmentDescriptor.ts` — AC-IMT-009, vendor via `refLookup`.
- [ ] 5 People `employeeDescriptor.ts` — AC-IMT-011 (no sensitive columns assertion).
- [ ] 6 Crews (two-sheet) `crewDescriptor.ts` — AC-IMT-010; needs multi-sheet read via `readWorkbookGrid.ts`; if the wizard only reads the first sheet, add a `sheets` option to the descriptor first (small change in Slice 1's owner worker's file, coordinate through the Director).

## Slice 7 — journey
- [ ] `e2e/AC-IMT-014-rate-import-failed-rows.spec.ts` (read `docs/e2e-parallel-conventions.md`): download template, fill via the test helper, import with one bad row, download failed rows, fix, re-import. `scripts/e2e-local.sh AC-IMT-014`; `scripts/ux-proof.sh` on touched routes.

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest files (and the one pgTAP file when added).
