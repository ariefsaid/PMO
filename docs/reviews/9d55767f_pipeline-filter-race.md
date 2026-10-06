# AC-TAG-002 Pipeline filter race

Issue #885 updates the AC-TAG-002 Playwright journey so a debounced location filter is settled before navigation. The test now polls the URL for `location=West Java`, scopes the target to the Pipeline table, and clicks the exact accessible `Open ${deal}` button. This avoids the prior page-wide text match racing the table re-render and selecting the separately-created internal project.

The change is in `pmo-portal/e2e/serial/AC-TAG-002-project-classification.spec.ts`. The shared `openPipelineCard` helper is no longer imported by this spec; its semantics and other callers are unchanged. The later Bali filter also waits for its URL state before asserting the internal project is absent. Existing Classification-region, edit, and other goal assertions remain intact.

The implementation plan and reconnaissance are recorded in `docs/plans/2026-10-07-pipeline-filter-race-9d55767f.md`. It records that the required `origin/dev` history check found no identifiable `#885` commit, and that the caller audit found no other `openPipelineCard` use immediately after a debounced location filter.

To verify the change, run from the repository root:

```bash
npx eslint --max-warnings=0 pmo-portal/e2e/serial/AC-TAG-002-project-classification.spec.ts
cd pmo-portal && npm run typecheck
cd .. && ./scripts/e2e-local.sh AC-TAG-002 --repeat-each=3
```

The plan specifies that the focused serial journey should pass three times; no application, helper, migration, or seed changes are part of this fix.
