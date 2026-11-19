# Equipment Availability Implementation Plan (#2526)

> Fresh Orca worker per slice; Slice 4 Director-dispatched (money). Spec: `docs/specs/equipment-availability.spec.md`. Builds on `equipment_assets` and `equipment_usage_entries` (0447) and the usage spec (#1519). Sign OD-EAV and answer OQ-EAV first.

## Migrations (numbers assigned by the Director; rollback files; RLS + force RLS; `stamp_org_id`)
- Alter `equipment_assets`: add `ownership text check in ('owned','rented') default 'owned'`, `in_service_on date`; add the column to the insert grant list only through an RPC (0447 grants insert by column).
- `equipment_rental_terms` (asset, vendor company id, rate, basis day|month, currency, from, to; exclusion constraint on overlapping ranges per asset).
- `equipment_status_days` (asset, status_date, status, note, set_by; unique asset+date), history via `record_history_config`.
- `equipment_downtime_periods` (asset, started_on, ended_on) derived by trigger from status days; `equipment_downtime_proofs` (period, attachment id).
- Escalation: SQL function `equipment_downtime_escalations(as_of date)` plus a scheduled call into the existing notification path; read function `equipment_metrics(asset ids, from, to, grain)`; function `equipment_rental_check(asset, period from, to, invoice_amount)`.

## Slice 1 — pure metrics (Orca)
- [ ] `pmo-portal/src/lib/equipmentMetrics.ts` + `src/lib/__tests__/equipmentMetrics.test.ts` using the hand-calculated month (AC-EAV-001, 002, 010, 011) written first; `exactDecimal` only. `npx vitest run src/lib/__tests__/equipmentMetrics.test.ts`.

## Slice 2 — status, rental terms, downtime (Orca)
- [ ] pgTAP `supabase/tests/equipment_status.test.sql`: AC-EAV-003..007, 012. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/equipment_status.test.sql'`.
- [ ] Migration, triggers, RPCs; `equipment_metrics` read model agrees with Slice 1 (AC-EAV-001 at SQL layer).
- [ ] `src/lib/db/equipmentStatus.ts`, repository, `policy.ts` actions, role-matrix registration.

## Slice 3 — screens (ui-implementer; `restructure`)
- [ ] `pages/EquipmentAvailability.tsx`: bulk "today" status (phone), asset detail with owned/rented terms form, downtime proof upload, metrics table day/week/month with the day-by-day drill-down; en + id.
- [ ] E2E `e2e/AC-EAV-013-set-status-with-proof.spec.ts`.

## Slice 4 — rental invoice check (Director, ships alone)
- [ ] pgTAP `supabase/tests/equipment_rental_check.test.sql`: AC-EAV-008, 009, 010. Mutation check: remove the proof filter; AC-EAV-009 must go red; restore.
- [ ] `equipment_rental_check`; Finance-only action; screen section on asset detail; E2E `e2e/AC-EAV-014-rental-invoice-deduction.spec.ts`.

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest, pgTAP and e2e; `scripts/ux-proof.sh` on touched routes.
