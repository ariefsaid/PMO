# Lock-order comments and e2e DB-lock re-entrancy

Issue #822 updates the local lock tooling so its comments match the binding acquisition order and nested e2e runs reuse an inherited DB lock.

## What changed

- `scripts/e2e-local.sh` now re-executes through `with-db-lock.sh` only when neither its own `_E2E_LOCAL_LOCKED` recursion sentinel nor the inherited `PMO_DB_LOCK_HELD` flag is present. A caller that already owns the DB lock therefore runs both Playwright phases in the existing hold instead of trying to acquire the same lock again.
- `scripts/with-db-lock.sh`, `scripts/lib/flock-run.sh`, and `scripts/with-erpnext-lock.sh` now describe the order as `erpnext → db → test`. The ERPNext wrapper’s example was also corrected to wrap the DB wrapper.
- `scripts/parallel-infra.test.mjs` adds `AC-822-002`, a self-contained temporary-repository regression test. It copies the shipped wrappers, uses fake Docker/Supabase/npx commands, runs e2e-local under an outer DB hold, and verifies a successful run, exactly one acquisition record, and both default Playwright invocations.
- `docs/plans/2026-10-06-lock-reentrancy-822.md` records the acceptance criteria, implementation scope, and verification commands.

## Verification

From the repository root, run:

```bash
node --test scripts/parallel-infra.test.mjs
bash -n scripts/e2e-local.sh scripts/with-db-lock.sh scripts/lib/flock-run.sh scripts/with-erpnext-lock.sh
```

The plan also records the final locked typecheck, lint, and changed Vitest command. The regression test is designed to fail before the `PMO_DB_LOCK_HELD` guard because the nested wrapper reaches its one-second lock timeout.