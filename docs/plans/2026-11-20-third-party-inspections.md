# Third-party Inspections Implementation Plan (#2580)

> Fresh Orca worker per slice; Slice 3 Director-dispatched (money), ships alone. Spec: `docs/specs/third-party-inspections.spec.md`. Builds on `procurements` and its records (`purchase_requests`, `purchase_orders`, `procurement_receipts`, `procurement_invoices`), cost attribution (0950-0952, ADR-0104), `work_orders` (0193), `companies`, `notifications` (0048), the `*_files` pattern (0036) and record history (0260, `record_history_config`). Sign OD-TPI and answer OQ-TPI first. Sections (#2576) do not exist: `section_id` is a plain nullable uuid until its migration adds the foreign key. Blocked-by note for the Director: wiring the prerequisite into #2522 and #2576 belongs to those tickets.

## Design summary
- One table `third_party_inspections` holds the tracker. Status moves only through RPCs (`SECURITY DEFINER`, `assert_is_active_member`, role and org checks in the body, as `create_purchase_request`). Direct insert/update on `status`, `procurement_id`, result and waiver columns is not granted; a trigger also refuses skipped steps so no writer bypasses the RPC.
- Cost is not stored. `procurement_id` links one case; cost views read `purchase_orders` and `procurement_invoices` where `work_order_id` equals the inspection's (security_invoker, each source's own RLS decides what is visible). No new cost writer: the "raise purchase" RPC calls the existing procurement create functions and `set_cost_attribution` (0951) inside the same transaction.
- Report files follow `purchase_request_files`: a files table plus the existing private storage bucket policy (segment-2 org check); append-only once `reported`.
- Prerequisite read `work_order_inspection_prerequisites` is a stable security_invoker function consumed by #2522 / #2576.
- Overdue sweep: SQL function plus the existing scheduled-notification path (as FR-EAV-009 / document expiry), writing `notifications`.

## Migrations (numbers assigned by the Director; each has a rollback file; RLS + force RLS; `org_id` default / `stamp_org_id`)
- **Migration A (tracker + files):** `third_party_inspections` (org, project, work_order_id not null, section_id uuid null, title, test_kind, vendor_company_id, planned_on, estimate, currency, required_for text[] check subset of readiness|billing, status check, result check, procurement_id null unique, dates per step with actor columns, cancelled_reason, waiver_reason/by/at, archived_at, created_by) + `third_party_inspection_files` (inspection, storage path, name, size, type, uploader); indexes `(org_id, work_order_id)`, `(org_id, project_id, status)`; trigger refusing direct status writes and skipped steps; trigger making report files append-only after `reported`; add both tables to `record_history_config`. Rollback drops both tables and triggers.
- **Migration B (step RPCs + prerequisite read):** `inspection_create`, `inspection_advance(id, to, payload)`, `inspection_cancel`, `inspection_waive`, `work_order_inspection_prerequisites(...)`, with grants revoked from public and anon. Rollback drops the functions.
- **Migration C (purchase link + cost read, money):** `inspection_raise_purchase(id, link_procurement_id default null)` using existing create functions and `set_cost_attribution`, the `TPI_*` refusals (project, work order, one-case-per-inspection), view `third_party_inspection_cost` (security_invoker, per currency). Rollback drops the function and view and leaves the cases untouched.
- **Migration D (overdue):** `inspection_overdue_sweep(as_of date)` writing `notifications` once per inspection and recipient (idempotency key in `metadata`). Rollback drops it.
- ADR candidate: "Inspections link to procurement rather than carry cost" (reuse of the cost path; cost never stored on the tracker). Write the ADR only if the owner confirms OD-TPI-1.

## Files
Create: `supabase/tests/third_party_inspections.test.sql`, `supabase/tests/third_party_inspection_cost.test.sql`; `pmo-portal/src/lib/inspectionRules.ts` (+ `src/lib/__tests__/inspectionRules.test.ts`: completeness, step order, cost totals per currency); `pmo-portal/src/lib/db/thirdPartyInspections.ts`; `pmo-portal/src/lib/repositories/thirdPartyInspections.ts` (+ test); `pmo-portal/pages/Inspections.tsx` (work-order inspections panel, also reachable from the project); `pmo-portal/e2e/AC-TPI-015-inspection-request-to-report.spec.ts`, `AC-TPI-016-report-from-phone.spec.ts`.
Modify: `pmo-portal/src/auth/policy.ts` (+ `policy.inspection.test.ts`, role-matrix registration); `pmo-portal/App.tsx` (route/tab); the i18n catalogues (en + id, rebase immediately before the PR); `docs/glossary.md`; `docs/jtbd.md` §6 later by the Director.

## Slice 1 — pure rules (Orca)
- [ ] Write `inspectionRules.test.ts` first from the hand-worked example (AC-TPI-001 display, AC-TPI-007 completeness: pass, conditional, fail, waived, cancelled); implement with exact decimals only, no blending across currencies. `npx vitest run src/lib/__tests__/inspectionRules.test.ts`.

## Slice 2 — tracker, files, steps, prerequisite (Orca)
- [ ] pgTAP `third_party_inspections.test.sql` red first: AC-TPI-004, 005, 006, 008, 009, 010, 011, 013 (database part). Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/third_party_inspections.test.sql'`.
- [ ] Migration A, B, D; mutation check: set the report-needs-file guard to true, AC-TPI-005 must go red; remove the creator check, AC-TPI-008 must go red; restore.
- [ ] DAL + repository + `can()` actions (AC-TPI-013 unit part).

## Slice 3 — purchase link and cost read (Director, ships alone)
- [ ] pgTAP `third_party_inspection_cost.test.sql` red first: AC-TPI-001, 002, 003, 012, 014. Money-path primer: `docs/money-path-primer.md`.
- [ ] Migration C. Mutation checks: drop the project match in the link, AC-TPI-003 must go red; make the cost view ignore `work_order_id`, AC-TPI-001 must go red; restore.
- [ ] Confirm no change to any create function, status transition or ERP command of procurement; compare committed spend before and after (AC-TPI-014).

## Slice 4 — screens (ui-implementer; `restructure`)
- [ ] `Inspections.tsx`: list per work order with status stepper, overdue flag, cost per currency, "raise purchase" and step actions gated by `can()`; report upload with phone camera input; prerequisite summary line; en + id. Section picker hidden until #2576.
- [ ] E2E AC-TPI-015 and AC-TPI-016. `scripts/e2e-local.sh AC-TPI`.

## Traceability
| AC | Owning test |
|---|---|
| AC-TPI-001 | `supabase/tests/third_party_inspection_cost.test.sql` + `inspectionRules.test.ts` |
| AC-TPI-002, 003, 012, 014 | `third_party_inspection_cost.test.sql` |
| AC-TPI-004, 005, 006, 008, 009, 010, 011 | `third_party_inspections.test.sql` |
| AC-TPI-007 | `third_party_inspections.test.sql` + `inspectionRules.test.ts` |
| AC-TPI-013 | `third_party_inspections.test.sql` + `policy.inspection.test.ts` |
| AC-TPI-015, 016 | the two e2e specs |

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest, touched pgTAP under the DB lock, touched e2e; `scripts/ux-proof.sh` on touched routes.
