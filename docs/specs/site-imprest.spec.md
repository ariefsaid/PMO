# Feature: Site imprest plan and replenishment (#1515)

> **Status:** Signed (owner, 2026-11-01). §3 answered: OQ-IMP-1 and 3..8 as written, OQ-IMP-2 changed (custodian = the
> project's PM or a project admin; consequence DD-IMP-7). Plan: `docs/plans/2026-11-01-site-imprest.md`.
> **Route:** EPC prospect build route (#1481), item T4 of `docs/plans/2026-10-30-epc-odoo-build-route.md` (owner-signed
> 2026-10-30). Extends `docs/specs/expense-claims.spec.md` (#775); it does not replace or duplicate it.
> **Grounds (read, not re-derived):** owner ruling on #1490 (2026-10-30: standard imprest petty cash per site; fixed float
> sized from a monthly plan per project and category; head office replenishes by settled receipts; existing advance and
> return flow; out-of-plan spend needs approval; above the procurement threshold goes through procurement; the ERP holds
> only the cash account); `expense-claims.spec.md` DD-EXP-1..22 (one record two kinds, spend routing, four SoDs, advance
> settlement, phase B postings through core ERP documents); ADR-0019 (server-enforced SoD); ADR-0048, ADR-0055, ADR-0059,
> ADR-0094 (the ERP owns the ledger, PMO owns the process, PMO is the only interface); ADR-0058 and
> `docs/money-path-primer.md` (outbox, sweep); OD-PROC-5 (claims never live inside procurements);
> `docs/specs/odoo-connect-master-data.spec.md` (Odoo connect, O1); OD-ERP-ANYTIME-1 (ERPNext and Odoo through one adapter
> contract with one contract test suite).
> **Blocks:** #1509 (Odoo site cash accounting) is blocked by this issue; it implements the Odoo side of §9.
> **ID scheme:** `FR-IMP-###`, `NFR-IMP-###`, `AC-IMP-###`, `DD-IMP-#` (decisions taken here), `OQ-IMP-#` (owner questions).

## 1. Problem and job story

The EPC prospect's site finance describes the pain in its own words: there is no monthly budgeting; sudden requests from
site crews delay work by half a day to a day; site finance has no cash when the request lands; and site finance, head
office and procurement blame each other. Spend above a threshold is supposed to go to internal procurement.

PMO already has cash advances, advance returns, claims settled against advances, aging, and spend approval routing
(#775, #803). It has no notion of a **site's standing cash**, of a **monthly plan** that says in advance what that cash
is for, or of **replenishment** that tops the cash back up from receipts.

**Job story.** *When I run cash for a site, I want a fixed float that head office tops up by the receipts I have settled,
and a monthly plan per project and category approved before the month starts, so that routine site requests are served
from cash already on hand without a phone call, anything outside the plan or above the procurement limit goes through
the right approval, and head office can see at any moment that cash on hand plus receipts waiting equals the float.*

## 2. Scope and out of scope

**In scope**

1. A **site float** (imprest): a fixed amount of cash held by one custodian for one project's site.
2. A **monthly cash plan** per float: planned amount per budget category, approved before the month.
3. **Draw-down tracking**: advances and claims charged to a float count against the month's plan lines.
4. **Routing**: in-plan spend follows the existing spend routing; out-of-plan spend is an exception that only the senior
   approver set can approve; a single item above the org's procurement limit is refused on the float and must be raised
   as a procurement request.
5. **Replenishment**: head office pays the float back by the total of settled receipts; plus a **funding** top-up that
   brings a new or enlarged float up to its fixed amount.
6. **Position and reconciliation**: cash on hand plus advances out plus settled receipts waiting must equal the float;
   a custodian's physical cash count is compared with the book figure.
7. **ERP postings** for the cash movements, ERPNext and Odoo through one adapter contract (§9).

**Out of scope (follow-ups, each worth an issue after sign-off, none needed for the acceptance)**

- Closing or winding down a float (returning the remaining cash to head office); a float is open-ended in this spec.
- Settling a cash shortage or overage found by a count (write-off, recovery from the custodian). The variance is shown and
  audited; what to do with it is a Finance process this spec does not invent.
- Detecting purchases split to stay under the procurement limit (the limit applies per advance or claim; see OQ-IMP-3).
- A first-class **site** entity. A float is keyed to a project; site records belong to the roster work (T5, #1496).
- Several custodians per float, handing a float over between custodians mid-month.
- Foreign-currency floats (DD-EXP-11 stands: the org's default currency).
- Reserving budget at plan approval. A plan is a spending intent, not a commitment (DD-IMP-4).
- Mobile or offline capture of site receipts (ADR-0094: offline capture never bypasses online approval).
- Anything in the ERP beyond the cash movements: PMO never posts the plan, the float or the position.

## 3. Owner questions (owner-signed 2026-11-01)

Owner ruling 2026-11-01: yes to OQ-IMP-1, 3, 4, 5, 6, 7 and 8 as written; OQ-IMP-2 changed as below.

| # | Question | Ruling |
|---|---|---|
| **OQ-IMP-1** | What is a "site"? | **A float belongs to one project** (one float per project and custodian). A multi-project site, or two floats on one project, is two floats. |
| **OQ-IMP-2** | Who is a custodian? | **Changed by the owner: the project's PM or a project admin.** In the five-role model the project admin / secretary seat is the Finance role (`docs/decisions.md` OD-RIS-1), so a custodian is an active member who either holds the Finance role or is the manager of the float's project (`projects.project_manager_id`), and in both cases holds approval rank. A PM is a custodian only for a project they manage. Because a PM custodian must hand out the float's cash, the custodian, and only the custodian, pays a record charged to their float, whatever their role (DD-IMP-7); FR-EXP-024 is unchanged for records with no float. |
| **OQ-IMP-3** | What is the procurement limit and what does it apply to? | **One org-level amount, per advance or per claim, in the org currency, entered by an Admin.** It is a required field when the first float is created; there is no invented default number (the prospect's figure is not known). Splitting purchases under the limit is not detected in this spec. |
| **OQ-IMP-4** | Must every float claim carry a receipt? | **Yes: a claim charged to a float needs at least one receipt attachment to submit.** A "settled receipt" that nobody can check is not a receipt. |
| **OQ-IMP-5** | Does head office top up a float more than once a month? | **Yes, as often as there are settled receipts.** Any number of replenishments per month; each takes the receipts that are waiting. |
| **OQ-IMP-6** | Is a periodic cash count mandatory? | **Optional.** Any custodian-recorded count is compared with the book figure and a variance is flagged. Forcing a month-end count is a follow-up. |
| **OQ-IMP-7** | Who may raise the float's fixed amount? | **Admin or Finance proposes, the senior approver set approves** through the same routing as a plan (FR-IMP-002). The float amount is never edited in place by one person. |
| **OQ-IMP-8** | Which month does a spend belong to? | **The org-timezone month of its submission**, frozen at submission (an item filed on the 31st stays in that month even if approved on the 2nd). |

## 4. Director decisions proposed here (`DD-IMP-n`, for ratification into `docs/decisions.md`)

- **DD-IMP-1: the float is a sub-ledger of the existing advance and claim flow, not a new money object.** Cash leaves a
  float only through a Paid advance or a Paid claim that names the float; cash returns through the existing advance
  return, a replenishment, or a funding. No second payment table. *Why:* #1490 says to use the existing advance and
  return flow; every SoD and aging rule already proven there stays proven.
- **DD-IMP-2: the book identity.** For every float, at all times:
  `cash_book + advances_out + receipts_waiting = float_amount` once funded, where
  `cash_book` = Σ funding + Σ replenishment − Σ advances paid − Σ cash part of claims paid + Σ returns recorded,
  `advances_out` = Σ outstanding of the float's advances, and
  `receipts_waiting` = Σ amount of the float's Paid claims not yet in a Paid replenishment.
  The difference `float_amount − (cash_book + advances_out + receipts_waiting)` is the **gap**; before first funding it
  equals the float amount, afterwards it must be zero, and a non-zero gap after funding is a defect the position
  surfaces loudly.
- **DD-IMP-3: a float can never be overdrawn.** Paying an advance or claim that would take `cash_book` below zero is
  refused. Site finance cannot hand out cash it does not hold; the answer is a replenishment, not a negative balance.
- **DD-IMP-4: the plan caps nothing by itself; it decides the route.** Spend inside the month's remaining plan line
  follows the ordinary spend routing; spend outside it is an exception and only the senior approver set (or an Admin
  when none is configured, DD-APR-4) can approve it. An exception is never blocked, so urgent work is never stuck behind
  a missing plan, but it is always visible and always approved by someone more senior than the plan's own approver.
- **DD-IMP-5: the procurement limit refuses, it does not convert.** An advance or claim above the org limit is refused on
  a float with a message that names the procurement path. A claim is never converted into a procurement (OD-PROC-5).
- **DD-IMP-7: the custodian pays from their own float, and only from it (owner ruling on OQ-IMP-2, 2026-11-01).** The
  cash is physically in the custodian's hands, so paying a record charged to a float is the custodian's act, whoever
  they are: the Finance-or-Admin rule of FR-EXP-024 is replaced, **for float records only**, by "the caller is the
  float's custodian and still qualifies as one". Records with no float keep FR-EXP-024 exactly. The separations that
  follow, all server-enforced for every caller including an Admin (ADR-0019):
  1. **A custodian never approves a record charged to their float.** Payer ≠ approver (DD-EXP-3) and only the custodian
     can pay, so a custodian-approved float record could never be paid; the approval is refused up front instead.
  2. **A custodian never charges their own advance or claim to their own float.** Payer ≠ claimant (DD-EXP-3) and only
     the custodian can pay, so the link is refused when it is made (their own spend goes to head office as today).
  3. **A custodian never approves their own float's plan, replenishment or funding**, and never pays a replenishment or
     funding (§5, unchanged).
  4. **The float stays non-negative** (DD-IMP-3): the custodian's payment is refused when it would overdraw.
  5. **Eligibility is re-checked at every act, fail closed.** A custodian who loses the Finance role, stops managing
     the project, or leaves the org can no longer pay, request or record on the float; the float waits for a handover
     (out of scope, §2). The ERP posting gate re-checks the same rule for the recorded payer (§9).
  *Why:* the owner's site finance seat is the PM or the project admin, not always a Finance member; the five-role model
  has no narrower "may pay" capability, and widening FR-EXP-024 to every PM would let a PM pay any record from head
  office. Binding the right to one float keeps the widening as small as the cash in that person's hands.
- **DD-IMP-6: posting is a side-mirror.** PMO owns the float, plan and replenishment workflow; the ERP receives only the
  cash movements as documents on a per-float cash account (ADR-0059 Posture B, ADR-0094). Nothing in the ERP is read to
  decide a float, plan or routing outcome.

## 5. Roles and separation of duties

All SoD below is enforced in the database for every caller including an Admin, with a pgTAP proof (ADR-0019), and is
**in addition to** the four SoDs of DD-EXP-3, which are unchanged.

| Action | Who may | Server-enforced separation |
|---|---|---|
| Establish a float, set its fixed amount, bind its cash account | Admin, Finance | A change to an existing float's amount is approved by someone other than its proposer (OQ-IMP-7). The custodian is an eligible member (OQ-IMP-2). |
| Draft and submit a plan | Project Manager and above, or the float's custodian | Author recorded. |
| Approve or reject a plan | The route `spend_approval_route` returns for the plan's amount | Approver is not the plan's author. Custodian approving a plan for their own float is refused. |
| File an advance or claim charged to a float | Any member (claimant is the signed-in person, DD-EXP-5) except the float's own custodian | As DD-EXP-3; a custodian cannot charge their own record to their own float (DD-IMP-7.2). |
| Approve an in-plan float claim or advance | The ordinary route | Approver is not the claimant and not the float's custodian (DD-IMP-7.1). |
| Approve an out-of-plan (exception) item | The senior approver set only, else Admin | Approver is not the claimant, not the float's custodian, and not the approver of the month's plan. |
| Pay a float claim or advance (cash leaves the float) | The float's custodian only (PM or Finance, DD-IMP-7), still eligible | Payer is not the approver and not the claimant (DD-EXP-3); the float cannot go negative (DD-IMP-3). |
| Record a cash return on a float advance (cash comes back) | The float's custodian, or Finance or Admin as today (FR-EXP-041) | Recorder is not the claimant (DD-EXP-3). |
| Request a replenishment or funding | The float's custodian | None beyond recorded requester. |
| Approve a replenishment or funding | Finance or Admin who is **not** the custodian | Approver is not the requester. |
| Pay a replenishment or funding | Finance or Admin who is **not** the custodian | Payer is not the approver and not the custodian, so site finance can never top up its own float. |
| Record a cash count | The float's custodian; Finance and Admin may also record | Recorded by and at; counts are append-only. |

**Visibility:** a float, its plans, its replenishments and its counts are visible to the same population that sees all
claims (approval rank, DD-EXP-4), which includes every possible custodian (OQ-IMP-2 requires approval rank). An Engineer
sees no float and, as today, their own claims.

## 6. Data model sketch (one migration, written with its reverse, pattern of 0247 and 0270)

All tables FORCE RLS, stamp `org_id` from the caller, conjoin `is_active_member()`, and never accept `org_id`, status,
number, currency or any stamp from the client (NFR-IMP-001). Money columns are `numeric(14,2)` with a range check that
rejects NaN and Infinity.

- **`imprest_floats`**: `id`, `org_id`, `project_id` (not null), `custodian_id` (eligible member, OQ-IMP-2), `float_amount`,
  `currency` (stamped), `erp_cash_account_ref` (nullable, set only by the validating server action of §9),
  `archived_at`. Unique `(org_id, project_id, custodian_id)` where not archived.
- **`imprest_float_changes`**: proposed new `float_amount`, proposer, approver, status (`Proposed`, `Approved`,
  `Rejected`), stamps. The float's amount changes only by approving a row here (OQ-IMP-7); the first amount is a change
  row approved by the senior set at establishment.
- **`imprest_plans`**: `id`, `org_id`, `float_id`, `month` (first day of the month, org timezone), `number`
  (`IMP-YYMMDD####`), `status` (`Draft`, `Submitted`, `Approved`, `Rejected`, `Cancelled`), author, approver, stamps.
  Unique `(float_id, month)` among non-Cancelled, non-Rejected rows.
- **`imprest_plan_lines`**: `plan_id`, `budget_category`, `planned_amount > 0`. Unique `(plan_id, budget_category)`.
  The plan total is server-maintained from its lines (FR-EXP-004 pattern).
- **`imprest_replenishments`**: `id`, `org_id`, `float_id`, `kind` (`replenishment` | `funding`), `number`
  (`REP-YYMMDD####`), `status` (`Requested`, `Approved`, `Paid`, `Rejected`, `Cancelled`), `amount` (server-computed),
  requester, approver, payer, `payment_reference`, stamps.
- **`imprest_cash_counts`**: `id`, `org_id`, `float_id`, `counted_amount`, `book_amount` (frozen at the time),
  `variance`, `note`, counted by and at. Append-only.
- **`expense_claims`** gains three nullable columns, all frozen after submission (DD-EXP-10): `imprest_float_id`,
  `imprest_replenishment_id` (set only by the replenishment request, never by a client), `is_plan_exception`
  (server-set at approval, with the route reason). The expense `kind` machine, numbers and SoDs are untouched.

Cross-checks the database holds: a claim naming a float must be on that float's project; a float claim's budget category
is required; a claim sits in at most one non-cancelled replenishment; the float's custodian cannot be the claimant of a
record charged to that float (DD-IMP-7.2).

## 7. Functional requirements (EARS)

### Floats and funding
- **FR-IMP-001** The system shall let an Admin or Finance member establish a float for a project with a custodian who is
  an active member of the org holding approval rank and who either holds the Finance role or is the project's manager,
  and shall refuse otherwise (OQ-IMP-1, OQ-IMP-2).
- **FR-IMP-002** When a float is established or its amount proposed, the system shall route the amount through
  `spend_approval_route` to the senior approver set (Admin when none is configured, DD-APR-4) and shall set the float's
  amount only when that change is approved by a caller who is not its proposer (OQ-IMP-7).
- **FR-IMP-003** The system shall refuse to establish a float while the org's procurement limit is unset (OQ-IMP-3).
- **FR-IMP-004** When a float's gap is positive and no funding request for it is open, the custodian may request a
  `funding` whose amount the server sets to the gap (FR-IMP-050). Funding is how a new or enlarged float receives its
  cash.

### Plans
- **FR-IMP-010** A plan shall be keyed to one float and one calendar month, shall hold planned amounts by budget
  category, and shall have a server-maintained total.
- **FR-IMP-011** The system shall refuse a plan whose total exceeds the float's fixed amount.
- **FR-IMP-012** While a plan is `Draft` or `Rejected`, only its author may change its lines; once submitted, no client
  shall change them (DD-EXP-10 pattern).
- **FR-IMP-013** When a plan is submitted, the system shall require at least one line and, for the month, no other
  non-cancelled, non-rejected plan on the float.
- **FR-IMP-014** When a plan is approved, the system shall compute the route for each line with `spend_approval_route`
  (request amount = the line amount, category = the line's, project = the float's), require the caller to be permitted by
  every line's route, refuse the plan's author, and audit `imprest_plan.approval_route`.
- **FR-IMP-015** A plan may be approved for a month only before that month ends in the org's timezone. A plan for a
  month already begun is allowed (late approval is a fact of site life) but is audited as `late`. A plan whose month has
  ended shall be refused.
- **FR-IMP-016** Approving a plan shall not add to the project's budget line used amount (DD-IMP-4); only approved or
  paid claims count there, as today (DD-EXP-2).

### Charging spend to a float
- **FR-IMP-020** A member may name a float on a new advance or claim; the system shall require the float to be on the
  record's project and the record to carry a budget category (§6).
- **FR-IMP-021** When a record naming a float is submitted, the system shall refuse it if its amount exceeds the org's
  procurement limit, with a message that names the procurement path (DD-IMP-5); and, for a claim, shall require at least
  one receipt (OQ-IMP-4).
- **FR-IMP-022** The system shall compute a float line's **drawn** amount for a month and category as
  Σ amount of the float's claims in `Approved` or `Paid` + Σ outstanding of the float's advances in `Approved` or `Paid`,
  all attributed to the org-timezone month of their submission (OQ-IMP-8). Settling an advance with a claim moves the
  applied part from the advance's outstanding to the claim, so nothing is counted twice.
- **FR-IMP-023** The **remaining** of a line is its planned amount minus its drawn amount, and is zero when the month has
  no approved plan or the category has no line.
- **FR-IMP-024** When a record naming a float is approved or rejected, the system shall, under the float's lock and the
  (project, category) spend-line lock, compute whether the amount fits the remaining of its month and category. If it
  fits, the ordinary route applies. If it does not, the record is an **exception**: the route is forced to the senior
  approver set (Admin when none is configured), `is_plan_exception` is stamped, the approver must not be the approver of
  that month's plan, and the audit row `expense_claim.approval_route` carries `plan_exception = true` and the shortfall.
  In both cases the system shall refuse the float's custodian as the approver or rejecter (DD-IMP-7.1).
- **FR-IMP-025** While a record is an exception, the record page shall say so and show the approvers who can decide it.
- **FR-IMP-026** When a record naming a float is paid, the system shall require the caller to be the float's custodian
  and to still qualify as one (OQ-IMP-2), whatever their role, in place of FR-EXP-024's Finance-or-Admin rule; lock the
  float; and refuse if `cash_book` would fall below zero (DD-IMP-3, DD-IMP-7). The cash part of a claim (amount minus
  advance applied) and the whole of an advance leave `cash_book`. A record with no float keeps FR-EXP-024 unchanged.
- **FR-IMP-027** When a cash return is recorded on a float's advance, the system shall accept the float's custodian (still
  eligible) in addition to the Finance or Admin caller FR-EXP-041 allows, refuse the claimant, and add the return to
  `cash_book`.
- **FR-IMP-028** When a record names a float whose custodian is the record's claimant, the system shall refuse the link
  (23514, DD-IMP-7.2).
- **FR-IMP-029** When a custodian pays, requests a funding or replenishment, records a return or records a count, the
  system shall re-check that they still qualify as the float's custodian and refuse otherwise (DD-IMP-7.5).

### Replenishment
- **FR-IMP-050** When the custodian requests a replenishment, the system shall select every Paid claim of the float not
  yet in a non-cancelled replenishment, set its `imprest_replenishment_id`, compute `amount` as their sum, and refuse
  when there are none. The client sends the float only, never the amount or the claims.
- **FR-IMP-051** The system shall move a replenishment only Requested → Approved | Rejected | Cancelled and
  Approved → Paid | Cancelled. Rejecting or cancelling releases its claims. Paid is terminal.
- **FR-IMP-052** When a replenishment is approved, the system shall refuse the requester, the float's custodian, and any
  caller who is not Finance or Admin; and audit `imprest_replenishment.transition`.
- **FR-IMP-053** When a replenishment is paid, the system shall refuse its approver, its requester, the float's
  custodian and any caller who is not Finance or Admin; stamp payer, `paid_at`, org-timezone `paid_on` and the payment
  reference; and add the amount to `cash_book`.
- **FR-IMP-054** The system shall refuse a replenishment amount that, once paid, would take `cash_book + advances_out +
  receipts_waiting` above the float amount.

### Position, count and visibility
- **FR-IMP-060** The system shall expose `get_imprest_position(p_float)` (SECURITY INVOKER) returning float amount,
  `cash_book`, `advances_out`, `receipts_waiting`, `replenishment_in_flight`, `gap`, the latest count and its variance,
  and the month's plan lines with planned, drawn and remaining.
- **FR-IMP-061** The system shall expose `get_imprest_plan_usage(p_float, p_month)` returning each category's planned,
  drawn, remaining and the list of exception items of that month.
- **FR-IMP-062** When the custodian or Finance records a cash count, the system shall freeze the book figure, compute
  `variance = counted − book`, require a note when the variance is not zero, and audit `imprest_count.recorded`. A
  count is append-only.
- **FR-IMP-063** Every successful float, plan, change, replenishment and count transition shall write `audit_events`.
- **FR-IMP-064** The system shall notify, on the #788 pattern: the plan's approvers when a plan is submitted; the author
  when it is decided; the senior set when an exception awaits approval; Finance members other than the custodian when a
  replenishment is requested; the custodian when it is approved and when it is paid.

### Front end (UX only, ADR-0016; the server is the authority)
- **FR-IMP-070** `/imprest` shall list the floats the viewer may see, each with its position (float, cash, advances out,
  receipts waiting, gap) and a flag for a non-zero gap or a count variance. A read error shows an error state, never a
  fabricated zero.
- **FR-IMP-071** `/imprest/:floatId` shall show the position, the month's plan table (planned, drawn, remaining per
  category, exception items marked), receipts waiting, replenishments and counts, and only the actions the server would
  allow the viewer.
- **FR-IMP-072** The expense form shall offer **Charge to site float** (the floats on the chosen project) and shall show
  the month's remaining for the chosen category and whether the item would be an exception, as a hint only.
- **FR-IMP-073** `/approvals` shall list plans, replenishments and exception items awaiting the viewer.
- **FR-IMP-074** Money on every screen is computed in integer cents. The rail shows **Site cash** to roles that can see a
  float; the breadcrumb and ⌘K know the module; en and id strings ship together.

## 8. Non-functional requirements

- **NFR-IMP-001 (tenancy)** No client sends `org_id`. All new tables FORCE RLS with `is_active_member()`; children inherit
  `org_id`. Float, plan and replenishment reads join through the float.
- **NFR-IMP-002 (reversible)** One migration with a written statement-by-statement reverse in its header.
- **NFR-IMP-003 (definer surface)** New client-callable SECURITY DEFINER functions are limited to the transition RPCs
  (plan, replenishment, float change) and the claim-transition extension; each re-asserts org, active membership and role
  in its body, is on the 0178 allow-list with a pgTAP proof, and has EXECUTE revoked from `anon`.
- **NFR-IMP-004 (concurrency)** Pay, approve and replenishment-request on one float take one advisory lock keyed on the
  float; approval also takes the spend-line lock in the order the expense flow already uses, so two lanes cannot
  overdraw a float or double-select a receipt.
- **NFR-IMP-005 (money)** Every money column is `numeric(14,2)` with a range CHECK; the identity of DD-IMP-2 is asserted
  by a pgTAP property test over a random sequence of movements.
- **NFR-IMP-006 (performance)** Position and plan usage resolve in one RPC per read; lists are bounded at 200 + 1
  sentinel with a visible truncation notice; the drawn sum reaches claims through `(imprest_float_id, month)`.
- **NFR-IMP-007 (a11y and i18n)** Status and exception are text, not colour; launch-scope i18n gate (en + id).
- **NFR-IMP-008 (honesty)** A posting that is pending, failed or uncertain in the ERP is shown as such beside the
  movement. The position is computed from PMO's own records and never reads the ERP.

## 9. ERP posting and adapter parity

**Ownership.** PMO owns the float, plan, routing, position and replenishment workflow. The ERP owns the cash account's
ledger and receives only the cash movements (DD-IMP-6, ADR-0094). Nothing is posted until the org employs the
`expenses` domain on its bound ERP (DD-EXP-13, OD-XING-1) and the float has a cash account; a float with neither runs
fully standalone, as phase A of expenses does.

**Cash account.** Each float names its own ERP cash account (an ERPNext account of type Cash, or an Odoo cash journal and
its account). It is set only through a validating server action that reads the account from the ERP and refuses one that
does not fit (the DD-EXP-16 pattern); the same check re-runs before every posting. The head-office source account is the
company's default bank account, the Q10 rule.

**Canonical postings.** Each is an intent written in the event's own transaction and driven only by the sweep, using the
existing ADR-0081 originator and ADR-0058 outbox, with a deterministic key `<prefix>:<subject uuid>:<state stamp ms>`.

| PMO event | Posting | ERP effect (canonical) |
|---|---|---|
| Float advance Paid | `advance-payment` | Cash out of the **float's cash account** to the employee advance account (employee party). The only change from expenses phase B is the source account. |
| Float claim Paid, cash part > 0 | `claim-payment` | Cash out of the float's cash account to the employee payable (employee party). |
| Float claim Paid, advance applied > 0 | `settlement` | Unchanged from phase B (advance account against payable). |
| Advance return recorded | `advance-return` | Cash into the float's cash account from the employee advance account. |
| Replenishment or funding Paid | `replenishment` (new) | **Transfer** of `amount` from the head-office bank account to the float's cash account on the payment date. One document, no party. |

The claim approval journal and its project attribution are exactly phase B's (§10.8 of the expenses spec); the plan,
float and position are never posted.

**Adapter contract.** `replenishment` is one canonical command, `imprest.transfer { key, from_account, to_account,
amount, date, reference }`, and the float variants of the four existing postings differ only in `from_account` or
`to_account`. Both adapters implement the same command and pass the same contract test suite (OD-ERP-ANYTIME-1):

- **ERPNext:** core Journal Entry or Payment Entry of type internal transfer, anchored in `user_remark` or
  `reference_no`; the transfer is an immutable-anchor kind (reissue-capable, ADR-0058 C-1).
- **Odoo:** a cash-journal entry on stock Community JSON-2, no custom module (#1509 owns it; it is blocked by this
  issue). The exact stock mechanism and its anchor field are verified on the dev bed by #1509, not assumed here.

**Phasing of the build.** A: everything above except posting (standalone, PMO-only). B: the float cash account binding,
the `replenishment` intent, the four float variants and the ERPNext driver. C: the Odoo driver, delivered by #1509.
Reconciling PMO's `cash_book` against the ERP cash account balance is #1509's acceptance ("reconcile once and
exceptions are visible"), shown with a freshness stamp, never as a PMO-computed truth.

## 10. Acceptance criteria (Given/When/Then), each owned by one test

pgTAP files in `supabase/tests/`; unit tests in `pmo-portal/`. *mutation-worthy*: break the rule, the test must go red.

**Floats and funding: `imprest_floats.test.sql`**
- **AC-IMP-001** *Given* an org with no procurement limit, *when* an Admin establishes a float, *then* P0001 naming the
  limit; *given* a limit and a Finance custodian, *then* the float exists with `org_id` stamped; *given* the project's
  own PM as custodian, *then* the float exists; *given* a PM who does not manage the project, or an Engineer, as
  custodian, *then* 23514. (FR-IMP-001/003, OQ-IMP-2)
- **AC-IMP-002** *Given* a proposed float amount of 10,000,000 by Admin A, *when* A approves it, *then* 42501
  "separation of duties"; *when* a different senior approver does, *then* the amount is set. (FR-IMP-002)
  *mutation-worthy*
- **AC-IMP-003** *Given* an unfunded 10,000,000 float, *then* the position gap is 10,000,000; *when* the custodian
  requests funding, *then* the amount is 10,000,000; *when* a client sends an amount, *then* it is ignored or refused.
  (FR-IMP-004/050)

**Plans: `imprest_plans.test.sql`**
- **AC-IMP-010** *Given* a float of 10,000,000 and a plan of lines 6,000,000 and 5,000,000, *then* submit is refused
  (total above the float); *given* 6,000,000 and 3,000,000, *then* the total is 9,000,000. (FR-IMP-010/011)
- **AC-IMP-011** *Given* a Submitted plan, *when* its author edits a line, *then* 42501; *given* a second plan for the
  same float and month, *then* submit is refused. (FR-IMP-012/013)
- **AC-IMP-012** *Given* a plan authored by PM-A, *when* PM-A approves it, *then* 42501 "separation of duties"; *when*
  the custodian approves a plan for their own float, *then* 42501; *when* the routed approver approves, *then* Approved
  and an `imprest_plan.approval_route` audit row exists. (FR-IMP-014) *mutation-worthy*
- **AC-IMP-013** *Given* a plan for a month that has ended in the org timezone, *then* approval is refused; *given* the
  current month, *then* approval succeeds, audited `late` only when the month had already begun.
  (FR-IMP-015)
- **AC-IMP-014** *Given* an approved plan, *then* the project's budget line used amount is unchanged; *when* a claim on
  it is approved, *then* used rises by the claim. (FR-IMP-016)

**Charging and routing: `imprest_routing.test.sql`**
- **AC-IMP-020** *Given* a float claim whose project differs from the float's, *then* 23514; *given* a float claim with no budget
  category, *then* 23514. (FR-IMP-020)
- **AC-IMP-021** *Given* a limit of 2,000,000, *when* a claim of 2,500,000 on a float is submitted, *then* P0001 whose
  message names procurement; *when* the same claim has no float, *then* it submits as today; *given* a float claim with
  no receipt, *then* P0001. (FR-IMP-021, DD-IMP-5) *mutation-worthy*
- **AC-IMP-022** *Given* a plan line Fuel 3,000,000 with an advance of 1,000,000 outstanding and an Approved claim of
  1,500,000, *then* drawn is 2,500,000 and remaining 500,000; *when* the claim settles that advance in full, *then* drawn
  is 1,500,000 and nothing is counted twice. (FR-IMP-022/023)
- **AC-IMP-023** *Given* remaining 500,000, *when* the routed project approver approves a 400,000 float claim, *then*
  Approved, `is_plan_exception` false; *when* they try a 700,000 claim, *then* 42501 (exception, senior set only);
  *when* a senior approver approves it, *then* Approved, `is_plan_exception` true and the audit row carries
  `plan_exception = true` with shortfall 200,000. (FR-IMP-024) *mutation-worthy*
- **AC-IMP-024** *Given* an exception item, *when* the approver of that month's plan tries to approve it, *then* 42501;
  *given* no senior set, *then* an Admin who did not approve the plan may. (FR-IMP-024, DD-APR-4)
- **AC-IMP-025** *Given* a float claim in a month with no approved plan, *then* remaining is 0 and the item is an
  exception on approval. (FR-IMP-023/024)
- **AC-IMP-026** *Given* an exception item and another session holding `spend-line:<project>:<category>`, *when* the
  approver approves under a 200 ms `lock_timeout`, *then* 55P03; *when* released, *then* it succeeds. (NFR-IMP-004)

**Paying and overdraw: `imprest_cash.test.sql`**
- **AC-IMP-030** *Given* a funded float of 10,000,000 whose `cash_book` is 800,000, *when* Finance pays a 1,000,000
  advance, *then* P0001 "would overdraw the float"; *when* 800,000, *then* Paid and `cash_book` 0. (FR-IMP-026,
  DD-IMP-3) *mutation-worthy*
- **AC-IMP-031** *Given* a Paid 1,000,000 advance with a 300,000 return recorded and a Paid 500,000 claim that settled
  200,000 of it, *then* `cash_book` is funding − 1,000,000 + 300,000 − 300,000 (the claim's cash part), advances_out is
  500,000 and receipts_waiting 500,000. (FR-IMP-026/027, DD-IMP-2)
- **AC-IMP-032** *Given* a float claim, *when* a Finance user or an Admin who is not the float's custodian pays it, *then*
  42501; *when* the custodian tries to approve it, *then* 42501 "separation of duties" (DD-IMP-7.1). (FR-IMP-024/026)
  *mutation-worthy*
- **AC-IMP-033** *Given* a funded float whose custodian is the project's PM and an Approved float advance approved by
  someone else, *when* the PM custodian pays it, *then* Paid and `cash_book` falls by the advance; *when* that PM pays an
  Approved record on another project's float, *then* 42501; *given* the project's manager is reassigned, *when* the
  former PM pays, records a return or requests a replenishment, *then* 42501; *when* the PM custodian records a return
  on a Paid float advance, *then* `cash_book` rises by it. (FR-IMP-026/027/029, DD-IMP-7) *mutation-worthy*
- **AC-IMP-034** *Given* a float whose custodian is PM-A, *when* PM-A creates a claim charged to it, *then* 23514; *given* a
  non-float claim by a PM, *when* that PM pays any record, *then* 42501 (FR-EXP-024 unchanged off-float).
  (FR-IMP-028, DD-IMP-7.2)

**Replenishment: `imprest_replenishment.test.sql`**
- **AC-IMP-040** *Given* three Paid float claims of 400,000, 250,000 and 150,000 and one unpaid claim, *when* the
  custodian requests a replenishment, *then* its amount is 800,000, exactly the three claims carry its id, and the
  unpaid one does not. (FR-IMP-050)
- **AC-IMP-041** *Given* a Requested replenishment, *when* the custodian approves it, *then* 42501; *when* its requester
  approves, *then* 42501; *when* a Finance user other than the custodian approves, *then* Approved. (FR-IMP-052)
  *mutation-worthy*
- **AC-IMP-042** *Given* an Approved replenishment approved by F1, *when* F1 pays, *then* 42501; *when* the custodian
  pays, *then* 42501; *when* F2 pays with reference "TRF-7", *then* Paid, `payer` = F2, `cash_book` rises by 800,000 and
  receipts_waiting falls by 800,000. (FR-IMP-053) *mutation-worthy*
- **AC-IMP-043** *Given* a Requested replenishment, *when* it is rejected or cancelled, *then* its claims are released and
  can join a new request; *given* a Paid one, *then* no further move is allowed. (FR-IMP-051)
- **AC-IMP-044** *Given* any random sequence of fundings, advances, returns, claims and replenishments, *then*
  `cash_book + advances_out + receipts_waiting` equals the float amount after funding at every step, and the gap is
  zero. (DD-IMP-2, NFR-IMP-005, FR-IMP-054)
- **AC-IMP-045** *Given* two sessions each requesting a replenishment on one float at once, *then* each Paid claim joins
  exactly one. (NFR-IMP-004)
- **AC-IMP-046** *Given* a replenishment that, once paid, would take the sum above the float amount, *then* P0001.
  (FR-IMP-054)

**Position and counts: `imprest_position.test.sql`**
- **AC-IMP-050** *Given* the setup of AC-IMP-031 plus an Approved replenishment of 800,000, *then*
  `get_imprest_position` returns the figures with `replenishment_in_flight` 800,000 and gap 0; an org-B caller gets no
  rows. (FR-IMP-060)
- **AC-IMP-051** *Given* a book of 1,200,000, *when* the custodian counts 1,150,000 with no note, *then* P0001; *with* a
  note, *then* the row stores book 1,200,000 and variance −50,000 and an audit row exists; *when* the row is updated or
  deleted, *then* refused. (FR-IMP-062)
- **AC-IMP-052** *Given* Fuel planned 3,000,000 and an exception item, *then* `get_imprest_plan_usage` lists the category
  with planned, drawn, remaining and the exception item. (FR-IMP-061)

**Authority and notifications**
- **AC-IMP-060** `imprest_acl.test.sql`: *Then* `anon` holds no EXECUTE on any new definer function and `authenticated`
  does; the 0178 allow-list count is updated. (NFR-IMP-003)
- **AC-IMP-061** `imprest_rls.test.sql`: *Given* floats in orgs A and B, *then* each org sees only its own, an Engineer
  sees none, a Project Manager sees A's, and no client can write `org_id`, status or amount on any new table.
  (NFR-IMP-001)
- **AC-IMP-062** `imprest_notify.test.sql`: the notifications of FR-IMP-064 reach exactly the named recipients and never
  the author or the requester. (FR-IMP-064)

**ERP posting: `supabase/tests/imprest_postings.test.sql` and deno tests**
- **AC-IMP-070** *Given* a bound org employing `expenses` and a float with a cash account, *when* a replenishment is
  paid, *then* exactly one `replenishment` intent is written in the same transaction, keyed
  `rep:<replenishment id>:<paid_at ms>`; *given* no binding or no cash account, *then* none. (§9, FR-EXP-100 pattern)
- **AC-IMP-071** *Given* a float advance, claim payment and return, *then* each intent's frozen payload has the float's
  cash account on the correct side; a float with a cash account that no longer fits is refused and raised, not posted;
  the posting gate accepts a payment whose recorded payer is the float's still-eligible custodian (a PM included) and
  refuses one whose custodian no longer qualifies. (§9, DD-IMP-7.5)
- **AC-IMP-072** `adapter-dispatch` and the sweep: a replenishment posts once; a retried or recovered attempt reuses the
  key and adopts only its own document; an uncertain attempt is shown as such in the position (NFR-IMP-008). The ERPNext
  driver and the Odoo driver both pass the one `imprest.transfer` contract suite. (§9, ADR-0058)

**Front end (Vitest)**
- **AC-IMP-080** `src/lib/db/imprest.test.ts`: float, plan, replenishment and count writes send only granted columns (no
  `org_id`, status, amount, number); reads are bounded and report `truncated`; a write that lands nothing is a 42501.
- **AC-IMP-081** `src/lib/imprest/imprestRules.test.ts`: `availableImprestActions` returns exactly the server's allowed
  moves for each (status, role, custodian, requester) case; position arithmetic is cent-exact (0.1 + 0.2 class);
  exception hint matches FR-IMP-024.
- **AC-IMP-082** `pages/ImprestFloats.test.tsx` and `pages/ImprestFloatDetail.test.tsx`: the list shows each float's
  position and a flag for a non-zero gap; the detail shows the plan table with exception items marked; a failed read shows
  the error state, not a zero; the custodian sees **Request replenishment**, a non-custodian Finance user sees **Approve**,
  the custodian does not.
- **AC-IMP-083** `src/hooks/useImprest.test.tsx`: query keys carry the org; every mutation invalidates position, plan
  usage, replenishments, claims and approvals.
- **AC-IMP-084** `pages/ExpenseClaims.test.tsx` addition: the **Charge to site float** field lists only floats on the
  chosen project and shows the remaining and exception hint.
- **AC-IMP-085** `src/auth/policy.test.ts` additions for `imprestFloat`, `imprestPlan`, `imprestReplenishment`.

**Cross-stack (Playwright)**
- **AC-IMP-090** `e2e/AC-IMP-090-site-imprest-journey.spec.ts`, the #1515 acceptance: *given* a funded float, an approved
  plan and a Paid float claim with a receipt, *when* the custodian requests a replenishment and a different Finance user
  approves and a third pays it with a reference, *then* the float page shows cash on hand plus receipts waiting equal the
  float, receipts waiting zero, gap zero, and the claim marked replenished. *Given* an out-of-plan claim, *then* the
  project approver cannot approve it and the senior approver can.

## 11. Traceability

| AC | Owning layer | Test file |
|---|---|---|
| AC-IMP-001–003 | pgTAP | `supabase/tests/imprest_floats.test.sql` |
| AC-IMP-010–014 | pgTAP | `supabase/tests/imprest_plans.test.sql` |
| AC-IMP-020–025 | pgTAP | `supabase/tests/imprest_routing.test.sql` |
| AC-IMP-026 | pgTAP | `supabase/tests/imprest_line_lock.test.sql` |
| AC-IMP-030–034 | pgTAP | `supabase/tests/imprest_cash.test.sql` |
| AC-IMP-040–046 | pgTAP | `supabase/tests/imprest_replenishment.test.sql` |
| AC-IMP-050–052 | pgTAP | `supabase/tests/imprest_position.test.sql` |
| AC-IMP-060 | pgTAP | `supabase/tests/imprest_acl.test.sql` |
| AC-IMP-061 | pgTAP | `supabase/tests/imprest_rls.test.sql` |
| AC-IMP-062 | pgTAP | `supabase/tests/imprest_notify.test.sql` |
| AC-IMP-070–071 | pgTAP | `supabase/tests/imprest_postings.test.sql` |
| AC-IMP-072 | Deno | `supabase/functions/adapter-dispatch/` and `erpnext-sweep/` imprest tests; Odoo driver in #1509 |
| AC-IMP-080–085 | Unit (Vitest/RTL) | `pmo-portal/src/lib/db/imprest.test.ts`, `src/lib/imprest/imprestRules.test.ts`, `pages/ImprestFloats.test.tsx`, `pages/ImprestFloatDetail.test.tsx`, `src/hooks/useImprest.test.tsx`, `pages/ExpenseClaims.test.tsx`, `src/auth/policy.test.ts` |
| AC-IMP-090 | E2E | `pmo-portal/e2e/AC-IMP-090-site-imprest-journey.spec.ts` |

## 12. Build slices and executor routing

Superseded in detail by the plan (`docs/plans/2026-11-01-site-imprest.md`), which splits S1 into three migration slices.
Money, SoD and authority work, so the DB and posting slices are **Director-dispatched per issue**; the screens are
bounded Orca-worker slices (`docs/orca-dispatch.md`). Each slice branch pushes alone; money and SoD changes do not batch
with others.

1. **S1 (Director):** migration: tables, RLS, floats, plans, the claim columns, the float-aware extension of
   `transition_expense_claim`, position RPCs. AC-IMP-001..062.
2. **S2 (worker):** DAL, repository, hooks, rules, policy. AC-IMP-080/081/083/085.
3. **S3 (worker):** `/imprest` screens, expense form field, approvals section, i18n. AC-IMP-082/084, AC-IMP-090.
4. **S4 (Director):** float cash account binding, `replenishment` intent and float posting variants, ERPNext driver,
   contract suite. AC-IMP-070..072. Then #1509 for Odoo.

ADR-0094 was accepted 2026-10-31 and this spec signed 2026-11-01; S1..S3 run fully standalone and may ship first.
