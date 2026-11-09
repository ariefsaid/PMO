# Plan: review and activate several draft budgets in one confirmed step (#1273)

Money + SoD; ships alone. Rulings: OD-BUDGET-6 (+ sole-operator amendment), DD-BUDGET-7, ADR-0011, ADR-0059/0062.

## Decisions
- **Where:** a self-hiding panel `BudgetDraftReview` on the Finance hub (`/finance`), the same pattern as `InvoicePairReview`. The hub is already the working surface for Admin, Executive and Finance (`useFinanceAccess().canView`), the roles that activate budgets.
- **No migration, no batch RPC.** Each ticked draft goes through the SAME per-budget path the Budget tab uses: `repositories.budget.getActivationMode` (RPC `budget_activation_mode`), `precheckActivation` (edge `budget-activation-precheck`), then `activateVersion` (RPC `activate_budget_version` + ERP push consequence). SoD, org seam, Draft-only, sole-operator, outbox and audit stamping stay in the existing RPC, one call per budget. Nothing new to bypass.
- **Sequential**, one budget at a time, never `Promise.all`: each activation takes row locks and one ERP push; a failure on one row never stops or rolls back the others, and is shown on that row.
- **Read:** new `listOrgDraftBudgets()` in `src/lib/db/budgets.ts` (RLS-scoped select of `status='Draft'` versions + project code/name + line-item sum + editors + first document link). `org_id` never sent.

## Row model
`id, projectId, projectCode, projectName, version, name, total, createdBy, editorIds, documentUrl|null` plus per-row checks (parallel queries, concurrency-capped):
- `mode` from `getActivationMode`: `allowed` / `sole_operator` are eligible; any `blocked*` is not (reason shown).
- `precheck` from `precheckActivation`: unmapped categories = issue code `budget-category-unmapped` (column "All categories mapped": Yes/No). `status='blocked'` = not tickable.
- Tickable = mode eligible AND `can('transition','budgetVersion', ...)` AND precheck settled (not refetching) and not blocked AND, for a whole-project draft, the Budget tab's distribution gate is `current` (`savedPlanMatchesDraft` in `src/lib/budget/savedDistribution.ts`, the one rule DistributionGrid also uses, against the precheck's live ERPNext fiscal years). Unmapped therefore cannot be ticked.
- **Read budget (perf):** the panel is collapsed by default and reads nothing per draft until opened; a role that can activate nothing reads no drafts at all. Readiness reads (mode RPC + live precheck + saved distribution) run for at most **10 drafts at a time** (`CHECK_CAP`); "Check the rest" extends it. No refetch on window focus.
- **Outcome:** each run snapshots its per-project outcome (activated / activated but ERPNext not updated / activated but nothing sent / error) so it stays on screen after the rows leave the Draft list; a new run replaces it. Errors go through `classifyMutationError`.

## Acceptance criteria
- **AC-BAD-001** Given an org with Draft budgets and a user who can view Finance, when the hub loads, then the panel lists each draft with project, total, mapped yes/no and a source-document link when one exists; with no drafts it renders nothing. (vitest)
- **AC-BAD-002** Given a draft with an unmapped category, when the list renders, then its checkbox is disabled and "No" is shown for mapped. (vitest)
- **AC-BAD-003** Given a draft the user drafted/edited while another active member exists (mode blocked), then it cannot be ticked and shows the SoD reason. (vitest + `can()`)
- **AC-BAD-004** Given ticked drafts, when "Activate selected" is pressed, then exactly ONE ConfirmDialog opens stating the count and total, and nothing is activated until it is confirmed; cancel activates nothing. (vitest)
- **AC-BAD-005** Given any selected draft is in sole-operator mode, then the dialog carries the sole-operator wording; otherwise it does not. (vitest)
- **AC-BAD-006** Given confirmation, then `activateVersion` is called once per ticked draft only, in order, and an unticked draft is never called. (vitest)
- **AC-BAD-007** Given one activation is refused (SoD, no longer Draft, changed), then that row shows the failure, the others still activate, and the summary reads "n activated, m failed". (vitest)
- **AC-BAD-008** `can('transition','budgetVersion')` agrees with `activate_budget_version` for the row cases used here (Draft only; editor/drafter refused; no-drafter Admin/Finance only). (component case: mode `allowed` + own draft is not tickable; breaking `can()` turns it red)
- **AC-BAD-009** Server refuses per budget: a non-permitted role, an editor/drafter with 2+ members, an already-Active version and another org's draft are each refused by `activate_budget_version`, and a batch loop of calls reports each outcome independently. (pgTAP `bulk_activate_drafts`)
- **AC-BAD-010** i18n keys exist in `en` and `id`. (key-parity test)

## Files
- `pmo-portal/src/lib/db/budgets.ts` (+test): `listOrgDraftBudgets`.
- `pmo-portal/src/lib/repositories/budget.ts`, `contracts/budget.ts`: `listOrgDrafts`.
- `pmo-portal/src/hooks/useBudget.ts`: `useOrgBudgetDrafts`.
- `pmo-portal/src/components/finance/BudgetDraftReview.tsx` (+ test).
- `pmo-portal/pages/finance/FinanceHub.tsx`: mount the panel.
- `pmo-portal/public/locales/{en,id}/financeHub.json`.
- `supabase/tests/bulk_activate_drafts.test.sql` (pgTAP, no migration).
- e2e: `AC-BAD-011` (serial; opens the collapsed panel, cleans its own Drafts before and after) plus the specs that visit `/finance` via `affected-e2e`.

## Mutation check
Break the SoD rule in `can()` (budgetVersion.transition returns true) and `AC-BAD-008` (own draft, mode allowed) must go red; restore. Server side: pgTAP asserts refusal, mutating the RPC guard is out of scope for a no-migration change (RPC untouched).

## Review-round additions (#1273 fix round)
- **AC-BAD-012** whole-project draft ticks only while the saved distribution matches draft lines, project dates and live ERPNext fiscal years. (vitest: `savedDistribution`, `draftTickState`, panel)
- **AC-BAD-013** collapsed by default; reads capped at 10; role gate; refetching row not ready. (vitest)
- **AC-BAD-014** singular/plural confirm wording. **AC-BAD-015** per-project outcome survives the rows leaving the list. **AC-BAD-016** an empty ERP push is named. **AC-BAD-017** a second run replaces the summary. (vitest)
