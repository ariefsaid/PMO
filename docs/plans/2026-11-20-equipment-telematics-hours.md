# Equipment telematics hours Implementation Plan (#2582)

> Scheduled for when a second client asks. Fresh Orca worker per slice; Slice 2 Director-dispatched, ships alone (it creates cost-bearing Draft entries). Spec: `docs/specs/equipment-telematics-hours.spec.md`. Builds on `equipment_assets` and `equipment_usage_entries` (0447, 0878, 0951), the import wizard (ADR-0027, `pmo-portal/src/lib/import/`), `work_order_plan_lines` (0997) and, for the comparison, #2526. Sign OD-TEL and answer OQ-TEL first.

## Design summary
- A tracker reading is not a usage entry (an entry needs a project; a tracker does not know it). Readings sit in their own table; a person proposes them into **Draft** `equipment_usage_entries` through a server function that reuses the validation of `save_equipment_usage`. The existing submit, approve and separation-of-duties path is untouched, so no new approval or money rule exists; the new proof is that readings never count and never skip approval.
- Machine mapping: a new `equipment_assets.telematics_ref` (text), separate from the ERP pair `external_tier`/`external_ref`.
- File import first via a new `ImportDescriptor` on the existing wizard; the descriptor's create step calls one batch function. A readings **adapter interface** (TypeScript, vendor-free) calls the same function for a future API feed. Edge-function adapter wiring follows ADR-0055 and `adapter-dispatch`; none is built here.
- Location is a free-text place label; no coordinates by default (OD-TEL-3). No work-location table exists today, so the label is not a reference.
- ADR candidate: "Tracker data is held as readings, never as usage; the adapter seam is one batch function shared by file and feed." Write only when the first build starts.

## Migrations (numbers assigned by the Director; each has a rollback file; RLS + force RLS; `stamp_org_id`)
- **Migration A:** `alter table equipment_assets add column telematics_ref text`; unique index on `(org_id, lower(btrim(telematics_ref)))` where not null and `archived_at is null`; no client column grant. Function `set_equipment_telematics_ref(p_asset uuid, p_ref text)` (security definer, Admin/PM/Engineer per `can()`, audited via `log_audit`). Rollback: drop the function, index and column.
- **Migration B:** `equipment_telemetry_batches` (id, org_id default stamp, source `file|connector`, adapter_key null, file_name, rows_total/created/skipped/failed/unmatched, created_by, created_at) and `equipment_telemetry_readings` (id, org_id, batch_id, unit_ref text, asset_id null, reading_date date, engine_hours numeric(5,2) check 0..24, place_label text check length <= 120, status `pending|proposed|dismissed|unmatched`, usage_entry_id null references usage entries on delete set null, dismissed_reason, dismissed_by, created_at). Unique `(org_id, lower(btrim(unit_ref)), reading_date)` where status <> `dismissed`; index `(org_id, asset_id, reading_date)`. RLS select per FR-TEL-021 wrapped `(select helper())`; no insert/update/delete grant to `authenticated`. Rollback: drop both tables.
- **Migration C:** functions `import_equipment_readings(p_batch jsonb)` (create-only, idempotent, matches by `telematics_ref`, rejects bad rows into a result array), `rematch_equipment_readings(p_asset uuid)`, `propose_equipment_usage_from_readings(p_items jsonb)` (per item: reading id, project, optional work order and discipline; calls the shared core of `save_equipment_usage`, Draft only, one transaction, reports "already logged"), `dismiss_equipment_reading(p_id uuid, p_reason text)`, `list_equipment_hours_comparison(p_asset_ids uuid[], p_from date, p_to date)`, `list_work_order_equipment_hours_comparison(p_work_order uuid)` (reads `work_order_plan_lines` kind `equipment_hours`), and `purge_equipment_readings(p_before date)` for the scheduled clean-up. The comparison status-conflict join to #2526's status table is added when that ships (Slice 4 note). Rollback: drop the functions.

## Slice 1 — mapping and file import (Orca)
- [ ] Failing pgTAP `supabase/tests/equipment_telemetry_import.test.sql` first: AC-TEL-004, 005, 006, 016 (import part). Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/equipment_telemetry_import.test.sql'`.
- [ ] Migrations A, B and the import and rematch functions of C.
- [ ] `pmo-portal/src/lib/import/equipmentReadingsDescriptor.ts` (labels and aliases en + id, validators for date, hours 0..24, optional place) with `pmo-portal/src/lib/import/__tests__/equipmentReadingsDescriptor.test.ts`: AC-TEL-003, 013. Reuse `refLookup.ts` only if needed; the unit identifier is matched server-side.
- [ ] `pmo-portal/src/lib/db/equipmentTelemetry.ts` and a method group on the equipment repository `pmo-portal/src/lib/repositories/equipment.ts`; regenerate DB types per the repo's convention.
- [ ] `pmo-portal/src/auth/policy.ts` actions (`equipmentTelemetry`) and role-matrix registration (#902).

## Slice 2 — propose to Draft (Director, ships alone)
- [ ] Failing pgTAP `supabase/tests/equipment_telemetry_propose.test.sql`: AC-TEL-007, 008, 009, 010, 011.
- [ ] `propose_equipment_usage_from_readings`, `dismiss_equipment_reading`. Mutation checks: (a) set the new entry's status to Approved: AC-TEL-007 must go red; (b) relax the approver check: AC-TEL-008 must go red; (c) add readings to the usage-totals read: AC-TEL-010 must go red. Restore after each.
- [ ] Review screen section `pmo-portal/pages/Equipment.tsx` (readings tab: pending list, choose project per row or in bulk, propose, dismiss), phone-usable, en + id.

## Slice 3 — comparison (Orca; after #2519, and #2526 for the conflict flag)
- [ ] Failing unit test `pmo-portal/src/lib/__tests__/equipmentHoursComparison.test.ts` using the hand-calculated day and work order: AC-TEL-001, 002, 012; then `pmo-portal/src/lib/equipmentHoursComparison.ts` (exact decimals only).
- [ ] pgTAP `supabase/tests/equipment_telemetry_comparison.test.sql`: AC-TEL-001 at the SQL layer; functions `list_equipment_hours_comparison`, `list_work_order_equipment_hours_comparison`.
- [ ] Comparison table (day-by-day drill-down) on the asset screen and a column group on the work order plan-versus-actual section (`docs/specs/work-order-plan-vs-actual.spec.md`).

## Slice 4 — retention, connector seam, journey (Orca)
- [ ] pgTAP AC-TEL-014 (retention) and AC-TEL-015 (adapter path); `purge_equipment_readings` scheduled through the existing scheduled-job mechanism.
- [ ] `pmo-portal/src/lib/equipmentReadingsAdapter.ts`: the `ReadingsAdapter` interface (`fetchReadings(connection, from, to)` returning canonical rows) plus a test stub; `supabase/functions/` wiring only when a real adapter is requested, following ADR-0055 and `adapter-dispatch`.
- [ ] E2E `pmo-portal/e2e/AC-TEL-017-import-propose-approve.spec.ts` (convention: `docs/e2e-parallel-conventions.md`, `@e2e-isolation` tag).

## Traceability
| AC | Owning test |
|---|---|
| AC-TEL-001 | `equipmentHoursComparison.test.ts` (+ SQL layer in `equipment_telemetry_comparison.test.sql`) |
| AC-TEL-002, 012 | `equipmentHoursComparison.test.ts` |
| AC-TEL-003, 013 | `equipmentReadingsDescriptor.test.ts` |
| AC-TEL-004, 005, 006 | `equipment_telemetry_import.test.sql` |
| AC-TEL-007..011 | `equipment_telemetry_propose.test.sql` |
| AC-TEL-014, 015 | `equipment_telemetry_comparison.test.sql` / adapter unit test |
| AC-TEL-016 | `equipment_telemetry_import.test.sql` |
| AC-TEL-017 | `e2e/AC-TEL-017-import-propose-approve.spec.ts` |

## i18n
New strings in the equipment catalogue under `pmo-portal/src/lib/i18n/` (see `CATALOGUES.md` there; en and id, same layout as `equipmentCatalogue.ts`): template headers and notes, row errors, statuses (pending, proposed, dismissed, unmatched), comparison labels, empty states. Rebase translation-file edits immediately before each PR (#1070).

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest files only, touched pgTAP under `scripts/with-db-lock.sh`, touched e2e via `scripts/e2e-local.sh`; `scripts/ux-proof.sh` on touched routes. Migration collision: `scripts/renumber-migration.sh`.
