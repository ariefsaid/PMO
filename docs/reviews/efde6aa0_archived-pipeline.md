# Archived projects hidden from Sales Pipeline

Issue #883 adds live-row filtering to the Sales Pipeline and project DAL. The open-pipeline RPC now excludes projects with a non-null `archived_at`, while `listProjects` applies the same filter for both its default status scope and the Lost/Declined status scope. This keeps archived projects out of pipeline cards, aggregates, and lost-deal lists without changing archive writes or explicit ID/client-history reads.

## Implementation

- `supabase/migrations/0261_pipeline_hides_archived.sql` recreates `get_sales_pipeline()` with `and p.archived_at is null`, retaining the 0234 projection, invoker security mode, `search_path`, and function ACLs.
- `supabase/migrations/rollback/0261_pipeline_hides_archived_down.sql` restores the prior 0234 function body and ACL/comment state.
- `supabase/tests/0261_pipeline_hides_archived.test.sql` adds AC-PRJ-005a pgTAP coverage proving a live project is present and an archived project is absent.
- `pmo-portal/src/lib/db/projects.ts` adds `.is('archived_at', null)` to `listProjects` and updates its archive/list documentation.
- `pmo-portal/src/lib/db/projects.test.ts` adds AC-PRJ-005b assertions for the default and Lost/Declined queries.
- `pmo-portal/e2e/AC-PRJ-001-projects-crud.spec.ts` makes the archive journey wait for the `Project archived` toast and a known loaded pipeline card before asserting the archived deal is absent.
- `docs/plans/2026-10-07-archived-pipeline-efde6aa0.md` records the design, caller audit, TDD/mutation checks, gates, and AC traceability.

No new migration allow-list entry is included: the change preserves the existing named `SECURITY INVOKER` function rather than adding a callable surface.

## Verification

From the repository root, use the scoped checks recorded in the plan:

```bash
cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 src/lib/db/projects.ts src/lib/db/projects.test.ts e2e/AC-PRJ-001-projects-crud.spec.ts
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0261_pipeline_hides_archived.test.sql supabase/tests/0234*'
./scripts/e2e-local.sh AC-PRJ-001
```

The plan also requires mutation checks: removing the SQL predicate must make the pgTAP and deterministic archive journey fail, and removing the DAL `.is()` filter must make the two Vitest assertions fail. Restore the implementation before final gates.
