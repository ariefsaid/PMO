# Plan: billing can start (fix lane)

Spec: `docs/specs/billing-can-start.spec.md`. Branch `fix/walk-billing`. Migration 1570 only.

1. `supabase/migrations/1570_bast_confirm_owner_and_category.sql` (+ rollback): `seed_document_categories` gains "Delivery record"; `acceptances_awaiting_my_confirmation()`. Owning test: `supabase/tests/1570_bast_confirm_owner.test.sql`, `1090` count update.
2. UI: `WorkOrderAcceptances.tsx`, `WorkOrderCustomerOrderCard.tsx`, `work-order-detail/BillingSection.tsx`, `WorkOrderDetail.tsx`; copy in `projectTabs`, `status`, `workOrders` (EN and ID).
3. `ProgressAssessmentModal.tsx` month default and picker.
4. `ContractCascade.tsx`, `WorkOrderCustomerOrderCard.tsx` billable on draft; labels in `project`/`common`.
5. `RatePicker.tsx`, `BoqItemFormModal.tsx`, `BillingTab.tsx`.
6. `FinanceHub.tsx`, `CompanyDashboard.tsx`, `ClaimsBoardLink.tsx`, board empty state.
Journey: `e2e/JOB-PM-7-confirm-delivery-record.spec.ts`.
