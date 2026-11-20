# round3-prove-a — merged-branch proof (local branch `prove`, from origin/dev 277c2c86, not pushed)

## Merge notes
Order: feat/2598-pinned-step-approver, fix/2605-stuck-pin, feat/2588-opening-balances, land/1696-erp-cancelled-pair, fix/2600-unpaid-voided, chore/2157-dead-code-2 (`--no-ff`).
- **2598**: conflicts resolved mechanically: both sides kept in `docs/specs/material-requests.spec.md` (**FR-MRQ-020..023 and AC-MRQ-020 now exist twice, once from dev #2571 and once from 2598; needs renumbering on the real merge**), both locale `project.json` files, and `supabase/tests/0178_anon_executable_definers.test.sql` (dev's list plus `mrq_set_step_pin`).
- **2588, 2598-chain**: 0178 AC-ACL-002/003 count conflicted on every branch that adds a retained name. Resolved by taking dev's list and counting names from it: **228** after the merges. Each branch will conflict here when merged to dev one after another.
- 2605, 1696, 2600: clean.
- **chore/2157-dead-code-2: SKIPPED.** Real conflict in `pmo-portal/src/lib/repositories/budgetProjection.test.ts`: the branch removed tests that dev has since extended (fiscal calendar #2329, first-spending-year). Not mechanical; the branch needs a rebase on dev.
- Migration numbers: no duplicates (new: 1045, 1046, 1047, 1056, 1120).

## Results
| Check | Result |
|---|---|
| pgTAP (full, after db reset) | FAIL: 862 files, 19409 tests, 2 files failing (below) |
| typecheck | pass |
| check:guards | pass |
| vitest (full) | 7 failed / 24151 passed / 1 skipped (4 files failed of 2267) |
| e2e consent lane | 7 passed |
| e2e serial lane | 45 passed, 63 skipped, 3 failed (Mailpit) |
| e2e chromium lane | 423 passed, 16 skipped, 7 failed |

DB reset before each lane; `CI=true`; env as ci.yml writes it. Stack started with `-x mailpit,imgproxy,logflare,vector,studio,realtime` per the brief (so no Mailpit). The served-fn smoke step and Restore step were not run separately.

## Failures
| Test | Error | Branch diff it touches | Fails on origin/dev alone? |
|---|---|---|---|
| pgTAP `0173_rpc_active_member_gate` test 61 "AC-AMG-001 completeness" | have `load_stock_opening, load_work_order_opening`, want none | **2588** (migration 1046 defines both without the active-member gate the test looks for; `assert_is_active_member` appears only in the other 3 functions) | No (functions do not exist on dev) |
| pgTAP `mrq_stuck_pin.test.sql` | planned 8 ran 7 (file has 7 assertions) | **2605** (test plan count wrong; the file is identical to the branch tip) | No (file only on 2605) |
| vitest `pages/stock/StockSisa.id.test.tsx` (no "saldo" in Bahasa) | id `stock.json` kinds.opening = "Saldo awal" | **2588** (adds that string) | No (passes) |
| vitest `test/tsconfigProjects.test.ts` x4 | `tsconfig.app.json` exclude lacks `src/lib/db/openingBalances.concurrent.integration.mjs`; run `node test/tsconfigProjects.mjs --write` | **2588** (adds that file) | No (passes) |
| vitest `src/lib/i18n/__tests__/supplierInvoiceWord.test.ts` "keeps faktur for the tax invoice only" | new id strings `invoicePairs.erpCancelled.title/help` contain "Faktur" (+7 more entries) | **1696** | No (passes) |
| vitest `checkEdgeFnErrorReporting.test.ts` unreadable-file case | CLI did not report "could not read this file" | none | **Yes**: sandbox runs as root, so a chmod-000 file is readable. Environmental |
| serial `AC-AUTH-005`, `AC-AUTHF-005`, `AC-AUTHF-020` | "Mailpit clear failed" (Mailpit excluded from the stack) | none | Environmental (Mailpit not started); not re-run |
| chromium `AC-S21-005-task-list-review` "Supporting proof..." | `S21_HANDLER_SERVER_EXITED_EARLY` | none | **Yes**: fails the same on dev alone. Environmental (needs the served handler) |
| chromium `AC-NBR-030 id @1440` (2) Receivables, (3) Invoice record | 30s test timeout in `page.route` (33s, browser closed) | none identified | Passes on dev alone **and** on the merged tree when run alone (17/17 with the stock layout tests). Load-dependent in the full run |
| chromium `AC-STOCK-LAYOUT-004` stock ledger @1024/1280/1440/1535 | `clipped: 6` of 12 cells | possibly 2588 (stock pages/locales) | Passes on dev alone and on the merged tree alone. Does not reproduce in isolation; likely depends on data or order in the full run. Not root-caused (no trace read) |

## Verdict for merging each to dev alone
- 2588 needs: active-member gate in the two `load_*_opening` functions (or a justified 0173 allowlist entry), tsconfig exclude regenerated, "Saldo awal" reworded or allowlisted in StockSisa. Plus a 0178 count rebase.
- 2605 needs `plan(8)` -> 7 or the missing 8th assertion.
- 1696 needs its Bahasa strings to avoid "Faktur" or an allowlist update.
- 2598, 2600: no failures attributable.
- 2157: rebase on dev first.
