# Plan — measurement to invoice: billing stages, reconciliation, retention (#2522, #1572)

Spec: `docs/specs/billing-stages.spec.md`. Decision: ADR-0105. Branch `feat/2522-billing-stages`. Migrations 0960–0962.
Money path: ships alone. Every gate is in the database with a pgTAP proof and a mutation check.

## Design

- **Where stages live.** `billing_stage_templates` (+ `_documents`) on the project (the contract), replaced whole by
  `set_billing_stage_template` (Finance/Admin). An AFTER INSERT trigger on `progress_claims` (kind `progress`) copies the list
  into `claim_billing_stages` (+ `claim_billing_stage_documents`): later edits never touch a claim already made.
- **Recording.** `attach_billing_stage_document` (project document, issued/approved, with a file; also inserted as claim
  evidence) and `complete_billing_stage` (order, required documents, date window, client reference for client-side stages;
  the next stage starts that day). Both lock the claim row first (`lock_billing_stage_claim`), the same lock as evidence,
  withdrawal and the outbox fence. Roles: Admin, Finance, Project Manager. No client write grant on any of the four tables.
- **The gate.** `assert_claim_billing_stages_complete` BEFORE INSERT on `external_command_outbox` (domain revenue) and on
  `sales_invoices` (the native raise and any mirror insert use the claim id as the invoice id). Predicate
  `billing_stages_open(claim)`. A claim with no plan (made before 0960, or on a project with no list) is unaffected.
- **Deadline.** `projects.invoice_deadline_day` / `invoice_deadline_warn_days`, set by `set_project_invoice_deadline`; the
  date arithmetic is pure (`src/lib/billingStages.ts`), unit-tested.
- **Retention.** 0961: `projects.retention_pct`; `progress_claims.retention_pct/amount` stamped by BEFORE INSERT trigger;
  `retention_releases` with `schedule_retention_release` / `release_retention` / `cancel_retention_release`; view
  `claim_retention`. Project billing terms (deadline, retention) have no client column grant on `projects`; only the Finance/Admin RPCs move them, and both are captured in record history.
- **Reconciliation.** 0962: `billing_reconciliation(project, work_order)` SECURITY INVOKER, one derivation.
- **UI.** `ClaimBillingStages` in both claim drawers (Billing tab, Work orders tab): stages in order with age, checklist,
  attach/complete for the current stage, deadline pill, retention held. Seam: `src/lib/db/billingStages.ts` →
  `repositories.billingStages` → `src/hooks/useBillingStages.ts`. `can('transition'|'edit', 'billingStage')`.

## Tasks (as built)

1. pgTAP `supabase/tests/1021_billing_stages.test.sql` (red) → `supabase/migrations/1021_billing_stages.sql` (green) →
   mutate `billing_stages_open` to `false` and drop each gate trigger: AC-BST-005 goes red. Verify:
   `npx supabase@2.122.1 test db supabase/tests/1021_billing_stages.test.sql`.
2. pgTAP `0961_retention.test.sql` → `0961_retention.sql` → mutate the stamp, the release-total guard and the
   submitted-invoice check: each goes red.
3. pgTAP `0962_billing_reconciliation.test.sql` (with the full work-order trace) → `0962_billing_reconciliation.sql` →
   mutate billed-includes-cancelled and shared-item progress: red.
4. Rollbacks `supabase/migrations/rollback/096{0,1,2}_*_down.sql`; round-trip down/up in one transaction.
5. `src/lib/billingStages.test.ts` → `src/lib/billingStages.ts` (age, current stage, next deadline).
6. `src/lib/db/billingStages.test.ts` → DAL; repository contract + composition/index tests.
7. `src/auth/policy.billingStages.test.ts` → `billingStage` entity in `src/auth/policy.ts`.
8. `pages/project-detail/tabs/__tests__/ClaimBillingStages.test.tsx` → `ClaimBillingStages.tsx`; wire both drawers;
   en + id strings under `projectDetail.billing.stages`.

## Traceability (owning test per AC)

| AC | Layer | Owning test |
|---|---|---|
| AC-BST-001 | pgTAP | `supabase/tests/1021_billing_stages.test.sql` |
| AC-BST-002 | pgTAP | same (UX mirror: `src/auth/policy.billingStages.test.ts`) |
| AC-BST-003 | pgTAP | same (screen: `ClaimBillingStages.test.tsx`) |
| AC-BST-004 | pgTAP | same (screen: `ClaimBillingStages.test.tsx`) |
| AC-BST-005 | pgTAP | same, mutation-checked |
| AC-BST-006 | pgTAP | same |
| AC-BST-010 | unit | `pmo-portal/src/lib/billingStages.test.ts` |
| AC-BST-011 | unit | same |
| AC-BST-020 | pgTAP | `supabase/tests/0962_billing_reconciliation.test.sql` (DAL paging: `src/lib/db/billingStages.test.ts`) |
| AC-RET-001..003 | pgTAP | `supabase/tests/0961_retention.test.sql` |
| AC-TRACE-001 | pgTAP | `supabase/tests/0962_billing_reconciliation.test.sql` (render: `ClaimBillingStages.test.tsx`) |

## Not in this slice (follow-ups)

- Screens for the project's stage list, invoice deadline and retention percentage, the retention release schedule, and the
  per-item reconciliation table. The database functions and repository methods exist (`setTemplate`, `setInvoiceDeadline`,
  `setRetention`, `scheduleRelease`/`release`/`cancelRelease`, `reconciliation`); each new screen goes through `restructure`.
- Daily progress entries: progress reads the latest monthly assessment until the daily-progress ticket on map #2516 lands.
- A curated e2e journey for AC-TRACE-001 (the pgTAP trace proves the cross-table rule; the release PR's browser suite owns
  the rendered journey once the configuration screens exist).
