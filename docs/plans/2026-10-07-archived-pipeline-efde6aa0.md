# Issue #883 — Hide archived projects from Sales Pipeline

## Status and scope

`git log origin/dev --grep="#883"` returned no matching commit, so this work is not already shipped on `dev` (scope: commit subjects/bodies reachable from `origin/dev`).

This is a corrective read-path slice. It makes `archived_at IS NULL` the default at the two paths that populate Sales Pipeline: the open-pipeline SQL RPC and the terminal-lost DAL query. It does **not** alter the archive write, project-state machine, RLS policies, grants, table schema, cache keys, or UI layout.

The request supplies the acceptance criteria for this narrowly scoped change; no new ADR is needed. ADR-0018 already decides that archived records disappear from default lists.

## Design

### Data flow

`ProjectDetailHeader` archives a project by setting `projects.archived_at` and invalidates `['sales-pipeline']` and `['lost-deals']` in `useProjectMutations`. The subsequent `/sales` route reads:

1. open deals from `get_sales_pipeline()` via `useSalesPipeline`; and
2. terminal Lost/Declined deals from `useLostDeals` → `repositories.project.list({ statuses: ['Loss Tender', 'Declined'] })` → `listProjects`.

Add the archive predicate at both data boundaries, rather than filtering cards after they arrive. This keeps aggregate stage counts/values correct, avoids delivering archived rows to the browser, and applies consistently to the pipeline board, table scopes, and dashboard lost-deal consumer.

### Database and tenancy

Migration `0261` only redefines the existing `public.get_sales_pipeline()` projection. It retains `security invoker`, `set search_path = public`, no `org_id` input, the 0234 JSON shape/classification fields, and 0234's explicit `revoke all ... from public, anon` plus `grant execute ... to authenticated`. Thus base-table RLS remains the tenancy authority. The existing partial `projects_live_idx (org_id) WHERE archived_at IS NULL` is the appropriate live-row access path; no new index or table/RLS policy is needed.

The rollback restores the complete 0234 function definition, its prior comment/ACL shape, and schema reload notification. Since this is an existing SECURITY INVOKER function (not a new SECURITY DEFINER, table, edge function, or bucket), neither the `0178_anon_executable_definers` callable-function roster/count nor `scripts/isolation-probe-denominator.json` changes. Confirm that decision by retaining security mode and function identity exactly; do not edit either allow-list.

### Caller audit / explicit archived access

All direct `listProjects` paths are default-list semantics: `useProjects`, `useLostDeals`, `useProjectOptions`, and the repository callers used by dashboard/lost-deal data. They must receive live rows only. `getProject(id)` deliberately remains an explicit id lookup, and `listProjectsByClient(clientId)` is a separate, documented full-history relationship read for Company Detail; neither calls `listProjects` and neither is changed. Therefore no `includeArchived` option or repository signature expansion is warranted in this issue.

## Files

| File | Change |
|---|---|
| `supabase/migrations/0261_pipeline_hides_archived.sql` | Recreate the 0234 sales-pipeline RPC with the live-row predicate and preserved ACL/security attributes. |
| `supabase/migrations/rollback/0261_pipeline_hides_archived_down.sql` | Reversibly restore the complete 0234 RPC contract and ACL/comment state. |
| `supabase/tests/0261_pipeline_hides_archived.test.sql` | pgTAP proof for archived versus live pipeline rows. |
| `pmo-portal/src/lib/db/projects.ts` | Apply the live-row default to `listProjects` and correct/archive-scope documentation. |
| `pmo-portal/src/lib/db/projects.test.ts` | Mock/assert the PostgREST `.is('archived_at', null)` filter on default and Lost status paths. |
| `pmo-portal/e2e/AC-PRJ-001-projects-crud.spec.ts` | Make the archive-to-pipeline absence oracle wait for the write toast and completed pipeline load. |

## TDD implementation tasks

1. **Make the cross-stack archive oracle deterministic first (RED).**
   - **Files:** `pmo-portal/e2e/AC-PRJ-001-projects-crud.spec.ts`
   - **AC:** AC-PRJ-001 (existing self-isolated CRUD journey; its archive goal oracle observes AC-PRJ-005 behavior but does not own new AC-PRJ-005a).
   - After the alert-dialog confirm click, wait for the visible exact toast text `Project archived`. After `page.goto('/sales')`, wait for the known open seed card `Northwind ERP Rollout` to be visible before asserting `page.getByText(editedName)` has count zero. Keep the existing self-isolation tag, unique deal name, persona flow, and goal assertion; do not weaken the assertion to a navigation or element-existence proxy.
   - **RED verification on the current baseline (before Task 3):** `./scripts/e2e-local.sh AC-PRJ-001` must fail because the archived Leads deal is returned after the pipeline has demonstrably loaded.

2. **Add the database contract before its implementation (RED).**
   - **Files:** `supabase/tests/0261_pipeline_hides_archived.test.sql`
   - **AC:** AC-PRJ-005a (owner: pgTAP).
   - Create a rollback-wrapped, isolated pgTAP fixture with one organization, one active authenticated Executive profile, the needed `Leads` pipeline-stage config, one live Leads project, and one Leads project with a non-null `archived_at`. Under that profile's JWT, call `public.get_sales_pipeline()` and assert (a) the live project id is present and (b) the archived project id is absent (including the stage aggregate only counts the live row if used as the count oracle). Set `plan(2)` and prefix both assertion descriptions with `AC-PRJ-005a`.
   - **RED verification:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0261_pipeline_hides_archived.test.sql'` must fail before Task 3.

3. **Implement the reversible open-pipeline database filter (GREEN).**
   - **Files:** `supabase/migrations/0261_pipeline_hides_archived.sql`, `supabase/migrations/rollback/0261_pipeline_hides_archived_down.sql`
   - **AC:** AC-PRJ-005a.
   - In the up migration, copy the full `get_sales_pipeline` definition from `0234_project_classification.sql`, preserving every selected/projection field, grouping/order, `stable`, `security invoker`, and `set search_path = public`. In the `pl` CTE change the `where` clause to retain the pipeline-status predicate and add `and p.archived_at is null`. Re-assert exactly 0234's `revoke all on function public.get_sales_pipeline() from public, anon` and `grant execute ... to authenticated`, update the function comment to identify 0261 as the latest definition while retaining its projection guidance, and `notify pgrst, 'reload schema'`.
   - In the down migration, recreate the full 0234 body without the archive predicate (including all five classification fields), restore its 0234 latest-definition comment, re-assert the same revoke/grant pair, and notify PostgREST. Do not add a table, policy, index, default, generated type, or allow-list entry.
   - **GREEN verification:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0261_pipeline_hides_archived.test.sql supabase/tests/0234_project_classification.test.sql'`.

4. **Add the DAL regression assertions before changing the query (RED).**
   - **Files:** `pmo-portal/src/lib/db/projects.test.ts`
   - **AC:** AC-PRJ-005b (owner: Vitest).
   - Extend the hoisted mock/query builder with `mockIs`, wire `builder.is` to return the builder, and reset it in `beforeEach`. Add one AC-tagged test for `listProjects()` and one for `listProjects({ statuses: ['Loss Tender', 'Declined'] })`; each must assert exactly one `.is('archived_at', null)` call while retaining the existing default status and Lost multi-status assertions. This binds the test to the actual shipped PostgREST query rather than filtering mock result data after the fact.
   - **RED verification:** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/projects.test.ts` must fail until Task 5 adds the predicate.

5. **Filter every `listProjects` variant at the DAL boundary (GREEN) and correct its documentation.**
   - **Files:** `pmo-portal/src/lib/db/projects.ts`, `pmo-portal/src/lib/db/projects.test.ts`
   - **AC:** AC-PRJ-005b.
   - In `listProjects`, after choosing the default/single/multi status scope and before optional manager/range filters, append `.is('archived_at', null)` unconditionally. This covers the delivery default and the Lost/Declined override used by `useLostDeals`; it must not send `org_id` or alter status, pagination, error, or repository behavior.
   - Update the `listProjects` and `archiveProject` comments to say that this DAL's default and explicit status lists are live-only because of the exact `archived_at IS NULL` predicate. Preserve the explicit-any-stage behavior documented for `getProject(id)` and `listProjectsByClient(clientId)`; do not add an unused `includeArchived` parameter or modify `ProjectRepository`/caller signatures.
   - **GREEN verification:** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/projects.test.ts`.

6. **Run the required mutation proofs, then restore the real implementation.**
   - **Files under mutation only:** `supabase/migrations/0261_pipeline_hides_archived.sql`; no mutation change may remain in the working tree.
   - **AC:** AC-PRJ-005a, AC-PRJ-005b, AC-PRJ-001.
   - Back up the new migration, temporarily remove only `and p.archived_at is null` from its CTE, then reset and run the new pgTAP test; it must be red. With that same predicate absent, run `./scripts/e2e-local.sh --reset AC-PRJ-001`; the deterministic loaded-pipeline oracle must be red because the archived unique deal reappears. Restore the byte-for-byte backup, then repeat the pgTAP and e2e commands and require green. Separately remove the DAL `.is('archived_at', null)` call only long enough to confirm the two new Vitest assertions fail, then restore it and rerun the test green.
   - **Exact mutation command pattern:** `cp supabase/migrations/0261_pipeline_hides_archived.sql "${TMPDIR:-/tmp}/0261_pipeline_hides_archived.sql.bak" && perl -0pi -e 's/\n    and p\.archived_at is null//' supabase/migrations/0261_pipeline_hides_archived.sql`; run the expected-red commands above; restore with `cp "${TMPDIR:-/tmp}/0261_pipeline_hides_archived.sql.bak" supabase/migrations/0261_pipeline_hides_archived.sql` before any final green gate.

7. **Run the scoped final gates with the restored implementation.**
   - **Files:** all six files above.
   - **AC:** AC-PRJ-005a, AC-PRJ-005b, AC-PRJ-001.
   - From the repository root, run:
     ```bash
     cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck
     cd pmo-portal && npx eslint --max-warnings=0 src/lib/db/projects.ts src/lib/db/projects.test.ts e2e/AC-PRJ-001-projects-crud.spec.ts
     cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
     scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0261_pipeline_hides_archived.test.sql supabase/tests/0234*'
     ./scripts/e2e-local.sh AC-PRJ-001
     ```
   - The reset+pgTAP command intentionally holds one DB lock across both operations. It leaves the local schema at this branch's 0261 head, so the final e2e command needs no second reset. Do not regenerate `package-lock.json`.

## Traceability

| Acceptance criterion | Owning proof | Supporting proof |
|---|---|---|
| AC-PRJ-005a — archived open-pipeline project absent; live project present | `supabase/tests/0261_pipeline_hides_archived.test.sql` | Mutation removal of SQL predicate; `AC-PRJ-001-projects-crud.spec.ts` archive journey |
| AC-PRJ-005b — default and Lost/Declined DAL lists exclude archives | `pmo-portal/src/lib/db/projects.test.ts` | Mutation removal of DAL `.is()` filter |
| AC-PRJ-001 — archive journey waits for write completion and loaded pipeline before proving the deal absent | `pmo-portal/e2e/AC-PRJ-001-projects-crud.spec.ts` | SQL-predicate-removal mutation run |

## Completion notes

- No new ADR: this implements the already accepted archive-list rule in ADR-0018.
- No migration-count allow-list change: `get_sales_pipeline` remains the same named SECURITY INVOKER function and no enumerated isolation surface is added.
- The PR must retain evidence that each expected-red mutation failed and each restored implementation passed; a green result without that mutation evidence is incomplete.
