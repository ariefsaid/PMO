# Issue #758 — Projects: record an end customer

## Design

Add one nullable `projects.end_client_id` FK to `companies`, scoped to the project row's stamped `org_id`. The database is the enforcement authority: a `SECURITY DEFINER`, search-path-pinned `BEFORE INSERT OR UPDATE OF end_client_id, org_id` trigger runs after `projects_stamp_org_id`, validates the referenced company belongs to `new.org_id`, and rejects mismatches with uniform `42501`. The migration restores both explicit column grants, adds the selective FK index, forwards the sales-pipeline JSON contract, and documents a manual reverse sequence.

The read path stays in the established three-layer shape: generated database type → project DAL/repository types → TanStack hooks/pages. The project and opportunity selects qualify **both** company joins by FK name so the new relationship cannot make PostgREST embeds ambiguous. `ProjectWithRefs` carries a nullable `end_client` relation; `PipelineProject` carries nullable `end_client_name`. The existing `useCompanies()` cache supplies all org companies to both the optional form picker and the end-customer list filter; no new client query is introduced.

The write path is `ProjectFormModal` → `CreateProjectInput`/`ProjectHeaderInput` → repository wrapper → `createProject`/`updateProjectHeader` → PostgREST, with no client-supplied `org_id`. The modal preserves the selected display label for create and edit, supports clearing to `null`, and leaves `requiredFields` unchanged. List state adds a validated, URL-owned `endClient` company UUID, clearing it alongside the existing filters; export derives from the new DataTable column. Pipeline search and export consume the RPC-projected name, including the existing lost-deal mapping.

No ADR is needed: this is an additive nullable FK using established tenancy, repository, form, and forward-copy RPC patterns, not a new cross-cutting architectural decision. Do not touch ERP adapters, edge functions, import descriptors, agent tools, seed data, or e2e files.

### Traceability

| AC | Owning layer and canonical proof |
| --- | --- |
| AC-EC-001 | pgTAP — `supabase/tests/0223_project_end_client.test.sql` |
| AC-EC-002 | Vitest/RTL — `pmo-portal/components/ProjectFormModal.endCustomer.test.tsx` |
| AC-EC-003 | Vitest/RTL — focused tests in `pmo-portal/pages/Projects.test.tsx`, `pmo-portal/pages/project-detail/__tests__/ProjectDetail.test.tsx`, and `pmo-portal/pages/__tests__/SalesPipeline.endCustomer.test.tsx` |
| AC-EC-004 | Node test — `scripts/pmo.test.mjs` |
| AC-EC-005 | Vitest catalogue test — `pmo-portal/components/ProjectFormModal.bahasa.test.tsx` |

## Implementation plan

1. **Add the failing database contract test first.**
   - Create `supabase/tests/0223_project_end_client.test.sql` with isolated two-org fixtures, an Admin/PM in org A, same-org and foreign companies, and descriptions beginning `AC-EC-001`.
   - Assert the nullable column; `authenticated` INSERT and UPDATE privileges from `information_schema.column_privileges`; PM same-org INSERT and UPDATE under `set local role authenticated` plus JWT claims; rejection of foreign-company INSERT and UPDATE with `throws_ok(..., '42501', 'end customer not in this organization', ...)`; acceptance of `NULL`; and an RPC payload whose project has the expected `end_client_name`.
   - Set the pgTAP plan count to the exact number of assertions, use non-null expected messages in every `throws_ok`, `reset role` before inspection, and close with `finish()`/`rollback`.
   - Verify RED before the migration: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0223_project_end_client.test.sql'`.
   - Covers: **AC-EC-001**.

2. **Implement the reversible schema, guard, grants, pipeline projection, and ambiguity guard.**
   - Create `supabase/migrations/0223_project_end_client.sql`. Its header must state the manual reverse in order: drop `projects_zz_end_client_same_org`, drop the same-org trigger function, drop `projects_end_client_idx`, drop `end_client_id`, then restore migration 0208's `get_sales_pipeline()` body and its ACLs.
   - Add nullable `end_client_id uuid references public.companies(id)` with the default FK delete action, plus `projects_end_client_idx` on `end_client_id`.
   - Add a `SECURITY DEFINER`, `set search_path = public` trigger function that, only for a non-null value, requires a matching `companies.id` and `companies.org_id = new.org_id`; otherwise raise exactly `42501` with `end customer not in this organization`. Revoke all direct execution from `public`, `anon`, and `authenticated`. Attach it as `projects_zz_end_client_same_org` `BEFORE INSERT OR UPDATE OF end_client_id, org_id`, so the existing org stamp runs first.
   - Grant only `insert (end_client_id), update (end_client_id)` on `public.projects` to `authenticated`; add no anon grant.
   - Drop and recreate `public.get_sales_pipeline()` by copying migration 0208's body verbatim except for `p.end_client_id` in `pl`, the `left join companies ec on ec.id = pl.end_client_id`, and `end_client_id`/`end_client_name` keys in each projects JSON row. Set its catalog comment to `Latest definition: 0223`, then reapply all three 0208 ACL statements.
   - Extend `supabase/tests/0208_sales_pipeline_tax_treatment.test.sql` AC-TAX-305's full sorted key array with `end_client_id` and `end_client_name`; make its fixture include a company/end-customer-backed project so the JSON assertion remains meaningful.
   - Update `supabase/tests/postgrest_embed_ambiguity_guard.test.sql`: increase the plan, add `projects -> companies` to AC-EMBED-001's exact pair set, and add an exact `projects`/`companies` FK-name assertion naming `projects_client_id_fkey` and `projects_end_client_id_fkey`.
   - Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0223_project_end_client.test.sql supabase/tests/0208_sales_pipeline_tax_treatment.test.sql supabase/tests/postgrest_embed_ambiguity_guard.test.sql'`.
   - Covers: **AC-EC-001**.

3. **Regenerate generated DB types from the migrated local database.**
   - From the repo root, run `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts` after the reset in Task 2.
   - Preserve the existing file header and inspect the diff: it must add `end_client_id` to projects `Row`/`Insert`/`Update`, add the `projects_end_client_id_fkey` relationship, and reflect only the pipeline-RPC type change if generation exposes it; do not hand-cast around missing fields.
   - Verify: `git diff --check -- pmo-portal/src/lib/supabase/database.types.ts && git diff -- pmo-portal/src/lib/supabase/database.types.ts`.
   - Covers: **AC-EC-001**.

4. **Write DAL and embed-regression tests before changing the frontend data path.**
   - Extend `pmo-portal/src/lib/db/projects.test.ts` with `AC-EC-002`-prefixed tests that require `createProject` and `updateProjectHeader` to send `end_client_id`, including `null`, and require project selects to use `client:companies!projects_client_id_fkey(name), end_client:companies!projects_end_client_id_fkey(name)`.
   - Add the matching opportunity-select expectation in a new `pmo-portal/src/lib/db/opportunity.test.ts` if absent, or extend its existing test file if found while implementing; assert the two FK-qualified company embeds and the `end_client_id` projection.
   - Verify RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/projects.test.ts src/lib/db/opportunity.test.ts'`.
   - Covers: **AC-EC-002**, **AC-EC-003**.

5. **Thread the new FK through typed project reads and writes.**
   - In `pmo-portal/src/lib/db/projects.ts`, add `end_client_id` to `CreateProjectBase` and `ProjectHeaderInput`; extend `ProjectWithRefs` with `end_client: { name: string } | null`; replace `SELECT` with FK-qualified client and end-client embeds; include `end_client_id` in `createProject()`'s insert and `updateProjectHeader()`'s patch.
   - In `pmo-portal/src/lib/db/opportunity.ts`, add `end_client_id` to `OPPORTUNITY_COLUMNS`, extend `OpportunityRow` with nullable `end_client`, and qualify client/end-client company embeds by their exact FK names. This keeps the pre-win fallback structurally complete for `ProjectDetail`.
   - In `pmo-portal/src/lib/repositories/types.ts`, update the project-header documentation to name the end-customer field; `pmo-portal/src/lib/repositories/index.ts` remains a typed thin delegate because its existing `create` and `updateHeader` methods already forward the changed inputs.
   - Update all affected fixtures and assertions in `projects.test.ts` and the opportunity test without casts.
   - Verify GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/projects.test.ts src/lib/db/opportunity.test.ts'`.
   - Covers: **AC-EC-002**, **AC-EC-003**.

6. **Write the form interaction test first.**
   - Create `pmo-portal/components/ProjectFormModal.endCustomer.test.tsx`, mocking `useCompanies()` with mixed company types and existing client/PM hooks.
   - Add `AC-EC-002`-prefixed RTL cases proving: End customer immediately follows Client in DOM order in create and edit-header modes; it is optional and lists all org companies; selecting a company submits its ID for create and header save; clearing submits `end_client_id: null`; and edit mode seeds the existing end-customer label.
   - Verify RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/ProjectFormModal.endCustomer.test.tsx'`.
   - Covers: **AC-EC-002**.

7. **Implement the optional end-customer combobox in the shared project form.**
   - In `pmo-portal/components/ProjectFormModal.tsx`, import and call `useCompanies()`; add `end_client_id`/`endClientName` to `ProjectFormInitial`, `endClientId` to `FormValues`, an end-customer selected-label state, and a clearable `Combobox` directly after Client using every returned company, not `useClientCompanies()`.
   - Do not add it to `requiredFields` or validation. Seed it from `initial`, map changes and clear to `null`, and include the value in both create base input and edit-header input.
   - Use `t('projectForm.endCustomer.*', '...')` for all new visible form copy, retaining existing primitives and tokenized layout.
   - Verify GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/ProjectFormModal.endCustomer.test.tsx'`.
   - Covers: **AC-EC-002**.

8. **Add failing URL/list/detail tests for the customer distinction.**
   - Extend `pmo-portal/src/lib/listWorkingSet.test.ts` with `AC-EC-003`-prefixed cases that parse a valid `endClient` UUID, serialize it while retaining unrelated parameters, normalize invalid values to `All`, and clear it by serializing the default away.
   - Extend `pmo-portal/pages/Projects.test.tsx` fixtures/mocks and add `AC-EC-003` tests for the End customer column, export value, `?endClient=<id>` URL state, filter narrowing, selected chip, and clear-all/individual-clear behavior.
   - Extend `pmo-portal/pages/project-detail/__tests__/ProjectDetail.test.tsx` with `AC-EC-003` cases that show the end customer in the rail when populated and omit the row when it is null.
   - Verify RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/listWorkingSet.test.ts pages/Projects.test.tsx pages/project-detail/__tests__/ProjectDetail.test.tsx'`.
   - Covers: **AC-EC-003**.

9. **Implement URL-owned end-customer filtering, table/export display, and detail display.**
   - In `pmo-portal/src/lib/listWorkingSet.ts`, add `endClient: string` to `ProjectsWorkingSet`; parse it with `referenceValue(params.get('endClient'))`; serialize it with `putParam(..., 'All')`.
   - In `pmo-portal/pages/Projects.tsx`, call `useCompanies()` for all-org end-customer options, read/write `workingSet.endClient`, filter `ProjectWithRefs` by `end_client_id`, and include it in active-filter calculations, clear-all, desktop/mobile selects, loading/error/empty option states, and a clearable filter chip. Add an End customer DataTable column with its own `t()` key and `exportValue`, mirroring the client/company rendering. Keep import descriptor inputs unchanged.
   - In `pmo-portal/pages/project-detail/ProjectDetail.tsx`, pass `end_client_id` and `endClientName` into edit-modal initial values. In `pmo-portal/pages/project-detail/ProjectDetailRail.tsx`, conditionally render the translated End customer row only when `project.end_client` exists; preserve the rail's current Client-link behavior rather than introducing a new navigation pattern.
   - Verify GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/listWorkingSet.test.ts pages/Projects.test.tsx pages/project-detail/__tests__/ProjectDetail.test.tsx'`.
   - Covers: **AC-EC-003**.

10. **Write the pipeline display/search/export and lost-deal mapping tests first.**
    - Create `pmo-portal/pages/__tests__/SalesPipeline.endCustomer.test.tsx` with open and lost fixtures whose client and end-customer names differ. Add `AC-EC-003` cases for the End customer table column, search matching `end_client_name`, and export header/value inclusion.
    - Extend `pmo-portal/src/hooks/useDashboard.test.tsx` with an `AC-EC-003`-prefixed assertion that `useLostDeals()` maps `r.end_client?.name` into `end_client_name`, so the non-RPC loss scope obeys the same UI contract.
    - Verify RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesPipeline.endCustomer.test.tsx src/hooks/useDashboard.test.tsx'`.
    - Covers: **AC-EC-003**.

11. **Implement the pipeline end-customer projection consumer.**
    - In `pmo-portal/src/lib/db/dashboard.ts`, add nullable `end_client_id` and `end_client_name` to `PipelineProject` to mirror the RPC JSON.
    - In `pmo-portal/src/hooks/useDashboard.ts`, map `end_client_name: r.end_client?.name ?? null` in `useLostDeals()`.
    - In `pmo-portal/pages/SalesPipeline.tsx`, add translated End customer table/export column, include `(p.end_client_name ?? '')` in both table and kanban search predicates, and retain the existing Client column and all stage aggregate behavior.
    - Verify GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesPipeline.endCustomer.test.tsx src/hooks/useDashboard.test.tsx pages/__tests__/SalesPipeline.export.test.tsx'`.
    - Covers: **AC-EC-003**.

12. **Add the catalogue contract before adding translations.**
    - Create `pmo-portal/components/ProjectFormModal.bahasa.test.tsx`, reading both `public/locales/en/common.json` and `public/locales/id/common.json` as existing catalogue tests do.
    - Add an `AC-EC-005`-prefixed test that asserts every new end-customer key used by form, projects list/filter/chip, detail rail, and pipeline has its English source text and a non-empty Indonesian translation; assert the Indonesian End customer label is exactly `Pelanggan akhir`.
    - Verify RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/ProjectFormModal.bahasa.test.tsx'`.
    - Covers: **AC-EC-005**.

13. **Add matching English and Bahasa Indonesia catalogue entries.**
    - Update `pmo-portal/public/locales/en/common.json` and `pmo-portal/public/locales/id/common.json` with the same nested keys used by Tasks 7, 9, and 11. Use `End customer` in English and `Pelanggan akhir` in Bahasa Indonesia, with translated option/filter/chip copy rather than fallbacks.
    - Verify GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/ProjectFormModal.bahasa.test.tsx && npm run check:i18n'`.
    - Covers: **AC-EC-005**.

14. **Prove the CLI's existing generic project pass-through accepts and transmits the new column.**
    - Add an `AC-EC-004`-prefixed `node:test` case in `scripts/pmo.test.mjs` using the fake Supabase server. Execute both `create projects` and `update projects --filter id=eq...` with `end_client_id`; assert success, POST/PATCH path and filter, and parsed request JSON preserves the exact column/value.
    - Retain the API-client/migration table-list parity test against 0222 and make no `scripts/pmo.mjs` behavior change if the generic `guardWritePayload` test is already green; the new test is the regression contract.
    - Verify: `node --test scripts/pmo.test.mjs`.
    - Covers: **AC-EC-004**.

15. **Run the schema/API smoke and required final gates without touching package management.**
    - After the migration reset, perform the local PostgREST probe mandated by the issue with a runtime-only local API credential: the fully FK-hinted projects select must return HTTP 200 (an RLS-empty array is valid), and the deliberately unhinted client embed must return `PGRST201`. Do not place the credential or its lookup location in source, test output, commits, or this plan.
    - Run the required checks from the repo root (the type/unit work stays under the test lock):
      ```bash
      scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 components/ProjectFormModal.tsx components/ProjectFormModal.endCustomer.test.tsx pages/Projects.tsx pages/Projects.test.tsx pages/SalesPipeline.tsx pages/__tests__/SalesPipeline.endCustomer.test.tsx pages/project-detail/ProjectDetail.tsx pages/project-detail/ProjectDetailRail.tsx pages/project-detail/__tests__/ProjectDetail.test.tsx src/hooks/useDashboard.ts src/hooks/useDashboard.test.tsx src/lib/db/projects.ts src/lib/db/projects.test.ts src/lib/db/opportunity.ts src/lib/db/opportunity.test.ts src/lib/db/dashboard.ts src/lib/listWorkingSet.ts src/lib/listWorkingSet.test.ts src/lib/repositories/types.ts components/ProjectFormModal.bahasa.test.tsx && npm run check:i18n && npx vitest run --changed origin/dev'
      node --test scripts/pmo.test.mjs
      scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0223_project_end_client.test.sql supabase/tests/0208_sales_pipeline_tax_treatment.test.sql supabase/tests/postgrest_embed_ambiguity_guard.test.sql'
      ```
    - Confirm `package-lock.json` is unchanged; do not run `npm install`.
    - Covers: **AC-EC-001**, **AC-EC-002**, **AC-EC-003**, **AC-EC-004**, **AC-EC-005**.

## Review focus

- Security reviewer: validate trigger order, `SECURITY DEFINER` search path and revoked function ACL, same-org insert/update/null behavior, and explicit `authenticated` grants without anon writes.
- Code-quality reviewer: inspect the 0223 index against the list/filter/read path, all qualified projects→companies embeds, generated type diff, no N+1 company reads, and absence of ERP/import/edge-function changes.
- Spec reviewer: trace every AC to the tagged owning test and verify client remains the invoiced party everywhere outside this project metadata/filter scope.
