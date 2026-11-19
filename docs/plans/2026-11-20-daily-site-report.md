# Daily Site Report Implementation Plan (#1522)

> Execute each slice with a fresh Orca worker. Spec: `docs/specs/daily-site-report.spec.md` (owner must sign OD-DSR-1..7 first). Revised 2026-11-20: online first; offline is #2534. Replaces the 2026-11-02 plan (offline-queue slices removed).

**Goal:** a field controller enters a day's report per work order on a phone; the QS validates it next day; only validated reports count and yield daily revenue from the rate catalogue.

**Depends on:** #2517 (work order on cost lines), #2520 (rate catalogue). Reconcile their final table/function names first (Slice 0).

## Migrations
Numbers: assigned by the Director at build (spec brief gave none); all with `supabase/migrations/rollback/<n>_down.sql`. Tables, all `org_id` stamped by `stamp_org_id`, RLS + force RLS, grants column-limited as in 0447:
`idle_reasons`, `weather_conditions` (org lists, archivable) · `daily_site_reports` (work_order_id, work_date, status, version, supersedes_id, author, validated_by/at, client_request_id, hours start/end, weather_id, note; unique live (work_order_id, work_date) where not superseded) · `dsr_progress_lines` (contract line, sub-stage, qty, unit, frozen rate id/amount) · `dsr_idle_periods` · `dsr_consumables` · photo link via the shared attachment table.
RPCs (security definer, `set search_path = public`): `dsr_submit`, `dsr_validate` (author != validator; freezes rates), `dsr_return`, `dsr_correct`. Read function `work_order_validated_revenue(work_order_id)`.

## Slice 0 — reconcile (docs only, 30 min)
- [ ] Read #2517/#2520 shipped migrations; list exact names for work-order attribution and rate lookup `(item, stage, location, date)`; record in a short note at the top of the spec.

## Slice 1 — server (Director-dispatched, ships alone)
- [ ] `supabase/tests/dsr_report.test.sql`: AC-DSR-002, 005, 006, 007, 009, 010, 012, 014 (write failing first).
- [ ] Migration for tables + RLS; run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/dsr_report.test.sql'`.
- [ ] RPCs; mutation check: set the author check to `true`, AC-DSR-005 must go red; restore.
- [ ] Register actions in the role matrix (#902) and `src/auth/policy.ts` (`view|enter|submit|validate` on `daily_site_report`) with a field-controller role entry.

## Slice 2 — DAL, repository, revenue
- [ ] `pmo-portal/src/lib/db/dailySiteReports.ts` + `src/lib/repositories/dailySiteReports.ts` (ADR-0017); no `org_id` from client.
- [ ] `src/lib/dsrRevenue.ts` with `exactDecimal`; test AC-DSR-003/004 first (`npx vitest run src/lib/__tests__/dsrRevenue.test.ts`).

## Slice 3 — phone screen (ui-implementer; `restructure` skill)
- [ ] `pages/DailySiteReport.tsx` + route in `App.tsx`; sections per FR-DSR-002..008 using `EntityFormModal`/`useEntityForm` primitives; photo capture via the existing attachment uploader; equipment/people hours read-only blocks (AC-DSR-011).
- [ ] Validation queue `pages/DailySiteReportQueue.tsx` (FR-DSR-017), `ConfirmDialog` on validate/return.
- [ ] Strings in en + id; unit tests for states (empty, error, no-rate, unrated, returned) and AC-DSR-001/008/015.

## Slice 4 — acceptance
- [ ] `e2e/AC-DSR-013-field-report-to-validation.spec.ts` (tag `@e2e-isolation`, read `docs/e2e-parallel-conventions.md`); run `scripts/e2e-local.sh AC-DSR-013`.
- [ ] `scripts/ux-proof.sh` on touched routes at 320px.

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest files, touched pgTAP files.

## Traceability
Each AC in the spec table maps to the layer named there; Slice 1 owns the pgTAP ones, Slice 2 the unit money ones, Slice 3 the form ones, Slice 4 the journey.
