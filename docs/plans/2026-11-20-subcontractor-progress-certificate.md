# Subcontractor Progress Certificate Implementation Plan (#2584)

> Money tier: **Director-dispatched, one fresh Orca worker per slice, each slice ships alone** (`docs/orca-dispatch.md`). Spec: `docs/specs/subcontractor-progress-certificate.spec.md`. Builds on the shipped subcontract path (`0449`, `0470`, `0472`, `0474`, `0885`), work-order attribution (`0951`) and, **not yet shipped**, #1522 daily site report and #2528 crews. Sign OD-SPC-1..9 and answer OQ-SPC-1..2 first; do not start Slice 3 until #1522 and #2528 have landed on `dev` with a crew on progress lines (read their final names from `dev`, do not guess).

## Reuse map (no parallel payables path)
| Need | Reuse | Never |
|---|---|---|
| Subcontract, PO lines, rate ceiling | `purchase_order_lines`, `po_effective_revision()` | a second PO line store |
| Verified quantity and cap | `subcontract_verified()`, `subcontract_bill_cap_violation()` | a second cap rule |
| Acceptance | `prepare_subcontract_acceptance()` (draft), shipped confirm | confirming on the certificate's behalf |
| Bill and payable | `capture_subcontract_vendor_invoice()`, `procurement_invoice_lines`, void `0885` | inserting invoice or payment rows directly |
| Cost on a work order | `procurement_invoices.work_order_id`, `check_cost_attribution`, `work_order_cost_lines` | a certificate-specific cost view |
| Locking | `subcontract_po_lock()`; order procurement row, PO lock, certificate | a new lock order |
| Rate-line shape | pattern of `0515_contract_rates.sql` (version, `is_current`, window, `stamp_org_id`) | the client rate table itself |

## Migrations (numbers assigned by the Director at dispatch; each with a `supabase/migrations/rollback/` file that refuses while rows exist; RLS and FORCE RLS on every table; `org_id` by `stamp_org_id` trigger, never a client value; every policy wraps helpers as `(select auth_org_id())`, `(select is_active_member())`, `(select auth_role())` so `supabase/tests/0646_rls_initplan.test.sql` stays green)
1. **Rate card.** `subcontractor_rate_lines` (vendor company id, `boq_item_id`, unit, rate `numeric(14,2)` >= 0, currency, `effective_from` with a check that it is a month start, `effective_to`, `line_key`, `version`, `is_current`, `created_by`); unique one current per (org, vendor, item); exclusion constraint on overlapping windows per (vendor, item); history via `record_history_config`. Writes only through `save_subcontractor_rate(...)` (Admin, Finance); select for Admin, Finance, Executive and a Project Manager of a project the vendor has a subcontract on. Rollback: drop table and function, refused while rows exist.
2. **Certificate.** `subcontract_certificates` (po id, project id, work order id, period start and end, status, preparer, submitted_at, approver, approved_at, invoice id, cancelled reason, gross, backcharge total, net, currency; unique live certificate per (PO, period) by partial index); `subcontract_certificate_lines` (certificate, `boq_item_id`, quantity, rate, rate line id and version, amount generated `round(quantity * rate, 2)`, snapshot at submit); `subcontract_certificate_sources` (certificate, daily-report progress line id; unique among live certificates, enforced by trigger on status); `subcontract_backcharges` (org, vendor, project, work order null, amount > 0, reason code, note, proof attachment id, included certificate id null). No client DML grants; select only through RLS; guard trigger makes `approved`, `billed` rows and their children immutable for every writer including definers (mirror `guard_procurement_invoice_line`). Rollback: refused while rows exist.
3. **RPCs (security definer, `set search_path = public`, revoke from public and anon, execute to authenticated, caller authority checked before any figure is returned).** `derive_subcontract_certificate(po, period)` (read, invoker where possible); `prepare_subcontract_certificate`, `deselect_certificate_source`, `record_backcharge`, `submit_subcontract_certificate` (freezes snapshot), `return_subcontract_certificate`, `approve_subcontract_certificate` (approver <> preparer, cap pre-check via `subcontract_bill_cap_violation`, net >= 0, nothing unrated), `bill_subcontract_certificate` (one call to `capture_subcontract_vendor_invoice`, sets `work_order_id`, stores invoice id, idempotent), `cancel_subcontract_certificate`, `prepare_acceptance_from_certificate`. Each takes the PO lock first and writes an audit event.
4. **Deduction on the bill (ADR candidate: payable deduction on a vendor bill).** Nullable `procurement_invoices.deduction_amount numeric(14,2) not null default 0 check (>= 0)`, writable only through the capture path; the payment ceiling and the work-order cost read subtract it. Task 0 of Slice 4 is the reader inventory: list every function that reads `withheld_amount` (about twenty migrations, `scripts/prior-art.sh withheld_amount`) and decide, per reader, whether it must also subtract the deduction; the payable and the cost actual must use the same figure (AC-SPC-011, 016). Connected-ERP organisations: refuse billing a certificate that has backcharges until the ERP route carries the deduction (OD-SPC-5). Rollback: drop the column after verifying it is all zero.

## Slice 1 — pure derivation (Orca)
- [ ] Write first `pmo-portal/src/lib/subcontractCertificate.ts` tests in `pmo-portal/src/lib/__tests__/subcontractCertificate.test.ts` for the hand-calculated month: A 400.00, B 105.00, C 33.30, gross 538.30, backcharge 38.30, net 500.00, exclusions with reasons (AC-SPC-001, 002, 003, 005, 015). Red.
- [ ] Implement `deriveCertificate(measuredLines, rateLines, poLines, backcharges)` with `exactDecimal` only; rounding `round(q x r, 2)` half away from zero to match Postgres; returns lines, excluded with reasons, totals. Green. Run `npx vitest run src/lib/__tests__/subcontractCertificate.test.ts`.

## Slice 2 — rate card (Orca)
- [ ] pgTAP `supabase/tests/subcontractor_rate_card.test.sql` first: AC-SPC-004 and the rate-card half of AC-SPC-017 (overlap refused, non-month-start refused, version history kept, PM sees only own projects' vendors, Engineer sees none). Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/subcontractor_rate_card.test.sql'`.
- [ ] Migration 1 and `save_subcontractor_rate`; `pmo-portal/src/lib/db/subcontractorRates.ts`, `pmo-portal/src/lib/repositories/subcontractorRates.ts` (repository seam, ADR-0017); `policy.ts` entity `subcontractorRates` and role-matrix registration (#902).
- [ ] Screen: rate card section on the vendor company page and the subcontract detail (`restructure`); `EntityFormModal`, `Combobox`, `ConfirmDialog` shared primitives; en and id strings in the catalogue beside `equipmentCatalogue`.

## Slice 3 — derive and certificate, no money yet (Orca; needs #1522 and #2528 on `dev`)
- [ ] pgTAP `supabase/tests/subcontract_certificate_derive.test.sql` first: AC-SPC-001, 002, 005, 008, 012 (claim once), 017. Red.
- [ ] Migrations 2 (tables, guard) and the derive, prepare, deselect, record_backcharge, submit, return, cancel RPCs; server derive equals the Slice 1 function on the hand month (AC-SPC-001 at SQL layer).
- [ ] `src/lib/db/subcontractCertificates.ts`, repository, `policy.ts`, hooks; no approve or bill call yet.
- [ ] Screen `pages/SubcontractCertificate.tsx` (+ list on the subcontract detail): derived table, exclusions panel, backcharge form, gross / backcharge / net, prepare-acceptance button; draft, submitted, returned states; en and id; `restructure`, then `scripts/ux-proof.sh` on touched routes; RTL tests for every state (AC-SPC-019).

## Slice 4 — approval, acceptance bridge, bill, deduction (Director, ships alone)
- [ ] Task 0: reader inventory of `withheld_amount` and a written decision per reader; record the ADR candidate.
- [ ] pgTAP `supabase/tests/subcontract_certificate_money.test.sql` first: AC-SPC-006, 007, 009, 010, 011, 013, 014, 015, 016. Concurrency file `supabase/tests/subcontract_certificate_concurrency.test.sql` (AC-SPC-012, bills). Red.
- [ ] Migrations 3 and 4 (approve, bill, prepare_acceptance_from_certificate, deduction column and readers). Approve calls the shipped cap function; bill calls the shipped capture function once.
- [ ] **Mutation check** (`supabase/tests/subcontract_certificate_mutation.test.sql`, AC-SPC-018): (a) change `approver <> preparer` to always true, AC-SPC-006 must go red; (b) remove the cap pre-check, AC-SPC-009 must go red; (c) drop the immutability guard, AC-SPC-007 must go red; (d) make bill insert lines directly, AC-SPC-010 must go red. Restore after each and re-run green.
- [ ] Approve and bill buttons gated by `can()`; refusal wording from the shipped `SC001` error; E2E `pmo-portal/e2e/AC-SPC-020-certificate-to-bill.spec.ts` (preparer prepares from validated reports, a different Finance user approves and bills); isolation class per `docs/e2e-parallel-conventions.md`.

## Traceability
| AC | Owning layer | File |
|---|---|---|
| AC-SPC-001, 002 | pgTAP (owner) | `subcontract_certificate_derive.test.sql`; also referenced: Unit in `subcontractCertificate.test.ts` |
| AC-SPC-003 | Unit | `subcontractCertificate.test.ts` |
| AC-SPC-004 | pgTAP | `subcontractor_rate_card.test.sql` |
| AC-SPC-005 | pgTAP | `subcontract_certificate_derive.test.sql` |
| AC-SPC-006, 007, 009, 010, 011, 013, 014, 015, 016 | pgTAP | `subcontract_certificate_money.test.sql` |
| AC-SPC-008, 017 | pgTAP | derive and rate-card files |
| AC-SPC-012 | pgTAP concurrency | `subcontract_certificate_concurrency.test.sql` |
| AC-SPC-018 | pgTAP mutation | `subcontract_certificate_mutation.test.sql` |
| AC-SPC-019 | Unit/RTL | `pages/__tests__/SubcontractCertificate.test.tsx` |
| AC-SPC-020 | E2E, one journey | `e2e/AC-SPC-020-certificate-to-bill.spec.ts` |

## Glossary (same PR as Slice 2, `domain-modeling`)
Add to `docs/glossary.md`: subcontractor progress certificate, measured line, rate card (subcontractor), backcharge, net certified amount.

## Final gate (each slice)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, the touched vitest files, touched pgTAP files under `scripts/with-db-lock.sh`, the touched e2e journey, `scripts/ux-proof.sh` on touched routes. Slice 4 ships as its own PR to `dev`.
