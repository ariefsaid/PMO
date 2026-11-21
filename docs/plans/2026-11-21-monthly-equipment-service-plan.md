# Plan: Monthly equipment and service plan turned into rental orders (#2700)

Spec: `docs/specs/monthly-equipment-service-plan.spec.md`. Branch `feat/2700-monthly-equipment-plan`, stacked on `feat/2697-purchase-type-rental-extension`. Migration range 1358-1359. Money and spend approval paths are untouched: the plan creates Drafts only.

## Design
- Tables (1358): `org_equipment_plan_settings(org_id pk, enabled, approval_step check in ('spend_approvers','senior_role') default 'spend_approvers', allow_self_approval default false, updated_by, updated_at)`; `equipment_plan_categories(id, org_id, name, name_id, position, active)` unique `(org_id, lower(btrim(name)))`; `equipment_plans(id, org_id, project_id, plan_month date check first-of-month, status Draft|Submitted|Approved|Rejected, created_by, submitted_at, approved_by, approved_at, reject_reason)` unique `(org_id, project_id, plan_month)`; `equipment_plan_lines(id, org_id, plan_id, work_order_id, category_id, equipment_asset_id, description, quantity, rate, vendor_id, date_from, date_to, procurement_id)` with unique partial index on `procurement_id`. RLS and FORCE RLS, select-only grants, `org_id` default plus stamp trigger (0074 idiom), `(select helper())` wrappers.
- Guard trigger on lines and plans: refuses edits unless the plan is Draft (and the caller is the writer RPC), dates inside the month, work order and vendor in the plan's org/project. Writes only through definer RPCs.
- RPCs (1358): `set_equipment_plan_settings(enabled, approval_step, allow_self_approval)` (checks purchase types on and an active `is_rental` type), `upsert_equipment_plan_category`, `set_equipment_plan_category_active`, `save_equipment_plan(p_id, p_project, p_month, p_lines jsonb)`, `submit_equipment_plan`, `reopen_equipment_plan`, `reject_equipment_plan(p_id, p_reason)`.
- RPC (1359): `approve_equipment_plan(p_id)`: lock plan row; not Submitted and Approved returns the plan (idempotent); check approver (step setting via spend_approvers or `holds_spend_approval_authority`), SoD (not author unless allowed), prerequisites; read the rental type id by `is_rental`; per line call `create_procurement_with_items(md5(line.id)::uuid, header, items)` with `rental_from/to`; write `procurement_id`; mark Approved; stamp work order attribution (OQ-EQP-3). One transaction.
- Record history: add plan and line tables to the `record_history_config` registry, as #2697 did.
- Frontend: repository `src/lib/repositories/equipmentPlans.ts` over `src/lib/db/equipmentPlans.ts`; hooks `useEquipmentPlan`, `usePlanCategories`; `can()` actions in `src/auth/policy.ts`; pages `pages/EquipmentPlans.tsx` (month list and plan editor, phone-first card lines, desktop table) and `pages/EquipmentPlanSettings.tsx`, routes `/equipment-plans` and `/equipment-plans/settings`, gated by the setting; link from a created purchase and from each plan line; translations in `en` and `id` namespaces `equipmentPlans`.

## Migrations
| File | Content |
|---|---|
| `supabase/migrations/1358_equipment_plan.sql` | tables, RLS, grants, guard triggers, settings, category and plan RPCs, history config |
| `supabase/migrations/1359_approve_equipment_plan.sql` | `approve_equipment_plan` |
| `supabase/migrations/rollback/1358_equipment_plan_down.sql`, `1359_approve_equipment_plan_down.sql` | reverse; 1358 refused while a plan has created purchases |
Fragments: `supabase/tests/inventory/anon-executable-definers/equipment-plan.txt`, `scripts/isolation-probe-denominator.d/equipment-plan.json`.

## Tasks and owning test per AC (test first)
| Step | Files | AC | Layer |
|---|---|---|---|
| 1 pgTAP settings and categories | `supabase/tests/equipment_plan_settings.test.sql` | AC-EQP-001, 002, 003, 004, 015 | pgTAP |
| 2 pgTAP drafting and guards | `supabase/tests/equipment_plan_draft.test.sql` | AC-EQP-005, 006, 007 | pgTAP |
| 3 pgTAP approval and SoD | `supabase/tests/equipment_plan_approval.test.sql` | AC-EQP-008, 009, 014 | pgTAP |
| 4 pgTAP orders and idempotency | `supabase/tests/equipment_plan_orders.test.sql` | AC-EQP-010, 011, 012, 013 | pgTAP |
| 5 Migrations 1358, 1359 to green (orchestrator runs DB) | as above | | |
| 6 Unit: repository, plan page, settings page, i18n parity | `pmo-portal/pages/EquipmentPlans.test.tsx`, `EquipmentPlanSettings.test.tsx`, `src/lib/repositories/equipmentPlans.test.ts` | AC-EQP-001, 016, 018 | Unit |
| 7 E2E, one journey | `pmo-portal/e2e/AC-EQP-017-monthly-equipment-plan.spec.ts` | AC-EQP-017 | E2E |
| 8 Mutation notes in spec; glossary | `docs/glossary.md` | | recorded |
Gate: only static gates and vitest are run by the builder (Director's gate change); pgTAP, mutation and e2e are run by the orchestrator.
