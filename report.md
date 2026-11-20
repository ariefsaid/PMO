# release-dryrun-a — dry run of the next dev → main release PR

Run date 2026-11-20. Base: origin/dev at fetch time, merged onto local branch `dryrun-local` (not pushed).

## 1. Merge result

| Branch | Result |
|---|---|
| `origin/dev` | base |
| `origin/land/1215-r2` | **SKIPPED — non-mechanical conflict, and duplicate migration numbers** |
| `origin/land/1599-ecx4-direct-cost-accounts` | merged `--no-ff`, no conflicts, 631 migration files, `check-migration-collisions.sh`: no duplicate prefixes |

**Round 2 (`land/1215-r2`) cannot go into this release as it stands.**
- It is 248 commits off a stale merge-base. It deletes migrations dev has since added and re-uses numbers dev already owns:
  - `1045_undo_imported_purchase` vs dev `1045_mrq_step_pins`
  - `1046_cli_guard_undo_import` (renamed from `1047_cli_opening_balances`) vs dev `1046_opening_balances` / `1047_cli_opening_balances`
  - `1047_projects_collection_set_based` vs dev `1047_cli_opening_balances`
- It also deletes dev's `1100`–`1102`, `1105`, `1120` migrations, and `1030` is modified.
- Text conflict: `supabase/tests/0178_anon_executable_definers.test.sql` (the client-callable RPC name list: r2 moved the list into per-feature fragments (#2589); dev added `mrq_set_step_pin` etc. to the inline list).
- Needed: r2 must be rebased/renumbered onto current dev (`scripts/renumber-migration.sh`), and its 0178 change redone against dev's list. Merging it now would also silently delete dev migrations.

All results below are dev + ECX4.

## 2. Gate results (dev + ECX4)

| Gate | Result |
|---|---|
| `npm run check:guards` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint:ci`, `lint:scripts` | PASS |
| `npm run build`, entryPreload test | PASS |
| CI-integration-order tests + all `--self-test`s | PASS |
| python lock-wrapper tests | PASS |
| Repo script tests (`run-script-tests.mjs`) | 991 / 992 — 1 sandbox artifact (below) |
| Deno typecheck, boot smoke, `deno test` edge fns | PASS |
| pgTAP `supabase test db` | **PASS** — 870 files, 19,594 tests |
| Capture rollback harness, nightly-intent race, journal-safety rollback | PASS |
| Full vitest | 2258 / 2262 files pass, **4 files fail** (below) |
| e2e `chromium` project (450 tests, one run) | 425 pass, 16 skip, **7 fail** (3 distinct causes, below) |
| e2e `consent` | 7 / 7 PASS |
| e2e `serial` (`--workers=1`) | 49 / 49 PASS |
| served-fn adapter-dispatch smoke | NOT RUN (needs the CI secret bundle) |
| visual | no separate project exists; visual specs run inside `chromium` |
| `check-e2e-skips` | the 2 "unexplained" skips are the S21 dependents of the cold-cache failure (F7); no stale/unverified |

## 3. Failures

### A. ECX4 breaks three vitest files (all pass on dev alone; real fixes needed before release)

**A1. `src/components/integrations/ErpSetupChecklist.links.test.tsx` — 2 tests**
- Tests: "following an internal link changes the route in-app…", "the employee-review link also navigates in-app".
- Error: `Unable to find role="link" and name "Review companies"` plus unhandled `useEffectiveRole must be used within an ImpersonationProvider`.
- Isolated re-run: fails identically. On origin/dev alone: passes (2/2).
- Root cause: ECX4 renders `DirectCostAccounts`, which wraps content in `<CanWrite>` → `usePermission` → `useEffectiveRole`. That hook throws outside an `ImpersonationProvider`. The test (untouched by ECX4) renders `ErpSetupChecklist` with only a router.
- Fix: wrap the test render in the same provider (or mock `useEffectiveRole`) the sibling `ErpSetupChecklist.test.tsx` uses.

**A2. `src/lib/__tests__/entityFormModal.saveErrorCoverage.test.ts` — AC-ERR-001**
- Error: `src/components/integrations/DirectCostAccounts.tsx renders EntityFormModal, never passes submitError, and has no exemption reason.`
- Isolated: fails. Dev alone: passes.
- Root cause: new ECX4 file; a rejected save leaves only a 4-second toast.
- Fix: pass `submitError` from `useEntityForm` into the modal (preferred; that is the rule's intent), or add a justified exemption.

**A3. `src/lib/adapterSeam/contractSuite/tiers.contract.test.ts` — "AC-ECX-030 an account the ERP already holds under that name as a group, or outside the expense root, is refused in plain words and nothing is linked"** (erpnext tier)
- Error: `expected AppError: Account requires reconciliation { code: 'command-held' } to match { code: 'commit-rejected', message: /already has an account named .+ that cannot hold direct costs/ }`.
- Isolated: fails. Dev alone: passes (the suite does not exist there).
- Root cause: ECX4's newest commit ("Preserve account reconciliation and correction state") changed `connectAdapter.ts` so an existing-but-unusable account (group, or non-Expense root) throws `AppError('Account requires reconciliation', 'command-held')`. The contract suite `accountSend.suite.ts:58` was not updated and still expects `commit-rejected` with the plain-words message. ECX4's own `accountSend.test.ts:80` already expects `command-held` for the 409-duplicate path.
- Fix (ECX4 owner to choose): either update the suite to the held outcome, or have the found-but-unusable path keep `commit-rejected` with the plain-words refusal and hold only the post-create/409 paths. The user-facing wording requirement of AC-ECX-030 argues for the second.

### B. e2e `chromium` — 7 failures, 3 causes

**B1. `layout/stock.layout.spec.ts:130` AC-STOCK-LAYOUT-004 @1024/@1280/@1440/@1535** (4 tests)
- Error: `{"found":true,"cells":12,"shown":12,"clipped":6}` expected clipped 0.
- Isolated re-run on the polluted DB: fails the same. **Fails on origin/dev alone** (4/4) on the same DB. After `db reset`, the whole spec file **passes 17/17** on the merged tree.
- Root cause (from the failure screenshot): earlier specs in the same run leave stock moves whose project / work-item code is a long unbreakable token (`E2E-UMWP…`, `E2E-PIPEMWP…`); the ledger's Project / work-item cell then overflows its column. The spec reads *every* row of a shared, accumulated ledger, so it depends on what ran before it. Not caused by ECX4.
- Risk: this can also go red in the real release run (each of the 3 shards has its own DB, and the outcome depends on which stock-writing specs share its shard).
- Fix: either break the long token in the ledger cell (`overflow-wrap:anywhere`; a real product defect if a real code can be that long), or scope the spec to the rows it seeds. Not a reason to loosen the assertion.

**B2. `AC-NBR-030-no-layout-shift.spec.ts:103` "(2) Receivables: chip row holds its space until the mode lands" — en @1440 and id @1440**
- Error: `Test timeout of 30000ms exceeded` (32 s / 34 s).
- Isolated re-run: all 4 viewports pass (9–12 s). Load timeout from running the 450-test run on 4 cores; not a code defect on this tree. Could not compare on dev alone under the same load; treat as low-risk CI flake candidate (CI has 3 shards).

**B3. `AC-S21-005-task-list-review.spec.ts:124` "Supporting proof: Admin reviews the ClickUp list…"**
- Error: `S21_HANDLER_SERVER_EXITED_EARLY` (the Deno handler server exited before ready; the 2 follow-on tests were skipped).
- Isolated re-run after one `deno check` of `external-link` warmed the Deno npm cache: all 3 pass. Sandbox cold-cache artifact (CI restores the Deno cache); not a code defect.

### C. `scripts/ci-e2e-coordination.test.mjs:719` — "AC-OPS-1133-2 outcomes: one dispatch attempt leaves durable uncertainty…"
- Error: `Expected "actual" to be strictly unequal to: 0` (the `chmodRootAfterDispatch` fixture).
- Fails on isolated re-run; the file is identical to origin/dev (not from ECX4).
- Root cause: the sandbox runs as uid 0, which ignores the chmod the fixture uses to force a save failure. CI's runner is non-root. Not confirmed under a non-root user here (the copy-to-tmp attempt failed on a path dependency).

### D. `src/lib/agent/checkEdgeFnErrorReporting.test.ts` — "exits 1 and names the specific file when a function's index.ts cannot be read (unreadable-file case)"
- Fails on origin/dev alone too (same uid-0 cause: an unreadable file is readable by root). Sandbox artifact.

## 4. Verdict

For the release PR as it would be built from dev + ECX4:
- **Must fix before opening (ECX4):** A1, A2, A3 — three red vitest files that a PR-to-main `unit` run will show.
- **Must resolve (round 2):** rebase/renumber `land/1215-r2` onto current dev; it cannot merge as is.
- **Watch in the real run:** B1 (AC-STOCK-LAYOUT-004 order dependence, present on dev already).
- **Sandbox only (expect green in CI):** B2, B3, C, D.
- Not exercised: served-fn smoke (needs secrets).
