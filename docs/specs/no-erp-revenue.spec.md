# Feature: Customer invoices and receipts for orgs without an ERP (#784)

> **Status:** Draft for Director sign-off (2026-10-07). Plan: `docs/plans/2026-10-07-no-erp-revenue.md`.
> ADR: `docs/adr/0055-external-system-adapters-sot-enhancement.md` § Addendum 2026-10-07 (native revenue).
> **Grounds (read, not re-derived):** OD-REEL-1 (build it; PMO must run without an ERP) · OD-SAR-DRAFT-SUBMIT
> (create leaves a Draft; a different person approves) · owner ruling 2026-07-20 + 2026-10-07 (revenue writes are
> Admin/Finance only) · migrations 0132/0133 (the append-only author set is the approval SoD oracle) · 0128 (the
> current revenue write policies) · 0176/0178 (client INSERT on `sales_invoices`/`incoming_payments` is a narrow,
> author-less Draft/Scheduled body; UPDATE and DELETE grants revoked) · DD-WO-3 (`erp_outstanding_amount` is the one
> paid-detection oracle) · OD-TAX-1 / OD-TAX-4 / DD-TAX-4a (every invoice carries its treatment; the project's VAT flag
> decides tax; a VAT invoice is never untaxed) · DD-RCPT-1 (a receipt's settled amount includes tax withheld) ·
> OD-BILL-1 + DD-BWO-1..8 (billing by work order; 0262 refuses invoicing past a work order) · OD-XING-1 (at connect,
> nothing from before is pushed unless the client chooses otherwise) · ADR-0016/0017/0019 (repository seam; `can()` is
> UX only; SoD by SECURITY DEFINER RPC + pgTAP).
> **Builds on (must be on `dev` first):** #785 — `supabase/migrations/0262_billing_by_work_order.sql`
> (`lock_work_order_billing`, the `sales_invoices` work-order fence, the `workOrderId` create input). Migration slot for
> this issue: **0264** only.

## 1. Job story

When my org runs PMO without an ERP, I want to raise a customer invoice, have a second person approve it, and record
the payment, so billing happens in PMO as the product promises.

**What is missing today:** a Finance user in a no-ERP org cannot bill. Every revenue write is refused at the
repository (`revenue-not-enabled`); nothing can approve, number, settle or mark paid an invoice raised in PMO.

## 2. Scope

**In:** raise (Draft) → approve by a different Admin/Finance user → record part or full receipts → Paid; cancel a
Draft or an unsettled invoice; cancel a receipt; behaviour when the org later connects an ERP; the Approvals-page queue
for PMO drafts; the revenue tables' write policies stated as the owner's rule (Admin and Finance only).

**Out (not needed by an AC — each a follow-up or an owner question, §9):** printable/PDF invoice · editing a raised
invoice (cancel and re-raise) · "Invoice this work order" button in a no-ERP org (the RPC already accepts a work
order; the #785 tab gate and dialog copy are ERP-only) · progress-billing claim invoices without an ERP · the
assistant's `draft_invoice` in a no-ERP org · showing the PMO number in the assistant's overdue list · credit notes,
dunning, currency conversion · notifications to approvers.

## 3. Director decisions proposed (`DD-NAR-n` — to be moved to `docs/decisions.md` on sign-off)

- **DD-NAR-1 — PMO owns revenue when no ERP row says otherwise.** No `revenue` row in `external_domain_ownership` ⇒ PMO
  is the system of record for that org's sales invoices and customer receipts. No new flag or state.
- **DD-NAR-2 — Same tables, one marker.** A PMO invoice or receipt is a row of `sales_invoices` / `incoming_payments`
  with `pmo_native = true`, written only by four SECURITY DEFINER RPCs. ERP mirror rows keep `pmo_native = false`.
  No parallel tables: every existing reader (Sales Invoices, Incoming Payments, Revenue by project, management pack,
  0262's work-order billing views, the assistant's overdue list) works unchanged.
- **DD-NAR-3 — No new status value.** Draft → Unpaid (approved) → Paid, plus Cancelled. "Partly paid" is a display
  state of a PMO Unpaid invoice whose balance is above zero and below its gross. (0262's views and the revenue
  status allow-list read `status`; a new value would silently miscount.)
- **DD-NAR-4 — Paid-ness is stamped from a derivation.** The receipt RPCs recompute the balance as gross − live PMO
  receipts (never increment it) under the invoice row lock, write it to `erp_outstanding_amount` (the one oracle every
  reader already uses, DD-WO-3) and set Paid exactly when it reaches zero. A view was rejected: the readers key on the
  stored columns, and a second answer would disagree with the first.
- **DD-NAR-5 — Approval SoD, server-enforced.** The approver must not be in the invoice's author set (or the legacy
  author column); an invoice with no recorded author can never be approved; an Admin is not exempt. The approver's
  role (Admin/Finance) and active membership are read from `profiles` at approval time, so a demoted or offboarded
  user is refused even with a live session. Same rule and messages as `submit_sales_invoice` (0133). Recording or
  cancelling receipts and cancelling invoices carry no SoD — the ERP path has none either.
- **DD-NAR-6 — Who.** Admin and Finance raise, approve, record and cancel. Approval is not budget-routed: #803's routing
  is for spend.
- **DD-NAR-7 — A project is required; tax comes from it.** A PMO invoice names a project. Its lines are pre-tax
  (`tax_treatment = 'exclusive'`). If the project is subject to VAT, the project's recorded VAT rate and base apply
  (e.g. PPN 12% on 11/12 = 11%); if not, tax is 0. A VAT project with no recorded rate refuses the invoice
  (DD-TAX-4a). Currency is the work order's when one is named, else the project's — never chosen by the client.
- **DD-NAR-8 — Lines live on the invoice.** `native_lines` (jsonb, fixed at creation) holds what was raised; the total
  is Σ round(qty × rate, 2) — ERPNext's line rule and 0262's in-flight check. No line table: lines are never queried
  on their own.
- **DD-NAR-9 — Numbers and dates.** `INV-YYMMDDnnnn` is minted on approval, so cancelled drafts leave no gaps; the
  invoice date is the approval day in the org's time zone. Receipts get `RCV-YYMMDDnnnn` when recorded. The customer
  PO reference is the work order's client PO, else the project's contract reference (DD-BWO-8's fallback).
- **DD-NAR-10 — Corrections by cancelling.** A Draft, or an Unpaid invoice with no live receipt, can be cancelled; a
  PMO receipt can be cancelled and the balance is restored. No edit. (A draft counts against its work order in 0262,
  so a wrong one must be removable; a mistyped receipt must be reversible.)
- **DD-NAR-11 — At connect (OD-XING-1 default).** Once an ERP owns revenue: every PMO write on these rows is refused
  (RPC check, plus the mirror guards pin the new columns); PMO invoices and receipts from before connect stay listed
  and readable; they are never sent to the ERP and never adopted. Employing revenue is refused while any PMO draft is
  open. Releasing the ERP re-opens PMO invoicing on the same rows.
- **DD-NAR-12 — Approvals queue.** PMO drafts the viewer may approve appear in "Customer invoices awaiting you" on
  `/approvals`, approved inline with a confirm. ERP-path drafts keep their existing Submit on Sales Invoices.
- **DD-NAR-13 — The column-limited insert stays, for Admin and Finance.** The narrow INSERT column grants of 0176/0178
  are untouched (0262's tests use them); with DD-NAR-15 only Admin and Finance pass the policy. A row inserted that way
  has `pmo_native = false` (the column is not granted), so it can never be approved, receipted or counted as PMO money.
  Replacing the column grant with the RPC is a follow-up once 0262's tests move to the RPC.
- **DD-NAR-14 — No server entitlement gate.** The `revenue` feature flag stays a navigation gate, as for the ERP path.
- **DD-NAR-15 — Revenue writes are Admin and Finance only (owner ruling).** The INSERT, UPDATE and DELETE row-level
  policies on `sales_invoices` and `incoming_payments` admit exactly Admin and Finance (active members of the row's
  org; INSERT also while no ERP owns revenue). Every RPC that writes these tables enforces the same role set in its own
  body. The ERP mirror writers (service role) and SECURITY DEFINER RPCs are unaffected by policies and keep working.

- **DD-NAR-16 — Connect tally per invoice (owner OD-NAR-1).** When an ERP is employed for revenue, each PMO invoice
  still Unpaid with a balance is stamped `erp_opening_amount` (its outstanding at that moment) and `erp_opening_at`;
  Paid or Cancelled invoices stay unstamped (never in the ERP). Only the employ path sets them. Finance reconciles their
  sum against the single opening entry posted in the ERP.
- **DD-NAR-17 — Receipt amount may differ (owner OD-NAR-1; replaces the over-receipt refusal).** A receipt carries the
  payment date (required, not future) and the amount received (defaults to the balance). Less leaves the balance
  outstanding; more marks the invoice Paid with `erp_outstanding_amount` = 0 and the excess shown as `overpaid_amount`.
  Cancelling a receipt recomputes both. No second person on receipts.

## 4. Functional requirements (EARS)

- **FR-NAR-001** Where no ERP owns revenue for the caller's org, when an active Admin or Finance member raises an
  invoice for a project and a customer of that org with 1–100 valid lines, the system shall save it as Draft with
  `pmo_native = true`, the lines, total = Σ round(qty × rate, 2), `tax_treatment = 'exclusive'`, the tax from FR-NAR-003,
  the currency from FR-NAR-004, and the caller recorded as author (author column and author set).
- **FR-NAR-002** The system shall refuse a PMO invoice whose project, customer or work order belongs to another org or
  does not exist; whose lines are not 1–100 lines each with an item code or description (≤140 characters each), a
  numeric quantity above zero with at most 3 decimals and a numeric rate of zero or more with at most 2 decimals; or
  whose total is not above zero.
- **FR-NAR-003** When the project is subject to VAT, the system shall apply the project's recorded VAT rate and tax base;
  when it is not, the tax shall be 0 at rate 0; when it is subject to VAT with no recorded rate, the system shall refuse.
- **FR-NAR-004** When a PMO invoice names a work order, the system shall take its currency and client PO from the work
  order, take the work order's billing lock before any project lock (DD-BWO-5), and leave the remaining-value refusal to
  0262; otherwise currency is the project's and the reference is the project's contract reference.
- **FR-NAR-005** When an Admin or Finance member approves a PMO Draft, the system shall refuse if the caller is not an
  active member, if the caller's current role is not Admin or Finance, if the invoice has no recorded author, or if the
  caller is in its author set; otherwise it shall set Unpaid, mint the PMO number, stamp the invoice date (org time zone),
  the approver and approval time, and set the balance to the gross.
- **FR-NAR-006** The Approvals page shall list the PMO drafts the viewer may approve, under "Customer invoices awaiting
  you", with an Approve action behind a confirmation.
- **FR-NAR-007** When an Admin or Finance member records a receipt against a PMO invoice that is Unpaid, the system shall
  refuse an amount above the balance, refuse cash + tax withheld ≠ amount settled, require a withholding-slip number when
  tax is withheld, record the receipt (Paid, PMO number, the invoice's customer and currency), recompute the balance from
  live PMO receipts, and set the invoice Paid when the balance is zero.
- **FR-NAR-008** While a PMO invoice is Unpaid with a balance above zero and below its gross, Sales Invoices shall show
  "Partly paid" and the balance.
- **FR-NAR-009** When an Admin or Finance member cancels a PMO invoice, the system shall allow it from Draft, or from
  Unpaid with no live receipt, and set the balance of a cancelled Unpaid invoice to zero. When they cancel a PMO receipt,
  the system shall mark it cancelled, recompute the invoice balance and set the invoice Unpaid or Paid accordingly.
- **FR-NAR-010** While an ERP owns revenue for the org, the system shall refuse every PMO invoice and receipt write, keep
  the existing PMO rows readable, and never dispatch them to the ERP (the UI offers no approve/cancel on them).
- **FR-NAR-011** When revenue is employed by an ERP for an org with an open PMO draft, the system shall refuse.
- **FR-NAR-012** The UI shall route revenue writes to the PMO path while no ERP owns revenue and keep the ERP path
  unchanged when one does.
- **FR-NAR-013** The system shall admit an INSERT, UPDATE or DELETE on `sales_invoices` or `incoming_payments` by a
  signed-in member only when that member is an active Admin or Finance member of the row's org (owner ruling); the
  service-role mirror writers and SECURITY DEFINER RPCs keep their own, role-checked paths.

## 5. Non-functional requirements

- **NFR-NAR-001 (ACL).** The four writers are SECURITY DEFINER with `search_path = public`, EXECUTE revoked from
  `public` and `anon` and granted to `authenticated`; the helper and the employ guard are not client-executable; no new
  column is client-insertable or -updatable. The migration asserts all of this on the database itself (hosted Supabase
  grants EXECUTE to `anon`/`authenticated` by default).
- **NFR-NAR-002 (concurrency).** Lock order: work-order billing lock → project row (FOR SHARE, so a VAT-flag change
  waits) → insert. Approve, receipt and cancel serialise on the invoice row lock; receipt cancel locks invoice then
  receipt. The balance is recomputed from receipts, never incremented.
- **NFR-NAR-003 (audit).** Creates are audited by the existing insert triggers (0176/0178/0232); approve/cancel and
  receipt-cancel write `log_audit` rows.
- **NFR-NAR-004 (reversible).** One migration (0264) with `supabase/migrations/rollback/0264_native_revenue_down.sql`.
- **NFR-NAR-005 (scale).** The approvals queue reads only PMO drafts (partial index); a balance is computed from one
  invoice's receipts (indexed by `(org_id, sales_invoice_id)`); list reads stay paged (`fetchAllPages`).
- **NFR-NAR-006 (i18n).** Every new string is a key in `en` and `id`; the new Approvals section is on the launch-scope
  route list.

## 6. Acceptance criteria

- **AC-NAR-001 — raise.** Given an org where no ERP owns revenue and a project subject to VAT at 12% on 11/12,
  When a Finance user raises an invoice for that project and a client with one line of 2 × 500,000,
  Then it saves as a Draft of 1,000,000 excl. PPN with tax 110,000, in the project's currency, the Finance user recorded
  as its author, and it lists under Sales Invoices for that org (and not for another org).
- **AC-NAR-002 — approve with a second person.** Given a Draft PMO invoice raised by Finance user A,
  When A approves it, Then the server refuses (approver must differ from author);
  When a different Finance or Admin user B approves it from the Approvals queue,
  Then it becomes Unpaid with an `INV-` number, an invoice date, B as approver, and a balance equal to its gross.
  (An Admin cannot approve an invoice they raised; a user demoted or offboarded since is refused.)
- **AC-NAR-003 — record payment.** Given an Unpaid PMO invoice with a gross of 1,110,000,
  When Finance records a receipt of 500,000, Then the invoice shows Partly paid with 610,000 outstanding;
  When Finance records the remaining 610,000, Then the invoice shows Paid; a receipt above the balance is refused.
- **AC-NAR-004 — connecting an ERP later.** Given an org with PMO invoices and receipts that connects an ERP,
  When revenue is employed, Then the PMO invoices and receipts from before connect stay listed and readable, every PMO
  invoice/receipt write is refused, none is sent to the ERP, and employing revenue is refused while a PMO draft is open
  (OD-XING-1: nothing pre-connect is pushed unless the client chooses otherwise).
- **AC-NAR-005 — cancel an invoice (added).** Given a PMO Draft, When Finance cancels it, Then it is Cancelled and stops
  counting against its work order; Given an Unpaid PMO invoice with a live receipt, When Finance cancels it, Then the
  server refuses until the receipt is cancelled.
- **AC-NAR-006 — cancel a receipt (added).** Given a PMO receipt recorded in error, When Finance cancels it, Then the
  invoice's balance is restored and its status follows the balance (Unpaid unless nothing is owed).
- **AC-NAR-007 — revenue writes are Admin and Finance only (added, owner ruling).** Given members of one org in every
  role, When each writes a sales invoice or a customer receipt directly (insert, update, delete) or through a PMO
  revenue RPC, Then the Admin's and the Finance member's writes are accepted and the Executive's, Project Manager's and
  Engineer's are refused; the service-role ERP mirror writer still lands its rows.

## 7. Traceability (ADR-0010: one owning test per AC, lowest sufficient layer)

| AC | Owning test (layer) | Supporting |
|---|---|---|
| AC-NAR-001 | `supabase/tests/0264_native_revenue_create.test.sql` (pgTAP) | `pages/__tests__/SalesInvoices.native.test.tsx`, `src/lib/repositories/revenue.native.test.ts`, `src/lib/db/revenueNative.test.ts` |
| AC-NAR-002 | `supabase/tests/0264_native_revenue_approve.test.sql` (pgTAP) | `pages/approvals/SalesInvoiceApprovalSection.test.tsx`, e2e AC-NAR-003 |
| AC-NAR-003 | `pmo-portal/e2e/AC-NAR-003-no-erp-billing.spec.ts` (Playwright) | `supabase/tests/0264_native_revenue_receipts.test.sql`, `src/lib/revenue/nativeInvoice.test.ts` |
| AC-NAR-004 | `supabase/tests/0264_native_revenue_crossing.test.sql` (pgTAP) | `src/lib/repositories/revenue.native.test.ts` (never dispatched), `SalesInvoices.native.test.tsx` |
| AC-NAR-005 | `supabase/tests/0264_native_revenue_approve.test.sql` (pgTAP) | `0264_native_revenue_receipts.test.sql` (receipt blocks cancel) |
| AC-NAR-006 | `supabase/tests/0264_native_revenue_receipts.test.sql` (pgTAP) | `pages/__tests__/IncomingPayments.native.test.tsx` |
| AC-NAR-007 | `supabase/tests/0264_revenue_write_roles.test.sql` (pgTAP) | role refusals in the create/approve/receipts files |
| NFR-NAR-001 | `supabase/tests/0264_native_revenue_acl.test.sql` + `0178_anon_executable_definers.test.sql` | migration §9 assertions |

## 8. Premises corrected while specifying

1. "Tables already accept a standalone insert (0123)" — true in 0123, narrowed since: 0176/0178 reduced client INSERT
   to an author-less Draft/Scheduled body and revoked UPDATE/DELETE grants. A real path needs RPCs (DD-NAR-2, -13).
2. The vendor-side native path (`transition_procurement`, 0243) is the model for the transition RPC and its SoD
   placement, not for paid-ness: AP marks a whole case Paid in one step. Partial receipts follow the expense-advance
   "outstanding is computed from what was applied" rule (0247) and the ERP outstanding oracle.
3. ADR-0055 §5A says sales invoices stay PMO-owned (Posture B) when a live standalone client connects; the only built
   revenue path is the flip (an `external_domain_ownership` row makes the ERP the owner). OD-XING-1 records option (2)
   as "what the tree already does". This spec follows the built flip from connect and freezes earlier PMO rows as
   history (DD-NAR-11); the ADR-0055 addendum records it.
4. `revenue.external.test.ts`'s cold-map block asserts `revenue-not-enabled` — the OQ-SAR-6 deferral OD-REEL-1 reverses.
   Its goal (a cold map never dispatches) is kept in the new native test; the rejection assertions are retired.

## 9. Owner questions (each has a default; none blocks the build)

1. **Open PMO invoices at connect.** Default: they stay read-only history; the accountant loads the open balance into
   the ERP as one opening entry (OD-XING-1 option 3), not as individual invoices (those would be adopted back into PMO
   and counted twice). Alternative: keep recording receipts against them in PMO after connect.
2. **A printable invoice for the client.** Default: not in #784; next issue after it.
3. **Second person on receipts (recorder ≠ approver).** Default: no — the ERP path has none.
4. **Approval routing for large invoices.** Default: flat Admin/Finance.
5. **VAT rate when a VAT project has none recorded.** Default: refuse until Finance records the project's rate with its
   contract value. Alternative: an org-wide default rate.
6. **"Invoice this work order" without an ERP.** Default: follow-up right after #784 (UI gate + dialog copy only; the
   server already accepts the work order).
