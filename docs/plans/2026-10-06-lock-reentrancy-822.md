# Issue #822 — Lock-order documentation and e2e DB-lock re-entrancy

## Scope and traceability

The issue itself supplies the two acceptance statements below; identifiers are introduced here only
for test traceability because no separate `docs/specs/` file exists for this focused tooling fix.

| ID | Acceptance criterion | Owning proof |
| --- | --- | --- |
| AC-822-001 | Lock-wrapper comments describe the binding outermost-to-innermost order as `erpnext → db → test`, with ERPNext outermost, DB in the middle, and test innermost. | Direct review of the three corrected script headers; `bash -n` verifies the comment-only edit did not damage shell syntax. |
| AC-822-002 | Given `e2e-local.sh` is invoked by `with-db-lock.sh`, when the wrapper exports `PMO_DB_LOCK_HELD=1`, then the e2e runner completes its stubbed two Playwright phases without attempting a second DB-lock acquisition. | New Node self-test in `scripts/parallel-infra.test.mjs`. |

## Design

`flock-run.sh` already exports the per-lock held variable to the command it runs. The defect is
local to `e2e-local.sh`: its re-exec guard only recognizes `_E2E_LOCAL_LOCKED`, a recursion sentinel
it creates itself, and ignores the wrapper's `PMO_DB_LOCK_HELD=1` contract. A caller that already
owns the DB mutex therefore causes the runner to invoke `with-db-lock.sh` again and block against
its parent.

Keep the existing default behavior for direct invocations: the first `e2e-local.sh` process sets
`_E2E_LOCAL_LOCKED=1` and re-execs through `with-db-lock.sh`. Extend that guard so it does this
only when both (a) it is not its own post-re-exec process and (b) `PMO_DB_LOCK_HELD` is unset. When
a parent wrapper supplied the held flag, execute the body in that same lock hold. This preserves the
single-lock ownership model and does not make raw nested wrapper calls re-entrant.

The regression test belongs in the existing CI-wired `scripts/parallel-infra.test.mjs`; it requires
no Docker, Supabase instance, real Playwright server, `.env.local`, or real lockfile. It will build a
temporary miniature repository containing runtime copies of the shipped e2e/DB-lock scripts and
minimal fake `docker`, `supabase`, and `npx` commands. It invokes the copied e2e runner through the
copied DB wrapper with a one-second lock timeout. The outer wrapper's real `flock-run.sh` exports
`PMO_DB_LOCK_HELD=1`; the fixed runner bypasses a second wrapper, reaches both fake Playwright
phases, and returns zero. The pre-fix runner attempts a second lock and exits 75 after the timeout,
so the test is a true RED-to-GREEN regression proof rather than a source-text assertion.

No schema, API, UI, dependency, package-lock, security boundary, or architectural decision changes.
No ADR is required.

## Implementation plan

### Task 1 — Add the failing nested-DB-lock self-test (TDD RED)

**Files:** `scripts/parallel-infra.test.mjs`

**AC:** AC-822-002

1. Add constants for `scripts/e2e-local.sh` and `scripts/with-erpnext-lock.sh` only if the test
   needs them; use the existing `SCRIPTS`, DB-wrapper, temp-directory helpers, `spawnSync`, and
   child-result diagnostics rather than introducing a second test harness.
2. Add a Node test named `AC-822-002: e2e-local reuses an inherited DB lock without re-acquiring it`.
   In a `withTempAsync` directory, create `scripts/lib/`, `pmo-portal/`, and `fake-bin/`; copy the
   live `e2e-local.sh`, `with-db-lock.sh`, and `lib/flock-run.sh` into the corresponding temporary
   `scripts/` paths and set executable modes on the copied shell scripts.
3. Write fake executables into `fake-bin/`: `docker` prints `1` for the seed-org probe; `supabase`
   prints shell-safe dummy `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` assignments for
   `status -o env`; and `npx` appends its arguments to a temp log then exits zero. These stubs must
   neither contact Docker/Supabase nor read/write the real repository's `.env.local`.
4. Run the copied `with-db-lock.sh` around the copied `e2e-local.sh` with `PMO_DB_LOCK` pointing to a
   temporary lockfile, `PMO_DB_LOCK_TIMEOUT=1`, the fake bin directory prepended to `PATH`, and the
   fake-`npx` log location in the environment. Assert the command exits zero, stderr contains exactly
   one `ACQUIRED` record (the outer hold only), and the log contains the two default Playwright phase
   invocations. On current code this must fail with the inner lock timeout (exit 75).

**Verify RED:** `node --test scripts/parallel-infra.test.mjs`

### Task 2 — Honour the inherited DB-lock flag before e2e-local re-execs (TDD GREEN)

**Files:** `scripts/e2e-local.sh`

**AC:** AC-822-002

1. Change the re-exec condition immediately above the `exec "$REPO/scripts/with-db-lock.sh" ...`
   call so it enters only when `_E2E_LOCAL_LOCKED` is not `1` **and** `PMO_DB_LOCK_HELD` is empty.
   Keep setting `_E2E_LOCAL_LOCKED=1`, preserving `--reset`, and the existing re-exec command exactly
   inside that branch.
2. Update the adjacent comment to say the script takes the DB lock only when no caller already holds
   it; identify `PMO_DB_LOCK_HELD` as the `flock-run.sh` child-environment contract and
   `_E2E_LOCAL_LOCKED` as recursion protection.
3. Do not change reset behavior, phase selection, generated local environment behavior, lock timeout
   semantics, or the generic raw-nested-wrapper prohibition in `flock-run.sh`.

**Verify GREEN:** `node --test scripts/parallel-infra.test.mjs`

### Task 3 — Correct all three stale lock-order explanations and invocation example

**Files:** `scripts/with-db-lock.sh`, `scripts/lib/flock-run.sh`, `scripts/with-erpnext-lock.sh`

**AC:** AC-822-001

1. In `scripts/with-db-lock.sh`, replace the claim that DB is outermost/first with DB as the middle
   lock: acquire ERPNext first when required, then DB, with the test lock innermost.
2. In `scripts/lib/flock-run.sh`, replace `(db is outermost; test is innermost)` with the complete
   correct role description: ERPNext is outermost, DB is between it and test, and test is innermost.
   Retain the existing `erpnext -> db -> test` heading and re-entrancy explanation.
3. In `scripts/with-erpnext-lock.sh`, describe ERPNext as outermost and update its money-e2e example
   to nest `with-erpnext-lock.sh` around `with-db-lock.sh` around `serve-functions.sh`, matching the
   stated order. State that DB is next and test is innermost when it is also needed.
4. Do not alter lock paths, timeouts, wrapper arguments, `flock-run.sh` Python locking behavior, or
   `with-test-lock.sh`; this task repairs only contradictory comments/example ordering.

**Verify:** `bash -n scripts/with-db-lock.sh scripts/lib/flock-run.sh scripts/with-erpnext-lock.sh && node --test scripts/parallel-infra.test.mjs`

## Final verification

Run from the repository root after all tasks are green:

```bash
node --test scripts/parallel-infra.test.mjs
bash -n scripts/e2e-local.sh scripts/with-db-lock.sh scripts/lib/flock-run.sh scripts/with-erpnext-lock.sh
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 ../scripts/parallel-infra.test.mjs && npx vitest run --changed origin/dev'
```

The first command is also executed by CI's `Parallel-agent infra tests` step. No DB reset, real e2e
run, migration, `.env` read, or package-lock regeneration is part of this issue.
