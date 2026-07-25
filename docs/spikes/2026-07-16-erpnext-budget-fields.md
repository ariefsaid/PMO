# ERPNext `Budget` + `Budget Account` mandatory-field spike (R11-P3c) — the WRITE contract

**Date:** 2026-07-16/17 · **Bench:** local Docker `frappe_docker` `pwd.yml`, compose project `pmo-erpnext`,
image `frappe/erpnext:v15.94.3` (frappe **15.96.0** / erpnext **15.94.3**), site `frontend` at
`http://localhost:8080`, company **PMO Smoke Co** (abbr PSC, currency IDR, Standard COA). Auth =
`Authorization: token api_key:api_secret` (Administrator keys, `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md`,
never in this repo). All probes = stock `/api/resource` v1 REST + one stock `DocType` meta read, no custom
apps, no Desk. Method: read the meta first (fast, exact field list), then start from `{}` per doctype and add
exactly the field each `417`/`404`/`500` error demands, capture verbatim, exercise the full lifecycle
(create→submit→attempt-update→cancel→amend), and one real overspend-control proof against a live Journal
Entry. **The bench, which had been down ~36h (see the previous version of this file), was confirmed live
with a real authenticated call before any other work**: `GET Company/PMO Smoke Co` → 200; `GET
/api/method/frappe.utils.change_log.get_versions` → `{"frappe":"15.96.0","erpnext":"15.94.3"}`.

**⚑ DIRECTION FLIP — read this before using anything below.** `docs/specs/erpnext-adapter-p3c-budget.spec.md`
and `docs/plans/2026-07-16-erpnext-adapter-p3c-budget.md` were written for an **INBOUND MIRROR** (ERP owns
the budget, PMO only reads it, OQ-BUD-1 framed as a *fetch* problem). **The owner has since ruled the
opposite: option A — PMO authors the budget and pushes it INTO ERPNext** (ADR-0055 §6's write-back), so ERP
gets GL/audit-grade budget records + its native overspend controls, while PMO stays the authoring UI. Those
two P3c docs are being re-pointed separately; they are **not edited here** and their "mirror/sweep" framing
is superseded. **This spike freezes the CREATE/UPDATE/CANCEL/AMEND contract a write-through adapter needs —
not a fetch/feed contract.** Every finding below is stated in write-contract terms; where a P3c doc's
hypothesis is confirmed or contradicted, it's called out explicitly so whoever re-points those docs doesn't
have to re-derive it.

**Company-defaults cache (reused from the P2/R9/P3a spikes — same bench, same company):**
`default_receivable_account=Debtors - PSC`, `default_income_account=Sales - PSC`, `default_cash_account=Cash - PSC`,
`default_payable_account=Creditors - PSC`, `default_expense_account=Cost of Goods Sold - PSC`,
`cost_center=Main - PSC`.

---

## 0. Master-data prerequisites (reused, nothing new created)

| Master | Value on this bench | Notes |
|---|---|---|
| **Fiscal Year** | `"2026"` (`year_start_date=2026-01-01`, `year_end_date=2026-12-31`) | Pre-existing. `name` **is** the fiscal-year label itself (no separate code) — Budget's `fiscal_year` Link value is literally `"2026"`. |
| **Cost Center** | `"Main - PSC"` (leaf, `is_group=0`); `"PMO Smoke Co - PSC"` (root **group**, `is_group=1`) | Standard two-node CoA-seeded tree. |
| **Project** | `"PROJ-0001"` (`project_name="SPIKE-PROJ-1"`) | Pre-existing from the R9-P3a spike — naming-series-named, confirms the R9-P3a #5 finding still holds. |
| **Account** | see §4 (the mapping section) | Fetched fresh this session. |

---

## 1. The `Budget` doctype meta (read once via `GET /api/resource/DocType/Budget` — exact, no guessing)

This single call resolved most of OQ-BUD-1 without any trial POSTs — pasted verbatim (fieldname | fieldtype |
options | reqd | default):

```
naming_series                                    | Select | BUDGET-.YYYY.-              | reqd | —
budget_against                                   | Select | Cost Center\nProject        | reqd | Cost Center
company                                          | Link   | Company                     | reqd | —
cost_center                                      | Link   | Cost Center                 |      | —
project                                          | Link   | Project                     |      | —
fiscal_year                                      | Link   | Fiscal Year                 | reqd | —
monthly_distribution                             | Link   | Monthly Distribution        |      | —
amended_from                                     | Link   | Budget                      |      | —
applicable_on_material_request                   | Check  | —                           |      | 0
action_if_annual_budget_exceeded_on_mr            | Select | Stop\nWarn\nIgnore          |      | Stop
action_if_accumulated_monthly_budget_exceeded_on_mr | Select | Stop\nWarn\nIgnore        |      | Warn
applicable_on_purchase_order                     | Check  | —                           |      | 0
action_if_annual_budget_exceeded_on_po            | Select | Stop\nWarn\nIgnore          |      | Stop
action_if_accumulated_monthly_budget_exceeded_on_po | Select | Stop\nWarn\nIgnore        |      | Warn
applicable_on_booking_actual_expenses            | Check  | —                           |      | 0
action_if_annual_budget_exceeded                 | Select | Stop\nWarn\nIgnore          |      | Stop
action_if_accumulated_monthly_budget_exceeded     | Select | Stop\nWarn\nIgnore          |      | Warn
accounts                                          | Table  | Budget Account              | reqd | —
```

**`is_submittable=1`, `autoname="naming_series:"`, `track_changes=1`.** There are **23 fields total** and —
critically — **that is the complete list.** No `title`, `remarks`, `note`, `reference_no`, or any other free
text/Data/Small-Text/Long-Text field exists anywhere on the doctype (verified by filtering the full meta
dump for every text-like fieldtype — zero matches). This resolves §6 below decisively.

**`Budget Account` (child, `istable=1`, `is_submittable=0`):**
```
account         | Link     | Account                          | reqd
budget_amount   | Currency | Company:company:default_currency | reqd
```
Two fields. Nothing else — no `note`, no `remarks`, no cost-center override at the line level (the
`cost_center`/`project` dimension lives **only** on the header, not per account row — a **delta from the
P3c hypothesis**, which didn't assume a line-level dimension either, so this is confirmatory, not a
surprise).

---

## 2. Mandatory-field error ladder (the empirical CREATE contract)

Method: `POST /api/resource/Budget`, start from `{}`, add exactly what each error demands.

| Body | Result |
|---|---|
| `{}` | **417** `ValidationError`: `"Cost Center is mandatory"` — a **custom Python throw** (`erpnext/accounts/doctype/budget/budget.py:57`, `frappe.throw(_("{0} is mandatory").format(self.budget_against))`), **not** the framework's generic `MandatoryError`. Note `budget_against` **defaults to `"Cost Center"`** when omitted (confirmed by the message naming Cost Center, not Project), so an empty body is validated as a Cost-Center budget by default. |
| `{company}` | same 417 — `company` alone doesn't change the outcome |
| `{company, fiscal_year:"2026"}` | same 417 — `fiscal_year` alone doesn't satisfy `budget_against`'s dimension requirement |
| `{company, fiscal_year, cost_center:"Main - PSC"}` (no `accounts`) | **500** `pymysql.err.ProgrammingError` (`1064` SQL syntax error) — see §10(a), a genuine crash, not a validation error |
| `{…, accounts:[]}` (explicit empty array) | **same 500** — confirms the crash is the empty-`accounts` condition specifically, not merely an absent key |
| `{…, accounts:[{account:"Administrative Expenses - PSC"}]}` (no `budget_amount`) | **417** `MandatoryError`: `"[Budget, BUDGET-2026-00001]: budget_amount"` — clean, framework-level, once the `accounts` array is non-empty |
| `{company, fiscal_year, cost_center, accounts:[{account, budget_amount:100000000}]}` | **200** — full success, draft created as `BUDGET-2026-00001` |

**The complete mandatory set to CREATE a Budget:** `company` + `fiscal_year` + (`cost_center` **or**
`project`, per `budget_against`) + `accounts[].{account, budget_amount}` with **at least one** account row.
Nothing else is demanded — every `action_if_*`/`applicable_on_*` field carries its schema default silently.

**Real success response (trimmed):**
```json
POST /api/resource/Budget
{"company":"PMO Smoke Co","fiscal_year":"2026","cost_center":"Main - PSC",
 "accounts":[{"account":"Administrative Expenses - PSC","budget_amount":100000000}]}
→ 200
{"name":"BUDGET-2026-00001","docstatus":0,"naming_series":"BUDGET-.YYYY.-",
 "budget_against":"Cost Center","company":"PMO Smoke Co","cost_center":"Main - PSC","fiscal_year":"2026",
 "applicable_on_material_request":0,"action_if_annual_budget_exceeded_on_mr":"Stop",
 "action_if_accumulated_monthly_budget_exceeded_on_mr":"Warn","applicable_on_purchase_order":0,
 "action_if_annual_budget_exceeded_on_po":"Stop","action_if_accumulated_monthly_budget_exceeded_on_po":"Warn",
 "applicable_on_booking_actual_expenses":1,
 "action_if_annual_budget_exceeded":"Stop","action_if_accumulated_monthly_budget_exceeded":"Warn",
 "accounts":[{"name":"ko419sdtlf","account":"Administrative Expenses - PSC",
              "budget_amount":100000000.0,"parent":"BUDGET-2026-00001","docstatus":0}]}
```

**⚑ Surprise: `applicable_on_booking_actual_expenses` came back `1`, not its schema default `0`.** The meta
says `default=0`, but the server-created doc has it `=1` on every Budget this spike created (confirmed 3×
independently). This means **the actual-expense overspend control (§9) is ACTIVE out of the box** even
though the meta's static default claims otherwise — a builder reading only the meta (as this spike initially
did) would wrongly conclude the control needs to be explicitly turned on. **Do not trust the meta default
for this field; trust the observed created-doc value.** (Root cause not chased — likely a controller-level
default in `budget.py`'s `__init__`/`validate`, not a DocType JSON default. Not a repo concern to fix; a
contract fact to freeze.)

---

## 3. `budget_against` — the dimension enum, and the **Project verdict**

**Options (from meta, verbatim): `"Cost Center"` and `"Project"`. Only two values. No third option
(no Task, no generic dimension).**

### The Project-dimension Budget IS creatable on stock v15 — confirmed by a real POST:

```json
POST /api/resource/Budget
{"company":"PMO Smoke Co","fiscal_year":"2026","budget_against":"Project","project":"PROJ-0001",
 "accounts":[{"account":"Commission on Sales - PSC","budget_amount":25000000}]}
→ 200 BUDGET-2026-00003
{"budget_against":"Project","project":"PROJ-0001","cost_center":null, …}
```

**Requires exactly:** `budget_against:"Project"` + `project:"<ERP Project name>"` (the `PROJ-#####`
auto-name, per the R9-P3a #5 idiom — **not** `project_name`) — `cost_center` stays `null`, confirming the
two dimensions are mutually exclusive per Budget (you cannot set both on one header; nothing enforces this
server-side in this test, but the UI-visible fields are dimension-specific by convention — a `cost_center`
value on a Project-dimension budget was simply never sent and stayed null, not tested whether sending both
would be rejected or silently accepted — **untested edge, flag for the builder**: don't send both).

**Verdict for #2: YES — Project-dimension Budgets are a first-class stock v15 feature, not a hypothesis
that needed hedging.** This is unambiguous good news for the option-A design: PMO can author a Budget scoped
to a PMO project (`budget_against="Project"`) with **no cost-center bookkeeping required at all**.

---

## 4. The `Budget Account` child contract — the per-account line, and the mapping problem

**Exact shape (from meta + observed rows):**
```json
{"account": "<Account Link — reqd>", "budget_amount": "<Currency — reqd, IDR here>"}
```
`account` **must** be a real leaf `Account.name` (the `<label> - <company-abbr>` naming convention this
bench uses, e.g. `"Administrative Expenses - PSC"`). `budget_amount` is a **Currency** field: it round-trips
as a JSON **float** over REST (`100000000.0`, `25000000.0`, …) — **the same float-boundary risk every other
money field in this adapter has (NFR-BUD-MONEY-001 applies verbatim: coerce to a decimal-string at the
adapter boundary, never do money math on the parsed float).** No cost-center/project override at the line
level — the dimension is header-only (§1).

**A Budget line is per ACCOUNT, one row per account, and — per §8 — at most one *live* Budget per (grain,
account) can exist.** This is the crux of the `budget_category` → ERP `account` mapping the plan must solve.

**Real leaf Expense accounts on this bench** (`GET Account?filters=[["is_group","=",0],["root_type","=","Expense"]]`,
26 rows, names use the `<Account Name> - PSC` convention):

```
Administrative Expenses - PSC     Commission on Sales - PSC        Cost of Goods Sold - PSC
Depreciation - PSC                Entertainment Expenses - PSC     Exchange Gain/Loss - PSC
Expenses Included In Asset Valuation - PSC     Expenses Included In Valuation - PSC
Freight and Forwarding Charges - PSC           Gain/Loss on Asset Disposal - PSC
Impairment - PSC                  Legal Expenses - PSC             Marketing Expenses - PSC
Miscellaneous Expenses - PSC       Office Maintenance Expenses - PSC   Office Rent - PSC
Postal Expenses - PSC              Print and Stationery - PSC        Round Off - PSC
Salary - PSC                       Sales Expenses - PSC              Stock Adjustment - PSC
Telephone Expenses - PSC           Travel Expenses - PSC             Utility Expenses - PSC
Write Off - PSC
```

**PMO's `budget_category` enum (OD-BUDGET-4, locked, 7 values, migration `0001`):**
`Labor, Materials, Subcontractors, Equipment, Permits & Fees, Overheads, Contingency`.

**The mapping problem, stated plainly:** there is **no natural 1:1 correspondence.** The stock CoA is a
generic small-business template (Administrative/Marketing/Travel/Utility/…), **not** a project-services
chart of accounts — it has no "Equipment", no "Materials", no "Subcontractors", no "Permits & Fees", and no
"Contingency" account at all. Options the builder must choose between (this spike does not rule, it only
freezes the shape of the decision):
1. **A per-org config map** `budget_category → ERP account name` (1:1 or 1:many), resolved at write time;
   a category with **no configured mapping** must **fail closed** (reject the write with a clear error) —
   never silently drop the line or guess an account.
2. **Real CoA accounts will differ per client** — a live client's ERPNext will have its **own** chart of
   accounts (this bench's is the stock demo template), so the map is inherently **binding-config data, not
   a hardcoded constant** — the same shape as the existing ERP-project↔PMO-project map (R9-P3a #5).
3. Multiple PMO categories may need to fan into **one** ERP account (e.g. a client whose CoA has one
   generic "Project Expenses" account) — the map must support many-to-one, not assume one-to-one.
4. Conversely, "Overheads" is intentionally broad (OD-BUDGET-4) and may need to fan **out** to several ERP
   accounts — the map may need to be many-to-many, or the write path may need to **sum** multiple PMO
   category amounts onto one ERP account line if the client's CoA is coarser than PMO's enum. **This is a
   real design decision, not a mechanical lookup — flagged for the plan, not resolved here.**

---

## 5. Fiscal year / period scoping

- `fiscal_year` is a **required Link** to `Fiscal Year`, by **name** (this bench's FY is literally named
  `"2026"` — a simple year, not a `"2026-2027"` split-year label; **don't assume the label format**, a
  client's FY could be either).
- **A nonexistent fiscal year is rejected cleanly:** `{"fiscal_year":"2099", …}` → **417**
  `LinkValidationError`: `"Could not find Fiscal Year: 2099"`. No crash, no silent null — a real 4xx the
  adapter can classify.
- **Budget scopes to the fiscal year as a whole** — there is no explicit start/end override on the Budget
  itself; the FY's own `year_start_date`/`year_end_date` define the window the annual overspend check sums
  actuals over (visible in the `BudgetError` message's GL-report links, which carry `from_date`/`to_date`
  matching the FY).
- **`monthly_distribution`** (Link to `Monthly Distribution`) exists and is **optional** — not exercised in
  this spike (out of scope per the P3c spec §2, and confirmed truly optional: every Budget created above
  omitted it and saved/submitted fine). If phasing is wanted later, it's a genuine stock feature to pick up,
  not something that needs inventing.

---

## 6. Submittable? Lifecycle, and can it be UPDATED?

**`Budget` is submittable** (`is_submittable=1`, `docstatus` 0/1/2 — Draft/Submitted/Cancelled), confirmed
live: `PUT {"docstatus":1}` on a Draft → **200**, `docstatus` flips to `1`. `PUT {"docstatus":2}` on a
Submitted doc → **200**, flips to `2` (Cancelled). Re-cancelling an already-cancelled doc was not separately
probed here (R9/P3a precedent: 417 idempotent-guard).

**Can an existing Budget be UPDATED?** — **it depends on the field, and this is the single most
build-relevant finding in this spike:**

| Field class | `allow_on_submit` (meta) | Empirically |
|---|---|---|
| `account`, `budget_amount` (child) | **`0`** | **LOCKED once submitted.** `PUT` with a changed `budget_amount` on a submitted Budget → **417** `UpdateAfterSubmitError`: `"Row #1: Not allowed to change Budget Amount after submission from 25000000.0 to 40000000.0"`. **While still Draft**, `budget_amount` is **freely editable** (`PUT {"accounts":[{"name":"<child-row-name>", "account":…, "budget_amount":150000000}]}` → 200, confirmed value changed 100000000→150000000) — **you must include the child row's own `name`** (its own `Budget Account.name`, not the parent's) or the API tries to create a *new* child row and 404s looking for a mismatched auto-generated one (`"Budget Account l9soo58ni8 not found"` — a real trap, see §10(g)). |
| `action_if_annual_budget_exceeded`, `action_if_accumulated_monthly_budget_exceeded`, and both `_on_mr`/`_on_po` variants | **`1`** | **EDITABLE even after submit.** `PUT {"action_if_annual_budget_exceeded":"Ignore"}` on an already-submitted Budget → **200**, value changed, **no** `UpdateAfterSubmitError`. |
| every other header field (`company`, `fiscal_year`, `cost_center`, `project`, `budget_against`, `naming_series`) | `0` | not separately re-tested past submit (the money-field test above already proves the enforcement mechanism); assume locked, consistent with the meta. |

**So: the money figure is immutable post-submit; the enforcement POLICY is not.** A PMO "re-activate a
revised budget" flow **cannot** just `PUT` a new `budget_amount` onto a submitted Budget — it needs the
**amend** path:

### The amend mechanic — works over stock REST, confirmed live

```
1. PUT {"docstatus":2} on the old Budget (BUDGET-2026-00003)              → 200, docstatus=2
2. POST a NEW Budget with "amended_from":"BUDGET-2026-00003" + the SAME
   grain fields (company/budget_against/project/fiscal_year) + the NEW
   budget_amount                                                          → 200
   → name = "BUDGET-2026-00003-1"  (ERP appends "-1", NOT a fresh naming-series number)
   → amended_from = "BUDGET-2026-00003"  (the lineage pointer, queryable)
```
This **is** a real, working revision path: cancel the old submitted Budget, POST a new one carrying
`amended_from`, get back a name in the `<original>-1` shape with the lineage preserved. **This is the
landing spot for "PMO re-activating a revised budget version."** It is *not* a `PUT`/in-place update — it's
cancel + create, exactly like the P3a SI/PI amend-adjacent pattern, and `amended_from` gives a clean,
ERP-native lineage chain a builder can follow (`amended_from` chases back to the original; there was no
need to invent a lineage table for this).

**Client-supplied `name` is silently ignored.** A `POST` with an explicit `"name":"PMO-ANCHOR-TEST-001"` in
the body still auto-assigned `BUDGET-2026-00002` (the naming-series's next number) — **naming_series
autoname always wins over a client-supplied name**, confirmed live. Do not rely on being able to pick the
ERP name.

---

## 7. Anchor field — **NONE EXISTS. Flagging this LOUDLY, as instructed.**

**There is no header field on `Budget` that can carry a PMO idempotency key.** The full field list in §1 is
exhaustive (verified via the meta, not a guess): no `remarks`, no `title`, no `note`, no `reference_no`, no
free Data/Text field of any kind. The `Budget Account` child is equally bare (`account` + `budget_amount`
only). **This is the opposite of the P3a finding** (SI → `remarks`; PE-receive → `reference_no`), and it is
a genuine, structural gap for the ADR-0058 outbox pattern this write-through direction depends on:

- **No payload field survives round-trip that PMO can stamp with a dispatch/command id.** The P3a anchor
  idiom (stuff an idempotency key into a free-text field, then re-fetch and compare on ambiguous-response
  recovery) **has no home on Budget.**
- **What DOES survive, usable as a substitute, with caveats:**
  1. **The ERP `name` itself**, once known (post-create) — stable (naming_series-based, never
     user-renamable, confirmed in §6) and the `unique(org_id, erp_name)` key the write-adapter's own
     `external_refs`-style mapping table would key on. This works **after** a successful create, but is
     **useless for recovering from an ambiguous in-flight failure** (timeout mid-POST) because you don't
     have it yet.
  2. **The natural grain key itself** — `(company, budget_against, cost_center|project, fiscal_year,
     account)` — is **already enforced as unique by ERP** (§8's `DuplicateBudgetError`). On an ambiguous
     POST timeout, the adapter's recovery probe is: **list** `Budget` filtered by
     `company`/`budget_against`/`project`-or-`cost_center`/`fiscal_year`/`docstatus!=2`, then **GET each
     candidate by name** (the child-list-by-filter route is blocked — see §10(c)) and inspect its
     `accounts` for the account in question. This is **real but expensive** (a list call + N per-document
     GETs, worse than a single anchor-field lookup) and only disambiguates at the **(header × account)**
     grain, not at a PMO-command-id grain — if two different PMO commands legitimately target the same
     (project, fiscal_year, account) cell (which shouldn't happen under a single ETC-owner model, but the
     outbox can't assume that), this recovery path **cannot tell them apart.**
  3. `amended_from` is a lineage pointer, **not** an idempotency anchor — it only exists on an amended doc
     and only points to the doc it superseded; it's set by the client's own POST body (§6), so it proves
     nothing about *dispatch* history, only about *budget-revision* history.

**Verdict for #6: there is no ERP-native anchor. The outbox MUST derive idempotency from the natural
uniqueness grain (§8) + its own `external_refs`-equivalent mapping keyed on the resolved ERP `name` post
create — never from a payload field ERP echoes back, because none exists.** This is a materially different
(and weaker) idempotency story than P3a's SI/PE, and the plan that re-points P3c must say so explicitly, not
assume the SI/PE idiom transfers.

---

## 8. Duplicate / uniqueness semantics — real, atomic, and the load-bearing design fact

**ERP enforces uniqueness itself, server-side, per `(company, cost_center-or-project, fiscal_year, account)`
— confirmed with a real duplicate POST:**

```json
POST /api/resource/Budget
{"company":"PMO Smoke Co","fiscal_year":"2026","cost_center":"Main - PSC",
 "accounts":[{"account":"Administrative Expenses - PSC","budget_amount":999}]}
→ 417 exc_type: DuplicateBudgetError
"Another Budget record 'BUDGET-2026-00001' already exists against Cost Center 'Main - PSC'
 and account 'Administrative Expenses - PSC' for fiscal year 2026"
```

**And it is atomic per-document, not per-line:** a Budget with **two** account rows — one brand-new
account, one duplicating an existing (cost_center, fiscal_year, account) triple — is **rejected entirely**
(the same `DuplicateBudgetError`, same 417), not partially accepted. A builder cannot "top up" an existing
budget cell by re-POSTing a fresh header that happens to include one already-budgeted account alongside new
ones — the **whole create fails**.

**Verdict for #7: the duplicate check IS ERP's own idempotency-adjacent guard, and it is a genuine hard
constraint the write-adapter must design around** — not just detect. Concretely: **the adapter cannot
"upsert" a budget by re-POSTing** with an overlapping account; a revision to an existing live cell **must**
go through the §6 cancel+amend path, and adding a **new** account to an *existing, still-Draft* header can
be done by including it in a `PUT` (untested here — the Draft `PUT` test in §6 only re-sent the same single
row; adding a second **new** row via `PUT` while Draft was not separately exercised, flagged as an
open/cheap follow-up probe, not blocking).

---

## 9. Overspend controls — empirically PROVEN, not just documented

**The controls are real and were proven against a live Journal Entry, not just read from the meta:**

1. Created `BUDGET-2026-00005`: `cost_center="Main - PSC"`, account `"Commission on Sales - PSC"`,
   `budget_amount=1000`, `action_if_annual_budget_exceeded="Stop"`, `applicable_on_booking_actual_expenses=1`
   (the real created-doc default — see §2's surprise). **Submitted** (docstatus→1).
2. Created + submitted a plain **Journal Entry** booking **5,000,000** IDR debit to
   `"Commission on Sales - PSC"` / `"Main - PSC"` (credit to Cash, balanced). **Draft save succeeded (200)**
   — the check does **not** fire on save.
3. **Submitting** the JE (`PUT {"docstatus":1}`) → **417**, `exc_type: BudgetError`:
   > *"Annual Budget for Account **Commission on Sales - PSC** against Cost Center **Main - PSC** is
   > **Rp 1.000,00**. It is already exceed by **Rp 4.999.000,00**"* — plus a breakdown of Actual
   > Expenses/Material Requests/Unbilled Orders with drill-down report links.
   **The Stop control genuinely blocks submission of the over-budget voucher.** The check runs at
   **actual-voucher submit time**, not at Budget-submit time and not at Draft-save time.
4. **Flipped the control on the already-submitted Budget** (allowed — §6 confirms `action_if_*` is
   `allow_on_submit=1`): `PUT {"action_if_annual_budget_exceeded":"Ignore"}` → 200.
5. **Retried submitting the SAME over-budget JE** → **200, docstatus=1.** The Ignore control genuinely
   let the exact same over-budget transaction through, with **no amendment of the Budget's money figure
   required** — only the policy field changed.

**Verdict for #8: Stop and Ignore are both real, live-proven, and — crucially — the enforcement policy is
mutable post-submit without touching the immutable `budget_amount`.** This is good news for the PMO UI: a
"pause enforcement" toggle doesn't need the cancel+amend dance §6 requires for the money figure itself.
`Warn` was not separately proven (would show a warning but allow submit, per ERPNext's documented behavior;
not exercised here to save bench cycles — low-risk, standard Frappe Select-action semantics, not worth a
dedicated proof given Stop/Ignore already bracket the behavior).

**Six independent controls exist**, all `Select` `Stop|Warn|Ignore`, gated by three `Check` toggles
(`applicable_on_booking_actual_expenses` default **1** per §2's surprise; `applicable_on_material_request` /
`applicable_on_purchase_order` default `0`, not exercised): annual + accumulated-monthly, crossed with
material-request / purchase-order / actual-expenses. A write-through adapter authoring these needs to decide
values for **all six** action fields (or accept ERP's real defaults — Stop/Warn for MR, PO, and actuals) —
this is real per-org configuration surface, not a single knob.

---

## 10. Edges that CRASHED or surprised (the traps section)

**(a) Empty `accounts` is a raw SQL crash, not a validation error — the same class of bug as the SI/PI
empty-`items` crash (R9 §1 / R9-P3a #7).** `POST` with `accounts` **absent** or explicitly `[]` → **500**
`pymysql.err.ProgrammingError` (`1064`, MariaDB syntax error) at
`erpnext/accounts/doctype/budget/budget.py`'s `validate_duplicate()`, which builds `... ba.account in ()
...` — an empty `IN ()` clause is invalid SQL, and ERPNext doesn't guard against a Budget with zero account
rows before running that duplicate-check query. **The adapter MUST pre-validate a non-empty `accounts` array
client-side before every POST** — this is not a recoverable 4xx, it's an unguarded crash, exactly the
"pre-validate, don't retry blindly" lesson from every other doctype probed in this adapter program.

**(b) The list endpoint silently drops the `accounts` child table even when explicitly requested.**
`GET /api/resource/Budget?fields=["name","accounts"]` returns rows **without** an `accounts` key at all —
no error, just absent. Confirms the "list endpoint never returns child tables" behavior the (superseded)
P3c spec's OQ-BUD-1 hypothesized. Relevant to write-through too: **the only way to read back a Budget's
account lines (e.g. to verify what you just wrote, or to probe for the §7 recovery case) is the
per-document `GET /api/resource/Budget/<name>`** — confirmed working and returning the full `accounts`
array with real values.

**(c) Direct child-doctype list query is BLOCKED on this stock v15 bench, even scoped to one parent.**
`GET /api/resource/Budget Account?filters=[["parent","=","BUDGET-2026-00004"]]` → **403**
`frappe.exceptions.PermissionError` (`check_parent_permission` in `frappe/model/db_query.py` rejects it
regardless of the `parent` filter being present). **The per-document `GET /api/resource/Budget/<name>` is
the ONLY working way to read child rows on this bench** — there is no N-less bulk-read option. (This
resolves the now-superseded P3c OQ-BUD-1 #3 empirically in favor of option (a); relevant here because the
§7 idempotency-recovery path depends on it and must budget for the N+1 cost.)

**(d) A `Journal Entry` against a `Depreciation`-`account_type` account rejects with an unrelated
constraint** — `"Journal Entry type should be set as Depreciation Entry for asset depreciation"` (417
`ValidationError`). Not a Budget bug, but a real trap if a builder picks a `Depreciation`-typed account as a
quick stand-in for "any expense account" when writing a synthetic overspend test — it isn't a generic
expense account, it's a specially-constrained one. Switched the overspend proof (§9) to
`"Commission on Sales - PSC"` (a plain, unconstrained Expense account) to avoid this.

**(e) A Budget against a GROUP cost center was accepted at create time with no rejection.**
`{"cost_center":"PMO Smoke Co - PSC", …}` (the **root, `is_group=1`** cost center) → **200**, no error.
**Not further verified** whether a subsequent GL posting against a group cost center would be blocked
elsewhere (ERPNext generally forbids posting transactions to group nodes) — this spike did not chase it
further to conserve bench cycles, but it means **Budget creation itself does not gate on `is_group`**, so
**the adapter should validate `cost_center`/`project` resolution against a non-group leaf itself**, rather
than assuming ERP will reject a group node for you at Budget-create time. Flagged as an open risk, not a
frozen fact.

**(f) The amend mechanic (§6) is real but manual** — nothing auto-creates the amended doc; the client must
explicitly `POST` with `amended_from` set. There is no REST "amend" verb/endpoint.

**(g) ⚠️ CORRECTED 2026-07-22 — THE ORIGINAL RULE HERE WAS WRONG, AND ITS REMEDY WAS HARMFUL.**

> **What this section used to say:** that a `PUT` whose `accounts` children omit their own `name` 404s with
> `DoesNotExistError`, and that you must always round-trip each child row's `name` from a prior GET.
>
> **That is not reproducible on the bench this spike froze** (frappe 15.96.0 / erpnext 15.94.3). Re-probed
> from two independent directions — a full window-B adoption replay, and a controlled A/B/C — plus a direct
> Director probe:
>
> ```
> PUT /api/resource/Budget/BUDGET-2026-00077
>   {"accounts":[{"account":"Administrative Expenses - PSC","budget_amount":7777}]}
> → HTTP 200, persisted [('hvtuum0p2f', 7777.0)]        # bare child, NO name — regenerated, applied
> ```
>
> Frappe **replaces** the child table on a `PUT` and regenerates row names. A bare
> `{account, budget_amount}` child is fine; adding a row that did not exist is fine; sending only
> `{"accounts":[…]}` is fine.
>
> **⚑ The real trap is the OPPOSITE, and it is worse because it surfaces late.** A **stale or foreign**
> child `name` does NOT fail on the `PUT` — it returns 200 — and then blows up as a raw **500 on submit**:
>
> ```
> [child name: NONE  (what our code sends)]  PUT 200 | submit 200
> [child name: REAL  (the old remedy)]       PUT 200 | submit 200
> [child name: BOGUS]                        PUT 200 | submit 500
> ```
>
> So the old remedy was at best a no-op and at worst the ONLY way to reach the one reproducible failure:
> any implementation that carried a `name` from a GET of a *different* document would turn a working push
> into an unclassifiable 500.
>
> **Why this correction matters beyond the fact:** this section, as written, caused audit round 7 to raise
> a HIGH against correct code, and would have driven a fix that added complexity AND introduced that 500.
> A frozen spike that is wrong is more dangerous than no spike, because it is trusted. Field truth is
> re-probed against the bench, not inherited.

**The standing rule, corrected:** send `accounts` children as `{account, budget_amount}`. Do **not**
synthesise or carry a child `name` you did not read from *this same document* in *this same operation*.

---

## 11. Frozen finding index (cited for whoever re-points the P3c spec/plan)

| # | Finding | Consequence |
|---|---|---|
| **R11-P3c-1** | Mandatory CREATE set: `company, fiscal_year, (cost_center\|project per budget_against), accounts:[{account,budget_amount}]` (≥1 row). | The write adapter's `budgetToBody()` minimal shape. |
| **R11-P3c-2** | `budget_against` ∈ `{"Cost Center","Project"}` only; **Project-dimension Budgets are stock-supported** — `{budget_against:"Project", project:"<ERP name>"}`, no cost_center needed. | **Validates the option-A design** — PMO can author project-scoped budgets natively. |
| **R11-P3c-3** | `Budget Account` = exactly `{account (Link, reqd), budget_amount (Currency, reqd)}`. No line-level dimension override. Real leaf-Expense account pool has **no natural match** to PMO's 7-value `budget_category` enum. | The category→account map is **binding config, per-org, possibly many:1 or 1:many**, must fail-closed on an unmapped category — a real design decision for the plan, not a lookup table this spike can hand over pre-filled. |
| **R11-P3c-4** | `Budget` is submittable; `name` is naming-series-assigned (`BUDGET-.YYYY.-`), **stable, never client-settable** (client `name` silently ignored). `budget_amount`/`account` are `allow_on_submit=0` (**locked** post-submit) but the six `action_if_*` overspend fields are `allow_on_submit=1` (**mutable** post-submit). | A money-figure revision needs cancel+amend (§6); an enforcement-policy change is a simple `PUT`. |
| **R11-P3c-5** | **Amend works over REST**: cancel (`docstatus:2`) → POST new doc with `amended_from:"<old name>"` + same grain + new amount → new name `<old>-1`, lineage preserved. | The landing spot for "PMO re-activates a revised budget" — no bespoke lineage table needed, reuse ERP's own `amended_from`. |
| **R11-P3c-6** | **No anchor field exists anywhere on `Budget` or `Budget Account`** (exhaustive — verified via meta, not guessed). | The outbox **cannot** use the P3a remarks/reference_no idiom. Idempotency must derive from the natural uniqueness grain (§8) + a post-create `external_refs`-style name mapping; ambiguous-POST recovery is an expensive list+N-GET probe, not a single lookup, and can't disambiguate two legitimate writers targeting the same cell. **Flag for the plan: this is a materially weaker idempotency story than P3a's.** |
| **R11-P3c-7** | **Duplicate creation is a hard, atomic, server-side reject** (`DuplicateBudgetError`, 417) at `(company, cost_center\|project, fiscal_year, account)` grain; a mixed new+duplicate account batch fails **entirely**, not partially. | The adapter cannot "top up" a cell via re-POST; must branch to cancel+amend (§6) whenever the target cell already has a live Budget. |
| **R11-P3c-8** | **Overspend controls are real, live-proven**: `Stop` blocks the *voucher's* submit (not the Budget's) with `BudgetError`; `Ignore` allows it. Enforcement check fires at actual-voucher-submit time, not at save or at Budget-submit time. `applicable_on_booking_actual_expenses` **actually defaults to `1`** on created docs (contradicts the static meta default of `0` — trust the observed value). | Freeze the six action fields as real per-org config surface; document the true observed default, not the meta's. |
| **R11-P3c-9** | **Crash**: empty/missing `accounts` → raw 500 SQL `ProgrammingError` (`ba.account in ()`), same bug class as the SI/PI empty-items crash elsewhere in this adapter. | Client MUST pre-validate non-empty `accounts` before every POST; never retry this 500 blindly. |
| **R11-P3c-10** | Child rows are readable **only** via per-document `GET Budget/<name>` — the list endpoint drops child tables, and the direct child-list-by-filter route is **403-blocked** on this bench regardless of a `parent` filter. | Any read-back (verification, idempotency-recovery probing) is N+1-shaped; budget for it. |
| **R11-P3c-11** | Nonexistent `fiscal_year` → clean 417 `LinkValidationError`. Group cost centers are **accepted at Budget-create time with no rejection** (untested downstream). `PUT`-ing a child row without its own `name` 404s against a phantom generated name. A `Depreciation`-type account has an unrelated JE-type constraint that can confuse an overspend test. | Minor traps, all documented in §10, all worth a client-side guard or at least an inline comment when building. |

---

## 12. Cleanup

All docs created by this spike were cancelled/deleted; final state confirmed via `GET Budget` list:

| Doc | Final state |
|---|---|
| `BUDGET-2026-00001` (Draft, Cost Center/Admin Expenses) | **Deleted** (still Draft, hard-delete succeeded, `202`) |
| `BUDGET-2026-00002` (Draft, Cost Center/Commission on Sales, the client-`name`-ignored probe) | **Deleted** (`202`) |
| `BUDGET-2026-00003` (Submitted → Cancelled, Project/Commission on Sales) | **Cancelled** (`docstatus=2`); its amended successor deleted (below) — left as a cancelled fixture, cannot hard-delete a cancelled submittable doc with lineage |
| `BUDGET-2026-00003-1` (Draft amend of -00003, never submitted) | **Deleted** (still Draft, `202`) |
| `BUDGET-2026-00004` (Submitted, Cost Center/Depreciation, the Stop-control setup doc) | **Cancelled** (`docstatus=2`) |
| `BUDGET-2026-00005` (Submitted, Cost Center/Commission on Sales, the live overspend proof) | **Cancelled** (`docstatus=2`) |
| `ACC-JV-2026-00001` (Journal Entry, the overspend-proof voucher, ended up Submitted after the Ignore flip) | **Cancelled** (`docstatus=2`); **could not be hard-deleted** — `LinkExistsError` (`linked with GL Entry`), which is correct, expected ledger-immutability behavior, not a spike bug. Left cancelled, zero financial impact. |

**Left behind on the bench (all inert, zero live financial/budget impact):** three cancelled `Budget` docs
(`BUDGET-2026-00003`, `-00004`, `-00005`) and one cancelled `Journal Entry` (`ACC-JV-2026-00001`) —
consistent with the R9/P3a spikes' cleanup precedent (cancel where hard-delete is link-blocked by design).
No master data was created by this spike (Fiscal Year, Cost Centers, Project, and Accounts were all
pre-existing bench fixtures from earlier spikes) — nothing to clean up there.
