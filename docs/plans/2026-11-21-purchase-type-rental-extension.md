# Plan: Purchase type and a guided rental extension (#2697)

Spec: `docs/specs/purchase-type-rental-extension.spec.md`. Branch `feat/2697-purchase-type-rental-extension`. Migration range 1350-1354. Money, SoD and approval paths are untouched; the server rules below are proven by pgTAP with a mutation check each.

## Design
- Settings: `org_purchase_type_settings(org_id pk, enabled bool default false, updated_by, updated_at)`. Types: `purchase_types(id, org_id, name, name_id, is_rental bool, position int, active bool, created_at; unique(org_id, lower(name)); unique(org_id,id))`. RLS + FORCE RLS; select = same-org active member; no client write grants.
- `procurements` gains nullable `purchase_type_id`, `rental_from`, `rental_to`, `extends_procurement_id` (same-org composite FKs; check both dates or none, to >= from; check no self link). A BEFORE trigger (`procurements_zz_purchase_type`, binds definers and owner like `guard_procurement_subcontract_flag`) refuses any update of those four columns, and on insert enforces: feature on, type active and same org, period present iff the type `is_rental`, and for an extension link: original same org, original type `is_rental`, status not Cancelled/Rejected, new from > original `rental_to`, no overlap with sibling extensions, same type.
- Writers: `create_procurement_with_items` re-created from 0449 with `-- 1351` markers, header allowlist gains `purchase_type_id`, `rental_from`, `rental_to` (typed checks) and `extends_procurement_id` (accepted only via the extend RPC's own call, not from the plain header). `extend_rental_procurement(p_id, p_original, p_from, p_to, p_items jsonb default null)` (security definer; caller must be able to create purchases and read the original) copies title (suffix by locale-neutral counter), project, vendor, budget category and, when `p_items` is null, the original's lines; calls the create path; returns the new row. Admin RPCs `set_purchase_types_enabled(bool)` (seeds starter rows once) and `upsert_purchase_type(...)`/`set_purchase_type_active(...)` (Admin only).
- Record history: add the four columns to `record_history_config` captured set for `procurements` (as 0449 did).
- #2700 contract: callers use `create_procurement_with_items` with a rental type id read from `purchase_types where is_rental`, or `extend_rental_procurement`.
- Frontend: repository `src/lib/repositories/purchaseTypes.ts` over `src/lib/db/purchaseTypes.ts`; hook `usePurchaseTypes`; Admin screen `pages/PurchaseTypeSettings.tsx` (route `/purchase-types/settings`, same pattern as `MaterialRequestSettings.tsx`, `can()` gated); type select and rental period in `ProcurementCreate.tsx`; type chip, period, links and "Extend rental" modal (`EntityFormModal`) in `ProcurementDetails.tsx`; type filter in `Procurement.tsx`. All hidden when the setting is off. Strings in the existing `procurement` namespace and a new `purchaseTypes` namespace, en and id.

## Migrations
| File | Content |
|---|---|
| `supabase/migrations/1350_purchase_types.sql` | settings + types tables, RLS, grants, admin RPCs, starter-row seed in `set_purchase_types_enabled` |
| `supabase/migrations/1351_procurement_purchase_type.sql` | procurement columns, guard trigger, `create_procurement_with_items` re-created, history config |
| `supabase/migrations/1352_extend_rental_procurement.sql` | `extend_rental_procurement` |
| `supabase/migrations/rollback/1350..1352_*_down.sql` | reverse each (refused while typed purchases exist) |
| 1353, 1354 | held in reserve (fix-ups) |
Fragments: `supabase/tests/inventory/anon-executable-definers/purchase-types.txt` (new definers) and `scripts/isolation-probe-denominator.d/purchase-types.json` (new tables).

## Tasks and owning test per AC (test first)
| Step | Files | AC | Layer |
|---|---|---|---|
| 1 pgTAP, settings and types | `supabase/tests/purchase_types.test.sql` | AC-PTR-002, 003, 007, 012 | pgTAP |
| 2 pgTAP, create path and guard | `supabase/tests/procurement_purchase_type.test.sql` | AC-PTR-001, 004, 005, 006 | pgTAP |
| 3 pgTAP, extension | `supabase/tests/rental_extension.test.sql` | AC-PTR-008, 009, 010, 011, 012 | pgTAP |
| 4 migrations 1350-1352 to green | as above | | |
| 5 Mutation checks (drop admin test; drop flag test; drop order rule; drop feature-off refusal) | | AC-PTR-003, 004, 009, 001 | recorded in report |
| 6 DAL + repository + types regen | `src/lib/db/purchaseTypes.ts`, `src/lib/repositories/purchaseTypes.ts`, `database.types.ts` | | Unit |
| 7 Create form + list filter | `pages/ProcurementCreate.tsx`, `pages/Procurement.tsx` | AC-PTR-013, 014 | Unit |
| 8 Details, chips, links, Extend modal | `pages/ProcurementDetails.tsx`, `src/components/procurement/RentalExtensionModal.tsx` | AC-PTR-013, 015 | Unit |
| 9 Admin settings screen, route, locales | `pages/PurchaseTypeSettings.tsx`, `App.tsx`, `locales/{en,id}` | AC-PTR-016 | Unit |
| 10 One journey | `pmo-portal/e2e/AC-PTR-017-rental-extension.spec.ts` | AC-PTR-017 | E2E |
| 11 Evidence | `docs/evidence/1215/2697/` phone 390 and desktop 1440 at 2x for the settings screen and the extend modal | | |
| 12 Glossary and decisions note | `docs/glossary.md` | | |

## Gates
`npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run` on changed sources, then the locked reset + pgTAP (new files + 0178 + 0646) and `scripts/e2e-local.sh AC-PTR-017`.
