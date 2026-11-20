# Payables switch, project filter and project figure — implementation plan

> Follow the repository's Orca dispatch and TDD workflow. Planning artifact; no build until the spec is signed off.

**Goal:** Gate the existing payables page by a new `payables` switch, add the invoice-date column and `?project=` filter, and show open payables on a project's money section.

**Spec:** `docs/specs/payables-switch.spec.md`. **Tech:** Postgres/pgTAP, React 19, Vitest/RTL.

## Migration

One forward migration, number on request: `NNNN_payables_switch.sql` (plus rollback in `supabase/migrations/rollback/NNNN_payables_switch_down.sql`). Follow the pattern of `0531_plan_catalogue.sql`: re-create `org_features_feature_key_check` including `payables` (start from the **head** definition of the allowed key list, read it from `pg_constraint` at head, not from 0531), insert `plan_features` rows (`payables` enabled at tier ≥ 2 for starter/growth/pro/enterprise) and a `global_features` row (`true`). Idempotent (`on conflict do nothing`). Run DB work under `scripts/with-db-lock.sh`.

## Tasks (2–5 min each)

1. **Code registry.** In `pmo-portal/src/lib/features.ts` add `'payables'` to `FEATURE_KEYS`, to the `finance` group `keys`, the default map (`payables: true`) and the label map (`payables: 'Payables'`). Test first: `src/lib/features.test.ts` and `features.dbRegistry.test.ts` (fails until the migration is reflected). Verify: `cd pmo-portal && npx vitest run src/lib/features.test.ts src/lib/features.dbRegistry.test.ts`.
2. **Migration + pgTAP.** Write the migration above. pgTAP `supabase/tests/NNNN_payables_switch.test.sql`: AC-PAY-009 (key accepted, Starter off, Growth+ on, global off beats org on). Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/NNNN_payables_switch.test.sql'`.
3. **Route + nav gate.** In `App.tsx` change `<FeatureRoute feature="procurement"` on `/finance/payables` to `feature="payables"`; in `src/components/shell/Rail.tsx` (line ~93) and `routeMatch.ts` change the payables entry's `feature` to `payables`. Tests (RED first): extend `src/components/shell/__tests__/Rail.features.test.tsx` and `routeMatch.finance.test.ts` for AC-PAY-002/003. Verify with those files.
4. **Invoice-date column.** In `PayablesPage.tsx` add an `invoiceDate` column using `supplierInvoiceDate(row.procurement)` formatted with the app date formatter; add it to `exportValue`. Add key `financeHub:hub.invoiceDate` to the locale files (rebase translation files right before the PR, #1070). Test in `pages/finance/PayablesPage.test.tsx` (AC-PAY-001).
5. **Project filter.** In `PayablesPage.tsx` extend `useUrlFilters(['q', 'overdue', 'project'])`; filter `payablesPosition.payables` by `procurement.project_id` **before** totals and ageing. Ageing buckets come from `payablesPosition.payablesAgeing`, so extract the bucket/total computation in `src/lib/finance/payablesPosition.ts` into `filterPayablesByProject(position, projectId)` and unit test it in `payablesPosition.test.ts` (AC-PAY-006, AC-PAY-008). Add a project `Select` in the toolbar fed by `useProjects`. Test in `PayablesPage.urlFilters.test.tsx`.
6. **Bucket parity.** Add a test asserting receivables and payables share boundaries (AC-PAY-005) in `src/lib/finance/financePosition.test.ts`; if the constants differ, export one shared set and use it in both `ageingBucket` and `payablesAgeBucket`.
7. **Project money figure.** Add `ProjectPayablesLine` (new file `pages/project-detail/ProjectPayablesLine.tsx`) reading `usePayablesPagePosition` filtered by project, rendered inside `MoneyBlock` (`pages/project-detail/ProjectBlocks.tsx`) behind `useFeature('payables')` and `canSeeMoney`. Link to `/finance/payables?project=<id>`. Test in `pages/project-detail/__tests__/ProjectPayablesLine.test.tsx` (AC-PAY-007, off case, unknown case).
8. **Assistant tool gate.** Check `src/lib/agent` for a payables read tool; if present, register it under the `payables` switch (D13) with a test (AC-PAY-010). If none exists, record the finding in the PR and drop FR-PAY-010.
9. **Curated e2e.** One journey `pmo-portal/e2e/AC-PAY-001-payables.spec.ts` (two unpaid + one paid case → two rows; mark paid → leaves; read `docs/e2e-parallel-conventions.md` first for the isolation tag). Verify: `scripts/e2e-local.sh AC-PAY-001`.

## Final gate (builder)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, the touched test files above, `scripts/ux-proof.sh` on `/finance/payables` and a project overview, touched pgTAP file.

## Traceability (ADR-0010)

| AC | Owning layer | Test |
|---|---|---|
| AC-PAY-001 | E2E | `e2e/AC-PAY-001-payables.spec.ts` |
| AC-PAY-002 | Unit | `Rail.features.test.tsx`, `routeMatch.finance.test.ts` |
| AC-PAY-003 | Unit | `Rail.features.test.tsx` |
| AC-PAY-004 | Unit | `PayablesPage.test.tsx` |
| AC-PAY-005 | Unit | `financePosition.test.ts` |
| AC-PAY-006 | Unit | `payablesPosition.test.ts`, `PayablesPage.urlFilters.test.tsx` |
| AC-PAY-007 | Unit | `ProjectPayablesLine.test.tsx` |
| AC-PAY-008 | Unit | `payablesPosition.test.ts` |
| AC-PAY-009 | pgTAP | `NNNN_payables_switch.test.sql` |
| AC-PAY-010 | Unit | agent tool registry test |

## Owner questions

1. Is the nav/route gate `payables` alone (dropping the `procurement` gate)? Recommended: yes — payables needs procurement data, but a Growth org always has both.
2. Should the project figure show to Project Managers too, or finance roles only? Recommended: anyone who can already see the project money block.
3. Does a project filter on the company page need a "no project" option for unassigned cases? Recommended: yes, one "No project" entry.
