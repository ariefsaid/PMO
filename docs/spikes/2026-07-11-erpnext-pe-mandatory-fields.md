# ERPNext v15 stock-REST mandatory-field spike (R9) — PI / Payment Entry / PO / GR

**Date:** 2026-07-11 · **Bench:** local Docker `frappe_docker` `pwd.yml`, compose project `pmo-erpnext`,
image `frappe/erpnext:v15.94.3` (frappe **15.96.0** / erpnext **15.94.3** — the 15.86/15.83 minors from the
contract notes are no longer published on Docker Hub; nearest v15 pins used, version-handshake verified via
`GET /api/method/frappe.utils.change_log.get_versions`). Site `frontend` at `http://localhost:8080`,
setup wizard completed programmatically (`frappe.desk.page.setup_wizard.setup_wizard.setup_complete`) with
company **PMO Smoke Co** (abbr PSC), country Indonesia, currency **IDR**, Standard COA. Auth =
`Authorization: token api_key:api_secret` (Administrator keys minted via
`bench execute frappe.core.doctype.user.user.generate_keys`; creds live only in
`~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md`, never in this repo). All probes = stock `/api/resource` v1
REST, no custom apps, no desk. Method: start from `{}` per doctype and add exactly the field each
validation error demands.

**Resolves risk R9** of `docs/spikes/2026-07-11-p2-intake-research.md` (Payment Entry create flow unproven)
and empirically answers parts of OQ-7/OQ-8.

---

## 0. Master-data prerequisites (what a clean company demands before any purchase doc)

Setup-wizard completion is the real prerequisite: it creates the full account tree (`Creditors - PSC`,
`Cash - PSC`, `Stock Received But Not Billed - PSC`, `Cost of Goods Sold - PSC`), cost center `Main - PSC`,
warehouse `Stores - PSC`, fiscal year, and stamps them as Company defaults
(`default_payable_account`, `default_cash_account`, `default_expense_account`, `cost_center`). Without a
completed wizard none of the doc-level defaulting below happens.

| Master | Minimal create body | Errors on the way | Notable defaults stamped |
|---|---|---|---|
| **Supplier** | `{"supplier_name": "Spike Supplier"}` | `{}` → 417 `MandatoryError: supplier_name` | `name` = supplier_name (naming by name, not series, despite the error text showing `SUP-2026-00001`) |
| **Item** | `{"item_code": "SPIKE-ITEM-1", "item_group": "Services"}` | `{}` → 417 `ValidationError: Item Code is required`; `{item_code}` → 417 `MandatoryError: item_group` | `item_name`=item_code, `stock_uom`=**Nos**, `is_stock_item`=**1**, `is_purchase_item`=1, and an `item_defaults` child row auto-stamped `{company: PMO Smoke Co, default_warehouse: Stores - PSC}` |
| Service Item | same + `"is_stock_item": 0` | none | same minus stock behavior; PI expense account then defaults to Company `default_expense_account` (`Cost of Goods Sold - PSC`) instead of Stock-Received-But-Not-Billed |

Stock item groups shipped by the wizard: `All Item Groups, Products, Raw Material, Services, Sub Assemblies, Consumable`.

**Side effect to know:** the first PI/PO naming a rate auto-creates an **Item Price** in "Standard Buying"
(`MSG: Item Price added for SPIKE-ITEM-1 in Price List Standard Buying`) — harmless but means writes have
master-data side effects.

## 1. Purchase Invoice

### Minimal body that succeeds (draft)
```json
POST /api/resource/Purchase Invoice
{"supplier": "Spike Supplier",
 "items": [{"item_code": "SPIKE-ITEM-1", "qty": 1, "rate": 150000}]}
```
→ 200, `ACC-PINV-2026-00002`, grand_total 150000. (Strictly, `rate` is optional — qty-only succeeded with
grand_total 0 — but a zero-value PI is useless; treat `rate` as practically mandatory.)

### Error ladder (the mandatory-field map)
| Body | Result |
|---|---|
| `{}` | **404** `DoesNotExistError: Supplier None not found` (supplier lookup precedes mandatory validation) |
| `{supplier}` (no items) | **500** `TypeError: unsupported operand type(s) for -: 'NoneType' and 'float'` — an UNHANDLED crash, not a clean 417. Empty/missing `items` must be guarded client-side; never rely on a clean error |
| `{supplier, items:[{item_code}]}` | 417 `InvalidQtyError: Row #1: Quantity … cannot be zero` |
| `{supplier, items:[{item_name, qty, rate}]}` (free-text row, no item_code) | 417 `ValidationError: Expense account is mandatory for item …` |
| free-text row + `expense_account` | **200** — item_code-less ad-hoc rows work if you supply `expense_account` explicitly |

### Server-side defaulting observed (nothing else needed in the body)
`credit_to`=Creditors - PSC, `posting_date`/`due_date`=today, `currency`=IDR, `conversion_rate`=1.0,
`company`=PMO Smoke Co; per item: `uom`/`stock_uom`=Nos, `conversion_factor`=1, `cost_center`=Main - PSC,
`warehouse`=Stores - PSC, `amount` computed. For a **stock** item with no Purchase Receipt, expense head is
force-swapped to `Stock Received But Not Billed - PSC` (with an informational `_server_messages` note); for
a **non-stock/service** item it defaults to Company `default_expense_account`. Totals
(`total`, `grand_total`, `outstanding_amount`) are computed server-side — the RIS "stamp totals manually"
workaround was NOT needed on stock v15 REST for PI/PO/PR/PE.

## 2. Payment Entry (the R9 core — no RIS precedent)

### Minimal body that succeeds (draft, paying the PI)
```json
POST /api/resource/Payment Entry
{"payment_type": "Pay",
 "party_type": "Supplier",
 "party": "Spike Supplier",
 "paid_amount": 150000,
 "received_amount": 150000,
 "paid_from": "Cash - PSC",
 "paid_to": "Creditors - PSC",
 "references": [{"reference_doctype": "Purchase Invoice",
                 "reference_name": "ACC-PINV-2026-00002",
                 "allocated_amount": 150000}]}
```
→ 200 draft; `PUT {"docstatus":1}` → 200; PI re-fetched shows **`status: "Paid"`, `outstanding_amount: 0`**.

### Error ladder
| Body | Result |
|---|---|
| `{}` or `{payment_type}` | 417 `ValidationError: Party Type is mandatory` |
| + `party_type, party` | 417 `ValidationError: Paid Amount is mandatory` |
| + `paid_amount` | 417 `ValidationError: Received Amount is mandatory` (NOT derived from paid_amount even same-currency) |
| + `received_amount` | 417 `ValidationError: Source Exchange Rate is mandatory` |
| + `source/target_exchange_rate: 1` but still no accounts | 417 `MandatoryError: paid_from, paid_from_account_currency` |
| + `paid_from, paid_to` (drop explicit rates) | **200** — with accounts present, `source/target_exchange_rate` auto-derive to 1.0 and `paid_from_account_currency`/`paid_to_account_currency` auto-fill from the accounts |

### API vs UI defaulting — the R9 answer
The desk UI pre-fills `paid_from` (from Mode of Payment / Company `default_cash_account`) and party
balances; **the REST API defaults NONE of the account fields**. The adapter must supply
`paid_from` + `paid_to` itself, resolved from Company defaults
(`default_cash_account`/`default_bank_account` for paid_from; `default_payable_account` for paid_to on a
"Pay" to a Supplier). Exchange rates and account currencies can be omitted once accounts are given.
`mode_of_payment` is NOT mandatory (stayed null). `posting_date` defaults to today. Company inferred.

### References semantics
- **References are optional at both save and submit**: an unreferenced PE submits fine as an on-account
  payment (`unallocated_amount` = full paid_amount). Paying a specific PI requires the `references` child
  row (`reference_doctype`, `reference_name`, `allocated_amount`).
- Paid detection idiom confirmed: after submitting the referenced PE, the PI flips to `Paid` /
  `outstanding_amount 0` server-side — the P2 read-back (`Payment Entry Reference` where
  `{reference_doctype, reference_name, docstatus:1}`) plus `outstanding_amount == 0` holds.

## 3. Purchase Order

### Minimal body that succeeds
```json
POST /api/resource/Purchase Order
{"supplier": "Spike Supplier",
 "items": [{"item_code": "SPIKE-ITEM-1", "qty": 2, "rate": 100000,
            "schedule_date": "2026-07-18"}]}
```
→ 200 `PUR-ORD-2026-00001`; submit → `status: "To Receive and Bill"`.

### Error ladder
| Body | Result |
|---|---|
| supplier + items without `schedule_date` | 417 `ValidationError: Please enter Reqd by Date` |

`schedule_date` on the item row is the ONLY delta vs the PI item shape (header-level `schedule_date` also
works — it cascades). Same server defaulting as PI (warehouse `Stores - PSC` stamped per item, totals
computed). This validates the RIS `schedule_date = today+7` rule as genuinely mandatory, while RIS's
manual totals-stamping was unnecessary here.

## 4. Purchase Receipt (Goods Receipt)

### Minimal body that succeeds (PO-linked)
```json
POST /api/resource/Purchase Receipt
{"supplier": "Spike Supplier",
 "items": [{"item_code": "SPIKE-ITEM-1", "qty": 2, "rate": 100000,
            "purchase_order": "PUR-ORD-2026-00001",
            "purchase_order_item": "i7d62dicpp"}]}
```
→ 200 `MAT-PRE-2026-00001`; submit → 200, and the PO flips to `status: "To Bill"`, `per_received: 100`.

- A **standalone** PR (same body minus the two link fields) also drafts+submits fine — linkage is what
  drives PO fulfilment tracking, so the adapter must carry `purchase_order` + `purchase_order_item`
  (the PO item child-row `name`, fetched from the PO doc) per row. No errors were hit on the PR ladder —
  warehouse defaulted from the item's `item_defaults`.
- No stock-availability constraint on receipt (inbound), and `rate` is copyable but not validated against
  the PO at this quantity.

## 5. docstatus mechanics over stock REST (cross-doctype)

| Mechanic | Verdict |
|---|---|
| **Submit** | `PUT /api/resource/<DT>/<name>` body `{"docstatus": 1}` → 200. No RPC needed; `frappe.client.submit` not required. |
| **Create+submit in one POST** | Works: include `"docstatus": 1` in the POST. GL entries verified posted. **Trap:** the POST *response body* carries a stale `status: "Draft"` (docstatus is 1); re-fetch for the true status (`Unpaid`). Prefer the two-step insert-then-submit for the adapter anyway — separates the idempotency windows (R1/R3). |
| **Cancel** | `PUT {"docstatus": 2}` → 200. |
| **Mutate after submit** | 417 `UpdateAfterSubmitError` (probed: setting `bill_no` on a submitted PI) — confirms R2; update = cancel+amend. |
| **Cancel ordering** | Cancelling a PO with a submitted PR against it → 417 `LinkExistsError` naming the blocking doc. Cancel the chain in reverse (PR first, then PO) → both 200. Same for PE-before-PI. |
| **Delete draft** | `DELETE /api/resource/<DT>/<name>` → 202 "ok". |
| **Delete cancelled money doc** | 417 `LinkExistsError` — blocked by the auto-created **Payment Ledger Entry** (and GL Entry) children even after cancel. Plain REST cannot delete a once-submitted money doc. **Empirical answer to OQ-8: "cancel-only, never delete" is not just policy, it's what stock REST enforces.** |
| GL proof | `GET /api/resource/GL Entry?filters=[["voucher_no","=",...]]` readable via token auth; PI posted Creditors(credit)/Stock-Received-But-Not-Billed(debit) pairs as expected. |

## 6. Adapter-facing conclusions (feed into the P2 spec)

1. **PE command schema** (the R9 unknown, now pinned): requires exactly
   `payment_type, party_type, party, paid_amount, received_amount, paid_from, paid_to` (+ `references[]`
   to pay a specific PI). The adapter resolves `paid_from`/`paid_to` from Company defaults at org-binding
   time — the API will not.
2. **Company-defaults resolution is one GET:** `Company/<name>` exposes
   `default_payable_account, default_cash_account, default_expense_account, cost_center` — cache per org
   binding.
3. **Missing/empty `items` on PI crashes 500** (not 417) — the client must pre-validate; also means
   `classifyDispatchError` needs a 500-with-`TypeError` bucket that is NOT retried blindly.
4. **Server defaulting is strong** when the wizard completed: currency/rates/accounts/warehouse/cost-center
   /totals all stamp themselves. The RIS manual-totals workaround is dead weight for these four doctypes.
5. **PO needs `schedule_date`**; GR needs `purchase_order` + `purchase_order_item` per row for fulfilment
   linkage (child-row name comes from reading the PO — the multi-domain external-ref resolver must store or
   fetch it).
6. **Two-step create→submit** is the right adapter idiom (stale-status trap + idempotency-window separation),
   with re-fetch after submit for derived `status`.
7. **Error taxonomy observed:** 417 + `exc_type` (`MandatoryError`, `ValidationError`, `InvalidQtyError`,
   `UpdateAfterSubmitError`, `LinkExistsError`) with human text in `_server_messages` (JSON-in-JSON);
   404 `DoesNotExistError` for bad links; raw 500 for unguarded server bugs. Parse `exc_type` first,
   `_server_messages` for display.
8. **Write side effects exist** (auto Item Price on first priced purchase) — sweeps must tolerate
   docs/masters the adapter never created.

## 7. Bench facts

- Stack: 9 containers (backend, frontend/nginx, websocket, scheduler, queue-long, queue-short, mariadb 11.8,
  redis-cache, redis-queue), compose project `pmo-erpnext`, port **8080** — zero overlap with the
  `supabase_*` stacks (untouched). MariaDB 11.8 draws a "not yet tested >10.8" warning from Frappe v15 but
  installed and ran clean.
- RAM footprint after the full spike: **~724 MiB total** (db 245, backend 226, queues ~133, scheduler 64,
  websocket 29, redis ~20, nginx 8) inside the 11.67 GiB Docker VM.
- Cleanup state: all spike money docs **cancelled** (docstatus 2 — REST delete of once-submitted money docs
  is link-blocked, see §5); draft PIs deleted; masters (`Spike Supplier`, `SPIKE-ITEM-1`, `SPIKE-SVC-1`)
  retained as bench fixtures (deletion would be link-blocked by the cancelled docs).
- Start/stop from `~/Coding/frappe-docker-pmo`: `docker compose -p pmo-erpnext -f pwd.yml up -d` / `stop`.
  Creds + admin password in `PMO-BENCH-NOTES.md` there (local throwaways, never in this repo).
