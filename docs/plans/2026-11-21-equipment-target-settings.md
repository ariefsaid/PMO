# Plan: equipment targets and escalation limit settings (#2701)

Spec: `docs/specs/equipment-target-settings.spec.md`. Migrations 1415-1416 only (1417-1419 unused). Test-first.

## Tasks
1. **pgTAP first** `supabase/tests/equipment_target_settings.test.sql` (AC-ETS-001, 003, 004, 005, 006); run red.
2. **Migration `supabase/migrations/1415_equipment_target_settings.sql`**: add to `organizations`: `equipment_availability_target_pct numeric(4,1)` and `equipment_utilisation_target_pct numeric(4,1)` (nullable, check 0..100), `equipment_escalation_down_days int not null default 2` (check 1..365). Functions (security definer, search_path `public, pg_temp`, owner postgres, no anon/PUBLIC grant): `set_equipment_targets(p_availability numeric, p_utilisation numeric, p_escalation_days int)` (active member, Admin only, validates, updates the caller's org) and `get_equipment_targets()` (active member, own org). Rollback `supabase/migrations/rollback/1415_equipment_target_settings_down.sql`.
3. **Migration `1416_equipment_escalation_uses_setting.sql`**: `create or replace` `equipment_downtime_escalations` with `having count(*) > (select o.equipment_escalation_down_days from organizations o where o.id = p_org)`; `create or replace` `run_equipment_downtime_escalations` so the notice title carries the limit. Same signatures, owners, grants. Rollback restores the 1033 bodies (`1416_..._down.sql`).
4. Add fragment `scripts/isolation-probe-denominator.d/2701-equipment-target-settings.json` (the two definer functions); add both functions to `supabase/tests/inventory/anon-executable-definers/` if 0178 requires it; run `node scripts/check-isolation-denominator.mjs` and `--self-test`.
5. **DAL / repository / hook** (Vitest first): `pmo-portal/src/lib/db/equipmentAvailability.ts` (`getTargets`, `setTargets`), `src/lib/repositories/equipmentAvailability.ts`, `src/hooks/useEquipmentAvailability.ts` (`useEquipmentTargets`, `useSetEquipmentTargets`).
6. **UI** `pmo-portal/pages/equipment/EquipmentAvailability.tsx`: Admin-only (real role) settings row beside the working-hours row, built from `TextField` (+ `classifyMutationError`); below-target marker on the two metric columns only when a target is set; flag label takes the limit. Strings in `public/locales/{en,id}/equipment.json`. Tokens only; phone and desktop; screenshots to `docs/evidence/1215/2701/` (390 and 1440).
7. Glossary: add "availability target", "use target", "escalation limit" to `docs/glossary.md`.

## AC traceability
| AC | Owner | File |
|---|---|---|
| AC-ETS-001/003/004/005/006 | pgTAP | `supabase/tests/equipment_target_settings.test.sql` |
| AC-ETS-002 | pgTAP (existing, untouched) | `supabase/tests/equipment_status.test.sql` |
| AC-ETS-007/008/009 | Vitest | `pmo-portal/pages/equipment/EquipmentAvailability.test.tsx` (new cases only) |
| AC-ETS-010 | mutation runs | quoted in the report |

## Gates
`npm run check:guards`; `npm run typecheck`; eslint on changed files; `vitest related --run`; under `/tmp/db.lock`: reset + new pgTAP + `equipment_status.test.sql` + `0178_*` + `0646_rls_initplan.test.sql`; denominator check live and `--self-test`.
