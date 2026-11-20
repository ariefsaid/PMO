# Supplier Supply-Risk Status Implementation Plan (#2583)

> Fresh Orca worker per slice; Slice 2 (the governed status write) is Director-dispatched. Spec: `docs/specs/vendor-supply-risk.spec.md`. Sign OD-VSR and answer OQ-VSR first.

## Design summary
- Status lives on `companies` (the supplier). Columns follow the `set_vendor_tax_defaults` precedent (0273): a guard trigger refuses direct client writes; a security-definer function is the only writer; it audits through `log_audit` and history via `record_history_config`.
- The suggestion is a read function (security invoker, so RLS applies) with two bases: PMO and ERP. PMO basis applies the shipped payables rule at case level (spec Definitions): `procurements` of the supplier at status `Vendor Invoiced`; unpaid = max(sum of non-voided `procurement_invoices.amount` - sum of `payments.amount` where status `Paid`, 0), unknown if any invoice amount is null; age = days from the case's earliest `invoice_date` to the org's today; buckets from `ageingBucket`; per `procurements.currency`. ERP basis reads `erp_ap_aging_snapshot` (`b_61_90` + `b_90_plus`, verbatim) when `domain_externally_owned(org,'procurement')`, matched by `company_id`, else `party = companies.erp_supplier_name`, else "no aging data". The SQL function is authoritative for the screen; the TypeScript `suggestSupplyRisk` mirrors it and both are tested against the same hand example (AC-VSR-001, 017).
- Exposure is a read on `purchase_orders` (status `Issued`/`Acknowledged`, from the 0035 check) joined through `purchase_orders.procurement_id` to `procurements.vendor_id` (purchase_orders has no vendor column) and to `work_orders` (`Draft`/`Issued`) via `purchase_orders.work_order_id` (0951). `procurements` has no `work_order_id`; orders that name none are project-level.
- Notification is emitted inside the status function via `notify_workflow_user` (0237) to each exposed project's `project_manager_id`.

## Migrations (numbers assigned by the Director; rollback file for each; RLS and force RLS already on `companies`)
- **Migration A: supply-risk columns and guard.** Add to `companies`: `supply_risk_status text not null default 'active' check in ('active','at_risk','inactive')`, `supply_risk_reason text`, `supply_risk_set_by uuid references profiles(id) on delete set null`, `supply_risk_set_at timestamptz`; shape check (reason present when not active, 1-500 chars); guard trigger like `companies_tax_defaults_guard`. Add the three captured columns to `record_history_config` for `company` (`supply_risk_status` enum, `supply_risk_set_at` timestamp; reason as flag column). Rollback: drop trigger, constraints, columns, restore the registry row.
- **Migration B: `set_vendor_supply_status(company_id, status, reason)`.** Security definer, `search_path` pinned, `assert_is_active_member`, refuses any role outside Admin/Finance with 42501 (enum roles: Executive, Project Manager, Finance, Engineer, Admin), vendor-only, same org, not archived, reason rule, `for update`, audit action `company.supply_risk.change`, notify exposed project managers once per change (skips same-status). Revoke from public/anon; grant authenticated. Rollback: drop function.
- **Migration C: read functions.** `vendor_supply_risk_suggestion(company_id)` and `vendor_exposed_work_orders(company_id)` (security invoker, org via RLS, `(select auth_org_id())` wrapped helpers), plus an index `procurement_invoices(procurement_id)` already exists (0006) and `procurements(vendor_id)` is checked first; add a partial index on `purchase_orders(procurement_id) where status in ('Issued','Acknowledged')` only if EXPLAIN shows a scan. Rollback: drop functions and index.
- ADR candidate: "The supply-risk flag is a human decision with a machine suggestion; payables age follows the ADR-0048 source split." Only if the owner rules OD-VSR-1 as default.

## Files to create or modify
- Create `pmo-portal/src/lib/supplyRisk.ts` (pure `suggestSupplyRisk(invoices, today)` and types) and `src/lib/__tests__/supplyRisk.test.ts`.
- Create `pmo-portal/src/lib/db/supplyRisk.ts` and a repository entry under `src/lib/repositories/` (ADR-0017); hook `src/hooks/useSupplyRisk.ts`.
- Modify `pmo-portal/src/auth/policy.ts`: `supplyRisk: { view: allow(MASTER_DATA), set: allow(['Admin','Finance']) }`.
- Modify `pmo-portal/pages/Companies.tsx` (or the company record page it opens): status chip in the list; record section with current status, suggestion, "Set to suggested", exposed work orders. Use `EntityFormModal`/`SelectField`/`ConfirmDialog` primitives; `restructure` skill for composition.
- Modify the work-order page (`#2518`, `docs/specs/work-order-record-page.spec.md`) and `pages/project-detail/tabs/WorkOrdersTab.tsx`: warning row.
- Modify i18n: `pmo-portal/src/i18n` en and id keys for statuses, suggestion sentence, reasons, errors, warning text.
- Add pgTAP `supabase/tests/vendor_supply_risk.test.sql`; e2e `pmo-portal/e2e/AC-VSR-015-set-supply-risk.spec.ts`.
- Docs: `docs/glossary.md` terms (done in this branch).

## Slice 1 — pure suggestion (Orca)
- [ ] Write `supplyRisk.test.ts` first from the hand-worked invoices (AC-VSR-001, 003, 005); then implement `suggestSupplyRisk` with exact decimals. `npx vitest run src/lib/__tests__/supplyRisk.test.ts`.

## Slice 2 — governed status write (Director)
- [ ] pgTAP `vendor_supply_risk.test.sql` for AC-VSR-006..010 and 014 first. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/vendor_supply_risk.test.sql'`.
- [ ] Migrations A, B. The status write is enforced by the database (AC-VSR-006..009 are pgTAP, not UI). Mutation checks, one at a time, each must turn its AC red, then restore: set the role check to `true` (AC-VSR-007 red); drop the guard trigger and grant update on the columns (AC-VSR-007 direct-write case red); drop the reason rule (AC-VSR-009 red); skip the audit insert (AC-VSR-006 red).

## Slice 3 — suggestion and exposure reads (Orca)
- [ ] pgTAP AC-VSR-001, 002, 004, 011, 012, 016, 017 (notification once, actor excluded, repeat adds none); Migration C; mutation checks: drop the voided filter (AC-VSR-002 red); net all payments regardless of status or ignore payments (AC-VSR-017 red); match ERP rows by party only or default to `active` when unmatched (AC-VSR-004, 016 red).
- [ ] `db/supplyRisk.ts`, repository, hook; `policy.ts` actions.

## Slice 4 — screens (ui-implementer; `restructure`)
- [ ] Component test AC-VSR-013 first; company record section, list chip, work-order warning; en and id.
- [ ] E2E `AC-VSR-015-set-supply-risk.spec.ts` (tag `@e2e-isolation`, see `docs/e2e-parallel-conventions.md`).

## Traceability
| AC | Owning test |
|---|---|
| AC-VSR-001 | `vendor_supply_risk.test.sql` (authoritative) + `supplyRisk.test.ts` (mirror) |
| AC-VSR-002, 004, 010, 011, 012, 016, 017 | `vendor_supply_risk.test.sql` |
| AC-VSR-003, 005 | `supplyRisk.test.ts` |
| AC-VSR-006..009, 014 | `vendor_supply_risk.test.sql` |
| AC-VSR-013 | component test beside the work-order page |
| AC-VSR-015 | `AC-VSR-015-set-supply-risk.spec.ts` |

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest, touched pgTAP, touched e2e via `scripts/e2e-local.sh`; `scripts/ux-proof.sh` on touched routes. Check i18n parity (en and id) with the repo's existing translation guard.

## Not confirmed
- Whether the shipped payables figure excludes voided bills: the client select (`PROCUREMENT_LIST_DETAILS`, `src/lib/db/procurements.ts`) does not read `voided_at`, and `create_payment` leaves a voided bill out of the billed gross (0885). The spec excludes voided invoices; the worker checks the recorded-total trigger and, if the shipped list counts a voided bill, raises it as a defect on the payables screen rather than diverging silently.
- The shipped payables list is case-level; a supplier with one case holding an old paid invoice and a new unpaid one is aged by the old invoice (earliest date). This mirrors `/finance/payables` on purpose; a per-invoice rule would need `payments.invoice_id` and is out of scope.
