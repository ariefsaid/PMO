# Budget paste rows implementation plan (#1473)

> **For agentic workers:** execute through supervised Orca workers, using TDD; read the spec and the applicable task before editing. Each checkbox is intended as a 2–5 minute step, not a separate release.

**Goal:** Append reviewed spreadsheet rows to the explicitly selected Draft without changing the Active budget.

**Architecture:** Parse and validate clipboard text locally; bind an immutable reviewed set to the version and commit sequentially through the existing line-create mutation. A dialog owns mapping/preview, a hook owns the commit state machine, and existing server checks remain authoritative. Whole-project distribution is refreshed and revalidated, never rewritten by paste.

**Tech:** React, TypeScript, Vitest/RTL, pgTAP, Playwright, existing Supabase repository, `bigint` decimal arithmetic.

**Spec:** `docs/specs/budget-paste-rows.spec.md`; dependency: `docs/plans/2026-11-02-budget-whole-project.md` §6.

## Constraints and grounding

- The owner approved spreadsheet-agnostic paste with review; the detailed mapping and numeric rules are spec defaults, not additional owner quotations. No workbook template, AI, file upload, activation, fiscal-year assignment, import key, or migration. All text stays local; do not log source cells.
- The shipped editor is `pages/project-budget/BudgetLineItemEditor.tsx:14-31`, mounted by `pages/ProjectBudget.tsx:383-405` (not an inline `LineItemEditor` as the spec's affected-code table suggests). Its create callback already uses the version-bound mutation.
- `src/hooks/useBudget.ts:85-89,130-137` invalidates budget, versions, activation precheck and project finances after each successful insert; `src/lib/db/budgets.ts:60-72,242-270` sends the reviewed fields and null fiscal year without actuals or provenance. `src/auth/policy.ts:193,466` is the real-role/view-as gate. `budgetDescriptor.ts:30-37` documents neutral money convention; it permits zero for file imports, whereas this feature requires positive values.
- `pmo-portal/package.json:50` includes ExcelJS for workbook files. Search of that dependency list found no direct TSV/clipboard or arbitrary-precision decimal parser; `readCsvGrid.ts:12-71` is comma-specific, trims cells and enforces equal widths, so is not a drop-in. Adapt its quoting state machine for TSV while preserving cells and logical source-row numbers; reuse `exactDecimal.ts:1-12` for validated cents. Do not add a dependency or evaluate formulas.
- The neutral parser deliberately tolerates floating-point noise (`format.moneyPrecision.test.ts:106-113`); it cannot establish the spec's strict no-rounding input contract. Validate the source lexically and use integer arithmetic before converting validated cents to the existing number input. The maximum 99,999,999,999,999 cents is a safe JS integer.
- #1472 Slice 1 is `origin/feat/budget-whole-project-s1` at `cff373903486e5e778f10d686c74d75730e7c0af` (pure distribution code); Slice 3 was not published at planning time. Its planned storage contract and Slice 6.1 UI are future work, not shipped facts. Integrate against their actual APIs after they land; do not invent a distribution hook or assume the branch includes Slice 6.1.
- Every implementation slice is money-adjacent (budget amounts) and receives money mutation review and runs alone; none changes auth, SoD or migrations. Pure parser may be developed independently but release the feature as one PR per #1473. No migration numbers are reserved from 0520–0529.

## Slice map and dependencies

| Slice | Base | Scope / release |
|---|---|---|
| A | `origin/feat/budget-whole-project-s1` | Pure TSV and exact preview, no writes; money calculation, ship with feature alone. |
| B | `origin/feat/budget-whole-project-s3` once pushed, plus A | Commit state machine and pgTAP regression; money/SoD regression, ship alone. |
| C | B plus #1472 Slice 6.1 integrated into that base | Dialog, integration, translations, a11y and journey; money UI, ship alone. No merge until Slice 3 and 6.1 are present and re-spread behavior is verified. |

If 6.1 lands on another branch, merge that branch into C's integration base before coding; do not claim `s3` contains it. Rebase only after preserving both prerequisites. The coordinator must resolve any conflict between their final APIs and this plan before execution.

## Review focus

1. Quoted embedded CRLF, escaped quotes, empty trailing cells and blank physical lines preserve source row numbers (A1).
2. Literal formula-like text never executes; malformed quotes fail closed (A1).
3. Fractional products, trailing zero precision, numeric maximum and >500 rows never silently round or truncate (A2–A3).
4. An uncertain network response and an authority/state rejection cannot cause a duplicate or hide prior success (B1–B2).
5. A version change or a saved whole-project distribution becoming stale cannot leave a save targeted to an old version or a misleading ready state (C1–C3).

## A — local parser and preview

**Files:** create `pmo-portal/src/lib/budget/pasteRows.ts` and `pasteRows.test.ts`. Paths below are relative to `pmo-portal/` unless specified.

### A1: TSV parsing (AC-001)

- [ ] Write a failing test `AC-001 quoted TSV and original row numbers`: parse `Category\tDescription\tAmount\r\nLabor\t"two\tparts\r\nnext ""quoted"""\t12.30\r\n\r\nTravel\t\t5` and assert data rows start on physical lines 2 and 5, preserve the embedded CRLF, tabs, quotes and empty description. Assert malformed/unclosed quotes reject, formula text is literal, and blank rows are ignored without renumbering.
- [ ] Run `npx vitest run src/lib/budget/pasteRows.test.ts` and confirm the new test fails. Implement `parsePasteTsv(text: string): { rowNumber: number; cells: string[] }[]` using a strict quoted-field state machine: tabs delimit only outside quotes; CRLF is one physical newline; quoted newlines increment source position; preserve empty cells and field content; throw a typed parse error on invalid quoting. Do not interpret HTML or formulas.
- [ ] Run the same command and confirm pass.

### A2: exact amounts (AC-002)

- [ ] Add failing tests for `parsePasteAmount('1,234.50') === '1234.50'`, rejection of `0`, `-1`, `1,23`, `NaN`, `1.001`, `1000000000000.00`; accept `999999999999.99`. For `multiplyPasteAmount`, assert `0.1 × 0.2 = '0.02'`, `0.1 × 0.1 = '0.01'`, `0.1 × 0.01` rejects, and `2.50 × 4 = '10.00'`; reject zero and non-finite operands. Also reject precision that only the float-noise tolerance would accept.
- [ ] Run `npx vitest run src/lib/budget/pasteRows.test.ts` and confirm failure. Implement `parsePasteAmount(raw: string): string | null` and `multiplyPasteAmount(quantity: string, rate: string): string | null`: trim outside whitespace; require digits with either no commas or properly grouped thousands and optional dot fraction; remove grouping; calculate via BigInt coefficients and decimal scales, accepting excess product digits only if they are zero; require `0 < cents <= 99999999999999n`; output `formatExactCents(cents)`. Bound individual input length before BigInt conversion (default 128 characters) to avoid pathological pasted cells. Never pass expressions to a math evaluator.
- [ ] Run the test command and confirm pass.

### A3: mapped validation (AC-001/002)

- [ ] Add failing tests for an explicitly included/excluded header, arbitrary column indexes, unknown-category mapping, ignored columns, direct versus calculated precedence, explicit mode required when both inputs exist, valid count and exact sum, missing required mappings, 500 versus 501 nonblank data rows and two identical rows remaining distinct. Include category labels in both active translations and enum values.
- [ ] Run `npx vitest run src/lib/budget/pasteRows.test.ts` and confirm failure. Export `PasteMapping = { category: number | null; description: number | null; amount: number | null; quantity: number | null; rate: number | null }`, `PasteMode = 'amount' | 'quantity-rate'`, and `previewPasteRows(rows, mapping, header, mode, categoryAliases)` returning immutable `{rows, validCount, invalidCount, totalCents, errors}`; each row carries `rowNumber`, raw selected inputs, resolved enum category, nullable description, canonical amount and field errors. Require category and mode-specific columns, ignore wholly blank data rows, reject the whole set above 500 and never deduplicate. Use `Constants.public.Enums.budget_category` and `budgetCategoryLabel` translations supplied by the UI, rather than maintaining a second enum; ambiguous matching requires explicit mapping.
- [ ] Re-run the test; confirm pass. `npx eslint --max-warnings=0 src/lib/budget/pasteRows.ts src/lib/budget/pasteRows.test.ts`.

## B — commit and server contract

### B1: sequential commit and retry (AC-005)

**Files:** create `src/hooks/useBudgetPasteRows.ts` and `src/hooks/useBudgetPasteRows.test.tsx`.

- [ ] Write failing hook test with three source rows (two identical), captured version `v1`, and deferred `create`: two simultaneous save calls make only one first call; sequential resolutions yield created rows 1 and 2 and definitive failure row 3; retry calls only row 3. Assert every call has `v1` and exactly `{category, description, budgeted_amount}` using the reviewed decimal, no import provenance, actuals, org, status, currency or fiscal year.
- [ ] Run `npx vitest run src/hooks/useBudgetPasteRows.test.tsx` and confirm failure. Implement `useBudgetPasteRows(create: (versionId: string, item: NewLineItem) => Promise<unknown>)` returning `commit(versionId, rows)`, `retryFailed()`, `progress`, `results`, and `busy`. Snapshot the reviewed rows/version; synchronous ref lock blocks double clicks before React renders. Iterate sequentially; track each source-row identity independently. For a definite individual rejection use `classifyMutationError(error, undefined, { suppressCapture: true })`; show classified result; never include source text in analytics. Confirmed successes never re-enter retry set.
- [ ] Re-run the test and confirm pass.

### B2: stop and reconcile (AC-010, FR-011)

- [ ] Add failing tests: a timeout/lost response is `uncertain`, never retried automatically or by `retryFailed`; later rows are `unsubmitted`, prior successes remain `created`, and a refresh is requested. An authoritative permission/Draft rejection stops subsequent rows and requests target refresh. A definitive ordinary row rejection permits remaining rows to continue. A version change/permission loss during an in-flight call prevents the next call without losing its outcome.
- [ ] Run the hook test and confirm failure. Extend the hook with `canContinue(): boolean` and `refresh(): Promise<void>` dependencies, checked immediately before each submission. Treat all errors without a positively identified server rejection as uncertain; stop, refresh and require the user to inspect persisted lines before starting a separate new paste. Do not treat uncertain rows as failed or offer retry for them. A typed server permission/state rejection stops; only confirmed server row-level rejections are retryable. Keep results for unsubmitted rows distinct.
- [ ] Run the hook test and confirm pass; mutation-check the busy lock and uncertain-stop rule by temporarily breaking each and confirming its test fails, then restore and rerun.

### B3: existing insert authority (AC-007)

**Files:** create `supabase/tests/budget_paste_rows_contract.test.sql`.

- [ ] Write failing pgTAP assertions following `0009_budget_role_gate.test.sql`, `0010_budget_tenant_isolation.test.sql`, `0011_budget_draft_guard.test.sql`, `budget_version_editors.test.sql`: same-org allowed roles insert into Draft; non-writers, foreign org and Active/Archived targets do not persist; successful insert records editor and existing activation SoD applies. Inspect effective grants/policies on the test database, not migration names as proof. Use namespaced fixtures, `begin`, `finish()`, `rollback`.
- [ ] Run from repo root `scripts/with-db-lock.sh supabase test db supabase/tests/budget_paste_rows_contract.test.sql` and inspect output, including `Parse errors`; record whether the existing contract already passes; this regression-only test may be green immediately because it exercises shipped behavior. If it fails, if it exposes a real failure, stop and report privately; do not weaken the test or change authorization under this docs-only plan.
- [ ] Run the same command and require all assertions pass with no parse errors. Mutation-check the applicable guard in an isolated test transaction and confirm the owning assertion fails; restore before final run. No reset unless a migration/seed changed.

## C — dialog, invalidation, acceptance

### C1: Draft entry and target (AC-004/006)

**Files:** `pages/ProjectBudget.tsx`, `pages/project-budget/BudgetLineItemEditor.tsx`, `pages/ProjectBudget.test.tsx`; create `pages/project-budget/BudgetPasteRowsDialog.tsx`.

- [ ] Add failing RTL tests covering Admin, Executive, Project Manager, Finance, Engineer and impersonation: Paste rows appears only for real-role create **and** edit on selected Draft; Active/Archived have no action. Opening, pasting, mapping, cancel/close cause zero repository calls. Changing version closes/invalidates preview and requires a fresh review.
- [ ] Run `npx vitest run pages/ProjectBudget.test.tsx` and confirm failure. Wire the action beside manual entry with `usePermission()`'s real-session rules; pass selected Draft ID and `mutations.createLineItem.mutateAsync({versionId,item})` to dialog/hook. Key or reset the dialog on target change; disable commit when the captured ID differs or permission/status changes. Mark paste as an open editor buffer while pending/unsaved, and do not silently discard in-flight results.
- [ ] Re-run the test and confirm pass.

### C2: mapping and accessible preview (AC-003/004/008)

**Files:** dialog and page test above; `public/locales/en/finance.json`, `public/locales/id/finance.json`.

- [ ] Write failing RTL tests for unknown category remapping, optional header and field mapping, mode selection, counts/total/target and Save N valid rows, exclusion explanation, required mapping and 501-row disablement; assert keyboard operation, error/result live announcements, focus return, axe and narrow/wide scroll container. Exercise EN and ID; assert no create before explicit save.
- [ ] Run `npx vitest run pages/ProjectBudget.test.tsx` and confirm failure. Implement a labelled shared dialog with paste textarea, selects for column and category mappings, explicit header checkbox and amount-mode controls, neutral-number explanation, scrollable preview and source-row errors. Use A's pure preview; show exact total and valid/invalid counts; Save remains disabled until required mappings, explicit mode, valid rows and target hold. Add matching EN/ID keys and token-based responsive layout. Restore focus to the trigger when closed; announce progress/results with `aria-live`.
- [ ] Re-run test and confirm pass; `npm run check:i18n`.

### C3: integrate results and distribution (FR-010/011)

- [ ] Add failing page tests: save shows sequential progress, confirmed/failed/uncertain/unsubmitted source rows separately; retry submits only definitive failures; after one success lines, totals and readiness refresh; after a whole-project paste the existing distribution mismatch/re-spread indication appears and activation is not represented as ready. Include a failure after a prior success.
- [ ] Run `npx vitest run pages/ProjectBudget.test.tsx` and confirm failure. Bind B's hook to the existing `useBudgetMutations` create callback (whose `onSuccess` invalidates existing keys), and invalidate/refetch the distribution and readiness query used by the actual #1472 Slice 6.1 implementation after each confirmed success or uncertain outcome. Read the actual 6.1 API before wiring; use its public invalidation/preview-again path; do not mutate saved distribution rows or invent an API. If no such API exists, add a small shared invalidator in the owning hook with a test that proves re-spread is visible and activation remains blocked. Keep the result open until reconciled/closed.
- [ ] Re-run the test and confirm pass; test siblings mocking `useBudget`/the editor selected by `rg -l 'useBudget|BudgetLineItemEditor' pages --glob '*.test.tsx'` individually.

### C4: real journey (AC-009)

**Files:** create `e2e/AC-009-budget-paste-rows.spec.ts`; first read `docs/e2e-parallel-conventions.md`.

- [ ] Write the failing `@e2e-isolation` journey: a permitted session with existing Draft line and separate Active version pastes, maps, previews and explicitly saves direct and quantity × rate sets; reload and assert original + both new Draft rows and exact reviewed total, and unchanged Active version/effective project budget. Assert real persisted behavior, not a toast. Use isolated fixtures; no `process.env.CI` gating.
- [ ] Run from repo root `scripts/with-db-lock.sh scripts/e2e-local.sh AC-009` and confirm failure before wiring is completed; after C1–C3 pass, run again and inspect both lanes/output for pass. Run `scripts/with-db-lock.sh scripts/ux-proof.sh /projects/41000000-0000-0000-0000-000000000001/budget` using the seeded project referenced by `e2e/layout/project-detail.layout.spec.ts:56`; record captures for owner rendered review. Do not reset the DB for this no-migration slice.

## Traceability (one owner per AC)

| AC | Owning layer and test | Slice |
|---|---|---|
| 001 | unit `src/lib/budget/pasteRows.test.ts` | A1/A3 |
| 002 | unit `src/lib/budget/pasteRows.test.ts` | A2/A3 |
| 003 | unit `pages/ProjectBudget.test.tsx` | C2 |
| 004 | unit `pages/ProjectBudget.test.tsx` | C1/C2 |
| 005 | unit `src/hooks/useBudgetPasteRows.test.tsx` | B1 |
| 006 | unit `pages/ProjectBudget.test.tsx` | C1 |
| 007 | pgTAP `supabase/tests/budget_paste_rows_contract.test.sql` | B3 |
| 008 | unit `pages/ProjectBudget.test.tsx` | C2 |
| 009 | e2e `e2e/AC-009-budget-paste-rows.spec.ts` | C4 |
| 010 | unit `src/hooks/useBudgetPasteRows.test.tsx` | B2 |

## Final builder gate

From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 src/lib/budget/pasteRows.ts src/lib/budget/pasteRows.test.ts src/hooks/useBudgetPasteRows.ts src/hooks/useBudgetPasteRows.test.tsx pages/ProjectBudget.tsx pages/ProjectBudget.test.tsx pages/project-budget/BudgetLineItemEditor.tsx pages/project-budget/BudgetPasteRowsDialog.tsx e2e/AC-009-budget-paste-rows.spec.ts`, and `npx vitest run src/lib/budget/pasteRows.test.ts src/hooks/useBudgetPasteRows.test.tsx pages/ProjectBudget.test.tsx` plus relevant sibling suites. Run B3 and C4 under the DB lock, inspect output bodies, capture UI proof, review EN/ID and ≥80% changed-code line coverage. CI owns the full suite; release browser suite runs on the PR to main. Obtain spec, quality and security reviews; owner reviews rendered captures. No deploy or activation is part of this work.

## Open questions and defaults

1. **Can Slice 3 and Slice 6.1 be inspected yet?** No: Slice 3 ref was absent after fetch; default is its documented contract, but implementation waits for the actual branch and 6.1 integration and reconciles their APIs. No owner decision needed.
2. **What is a source row number with a quoted newline?** Default: one-based physical line where the logical row starts; header and blank lines still count.
3. **What happens to a lost response?** Default: stop, refresh and mark uncertain; no retry until user reconciles and explicitly starts a new paste. No durable idempotency is claimed.
4. **Quantity/rate precision?** Default: arbitrary non-negative decimal scale within 128 characters, strictly positive values, exact product must be representable in cents; trailing zeroes do not require rounding. This input bound is a proposed safety limit, not an owner ruling.
5. **Unmapped description?** Default: optional column produces null; category and selected mode's numeric columns are required. Unknown category requires an explicit mapping.
6. **Spec corrections:** `LineItemEditor` is a separate component, not inline in `ProjectBudget.tsx`; the neutral helper tolerates some floating-point noise, so lexical strictness is needed for the spec's no-rounding rule. No spec correction requires an owner decision; surface these for spec maintenance.
