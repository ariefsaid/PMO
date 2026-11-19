# Plan — verify, then remove dead code (#2157)

- **Issue:** #2157 "Cleanup: verify, then remove dead code and duplicated helpers" (map: #1533 Engineering health).
- **Blocked by:** #2042 (UI library swap). **Still OPEN on 2026-11-15** (checked with the issues API). The ticket
  says this work runs after #2042 lands because both touch the same screens. See Open question Q1.
- **Evidence baseline:** `origin/dev` at `1e98c792` (2026-11-15). Every result below was produced on that commit.
  Re-run the scanners (Appendix A) on the build branch's base before each slice; a moved `dev` can change a verdict.
- **Kind of work:** deletion only. No behaviour change, no route change, no schema change, no new tests.
- **Executor:** Orca worker per slice (`docs/orca-dispatch.md`), role contract `implementer`. S8 touches money-path
  modules and ships alone (CLAUDE.md "Money, SoD and auth changes ship alone").

## 1. Scope

### In scope (this plan)
Candidates R1, R2, R4, R5, R6, R7, R9, R15 from the ticket, plus items of the same class found by the scanners.

### Out of scope (from the ticket)
- **R3** budget paste-rows (`src/hooks/useBudgetPasteRows.ts`, `src/lib/budget/pasteRows.ts`): "Do not delete".
  Re-verified **STILL USED**: `pages/ProjectBudget.tsx:65` imports `pages/project-budget/BudgetPasteRowsDialog.tsx`,
  which imports `useBudgetPasteRows` (line 18), which imports `lib/budget/pasteRows` (line 8).
- **Decided patterns** (ADR-0016/0017/0018/0019: repository layer, `can()`, form primitives, outbox/sweep, adapters):
  only members with zero callers are removed; no pattern is collapsed.

### Out of scope (this plan's decision — not deletions)
- **R10, R11, R13, R14, R16, R20** are behaviour-preserving *refactors* (deduplicate helpers, one JWT helper, one
  rollback script, one `deno.json`, drop `export`). They change code that runs, so they need their own plan with their
  own tests; they are not dead-code deletions. See Q12.
- **R19** legacy route aliases (`App.tsx:385` `/home`, `App.tsx:323-330` `/sales/:id`, redirect helpers at 344/362):
  **STILL USED** — they are served redirects for bookmarked and emailed links, and `App.tsx:545` says "do NOT tidy it
  away". Not dead code.
- **R12** scripts with no code reference and **R17/R18** dev dependencies: verdicts below are UNSURE; nothing is
  removed until the owner answers Q9–Q11.

## 2. Method (how each verdict was decided)

Each verdict rests on all of the following. Scopes are stated because a negative from a grep is only as good as its
scope.

| # | Check | Exact scope | Command |
|---|---|---|---|
| E1 | Module import graph (static `import`/`export … from`, `import('…')`, `require`, `vi.mock`/`vi.importActual`, `import("…")` types) | every file in the `pmo-portal/tsconfig.json` program (3,934 files: app root, `pages/`, `components/`, `src/`, `e2e/`, `evals/`, `test/`, configs) | Appendix A.1 `graph.mjs` |
| E2 | External references to a `pmo-portal/` path | every tracked file under `supabase/` (edge functions incl. Deno tests), `scripts/`, `.github/`, `.githooks/`, `.claude/hooks/`, plus `pmo-portal/package.json`, `vite.config.ts`, `vitest.eval.config.ts`, `playwright.config.ts`, root `package.json`; `*.md` excluded | Appendix A.1 (second step) |
| E3 | Symbol-level importers, following barrel re-exports | all tracked `*.ts/*.tsx/*.mjs/*.mts` in the repo (app, `supabase/functions`, `scripts`), aliases `@/` and relative paths resolved | Appendix A.2 `syms.mjs` |
| E4 | Repository contract members, by the TypeScript checker (property access + destructuring resolved to the declaring member) | the `pmo-portal/tsconfig.json` program; Deno code does not import `src/lib/repositories` (E3) | Appendix A.3 `members.mjs` |
| E5 | Name grep | `git grep -nI -w <name> -- . ':!docs/' ':!pmo-portal/package-lock.json'` (whole repo minus `docs/` and the lockfile); `docs/` searched separately where noted | inline |
| E6 | Dynamic / string-built paths | `git grep -nI "import.meta.glob" -- pmo-portal ':!*.md'` → **no hits**; all route chunks are literal `lazyWithPreload(() => import('./pages/…'))` in `App.tsx:89-132` (captured by E1); `vitest.eval.config.ts:29` includes `evals/cases/**/*.eval.ts` (so eval cases are live) | inline |
| E7 | CI / gate readers of source files by path | `scripts/check-dashboard-tiles.mjs:134` reads `src/lib/analytics/eventCallSites.ts`; `scripts/check-i18n-completeness.mjs:58` reads `src/lib/i18n/launch-scope-routes.txt` and **throws** when it names a missing file (`:1104`) | inline |
| E8 | Open issues naming the candidate | `gh api -X GET search/issues -f q='repo:ariefsaid/PMO is:issue is:open <name>'` | inline |
| E9 | Trial removal | scratch worktree off `origin/dev`, file-level candidates of S1–S5 deleted, then `npm run typecheck`, `npm run check:guards`, eslint, the edited vitest files, `npm run build`, `node scripts/affected-e2e.mjs`; worktree discarded | §2.1 |

There is no knip/ts-prune in the repo (`grep -nE 'knip|ts-prune' pmo-portal/package.json` → no hits); E1–E4 are
the bundler-independent equivalent, and E9's `tsc --noEmit` + `vite build` are the compiler's and bundler's view.

**Not reachable by any check above:** a person running a file by hand. That is why scripts and `.mjs` proofs are
UNSURE, not dead.

**Shallow history caveat:** the clone is shallow (`git rev-parse --is-shallow-repository` → `true`, earliest commit
2026-10-20), so last-touched dates are not used as evidence.

### 2.1 Trial removal result (E9)

Deleted in the scratch worktree: every file listed for S1–S5 below, plus the 18 types from `types.ts`.

1. `tsc --noEmit` → **exactly 4 errors**, all in mixed test files that also cover shipped code:
   - `pages/__tests__/Dashboard.drillthrough.test.tsx(210)` → `FinanceDashboard`
   - `pages/__tests__/ExecutiveDashboard.bahasa.test.tsx(5)` → `ProjectedMarginBars`
   - `src/components/ui/__tests__/icons.test.tsx(12)` → root `components/icons`
   - `src/components/ui/__tests__/motion1970.test.tsx(5)` → `useExitPresence` (kept by this plan, see R6)
   No production file errored.
2. After the surgical edits in S1/S4/S5: `npm run typecheck` exit 0 (0 errors); eslint on the 7 edited files exit 0
   (after dropping 4 now-unused imports in the Bahasa test); `npx vitest run` on the 6 edited test files → 6 files,
   38 tests passed; `npm run build` exit 0.
3. `npm run check:guards` failed until three non-code files were edited:
   - `launch-scope-routes.txt` line 46 names `BvACard`, `AtRiskProjectsLink`, `ProjectedMarginBars`,
     `StillToInvoiceCard`, `AwaitingApprovalTile`, `components/DeliveryPctChip.tsx` → the gate throws
     `route "/" names "…", which does not exist`.
   - 52 catalogue keys become orphaned (gate: "present in the en catalogue, referenced by no source file") — listed in
     Appendix B. They live in `public/locales/{en,id}/common.json` and 5 of them in `public/locales/{en,id}/dashboard.json`.
   - `scripts/i18n-common-key-allowlist.json` then reports `stale common-key allowlist entry:
     dashboard.stillToInvoice.daysSinceAcceptance`.
   With all three edited: `check:guards` exit 0. Baseline on unmodified `dev`: exit 0.
4. `node scripts/affected-e2e.mjs`: with the code-only diff → **"Selected 0 of 211 specs."** With the locale catalogue
   edits added → 153 of 211 (shared catalogues fan out to every route), above the 40-spec local cap. See the e2e gate
   in S4/S5.

## 3. Verdicts per candidate

Legend: **CONFIRMED DEAD** = no production importer under E1–E4 and the trial removal compiles; **STILL USED**
(by what); **UNSURE** (why). Line counts are `wc -l` on `dev@1e98c792`.

### R1 — `FinanceDashboard` and what only it uses
| File | Lines | Verdict | Evidence |
|---|---|---|---|
| `pmo-portal/src/components/dashboard/FinanceDashboard.tsx` | 553 | CONFIRMED DEAD | E1: importers are test files only (`Dashboard.drillthrough.test.tsx:210`, 4 own tests). E5: other hits are comments (`budget-snapshot.ts:19`, `budget-snapshot.varianceSign.test.ts:4,10`, `Dashboard.drillthrough.test.tsx:102`). The `/` route renders `pages/ExecutiveDashboard.tsx` → `CompanyDashboard` for Finance (`ExecutiveDashboard.tsx:11`). E8: #2093 cites `FinanceDashboard.tsx:116` (a fix bullet, not a consumer) — Q3. |
| `pmo-portal/src/components/dashboard/AwaitingApprovalTile.tsx` | 98 | CONFIRMED DEAD | E1: only production importer is `FinanceDashboard.tsx`. Named in `launch-scope-routes.txt:46`. No e2e uses its test ids (scanned every `data-testid` in S4/S5 files against `pmo-portal/e2e/**`: no hits). |
| `pmo-portal/src/components/dashboard/DoneNotYetBilledCard.tsx` | 41 | CONFIRMED DEAD | E1: only importer `FinanceDashboard.tsx`; no tests. |
| `pmo-portal/src/components/dashboard/procurementStatusTone.ts` | 51 | STILL USED | Used by `FinanceDashboard.tsx` today; after S5 it is the `toneFor` fixture of `StatusBarChart.test.tsx` and `StageSegments.test.tsx` (tests of shipped components) and listed in `vite.config.ts:74`. Kept. |

### R2 — prototype leftovers
| Item | Lines | Verdict | Evidence |
|---|---|---|---|
| `pmo-portal/data/mockData.ts` | 375 | CONFIRMED DEAD | E1: zero importers. E5: `git grep -nI "data/mockData\|/mockData'"` outside `docs/` → no hits; `mockData` elsewhere is a local variable in `LossBreakdown.test.tsx`. |
| 18 exports of `pmo-portal/types.ts`: `CompanyType`, `Company`, `User`, `Project`, `Kpi`, `ProcurementItem`, `ProcurementQuotation`, `ProcurementDocument`, `Procurement`, `BudgetCategory`, `BudgetVersion`, `BudgetLineItem`, `TimesheetEntry`, `Timesheet`, `TaskStatus`, `Task`, `IncidentSeverity`, `HSEIncident`, `ProjectDocument` (lines 17-27, 37-71, 88-159, 168-203, 207-235) | 169 | CONFIRMED DEAD | E3 (AST of every import from `types`): each is imported only by `data/mockData.ts` or by nothing; none is imported from `e2e/`, `supabase/`, `scripts/`, `evals/` (`git grep -nI "from ['\"][./]*types['\"]" -- pmo-portal/e2e supabase/functions scripts pmo-portal/evals` → no hits). |
| `types.ts` enums `ProjectStatus`, `UserRole`, `ProcurementStatus`, `TimesheetStatus` | — | STILL USED | e.g. `App.tsx`, `pages/Timesheets.tsx`, `src/lib/listWorkingSet.ts`. Kept. |
| `pmo-portal/components/Card.tsx` (root, not `src/components/ui/Card.tsx`) | 17 | CONFIRMED DEAD | E1: zero importers; all `Card` imports resolve to `src/components/ui/Card.tsx`. |
| `pmo-portal/components/icons.tsx` (root legacy shim) | 38 | CONFIRMED DEAD | E1: only importer `src/components/ui/__tests__/icons.test.tsx:12` (test `UIP-001: all 25 legacy named icon exports remain facade-backed shims`); every app `Icon` import resolves to `src/components/ui/icons.tsx`. |

### R4, R5
| File | Lines | Verdict | Evidence |
|---|---|---|---|
| `pmo-portal/pages/project-detail/budget/BudgetSummary.tsx` | 187 | CONFIRMED DEAD | E1: no importer. Only references: `vi.mock('../project-detail/budget/BudgetSummary', …)` in `pages/__tests__/ProjectBudget.a11yNames.test.tsx:54` and `ProjectBudget.lineItemResilience.test.tsx:84` (mocks of a module `ProjectBudget.tsx` no longer imports). |
| `pmo-portal/src/components/dashboard/BvACard.tsx` | 104 | CONFIRMED DEAD | E1: only importers are its 3 tests. Comment references to fix: `src/components/ui/ProgressBar.tsx:26`, `src/components/ui/ProjectNameLink.tsx:19`, `src/lib/dashboardConstants.ts:17`. `supabase/migrations/0032_fix_top_projects_spent.sql:93` also names it in a comment — **left as is** (shipped migrations are never edited). Named in `launch-scope-routes.txt:46`. |

### R6 — orphan UI files
| File | Lines | Verdict | Evidence |
|---|---|---|---|
| `pmo-portal/components/DeliveryPctChip.tsx` | 31 | CONFIRMED DEAD | E1: only `components/__tests__/DeliveryPctChip.test.tsx`. In `launch-scope-routes.txt:46`. |
| `pmo-portal/src/components/dashboard/AtRiskProjectsLink.tsx` | 32 | CONFIRMED DEAD | E1: only its own test. In `launch-scope-routes.txt:46`. |
| `pmo-portal/src/components/dashboard/ProjectedMarginBars.tsx` | 81 | CONFIRMED DEAD | E1: only tests (`ProjectedMarginBars.test.tsx`, `__tests__/ProjectedMarginBars.d1.test.tsx`, one render inside `pages/__tests__/ExecutiveDashboard.bahasa.test.tsx:45-50`). In `launch-scope-routes.txt:46`. |
| `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx` | 131 | CONFIRMED DEAD | E1: only its 2 tests. In `launch-scope-routes.txt:46`. |
| `pmo-portal/src/components/ui/useExitPresence.ts` | 26 | UNSURE | E1: only `motion1970.test.tsx`. E8: #2130 says exit animations are "deferred" and "would need `useExitPresence`" — an announced future caller. Kept (Q4). |
| `pmo-portal/src/components/dashboard/restructure/NeedsYouList.tsx` | 75 | UNSURE | E1: only its own test; but it was edited by two fixes on 2026-11-13 and #2086 lists `NeedsYouList.tsx:55` for a fix. Looks like in-flight restructure work. Kept (Q5). |
| `pmo-portal/src/components/integrations/odoo/OdooItemPicker.tsx` | 57 | UNSURE | E1: only its 2 tests (AC-ODC-040). Odoo map work; no open issue names it (E8: 0). Kept (Q6). |

### R7 — libraries whose only caller is their own test
| File | Lines | Verdict | Evidence |
|---|---|---|---|
| `pmo-portal/src/lib/budget-snapshot.ts` | 53 | CONFIRMED DEAD | E1/E5: only `src/lib/budget-snapshot.test.ts`, `src/lib/__tests__/budget-snapshot.varianceSign.test.ts`. |
| `pmo-portal/src/lib/procurement-summary.ts` | 64 | CONFIRMED DEAD | only `src/lib/procurement-summary.test.ts`. |
| `pmo-portal/src/lib/sumPerCurrency.ts` | 13 | CONFIRMED DEAD | only `src/lib/sumPerCurrency.test.ts`. |
| `pmo-portal/src/lib/analytics/eventCallSites.ts` | 52 | STILL USED | read by CI gate `scripts/check-dashboard-tiles.mjs:134` (E7). |
| `pmo-portal/src/auth/agentRoles.ts` | 9 | STILL USED | imported by `supabase/functions/agent-chat/{actions,agentCan,draftInvoice,overdue}.ts` (E2). |
| `pmo-portal/src/lib/figures/identity.ts` | 12 | STILL USED | type import by the figure-agreement gate harness `src/test/figureAgreementRoutes.tsx:10`. |
| Test infrastructure flagged by E1 (fakes, fixtures, `testkit`, `Harness`, `*.contract.ts`, `contractSuite/**`, `*.harness.ts`, `src/lib/testing/**`, `evals/**`) | — | STILL USED | imported by tests or included by `vitest.eval.config.ts:29`; test support is not dead code. |
| `src/lib/db/budgets.postgrest-proof.mjs` (33), `budgets.allocation-proof.mjs` + `.test.mjs` (158+66), `stockPosting.concurrent.integration.mjs` (226), `vendorWithholdingSlips.concurrent.integration.mjs` (96) | — | UNSURE | no code or CI reference (E1/E2); the last two are named as hand-run proofs in `docs/plans/2026-10-08-vendor-withholding-slip.md`, `2026-10-19-v024-engineering-health.md`, `2026-10-31-inventory-project-consumption.md`. Kept (Q11). |

### R8 — adapter-seam helpers (verify with extra care)
| Item | Verdict | Evidence |
|---|---|---|
| `src/lib/adapterSeam/capabilityMap.ts` (file) | STILL USED | imported by `supabase/functions/adapter-dispatch/index.ts`, `…/procurementGateGuard.ts`, `supabase/functions/external-set-company/connect.ts`. Its export `assertDomainInCapabilityMap` is test-only → UNSURE (adapter seam). |
| `src/lib/adapterSeam/odoo/assets/*` | STILL USED | `adapter.ts` imported by `supabase/functions/adapter-dispatch/odooEquipment.ts`. |
| `src/lib/adapterSeam/clickup/vaultCredentials.ts` (21) | UNSURE | referenced only by Deno tests `supabase/functions/adapter-dispatch/clickupVaultResolution.test.ts`, `supabase/functions/clickup-sweep/perOrgSweep.test.ts`. |
| `src/lib/adapterSeam/odoo/resolvers.ts` (29) | UNSURE | only its test; its header says "what later slices ask of the one-time mapping (AC-ODC-071)" — an announced future caller. |
| `src/lib/adapterSeam/odoo/revenue/errors.ts` (58) | UNSURE | only its test; Odoo revenue failure classification (money path). |
| Test-only constants in `odoo/purchase/constants.ts`, `odoo/revenue/constants.ts`, `erpnext/workflowDeclarations.ts` `ERPNEXT_WORKFLOWS`, `router.ts` `EMPTY_OWNERSHIP_MAP` | UNSURE | adapter declarations; keep until the Odoo/ERP map owner rules (Q7). |

### R9 — production functions reachable only from tests (symbol level)
E3 found 100 exports with no production importer, imported by tests, and not used inside their own file (1,825 L
including R1–R7 files); 61 more with no importer at all (761 L, mostly `export default` duplicates of a used named
export, shadcn-vendored `reui/` internals and `icons.tsx` shims — not removed here). The six the ticket names are all
**CONFIRMED DEAD**: `archiveStockItem` (`src/lib/db/stockMaster.ts:86`), `isLegalWorkOrderTransition`
(`src/lib/db/workOrders.ts:140`), `capMessage` (`src/lib/subcontracts/subcontractRules.ts:89`),
`moneyTotalsFigure` (`src/lib/dashboardMoney.ts:73`), `parseFxDate` (`src/lib/import/fxRateParser.ts:139`),
`checkTotal` (`src/lib/adapterSeam/odoo/revenue/moneyHeader.ts:37`). The full CONFIRMED set is the S6/S8 tables.
Classified out of the slices:

| Symbol | Verdict | Why |
|---|---|---|
| `deriveProjectionCell` (`src/lib/budget/budgetProjection.ts:149`) | STILL USED | the oracle of the AC-BUD-054 invariant test `src/lib/adapterSeam/erpnext/budgetNeverPushesProjection.test.ts:23` ("the projection never reaches ERP"), which tests shipped `budgetToBody`. |
| `budgetVersionVariant` (`src/lib/status/statusVariants.ts:163`) | UNSURE | pinned by guard `src/lib/__tests__/statusRegistry.guard.test.ts:56` (AC-G3D-GUARD-1); removing it means removing a guard — Director decides. |
| `ApprovalsQueue` (`pages/timesheets/ApprovalsQueue.tsx:273`, 150 L, 7 tests) | UNSURE | the in-page timesheet SoD queue; the file's `TimesheetApprovalPreview` is live (`pages/Approvals.tsx:11`). SoD-adjacent → ships alone if retired (Q8). |
| `ProcurementListRow` (`pages/procurement/ProcurementListRow.tsx:294`), `useDocumentViewer` (`src/components/documents/viewerContext.ts:18`), `FigureGroup` (`restructure/FigureGroup.tsx:45`) | UNSURE | wrappers used by 3–6 tests each or restructure in-flight files; need a reader, not a scanner. |
| Test seams: `__testOnlyRunStartedAtSize`, `resetActiveLocale` (87 tests), `resetRecordFolderToastSession`, `stockBed`, `ISSUE_INTENT`, `NAMESPACES`, `M365_ERROR_CODES`, `STATUS_RECORDS`, `ALL_REGISTRY_VARIANTS`, `COMPANIES_/CONTACTS_DIRECTORY_PAGE_SIZE`, `ERP_SUBMIT_MAX_IN_FLIGHT_MS`, `EVENT_PRODUCERS` | STILL USED | deliberate exports for tests or gates. |

### R15 — repository members nothing calls
E4 (TypeScript checker, whole program): 16 members of `*Repository` contracts have **zero production references**.
All CONFIRMED DEAD (`documents.get` and `workOrders.get` look used by text grep — 146 files contain `.get` — but the
checker resolves none of those accesses to these members):

| Member | Contract | Tests that reference it |
|---|---|---|
| `OrgSettingsRepository.getDefaultCurrency` | `src/lib/repositories/contracts/admin.ts:97` | 1 |
| `BudgetRepository.findImportedLine` | `contracts/budget.ts:64` | 1 |
| `ContactRepository.listActivities` | `contracts/companies.ts:74` | 0 |
| `ContactRepository.listActivitiesForContacts` | `contracts/companies.ts:76` | 0 |
| `CompanyCollectionsRepository.listForCompanies` | `contracts/companies.ts:94` | 0 |
| `DocumentRepository.get` | `contracts/documents.ts:16` | 1 |
| `IntegrationsRepository.onboardErpParties` | `contracts/integrations.ts:199` | 2 |
| `ProcurementRepository.createDocument` | `contracts/procurement.ts:132` | 1 |
| `ProcurementRepository.deleteDocument` | `contracts/procurement.ts:147` | 1 |
| `RevenueRepository.getPayment` | `contracts/revenue.ts:72` | 0 (→ S8, money path) |
| `SubcontractRepository.listPoRevisions` | `contracts/subcontracts.ts:22` | 1 |
| `TimesheetRepository.createDraft` | `contracts/timesheets.ts:27` | 2 |
| `TimesheetRepository.upsertEntries` | `contracts/timesheets.ts:28` | 2 |
| `TimesheetRepository.deleteEntry` | `contracts/timesheets.ts:29` | 2 |
| `WorkOrderRepository.get` | `contracts/workOrders.ts:58` | 0 |
| `WorkOrderAcceptanceRepository.listLines` | `contracts/workOrders.ts:103` | 1 |

Removing a member removes it from the contract **and** its implementation object in the matching
`src/lib/repositories/<domain>.ts`. The DAL function behind it is **not** removed in this plan (it may have other
callers; S9 re-scans).

### R12, R17, R18
| Item | Verdict | Evidence |
|---|---|---|
| R17 `i18next-parser` devDependency (`pmo-portal/package.json:107`) | UNSURE | no script, CI step or hook invokes it (E5 whole repo minus `docs/`, lockfile excluded: only comments). But `src/lib/i18n/index.ts:8` lists it as one of "EXACTLY THREE … APPROVED" packages and `src/lib/i18n/CATALOGUES.md:23` says `en/` "is generated by `i18next-parser`". Removing it changes a documented rule → Q9. |
| R18 `prettier` + `pmo-portal/.prettierrc.json` | UNSURE | used only by `npm run format` / `format:check` (`package.json:15-16`); no CI job, hook or script calls them. Possibly run by hand → Q10. |
| R12 scripts with no reference | UNSURE | non-test scripts with no reference anywhere in tracked files (incl. `docs/`): `scripts/test-budget-range-rollback.sh` (511), `test-2280-operator-onboard-served.mjs` (222), `test-2278-dispatch-guard-served.mjs` (198), `test-2195-capture-integration.mjs` (194), `check-adw-test-lock.py` (147), `clickup-roundtrip-verify.ts` (118), `test-budget-archive-legacy-rollback.sh` (115), `check-adw-diagnosis.py` (107), `clickup-parent-probe.ts` (71), `perf/route-closure.mjs` (18). The ticket says keep unless runbooks and the owner confirm → Q11. (`scripts/*.test.mjs` are run by `scripts/run-script-tests` and are live.) |

### Totals
- CONFIRMED DEAD and sliced: **≈2,710 source lines** (S1 597 · S2 127 · S3 187 · S4 271 · S5 793 · S6a 141 ·
  S6b 418 · S6c 145 · S8 34) + S7's 15 repository members; **≈2,440 test lines** deleted with their code
  (S1 24 · S2 266 · S3 2 · S4 430 · S5 1,715) + the per-symbol cases in S6–S8; **183 locale lines** and 1 allowlist
  line in S4/S5.
- The ticket's ≈5.6k estimate also counted the R10–R14/R16/R20 refactors and the UNSURE items; the gap is those.

## 4. Tests that go with their code

Tests listed in each slice exist only to test the code that slice deletes. Deleting them **with** that code in the
same commit is not weakening a test: the behaviour they cover is unreachable by any user (no production importer,
E1–E4), and a test of unreachable code proves nothing about the product. The rule "never delete a test that covers
shipped behaviour" is kept by the surgical edits: in a mixed file only the cases that import a deleted module are
removed, every other case stays unmodified, and each slice runs the surviving cases.

ACs whose **only** test is deleted by this plan (whole-repo grep of the AC id across `pmo-portal/**` and
`supabase/tests/**` test files, excluding the deleted files): AC-831-3, AC-JR-W3B-05, AC-RF-006, AC-WOMS-010,
AC-FIN-DEBT-005, AC-FIN-DEBT-006, AC-FIN-DEBT-013, AC-FIN-STATUS-001, AC-FAA-003, AC-B-0-3, AC-IXD-DASH-W5-C2B (+ its
sub-ids), AC-B-0-5, AC-UXA-004, AC-UX-013, AC-JR-W3B-04, AC-IFW-DASH-01. Their behaviour lived only in the unmounted
Finance dashboard and its cards. Whether that was an intended retirement is Q2 — **S4 and S5 wait for that answer.**

## 5. Slices (smallest blast radius first)

Every slice: its own branch off the current `origin/dev`, its own worktree, deletion commits only. Workers push the
branch; the Director batches S1–S3 into one PR to `dev`, S4–S5 into a second, S6a–S7 into a third (`git merge
--no-ff`, merged with `--merge`), and S8 alone.

**Common gates** (run in `pmo-portal/` unless stated; all must be green before the push):
```bash
npm run check:guards
npm run typecheck
npx eslint --max-warnings=0 <every touched .ts/.tsx file that still exists>
npx vitest run <the slice's neighbour test files>
npm run build
cd .. && node scripts/affected-e2e.mjs        # expected output stated per slice
node <scratch>/syms.mjs <scratch>/after.json  # Appendix A.2: the deleted names must be gone and no NEW test-only export appears except the slice's listed follow-ons
git log --format='%an %ae %cn %ce%n%B' origin/dev..HEAD | grep -iE 'claude|anthropic|co-authored|generated with|session'  # must print nothing
```

### S0 — prepare (once per worker)
1. `git fetch origin dev && git worktree add ../pmo-2157-<slice> -b chore/2157-<slice> origin/dev` (2 min).
2. Copy the three scanners from Appendix A into the worker's scratch directory (not the repo). Run
   `node <scratch>/syms.mjs <scratch>/before.json` from the repo root and confirm the slice's symbols are still listed;
   if one is not, stop and report — `dev` moved (3 min).

### S1 — prototype leftovers (R2) · branch `chore/2157-s1-prototype-leftovers`
- **Delete:** `pmo-portal/data/mockData.ts`, `pmo-portal/components/Card.tsx`, `pmo-portal/components/icons.tsx`.
- **Edit:** `pmo-portal/types.ts` — remove the 18 exports listed in R2 (lines 17-27, 37-71, 88-159, 168-203, 207-235)
  and the trailing `// --- NEW TYPES FOR O&G FEATURES ---` header; keep the 4 enums.
- **Edit test:** `pmo-portal/src/components/ui/__tests__/icons.test.tsx` — remove `import * as legacyIcons from
  '../../../../components/icons';` (line 12) and the case `UIP-001: all 25 legacy named icon exports remain
  facade-backed shims` (lines 52-73). Every other `UIP-001` case stays.
- **Expected:** −597 source lines, −24 test lines.
- **Tasks:** (1) delete the 3 files, `npm run typecheck` → the only error is `icons.test.tsx(12)` (3 min);
  (2) edit `icons.test.tsx`, re-run typecheck → 0 (2 min); (3) edit `types.ts`, re-run typecheck → 0 (3 min);
  (4) common gates (5 min).
- **Neighbour vitest:** `src/components/ui/__tests__/icons.test.tsx src/lib/listWorkingSet.test.ts pages/Timesheets.test.tsx App.routes.test.tsx`.
- **affected-e2e:** expected `Selected 0 of 211 specs.` (no route file changes).

### S2 — libraries with only their own test (R7) · branch `chore/2157-s2-test-only-libs`
- **Delete with their tests:** `src/lib/budget-snapshot.ts` + `src/lib/budget-snapshot.test.ts` +
  `src/lib/__tests__/budget-snapshot.varianceSign.test.ts`; `src/lib/procurement-summary.ts` +
  `src/lib/procurement-summary.test.ts`; `src/lib/sumPerCurrency.ts` + `src/lib/sumPerCurrency.test.ts`.
- **Expected:** −127 source, −266 test lines.
- **Tasks:** (1) delete the 7 files (2 min); (2) common gates (5 min).
- **Neighbour vitest:** `src/lib/projectFinances.test.ts pages/finance/FinanceHub.test.tsx`.
- **affected-e2e:** expected 0 specs.

### S3 — `BudgetSummary` (R4) · branch `chore/2157-s3-budget-summary`
- **Delete:** `pmo-portal/pages/project-detail/budget/BudgetSummary.tsx`.
- **Edit tests:** remove the line `vi.mock('../project-detail/budget/BudgetSummary', () => ({ default: () => null }));`
  from `pages/__tests__/ProjectBudget.a11yNames.test.tsx:54` and `pages/__tests__/ProjectBudget.lineItemResilience.test.tsx:84`.
- **Expected:** −187 source, −2 test lines. If `check:i18n` then reports orphaned keys, delete exactly those keys
  from `public/locales/{en,id}/*.json` (they are among Appendix B) and nothing else.
- **Tasks:** (1) delete + edit (2 min); (2) common gates (5 min).
- **Neighbour vitest:** `pages/__tests__/ProjectBudget.a11yNames.test.tsx pages/__tests__/ProjectBudget.lineItemResilience.test.tsx pages/project-detail/budget/BudgetVersionsDrawer.test.tsx`.
- **affected-e2e:** expected 0 specs without locale edits.

### S4 — orphan dashboard widgets (R6) · branch `chore/2157-s4-orphan-widgets` · **waits for Q2**
- **Delete with their tests:** `components/DeliveryPctChip.tsx` + `components/__tests__/DeliveryPctChip.test.tsx`;
  `src/components/dashboard/AtRiskProjectsLink.tsx` + `AtRiskProjectsLink.test.tsx`;
  `src/components/dashboard/ProjectedMarginBars.tsx` + `ProjectedMarginBars.test.tsx` +
  `__tests__/ProjectedMarginBars.d1.test.tsx`; `src/components/dashboard/StillToInvoiceCard.tsx` +
  `__tests__/StillToInvoiceCard.test.tsx` + `__tests__/StillToInvoiceCard.polish.test.tsx`.
- **Edit test:** `pages/__tests__/ExecutiveDashboard.bahasa.test.tsx` — remove the `ProjectedMarginBars` import
  (line 5), the `const chart = render(…)` block and its `progressbar` assertion (lines 45-50), and the now-unused
  imports `render`, `within`, `MemoryRouter`, `BahasaProvider` (lines 2-4). Both cases stay; the second keeps its
  `Menurut jumlah`, `Prospek` and approvals-link assertions.
- **Edit:** `src/lib/i18n/launch-scope-routes.txt` line 46 — remove the four paths
  `src/components/dashboard/AtRiskProjectsLink.tsx`, `…/ProjectedMarginBars.tsx`, `…/StillToInvoiceCard.tsx`,
  `components/DeliveryPctChip.tsx`.
- **Edit:** delete the keys `check:i18n` reports orphaned (expected: `dashboard.projectedMargin.*`,
  `dashboard.delivery.percent`, `dashboard.atRisk.review*`, `dashboard.stillToInvoice.*` — Appendix B) from
  `public/locales/en/*.json` and `public/locales/id/*.json`, and the entry
  `dashboard.stillToInvoice.daysSinceAcceptance` from `scripts/i18n-common-key-allowlist.json`. Delete only what the
  gate names; re-run until it is silent.
- **Expected:** −271 source, −430 test lines, ≈−60 locale lines.
- **Tasks:** (1) delete files, typecheck → only `ExecutiveDashboard.bahasa.test.tsx(5)` errors (3 min); (2) edit the
  Bahasa test, eslint it (3 min); (3) edit `launch-scope-routes.txt`, run `node ../scripts/check-i18n-completeness.mjs`
  (2 min); (4) delete orphan keys + allowlist entry, run `npm run check:i18n` until green (5 min); (5) common gates (5 min).
- **Neighbour vitest:** `pages/__tests__/ExecutiveDashboard.bahasa.test.tsx src/components/dashboard/StatusBarChart.test.tsx src/components/dashboard/StageSegments.test.tsx`.
- **affected-e2e:** locale edits make it select ≈150 specs (> the 40-spec cap). Do **not** pass `--allow-broad`.
  Run the curated dashboard set instead, under the DB lock:
  `scripts/with-db-lock.sh scripts/e2e-local.sh layout/dashboard AC-IXD-DASH-003 AC-1117 AC-L10N-060`
  (`e2e/layout/dashboard.layout.spec.ts`, `e2e/AC-IXD-DASH-003-no-noop-cta.spec.ts`,
  `e2e/serial/AC-1117-dashboard-pipeline.spec.ts`, `e2e/serial/AC-L10N-060-language-switch.spec.ts`). The full
  browser suite runs on the release PR to `main` (CLAUDE.md).

### S5 — `FinanceDashboard` cluster + `BvACard` (R1, R5) · branch `chore/2157-s5-finance-dashboard` · **waits for Q2, Q3**
- **Delete with their tests:** `src/components/dashboard/FinanceDashboard.tsx` + `FinanceDashboard.test.tsx` +
  `__tests__/FinanceDashboard.actualAlignment.test.tsx` + `__tests__/FinanceDashboard.budgetError.test.tsx` +
  `__tests__/FinanceDashboard.w5b.test.tsx`; `src/components/dashboard/AwaitingApprovalTile.tsx` +
  `AwaitingApprovalTile.test.tsx`; `src/components/dashboard/DoneNotYetBilledCard.tsx`;
  `src/components/dashboard/BvACard.tsx` + `BvACard.test.tsx` + `__tests__/BvACard.d2.test.tsx` +
  `__tests__/BvACard.link.test.tsx`.
- **Edit test:** `pages/__tests__/Dashboard.drillthrough.test.tsx` — remove the block from `// ── Finance dashboard`
  (line 208) up to, not including, `// ── PM dashboard` (line 256): the import, `renderFinance` and the
  `AC-IXD-DASH-W5-C2A — Finance dashboard KPI drills` describe (48 lines). Change the comment at line 102 to
  name `CompanyDashboard` only if the `useErpSnapshots` mock is still needed by the remaining cases; if eslint or the
  run shows it unused, remove that mock too. Exec, PM and Engineer describes stay unmodified.
- **Edit comments** naming `BvACard`: `src/components/ui/ProgressBar.tsx:26`, `src/components/ui/ProjectNameLink.tsx:19`,
  `src/lib/dashboardConstants.ts:17` — describe the current consumer instead (find it with
  `git grep -n "ProgressBar\b" -- pmo-portal/src pmo-portal/pages ':!*.test.*'` etc.). Do not edit the migration.
- **Edit:** `launch-scope-routes.txt` line 46 — remove `src/components/dashboard/BvACard.tsx` and
  `src/components/dashboard/AwaitingApprovalTile.tsx`.
- **Edit:** delete the keys `check:i18n` then reports orphaned (expected: `dashboard.bva.atRisk`,
  `dashboard.budgetReviewLink`, `dashboard.chart.procStatus.*`, `dashboard.kpi.awaitingApproval.*`, `uxs03.*`,
  `uxs04.noActiveBudget` — Appendix B), from `public/locales/{en,id}/common.json` and `…/dashboard.json`.
- **Expected:** −793 source, −1,715 test lines, ≈−120 locale lines, 3 comment lines changed.
- **Tasks:** (1) delete files, typecheck → only `Dashboard.drillthrough.test.tsx(210)` (3 min); (2) edit drillthrough,
  eslint + vitest it (4 min); (3) comments (3 min); (4) `launch-scope-routes.txt` + orphan keys until `check:i18n` green
  (5 min); (5) common gates (5 min).
- **Neighbour vitest:** `pages/__tests__/Dashboard.drillthrough.test.tsx src/components/dashboard/procurementStatusTone.test.ts src/components/dashboard/StatusBarChart.test.tsx src/components/ui/__tests__/ProgressBar*.test.tsx pages/finance/FinanceHub.test.tsx`
  (expand the `ProgressBar*` glob with `ls` first; pass the real paths).
- **affected-e2e:** as S4 (curated set; add `AC-PFIN-016 layout/project-detail`).

### S6a — test-only hooks (R9) · branch `chore/2157-s6a-hooks` · −141 lines
For each row: delete the export; delete only the test cases that call it (keep the file's other cases). If a test
file is left with no cases, delete the file. Then delete any import the removal leaves unused (eslint finds them).

| Symbol | Location | Lines | Test files touched |
|---|---|---|---|
| `useRegister` | `pmo-portal/src/hooks/useEquipment.ts:85` | 8 | `src/hooks/useEquipment.test.tsx` |
| `useAssetMaintenance` | `pmo-portal/src/hooks/useEquipment.ts:94` | 8 | `src/hooks/useEquipment.test.tsx` |
| `useEquipmentPickers` | `pmo-portal/src/hooks/useEquipment.ts:103` | 8 | `src/hooks/useEquipment.test.tsx` |
| `usePendingEquipmentChanges` | `pmo-portal/src/hooks/useEquipment.ts:112` | 8 | `src/hooks/useEquipment.test.tsx` |
| `useAssetMatches` | `pmo-portal/src/hooks/useEquipment.ts:121` | 8 | `src/hooks/useEquipment.test.tsx` |
| `useOdooEquipmentOwned` | `pmo-portal/src/hooks/useEquipment.ts:130` | 5 | `src/hooks/useEquipment.test.tsx` |
| `useAcceptAssetMatches` | `pmo-portal/src/hooks/useEquipment.ts:180` | 2 | `src/hooks/useEquipment.test.tsx` |
| `useSendEquipmentCommand` | `pmo-portal/src/hooks/useEquipment.ts:182` | 3 | `src/hooks/useEquipment.test.tsx` |
| `useImprestPlanUsage` | `pmo-portal/src/hooks/useImprest.ts:43` | 8 | `src/hooks/useImprest.test.tsx` |
| `useMeetings` | `pmo-portal/src/hooks/useMeetings.ts:23` | 12 | `src/hooks/useMeetings.test.tsx` |
| `useCreateProcurement` | `pmo-portal/src/hooks/useProcurementCrud.ts:38` | 17 | `src/hooks/useProcurementCrud.recordFolder.test.tsx`, `src/hooks/useProcurementCrud.test.ts` |
| `useCreateProcurementItem` | `pmo-portal/src/hooks/useProcurementCrud.ts:71` | 9 | — |
| `usePipelineStageConfig` | `pmo-portal/src/hooks/useProjectTransitions.ts:23` | 10 | `src/hooks/useProjectTransitions.test.ts` |
| `useProjectNumbers` | `pmo-portal/src/hooks/useProjects.ts:42` | 12 | `src/hooks/useProjects.test.tsx` |
| `rankRecords` | `pmo-portal/src/hooks/useRecordSearch.ts:300` | 5 | `src/hooks/__tests__/useRecordSearch.test.tsx` |
| `useProjectSubcontractExposure` | `pmo-portal/src/hooks/useSubcontract.ts:86` | 9 | `src/hooks/useSubcontract.test.ts` |
| `useChildDocument` | `pmo-portal/src/hooks/useDocuments.ts:32` | 9 | — |

Tasks: one task per hook file (8 files, 2–4 min each); then common gates. Neighbour vitest = every test file in the
table. affected-e2e: expected 0.

### S6b — test-only library functions (R9) · branch `chore/2157-s6b-lib` · −418 lines
Same procedure as S6a.

| Symbol | Location | Lines | Test files touched |
|---|---|---|---|
| `transitionVerb` | `pmo-portal/components/procurement.ts:121` | 3 | `components/__tests__/procurement.labels.test.ts` |
| `pillVariantForStatus` | `pmo-portal/components/procurement.ts:158` | 7 | `components/procurement.test.ts` |
| `lifecycleSteps` | `pmo-portal/components/procurement.ts:281` | 45 | `components/__tests__/procurement.stages.test.ts`, `components/procurement.test.ts` |
| `visibleLifecycleSteps` | `pmo-portal/components/procurement.ts:335` | 11 | `components/procurement.test.ts` |
| `openPR` | `pmo-portal/components/procurement.ts:353` | 6 | `components/procurement.test.ts` |
| `isBillingKind` | `pmo-portal/src/lib/billingKind.ts:5` | 3 | — |
| `resolveBudgetProjectionScope` | `pmo-portal/src/lib/budget/budgetProjection.ts:349` | 12 | `src/lib/budget/budgetProjection.test.ts` |
| `summarizeProjection` | `pmo-portal/src/lib/budget/budgetProjection.ts:380` | 18 | `src/lib/budget/budgetProjection.test.ts` |
| `riskCheckableFor` | `pmo-portal/src/lib/dashboardConstants.ts:22` | 3 | `src/lib/dashboardConstants.test.ts` |
| `moneyTotalsFigure` | `pmo-portal/src/lib/dashboardMoney.ts:73` | 13 | `src/lib/dashboardMoney.test.ts` |
| `prepareExpenseCaptureReceiptUpload` | `pmo-portal/src/lib/db/expenseCapture.ts:66` | 7 | `src/lib/db/expenseCapture.test.ts`, `src/lib/db/storageErrors.test.ts` |
| `buildProgressionTimeline` | `pmo-portal/src/lib/db/procurementHistory.ts:136` | 139 | `src/lib/db/procurementHistory.test.ts` |
| `archiveStockItem` | `pmo-portal/src/lib/db/stockMaster.ts:86` | 1 | `src/lib/db/stockMaster.test.ts` |
| `isLegalWorkOrderTransition` | `pmo-portal/src/lib/db/workOrders.ts:140` | 4 | `src/lib/db/workOrders.test.ts` |
| `paymentState` | `pmo-portal/src/lib/erpPurchaseAging.ts:10` | 7 | `src/lib/erpPurchaseAging.test.ts` |
| `currencyLead` | `pmo-portal/src/lib/finance/currencyFigures.ts:29` | 14 | `src/lib/finance/currencyFigures.test.ts` |
| `formatFullDate` | `pmo-portal/src/lib/format.ts:999` | 3 | `src/lib/format.test.ts` |
| `parseFxDate` | `pmo-portal/src/lib/import/fxRateParser.ts:139` | 8 | `src/lib/import/__tests__/fxRateParser.test.ts` |
| `daysSince` | `pmo-portal/src/lib/procurement/listModel.ts:112` | 3 | — |
| `shortTotalsLabel` | `pmo-portal/src/lib/procurement/listModel.ts:139` | 7 | — |
| `stageLabelForStatus` | `pmo-portal/src/lib/procurement/stage.ts:16` | 5 | `src/lib/procurement/stage.test.ts` |
| `deriveBudgetConsumption` | `pmo-portal/src/lib/projectFinances.ts:204` | 4 | `pages/project-detail/budget/__tests__/pmoSpendSplit.test.ts`, `src/lib/projectFinances.test.ts` |
| `fetchFirstSpendingYear` | `pmo-portal/src/lib/repositories/budgetProjection.ts:415` | 5 | `src/lib/repositories/budgetProjection.test.ts` |
| `groupByUrgency` | `pmo-portal/src/lib/selectors/approvalUrgency.ts:22` | 8 | `src/lib/selectors/approvalUrgency.test.ts` |
| `capMessage` | `pmo-portal/src/lib/subcontracts/subcontractRules.ts:89` | 10 | `src/lib/subcontracts/subcontractRules.test.ts` |
| `entriesByProject` | `pmo-portal/src/lib/timesheet-derive.ts:19` | 19 | `src/lib/timesheet-derive.test.ts` |
| `projectMoneyFigure` | `pmo-portal/src/components/dashboard/hub/pm/metrics.ts:13` | 29 | `src/components/dashboard/restructure/currencyOrder.test.ts` |
| `projectSpendOfContractPct` | `pmo-portal/src/components/dashboard/hub/pm/metrics.ts:83` | 11 | — |
| `selectUnbilledTotals` | `pmo-portal/src/components/dashboard/restructure/useCompanyFigures.ts:198` | 4 | `src/components/dashboard/restructure/useCompanyFigures.test.ts` |
| `useAgentRuntime` | `pmo-portal/src/lib/agent/runtime/AgentRuntimeContext.tsx:42` | 9 | `src/lib/agent/runtime/AgentRuntimeProvider.test.tsx` |

Notes: `deriveProjectionCell` in the same file is **kept** (STILL USED, AC-BUD-054 oracle). `pmoSpendSplit.test.ts`
and `currencyOrder.test.ts` test shipped behaviour too — remove only the cases that call the deleted symbol.
Tasks: one per source file (22 files, 2–4 min each); common gates. affected-e2e: expected 0.

### S6c — test-only UI exports (R9) · branch `chore/2157-s6c-ui` · −145 lines
| Symbol | Location | Lines | Test files touched |
|---|---|---|---|
| `DealJourney` | `pmo-portal/pages/sales/DealParts.tsx:94` | 11 | — |
| `BudgetVsSpentCard` | `pmo-portal/src/components/dashboard/hub/company/OverviewCards.tsx:31` | 14 | — |
| `BudgetUsedCard` | `pmo-portal/src/components/dashboard/hub/company/OverviewCards.tsx:292` | 15 | — |
| `CardFoot` | `pmo-portal/src/components/ui/Card.tsx:110` | 9 | — |
| `EntryList` | `pmo-portal/src/components/ui/EntryList.tsx:24` | 44 | `src/components/ui/__tests__/EntryList.test.tsx` (whole file goes) |
| `HoursBar` | `pmo-portal/src/components/ui/HoursBar.tsx:30` | 45 | `src/components/ui/__tests__/HoursBar.test.tsx` (whole file goes) |
| `FeatureGate` | `pmo-portal/src/auth/useFeature.tsx:41` | 7 | `src/components/shell/__tests__/FeatureGate.route.test.tsx` — remove the `<FeatureGate>` cases only; the `<FeatureRoute>` cases of AC-ENT-003 stay |

If `EntryList.tsx` / `HoursBar.tsx` hold nothing else after the removal, delete the file. Check `check:i18n` for
orphans after `DealJourney` and the two cards. Tasks: one per file (6 files); common gates. affected-e2e: expected 0
unless locale keys are removed (then the curated S4 set).

### S7 — repository members (R15) · branch `chore/2157-s7-repo-members`
The 15 members in §3 R15 except `RevenueRepository.getPayment`. Per member: remove it from the contract in
`src/lib/repositories/contracts/<domain>.ts`, remove the implementation property in `src/lib/repositories/<domain>.ts`
(find it with `git grep -n "<member>" -- pmo-portal/src/lib/repositories`), remove the repository-level test cases that
call it (`git grep -ln "\.<member>\b" -- 'pmo-portal/src/lib/repositories/**/*.test.ts'`). Leave the DAL function.
Expected ≈−100 lines (1–3 contract + ~5 implementation lines per member; the worker reports the exact count).
Tasks: one per contract file (9 files, 3–5 min each); common gates; re-run `members.mjs` → those 15 rows gone.
Neighbour vitest: `src/lib/repositories/composition.test.ts src/lib/repositories/hookSeam.test.ts` + each touched test.

### S8 — money-path modules (R9/R15) · branch `chore/2157-s8-money-path` · **ships alone**
Read `docs/money-path-primer.md` first. Remove: `listProposedEmployeeLinks` (`src/lib/db/timesheetPush.ts:148`, 23 L,
test `src/lib/db/timesheetPushReadModels.test.ts`), `checkTotal` (`src/lib/adapterSeam/odoo/revenue/moneyHeader.ts:37`,
5 L, test `…/moneyHeader.test.ts`), `COMMITTED_STATUSES` (`src/lib/db/procurements.ts:82`, 6 L, test
`src/lib/db/procurements.test.ts`), `RevenueRepository.getPayment` (contract `contracts/revenue.ts:72` + implementation).
Expected ≈−45 lines. `checkTotal` is in `adapterSeam/` — before deleting, confirm with
`git grep -n checkTotal -- supabase/` that no edge function imports it (E3 said none). Common gates + security-auditor
confirms no money/SoD path is touched beyond the deletions.

### S9 — re-scan (after S1–S8 merge)
Run `syms.mjs` and `graph.mjs` on the new `dev`. Deletions can orphan private helpers and DAL functions (second-order
dead code). File the new candidates as a follow-up comment on #2157 (Director), not in these slices.

## 6. Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-DCR-001 | **Given** any slice branch, **when** `npm run typecheck` runs, **then** it reports zero errors. | Layer-1 CI gate (`verify`) |
| AC-DCR-002 | **Given** any slice branch, **when** `npm run build` runs, **then** it exits 0. | Layer-1 CI gate (`verify`) |
| AC-DCR-003 | **Given** S3–S6 remove UI text, **when** `npm run check:guards` runs, **then** the i18n gate reports no orphaned key, no missing key, no stale allowlist entry, and `launch-scope-routes.txt` names only existing files. | Layer-1 CI gate (`verify`, `check:i18n`) |
| AC-DCR-004 | **Given** the Finance dashboard is removed, **when** `pages/__tests__/Dashboard.drillthrough.test.tsx` runs, **then** every Executive, PM and Engineer drill case passes unmodified. | Unit (Vitest) |
| AC-DCR-005 | **Given** `ProjectedMarginBars` is removed, **when** `pages/__tests__/ExecutiveDashboard.bahasa.test.tsx` runs, **then** both cases pass with their remaining Bahasa assertions. | Unit (Vitest) |
| AC-DCR-006 | **Given** the root legacy icon shim is removed, **when** `src/components/ui/__tests__/icons.test.tsx` runs, **then** every remaining `UIP-001` case passes. | Unit (Vitest) |
| AC-DCR-007 | **Given** `BudgetSummary` is removed, **when** the `ProjectBudget.*` tests run, **then** they pass with no mock of the deleted module. | Unit (Vitest) |
| AC-DCR-008 | **Given** all slices, **when** `App.routes.test.tsx` and `App.publicRoutes.test.tsx` run, **then** they pass unmodified (no slice edits `App.tsx`). | Unit (Vitest) |
| AC-DCR-009 | **Given** the R3 paste-rows files, **when** a PM pastes budget rows on the Budget tab, **then** the rows import as before. | E2E (existing `e2e/AC-009-budget-paste-rows.spec.ts`, release PR) |
| AC-DCR-010 | **Given** a slice, **when** `syms.mjs` runs after it, **then** none of the slice's deleted names is listed and no production module imports a deleted path. | Layer-1 gate run by the worker (scanner, Appendix A) |
| AC-DCR-011 | **Given** a slice's PR, **when** it is reviewed, **then** every deleted test file is listed beside the deleted code it tested, and every surviving case in a mixed file is unmodified. | Review gate (spec-reviewer; no automated layer) |
| AC-DCR-012 | **Given** S7, **when** typecheck runs, **then** each removed member is gone from both its contract and its implementation and nothing references it. | Layer-1 CI gate (`verify`) |

## 7. Open questions for the owner

- **Q1.** #2042 is still open and the ticket says run after it. Hold every slice until it lands, or allow S1, S2 and
  S6b now (they touch no screen)?
- **Q2.** The ACs in §4 (e.g. AC-FIN-DEBT-005/006/013, AC-FIN-STATUS-001, AC-RF-006, AC-WOMS-010, AC-UXA-004) were
  only ever proven on the Finance dashboard and its cards, which no route renders today. Were they retired on purpose
  when the dashboards were restructured, or did those behaviours drop off by accident (a product gap to file instead)?
- **Q3.** Open fix ticket #2093 cites `FinanceDashboard.tsx:116`. When S5 lands, should that bullet be struck from
  #2093?
- **Q4.** Keep `useExitPresence` for the exit animations #2130 defers?
- **Q5.** Keep `NeedsYouList` and `FigureGroup` (restructure files, edited 2026-11-13; #2086 cites `NeedsYouList.tsx:55`)
  for an upcoming screen?
- **Q6.** Is a consumer planned for `OdooItemPicker` (AC-ODC-040)?
- **Q7.** Odoo/ERP map: keep `odoo/resolvers.ts` (AC-ODC-071), `odoo/revenue/errors.ts`, `clickup/vaultCredentials.ts`,
  `assertDomainInCapabilityMap` and the test-only adapter constants?
- **Q8.** Retire the unused timesheet `ApprovalsQueue` component (150 lines, 7 tests)? It is SoD-adjacent, so it would
  ship alone.
- **Q9.** `i18next-parser` is listed as an approved package and as the generator of `en/`, but nothing runs it. Remove
  it (and update `src/lib/i18n/index.ts:8` and `CATALOGUES.md:23`), or keep it as the documented extraction tool?
- **Q10.** Do you run `npm run format` (prettier) by hand? If not, remove prettier and `.prettierrc.json`?
- **Q11.** Which of the unreferenced scripts (§3 R12) and hand-run `.mjs` proofs (§3 R7) do you still run?
- **Q12.** Agree that R10, R11, R13, R14, R16 and R20 get their own refactor plan rather than riding on this one?

## Appendix A — scanners (run from the repo root; write output to a scratch directory, never into the repo)

### A.1 `graph.mjs` — files with no production importer (E1), then external references (E2)
```js
import { createRequire } from 'node:module'; const ts = createRequire(process.cwd() + '/pmo-portal/package.json')('typescript');
import fs from 'node:fs'; import path from 'node:path';
const root=process.cwd() + '/pmo-portal';
const cfg=ts.getParsedCommandLineOfConfigFile(path.join(root,'tsconfig.json'),{},{...ts.sys,onUnRecoverableConfigFileDiagnostic(){}});
const host=ts.createCompilerHost(cfg.options);
const files=cfg.fileNames.filter(f=>!f.includes('node_modules'));
const isTest=f=>/\.(test|spec)\.tsx?$|\/__tests__\/|\/e2e\/|\/test\//.test(f);
const importers=new Map(files.map(f=>[f,new Set()]));
const res=(spec,from)=>{const r=ts.resolveModuleName(spec,from,cfg.options,host).resolvedModule; return r&&!r.isExternalLibraryImport?path.resolve(r.resolvedFileName):null;};
for(const f of files){const src=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);
 const add=s=>{const r=res(s,f); if(r&&importers.has(r)&&r!==f) importers.get(r).add(f);};
 const v=n=>{ if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteralLike(n.moduleSpecifier)) add(n.moduleSpecifier.text);
  if(ts.isCallExpression(n)&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])){const c=n.expression.getText(src); if(n.expression.kind===ts.SyntaxKind.ImportKeyword||/^(require|vi\.(mock|doMock|importActual|unmock)|import)$/.test(c)) add(n.arguments[0].text);}
  if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)) add(n.argument.literal.text);
  ts.forEachChild(n,v)}; v(src);}
const out=[];
for(const [f,s] of importers){ if(isTest(f)) continue; const rel=path.relative(root,f); if(/(^|\/)(index\.tsx|App\.tsx|vite\.config|vitest|playwright\.config|eslint\.config)/.test(rel)||rel.endsWith('.d.ts')) continue;
 const prod=[...s].filter(x=>!isTest(x)); if(prod.length===0){ out.push({rel,lines:fs.readFileSync(f,'utf8').split('\n').length,tests:[...s].map(x=>path.relative(root,x))}); } }
let dead=new Set(out.map(o=>path.join(root,o.rel))); let changed=true;
while(changed){changed=false; for(const [f,s] of importers){ if(isTest(f)||dead.has(f)) continue; const rel=path.relative(root,f); if(/(^|\/)(index\.tsx|App\.tsx)$/.test(rel)||rel.endsWith('.d.ts')||/config/.test(rel)) continue; const prod=[...s].filter(x=>!isTest(x)); if(prod.length&&prod.every(x=>dead.has(x))){dead.add(f); out.push({rel,lines:fs.readFileSync(f,'utf8').split('\n').length,tests:[...s].filter(isTest).map(x=>path.relative(root,x)),transitive:prod.map(x=>path.relative(root,x))}); changed=true;}}}
fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1));
for(const o of out) console.log(`${o.lines}\t${o.rel}\t${o.transitive?'[via '+o.transitive.join(',')+']':''}\ttests:${o.tests.length}`);
```
Second step (E2): for each `rel` in the output, `git grep -lF "pmo-portal/<rel without extension>" -- supabase scripts .github .githooks .claude/hooks pmo-portal/package.json pmo-portal/vite.config.ts pmo-portal/vitest.eval.config.ts pmo-portal/playwright.config.ts package.json ':!*.md'`;
a hit makes the file (and what only it imports) live.

### A.2 `syms.mjs` — exports with no production importer (E3)
```js
import { createRequire } from 'node:module'; const ts = createRequire(process.cwd() + '/pmo-portal/package.json')('typescript');
import fs from 'node:fs'; import path from 'node:path'; import {execSync} from 'node:child_process';
const R=process.cwd(), APP=R+'/pmo-portal';
const tracked=execSync('git ls-files',{cwd:R,encoding:'utf8'}).split('\n').filter(f=>/\.(tsx?|mjs|mts)$/.test(f)&&!f.endsWith('.d.ts'));
const isTest=f=>/\.(test|spec)\.(tsx?|mjs)$|\/__tests__\/|\/e2e\/|(^|\/)test\/|\.eval\.ts$|evals\/|fixtures?|fake|testkit|testing\/|Harness|harness|test-helpers|contractSuite\/|\.contract\.ts$|testGrep|TestRpc|\.proof|integration\.mjs/.test(f);
const exts=['','.ts','.tsx','.mjs','/index.ts','/index.tsx'];
const resolve=(spec,from)=>{let b; if(spec.startsWith('.')) b=path.resolve(path.dirname(from),spec); else if(spec.startsWith('@/')) b=path.join(APP,spec.slice(2)); else return null;
 for(const e of exts){const p=b+e; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return path.relative(R,p);} return null;};
const exportsOf=new Map(), starRe=new Map(), namedRe=new Map(), uses=new Map(), nsUse=new Map();
const addUse=(t,n,imp)=>{if(!uses.has(t))uses.set(t,new Map()); const m=uses.get(t); if(!m.has(n))m.set(n,new Set()); m.get(n).add(imp);};
for(const f of tracked){ const abs=path.join(R,f); const text=fs.readFileSync(abs,'utf8'); const sf=ts.createSourceFile(abs,text,ts.ScriptTarget.Latest,true, f.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const ex=new Map();
 for(const st of sf.statements){ const mods=ts.canHaveModifiers(st)?ts.getModifiers(st):undefined; const isExp=mods?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
  const ln=n=>sf.getLineAndCharacterOfPosition(n).line+1;
  if(isExp){ const names=[]; if(ts.isVariableStatement(st)) st.declarationList.declarations.forEach(d=>ts.isIdentifier(d.name)&&names.push(d.name.text)); else if(mods.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)) names.push("default"); else if(st.name&&ts.isIdentifier(st.name)) names.push(st.name.text);
   for(const n of names) ex.set(n,{s:ln(st.getStart()),e:ln(st.getEnd()),kind:ts.SyntaxKind[st.kind]}); }
  if(ts.isExportDeclaration(st)){ const t=st.moduleSpecifier&&resolve(st.moduleSpecifier.text,abs);
   if(!st.exportClause){ if(t){ if(!starRe.has(f))starRe.set(f,[]); starRe.get(f).push(t);} }
   else if(ts.isNamedExports(st.exportClause)) for(const el of st.exportClause.elements){ const orig=(el.propertyName||el.name).text; if(t){ if(!namedRe.has(f))namedRe.set(f,new Map()); namedRe.get(f).set(el.name.text,[t,orig]); } else ex.set(el.name.text,{s:ln(st.getStart()),e:ln(st.getEnd()),kind:'ExportList'}); } }
  if(ts.isExportAssignment(st)) ex.set('default',{s:ln(st.getStart()),e:ln(st.getEnd()),kind:'ExportAssignment'});
 }
 exportsOf.set(f,ex);
 const idc=new Map(); const walk=n=>{ if(ts.isIdentifier(n)) idc.set(n.text,(idc.get(n.text)||0)+1); ts.forEachChild(n,walk)}; walk(sf);
 for(const [n,v] of ex) v.internal=(idc.get(n)||0)-1;
 const visit=n=>{ let spec=null, names=null, ns=false;
  if(ts.isImportDeclaration(n)&&ts.isStringLiteralLike(n.moduleSpecifier)){spec=n.moduleSpecifier.text; const c=n.importClause; names=[]; if(c){ if(c.name) names.push('default'); if(c.namedBindings){ if(ts.isNamespaceImport(c.namedBindings)) ns=true; else c.namedBindings.elements.forEach(e=>names.push((e.propertyName||e.name).text)); } } }
  else if(ts.isCallExpression(n)&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||/^(require|vi\.(mock|doMock|importActual))$/.test(n.expression.getText(sf)))){spec=n.arguments[0].text; ns=true;}
  else if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)){spec=n.argument.literal.text; ns=true;}
  if(spec){ const t=resolve(spec,abs); if(t&&t!==f){ if(ns){ if(!nsUse.has(t))nsUse.set(t,new Set()); nsUse.get(t).add(f);} for(const nm of names||[]) addUse(t,nm,f);} }
  ts.forEachChild(n,visit)}; visit(sf);
}
let changed=true; const seen=new Set();
while(changed){changed=false;
 for(const [b,m] of uses){ for(const [n,imps] of m){ const key=b+'#'+n+'#'+imps.size; if(seen.has(key)) continue; seen.add(key);
   const nr=namedRe.get(b)?.get(n); const targets=nr?[[nr[0],nr[1]]]:(exportsOf.get(b)?.has(n)?[]:(starRe.get(b)||[]).map(t=>[t,n]));
   for(const [t,o] of targets){ for(const i of imps) addUse(t,o,i); changed=true; } } }
 for(const [b,imps] of nsUse){ for(const t of (starRe.get(b)||[]).concat([...(namedRe.get(b)?.values()||[])].map(x=>x[0]))){ const s=nsUse.get(t)||new Set(); const before=s.size; imps.forEach(i=>s.add(i)); nsUse.set(t,s); if(s.size>before) changed=true; } }
}
const rows=[];
for(const [f,ex] of exportsOf){ if(!f.startsWith('pmo-portal/')||isTest(f)) continue; if(/(App|index)\.tsx$|config\.ts$/.test(f)) continue;
 const nsProd=[...(nsUse.get(f)||[])].filter(i=>!isTest(i));
 for(const [n,v] of ex){ const u=[...(uses.get(f)?.get(n)||[])]; const prod=u.filter(i=>!isTest(i)); const tests=u.filter(isTest);
  if(prod.length||nsProd.length) continue;
  rows.push({file:f,name:n,lines:v.e-v.s+1,s:v.s,e:v.e,internal:v.internal,tests,nsTests:[...(nsUse.get(f)||[])].filter(isTest).length,kind:v.kind}); } }
fs.writeFileSync(process.argv[2],JSON.stringify(rows,null,1));
const testOnly=rows.filter(r=>r.internal<=0&&r.tests.length>0), none=rows.filter(r=>r.internal<=0&&r.tests.length===0&&r.nsTests===0), internalOnly=rows.filter(r=>r.internal>0);
console.log('exports w/o prod importer:',rows.length,'| test-only & unused in own file:',testOnly.length,testOnly.reduce((a,r)=>a+r.lines,0),'L | no importer at all & unused in own file:',none.length,none.reduce((a,r)=>a+r.lines,0),'L | used only in own file (R20):',internalOnly.length);
```
Expected on `dev@1e98c792`: `exports w/o prod importer: 1734 | test-only & unused in own file: 100 1825 L | no importer at all & unused in own file: 61 761 L | used only in own file (R20): 1519`.
`internal` counts identifier occurrences in the declaring file; a symbol referenced only from a comment counts as unused.

### A.3 `members.mjs` — repository contract members with no production reference (E4; ≈80 s)
```js
import { createRequire } from 'node:module'; const ts = createRequire(process.cwd() + '/pmo-portal/package.json')('typescript');
import path from 'node:path'; import fs from 'node:fs';
const APP=process.cwd() + '/pmo-portal';
const cfg=ts.getParsedCommandLineOfConfigFile(path.join(APP,'tsconfig.json'),{},{...ts.sys,onUnRecoverableConfigFileDiagnostic(){}});
const prog=ts.createProgram(cfg.fileNames,cfg.options); const ch=prog.getTypeChecker();
const isTest=f=>/\.(test|spec)\.tsx?$|\/__tests__\/|\/e2e\/|\/test\/|evals\//.test(f);
const REPO=path.join(APP,'src/lib/repositories/');
const decls=new Map(), use=new Map();
const keyOf=d=>d.getSourceFile().fileName+':'+d.getStart();
for(const sf of prog.getSourceFiles()){ const f=sf.fileName; if(f.includes('node_modules')||!f.startsWith(REPO)||isTest(f)) continue;
 const v=n=>{ if((ts.isPropertySignature(n)||ts.isMethodSignature(n))&&n.name&&ts.isIdentifier(n.name)&&/contracts\/|types\.ts$|dataTypes/.test(f)) decls.set(keyOf(n),{file:path.relative(APP,f),name:n.name.text,line:sf.getLineAndCharacterOfPosition(n.getStart()).line+1,parent:n.parent?.name?.text}); ts.forEachChild(n,v)}; v(sf);}
const mark=(sym,from)=>{ if(!sym) return; if(sym.flags&ts.SymbolFlags.Alias) try{sym=ch.getAliasedSymbol(sym)}catch{}; for(const d of sym.declarations||[]){const k=keyOf(d); if(decls.has(k)){ if(!use.has(k))use.set(k,{prod:new Set(),test:new Set()}); use.get(k)[isTest(from)?'test':'prod'].add(path.relative(APP,from)); } } };
for(const sf of prog.getSourceFiles()){ const f=sf.fileName; if(f.includes('node_modules')) continue;
 const v=n=>{ if(ts.isPropertyAccessExpression(n)) mark(ch.getSymbolAtLocation(n.name),f);
  else if(ts.isBindingElement(n)&&ts.isObjectBindingPattern(n.parent)){ const t=ch.getTypeAtLocation(n.parent); const nm=(n.propertyName||n.name); if(ts.isIdentifier(nm)) mark(t.getProperty(nm.text),f); }
  ts.forEachChild(n,v)}; v(sf);}
const rows=[]; for(const [k,d] of decls){ const u=use.get(k)||{prod:new Set(),test:new Set()}; if(u.prod.size===0) rows.push({...d,tests:[...u.test]}); }
fs.writeFileSync(process.argv[2],JSON.stringify(rows,null,1));
for(const r of rows.filter(r=>/Repository$|^Repositories$/.test(r.parent||''))) console.log(`${r.file}:${r.line} ${r.parent}.${r.name} tests=${r.tests.length}`);
```
Expected on `dev@1e98c792`: the 16 rows of §3 R15.

## Appendix B — catalogue keys orphaned by S3–S5 (union, as reported by `check:i18n` in the trial)

`dashboard.bva.atRisk` · `dashboard.projectedMargin.group` · `dashboard.projectedMargin.barLabel` ·
`dashboard.delivery.percent` · `dashboard.atRisk.reviewSingle` · `dashboard.atRisk.reviewMany` ·
`dashboard.budgetReviewLink` · `dashboard.chart.procStatus.chartLabel` · `dashboard.chart.procStatus.empty` ·
`dashboard.chart.procStatus.noun` · `dashboard.kpi.awaitingApproval.label` · `….unavailable` · `….one` · `….many` ·
`….linkUnavailable` · `….linkOne` · `….linkMany` · `dashboard.stillToInvoice.daysSinceAcceptance` · `….count` ·
`….daysSinceClosed` · `….empty` · `….error` · `….incomplete` · `….title` · `….incompleteMore` · `….clientPo` ·
`uxs04.noActiveBudget` · `uxs03.spendingContract` · `uxs03.spendingContractBar` · `uxs03.notAvailableYet` ·
`uxs03.attentionAndApprovals` · `uxs03.realizedMargin` · `uxs03.realizedMarginKnown` · `uxs03.contractRemaining` ·
`uxs03.coverage` · `uxs03.coverageCategories` · `uxs03.pmoPurchasing` · `uxs03.pmoPurchasingScope` ·
`uxs03.activeBudget` · `uxs03.actual` · `uxs03.variance` · `uxs03.utilization` · `uxs03.atRisk` ·
`uxs03.activeBudgetReviewEmpty` · `uxs03.activeBudgetReviewEmptySub` · `uxs03.actualSourceCurrency` ·
`uxs03.actualAsOf` · `uxs03.financeDashboardTitle` · `uxs03.financeDashboardSubtitle` ·
`uxs03.financeBudgetReviewTitle` · `uxs03.financeProjectColumn` · `uxs03.financeReadyToPay` (52 keys).

Present in `public/locales/en/common.json` and `public/locales/id/common.json`; `dashboard.chart.procStatus.*` and
`uxs03.pmoPurchasing*` also in `public/locales/{en,id}/dashboard.json`. The gate, not this list, decides per slice.
