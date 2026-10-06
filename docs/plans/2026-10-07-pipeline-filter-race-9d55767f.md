# Plan: stabilize the AC-TAG-002 Pipeline-table drill-down

**Issue:** #885  
**Scope:** `pmo-portal/e2e/serial/AC-TAG-002-project-classification.spec.ts` only  
**No ADR:** This is an e2e journey synchronization/locator correction; it changes no application, schema, API, authorization, or cross-cutting architecture.

## Reconnaissance and decision

- `git log origin/dev --grep="#885" --oneline` completed successfully and returned no matching commit, so the issue is not identifiable as already shipped by that required history check.
- The current AC-TAG-002 journey fills `Filter by location`, whose implementation debounces its URL-owned `location` working-set update by 300 ms. Its current `getByText(deal)` condition can pass before that update and the following `openPipelineCard` is deliberately text-based for generic Kanban/card callers.
- The Sales Pipeline table supplies a semantic per-row activation button with accessible name `Open ${project.name}` through `DataTable`'s `rowLabel`. Therefore this journey can wait for the URL state that proves the final debounce committed, then activate only its named row from within the Pipeline table, without changing the shared helper.
- Caller audit: all `openPipelineCard` callers were inspected. `AC-CHG-019-project-change-history.spec.ts`, `AC-IXD-PROJ-007-lost-in-pipeline.spec.ts`, `AC-IXD-PROJ-001-canonical-record.spec.ts`, `AC-1011-win-project.spec.ts`, `AC-SP-pipeline-drilldown.spec.ts`, and `AC-PRJ-001-projects-crud.spec.ts` do not invoke it immediately after a debounced `Filter by location` update. The only matching pattern is the target AC-TAG-002 test, so no other spec changes are planned.

## Design

**Data flow:** location text input → 300 ms debounce → URL `location=West Java` working-set state → Sales Pipeline table re-render → the target row's accessible `Open <deal>` activation button → canonical project detail. The test will make the URL commit its synchronization boundary. It will use the table-scoped semantic control rather than the generic helper's page-wide text match.

**Error/race handling:** Playwright's retrying `expect.poll` will wait for `new URL(page.url()).searchParams.get('location')` to equal `West Java`; a timeout reports an unapplied debounce rather than navigating on stale rows. A table-scoped exact accessible-name locator then cannot resolve to the separately-created internal project. Existing detail-region and later edit/filter assertions remain unchanged.

**Test ownership:** AC-TAG-002 remains owned by the existing serial Playwright journey. No unit, database, application, helper, migration, or seed test is added because the product behavior is already covered; this issue corrects the journey's synchronization and target selection.

## Implementation tasks

### Task 1 — Make the AC-TAG-002 journey wait for the committed filter and open the intended table row

**Files:**
- Modify `pmo-portal/e2e/serial/AC-TAG-002-project-classification.spec.ts`

**AC coverage:** AC-TAG-002 (owning Playwright test; preserve its existing Classification-region, edit, and Projects-filter goal oracles).

**TDD-first test change:** In the existing AC-TAG-002 test, replace the post-`fill('West Java')` precondition that only asserts bare deal text and the subsequent `openPipelineCard(page, deal)` invocation with a deterministic test boundary:

1. Add a retrying assertion that polls `new URL(page.url()).searchParams.get('location')` until it is exactly `West Java`. This is the RED regression guard for the former pre-debounce race: it must fail if the delayed filter write never commits.
2. Bind a `pipelineTable` locator using `page.getByRole('table')` and, within that table, bind the row activation control with `getByRole('button', { name: \`Open ${deal}\`, exact: true })`.
3. Assert that exact table-scoped accessible control is visible (and has one match), then click it directly. This is the semantic row activation supplied by `DataTable`; do not use a bare text locator and do not call `openPipelineCard` here.
4. Remove `openPipelineCard` from this spec's helper import because it is no longer used. Leave every assertion from the `Classification` region through the cleanup path unchanged, including the later Bali filter assertions.

**Do not change:** `pmo-portal/e2e/helpers.ts`, application source, the shared helper's retry semantics, goal assertions, migrations, or seed data.

**Focused verification:**
```bash
cd pmo-portal && npx eslint --max-warnings=0 e2e/serial/AC-TAG-002-project-classification.spec.ts
```

### Task 2 — Prove the corrected serial journey and repository gates

**Files:** No additional changes.

**AC coverage:** AC-TAG-002.

1. Run type checking under the shared test lock.
2. Run the exact changed serial journey three times through the repository wrapper. Do not reset the database: this branch changes neither migration nor seed, and the wrapper already holds the shared DB lock.
3. Treat any failure as unfinished; diagnose/fix the journey without weakening its URL-settlement assertion, exact semantic target, or existing goal oracles.

**Verification:**
```bash
./scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'
./scripts/e2e-local.sh AC-TAG-002 --repeat-each=3
```

## Traceability

| Acceptance criterion | Owning layer | Owning test | Planned task |
|---|---|---|---|
| AC-TAG-002 | Serial Playwright e2e | `pmo-portal/e2e/serial/AC-TAG-002-project-classification.spec.ts` — `AC-TAG-002 classifications persist through form, detail editing, Projects and Pipeline filters` | 1–2 |

## Completion criteria

- The location filter's URL state is confirmed before the table target is queried.
- The test opens only the Pipeline table's exact `Open ${deal}` control, never a global text match or the internal project.
- The existing Classification-region and later edit/filter goal assertions are unmodified.
- No other `openPipelineCard` caller meets the same debounced-location-filter pattern; no helper or app-code change is made.
- ESLint, locked typecheck, and the three-repeat targeted e2e command all exit successfully.
