# Plan — third-party inspection tracker with cost (#2580)

Spec: `docs/specs/third-party-inspections.spec.md` (its "Review 20 Nov" section is binding) · branch `feat/2580-inspections` ·
migrations 1130-1134.

## Built on defaults (owner to confirm)

| Decision | Default built |
|---|---|
| OD-TPI-1 | Cost is read from the linked procurement case; no cost is entered on an inspection (`tpi_costs` reads `work_order_cost_lines`, 0951). |
| OD-TPI-2 | Complete = reported with `pass` or `conditional`, or waived; `fail` and `pending` block (`tpi_is_complete`). |
| OD-TPI-3 | A waiver needs a reason and a person other than the creator (`TPI_WAIVE_SELF`, enforced by `guard_tpi_transition`; no client write grant exists on the waiver columns). |
| OD-TPI-4 | The feature only exposes the prerequisite read and shows a billing-open line on the work-order page (display only); #2522 and #2576 own the block. |
| OD-TPI-5 | One inspection is one test event; a re-test is a new inspection. |
| OD-TPI-6 | A trigger on the four purchase record tables (`a1_tpi_stamp_cost_attribution`, 1133) stamps the linked inspection's work order on a new record that names none. It touches only `work_order_id`, never overwrites, and skips a case whose work order is Cancelled so procurement is never broken. Ships alone (money path). |
| OD-TPI-7 | Engineer scope is the organisation's active members with the Engineer role, org-wide (no per-project membership concept exists). |
| OD-TPI-8 | A required inspection cannot be cancelled (`TPI_CANCEL_REQUIRED`); it is reported or waived. Cancellation is for tracked-only inspections: the creator (Engineer) while `requested`, or a Project Manager, Finance or Admin at any status before reported. |
| OQ-TPI-1 | Test kind is free text (`test_kind`), no organisation list yet. |
| OQ-TPI-2 | The vendor's invoice comes through a purchase; an inspection with no purchase shows "No purchase". |
| OQ-TPI-3 | Overdue is the planned date itself (strictly before today, calendar dates). |
| OQ-TPI-4 | An inspection names the work order only (the section is null until #2576). |

Choices made where the spec was silent (also owner-confirmable): the execution date may not be later than the server's UTC date
plus one day ("not in the future" in every time zone); an ERP-cancelled purchase order is excluded from committed like an
ERP-cancelled bill is excluded from billed; Engineer may create an inspection with any gates; the planning estimate is hidden from
the table's client column grant and is returned only by `tpi_costs`, null outside the money roles; the overdue sweep is scheduled
daily (`tpi-overdue`, 01:41 UTC) and is callable by `service_role` only.

## Tasks (as built)

1. **1130 tracker** — `supabase/migrations/1179_third_party_inspections.sql` (+ rollback): `third_party_inspections` (RLS + FORCE,
   `stamp_org_id`, no client write grant, column-level SELECT without the estimate), `guard_tpi_transition` (every state rule in one
   trigger), `third_party_inspection_files` (append-only once reported, 10 live files, `on delete restrict`), private bucket
   `inspection-reports` (15 MB; pdf, images, Office) + storage RLS.
2. **1131 writers** — `supabase/migrations/1180_third_party_inspection_rpcs.sql`: `tpi_create`, `tpi_record_invitation`,
   `tpi_record_execution`, `tpi_record_report`, `tpi_waive`, `tpi_cancel` (role gates + actor/date stamps + audit rows).
3. **1132 record history** — registers the entity (parent: its work order), the capture trigger and the `record_history_visible` arm;
   `record_changes_catalog_gate.test.sql` now counts 18 entities.
4. **1133 purchase link (money path)** — `tpi_raise_purchase` (new Draft case through the shipped `create_procurement_with_items`, or
   link an unlinked case of the project and attribute its records through the shipped `set_cost_attribution`) and the four stamping triggers.
5. **1134 reads** — `tpi_costs` (committed and billed per currency, server-side null amounts outside Admin/Executive/Finance/Project
   Manager), `work_order_inspection_prerequisites` (jsonb `{complete, inspections}`), `run_tpi_overdue_sweep` + cron.
6. **Seam** — `src/lib/db/thirdPartyInspections.ts`, `src/lib/repositories/{contracts/,}thirdPartyInspections.ts`,
   `src/hooks/useThirdPartyInspections.ts`, `can()` entries (`thirdPartyInspection`), hand-edited `database.types.ts`.
7. **Screen** — `pages/work-order-detail/InspectionsSection.tsx` on the work-order page; strings `inspections.*` in
   `public/locales/{en,id}/workOrders.json`.
8. **Isolation manifest** — `scripts/isolation-probe-denominator.json`: two tables, the definer functions, the bucket.

## Acceptance criteria and owning layer

| AC | Owning test | Layer |
|---|---|---|
| AC-TPI-001 | `supabase/tests/1134_third_party_inspection_reads.test.sql`; `pages/work-order-detail/InspectionsSection.test.tsx` (display) | pgTAP + Unit |
| AC-TPI-002 | `supabase/tests/1133_third_party_inspection_purchase.test.sql` | pgTAP |
| AC-TPI-003 | 1133 test (link refusals) | pgTAP |
| AC-TPI-004 | `supabase/tests/1179_third_party_inspections.test.sql` | pgTAP |
| AC-TPI-005 | 1130 test | pgTAP |
| AC-TPI-006 | 1130 test | pgTAP |
| AC-TPI-007 | 1134 test; `src/lib/db/thirdPartyInspections.test.ts` (completeness rule) | pgTAP + Unit |
| AC-TPI-008 | 1130 test | pgTAP |
| AC-TPI-009 | 1130 test (create refusal and roll-up) | pgTAP |
| AC-TPI-010 | 1130 test | pgTAP |
| AC-TPI-011 | 1134 test | pgTAP |
| AC-TPI-012 | 1133 test | pgTAP |
| AC-TPI-013 | 1130 test + 1133 test (Engineer raise) + `src/auth/policy.thirdPartyInspection.test.ts` | pgTAP + Unit |
| AC-TPI-014 | 1133 test | pgTAP |
| AC-TPI-015 | `pmo-portal/e2e/AC-TPI-015-inspection-journey.spec.ts` | E2E |
| AC-TPI-016 | `pmo-portal/e2e/AC-TPI-016-engineer-report.spec.ts` | E2E |
| AC-TPI-017 | 1130 test | pgTAP |
| AC-TPI-018 | 1133 test ((a)-(c)); (d) `0950_work_order_cost_attribution.test.sql` run unchanged | pgTAP |

## Verify

`flock /tmp/db.lock bash -c 'supabase db reset && supabase test db supabase/tests/1179_third_party_inspections.test.sql supabase/tests/1133_third_party_inspection_purchase.test.sql supabase/tests/1134_third_party_inspection_reads.test.sql supabase/tests/record_changes_catalog_gate.test.sql'`;
in `pmo-portal`: `npx vitest run pages/work-order-detail/InspectionsSection.test.tsx src/auth/policy.thirdPartyInspection.test.ts src/lib/db/thirdPartyInspections.test.ts`.

## Not built

- Vendor picker on the request form (the database accepts `vendor_id`; the form sends none).
- Linking an existing procurement case from the screen (the RPC supports it; the screen raises a new Draft case).
- A test-kind list per organisation (OQ-TPI-1), the section picker (#2576), blocking billing or readiness (#2522 / #2576).
- Actual (paid) figure beside committed and billed (spec: "where wanted"); an inspection overdue badge computed on the server (the
  screen compares calendar dates; the notice itself is server-computed).
