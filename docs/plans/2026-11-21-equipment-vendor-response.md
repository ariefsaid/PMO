# Equipment vendor response time (#2702)

> Spec: `docs/specs/equipment-vendor-response.spec.md`. Branch `feat/2702-vendor-response-time`. Migrations 1372-1374 only. Builds on 1032/1033; does not touch `equipment_downtime_escalations` or `run_equipment_downtime_escalations` (#2701 owns them). Gate change: pgTAP written, not run, in this lane.

## Migrations (each with `supabase/migrations/rollback/<n>_<slug>_down.sql`)
- **1372_equipment_vendor_response.sql** — table `equipment_vendor_responses` (`id`, `org_id` default `auth_org_id()` via `stamp_org_id`, `asset_id`, `period_start date`, `vendor_id` FK companies, `reported_at timestamptz`, `responded_at timestamptz`, `note`, `recorded_by default auth.uid()`, `recorded_at default now()`; unique `(asset_id, period_start)`; check `responded_at >= reported_at`). RLS + force RLS; select policy with `(select helper())`, no write grant to `authenticated`. Isolation fragment `scripts/isolation-probe-denominator.d/2702-vendor-response.json`.
- **1373_equipment_vendor_response_rpc.sql** — `record_equipment_vendor_response(p_asset uuid, p_period_start date, p_responded_at timestamptz, p_reported_at timestamptz default null, p_note text default null)` and `clear_equipment_vendor_response(p_asset, p_period_start)`; security definer, gate `equipment_can_set_status(auth_role())`, validates per FR-EVR-003/005 (period must exist via `equipment_downtime_days`), upserts and restamps.
- **1374_equipment_vendor_response_reads.sql** — `list_equipment_breakdowns(p_asset_ids uuid[], p_from date, p_to date)` returning asset, period_start, period_end, vendor, reported_at, responded_at, response_minutes, note; bounded 200 assets / 400 days. The per-vendor summary is computed by the pure TS function over this list (one source of truth, AC-EVR-008 asserts both agree).

## Tasks (test first)
1. [ ] `pmo-portal/src/lib/vendorResponse.ts` + `src/lib/__tests__/vendorResponse.test.ts` (AC-EVR-008, 009): `responseMinutes`, `vendorResponseSummary` per the spec definitions.
2. [ ] pgTAP `supabase/tests/equipment_vendor_response.test.sql` (AC-EVR-001..008, 010) — written, run once per wave.
3. [ ] Migrations 1372-1374 and rollbacks; isolation fragment.
4. [ ] `src/lib/db/equipmentVendorResponse.ts`, `src/lib/repositories/equipmentVendorResponse.ts`, `src/hooks/useVendorResponse.ts` (new files; never edit `useEquipmentTargets.ts`).
5. [ ] `pmo-portal/pages/equipment/VendorResponsePanel.tsx` (per-breakdown list, per-vendor summary, record dialog via `EntityFormModal`) and `VendorResponseAction.tsx`; mount lines only in `EquipmentAssetDetail.tsx` (a rented asset's breakdowns) — NOT in `EquipmentAvailability.tsx`. Test AC-EVR-011 (components render nothing with no data) beside it.
6. [ ] `policy.ts`: reuse the status-setting action; add no new entity unless needed. Strings in `public/locales/{en,id}/equipment.json` in a new namespace block `vendorResponse` appended at the end (small, merge-trivial).
7. [ ] Glossary: add "breakdown" and "response time" to `docs/glossary.md`.

## Traceability
| AC | Layer | File |
|---|---|---|
| AC-EVR-001..007, 010 | pgTAP | `supabase/tests/equipment_vendor_response.test.sql` |
| AC-EVR-008 | pgTAP + unit | same + `vendorResponse.test.ts` |
| AC-EVR-009 | unit | `vendorResponse.test.ts` |
| AC-EVR-011 | unit | `VendorResponsePanel.test.tsx` |

## Mutation check (recorded, not run in this lane)
Drop the `responded_at >= reported_at` guard in the RPC: AC-EVR-003 must go red.
