# Purchase line category and needed-by Implementation Plan (#2696)

> Spec: `docs/specs/purchase-line-category-needed-by.spec.md`. Not money path. Migrations 1345 to 1347 (1348, 1349 spare).
> Constraint: do NOT re-create `public.create_procurement_with_items` (parallel #2697). Lines are written by a new RPC.

## Migrations
- `supabase/migrations/1345_purchase_line_categories.sql` (+ `rollback/1345_purchase_line_categories_down.sql`):
  - `organizations.purchase_line_planning boolean not null default false`; `get_purchase_line_planning()` (active members), `set_purchase_line_planning(boolean)` (Admin only, `log_audit`, seeds "Project" and "Overhead" when the org has no rows), shape of `get/set_procurement_gates` (0360).
  - `purchase_line_categories(id uuid pk, org_id uuid not null default auth_org_id()-stamped via trigger like peers, name text check 1..60, position int, archived_at timestamptz, unique(org_id,id))`; unique index `(org_id, lower(name)) where archived_at is null`; RLS enabled + forced; select policy `org_id = (select auth_org_id()) and (select is_active_member())`; no client write grant; writes only via `set_purchase_line_category(p_id uuid, p_name text, p_position int)` and `archive_purchase_line_category(p_id uuid)` (Admin, `security definer`, org from `auth_org_id()`, audited).
- `supabase/migrations/1346_procurement_line_planning.sql` (+ rollback):
  - `alter table procurement_items add column category_id uuid, add column needed_by date`; composite FK `(org_id, category_id)` references `purchase_line_categories(org_id, id)`.
  - `procurement_items_planning_guard()` before insert/update trigger: non-null new values require `purchase_line_planning` ON for the row's org and, on update of these columns, a Draft parent; a retired category cannot be newly set.
  - `set_procurement_line_planning(p_item uuid, p_category uuid, p_needed_by date) returns boolean`: `security definer`, caller org, `procurement_item_values_editable(case)` (0393) as the authority, setting ON, category active in caller org; neutral 42501 otherwise. Grant to `authenticated`, revoke from public and anon.
- 1347 only if the type generation or a view needs it; otherwise unused.

## Test fragments (static, same migration PR)
- `supabase/tests/inventory/anon-executable-definers/2696-purchase-line-planning.txt`: `get_purchase_line_planning`, `set_purchase_line_planning`, `set_purchase_line_category`, `archive_purchase_line_category`, `set_procurement_line_planning`.
- `scripts/isolation-probe-denominator.d/2696-purchase-line-planning.json`: new table `purchase_line_categories` and the same definers (read that script's header for the exact keys before writing).
- pgTAP `supabase/tests/1345_purchase_line_planning.test.sql` (AC-PLP-001..007; fixtures in the style of `supabase/tests/0393*` procurement draft tests). Not run by this builder (gate change); the orchestrator runs it plus the mutation checks listed in the spec.

## Frontend
1. `pmo-portal/src/lib/db/procurementLinePlanning.ts` + test `procurementLinePlanning.test.ts` (AC-PLP-008): `getPurchaseLinePlanning`, `setPurchaseLinePlanning`, `listLineCategories`, `saveLineCategory`, `archiveLineCategory`, `setLinePlanning(itemId, categoryId, neededBy)`. Hand-add the new RPC and table types to `src/lib/supabase/database.types.ts` only in the shapes the generator would emit.
2. Repository methods on `src/lib/repositories/procurement.ts` (+ contract), hook `src/hooks/usePurchaseLinePlanning.ts`.
3. `pmo-portal/pages/ProcurementCreate.tsx` + `pages/procurement/*` line editor: Category (`SelectField`) and Needed-by (`TextField` type date) per line behind the setting; after create, call `setLinePlanning` per filled line (AC-PLP-009). Tests in a NEW file `ProcurementCreate.linePlanning.test.tsx`; existing create tests untouched.
4. `pages/ProcurementDetails.tsx` line table columns + draft editing (AC-PLP-010), new test file.
5. `pages/admin/OrgPurchaseLines.tsx` (+ test, AC-PLP-011) beside `OrgProcurementGates.tsx`: switch plus category list (add, rename, retire) with `ConfirmDialog` for retire; `can()`-gated to Admin.
6. Strings: English and Bahasa Indonesia keys in the locale files (AC-PLP-012); no screenshots (gate change).

## Traceability
AC-PLP-001..007 pgTAP `1345_purchase_line_planning.test.sql`; AC-PLP-008 `procurementLinePlanning.test.ts`; AC-PLP-009 `ProcurementCreate.linePlanning.test.tsx`; AC-PLP-010 `ProcurementDetails.linePlanning.test.tsx`; AC-PLP-011 `OrgPurchaseLines.test.tsx`; AC-PLP-012 existing locale-parity test. One e2e journey is deferred to the orchestrator's wave (written, not run): `pmo-portal/e2e/AC-PLP-009-line-planning.spec.ts`.

## Gates (static only)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest run <new and touched test files>`.
