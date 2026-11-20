# Equipment telematics hours Implementation Plan (#2582)

> Scheduled for when a second client asks. Fresh Orca worker per slice; Slice 2 Director-dispatched, ships alone (it creates cost-bearing Draft entries). Spec: `docs/specs/equipment-telematics-hours.spec.md`. Builds on `equipment_assets` and `equipment_usage_entries` (0447, 0878, 0951), the import wizard (ADR-0027, `pmo-portal/src/lib/import/`), `work_order_plan_lines` (0997, shipped with its plan-versus-actual screen, #2519). #2526 (availability) is spec-only; the status-conflict flag is optional and waits for it. Sign OD-TEL and answer OQ-TEL first.

## Design summary
- A tracker reading is not a usage entry (an entry needs a project; a tracker does not know it). Readings sit in their own table; a person proposes them into **Draft** `equipment_usage_entries` through a server function that reuses the validation of `save_equipment_usage`. The existing submit, approve and separation-of-duties path is untouched, so no new approval or money rule exists; the new proof is that readings never count and never skip approval.
- Machine mapping: a new `equipment_assets.telematics_ref` (text), separate from the ERP pair `external_tier`/`external_ref`.
- File import first via a new `ImportDescriptor` (`pmo-portal/src/lib/import/types.ts`) on the existing wizard. The wizard calls `create` once per valid row, so the descriptor generates one batch id per wizard session and each call passes it with the row; the server function creates the batch on first use and keeps its counts. A vendor-free readings **adapter interface** (TypeScript, inbound feed) calls the same function for a future API feed. ADR-0055's `Adapter` (`pmo-portal/src/lib/adapterSeam/contract.ts`) is the command contract for domains an external system owns, which a tracker does not, so the readings adapter does not implement it; it reuses the `supabase/functions/adapter-dispatch/` pattern (per-organisation connection, edge execution, `AdapterError` classes) when a real adapter is requested. ADR candidate: generic inbound feed adapter.
- Location is a free-text place label; no coordinates by default (OD-TEL-3). No work-location table exists today, so the label is not a reference.
- ADR candidate: "Tracker data is held as readings, never as usage; the adapter seam is one server function shared by file and feed" (this and the generic inbound feed adapter above are one ADR). Write only when the first build starts.

## Migrations (numbers assigned by the Director; each has a rollback file; RLS + force RLS; `stamp_org_id`)
- **Migration A:** `alter table equipment_assets add column telematics_ref text`; unique index on `(org_id, lower(btrim(telematics_ref)))` where not null and `archived_at is null`; no client column grant. Function `set_equipment_telematics_ref(p_asset uuid, p_ref text)` (security definer, Admin/PM/Engineer per `can()`, audited via `log_audit`). Rollback: drop the function, index and column.
- **Migration B:** `equipment_telemetry_batches` (id, org_id default stamp, source `file|connector`, adapter_key null, file_name, rows_total/created/skipped/failed/unmatched, created_by, created_at) and `equipment_telemetry_readings` (id, org_id, batch_id, unit_ref text, asset_id null, reading_date date, engine_hours numeric(5,2) check 0..24, place_label text check length <= 120, status `pending|proposed|dismissed|unmatched`, usage_entry_id null references usage entries on delete set null, dismissed_reason, dismissed_by, created_at). Unique `(org_id, lower(btrim(unit_ref)), reading_date)` where status <> `dismissed`; index `(org_id, asset_id, reading_date)`. RLS select per FR-TEL-021 wrapped `(select helper())`; no insert/update/delete grant to `authenticated`. Rollback: drop both tables.
- **Migration C:** functions `import_equipment_readings(p_batch_id uuid, p_file_name text, p_row jsonb)` (create-only, idempotent, creates the batch on first call, matches by `telematics_ref`, returns created, already-there or unmatched, raises on a conflicting figure; a feed passes many rows per call), `rematch_equipment_readings(p_asset uuid)`, `propose_equipment_usage_from_readings(p_items jsonb)` (per item: reading id, project, optional work order and discipline; security definer; checks for an existing non-archived `work` entry for the asset, project and day first and reports "already logged", else calls `save_equipment_usage(jsonb)` with no entry id (always Draft, author `auth.uid()`; it has no shared core to call, and it takes no work order, so a chosen work order or discipline is applied with `set_cost_attribution('equipment_usage', ids, work_order, discipline)`, 0951); never inserts into `equipment_usage_entries` itself; one transaction), `dismiss_equipment_reading(p_id uuid, p_reason text)`, `list_equipment_hours_comparison(p_asset_ids uuid[], p_from date, p_to date)`, `list_work_order_equipment_hours_comparison(p_work_order uuid)` (sums `work_order_plan_lines` rows of kind `equipment_hours` for the work order across disciplines; tracker hours per FR-TEL-014; Admin, Executive, Finance, Project Manager only). The status-conflict join to #2526's status table is added only if and when #2526 ships. Rollback: drop the functions.
- **Migration D:** the retention job, following migration 0565: `select cron.schedule('equipment-readings-purge', '35 3 * * *', $$delete from public.equipment_telemetry_readings where reading_date < current_date - 90$$)` (the day-count follows OD-TEL-5); rollback `cron.unschedule('equipment-readings-purge')`. Add both tables and the job to `docs/retention.md` in the same change (`scripts/check-retention.mjs`).

## Slice 1 — mapping and file import (Orca)
- [ ] Failing pgTAP `supabase/tests/equipment_telemetry_import.test.sql` first: AC-TEL-004, 005, 006, 016 (import part). Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/equipment_telemetry_import.test.sql'`.
- [ ] Migrations A, B and the import and rematch functions of C.
- [ ] `pmo-portal/src/lib/import/equipmentReadingsDescriptor.ts` (a `makeEquipmentReadingsImportDescriptor(t?)` factory returning `ImportDescriptor<EquipmentReadingImportInput>`, copying the shape of `pmo-portal/src/lib/import/contractLineDescriptor.ts`: `t`-localised labels, `aliases` en + id, `hint`, `existingKeys`, `IMPORT_SKIPPED` for an already-there row; validators for date, hours 0..24, optional place) with `pmo-portal/src/lib/import/__tests__/equipmentReadingsDescriptor.test.ts` (copy the shape of `contractLineDescriptor.test.ts`): AC-TEL-003, 013. Import strings go in the `import` namespace: `pmo-portal/public/locales/en/import.json` and `pmo-portal/public/locales/id/import.json`. Reuse `refLookup.ts` only if needed; the unit identifier is matched server-side.
- [ ] `pmo-portal/src/lib/db/equipmentTelemetry.ts` and a method group on the equipment repository `pmo-portal/src/lib/repositories/equipment.ts`; regenerate DB types per the repo's convention.
- [ ] `pmo-portal/src/auth/policy.ts` actions (`equipmentTelemetry`) and role-matrix registration (#902).

## Slice 2 — propose to Draft (Director, ships alone)
- [ ] Failing pgTAP `supabase/tests/equipment_telemetry_propose.test.sql`: AC-TEL-007, 008, 009, 010, 011.
- [ ] `propose_equipment_usage_from_readings`, `dismiss_equipment_reading`. Mutation checks: (a) set the new entry's status to Approved: AC-TEL-007 must go red; (b) relax the approver check: AC-TEL-008 must go red; (c) add readings to the usage-totals read: AC-TEL-010 must go red. Restore after each.
- [ ] Review screen section `pmo-portal/pages/Equipment.tsx` (readings tab: pending list, choose project per row or in bulk, propose, dismiss), phone-usable, en + id.

## Slice 3 — comparison (Orca; #2519 plan lines are shipped; the conflict flag only after #2526)
- [ ] Failing unit test `pmo-portal/src/lib/__tests__/equipmentHoursComparison.test.ts` using the hand-calculated day and work order: AC-TEL-001, 002 (and 012 only once #2526 ships); then `pmo-portal/src/lib/equipmentHoursComparison.ts` (exact decimals only).
- [ ] pgTAP `supabase/tests/equipment_telemetry_comparison.test.sql`: AC-TEL-001 at the SQL layer; functions `list_equipment_hours_comparison`, `list_work_order_equipment_hours_comparison`.
- [ ] Comparison table (day-by-day drill-down) on the asset screen and a tracker-hours column on the work order plan-versus-actual section (`pmo-portal/pages/project-detail/WorkOrderPlanVsActual.tsx`, spec `docs/specs/work-order-plan-vs-actual.spec.md`).

## Slice 4 — retention, connector seam, journey (Orca)
- [ ] pgTAP AC-TEL-014 (retention: the purge statement of migration D, plus `npm run check:guards` for the `docs/retention.md` entries) and AC-TEL-015 (adapter path).
- [ ] `pmo-portal/src/lib/equipmentReadingsAdapter.ts`: the `ReadingsAdapter` interface (`fetchReadings(connection, from, to)` returning canonical rows) plus a test stub; `supabase/functions/` wiring only when a real adapter is requested, following the `adapter-dispatch` pattern (ADR-0055).
- [ ] E2E `pmo-portal/e2e/AC-TEL-017-import-propose-approve.spec.ts` (convention: `docs/e2e-parallel-conventions.md`, `@e2e-isolation` tag).

## Traceability
| AC | Owning test |
|---|---|
| AC-TEL-001 | `equipmentHoursComparison.test.ts` (+ SQL layer in `equipment_telemetry_comparison.test.sql`) |
| AC-TEL-002 (012 optional, after #2526) | `equipmentHoursComparison.test.ts` |
| AC-TEL-003, 013 | `equipmentReadingsDescriptor.test.ts` |
| AC-TEL-004, 005, 006 | `equipment_telemetry_import.test.sql` |
| AC-TEL-007..011 | `equipment_telemetry_propose.test.sql` |
| AC-TEL-014, 015 | `equipment_telemetry_comparison.test.sql` (014 plus `check:guards` retention entries) / adapter unit test |
| AC-TEL-016 | `equipment_telemetry_import.test.sql` |
| AC-TEL-017 | `e2e/AC-TEL-017-import-propose-approve.spec.ts` |

## i18n
New strings in the `equipment` namespace catalogue, `pmo-portal/public/locales/en/equipment.json` and `pmo-portal/public/locales/id/equipment.json` (parity proven by `pmo-portal/src/lib/i18n/equipmentCatalogue.test.ts`; rules in `pmo-portal/src/lib/i18n/CATALOGUES.md`), and the import template strings in the `import` namespace (`pmo-portal/public/locales/{en,id}/import.json`): template headers and notes, row errors, statuses (pending, proposed, dismissed, unmatched), comparison labels, empty states. Rebase translation-file edits immediately before each PR (#1070).

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest files only, touched pgTAP under `scripts/with-db-lock.sh`, touched e2e via `scripts/e2e-local.sh`; `scripts/ux-proof.sh` on touched routes. Migration collision: `scripts/renumber-migration.sh`.
