# Plan: Work-order area and group (#2668)

Spec: `docs/specs/work-order-area-group.spec.md`. Executor: one Orca/builder slice, test-first. Migrations **1382, 1383, 1384** only; rollbacks in `supabase/migrations/rollback/`. No file of #2593 (1400-1404) or #2595 (1405-1409) is touched; `work_orders` gains only two nullable columns.

## Tasks

1. **1382_work_order_areas_groups.sql** — tables `work_order_areas`, `work_order_groups` copying `0950` (code, name, created_by, created_at, archived_at; `unique (org_id, id)`; unique live code per org; `stamp_org_id` trigger; RLS select = active member of org, insert/update/delete = Admin, helpers wrapped `(select ...)`; column grants insert `(code,name)`, update `(code,name,archived_at)`). Rollback `1382_..._down.sql`. Isolation fragment `scripts/isolation-probe-denominator.d/2668-work-order-area-group.json` (both tables). Owns AC-WAG-001, -004.
2. **1383_work_orders_area_group.sql** — `alter table work_orders add column area_id uuid, add column group_id uuid`; composite FKs `(org_id, area_id) -> work_order_areas (org_id, id)` and same for group (MATCH SIMPLE, so null is valid); partial indexes on `(org_id, project_id, area_id)`; extend the insert and update column grants with the two columns only. Rollback. Owns AC-WAG-002.
3. **1384_work_order_area_group_guard.sql** — BEFORE INSERT/UPDATE trigger refusing a newly named archived area/group (unchanged value passes). Rollback. Owns AC-WAG-003. pgTAP `supabase/tests/2668_work_order_area_group.test.sql` covers AC-WAG-001..004, then mutation check: drop the composite FK and the archived guard, tests go red, restore.
4. **Types + DAL** — regenerate/extend `Tables<'work_orders'>` types; `src/lib/db/workOrderLists.ts` (list/add/rename/archive for both) + repository + hooks `useWorkOrderLists`; add `areaId`/`groupId` to `WorkOrderInput` in `src/lib/db/workOrders.ts` (sent only when picked).
5. **Admin page** — `pages/admin/WorkOrderLists.tsx` modelled on `CostDisciplines.tsx` (route + admin nav entry, `can()` gate, `EntityFormModal`, `ConfirmDialog`). Owns AC-WAG-009.
6. **Form** — `WorkOrderFormModal.tsx`: two `SelectField` pickers rendered only when the list has live entries (or the row already names one). Owns AC-WAG-008.
7. **List** — new `workOrderGrouping.ts` pure helper (group + order + counts, unit-tested); `WorkOrdersTab.tsx`: `hasLists` gate, "Group by" `SelectField` writing `?groupBy=`, grouped headings wrapping the existing card/draft blocks (no change when None); area/group text on the card and Draft row; `StatusPill` on Draft rows when `hasLists`. Owns AC-WAG-005..007.
8. **i18n** — English and Bahasa Indonesia keys under `projectDetail.workOrders.*` and the admin namespace; parity test.
9. **e2e** — one curated journey `e2e/AC-WAG-010-work-order-area-group.spec.ts` (isolation tag per `docs/e2e-parallel-conventions.md`). Screenshots phone 390 and desktop 1440 under `docs/evidence/1215/2668/` (grouped list, form, admin page).
10. **Docs** — `docs/glossary.md` entries (work-order area, work-order group).

## Traceability

| AC | Layer | Test |
|---|---|---|
| WAG-001..004 | pgTAP | `supabase/tests/2668_work_order_area_group.test.sql` |
| WAG-005..007 | unit | `WorkOrdersTab.groupBy.test.tsx`, `workOrderGrouping.test.ts` |
| WAG-008 | unit | `WorkOrderFormModal.areaGroup.test.tsx` |
| WAG-009 | unit | `WorkOrderLists.test.tsx` |
| WAG-010 | e2e | `e2e/AC-WAG-010-work-order-area-group.spec.ts` |

Gates: check:guards, typecheck, eslint on changed files, `vitest related`, under lock reset + pgTAP + 0178 + 0646 + isolation denominator (live and `--self-test`), the one e2e journey.
