# ERPNext Sales Invoice + Payment Entry (Receive) mandatory-field spike (R9-P3a)

**Date:** 2026-07-14 · **Bench:** local Docker `frappe_docker` `pwd.yml`, compose project `pmo-erpnext`,
image `frappe/erpnext:v15.94.3` (frappe **15.96.0** / erpnext **15.94.3** — the 15.86/15.83 minors from the
contract notes are no longer published on Docker Hub; nearest v15 pins used, version-handshake verified via
`GET /api/method/frappe.utils.change_log.get_versions`). Site `frontend` at `http://localhost:8080`,
setup wizard completed programmatically (`frappe.desk.page.setup_wizard.setup_wizard.setup_complete`) with
company **PMO Smoke Co** (abbr PSC), country Indonesia, currency **IDR**, Standard COA. Auth =
`Authorization: token api_key:api_secret` (Administrator keys minted via
`bench execute frappe.core.doctype.user.user.generate_keys`; creds live only in
`~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md`, never in this repo). All probes = stock `/api/resource` v1
REST, no custom apps, no desk. Method: start from `{}` per doctype and add exactly the field each
`417`/`404`/`500` error demands, capture verbatim.

**Resolves risk R9-P3a** of `docs/specs/erpnext-adapter-p3a-sales-ar.spec.md` §3 **OQ-SAR-1** (SI + PE-receive
body field maps — the R9-style live-bench spike prerequisite). Same stock bed as the R10/R9 notes above
(`frappe/erpnext:v15.94.3`, frappe 15.96.0 / erpnext 15.94.3, site `frontend` @ `http://localhost:8080`,
`PMO Smoke Co`, IDR, Standard COA, token auth). Method = R9 §0-§5 verbatim. **No repo files were touched** —
this section is the spike's frozen output.

**Company-defaults cache (one `GET Company/PMO Smoke Co` — the binding account source):**
`default_receivable_account=Debtors - PSC`, `default_income_account=Sales - PSC`, `default_cash_account=Cash - PSC`,
`default_expense_account=Cost of Goods Sold - PSC`, `cost_center=Main - PSC`. (`default_bank_account` is NULL on
this bench — `paid_to` resolves to `default_cash_account`.)

---

## 0. Master-data prerequisites (AR side)

| Master | Minimal create body | Errors on the way | Notable defaults |
|---|---|---|---|
| **Customer** | `{"customer_name":"Spike Customer"}` | `{}` → 417 `MandatoryError: Value missing for Customer: Customer Name` | `name`="Spike Customer" (naming by name, like Supplier); **`customer_group`/`territory` are NOT mandatory** (stayed null); `customer_type`=Company |
| **Project** | `{"project_name":"SPIKE-PROJ-1"}` | none | **auto-named `PROJ-0001`** (naming series `PROJ-#####`, **client `name` ignored**) → resolve ERP name via `project_name` search (the external-ref idiom); `status`=Open; Projects are **NOT submittable** (no docstatus lifecycle → cannot be "cancelled", only closed via `status`) |
| Item SPIKE-ITEM-1 | (pre-existing bench fixture) | — | `is_stock_item=1`, `stock_uom`=Nos, `standard_rate=0` (a stocked item; sells fine from a SI, see §1) |

---

## 1. Sales Invoice (the AR twin of PI)

### Minimal body that succeeds (draft → submit)

```json
POST /api/resource/Sales Invoice
{"customer":"Spike Customer",
 "items":[{"item_code":"SPIKE-ITEM-1","qty":1,"rate":150000}]}
→ 200 ACC-SINV-2026-00001;  PUT {"docstatus":1} → 200 (status flips Draft→Unpaid)
```

That is the **complete** mandatory set: `customer` + `items[].{item_code,qty,rate}`. **`income_account`,
`debit_to`, `company`, `posting_date`, `currency`, `cost_center` are all server-derived** (none in the body).
Side effect: first priced SI auto-creates an **Item Price in "Standard Selling"** (`_server_messages`:
`Item Price added for SPIKE-ITEM-1 in Price List Standard Selling`) — the sell-side mirror of PI's "Standard
Buying" Item Price (R9 §0).

### Error ladder (the mandatory-field map)

| Body | Result |
|---|---|
| `{}` | **500** `TypeError: unsupported operand type(s) for -: 'NoneType' and 'float'` @ `accounts_controller.py:2507 set_payment_schedule` (`base_grand_total - flt(self.base_write_off_amount)`) — the **same unguarded empty-items crash as PI** (R9 §1); NOT a clean 417. Note: unlike PI (whose `{}` 404'd on supplier lookup), SI's payment-schedule validate runs *before* the customer lookup, so `{}` is a 500 here, not a 404. Empty/missing `items` must be guarded client-side. |
| `{customer}` (no items) | **500** same `TypeError` (same line) — confirms empty-`items` is the crash root, independent of customer presence |
| `{customer, items:[{item_code,qty,rate}]}` | **200** — no further fields demanded |

### Server-side defaulting observed (the OQ-SAR-1 income/debit-to answer — BOTH auto-derive)

| Field | Defaulted value | Source |
|---|---|---|
| `debit_to` (the receivable / AR control) | **`Debtors - PSC`** | Company `default_receivable_account` — **NOT in the body** |
| `items[].income_account` | **`Sales - PSC`** | Company `default_income_account` (stamped per item row) — **NOT in the body** |
| `items[].expense_account` | `Cost of Goods Sold - PSC` | Company `default_expense_account` (COGS for the stocked item) |
| `items[].cost_center` | `Main - PSC` | Company `cost_center` |
| `items[].warehouse` | `Stores - PSC` | Item `item_defaults.default_warehouse` |
| `company` | `PMO Smoke Co` | inferred (single-company bench) |
| `posting_date` / `due_date` | today / today | `due_date` defaults to `posting_date` when the Customer has no payment terms |
| `currency` / `conversion_rate` / `selling_price_list` | IDR / 1.0 / `Standard Selling` | Company + default price list |
| `total`/`net_total`/`grand_total`/`rounded_total`/`outstanding_amount` | all computed (150000) | server-side — **no manual totals stamping** (R9 §1 finding carries) |
| header `cost_center` / `project` | None / None | only item-level dimensions set by default |

### GL entries posted on SI submit (the double entry — AP mirror)

| account | debit | credit | cost_center | against_voucher |
|---|---|---|---|---|
| `Debtors - PSC` | 150000 | 0 | null | `ACC-SINV-2026-00001` (self) |
| `Sales - PSC` | 0 | 150000 | `Main - PSC` | — |

### Anchor (OQ-SAR-4)

`remarks` **survives validate+submit+re-fetch verbatim** (set `SAR-SPIKE-ANCHOR-001` on
the draft → still `SAR-SPIKE-ANCHOR-001` after submit). Confirms the spec default: **SI anchors `remarks`,
`anchorMutable=false`** — SI behaves like PI, NOT like PE. (No validate-clobber observed.)

---

## 2. Payment Entry — `payment_type:"Receive"` (the AR twin of PE-pay)

### Minimal body that succeeds (draft → submit), paying SI-1

```json
POST /api/resource/Payment Entry
{"payment_type":"Receive",
 "party_type":"Customer",
 "party":"Spike Customer",
 "paid_amount":150000,
 "received_amount":150000,
 "paid_from":"Debtors - PSC",
 "paid_to":"Cash - PSC",
 "references":[{"reference_doctype":"Sales Invoice",
                 "reference_name":"ACC-SINV-2026-00001",
                 "allocated_amount":150000}]}
→ 200 ACC-PAY-2026-00060;  PUT {"docstatus":1} → 200;  SI re-fetch → status "Paid", outstanding_amount 0
```

### Error ladder (matches PE-pay shape, one delta)

| Body | Result |
|---|---|
| `{payment_type:"Receive"}` | 417 `ValidationError: Party Type is mandatory` |
| `+party_type, party` | 417 `ValidationError: Paid Amount is mandatory` |
| `+paid_amount` | 417 `ValidationError: Received Amount is mandatory` (**NOT derived** from `paid_amount`, even same-currency — R9 §2 carries) |
| `+received_amount` (no accounts) | 417 `ValidationError: **Target** Exchange Rate is mandatory` ← **delta vs PE-pay**, which said *Source*. (For `Receive`, the *target* = the cash/bank side; ERP validates target rate before source. Once accounts are given both rates auto-derive to 1.0, so the body never needs them.) |
| `+paid_from, paid_to` | **200** — accounts present ⇒ `source/target_exchange_rate` auto-derive to 1.0 and `paid_from/to_account_currency` auto-fill IDR from the accounts |

### API vs UI defaulting (R9 §2 answer carries, AR mirror)

The **REST API defaults NONE of the account fields**. The adapter MUST supply `paid_from` + `paid_to` itself,
resolved from Company defaults: **`paid_from` = `default_receivable_account` (Debtors)** and **`paid_to` =
`default_cash_account` (Cash)** — the exact mirror of PE-pay (`paid_from`=Cash, `paid_to`=Creditors).
`mode_of_payment` is NOT mandatory (stayed null); `posting_date` defaults to today; `company` inferred.

### References child row shape (after save)

`{reference_doctype:"Sales Invoice", reference_name:<SI>, allocated_amount:150000, total_amount:150000,
outstanding_amount:150000, exchange_rate:1.0, account:"Debtors - PSC", payment_term:null}` —
`total_amount`/`outstanding_amount`/`account` are **server-populated** (the adapter sends only
`reference_doctype`/`reference_name`/`allocated_amount`). A no-`references` PE saves+submits fine as an
on-account payment (`unallocated_amount` = full `paid_amount`) — references are optional at both save and
submit.

### Anchor (OQ-SAR-3)

`remarks` is **clobbered** by validate (auto-set to a composite
`"Amount IDR 150000 received from Spike Customer\nTransaction reference no …\nAmount IDR 150000 against
Sales Invoice …"`) — same behavior as PE-pay. **`reference_no` survives validate+submit+re-fetch verbatim**
(set `SAR-PE-ANCHOR-001` → still there post-submit). Confirms the spec: **PE-receive anchors `reference_no`,
`anchorMutable=true`**, C-1 ruling applies verbatim.

### The AR flip (the OQ-SAR-1 paid-detection idiom)

After submitting the referenced PE-receive, the SI flips to **`status:"Paid"`, `outstanding_amount:0`**
server-side — the AR twin of PE-pay's PI flip (R9 §2). Read-back unchanged: `Payment Entry Reference` where
`{reference_doctype:"Sales Invoice", reference_name, docstatus:1}` **plus** SI `outstanding_amount == 0`.

---

## 3. The `project` dimension (OQ-SAR-1 sub-question — revenue-per-project)

**Verdict: `project` (NOT `cost_center`) is the ERP dimension that realizes revenue-per-project, and it
propagates end-to-end to the GL.**

- **SI accepts a `project` field** at **both header and item-row level**. Created SI-2 with
  `"project":"PROJ-0001"` (header) + `items[].project:"PROJ-0001"` → 200; re-fetch shows `project` landed on
  the header **and** the item row (`cost_center` stays `Main - PSC` — the two dimensions are independent).
- **`project` propagates to GL entries** on submit (both legs carry it):
  | account | debit | credit | cost_center | **project** |
  |---|---|---|---|---|
  | `Debtors - PSC` | 150000 | 0 | null | **`PROJ-0001`** |
  | `Sales - PSC` | 0 | 150000 | `Main - PSC` | **`PROJ-0001`** |
  → revenue is tagged to the project in the GL. The dispatch resolves `project` from command context +
  the binding's ERP-project→PMO map and stamps it on the SI (header suffices; per-item overrides per row).
- **Projects use a naming series** (`PROJ-#####`); the client-supplied `name`/`project_name` is **not** the ERP
  `name` — resolve the ERP `name` via `project_name` search (external-ref idiom). Projects are **not
  submittable** (no docstatus) — they cannot be "cancelled", only `status`-closed; leave as a bench fixture.
- **Binding implication:** the `sales_invoices.project_id` (PMO uuid) ↔ ERP `project` (ERP `name` string) map
  is a binding-config concern (same shape as the existing ERP-project→PMO map); `cost_center` is a separate
  independent dimension and is NOT the project link.

---

## 4. AR aging report (the P2 report path, AR read-back — confirms row shape == AP)

Ran `POST /api/method/frappe.desk.query_report.run` with the pinned R10 filter shape while SI-1 was open:

```json
{"report_name":"Accounts Receivable",
 "filters":{"company":"PMO Smoke Co","report_date":"2026-07-14","ageing_based_on":"Due Date",
            "range1":30,"range2":60,"range3":90,"range4":120},
 "ignore_prepared_report":true}
```

- **Row shape == AP** (same keys; `customer_name` where AP has `supplier_name`):
  `voucher_type, voucher_no, party, party_type, posting_date, due_date, outstanding, range1..range5, total_due,
  currency, account_currency, cost_center, customer_name, invoice_grand_total, invoiced, paid, credit_note,
  po_no, remarks, party_account, territory, customer_group, age, …`.
- SI-1 row: `voucher_type:"Sales Invoice", voucher_no:"ACC-SINV-2026-00001", party:"Spike Customer",
  outstanding:150000, range1:150000, range2..5:0, total_due:150000, currency:"IDR"`. (range1="0-30" because
  due_date=today.)
- **Last element is a TOTALS row** as a flat list (non-dict), not a data row — same as AP. Strip non-dict
  rows when materializing. Open AR data rows = (data-row count − 1 totals row).
- After cleanup (all docs cancelled): AR aging returns 0 data rows (clean).

---

## 5. Cancel / cleanup mechanics — **the AR delta vs R9 §5**

| Mechanic | Verdict (SI / PE-receive) |
|---|---|
| **Cancel a referenced SI while its PE-receive is still Submitted** | **200, NOT a hard block** — ERP auto-**un-links** the PE's references (`_server_messages`: `"Payment Entries ACC-PAY-2026-00060 are un-linked"`) and cancels the SI. **This differs from R9 §5** (PI/PR/PE-pay hard-fail with `LinkExistsError`). The PE-receive keeps its money/GL impact but loses the SI allocation (becomes on-account/unallocated); cancel the PE-receive separately afterward. So "PE-before-SI" is still the *clean* order, but the SI-cancel is *not* blocked if you go the other way. |
| Cancel PE-receive | `PUT {"docstatus":2}` → 200 (docstatus 2 / Cancelled). |
| Cancel already-cancelled doc | 417 `ValidationError` (harmless — guard the idempotent cancel). |
| Cancel standalone SI | `PUT {"docstatus":2}` → 200. |
| Mutate after submit | (not re-probed; R9 §5 `UpdateAfterSubmitError` carries — SI/PE are submittable doctypes). |

**Cleanup state:** all spike money docs **cancelled** (docstatus 2): `ACC-SINV-2026-00001`,
`ACC-PAY-2026-00060`, `ACC-SINV-2026-00002`. SI-1 post-cancel `outstanding_amount=0`. AR aging clean (0 rows).
Masters retained as bench fixtures (`Spike Customer`, `SPIKE-PROJ-1`/`PROJ-0001`, `SPIKE-ITEM-1`) — not
submittable money docs, and deletion would be link-blocked by the cancelled docs anyway.

---

## 6. Adapter-facing conclusions (freeze for P3a bodies)

1. **SI command body** (pinned): `{customer, items:[{item_code, qty, rate}]}`. Server derives `debit_to`
   (Debtors) + `items[].income_account` (Sales) from Company defaults — **do not send them**. Add `project`
   (ERP `name`) at the header (and/or per item) for revenue-per-project. Two-step create→submit; re-fetch for
   the true `status`/`outstanding_amount` (R9 §5 stale-status trap carries).
2. **PE-receive command body** (pinned): `{payment_type:"Receive", party_type:"Customer", party, paid_amount,
   received_amount, paid_from, paid_to, references:[{reference_doctype:"Sales Invoice", reference_name,
   allocated_amount}] (+ reference_no anchor)}`. Adapter supplies `paid_from`=Debtors (`default_receivable_account`)
   + `paid_to`=Cash (`default_cash_account`) — the API will not default them. `received_amount` is mandatory
   even same-currency.
3. **Company-defaults resolution** = one `GET Company/<name>`: needs `default_receivable_account`,
   `default_income_account`, `default_cash_account` (cache per org binding; `default_bank_account` may be NULL
   → fall back to cash). This is the OQ-SAR-1 binding-config addition.
4. **Anchors:** SI → `remarks` (immutable, survives submit); PE-receive → `reference_no` (mutable, survives
   submit; `remarks` clobbered). Both live-bench-confirmed (not assumed).
5. **Project dimension:** `project` (header) propagates to GL — it is the revenue-per-project link;
   `cost_center` is a separate independent dimension (stays `Main - PSC`).
6. **Error taxonomy:** 417 + `exc_type` (`MandatoryError`/`ValidationError`) with human text in
   `_server_messages`; 404 `DoesNotExistError` for bad links (Customer/Item); raw **500 `TypeError` for
   empty/missing `items`** (the same unguarded crash as PI — `accounts_controller.py:2507`; pre-validate
   client-side, do not retry blindly). Parse `exc_type` first.
7. **Cancel ordering:** go PE-receive→SI for cleanliness, but SI-cancel is *not* hard-blocked by an active
   PE-receive (ERP auto-unlinks) — a韧性 difference from the procurement chain; the cancel path must tolerate
   already-unlinked references.
8. **AR aging read-back:** identical filter shape + row shape to AP (`customer_name` vs `supplier_name`);
   strip the trailing flat-list totals row. Reuse the P2 report path verbatim.

---

## 7. Frozen finding index (cited inline by tasks 1.3/1.4)

| Finding # | Summary | Plan citation |
|---|---|---|
| **R9-P3a-1** | SI body = `{customer, items:[{item_code,qty,rate}]}`. **Do NOT send `income_account` or `debit_to`** — server derives both from Company defaults. | Task 1.3 (salesInvoice.ts `siToBody`) |
| **R9-P3a-2** | SI `remarks` anchor survives submit verbatim → `anchorMutable:false` (PI twin, reissue-capable). | Task 1.3 (registry anchorField/anchorMutable) |
| **R9-P3a-3** | PE-receive body: adapter MUST supply `paid_from`=`default_receivable_account` + `paid_to`=`default_cash_account`; `received_amount` mandatory even same-currency. | Task 1.4 (incomingPayment.ts `peReceiveToBody`) |
| **R9-P3a-4** | PE-receive `reference_no` anchor survives submit verbatim; `remarks` clobbered → `anchorMutable:true` (C-1 verbatim: composite probe + held-on-inconclusive, NEVER auto-reissue). | Task 1.4 (registry anchorField/anchorMutable) |
| **R9-P3a-5** | `project` header field on SI propagates to **both GL legs** on submit → revenue-per-project realized. Dispatch resolves ERP project name from binding map and stamps header `project`. | Task 1.3 (siToBody `ctx.refs.project`), Task 2.3 (resolveRevenueRefs) |
| **R9-P3a-6** | AR aging row shape = AP row shape (`customer_name` vs `supplier_name`); filter shape identical; totals row is flat-list non-dict → strip. | Task 6.1 (sweep AR scope), Task 6.2 (revenueDisplay) |
| **R9-P3a-7** | Empty/missing `items` on SI → **500 TypeError** (same unguarded crash as PI). Client MUST pre-validate non-empty items; `classifyDispatchError` needs a 500-TypeError bucket that is NOT retried blindly. | Task 1.3 (`requireItems` guard), Task 2.1 (classify error) |
| **R9-P3a-8** | SI cancel is **NOT hard-blocked** by an active PE-receive (ERP auto-unlinks, 200) — differs from procurement's `LinkExistsError` hard block. Cancel reconcile must tolerate already-unlinked PE-receive (re-derive `sales_invoice_id`→null, tombstone SI, leave PE-receive money/status untouched). | Task 5.6/5.7 (transitionPolicy auto-unlink reconcile) |