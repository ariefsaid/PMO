# Spec: Supplier supply-risk status from payables age (#2583)

> **Review 20 Nov (checked against `origin/dev` and `origin/land/1215-r1`).** Changed: the unpaid balance now states
> the **shipped payables figure** — per case, `supplierUnpaid` **with the case's linked accounting-system documents**
> (`erp_purchase_documents_linked`, 0360), which `/finance/payables` folds in through `withLinkedSupplierInvoices`
> (`src/lib/finance/payablesPosition.ts`); the earlier text counted PMO invoice rows only and would have disagreed
> with the screen it cites. Voided bills are **counted** by that shipped rule (nothing reads `voided_at`), so
> excluding them is a change to the *shared* rule, not a local one — new OD-VSR-6, and AC-VSR-002 is now a Unit test
> of `supplierUnpaid` plus its pgTAP twin. ERP aging is matched by `party = companies.erp_supplier_name`: no shipped
> writer populates `erp_ap_aging_snapshot.company_id` (`refreshAging` sends party/party_type/currency/buckets only,
> 0101/0150), so the `company_id` match was dead. Direct-write enforcement is the **guard trigger alone** — `companies`
> carries a table-level UPDATE grant to `authenticated` **and `anon`** (0075), and a column-level revoke cannot subtract
> from a table-level grant (0273's finding); FR-VSR-003/AC-VSR-007 said "column grants". The invoice **count** is
> PMO-only (the ERP snapshot has no count) — FR-VSR-006/010 no longer promise it on the ERP basis. `supplyRisk.view`
> is a screen affordance, not RLS: `companies_select` is org-wide (0002), so a same-org user can read the flag without
> it; AC-VSR-014 asserts the organisation boundary only. `docs/glossary.md`'s "payables age" line now says the age is
> per case (the shipped figure is case-level), not per invoice.
> **Open owner decisions:** OD-VSR-6 (exclude voided bills from the one shared unpaid figure — which also changes
> `/finance/payables` — or accept them and drop AC-VSR-002); and whether the flag should stay a `companies` column
> (readable by every member) or move to a 1:1 table whose SELECT is limited to the Master-data roles.

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-VSR-###`, `NFR-VSR-###`, `AC-VSR-###`. Plan: `docs/plans/2026-11-20-vendor-supply-risk.md`. Executor: Orca worker for the pure suggestion function, repository and screens; the status write (governed, audited, role-gated) and the shared unpaid-rule change (OD-VSR-6) are money/SoD slices, each Director-dispatched, each shipping alone with its pgTAP proof. Not a posting path: it moves no money. Map #2516; builds on the work-order cost spine (#2517, ADR-0104: `purchase_orders.work_order_id`). Extends the supplier (`companies`, `type = 'Vendor'`) record; does not change invoices, payments or any approval. Its only touch on a money figure is the voided-bill exclusion in the one shared unpaid rule (OD-VSR-6), which is why that ships alone.

## Job story

When a supplier we depend on is not being paid on time, I want to mark it as at risk (or inactive) and see a suggestion from how old its unpaid invoices are, so that the work orders with open orders from that supplier are warned before the supplier stops delivering.

## Context and boundary

- A supplier is a `companies` row of type `Vendor` (0001). A purchase is a `procurements` case whose `vendor_id` names the supplier; its documents are `purchase_orders` (status `Draft`, `Issued`, `Acknowledged`, `Closed`), `procurement_invoices` (status `Received`, `Scheduled`, `Paid`; `invoice_date`, `amount`, `currency`, `erp_outstanding_amount`, `voided_at`) and `payments` (0035, 0006, 0040, 0100, 0885).
- **Two payables sources, never blended.** Where the organisation's procurement domain is externally owned (`domain_externally_owned(org, 'procurement')`, 0087), the ERP is the accounting truth (ADR-0048): the suggestion reads the mirrored `erp_ap_aging_snapshot` buckets for the supplier verbatim and never re-ages PMO invoice rows. Otherwise it applies the shipped payables rule (below), exactly as `/finance/payables` does today (`docs/specs/payables-switch.spec.md`). A PMO bill carries no due date, so PMO-basis age is from `invoice_date` (OD-VSR-2); the ERP basis uses the ERP's own buckets.
- The **status is a human decision**. The age signal only suggests (OD-VSR-1). Nothing changes the status, blocks an order, a purchase transition or a payment.
- A **warning** is informational: a flag on the work order and a notification to its project manager. It never blocks issuing, receiving or billing.
- Out of scope: supplier scoring, blacklisting, automatic holds on new purchases, performance ratings, ERP write-back of the status (OQ-VSR-3).

## Definitions

- **Supply-risk status** of a supplier: `active` (default), `at_risk`, `inactive`. `inactive` means "do not rely on for new work"; it does not archive the company (ADR-0018 `archived_at` stays separate).
- **Unpaid balance (PMO basis) is the shipped money rule, not a new one.** The unit is the procurement case (`procurements` row with `vendor_id` = the supplier), not the single invoice. Source of truth: `supplierUnpaid` (`src/lib/procurement/procurementMoney.ts`) **on the case together with its linked accounting-system documents** (`erp_purchase_documents_linked`, 0360), exactly as `/finance/payables` reads it through `withLinkedSupplierInvoices` (`src/lib/finance/payablesPosition.ts`):
  - A case counts only while its status is `Vendor Invoiced` (`isProcurementReadyToPay`); `Paid` and `Cancelled` cases do not.
  - Where the case has **no PMO bill** but linked ERP `Purchase Invoice` documents, unpaid = the sum of their `outstanding_amount` (the shipped ERP-invoice path). Otherwise invoiced = sum of the case's `procurement_invoices.amount`; if any amount is null the balance is unknown, never zero (FR-VSR-008).
  - Paid = sum of the case's `payments.amount` where `payments.status = 'Paid'` (check `'Scheduled'` or `'Paid'`, 0035) **plus** the case's linked ERP `Payment Entry` totals. `Scheduled` payments do not reduce the balance.
  - **Partial payments net at case level:** unpaid = max(invoiced - paid, 0). `payments.invoice_id` is a nullable pointer (0035, 0100) and the shipped rule does not read it: a Paid payment reduces the case balance whether or not it names an invoice. A case with unpaid above zero is unpaid; zero or less is not counted. The payment allocation migrations (0731 receipts to sales invoices) are customer-side and do not apply to supplier payables.
  - **Voided bills (`procurement_invoices.voided_at`, 0885) are counted by the shipped rule** — neither the list select (`PROCUREMENT_LIST_DETAILS`) nor `supplierUnpaid` reads `voided_at`. Excluding them (AC-VSR-002) therefore changes the one shared unpaid figure for `/finance/payables` and the procurement list too; that is OD-VSR-6, not a local filter in this read.
- **Payables age** of a case: whole calendar days from the case's earliest `invoice_date` to the organisation's today (org zone, never browser time), as `supplierInvoiceDate` + `calendarAgeDays`. The case's whole unpaid balance sits in that one age (the shipped rule does not split a case by invoice). Buckets reuse the shared boundaries 0-30, 31-60, 61-90, over 90 (`ageingBucket`).
- **Suggestion**: `at_risk` when the supplier has unpaid balance in the over-60-day range (61-90 plus over 90; OD-VSR-2); otherwise `active`. `inactive` is never suggested. Computed per currency (`procurements.currency`), reported per currency, never summed across currencies. **Computed server-side** by one security-invoker SQL function (the screen and the status function's "suggested" read both call it); the TypeScript function only mirrors it for tests and previews, and a pgTAP case and a unit case share the same hand example so the two cannot drift.
- **Open order**: a `purchase_orders` row with status `Issued` or `Acknowledged` on a case of that supplier. The real constraint is `purchase_orders.status in ('Draft','Issued','Acknowledged','Closed')` (0035); `Draft` (not yet sent) and `Closed` (done) do not count. A work order is **exposed** when its status is `Draft` or `Issued` (`work_order_status` enum: `Draft`, `Issued`, `Closed`, `Cancelled`, 0193) and at least one open order names it through `purchase_orders.work_order_id` (0951). `purchase_orders` has no vendor column: the supplier is reached through `purchase_orders.procurement_id` -> `procurements.vendor_id`. `procurements` itself has no `work_order_id` (0951 added it to purchase_requests, purchase_orders, procurement_receipts, procurement_invoices, timesheet_entries, stock_documents, equipment_usage_entries only), so the order's own work order is the only link and a case whose orders name none is "project-level" (FR-VSR-015).
- **Role set:** the `user_role` enum is `Executive`, `Project Manager`, `Finance`, `Engineer`, `Admin` (0001). There is no purchasing role, so OD-VSR-3's setters are Admin and Finance.

## Requirements (EARS)

**Status**
- FR-VSR-001 The system shall hold a supply-risk status on each Vendor company, default `active`, with the last change's actor, time and optional reason.
- FR-VSR-002 When an authorized user sets the status, the system shall store it only through a security-definer function that refuses any role outside the OD-VSR-3 set (default Admin, Finance) with 42501, requires a reason for `at_risk` and `inactive`, writes an audit event carrying from, to, reason and actor, and lets the change appear in the company's record history (`companies` is already registered in `record_history_config`, 0260; the reason itself lives on the audit event, the history diff records the status and its stamp).
- FR-VSR-003 The system shall refuse a direct write to the status columns by any client role through a guard trigger on `companies` (the 0273 `companies_tax_defaults_guard` pattern, exempting the service role and a no-JWT session). A column-level revoke is **not** the enforcement: `companies` carries a table-level UPDATE grant to `authenticated` and `anon` (0075), and a column revoke cannot subtract from it.
- FR-VSR-004 The system shall refuse setting a status on a company that is not a Vendor, is in another organisation, or is archived.
- FR-VSR-005 Moving to `inactive` or `at_risk` shall require a reason (1-500 characters); moving back to `active` may omit it.

**Suggestion (read-only)**
- FR-VSR-006 The system shall provide a supplier's payables-age suggestion: suggested status, oldest unpaid invoice age in days, the unpaid amount in the over-60-day range per currency, the count of **PMO invoices** behind it (the ERP snapshot carries buckets, not invoice counts, so the count is absent on the ERP basis), and the basis (`pmo` or `erp`).
- FR-VSR-007 While the organisation's procurement domain is externally owned, the suggestion shall read the mirrored `erp_ap_aging_snapshot` for that supplier and shall not re-age `procurement_invoices`. The snapshot row is matched to the supplier by `party = btrim(companies.erp_supplier_name)` (0097; both text — the shipped aging writer sends the ERP party name and never `company_id`). `erp_ap_aging_snapshot.company_id` is a nullable display scope with no foreign key (0101) and no shipped writer populates it, so it is only an additional match when a future writer supplies one. A supplier matching neither way shows "no aging data" and gets no suggestion, never `active` by default. It uses the latest snapshot generation of the organisation, `b_61_90` + `b_90_plus` per `currency`, buckets verbatim (ADR-0048).
- FR-VSR-018 The age suggestion shall be computed in the database (a security-invoker function) using the shipped payables rule defined above, never in the browser for display.
- FR-VSR-008 An invoice with no amount has an unknown balance: it is counted and shown as unknown, never as zero, and does not by itself raise the suggestion.
- FR-VSR-009 The suggestion shall never change the status. The screen shall show it beside the current status with a one-click "Set to suggested" that goes through FR-VSR-002.
- FR-VSR-010 When the stored status differs from the suggestion, the screen shall say so plainly, in words the basis supports ("Suggested: at risk, 2 invoices over 60 days, 1,200,000 IDR" on the PMO basis; "Suggested: at risk, 1,200,000 IDR over 60 days" on the ERP basis, which has no invoice count), and shall not hide the human's choice.

**Warning**
- FR-VSR-011 The system shall show, on a supplier's record, the work orders that are exposed to it (open orders per work order, with reference and order totals).
- FR-VSR-012 While a work order is exposed to a supplier whose status is `at_risk` or `inactive`, the work order's page and its row on the project's Work Orders tab shall show a warning naming the supplier and status.
- FR-VSR-013 When a supplier's status changes to `at_risk` or `inactive`, the system shall notify, once per change, the project manager of each project that has an exposed work order, through the existing notification mechanism (`notifications`, `notify_workflow_user`, 0237), never the acting user, with the **supplier** as the notification's entity (always one id) and the project's exposed work orders named in its body.
- FR-VSR-014 When an order is issued to a supplier already `at_risk` or `inactive`, the order's work order is shown the warning (read-time, FR-VSR-012); no notification is repeated for an unchanged status.
- FR-VSR-015 Projects with orders that name no work order are listed on the supplier's record as "project-level orders" and are not warned individually (OQ-VSR-2).

**Access**
- FR-VSR-016 Actions `supplyRisk.view`, `supplyRisk.set` shall be registered in the role matrix (`src/auth/policy.ts`) and gated by `can()`; the function and a guard trigger enforce the write, RLS enforces the organisation boundary. Setting is allowed to Admin and Finance by default (OD-VSR-3). **Viewing the panel** is offered to the Master-data roles; the flag itself is readable by every active member because it lives on `companies`, whose SELECT policy is org-wide (0002) and whose table-level SELECT grant no column revoke can narrow — treat the view action as a screen affordance, not a confidentiality boundary.
- FR-VSR-017 Status, suggestion and warnings are org-scoped; a user in another organisation reads nothing.

## Non-functional requirements
- NFR-VSR-001 The suggestion for one supplier reads its unpaid invoices and linked accounting-system documents with one indexed query per source; the exposed-work-order read is one query by supplier, bounded pagination. The supplier list shows status only, no per-row suggestion computation (the suggestion is on the supplier record).
- NFR-VSR-002 English and Bahasa Indonesia strings; `DESIGN.md` tokens; the warning reads in words, not colour alone.
- NFR-VSR-003 Money exact decimals; dates are org calendar dates, never browser time; per-currency totals are never blended.

## Acceptance criteria and owning layer

Hand calculation for the PMO basis (organisation today 2026-11-20, single currency IDR, three cases of one supplier at status `Vendor Invoiced`, the shipped case-level rule):
- Case 1: one invoice dated 2026-08-01 (111 days) 1,000,000, no payment: unpaid **1,000,000**, age 111.
- Case 2: one invoice dated 2026-09-25 (56 days) 2,000,000, no payment: unpaid 2,000,000, age 56 (31-60 bucket).
- Case 3 (partly paid): one invoice dated 2026-09-11 (70 days) 1,000,000 and one `Paid` payment of 400,000: unpaid 1,000,000 - 400,000 = **600,000**, age 70.
- Case 4: invoice 2026-09-10 (71 days) 500,000 and `Paid` payments totalling 500,000: unpaid 0, not counted.
Over-60-day range holds cases 1 and 3: **1,600,000**, count **2**, oldest age **111**; suggestion **at_risk**. For case 3 alone the result is 600,000, age 70, **at_risk**. If a 400,000 payment is only `Scheduled`, case 3 stays 1,000,000. After case 1 is paid and case 3 stays, the over-60 amount is 600,000 and still at_risk; with case 3 also fully paid the range is empty and the suggestion is **active** (case 2 stays in 31-60).

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-VSR-001 | Given the hand-worked cases 1-4, when the suggestion is read by the database function, then at_risk, oldest age 111, over-60 amount 1,600,000, count 2, basis pmo; the unit function returns the same figures. | pgTAP (authoritative) + Unit (mirror) |
| AC-VSR-002 | Given a case whose status is `Paid` and another case whose only bill is voided and older than 90 days, when the shared unpaid figure is read, then the Paid case is out, the voided bill adds nothing (OD-VSR-6), so that case is unpaid 0 and absent from `/finance/payables` and from the suggestion. | Unit (`supplierUnpaid`) + pgTAP |
| AC-VSR-003 | Given an old invoice with no amount, when the suggestion is read, then it is counted as unknown and the suggestion stays active. | Unit |
| AC-VSR-004 | Given an org whose procurement domain is externally owned and a snapshot row with 400,000 in the 61-90 bucket whose `party` equals the supplier's `erp_supplier_name`, when read, then basis erp, at_risk, 400,000, no invoice count, and no `procurement_invoices` row is consulted; a row whose non-null `company_id` equals the company matches the same way when a writer supplies one. | pgTAP |
| AC-VSR-016 | Given an externally owned org and a supplier whose `party` (and `company_id`, if present) matches no snapshot row, when read, then "no aging data", no suggested status (not `active`), and no `procurement_invoices` row is consulted. | pgTAP |
| AC-VSR-017 | Given case 3 alone (invoice 1,000,000 dated 70 days ago, `Paid` payment 400,000), when read, then unpaid 600,000, age 70, at_risk; with the payment only `Scheduled`, unpaid 1,000,000; with the payment 1,000,000, nothing counts and the suggestion is active. | pgTAP |
| AC-VSR-018 | Given a `Vendor Invoiced` case with no PMO bill and one linked ERP `Purchase Invoice` outstanding 500, when the suggestion is read, then it carries 500 as unpaid (the shipped ERP-invoice path); given a PMO bill of 1,000 and a linked ERP `Payment Entry` of 400, then it carries 600. Both figures equal `/finance/payables` for the same case. | pgTAP + Unit |
| AC-VSR-005 | Given invoices in two currencies, when read, then each currency is reported separately and none is summed. | Unit |
| AC-VSR-006 | Given a Finance user, when they set `at_risk` with a reason, then the status stores, an audit event carries actor, from, to and reason, and the company's record history shows the status change with who and when. | pgTAP |
| AC-VSR-007 | Given any client role, when it updates the status columns directly, then refused by the guard trigger; given an Executive, Engineer or Project Manager, when they call the function, then refused with 42501; Admin and Finance accepted (OD-VSR-3). | pgTAP |
| AC-VSR-008 | Given a Client or Internal company, an archived vendor or another organisation's vendor, when set, then refused. | pgTAP |
| AC-VSR-009 | Given `at_risk` without a reason, when set, then refused; `active` without a reason is accepted. | pgTAP |
| AC-VSR-010 | Given an age signal that suggests at_risk, when time passes and nothing is set, then the stored status stays active (no job, trigger or read changes it). | pgTAP |
| AC-VSR-011 | Given an Issued PO on a Draft/Issued work order and an Acknowledged PO on another, a Closed PO and a Draft PO on others, and an Issued PO on a Closed or Cancelled work order, when exposure is read, then only the first two work orders are exposed. The supplier is reached through `procurements.vendor_id`. | pgTAP |
| AC-VSR-012 | Given a supplier set at_risk with exposed work orders on two projects, when set, then each project manager gets one notification naming the supplier and that project's exposed work orders; the actor gets none; setting at_risk again to the same status adds none. | pgTAP |
| AC-VSR-013 | Given an exposed work order and an at_risk supplier, when the work order page and the project's Work Orders tab render, then the warning names supplier and status; given `active`, then no warning. | Unit (component) |
| AC-VSR-014 | Given a user in another organisation, when they read status, suggestion or exposure, then nothing is returned; given a same-org user without `supplyRisk.view`, the panel is not offered but the flag stays readable on the company row (FR-VSR-016). | pgTAP |
| AC-VSR-015 | Given a Finance user on the supplier record, when they see "Suggested: at risk" and press "Set to suggested" and give a reason, then the status shows at risk with who and when, and the exposed work orders list is visible. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Not Admin/Finance (default; roles are the `user_role` enum, no purchasing role) | 42501 "Only Admin or Finance can set a supplier's supply-risk status"; the action is not offered |
| Not a Vendor / archived / other org | Refused with reason; field error on the screen |
| Reason missing for at_risk or inactive | Field error "Say why" |
| No aging data (ERP basis, no snapshot row matched by `party` / `erp_supplier_name`) | Suggestion shows "No aging data", status unchanged |
| Unknown invoice amounts | Shown "n invoices with no amount"; never counted as zero |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-VSR-1 | The age signal only suggests; a person sets the status. No automatic change. | Auto-setting at_risk on a late-paying month warns every work order and trains users to ignore the flag; never suggesting leaves a growing debt unseen. |
| OD-VSR-2 | Suggest at_risk when any unpaid balance sits in the over-60-day range, aged from invoice date (no local due date exists; ERP basis uses the ERP's own buckets). | Too tight floods; too loose warns after the supplier has stopped delivering; ageing from invoice date overstates age for suppliers on long payment terms. |
| OD-VSR-3 | Who sets: Admin and Finance. The role enum has no purchasing role (Executive, Project Manager, Finance, Engineer, Admin); a Project Manager sees but does not set. | Finance excluded blocks the stated actor; PM included lets a requester soften a flag on their own supplier. |
| OD-VSR-4 | `inactive` is a flag with a reason, not a block: purchasing a new order from an inactive supplier still works and shows the warning. | A block stops urgent site buys; no block means a person must read the warning. |
| OD-VSR-5 | Warn project managers on a change, and every viewer of an exposed work order at read time. | Notification-only misses people who open the page later; read-time-only misses people who do not open it. |
| OD-VSR-6 | Exclude voided bills (`procurement_invoices.voided_at`) from the **one shared unpaid figure** — `supplierUnpaid` — so `/finance/payables`, the procurement list and the suggestion agree; this is a money-path change shipped with the suggestion, not a local filter. | If only the suggestion excludes them, the same supplier shows two unpaid balances one screen apart and Finance cannot tell which is owed; if they are not excluded at all, a cancelled bill keeps a supplier at risk. |
| OQ-VSR-1 | Count `Draft` work orders as exposed? Default yes (Draft and Issued). | Missed early warning on work not yet issued. |
| OQ-VSR-2 | Orders that name no work order: warn the project, or list only on the supplier. Default list only. | Project-level purchases never reach a work-order warning. |
| OQ-VSR-3 | Should the status be sent to the ERP supplier record where connected? Default no (PMO-only flag). | Two systems disagree on whether a supplier is at risk. |
| OQ-VSR-4 | Does a supplier moving back to `active` notify? Default no. | Managers keep a stale mental flag. |

## Delivery checklist
- [ ] Owner signs OD-VSR-1..6, answers OQ-VSR-1..4.
- [ ] The shared unpaid rule (OD-VSR-6) and the status write are money/SoD slices: each is Director-dispatched and ships alone; the suggestion and screens follow.
- [ ] Suggestion and status slice ships before the warning slice.
- [ ] Glossary: supply-risk status, payables age, exposed work order.
