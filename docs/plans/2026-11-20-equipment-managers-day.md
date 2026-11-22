# Plan — equipment manager's day

Spec: `docs/specs/equipment-managers-day.spec.md`. Branch `fix/walk-equipment`. Migrations 1600, 1601.

## Tasks (each test first, at its owning layer)

1. **DB role gates** — `supabase/migrations/1600_equipment_manager_asset_writes.sql` (+ rollback): `equipment_can_edit_terms` adds
   Project Manager (feeds `save_equipment_rental_term`, `change_equipment_rental_rate`, `end_equipment_rental_term`,
   `create_rented_equipment_asset`); `set_equipment_working_hours` and `set_equipment_targets` restated from 1032 / 1415 with the
   1480 guard and Admin or Project Manager; `equipment_rental_check` restated from 1034 + the 1209 guard, readable by Project Manager
   without a reason. Proof: `supabase/tests/1600_equipment_manager_asset_writes.test.sql`; the old "Project Manager cannot change the
   settings" assertion in `equipment_target_settings.test.sql` is removed (the rule changed on purpose).
2. **DB metrics** — `1601_equipment_metrics_before_org_existed.sql`: `equipment_metrics` restated from 1033 + guard; days before the
   earliest of the organisation's creation date and its first recorded status or usage are not in service. Proof:
   `1601_equipment_metrics_before_org_existed.test.sql`.
3. **Policy** — `src/auth/policy.ts`: `equipmentAvailability.manage` adds Project Manager, new `configure` (Admin, Project Manager);
   `approve` unchanged. Proof `policy.test.ts`.
4. **Screens** — `pages/equipment/EquipmentHome.tsx` (route `/equipment`), `MachineStatusSection.tsx` (extracted from Availability,
   adds note + photo in one step and the who-is-told line), `AssetFormModal.tsx` (new and edit, rented fields),
   `EquipmentUsage.tsx` (clash sentence, broken marker and confirm, work order and discipline on the row, submit by the hours, saved
   feedback), `ExpiringDocuments.tsx` + `ExpiryDocumentsCard.tsx` (renew), `RentalInvoiceCheck.tsx` (plain words),
   `EquipmentAvailability.tsx` (shared section, DataTable metrics, status effects, role gates), `DateTime24Field.tsx` and
   `VendorResponsePanel.tsx` (24-hour time), date pickers on the equipment forms.
5. **Strings** — `public/locales/{en,id}/equipment.json` (every sentence in both languages).
6. **Browser journeys** — `JOB-CF-EQ-1`, `JOB-CF-EQ-4`, `JOB-CF-EQ-6` (new); `JOB-E1`, `JOB-E4`, `JOB-E8` extended; `JOB-E4`
   wording updated for the plain-words result.

## Needs a menu entry (other lane)
`/equipment` is unchanged in the rail; the hours log lives at `/equipment?view=hours` (no new route, no new breadcrumb parent).
