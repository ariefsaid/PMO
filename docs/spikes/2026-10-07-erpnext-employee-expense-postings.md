# Spike: ERPNext postings for employee expense claims + cash advances (#775 phase B)

> **Resolves:** `docs/specs/expense-claims.spec.md` §10 spike questions 1–5, via the seven probes of
> `docs/plans/2026-10-06-expense-claims.part6-i18n-e2e.md` Task 46. Method = the timesheet spike
> (`docs/spikes/2026-07-20-erpnext-timesheet-fields.md`): real REST request → read the response → re-fetch and
> diff; ERPNext source read inside the container only to explain an observed result, never to predict one.
> Every request ran under `scripts/with-erpnext-lock.sh`. Auth header shown as `Authorization: token <redacted>`
> throughout. Bodies trimmed to the fields that matter.

## Answers (one line each)

1. **JE `party_type=Employee`, no HRMS:** accepted and submitted on a Payable-typed Liability account, on the stock
   Payable-typed **Asset** account `Employee Advances`, and even on an untyped asset account. With HRMS: **not
   testable locally** (HRMS not installed) — an owner/ops check on the client's v16 site (§7).
2. **Anchor:** `user_remark`. It survives validate + submit + re-fetch verbatim, `like` filtering works, and it is
   **immutable after submit** (`UpdateAfterSubmitError`) → `anchorMutable: false`. `cheque_no` also survives and is
   immutable, but needs `cheque_date` and is the bank "Reference Number" field, so don't use it.
3. **PE `paid_to`:** if PMO leaves it out, ERPNext guesses from the employee's **ledger history**. It picks the
   account of any one earlier GL row for that employee (or falls back to the company's `Creditors` if the employee
   has no history). The probe booked a payment to an **untyped asset account** this way. **PMO must always send
   `paid_to` (Pay) / `paid_from` (Receive)**, plus the cash/bank side, which is also required.
4. **`project` → GL:** yes. The JE expense row's `project` and `cost_center` land on its GL Entry verbatim
   (`project: PROJ-0001`), so `erp_gl_entry_mirror` → actuals attributes it. Payable/advance/cash rows carry
   `project: null`.
5. **Cancel:** the document-level sweep poll sees `docstatus: 2` on both JE and PE. **The GL mirror does not.** On
   cancel, ERPNext marks the original GL rows `is_cancelled: 1` (keeping `docstatus: 1`) and adds reversal rows that
   are also `is_cancelled: 1`. The mirror's incremental fetch filters `is_cancelled = 0`, so it never re-reads the
   flipped rows. The originals stay live in `erp_gl_entry_mirror`, and actuals overstate after any cancel. This
   affects every doctype, not just this feature (see §6).

---

## §0 Bench

`GET /api/method/frappe.utils.change_log.get_versions` (Probe 1):
```
<<< 200 {"message":{"frappe":{"version":"15.96.0"},"erpnext":{"version":"15.94.3"}}}
```
**No `hrms` key → HRMS is not installed.** Site `frontend` @ `http://localhost:8080`, company `PMO Smoke Co`
(IDR, Standard COA, abbr `PSC`), `default_payable_account: Creditors - PSC`, `default_cash_account: Cash - PSC`.
`Accounts Settings.unlink_payment_on_cancellation_of_invoice = 1` (read via bench). No Bank-typed leaf account
exists, so the probes pay from `Cash - PSC`.

Relevant stock accounts (Standard COA, `GET /api/resource/Account` leaf list):

| Account | root_type | account_type |
|---|---|---|
| `Creditors - PSC` | Liability | Payable |
| `Payroll Payable - PSC` | Liability | *(blank)* |
| `Employee Advances - PSC` | **Asset** | **Payable** |
| `Travel Expenses - PSC` | Expense | *(blank)* |
| `Cash - PSC` | Asset | Cash |

The Standard COA has no ready-made "employee payable" account, so the spike created one (below).

### Created on the bench for this spike (disposable; left in place)

| Record | Notes |
|---|---|
| Employee `HR-EMP-00002` "Spike Expense Claimant" | the claimant fixture (pre-existing `HR-EMP-00001` left untouched) |
| Employee `HR-EMP-00003` "Spike Fresh Claimant" | no GL history, for the `paid_to` fallback probe |
| Account `Spike Employee Payable - PSC` | Liability, `account_type: Payable`, parent `Accounts Payable - PSC` |
| Account `Spike Employee Advance Untyped - PSC` | Asset, `account_type: ""`, parent `Loans and Advances (Assets) - PSC` |
| JE `ACC-JV-2026-00002` | approval JE (payable); **cancelled** |
| JE `ACC-JV-2026-00003` | expense vs `Employee Advances` (cheque_no anchor); submitted |
| JE `ACC-JV-2026-00004` | expense vs untyped advance; submitted |
| JE `ACC-JV-2026-00005` | expense vs `Creditors` party Employee; **draft** |
| JE `ACC-JV-2026-00006` | advance-applied JE (payable ↔ advance); **cancelled** |
| PE `ACC-PAY-2026-00232` | Pay, no `paid_to`; **cancelled** |
| PE `ACC-PAY-2026-00233` | Pay vs approval JE; **cancelled** |
| PE `ACC-PAY-2026-00234` | Pay to untyped account; draft |
| PE `ACC-PAY-2026-00235` | advance paid (Pay → `Employee Advances`); submitted |
| PE `ACC-PAY-2026-00236` | advance return (Receive ← `Employee Advances`); submitted |
| PE `ACC-PAY-2026-00237` | Receive, no `paid_from`; draft |
| PE `ACC-PAY-2026-00238` | Pay, fresh employee, no `paid_to`; draft |

Credentials: the existing Administrator pair was read into shell variables inside each locked invocation (minted
only if absent — it was present, so **nothing was rotated** and any other lane's exported pair stays valid).

---

## §1 Probes 2 + 3 — Journal Entry with `party_type: Employee`

**Probe 2: Dr expense (project + cost center) / Cr employee payable (party Employee)**
```
>>> POST /api/resource/Journal Entry
    Authorization: token <redacted>
    body: {"company":"PMO Smoke Co","voucher_type":"Journal Entry","posting_date":"2026-10-07",
           "user_remark":"c21384535199a1fec9d4ec5f0f6bdca2",
           "accounts":[{"account":"Travel Expenses - PSC","debit_in_account_currency":150000,
                        "project":"PROJ-0001","cost_center":"Main - PSC"},
                       {"account":"Spike Employee Payable - PSC","credit_in_account_currency":150000,
                        "party_type":"Employee","party":"HR-EMP-00002"}]}
<<< 200 name ACC-JV-2026-00002, docstatus 0, title "Travel Expenses - PSC",
        remark "Note: c21384535199a1fec9d4ec5f0f6bdca2",
        accounts[1] account_type "Payable", party_type "Employee", cost_center "Main - PSC" (defaulted)
>>> PUT /api/resource/Journal Entry/ACC-JV-2026-00002   {"docstatus":1}
<<< 200 docstatus 1
```

**Probe 3: same, Cr the stock employee-advance account (Asset root, Payable type)**
```
>>> POST /api/resource/Journal Entry
    body: {... "cheque_no":"c1191188e5e6d7c861b0868a65c71878","cheque_date":"2026-10-07",
           "accounts":[{"account":"Travel Expenses - PSC","debit_in_account_currency":50000,"project":"PROJ-0001","cost_center":"Main - PSC"},
                       {"account":"Employee Advances - PSC","credit_in_account_currency":50000,
                        "party_type":"Employee","party":"HR-EMP-00002"}]}
<<< 200 ACC-JV-2026-00003, remark "Reference #c1191188e5e6d7c861b0868a65c71878 dated 07-10-2026"
>>> PUT .../ACC-JV-2026-00003 {"docstatus":1}   <<< 200 docstatus 1
```

**Probe 3b: party Employee on an UNTYPED asset account**
```
>>> POST /api/resource/Journal Entry
    body: {... accounts:[{Travel Expenses Dr 10000, project PROJ-0001},
                         {"account":"Spike Employee Advance Untyped - PSC","credit_in_account_currency":10000,
                          "party_type":"Employee","party":"HR-EMP-00002"}]}
<<< 200 ACC-JV-2026-00004 → PUT {"docstatus":1} <<< 200 docstatus 1
```
Accepted. Why (source): `journal_entry.validate_party` only checks Receivable/Payable-typed accounts, and its
"account type ≠ party type" refusal **explicitly exempts Employee** (`journal_entry.py:488-492`, comment: "making an
exception for employee since they can be both payable and receivable"). `gl_entry.validate_account_party_type`
refuses a party only when `account_type` is set **and** not in Receivable/Payable/Equity, so a blank type passes.
**But** an untyped account gets **no Payment Ledger Entry** (§4 PLE listing has no row for JE-00004 or PE-00232),
so ERPNext tracks no open items on it.

**Probe 3c: Payable account WITHOUT a party**
```
>>> POST /api/resource/Journal Entry  body: {... {"account":"Spike Employee Payable - PSC","credit_in_account_currency":10000}}
<<< 417 ValidationError: "Row 2: Party Type and Party is required for Receivable / Payable account Spike Employee Payable - PSC"
```

**Probe 3d: party Employee on the Supplier AP control account `Creditors - PSC`**
```
<<< 200 ACC-JV-2026-00005 (left draft)
```
ERPNext accepts this. The Admin map must therefore refuse `Creditors` itself (see §5).

**Advance applied at claim payment (the §10 "Claim → Paid" JE): Dr employee payable (referencing the approval JE)
/ Cr employee advance, both rows party Employee**
```
>>> POST /api/resource/Journal Entry
    body: {... "accounts":[{"account":"Spike Employee Payable - PSC","debit_in_account_currency":50000,
                            "party_type":"Employee","party":"HR-EMP-00002",
                            "reference_type":"Journal Entry","reference_name":"ACC-JV-2026-00002"},
                           {"account":"Employee Advances - PSC","credit_in_account_currency":50000,
                            "party_type":"Employee","party":"HR-EMP-00002"}]}
<<< 200 ACC-JV-2026-00006 → PUT {"docstatus":1} <<< 200 docstatus 1
```
PLE confirms it knocked 50,000 off the approval JE's outstanding (`against_voucher_no: ACC-JV-2026-00002, amount:
-50000`).

---

## §2 Probe 4 — anchor field (ADR-0058 §3) + mutability (C-1)

Keys: `user_remark = c21384535199a1fec9d4ec5f0f6bdca2` on JE-00002; `cheque_no = c1191188e5e6d7c861b0868a65c71878`
on JE-00003 (both stamped at create, then submitted).

```
>>> GET /api/resource/Journal Entry?filters=[["user_remark","like","%c21384535199a1fec9d4ec5f0f6bdca2%"]]
        &fields=["name","docstatus","user_remark","cheque_no","remark","modified"]
<<< 200 [{"name":"ACC-JV-2026-00002","docstatus":1,"user_remark":"c21384535199a1fec9d4ec5f0f6bdca2",
          "remark":"Note: c21384535199a1fec9d4ec5f0f6bdca2"}]
>>> GET ...?filters=[["cheque_no","like","%c1191188e5e6d7c861b0868a65c71878%"]]
<<< 200 [{"name":"ACC-JV-2026-00003","docstatus":1,"cheque_no":"c1191188e5e6d7c861b0868a65c71878",
          "remark":"Reference #c1191188e5e6d7c861b0868a65c71878 dated 07-10-2026"}]

>>> PUT /api/resource/Journal Entry/ACC-JV-2026-00002  {"user_remark":"tampered"}
<<< 417 UpdateAfterSubmitError: Not allowed to change User Remark after submission
>>> PUT /api/resource/Journal Entry/ACC-JV-2026-00003  {"cheque_no":"tampered"}
<<< 417 UpdateAfterSubmitError: Not allowed to change Reference Number after submission
>>> PUT /api/resource/Journal Entry/ACC-JV-2026-00002  {"title":"tampered-title"}     (control)
<<< 200 title "tampered-title"   ← title IS allow_on_submit; the anchor fields are not
re-fetch → user_remark / cheque_no unchanged, verbatim.
```
Also: `cheque_no` without `cheque_date` → `417 MandatoryError "Please enter Reference date"`; and
`voucher_type: Bank Entry` *requires* `cheque_no` + `cheque_date` (`validate_cheque_info`). JE meta:
`allow_on_submit = [title, pay_to_recd_from, letter_head, select_print_heading, auto_repeat]`; `user_remark` and
`cheque_no` are both `no_copy: 1`.

**Ruling input:** anchor the JE kind on **`user_remark`** with `anchorMutable: false` (immutable once submitted,
unlike PE's `reference_no`). Because it is `no_copy`, an amended JE does not inherit it, so the amend path must
re-stamp it (PMO builds the amend body itself, so it can). ERPNext copies the key into `remark` as
`Note: <key>`, which is harmless.

The PE side keeps `reference_no` as the existing registry does (`DOCTYPE_REGISTRY.payment`, `anchorMutable: true`).
Confirmed here on a Cash-paid Employee PE: `reference_no` survived submit and showed verbatim in the cancelled-doc
listing (§5).

---

## §3 Probe 5 — Payment Entry, `party_type: Employee`

```
>>> POST /api/resource/Payment Entry      (PE1: NO paid_to)
    body: {"company":"PMO Smoke Co","posting_date":"2026-10-07","party_type":"Employee","party":"HR-EMP-00002",
           "mode_of_payment":"Cash","payment_type":"Pay","paid_from":"Cash - PSC","paid_amount":10000,
           "received_amount":10000,"reference_no":"e220fc61b4001f5db433c2b7a93c84f1","reference_date":"2026-10-07"}
<<< 200 ACC-PAY-2026-00232  paid_to "Spike Employee Advance Untyped - PSC"  paid_to_account_type ""   ← !!
>>> PUT {"docstatus":1}  <<< 200 docstatus 1   (submitted into the untyped asset account, no error)

>>> POST (fresh employee HR-EMP-00003, no GL history, NO paid_to)
<<< 200 ACC-PAY-2026-00238  paid_to "Creditors - PSC"  paid_to_account_type "Payable"

>>> POST (PE1b: NO paid_from, NO paid_to)
<<< 417 ValidationError "Source Exchange Rate is mandatory"
```
How ERPNext resolves `paid_to` (source, `accounts/party.py::get_party_account`): the Employee master has **no
Party Account table**, so the lookup misses. If the employee has GL history, ERPNext uses
`get_party_gle_account`, which runs `select account from tabGL Entry where party_type=… and party=… limit 1`. That
returns **any one earlier account** the employee was booked against. Without history it falls back to the company
`default_<Party Type.account_type>_account`. Party Type `Employee` has `account_type: Payable`, so the fallback is
`Creditors`. Either way the result is wrong for PMO. `paid_from` is not derived server-side: `mode_of_payment:
Cash` alone did not fill it.

```
>>> POST (PE2: explicit paid_to + reference to the approval JE)
    body: {... "payment_type":"Pay","paid_from":"Cash - PSC","paid_to":"Spike Employee Payable - PSC",
           "paid_amount":100000,"received_amount":100000,
           "references":[{"reference_doctype":"Journal Entry","reference_name":"ACC-JV-2026-00002","allocated_amount":100000}]}
<<< 200 ACC-PAY-2026-00233  paid_to_account_type "Payable"  unallocated_amount 0
        references[0] total_amount 150000 outstanding_amount 150000 allocated_amount 100000
>>> PUT {"docstatus":1}  <<< 200  references[0].outstanding_amount 50000

>>> POST (PE3: paid_to = untyped account)    <<< 200 draft ACC-PAY-2026-00234 — PE does NOT validate the account type
>>> POST (PE4, advance paid: Pay → "Employee Advances - PSC", 200000)   <<< 200 → submit 200, paid_to_account_type "Payable"
>>> POST (PE5, advance return: Receive, paid_from "Employee Advances - PSC", paid_to "Cash - PSC", 20000)
<<< 200 → submit 200, paid_from_account_type "Payable"
>>> POST (PE5b: Receive with NO paid_from)   <<< 200 draft, paid_from "Spike Employee Advance Untyped - PSC" (same history guess)
```
With no HRMS, the only valid PE `references` doctype for an Employee is **`Journal Entry`**
(`payment_entry.get_valid_reference_doctypes`: `elif party_type in ["Shareholder","Employee"]: return ("Journal
Entry",)`). That is enough: the claim payment PE references the approval JE.

---

## §4 Probe 6 — GL Entry / Payment Ledger Entry (fields = `ledgerFetch.ts` `GL_FIELDS`)

```
>>> GET /api/resource/GL Entry?filters=[["voucher_no","in",[JE-00002, JE-00003, JE-00006, PE-00233, PE-00235, PE-00236]]]&fields=[...GL_FIELDS...]
<<< 200
 JE-00002 Travel Expenses        project PROJ-0001  cost_center Main - PSC  Dr 150000  party –
 JE-00002 Spike Employee Payable project null       cost_center Main - PSC  Cr 150000  party Employee/HR-EMP-00002
 JE-00003 Travel Expenses        project PROJ-0001  Dr 50000
 JE-00003 Employee Advances      project null       Cr 50000   party Employee
 JE-00006 Spike Employee Payable Dr 50000  party Employee  against_voucher Journal Entry/ACC-JV-2026-00002
 JE-00006 Employee Advances      Cr 50000  party Employee
 PE-00233 Spike Employee Payable Dr 100000 party Employee  against_voucher Journal Entry/ACC-JV-2026-00002  cost_center null
 PE-00233 Cash                   Cr 100000
 PE-00235 Employee Advances      Dr 200000 party Employee   /  Cash Cr 200000
 PE-00236 Cash Dr 20000          /  Employee Advances Cr 20000 party Employee
 (all: fiscal_year "2026", is_cancelled 0, docstatus 1)
```
**`project` on the JE row reaches the GL Entry verbatim.** `cost_center` too, and ERPNext defaults it onto the
party rows. PE GL rows carry `cost_center: null, project: null` (no header project was sent). They hit no expense
account, so actuals don't need them.

PLE (`GET /api/resource/Payment Ledger Entry?filters=[["party","=","HR-EMP-00002"]]`): rows exist for every Payable-typed
account posting (payable and `Employee Advances`). **None exist for the untyped account** (JE-00004, PE-00232), so
an untyped advance account has no open-item / aging trail.

---

## §5 Probe 7 — cancellation through the sweep's list call

```
>>> PUT /api/resource/Journal Entry/ACC-JV-2026-00002 {"docstatus":2}     ← cancelled FIRST, while PE-00233 + JE-00006 still reference it
<<< 200 docstatus 2
>>> GET /api/resource/Payment Entry/ACC-PAY-2026-00233
<<< 200 docstatus 1, references [], unallocated_amount 100000      ← payment silently UNLINKED, still submitted
>>> PUT .../Payment Entry/ACC-PAY-2026-00232 {"docstatus":2}   <<< 200 docstatus 2
>>> PUT .../Payment Entry/ACC-PAY-2026-00233 {"docstatus":2}   <<< 200 docstatus 2
>>> PUT .../Journal Entry/ACC-JV-2026-00006 {"docstatus":2}    <<< 200 docstatus 2
```
The silent unlink comes from `Accounts Settings.unlink_payment_on_cancellation_of_invoice = 1`
(`accounts_controller.py:1959`). With it set to 0, ERPNext blocks the cancel instead. **This is a per-site setting:
check it on the client.**

Sweep-shaped poll (`sweepFieldsForKind`: name, modified, docstatus, amended_from + anchor + company):
```
>>> GET /api/resource/Journal Entry?filters=[["modified",">=","2026-10-07 14:00:00"]]
        &fields=["name","modified","docstatus","amended_from","user_remark","company"]
<<< 200 ... {"name":"ACC-JV-2026-00002","modified":"2026-10-07 14:07:45.474781","docstatus":2,"amended_from":null,
            "user_remark":"c21384535199a1fec9d4ec5f0f6bdca2","company":"PMO Smoke Co"},
           {"name":"ACC-JV-2026-00006","docstatus":2,...}
>>> GET /api/resource/Payment Entry?filters=[["modified",">=","2026-10-07 14:00:00"]]
        &fields=["name","modified","docstatus","amended_from","payment_type","reference_no","company","party_type","party"]
<<< 200 ... {"name":"ACC-PAY-2026-00232","docstatus":2,"payment_type":"Pay","reference_no":"e220fc61b4001f5db433c2b7a93c84f1",
            "party_type":"Employee","party":"HR-EMP-00002"}, {"name":"ACC-PAY-2026-00233","docstatus":2,...}
```
The document level is **enough for the mirror's tombstone path**: cancel bumps `modified`, the list call returns
cancelled docs with `docstatus: 2`, and the anchor stays readable. `party_type` is needed to split Employee PEs
from Supplier/Customer PEs, alongside `payment_type`.

GL level after cancel:
```
>>> GET /api/resource/GL Entry?filters=[["voucher_no","in",["ACC-JV-2026-00002","ACC-PAY-2026-00233"]]]&fields=[...,"is_cancelled","docstatus","modified"]
<<< 200  originals  bdfa1e700d / de59f42aa4 / 6c56a930df / cb2733ac07 → is_cancelled 1, docstatus 1, modified bumped to cancel time
         reversals  367331a6f9 / 7219bc06cc / 596f344515 / 13cdeefdc5 → is_cancelled 1, docstatus 1
```
`ledgerFetch.fetchGlEntries` filters `is_cancelled = 0 AND docstatus != 2` and fetches `modified >= cursor`. A
cancel's GL rows therefore **never come back**: the originals were already mirrored with `is_cancelled: false`, and
both the flipped originals and the reversals are filtered out. I found no other writer that clears them (searched
`ledgerFetch.ts`, `ledgerMirrorFeed.ts`, `accountingFanout.ts`, `actualsSnapshot.ts`, `erpnext-sweep/index.ts`,
migrations). **Inferred from code + this bench's GL rows. Not proven by running the feed.** PLE behaves the same way:
cancelled rows are `delinked: 1` with `docstatus: 1`, and the PLE fetch filters only `docstatus != 2`.

---

## §6 What changes in the §10 design

**Pre-existing gap the phase-B plan must close or confirm (not specific to expenses):** after any GL-posting
cancel, the incremental feed leaves the GL mirror (and PLE mirror) holding the cancelled rows as live. Today that
already applies to PI/PE cancels. Phase B adds a routine cancel path (claim rejected-after-approval, payment
reversal), so actuals would overstate. Fix shape: fetch with `modified >= since` and **without** the `is_cancelled`
filter, then upsert `is_cancelled` (actuals already reads `is_cancelled=false`). Verify with a feed run before
relying on it.

Required body rules (all from probes, none new architecture):
- **Always send** `paid_from` + `paid_to` on every Employee PE. Payable side comes from the map; the cash/bank side
  reuses the binding's `default_cash_account ?? default_bank_account`, as `bodies/paymentEntry.ts` already does. A
  Bank-typed `paid_from` also needs `reference_no` + `reference_date`. PMO stamps `reference_no` as the anchor
  anyway, so it must send `reference_date` too.
- **Claim → Paid PE** must carry `references: [{reference_doctype: "Journal Entry", reference_name: <approval JE>,
  allocated_amount}]`. The advance-applied JE's payable row must carry `reference_type/reference_name` = the
  approval JE. Without these, balances still net, but the approval JE stays an open payable item.
- **Cancel order:** cancel the dependent PE / advance JE before the approval JE. Otherwise the client's
  `unlink_payment_on_cancellation_of_invoice` setting decides between a silently unlinked PE and a refused cancel.
- Put `project` (+ `cost_center`) **only on expense rows**. Party rows need neither.

Neither the table of PMO events → documents nor the "two org-level accounts + per-type expense map" shape changes.

## §7 Admin account map — minimum contents

| Key | Required properties (probe-backed) |
|---|---|
| `employee_payable_account` (org) | leaf, company currency, `root_type: Liability`, **`account_type: Payable`** (needed for PLE / open-item tracking and JE party validation). **Not** the company's `default_payable_account` (`Creditors`), which ERPNext accepts but which mixes employees into supplier AP. |
| `employee_advance_account` (org) | leaf, `root_type: Asset`, **`account_type: Payable`**. The Standard COA ships one (`Employee Advances - <abbr>`). An untyped account is accepted by JE and PE but gets no PLE rows, so refuse blank type. |
| expense account per expense type | leaf, `root_type: Expense`, any `account_type`. |
| cost center | the existing project/budget cost center (JE defaults the company `cost_center` onto rows if omitted). |
| cash/bank (payout) | **not new.** Reuse the binding's resolved `default_cash_account ?? default_bank_account`. |

`party_type = Employee` needs no particular account type on JE: Employee is exempt from the type-match check.
The probe-backed requirement for open-item tracking is `Payable`. `Receivable` was not probed. Party = the
confirmed ERP Employee link (0148).

## §8 With HRMS — owner/ops facts for the client's v16 site

HRMS is not installed on the local bed, so nothing here was observed. Verify on the client's v16 site (read-only
GETs plus one disposable JE/PE pair, cancelled afterwards):
1. `get_versions` — is `hrms` present, and which version?
2. Re-run Probes 2 + 3 + the advance-applied JE. Does HRMS (or v16 core) refuse `party_type: Employee` on the
   payable/advance accounts, and is the Employee exemption in `JournalEntry.validate_party` still there?
3. Re-run Probe 5 with an explicit `paid_to` + a `Journal Entry` reference. HRMS overrides Payment Entry, so confirm
   `Journal Entry` is still a valid Employee reference doctype.
4. Company fields HRMS adds (`default_expense_claim_payable_account`, `default_employee_advance_account`,
   `default_payroll_payable_account` — core v15 Company has none). If present, consider pre-filling the map from
   them, and check whether they change PE's `paid_to` fallback.
5. **Double-booking risk:** do the client's accountants also use native HRMS Expense Claim / Employee Advance? If
   yes, PMO JEs and native claims would book the same spend twice. That is a policy ruling, not code.
6. `Accounts Settings.unlink_payment_on_cancellation_of_invoice` value (decides §6 cancel-order behaviour).
7. Journal Entry meta on v16: `user_remark` still not `allow_on_submit` (anchor immutability).
8. The client's COA has a Payable-typed employee payable and a Payable-typed employee advance account, and the
   claimants exist as Employee records.

## §9 Not probed

Budget-control refusal of a JE expense row (Budget with action Stop on the project/cost center), multi-currency
claims, a Bank-typed `paid_from`, and a `Receivable`-typed advance account.
