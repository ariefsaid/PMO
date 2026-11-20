# round2-prove report

Target: `land/1215-r2` @ b2b048fa844c725352f59006fcf404f09a052fbf. `git merge --no-ff origin/dev` reported "Already up to date" (origin/dev 277c2c866 is an ancestor), so the target is the tip itself, no conflicts. Duplicate migration numbers: none (checked `uniq -d` on prefixes). Docker started by hand; Supabase stack up (mailpit/imgproxy/logflare/vector/studio/realtime excluded).

## 1) DB reset + full pgTAP
- `supabase db reset`: OK (all migrations through 1113 + seed).
- Full pgTAP: Files=864, Tests=19368. **Only file failing: `0178_anon_executable_definers.test.sql`.**
  - Before the generated include exists the file dies at line 311 (`0178_anon_executable_definers.generated.inc: No such file`, "planned 8 ran 0"). The inc is gitignored and produced by `node scripts/anon-definer-inventory.mjs` (CI runs it before pgTAP, ci.yml ~l.944). Not a branch defect, only a local-run prerequisite; the plain `supabase test db` does not generate it.
  - After generating it (225 names), 3 of 8 fail. Exact output:
    - Test 5 `AC-ACL-004 no SECURITY DEFINER writer outside the client allow-list is explicitly executable by anon or authenticated (offenders are named)`: have `undo_imported_purchase`, want ``(empty).
    - Test 6 `AC-ACL-006 anonymous grants to retained client writers are named`: have `undo_imported_purchase, update_procurement_header`, want `update_procurement_header`.
    - Test 7 `AC-ACL-005 regression: the sweep catches and names a SECURITY DEFINER writer explicitly granted to anon`: have `anon_definer_write_probe, undo_imported_purchase`, want `anon_definer_write_probe`.
  - One function: **`public.undo_imported_purchase(text, text, boolean)`**, added by `supabase/migrations/1045_undo_imported_purchase.sql` (lines 133-134: `revoke ... from public, anon, service_role; grant execute ... to authenticated`), merged via feat/2321-cli-undo-import (merge commit 221345532); 1046 adds the CLI guard. It is a SECURITY DEFINER writer with an authenticated grant, but it is not in any fragment under `supabase/tests/inventory/anon-executable-definers/` (grep: only the migrations, rollback, scripts/pmo-purchases*, isolation-probe legacy.json mention it). Fix: add it to a fragment (e.g. a new `2321-undo-import.txt`) after confirming it is intended client-callable, or revoke authenticated if the CLI uses a different role. The single missing name explains all three assertions (each is the same offender set). Not present on origin/dev (1045 does not exist there).

## 2) pmo-portal
- `npm ci`: OK. `npm run typecheck`: pass (exit 0, all 4 projects).
- `npm run check:guards`: **FAIL**: `workOrders: EN/ID key parity differs` (i18n gate). Cause: commit 75898f33e (work-order page: issues and open tasks) renamed/added en keys (`issues.*`, `openTasks.*`) while the id catalogue `public/locales/id/workOrders.json` kept the old `issuesTasks.*` keys; the merge adf07b3de (fix/id-strings-landing) did not reconcile.
- `npm test` (full vitest): Test Files 4 failed | 2248 passed | 1 skipped; Tests 4 failed | 23940 passed | 1 skipped.
  1. `pages/WorkOrderDetail.test.tsx` AC-WORP-011 id catalogue has every English key: id has 57 keys vs en 65, same root cause as the guard (`issuesTasks.*` vs `issues.*`/`openTasks.*`). Branch: 75898f33e. Passes on origin/dev.
  2. `src/lib/adapterSeam/contractSuite/tierBranch.test.ts` AC-ECA-043 allowlist "nothing new, nothing stale": `pmo-portal/src/hooks/useEquipment.ts: 1` is stale (received count omits it) after refactor 365a58b31 (2157, one owner for useOrgId and likeAny) removed that tier-name branch. Fix: drop the entry from the ALLOWED map. Passes on origin/dev.
  3. `src/lib/i18n/__tests__/supplierInvoiceWord.test.ts` (id never says "tagihan/faktur supplier"): `equipment.json.availability.invoiceAmount` "Jumlah tagihan supplier", `workOrderPva.json.source.vendor_bill` and `workOrders.json.costs.source.vendor_bill` "Tagihan supplier", all introduced by a733376a0 (fix/id-strings-landing). Fix: "invoice supplier". Passes on origin/dev.
  4. `src/lib/agent/checkEdgeFnErrorReporting.test.ts` "exits 1 and names the specific file when a function's index.ts cannot be read": **also fails on origin/dev alone** (re-run there: same single failure). Environment artifact: the sandbox runs as root, so the test's unreadable-file setup does not make the file unreadable, and the CLI reports the real finding for `erpnext-sweep/index.ts` (no `withJobRun` wrapper per the output text) instead of "could not read this file". Not a branch regression (erpnext-sweep is not touched by this branch, git log origin/dev..HEAD empty). Note the output also shows a real rule violation on erpnext-sweep that exists on dev; worth a separate look.

## 3) Browser suite (CI=true, DB reset before each lane; chromium 3 shards, consent, serial)
Totals: chromium shard1 149 pass/3 fail; shard2 156 pass/8 fail (2 did not run); shard3 163/0; consent 7/0; serial 49 pass/4 fail. Failed specs were re-run on a fresh reset at the target, and the ones whose specs exist on origin/dev were re-run on origin/dev.

Failing in the lane but **PASS on rerun (flaky or order/load dependent, no root cause shown by the rerun)**: AC-IMT-014 (180 s timeout, passes on isolated rerun), AC-NBR-030 `id @1440 (3) Invoice record` and `id @390 (2) Receivables` (30 s timeouts; also pass on origin/dev), AC-WPVA-016 (row not visible in the lane, passes on fresh DB and on origin/dev), JOB-W10 (lane: stayed on `/stock/new/return`; passes on rerun).

**Persistent failures at the target (reproduce on fresh DB); none of these spec files exist on origin/dev, so there is no dev baseline** (all arrive with the contractor-job-journeys specs, commits 46f4ff40b / e31642cee / a04647aa5 and fixtures `e2e/support/jobFixtures.ts`):
- JOB-BQ5 reconcile item through stages: `PostgrestError: this work order is Issued and its content can no longer be changed ... issued_at ...` at spec line 20 (`admin.from('work_orders').update({order_value: 1_000_000})` on a fixture work order). A work-order immutability trigger (issued content lock, ERPNext idempotency stamp) rejects the fixture's edit: fixture and a merged migration disagree.
- JOB-PU10 cash advance: `submit claim: this is above the procurement limit of 25000.00 for site cash` at the spec's rpc call (line 101): fixture amount exceeds a merged site-cash limit rule.
- JOB-T1 task/subtask/dependency: teardown `dropProject` (jobFixtures.ts:111) fails with `column task_dependencies.project_id does not exist`: the fixture cleanup queries a column the merged schema no longer has.
- JOB-M1: expects `Over plan by 50.00`, page renders `$200.00Over plan by $50.00`: the expectation omits the currency symbol, i.e. the spec's text oracle is out of step with the merged money formatting (assertion line 49).
- JOB-PC2: `getByTestId('cost-total-equipment_usage')` not found though `cost-group-equipment_usage` is visible: the work-order cost view renders the group without the per-group total testid (merge 75898f33e touches this page).
- AC-S21-005 task-list-review (also c2): `S21_HANDLER_SERVER_EXITED_EARLY` (support/AC-S21-005-runtime.mjs:18). **Also fails on origin/dev alone**: sandbox (handler child process), not the branch.
- serial: AC-AUTH-005, AC-AUTHF-005, AC-AUTHF-020 fail with `ECONNREFUSED 127.0.0.1:54324` (Mailpit): **my stack deliberately excluded mailpit** per the brief, so these are not valid signals; rerun with Mailpit on. serial JOB-M3 `approvals-queue-region ... 'within budget' toHaveCount(0)` failed: the within-budget request is visible in the Director's queue (approval-limit routing); spec is new in this branch, no baseline.
- Test results/trace dirs were in /tmp/pmo-portal-test-results (not published).

## Summary of what blocks the merge
1. Missing inventory fragment for `undo_imported_purchase` (1045), causes the 3 pgTAP assertions.
2. Bahasa catalogue work: `workOrders.json` key parity (guard + AC-WORP-011) and three "tagihan supplier" strings (supplierInvoiceWord).
3. Stale `useEquipment.ts` entry in the tierBranch allowlist.
4. The new JOB-* e2e journeys (BQ5, PU10, T1, M1, PC2, serial M3) fail against the merged schema/formatting; AC-S21-005 and the checkEdgeFnErrorReporting unit test fail the same way on origin/dev.
Not verified: whether JOB-* failures are fixture-side or app-side beyond the error lines above; no trace analysis beyond the error context.
