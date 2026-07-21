# Spec: ERPNext adapter — Sales / AR full write-through (Issue P3a — ADR-0055 P3 phase, sales spine)

> **Status:** **Updated for owner sign-off outcomes** (2026-07-14 rediscussion). This is the P3a spec with the
> **R9-P3a live-bench spike frozen** — OQ-SAR-1 is now **ANSWERED** (its frozen field maps are binding; see §3 +
> `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md §R9-P3a spike`), the **owner sign-off questions are resolved**
> (§14, all six decided), and two new owner rulings are folded in: **OD-SAR-GATES** (a process-gating org-config
> seam, §5.13) and **OD-SAR-PMO-IS-THE-UI** (the accountant's UI is PMO → SI cancel/amend in-app + an SoD on SI
> submit, §5.14/§14-OQ-SAR-SIGN-6). The FR/AC surface, the read-model shape, the RLS flip, and the
> idempotency/lineage contract are pinned as drafted.
>
> **Authority / grounds:** ADR-0055 §§1–8 (binding architecture; SoT-by-domain + additive-enhancement
> + synchronous write-through + capability map; §5 ownership map row "Sales money documents (Quotation,
> Sales Order, Sales Invoice) → ERP"; §8 P3 phase = "sales documents (spine 4)"), ADR-0058 (the fenced
> money outbox **every** money command rides — applies **verbatim** to SI and PE-receive; the **C-1
> mutable-anchor ruling applies verbatim to PE-receive** because it is the *same* `Payment Entry`
> doctype as PE-pay, only `payment_type` flipped), ADR-0048 (standing: ERPNext as accounting engine, no
> homegrown ledger, **ledger-sourced-display rule**), the **shipped P2 ERPNext adapter**
> (`docs/specs/erpnext-adapter.spec.md` — signed off 2026-07-11), and the P2 implementation surfaces this
> issue **extends, never forks**: `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts` +
> `doctypeBodies.ts` (add the `sales-invoice` + `incoming-payment` kinds), `recoveryProbe.ts` (the
> composite PE probe gains a `payment_type` discriminator), `agingSnapshot.ts` (the AR side of the report
> path, already parameterized for `'Accounts Receivable'`), `feedKinds.ts` (the kind↔domain↔mirror-table
> + doctype→kind reverse maps), `supabase/functions/_shared/erpnextFeedDeps.ts` (inbound feed for the new
> kinds), and `supabase/functions/adapter-dispatch/readModelWriters.ts` (a `revenue` read-model writer).
> The flip/RLS patterns to mirror are `supabase/migrations/0097..0100` (per-command RLS split: INSERT
> `42501 WITH CHECK`, UPDATE trigger-pin, DELETE 0-row no-op) and the **0103 lesson** ("feed columns from
> day one" — `companies` shipped without `erp_modified`/`erp_docstatus` and broke live; the new tables
> ship all four `erp_*` feed columns on creation). House conventions as P2: EARS + `FR-SAR-`/
> `NFR-SAR-`/`AC-SAR-` ids; Given/When/Then; ADR-0010 test-pyramid traceability (one owning test per AC
> at its lowest sufficient layer: unit / pgTAP / **served-fn e2e in `e2e/serial/`**).
>
> **Owner intake rulings (binding, 2026-07-14):**
> 1. **FULL write-through, mirroring AP.** PMO authors client invoicing through adapter-dispatch + the
>    ADR-0058 outbox. The chain is **Sales Invoice (create + submit; cancel/amend lifecycle)** and the
>    incoming **Payment Entry (`payment_type = "Receive"`, referencing the SI)**. PE-receive is a
>    **MUTABLE-ANCHOR money doc exactly like PE-pay**: composite recovery probe, `held` state on
>    inconclusive post-window recovery, **NEVER auto-reissued** (C-1 ruling applies verbatim).
> 2. **Chain scope = SI + PE-receive ONLY.** **No Quotation, no Sales Order, no Delivery Note** — PMO's
>    pipeline module owns presales (ADR-0055 §5: "CRM pipeline + activities → PMO"; the opportunity→project
>    record *is* the project record). Sales-Order↔contract linkage is a **deferred FR (FR-SAR-180)** if
>    contract linkage later needs it; it is explicitly out of the P3a build.
> 3. **Project linkage is the product goal.** Every SI links to a PMO project (revenue *per project* is
>    what the business wants). New machine-written mirror tables `sales_invoices` + `incoming_payments`
>    with PMO enhancement columns, the `org_id` seam, and the per-command RLS flip (mirroring 0097–0100).
>    **All four feed columns ship from day one** (`erp_docstatus` / `erp_modified` / `erp_amended_from` /
>    `erp_cancelled_at`) — the 0103 lesson.
> 4. **AR aging reuses the P2 report path** (`agingSnapshot.ts` is already parameterized over
>    `'Accounts Receivable'`; bench-probed 2026-07-14, same report shape as AP). Spec the AR scope wiring
>    + the **Customer `payment_terms` due-date display** (the FR-ENA-094 precedent —
>    `companies.erp_payment_terms_days` already mirrors it).
> 5. **Inbound = lifecycle + adopt** via the existing feed (webhook/sweep) for the new kinds; **field-level
>    re-sync stays out of scope** (the P2 boundary — the inbound feed stamps lifecycle/`erp_*` columns; the
>    full native-field re-sync from a desk edit is the dispatch read-model writer's outbound job).
> 6. **R9-style live-bench mandatory-field probing is a SPIKE prerequisite** for the SI + PE-receive bodies
>    (income account / debit-to / paid_from / paid_to defaults). **Spec it as an open question with the
>    probe method (OQ-SAR-1); do NOT invent field maps.** The spike's frozen output is the binding body
>    map, mirroring how P2's R9 (`docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md`) froze PI/PE.
>
> **Scope (locked, Director, 2026-07-14):** (a) extend the `erpnext` adapter's capability map with a new
> PMO domain **`revenue`** (the ERPNext-owned sales/AR chain) and two new `ErpDocKind`s — `sales-invoice`
> (ERP `Sales Invoice`) and `incoming-payment` (ERP `Payment Entry`, `payment_type = "Receive"`); (b) the
> full SI write-through (create + submit + cancel/amend) and PE-receive write-through (create + submit +
> cancel), both riding the ADR-0058 outbox verbatim; (c) two new machine-written mirror tables
> (`sales_invoices`, `incoming_payments`) with the per-command RLS flip + day-one feed columns; (d) PMO
> project linkage on every SI (revenue-per-project); (e) AR aging read-back wiring (reuse the P2 report
> path) + the Customer `payment_terms` due-date display; (f) inbound lifecycle + adopt for the two new
> kinds via the existing feed; (g) the **non-ERPNext byte-for-byte invariant carried forward** — P3a's
> additions are **additive**: P2's procurement/parties behavior is unchanged, and an org that does not own
> `revenue`→`erpnext` gets no sales/AR surface and no behavior change. ADR-0055 §5 decisions and P2
> patterns are **not re-litigated here**.

---

## 0. Job story

> **When a client employs ERPNext as the money source of truth, PMO must let users issue client
> invoicing and record incoming payments through PMO while ERPNext remains the sole writer of
> committed/happened receivables money — and tie every sales invoice to a PMO project so revenue is
> accountable per project — and every client who does NOT employ ERPNext stays byte-for-byte the
> pre-P3a system.**

PMO stays the app layer and user surface; ERPNext owns the native sales money objects (Sales Invoice,
the Receive Payment Entry); Supabase holds the read-model plus PMO-only enhancements (the project link,
revenue views). Commands go down **synchronously** through the same `adapter-dispatch` boundary P2
shipped, guarded by the ADR-0058 idempotency key + outbox so a retry can never mint a duplicate SI or a
double-received payment. Change-feed truth comes up via the same webhook + modified-poll sweep; the SI's
outstanding balance and the PE's allocation are mirrored from ERP server-computed truth, never recomputed
(ADR-0048). The flip is per-org and reversible; with no `revenue`→`erpnext` assignment it is inert.

---

## 1. Overview and user value

P3a is the **second money phase** of the ERPNext adapter. It extends the shipped P2 machinery (the served
`adapter-dispatch` boundary, the ADR-0058 outbox + atomic recovery, the transition/lineage contract, the
decimal-string transport, the change-feed engine, the per-command RLS flip) to the **sell-side** of the
money chain for employing orgs. It flips one new group of domains:

1. **Revenue / AR** — two new PMO tables (`sales_invoices`, `incoming_payments`) become the
   machine-written read-model + enhancement layer over the stock sell-side money doctypes: **Sales
   Invoice** and **Payment Entry (`payment_type = "Receive"`)**. PMO enhancement: the **project link**
   (`sales_invoices.project_id` → `projects`, the revenue-per-project product goal) and the revenue/AR
   views that aggregate it.

The Customer party master is **already flipped by P2** (`companies.type='Client'`, read-model + create/update
party — OQ-4; `customerToBody`/`customerFromDoc` shipped, `erp_payment_terms_days` mirrored). P3a **reuses**
it unchanged: a SI references the Customer via the existing `external_refs` (`Customer:<name>` encoding).

User value: finance/PM users issue client invoices and record incoming payments from PMO without
double-keying; revenue is attributable per project (the business goal that pure ERPNext invoicing does not
give PMO); AR outcomes and aging from ERP truth appear in PMO; PMO preserves its project/CRM model and
tenant/RLS model; ERP-side desk edits remain legitimate and reconcile back because ERPNext is SoT.

---

## 2. Scope

### In scope
- A new PMO domain **`revenue`** owned by the `erpnext` tier (capability map grows `{companies,
  procurement}` → `{companies, procurement, revenue}`), registered in the `adapter-dispatch` registry and
  the `domain_externally_owned` ownership map (0087).
- Two new `ErpDocKind`s wired into `DOCTYPE_REGISTRY` + `DOCTYPE_BODIES`: **`sales-invoice`** (ERP `Sales
  Invoice`, submittable) and **`incoming-payment`** (ERP `Payment Entry`, `payment_type = "Receive"`,
  submittable) — additive entries, no fork of the PE-pay body.
- The full SI command surface: create (two-step insert→submit) + **cancel/amend** lifecycle (FR-ENA-050..053
  apply verbatim — SI is a submittable money doc like PI).
- The PE-receive command surface: create + submit + cancel (amend is desk-only in P3a, mirroring OQ-7's
  PE-pay ruling — PE-receive amend is rare and the cancel-first path covers correction).
- **Both money kinds ride the ADR-0058 outbox + atomic recovery algorithm verbatim.** PE-receive is a
  **MUTABLE-ANCHOR money doc** — `anchorField = 'reference_no'`, `anchorMutable = true` (the C-1 ruling
  applies verbatim: composite recovery probe, `held` on inconclusive post-window recovery, **never
  auto-reissued** — a blind reissue risks a double-receive, the AR twin of PE-pay's double-pay).
- Two new machine-written mirror tables `sales_invoices` + `incoming_payments` with: the `org_id` seam +
  `stamp_org_id()`; PMO enhancement columns; the per-command RLS flip (mirror 0097–0100); **all four
  `erp_*` feed columns from day one** (the 0103 lesson).
- **Project linkage:** every SI carries `project_id` (FK `projects`) resolved by the dispatch from command
  context + the binding's ERP-project→PMO-project map (the exact ERP dimension — cost center / `project`
  field / both — is the OQ-SAR-1 spike outcome, not invented here).
- Inbound: lifecycle (cancel tombstone / amend repoint / superseded-name no-op / `erp_modified` sync) +
  **adopt** of the two new kinds via the existing feed (`feedKinds.ts` + `erpnextFeedDeps.ts`), incl. the
  **`payment_type` disambiguation** for inbound Payment Entry events (one doctype → two PMO kinds).
- AR aging read-back wiring: confirm the bench-probed report shape holds, wire the AR scope into the
  binding config + sweep scheduling (the `agingSnapshot.ts` `Accounts Receivable` path is already shipped),
  and the **Customer `payment_terms` due-date display** (FR-ENA-094 mirror — `erp_payment_terms_days`).
- Binding config extension: add the receivable-side account defaults (`default_receivable_account`,
  `default_income_account`, `default_cash_account`) resolved from `GET Company/<name>` (the P2 R9 §6.2
  idiom) — frozen by OQ-SAR-1 (§3).
- The **non-ERPNext byte-for-byte invariant carried forward** (FR-SAR-004): P3a is additive — P2 behavior
  is unchanged; a non-`revenue` org gets no sales/AR surface.
- Served-edge-function money e2e lane (slice zero) is **reused** (P2 FR-ENA-001..003 shipped) — every
  P3a money-command e2e exercises the **real served `adapter-dispatch`** + the named server-side fault
  seams, never `page.route`.

### Out of scope
- **Quotation, Sales Order, Delivery Note** — P3+ later / deferred. Sales-Order↔contract linkage is a
  **deferred FR (FR-SAR-180)** flagged here, not built. PMO's pipeline module owns presales
  (ADR-0055 §5).
- **Customer *write* beyond party create/update** — already settled in P2 (OQ-4); unchanged.
- **Timesheets, budget projection** — separate P3 issues under ADR-0055 §6/§8.
- **e-Faktur, statutory close, period-close, returns/credit-note issuance as a *new* command** —
  ERPNext-native; a credit note cancelling an SI arrives as a normal **cancel/amend** lifecycle event
  through the feed (in scope as lifecycle), but authoring a standalone Credit Note is out.
- **PMO recomputation of ERP figures** beyond mirrored full-row upserts and ledger-row summation
  (ADR-0048). Invoice-only local AR-aging math is **prohibited** (carried from FR-ENA-162).
- **Field-level re-sync of native fields from a desk edit via the inbound feed** — the P2 boundary
  (the feed stamps lifecycle/`erp_*`; native-field re-sync is the dispatch read-model writer's outbound
  job). In scope: lifecycle + adopt + the outbound-commit native-field mirror only.
- Any helper-app requirement in ERPNext (ADR-0055 §2 — no adapter may require one).
- A PMO-native sales-invoice write path (revenue PMO-owned). The tables ship flip-shaped (forward-compat,
  §4.1/§7), but no PMO-native minting RPC or UI is built in P3a — today the only writer is the dispatch
  service role.

---

## 3. Decided defaults and open questions

The architectural questions are **DECIDED by the owner (2026-07-14)** in the intake rulings; the empirical
question (OQ-SAR-1) is **ANSWERED — frozen by the R9-P3a live-bench spike (2026-07-14)**, whose output is the
binding body map (mirroring P2's R9).

### OQ-SAR-1 — SI + PE-receive body field maps — **ANSWERED — frozen by the R9-P3a spike (2026-07-14)**

The R9-P3a live-bench spike ran against the same stock Docker ERPNext v15 bed P2 uses
(`frappe/erpnext:v15.94.3`, frappe 15.96.0 / erpnext 15.94.3, site `frontend` @ `http://localhost:8080`,
`PMO Smoke Co`, IDR, Standard COA, no custom apps, token auth, stock `/api/resource` v1 REST only). Its
**frozen output** — `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md §R9-P3a spike` — is the **binding** field
map for `pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts` + `incomingPayment.ts`. The frozen
findings (the answers this spec was waiting on):

1. **SI minimal body — accounts AUTO-DERIVED.** `{customer, items:[{item_code, qty, rate}]}` is the
   **complete** mandatory set → `200` (draft) → `PUT {docstatus:1}` → `200` (status flips Draft→Unpaid).
   ERPNext **server-derives** `debit_to` ← Company `default_receivable_account` (Debtors),
   `items[].income_account` ← Company `default_income_account` (Sales), `company`, `posting_date`,
   `due_date` (= `posting_date` when the Customer has no terms), `currency`, `items[].cost_center`,
   `items[].warehouse`, and all totals (`total`/`grand_total`/`outstanding_amount`) — **the adapter sends
   NONE of them.** (Side effect: the first priced SI auto-creates a `Standard Selling` Item Price — the
   sell-side mirror of PI's `Standard Buying`, R9 §0.)
2. **SI anchor = `remarks`, IMMUTABLE (PI-style recovery).** `remarks` **survives validate+submit+re-fetch
   verbatim** (spike set `SAR-SPIKE-ANCHOR-001` on the draft → still there post-submit); no validate-clobber
   observed. **Confirms OQ-SAR-4**: SI anchors `remarks`, `anchorMutable = false`, reissue-capable recovery
   (the PI twin, NOT the PE-pay twin).
3. **PE-receive minimal body — the adapter supplies BOTH accounts + `received_amount` is mandatory.**
   `{payment_type:"Receive", party_type:"Customer", party, paid_amount, received_amount, paid_from, paid_to,
   references:[{reference_doctype:"Sales Invoice", reference_name, allocated_amount}]}` → `200` → submit `200`
   → the cited SI flips `Paid`/`outstanding_amount 0`. The REST API **defaults NONE of the account fields** —
   the adapter supplies `paid_from` = `default_receivable_account` (Debtors) and `paid_to` =
   `default_cash_account` (Cash; `default_bank_account` may be NULL → fall back to cash) from binding config.
   `received_amount` is **mandatory** even same-currency (R9 §2 carries; not derived from `paid_amount`).
   The only ladder delta vs PE-pay: `Target Exchange Rate is mandatory` surfaces before *Source* while the
   accounts are absent — moot once the adapter sends both accounts (the body never needs the exchange rates;
   they auto-derive to 1.0). `references[]` is optional at both save and submit (a no-`references` PE is a
   valid on-account receipt).
4. **PE-receive anchor = `reference_no`, MUTABLE (C-1 verbatim).** `remarks` is **clobbered** by validate
   (auto-set to the composite `"Amount IDR … received from …\nTransaction reference no …"` string — same as
   PE-pay); **`reference_no` survives validate+submit+re-fetch verbatim**. **Confirms OQ-SAR-3**: PE-receive
   anchors `reference_no`, `anchorMutable = true`, composite probe + `held`-on-inconclusive, **NEVER
   auto-reissued** (double-receive guard).
5. **Project dimension = the SI `project` field (NOT `cost_center`), and it propagates to BOTH GL legs.** A
   header `project:"PROJ-0001"` lands on the SI header **and** the item row, and on submit **both** GL legs
   (Debtors debit **and** Sales credit) carry `project`; `cost_center` stays the Company default (`Main`) and
   is a **separate independent dimension** (not the project link). So revenue-per-project is realized by the
   dispatch resolving the ERP `project` (ERP `name`, via `project_name` search — Projects use a `PROJ-#####`
   naming series, client `name` ignored, and are **not** submittable) from the binding's ERP-project→PMO map
   and stamping it on the SI body. (FR-SAR-101.)
6. **AR aging = AP shape verbatim.** `Accounts Receivable` returns the same keys as AP (`customer_name`
   where AP has `supplier_name`; `voucher_no`/`party`/`outstanding`/`range1..5`/`total_due`/`po_no`/…); the
   **last element is a flat-list TOTALS row** (non-dict) — strip non-dict rows when materializing. The P2
   `parseAgingReport` parser handles both; no parser change. (FR-SAR-150.)
7. **SI empty/missing `items` = an unguarded `500 TypeError`** (`accounts_controller.py:2507
   set_payment_schedule`: `unsupported operand type(s) for -: 'NoneType' and 'float'`) — the **same crash
   shape as PI** (R9 §1), NOT a clean 417. The adapter **pre-validates non-empty `items` client-side** and
   classifies the 500 into the distinct non-retryable bucket (never blind-retried, FR-SAR-014/044).
8. **Behavioral delta from procurement: SI cancel is NOT hard-blocked by an active PE-receive.** Cancelling
   a referenced SI while its PE-receive is still Submitted returns **200** — ERPNext **auto-un-links** the
   PE-receive's `references` (`_server_messages`: `"Payment Entries ACC-PAY-… are un-linked"`) and cancels
   the SI; the PE-receive keeps its money/GL impact but loses the SI allocation (becomes on-account). **This
   differs from procurement** (PI/PR/PE-pay hard-fail with `LinkExistsError`, R9 §5). The lineage/cancel
   logic must **NOT** assume the P2 `LinkExistsError` block on the SI side — **cancel PE-receive-first remains
   the policy** (clean chain), but the SI-cancel path must **tolerate an already-unlinked PE-receive**.
   (FR-SAR-051 rewritten; FR-SAR-102/122; AC-SAR-022.)

**Binding config additions (frozen):** one `GET Company/<name>` fills `default_receivable_account` (Debtors —
PE-receive `paid_from`), `default_income_account` (Sales — informational; ERP server-derives it, the binding
caches it for validation/display), and `default_cash_account` (Cash — PE-receive `paid_to`). The AP-side
defaults from P2 are reused unchanged; `aging_report_names` already carries both AP + AR (P2). The spike's
`docs/spikes/YYYY-MM-DD-erpnext-si-pe-receive-fields.md` write-up is filed at plan time in the P2 R9 format;
**no `salesInvoice.ts`/`incomingPayment.ts` body may diverge from the frozen maps above.** FR-SAR-100..130
describe the *contract* (commands, mirror, transitions, idempotency, anchor); the maps above are the field
truth that fills them.

### OQ-SAR-2 — The `revenue` domain granularity — **DECIDED**
The SI + PE-receive flip as **one PMO domain, `revenue`**, with internal sub-doctype routing in the
`erpnext` doctype registry (the P2 OQ-2 precedent — one domain, atomic flip; an incoherent
SI-ERP-owned-while-PE-PMO-owned state is impossible). `revenue` is independent of `procurement` and
`companies`; an org can own any subset.

### OQ-SAR-3 — PE-receive idempotency / anchor — **DECIDED (C-1 applies verbatim)**
PE-receive is a `Payment Entry`; its `validate` hook **overwrites `remarks`** and `reference_no` **survives**
(the same live-bench-verified fact as PE-pay, ADR-0058 §3). So PE-receive anchors on **`reference_no`** with
**`anchorMutable = true`** and the **C-1 ruling applies verbatim**: composite deterministic recovery probe
(`payment_type='Receive'` + `party_type='Customer'` + `party` + exact `paid_amount` + a `references` row
citing the same **Sales Invoice** + `creation` within the claim window), `held` on a 0/>1 match post-window,
**NEVER auto-reissued** (a blind reissue risks a **double-receive**, the AR twin of PE-pay's double-pay).
**Live-bench-confirmed by the R9-P3a spike (2026-07-14)** — `reference_no` survives submit; `remarks` is
auto-clobbered, exactly as PE-pay. (OQ-SAR-1 #4.)

### OQ-SAR-4 — SI anchor — **CONFIRMED `remarks`, immutable (R9-P3a spike)**
The SI anchor defaults to **`remarks`** (the PI/R9 precedent — PI's `remarks` survives validate+submit+
re-fetch verbatim and is REST-filterable; SI is the AR sibling and is *expected* to behave identically).
**`anchorMutable = false`** (reissue-capable). The R9-P3a spike **live-confirmed** this (2026-07-14): `remarks`
survives validate+submit+re-fetch verbatim, no validate-clobber (OQ-SAR-1 #2). The fallback ruling (amend the
registry entry to `reference_no`-or-other at plan time if a future version clobbers `remarks`) stays
documented but was **not** needed — the spec ships `remarks`/immutable as confirmed, not assumed.

### OQ-SAR-5 — Customer party scope — **DECIDED (P2 already shipped it)**
The Customer flip (create/update party + `erp_payment_terms_days` mirror + read-only AR) is **already in
P2** (OQ-4, FR-ENA-090..094). P3a **reuses it unchanged** — no new Customer work. The SI resolves its
Customer via the existing `external_refs` (`Customer:<name>` encoding).

### OQ-SAR-6 — PMO-native revenue path — **DECIDED (deferred)**
The new tables ship **flip-shaped** (forward-compat RLS — §4.1/§7), but **no PMO-native sales-invoice
minting RPC or UI is built in P3a.** Today the only writer is the dispatch service role. A future PMO-owned
revenue feature for standalone orgs is a policy flip (release `revenue` ownership), not a schema rewrite.
The deferred FR for that is **not even numbered here** (it is not a P3a surface); the flip-shape is the
only forward-compat commitment.

---

## 4. New storage (schema — reversible migrations, RLS on every table)

All new tables carry the `org_id` seam (`org_id uuid not null default '…0001'` + the shared
`stamp_org_id()` BEFORE-INSERT trigger, migration 0074 pattern), are **machine-written** (dispatch/sync
service role) with org-isolated `SELECT`, and ship **all four `erp_*` feed columns on creation** (the 0103
lesson — `companies` shipped without them and broke the first live webhook with `42703 column
companies.erp_modified does not exist`). Migration numbers are `≥ 0104` (the next number after 0103 at spec
time; re-verify at plan time — another writer may be active).

### 4.1 `sales_invoices` (the SI read-model + project enhancement)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | the stable PMO record id |
| `org_id` | uuid not null | org seam; `stamp_org_id()` |
| `project_id` | uuid references `projects(id)` | **the product goal — revenue per project**; resolved by the dispatch from command context + binding's ERP-project→PMO map (OQ-SAR-1 dimension); nullable only if a SI genuinely books to no PMO project (an inbound-adopted SI with no link surfaces for operator assignment — FR-SAR-085) |
| `customer_id` | uuid references `companies(id)` | the AR party; resolved from `external_refs` (`Customer:<name>`) — the existing Customer mirror |
| `si_number` | text | ERP `name` (display) |
| `reference_number` | text | the customer's PO/external ref mirror (ERP `po_no` / customer bill ref — visible in the AR-aging row, OQ-SAR-1 #6); repurposed like `procurement_invoices.reference_number` |
| `invoice_date` | date | ERP `posting_date` |
| `amount` | numeric(14,2) | **money oracle** — ERP `grand_total` mirrored verbatim (FR-ENA-071 carries) |
| `erp_outstanding_amount` | numeric(14,2) | ERP `outstanding_amount` (the paid-detection oracle — after a referenced PE-receive submit it flips to 0 server-side) |
| `status` | text CHECK (`Draft|Submitted|Unpaid|Paid|Cancelled`) | **derived** from ERP `docstatus` + `status` + `outstanding_amount==0` (R9 §2 paid-detection idiom, AR twin) |
| `erp_docstatus` | smallint | feed column, day one (0103) |
| `erp_modified` | text | feed column (the per-row source-mod cursor, stale-event guard), day one |
| `erp_amended_from` | text | feed column (amend lineage), day one |
| `erp_cancelled_at` | timestamptz | feed column (soft-tombstone), day one |
| `created_at` | timestamptz | |

Index `(org_id, project_id)` (revenue-per-project rollups) + `(org_id, customer_id)`. Unique
`external_refs (org_id, 'revenue', external_record_id)` carries the SI's ERP `name` mapping (reuses the P1
constraint, no schema change — confirms it applies to the new domain).

### 4.2 `incoming_payments` (the PE-receive read-model)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | the stable PMO record id |
| `org_id` | uuid not null | org seam; `stamp_org_id()` |
| `customer_id` | uuid references `companies(id)` | the AR party; resolved from `external_refs` |
| `sales_invoice_id` | uuid references `sales_invoices(id)` | **nullable** — resolved from the PE `references[]` row (an unreferenced PE-receive is an on-account receipt, `references=[]`); when set, the SI is in the **same revenue scope** (the AR twin of the `payments.invoice_id` same-case invariant — see FR-SAR-161) |
| `ip_number` | text | ERP `name` (display) |
| `reference_number` | text | ERP `reference_no` — **also the idempotency-anchor carrier** (PMO owns it for PMO-originated PE-receives; FR-SAR-122) |
| `date` | date | ERP `posting_date` |
| `amount` | numeric(14,2) | **money oracle** — ERP `paid_amount` (header) / the per-SI `allocated_amount` from `references[]` resolved by the writer (FR-ENA-071 carries) |
| `status` | text CHECK (`Scheduled|Paid`) | **derived** |
| `erp_docstatus` | smallint | feed column, day one |
| `erp_modified` | text | feed column, day one |
| `erp_amended_from` | text | feed column, day one |
| `erp_cancelled_at` | timestamptz | feed column, day one |
| `created_at` | timestamptz | |

Index `(org_id, customer_id)` + `(org_id, sales_invoice_id)`. `incoming_payments.project_id` is **not
denormalized** — revenue-collection-per-project is derived via `sales_invoice_id → sales_invoices.project_id`
(avoid drift; an on-account payment has no project until allocated). `reference_number` is both the ERP
display field **and** the ADR-0058 anchor carrier for PE-receive (PMO owns it for PMO-originated docs —
`peToBody` never sends it, same as PE-pay).

### 4.3 Binding config extension (field names frozen by OQ-SAR-1)
`external_org_bindings.config` (0096) gains receivable-side account defaults resolved from
`GET Company/<name>` (the P2 R9 §6.2 idiom — one call fills the accounts). The exact set is the OQ-SAR-1
spike outcome; the **intended additions** (spec'd as the working hypothesis, not invented as frozen):
`default_receivable_account` (Debtors — PE-receive `paid_from`) and `default_income_account` (SI item income
account, if ERP does not server-default it from Item/Company). The AP-side defaults from P2
(`default_payable_account`/`default_cash_account`/`default_bank_account`/`default_expense_account`/
`cost_center`/`default_warehouse`) are reused unchanged; `aging_report_names` already carries both
`Accounts Payable` + `Accounts Receivable` (P2 shipped it). No new binding table — `external_org_bindings`
is the one shared per-org connection table (OD-ENA-SHARED-BINDINGS).

### 4.4 AR aging snapshot — **already shipped (0101)**
`erp_ar_aging_snapshot` (migration 0101, §4.4 of the P2 spec) already exists with the full schema
(`party`/`party_type`/`company_id`/`currency`/`total_outstanding`/`current`/`b_0_30`/`b_31_60`/`b_61_90`/
`b_90_plus`/`range_labels`/`report_date`/`ageing_based_on`/`as_of`/`source_report`/`report_version`/
`snapshot_id`). The `refreshAging` function (P2, `agingSnapshot.ts`) is **already parameterized** over
`'Accounts Receivable'` + the `erp_ar_aging_snapshot` table (the `AgingReportName`/`AgingSnapshotTable`
union types). P3a adds **no new snapshot table** — only the AR-side wiring (binding config confirmation +
sweep scheduling) and the Customer `payment_terms` due-date display (FR-SAR-150..154).

---

## 5. Functional requirements (EARS)

### 5.1 The non-ERPNext byte-for-byte invariant (carried forward from FR-ENA-004)

- **FR-SAR-004 (ubiquitous — THE INVARIANT, additive form)** — Where an org does **not** own
  `revenue`→`erpnext` (the shipped default for every existing client — `revenue` is a brand-new domain with
  no pre-P3a assignment), the system shall produce **byte-for-byte identical behavior** to the pre-P3a
  system: the new `revenue` domain, the two new `ErpDocKind`s, the two new mirror tables, and the binding
  config additions shall introduce **no** write path, **no** dispatch hop, **no** pending-push state, and
  **no** change to P2's `procurement`/`companies` behavior. P2's `erpnext` adapter gains capability-map +
  registry entries that are **never consulted** for a non-`revenue` org; P2's FR-ENA-004 invariant stays
  intact. *(P3a's critical risk, same shape as P2's: the registry/wiring additions must not perturb the P2
  path. The served-fn regression net AC-ENA-002 is the gate.)*
- **FR-SAR-005 (cold-start fail-closed routing)** — The routing decision reads the org's ownership from the
  **cached own-org ownership map** (P2 FR-ENA-005/F-CUA-031 lifecycle). An absent/not-yet-loaded map
  **defaults to `pmo`**; a revenue write routes to the `erpnext` adapter only when the map is loaded and
  positively asserts `revenue`→`erpnext`. A revenue command for a non-`revenue` org is rejected at the
  repository layer (`config-rejected` / `revenue-not-enabled`) — there is no PMO-native revenue path today
  (OQ-SAR-6).

### 5.2 ERPNext tier core extension — the `revenue` domain + two new kinds

- **FR-SAR-010** — The `erpnext` adapter's `capabilityMap` shall grow from `{companies, procurement}` to
  `{companies, procurement, revenue}` (one additive `Set` entry + a new `ERPNEXT_REVENUE_DOMAIN` constant);
  the `adapter-dispatch` registry + `domain_externally_owned` ownership map (0087) accept the new domain.
  The adapter remains a single tier owning multiple domains (P2 FR-ENA-010 generalization).
- **FR-SAR-011** — The `erpnext` doctype registry (`DOCTYPE_REGISTRY`) shall gain two additive entries —
  **`sales-invoice`** (`doctype:'Sales Invoice'`, `submittable:true`, `anchorField:'remarks'` default
  OQ-SAR-4, `anchorMutable:false` default) and **`incoming-payment`** (`doctype:'Payment Entry'`,
  `submittable:true`, `anchorField:'reference_no'`, `anchorMutable:true` — OQ-SAR-3, C-1 verbatim). No
  existing registry entry is edited (merge-coordination discipline, P2 `doctypeBodies.ts` pattern).
- **FR-SAR-012** — `DOCTYPE_BODIES` shall gain the two new kinds' `toBody`/`fromDoc` pairs from the
  OQ-SAR-1 spike (`bodies/salesInvoice.ts` + `bodies/incomingPayment.ts`), wired additively. The
  `incoming-payment` body sets `payment_type:'Receive'`, `party_type:'Customer'`, `party` from the resolved
  Customer `external_refs`, and the receivable-side accounts from binding config (the **mirror** of PE-pay's
  payable-side accounts); the `references[]` row cites the SI. The exact body fields are the spike's frozen
  output — this FR pins the *shape* (payment_type/party_type/party/accounts/references), not the field map.
- **FR-SAR-013** — The `readModelWriters` registry (P2 task 1.6) shall gain a **`revenue`** writer that
  upserts the canonical SI / PE-receive record into `sales_invoices` / `incoming_payments` (resolving
  `customer_id` + `project_id` for SI, `customer_id` + `sales_invoice_id` for PE-receive from the command's
  resolved refs), registered additively — no if-chain growth (the registry's stated invariant).
- **FR-SAR-014** — The adapter client's error classifier (P2 FR-ENA-013) applies unchanged to the two new
  kinds: `MandatoryError`/`ValidationError`/`InvalidQtyError`/`LinkExistsError`/`UpdateAfterSubmitError` →
  `commit-rejected`; the empty-`items` `500 TypeError` (**confirmed by OQ-SAR-1 #7** — same shape as PI:
  `accounts_controller.py:2507`; pre-validated client-side) → the distinct non-retryable bucket (never
  blind-retried, FR-ENA-042); network/timeout/5xx-after-budget → `external-unreachable`. No new classifier
  branch — the spike found the same error shapes as PI.

### 5.3 Money idempotency + post-commit safety (ADR-0058 — applies VERBATIM to both kinds)

- **FR-SAR-040** — Every non-read-only `revenue` money command (SI create/update-draft/submit/cancel/amend;
  PE-receive create+submit/cancel) shall carry a client-generated **`idempotencyKey`** and ride the
  `external_command_outbox` + atomic recovery algorithm **verbatim** (ADR-0058 §§1–4). The served dispatch
  rejects a missing key as `commit-rejected` / `missing-idempotency-key` before touching the outbox; P0/P1
  are unaffected (they never route to `revenue`).
- **FR-SAR-041 (write-before-commit + the unique 4-tuple)** — Before issuing a non-idempotent SI or
  PE-receive create, the dispatch `INSERT`s an `external_command_outbox` row `state='pending'` keyed by
  `(org_id, 'revenue', pmo_record_id, idempotency_key)`; the unique constraint makes a concurrent/duplicate
  attempt fail atomically (`23505`). The adapter stamps the key into the kind's per-doctype **anchor field**
  (FR-SAR-042) so a recovery probe can find an orphaned commit.
- **FR-SAR-042 (PE-receive anchor = `reference_no`, MUTABLE — C-1 verbatim)** — The `incoming-payment` kind
  stamps its idempotency key into **`reference_no`** (the same stock field PE-pay anchors on; PE's `validate`
  overwrites `remarks`, `reference_no` survives validate+submit+re-fetch carrying the key verbatim —
  ADR-0058 §3, live-bench-verified). `anchorMutable = true` ⇒ the **C-1 ruling applies verbatim**: the
  composite deterministic recovery probe is tried first, and a still-inconclusive post-window result →
  **`held`**, **NEVER auto-reissued** (a blind reissue risks a **double-receive**, the AR twin of PE-pay's
  double-pay). The `incoming_payments.reference_number` column IS the idempotency-key carrier for the life
  of a PMO-originated doc (PMO owns the field — the body never sends it).
- **FR-SAR-043 (SI anchor = `remarks` default, IMMUTABLE — OQ-SAR-4)** — The `sales-invoice` kind stamps its
  idempotency key into **`remarks`** (the PI/R9 precedent — `remarks` survives validate+submit+re-fetch
  verbatim and is REST-filterable; SI is the AR sibling, expected identical, **spike-confirmed** at OQ-SAR-1).
  `anchorMutable = false` ⇒ reissue-capable (a post-window probe miss is conclusive absence → reissue under
  the same key is safe, mirroring PI). If the spike finds SI clobbers `remarks`, the registry entry is
  amended to the `reference_no`-or-other ruling at plan time (this spec ships `remarks`/immutable).
- **FR-SAR-044 (no blind retry; atomic recovery by outbox state)** — The ERP client **never** blindly
  retries a non-idempotent POST (SI or PE-receive create) on a retryable transport failure or the
  `500 TypeError` bucket; a retry is permitted only through the guarded recovery algorithm (ADR-0058 §4
  state table: `confirmed` → return; `committed` → fenced finalize; `committing`(fresh) → wait;
  `committing`(stale) → **quarantine**, never reclaim-and-repost; `quarantined` → post-window claim →
  probe → adopt/reissue-or-hold per the per-kind policy; `held` → terminal until operator). The
  **`claim_outbox_for_commit` atomic claim** + **`claim_generation` fencing token** + **fenced
  `record_outbox_ref`/`confirm_outbox` finalization** apply verbatim (H-1 ruling) — two concurrent retries
  cannot both POST; a superseded claimant's write-backs are 0-row no-ops.
- **FR-SAR-045 (post-commit mirror-failure adopt)** — On a revenue command that commits in ERPNext but where
  PMO fails before mirror/ref finalization, the next retry **or** the sweep adopts and finishes the existing
  record (via the outbox `committed` fenced-finalize or the anchor/composite probe) rather than minting a
  duplicate mirror row — the sweep runs full outbox recovery for `revenue` rows exactly as it does for
  `procurement` (ADR-0058 §4 operational consequence).

### 5.4 Transition semantics, docstatus, cancel/amend lineage (FR-ENA-050..053 apply verbatim)

- **FR-SAR-050** — The adapter treats SI and PE-receive `transition` as first-class (P2 FR-ENA-050):
  **submit** (`PUT {docstatus:1}`), **cancel** (`PUT {docstatus:2}`), and **amend** (cancel + create-with-
  `amended_from`) — never an illegal update-after-submit (`UpdateAfterSubmitError`). SI supports the full
  cancel/amend lifecycle (owner ruling #1); PE-receive supports cancel (amend desk-only, mirroring OQ-7's
  PE-pay ruling). A content change to a submitted SI routes to cancel+amend.
- **FR-SAR-051 (cancel ordering — POLICY PE-first; SI cancel is NOT hard-blocked)** — Cancelling a SI with
  a submitted PE-receive referencing it follows the **PE-receive-first** order **as policy** (clean chain:
  the PE-receive's money allocation is released before the SI goes). **However — the AR delta from
  procurement (OQ-SAR-1 #8):** unlike procurement (PI/PR/PE-pay hard-fail with `LinkExistsError`, R9 §5), an
  SI cancel is **NOT hard-blocked** by an active PE-receive — ERPNext returns **200** and **auto-un-links**
  the PE-receive's `references` (`_server_messages`: `"Payment Entries … are un-linked"`); the PE-receive
  keeps its money/GL impact, loses the SI allocation, becomes on-account. So the cancel/lineage logic must
  **NOT** assume a P2 `LinkExistsError` block on the SI side; it must **tolerate an already-unlinked
  PE-receive** (re-derive `incoming_payments.sales_invoice_id` → null + tombstone the SI mirror + leave the
  PE-receive's own status untouched). The adapter still issues PE-receive-first by default; an
  operator-initiated SI-cancel-first proceeds (ERP allows it) and the mirror reconciles to the unlinked
  state. (Behavior confirmed live-bench; FR-SAR-102/122; AC-SAR-022.)
- **FR-SAR-052 (cancel soft-tombstones the mirror)** — When ERPNext cancels a SI or PE-receive
  (`docstatus 2`), the feed/mirror-apply **soft-tombstones** the read-model row (`erp_cancelled_at`,
  `erp_docstatus=2`) rather than deleting it, retains its `external_refs` mapping, and writes an
  `external_ref_lineage` row (`reason='cancelled'`) — the cancelled doc keeps a read-only mirror for audit.
  Active revenue views/rollups filter tombstoned rows out. (OQ-8 cancel-only, carried from P2.)
- **FR-SAR-053 (amend lineage + out-of-order events)** — When ERPNext amends a SI or PE-receive and produces
  a new `name` (`amended_from` = old), the mirror-apply **repoints** `external_refs` for the same
  `pmo_record_id` to the new `name`, stamps `erp_amended_from`, and writes an `external_ref_lineage` row
  (`reason='amended'`). The per-row `erp_modified` source-modification guard + the superseded-name lineage
  lookup make a stale old-name event a no-op (never clobbering the live amended mirror). No duplicate mirror
  row is ever minted for the amended doc. (P2 FR-ENA-053 applies verbatim.)

### 5.5 Amount transport and mirror-write shape (FR-ENA-070..073 apply verbatim)

- **FR-SAR-070 (decimal-string transport)** — Every money/rate/quantity/outstanding/allocated/total value
  crosses the `revenue` command path as a **decimal string** end-to-end (dispatch → adapter → ERP
  body/response → feed apply → sweep apply); no monetary value passes through JS float math. (P2 FR-ENA-070.)
- **FR-SAR-071 (the money oracle)** — The authoritative mirrored money figure for a SI is the ERPNext
  server-computed `grand_total`, mirrored verbatim into `sales_invoices.amount`; `outstanding_amount` →
  `sales_invoices.erp_outstanding_amount` (the paid-detection oracle — after a referenced PE-receive submit
  it flips to 0 server-side, mirrored). For a PE-receive, `paid_amount` (header) → `incoming_payments.amount`
  and the per-SI `allocated_amount` from `references[]` is resolved by the writer for the SI link. The money
  oracle for any total/outstanding/paid display is always the mirrored ERP header figure, never a PMO
  recomputation (ADR-0048). (P2 FR-ENA-071.)
- **FR-SAR-072 (over-scale + null handling)** — `numeric(14,2)` columns; ERP `null`/absent maps to SQL
  `NULL` (not `0`) where nullable; an over-`numeric(14,2)` header total is classified `commit-rejected`
  (never truncated); ERP scale-2 totals preserved exactly (no re-derivation). (P2 FR-ENA-072.)
- **FR-SAR-073 (full-row upsert; project_id is machine-resolved)** — Inbound ERP changes apply as full-row
  upserts of native mirrored fields (idempotent re-apply, no PMO recomputation). `sales_invoices.project_id`
  is **machine-written** (resolved by the dispatch at the outbound commit from the command's project context
  + binding map; for an inbound-adopted SI it is resolved per FR-SAR-085) — it is **never** user-writable
  while `revenue` is externally-owned (the RLS flip, §7). PMO revenue views/rollups *sum* mirrored rows for
  revenue-per-project, never recompute a figure.

### 5.6 Change-feed mechanics: lifecycle + adopt for the new kinds (reuse P2 engine)

- **FR-SAR-080 (modified-poll sweep + webhook hints, unchanged)** — The P2 change-feed engine
  (`erpnext-webhook` HMAC ingress + modified-poll reconciliation sweep, FR-ENA-080..083) applies to the two
  new kinds with **no engine change** — `feedKinds.ts` gains the two kinds' domain (`'revenue'`) +
  mirror-table (`'sales_invoices'`, `'incoming_payments'`) entries. The sweep cursor is monotonic per
  `(org, doctype)` on `external_sync_watermarks`; webhooks are lossy hints; the sweep is the convergence
  authority. (P2 FR-ENA-080..083, NFR-ENA-FEED-001.)
- **FR-SAR-081 (Payment-Entry payment_type disambiguation — the one-doctype/two-kinds rule)** — Because
  ERPNext `Payment Entry` is **one doctype** mapped to **two PMO kinds** (`payment` = Pay/AP,
  `incoming-payment` = Receive/AR), the inbound feed's doctype→kind reverse-lookup (`kindFromDoctype`)
  alone is insufficient for Payment Entry. An inbound Payment Entry event shall be disambiguated by
  **inspecting `payment_type`** (`'Pay'` → `payment`/`payments`; `'Receive'` → `incoming-payment`/
  `incoming_payments`) before routing, so an AP payment is never mirrored into `incoming_payments` (and
  vice-versa). Sales Invoice is a unique doctype→kind mapping (no disambiguation needed).
- **FR-SAR-082 (lifecycle-only feed stamping — P2 boundary)** — The inbound feed stamps the
  lifecycle/`erp_*` columns (`erp_docstatus`/`erp_modified`/`erp_amended_from`/`erp_cancelled_at`) + status
  derivation for the two new kinds, exactly as it does for procurement (P2 `erpnextFeedDeps.mirrorStatusPatch`
  writes the uniform column set to every mirror table — hence the day-one columns). The full native-field
  re-sync from a field-level desk edit is **out of scope** (the P2 boundary) — it is the dispatch read-model
  writer's outbound job on the next command's commit. (P2 `erpnextFeedDeps.ts` module docstring.)
- **FR-SAR-083 (PE-receive composite probe gains payment_type)** — The `probeErpByPaymentComposite`
  recovery probe (P2 `recoveryProbe.ts`, C-1) shall carry a **`paymentType`** discriminator in its filter
  set so a PE-receive probe (`payment_type='Receive'`, `party_type='Customer'`, `references`→Sales Invoice)
  cannot cross-match a PE-pay of the same amount/party (and vice-versa). The existing PE-pay callers supply
  `payment_type='Pay'` (additive — the composite currently omits it because the anchor hit was sufficient;
  adding it is correctness hardening for the two-kind world). (ADR-0058 §4 composite probe, extended.)
- **FR-SAR-084 (webhook signature is the trust boundary)** — Inbound ERPNext webhooks for the new kinds are
  verified `X-Frappe-Webhook-Signature = base64(HMAC-SHA256(secret, raw_body))` before any side effect;
  absent/invalid → `401`, no side effect. (P2 FR-ENA-082.)
- **FR-SAR-085 (inbound adopt of a natively-created SI surfaces for operator project-assignment)** — An
  inbound SI (created natively in ERP, no PMO command) has no PMO `project_id` (the ERP doc does not carry
  the PMO project mapping). Its inbound adopt shall **mint the `sales_invoices` mirror with `project_id =
  NULL`** and **surface an `action-required` operator task** to assign the project (the AR twin of the P2
  party ambiguous-match surfacing — never auto-assign the wrong project, never silently drop the doc). A
  natively-created PE-receive referencing an already-mirrored SI adopts normally (resolving
  `sales_invoice_id` from the SI's `external_refs`); one referencing an unknown SI surfaces
  `action-required`. The webhook acks-and-skips a lossy hint; the sweep re-surfaces the row (P2 FR-ENA-083).

### 5.7 Sales Invoice (SI) write-through + project linkage (the AR twin of FR-ENA-115)

- **FR-SAR-100 (SI create + submit, two-step)** — A PMO `sales-invoice` create command maps to ERPNext
  **`Sales Invoice`**. The adapter uses the R9 **two-step** insert-then-submit (P2 FR-ENA-044): `POST` insert
  as draft → `PUT {docstatus:1}` submit, re-fetching the true `status`/`outstanding_amount` after submit
  (never trusting a stale POST/PUT response body — R9 §5 stale-status trap). The **frozen SI body**
  (OQ-SAR-1 #1) is `{customer, items:[{item_code, qty, rate}]}` — ERPNext **server-derives** `debit_to`
  (← `default_receivable_account`) and `items[].income_account` (← `default_income_account`), so the adapter
  **sends neither account**; it resolves the Customer via `external_refs`, pre-validates non-empty `items`
  (the empty-`items` `500 TypeError`, OQ-SAR-1 #7), and lets ERP server-compute `total`/`grand_total`/
  `outstanding_amount`. The **submit step is SoD-gated** (approver≠author, FR-SAR-195) — draft authoring is
  ungated, the money-commitment submit is the approval step.
- **FR-SAR-101 (project linkage — the product goal; `project`, NOT `cost_center`)** — Every SI command
  shall carry a **`project_id`** (the PMO project the revenue books to). **Frozen OQ-SAR-1 #5 finding**: the
  ERP dimension that realizes revenue-per-project is the SI **`project` field** (header suffices; per-item
  overrides per row), **NOT `cost_center`** (which stays the Company default and is a separate independent
  dimension). The dispatch resolves the ERP `project` (ERP `name`, via `project_name` search — Projects use a
  `PROJ-#####` naming series and are not submittable) from the binding's ERP-project→PMO map, **stamps it on
  the SI body** so ERP attributes the revenue — and on submit **both GL legs** (Debtors debit **and** Sales
  credit) carry `project` (live-bench-confirmed) — and mirrors `project_id` into `sales_invoices.project_id`
  (machine-written). Revenue-per-project views/rollups aggregate on this column; the ERP-project→PMO map
  lives in binding `config`. (The `require_project_on_si` gate, FR-SAR-191, may relax this to allow a null
  `project_id` rolling up as 'Unassigned' for documented edge cases; **default ON**.)
- **FR-SAR-102 (SI cancel/amend lifecycle)** — A submitted SI may be **cancelled** (`PUT {docstatus:2}`) and
  **amended** (cancel + create-with-`amended_from`) through adapter-dispatch, riding the ADR-0058 outbox +
  the FR-SAR-050..053 transition/lineage contract. Cancelling a SI with a live PE-receive referencing it
  follows **PE-receive-first policy but is NOT hard-blocked** — ERP auto-unlinks the PE-receive's references
  and cancels the SI (FR-SAR-051). A cancelled SI soft-tombstones; an amended SI repoints `external_refs`
  + writes lineage. (Owner ruling #1 — full lifecycle; OD-SAR-PMO-IS-THE-UI.)
- **FR-SAR-103 (SI mirror + outstanding oracle)** — The SI mirror writes `si_number`←ERP `name`,
  `customer_id`←resolved Customer, `project_id`←resolved project, `amount`←ERP `grand_total` (oracle),
  `erp_outstanding_amount`←ERP `outstanding_amount`, `invoice_date`←`posting_date`, `reference_number`←the
  customer-PO/bill-ref field (ERP `po_no`, the customer's PO — visible in the AR-aging row, OQ-SAR-1 #6), `status` derived from `docstatus`+`status`+
  `outstanding_amount==0`, + the four `erp_*` feed columns. The `external_refs` mapping (`'revenue'` domain,
  ERP `name`) is recorded on commit. After a referenced PE-receive submit, the SI's new
  `erp_outstanding_amount=0` is mirrored (the AR twin of PI paid-detection, R9 §2).

### 5.8 Payment Entry Receive (PE-receive) write-through — the mutable-anchor money doc (C-1 verbatim)

- **FR-SAR-120 (PE-receive create + submit, two-step)** — A PMO `incoming-payment` create command maps to
  ERPNext **`Payment Entry`** with `payment_type:'Receive'`, `party_type:'Customer'`. The **frozen
  PE-receive body** (OQ-SAR-1 #3): `{payment_type:"Receive", party_type:"Customer", party, paid_amount,
  received_amount, paid_from, paid_to, references:[{reference_doctype:"Sales Invoice", reference_name,
  allocated_amount}]}` — the adapter supplies **both accounts** itself from binding config
  (`paid_from`=`default_receivable_account`/Debtors, `paid_to`=`default_cash_account`/Cash; the REST API
  defaults **neither**), sends `received_amount` **explicitly** (mandatory even same-currency), and sends
  `references[]` when paying a specific SI (an unreferenced PE-receive is a valid on-account receipt). The
  body sends no exchange rates (both auto-derive to 1.0 once the accounts are present). Two-step
  insert→submit; re-fetch the true `status` after submit (the cited SI flips `Paid`/`outstanding_amount 0`
  server-side). The idempotency key rides the outbox verbatim; the anchor is `reference_no` (FR-SAR-042).
- **FR-SAR-121 (PE-receive mirror + SI link)** — The PE-receive mirror writes `ip_number`←ERP `name`,
  `customer_id`←resolved Customer, `amount`←ERP `paid_amount` (oracle) / the per-SI `allocated_amount`
  resolved from `references[]`, `date`←`posting_date`, `reference_number`←ERP `reference_no` (also the
  anchor carrier), `status` derived, + the four `erp_*` feed columns. `sales_invoice_id` is resolved from
  the `references[]` row's `reference_name` via the SI's `external_refs` (nullable for an on-account
  receipt). The `external_refs` mapping (`'revenue'` domain, ERP `name`) is recorded on commit.
- **FR-SAR-122 (PE-receive cancel; amend desk-only)** — A submitted PE-receive may be **cancelled** through
  adapter-dispatch (riding the outbox + lineage contract). **Amend is desk-only in P3a** (mirroring P2
  OQ-7's PE-pay ruling — PE-receive amend is rare and the cancel-first path covers correction). After a
  referenced PE-receive submit, the cited SI flips `Paid`/`outstanding_amount 0` server-side (mirrored via
  FR-SAR-103). Cancelling a PE-receive referencing a SI follows chain-reverse order only where ERPNext
  enforces it. (Owner ruling #1.)
- **FR-SAR-123 (PE-receive is NEVER auto-reissued — C-1 verbatim)** — A post-window recovery of a
  PE-receive that finds **no** ERP doc (neither the `reference_no` anchor nor the composite
  `payment_type='Receive'`+Customer+amount+SI-reference conjunction) is **`held`**, terminal until an
  operator resolves it — **NEVER auto-reissued**. A blind reissue could mint a second Payment Entry
  (double-receive, the AR twin of double-pay). The `held` row is excluded from
  `outbox_reconcile_candidates` and surfaced non-silently. (ADR-0058 §4 per-kind reissue policy + C-1, applied
  verbatim to the Receive variant.)

### 5.9 Customer party (reuse) + payment_terms due-date display

- **FR-SAR-140 (Customer reuse — no new work)** — The SI + PE-receive resolve their Customer via the
  existing `companies`-domain Customer mirror (P2 FR-ENA-090..094, `customerToBody`/`customerFromDoc`
  shipped, `type='Client'`, `external_refs` `Customer:<name>` encoding). **No new Customer write or mirror
  is introduced** — the SI create does not re-create the Customer (it must pre-exist via the P2 party
  create/update path or pull-adopt); a missing Customer surfaces `commit-rejected` (bad link) at ERP.
- **FR-SAR-141 (payment_terms due-date display)** — PMO shall use the already-mirrored
  `companies.erp_payment_terms_days` (P2 FR-ENA-094) to **display** an AR due-date derivation
  (`invoice_date + erp_payment_terms_days`) in the revenue/AR views, as **read-model-derived display only**
  — PMO shall **never** author its own receivables-terms truth or override ERP's `due_date` when ERPNext
  provides one (ADR-0048). Where ERPNext's SI carries its own `due_date`, that is the oracle and
  `erp_payment_terms_days` is display-support only.

### 5.10 AR aging read-back (reuse the P2 report path — FR-ENA-160..163 apply)

- **FR-SAR-150 (AR aging — report-RPC primary, already shipped)** — The system shall provide read-only AR
  aging via the **already-shipped** `refreshAging('Accounts Receivable', 'erp_ar_aging_snapshot', …)` path
  (P2 `agingSnapshot.ts`, FR-ENA-160). The primary source is the authoritative report RPC
  `frappe.desk.query_report.run` (`Accounts Receivable`) with the binding's **version-pinned**
  `report_filter_shape` (R10 drift mitigation), mirroring the returned buckets + `range_labels` verbatim.
  (Bench-probed 2026-07-14: the AR report shape is the same as AP — the P2 `parseAgingReport` parser
  handles both.)
- **FR-SAR-151 (AR aging scope wiring)** — P3a wires the AR scope into the binding config confirmation
  (`aging_report_names` already carries `'Accounts Receivable'` per P2) and the sweep scheduling so the AR
  snapshot refreshes alongside AP (the `erpnext-sweep` cron, 0102). The Customer party (`party_type=
  'Customer'`) is the AR counterpart; the `party` filter resolves to mirrored Customers. No new snapshot
  table (0101's `erp_ar_aging_snapshot` is reused). (P2 FR-ENA-161 provenance + snapshot-replacement apply.)
- **FR-SAR-152 (constrained fallback + the prohibition, carried)** — If the AR report-shape probe fails for
  a minor, the **only** permitted fallback is bucketing **mirrored `GL Entry` / `Payment Ledger Entry` rows**
  (ERP ledger truth), version-pinned (P2 FR-ENA-162). **Invoice-only local aging math over `sales_invoices`
  (`due_date − today` on PMO rows) is PROHIBITED** — it would be PMO-authored accounting truth (ADR-0048).
- **FR-SAR-153 (AR aging is display-only — no write)** — AR aging introduces **no** sales-document or
  receivables write command beyond the SI/PE-receive write-through already in §5.7/§5.8; it is read-only
  display sourced from ERP report/ledger truth. (P2 FR-ENA-163 carried.)

### 5.11 Carried + extended invariants (P2 Finding-8 discipline, named)

- **FR-SAR-160 (carried invariants)** — The following are **preserved/extended** by P3a: (a) the P2
  byte-for-byte invariant (FR-ENA-004) — P3a's additions are additive, P2 behavior unchanged (FR-SAR-004);
  (b) the Customer party flip + `erp_payment_terms_days` mirror — **reused unchanged** (FR-SAR-140/141); (c)
  the ADR-0058 money-idempotency contract — **applied verbatim** to SI + PE-receive (FR-SAR-040..045); (d)
  the cancel/amend lineage contract — **applied verbatim** (FR-SAR-050..053); (e) the ledger-sourced-display
  rule — **carried** (FR-SAR-071/152); (f) the `*_amount_nonneg`-equivalent — `sales_invoices.amount` +
  `erp_outstanding_amount` + `incoming_payments.amount` are `numeric(14,2)` nullable, ERP nulls → SQL NULL.
- **FR-SAR-161 (the AR same-scope invariant — twin of the AP same-case invariant)** — Where a PE-receive
  `references` a SI, both shall resolve to the **same revenue scope** (the AR twin of P2's
  `payments.invoice_id` same-`procurement_id` invariant, FR-ENA-130d): `incoming_payments.sales_invoice_id`
  FK-links the SI, and the dispatch resolves it from the PE `references[]` row's `reference_name` via the
  SI's `external_refs`. A PE-receive whose referenced SI is not mirrored (or is in a different org) surfaces
  `commit-rejected`/`action-required`, never a cross-scope link. (There is no `procurement_id`-equivalent
  case folder for revenue — the SI *is* the scope anchor; the project is the rollup dimension.)

### 5.12 PMO read-model + RLS flip observables (P2 FR-ENA-170..172 mechanism)

- **FR-SAR-170 (machine-written native mirrors; flip-shaped RLS)** — While `revenue` is externally-owned for
  an org, `sales_invoices` + `incoming_payments` native mirrored columns are **machine-written only**
  (service role); user-JWT writes to native fields are RLS-denied; the per-command RLS flip mirrors
  0097–0100 (INSERT `WITH CHECK (… and not domain_externally_owned(auth_org_id(),'revenue'))` → `42501`;
  UPDATE column-pinned by a `*_native_mirror_guard` BEFORE-UPDATE trigger; DELETE `using (… and not
  domain_externally_owned(…))` → 0-row no-op when flipped). The PMO enhancement surface in P3a is minimal
  (the dispatch owns all writes today); a future PMO-native revenue path flips the domain off to open the
  INSERT (OQ-SAR-6 forward-compat). (P2 FR-ENA-170.)
- **FR-SAR-171 (trigger audit — R7 carried)** — The flip migration audits triggers so a service-role mirror
  write is not corrupted: `stamp_org_id()` overrides null/seed `org_id` only (the dispatch sets `org_id`
  explicitly — safe); the two new tables carry no `GENERATED` columns and no derived-completion trigger
  (unlike `procurement_items.amount`), so **no service-role bypass is needed** — the migration states this
  per table (§7) rather than assuming it. (P2 FR-ENA-171.)
- **FR-SAR-172 (reads serve from Supabase only)** — Reads for the revenue domain serve from the
  `sales_invoices`/`incoming_payments` read-model tables/repositories only; **no** UI/read path may
  synchronously query ERPNext (ADR-0055 §3; P2 FR-ENA-172). The AR aging view reads `erp_ar_aging_snapshot`.

### 5.13 Process gates — org-config seam (OD-SAR-GATES)

PMO is the flexible layer; ERP is strict. Process/chain gating is **org-level configuration**
(`process_gates`), **default permissive**, flipped ON only when an org's accounting demands it — and flipped
back when an edge case becomes the norm (OD-SAR-GATES). P3a ships the seam with one active gate and two
recognized-but-inert ones; the active gate is the `require_project_on_si` product default. The SO + BAST
gates are the fast-follow issue's surface (inert keys here so a future flip needs no schema change).

- **FR-SAR-190 (the `process_gates` seam — location + shape)** — The system shall expose an org-level
  `process_gates` config object. **Proposed location: `external_org_bindings.config.process_gates` (jsonb).**
  Rationale: (a) the gates only have meaning when `revenue`→`erpnext` is employed, and the binding is the
  per-org record that carries that employment + its already-cached account defaults (§4.3) — co-locating the
  gates avoids a second org-config table and keeps the whole ERP-employment surface in one row
  (OD-ENA-SHARED-BINDINGS); (b) it is **data, not schema** (a jsonb key), so it ships with no migration column
  change and flips per-org without a deploy. Shape: `{require_so_before_si: bool=false,
  require_bast_before_si: bool=false, require_project_on_si: bool=true}`. (Alternative considered + rejected:
  a separate `org_settings` table — over-engineered for P3a; revisit only if non-binding org settings
  proliferate.) Reads default permissive when the key is absent.
- **FR-SAR-191 (the three gates — P3a active vs inert)** — The seam carries three gates: **(a)
  `require_so_before_si`** — **inert in P3a** (the Sales Order is the fast-follow issue, out of P3a scope);
  the key is **recognized + persisted** so a future flip needs no schema change, but the dispatch does not
  enforce it yet. **(b) `require_bast_before_si`** — **inert in P3a** (BAST / Indonesian services handover —
  the DN-doctype-vs-document+milestone-acceptance ruling is the fast-follow issue's; recognized + persisted,
  not enforced). **(c) `require_project_on_si`** — **DEFAULT ON, relaxable** (the product goal is
  revenue-per-project, FR-SAR-101). When **ON**, an SI create/submit must carry a non-null `project_id` and
  the dispatch rejects a null-project SI at the boundary (`commit-rejected` / `project-required`); when
  **OFF**, an SI may have a null `project_id` and its revenue **rolls up as 'Unassigned'** in the
  revenue-per-project views (a bucket, never silently dropped — surfaced for later operator assignment per
  FR-SAR-085). New bindings default to `require_project_on_si=true` unless explicitly relaxed.
- **FR-SAR-192 (enforcement boundary + Admin flip)** — Gates are enforced at the **dispatch boundary**
  (the served `adapter-dispatch` reads `process_gates` from the resolved binding before constructing the SI
  command; a violated gate rejects the command **before** any ERP call — `commit-rejected` with the gate
  name) **and reflected in the UI affordances** (`can()`/`<CanWrite>` hides/disables the Submit when a gate
  is unsatisfied; ADR-0016 — UX-only, the dispatch boundary is the enforcement authority). The default state
  is **permissive** for the chain gates (SO/BAST off) with `require_project_on_si` ON; **flipping any gate
  requires Admin** (`can('manage_external_bindings', …)` — a privileged, audited config change, not a
  per-invoice toggle). A non-`revenue` org has no `process_gates` (the seam is inert — FR-SAR-004 intact).

### 5.14 Separation of duties on SI submit (ADR-0019 — the money-commitment gate)

The SI **submit** is the money-commitment step — a submitted SI books recognized revenue in the ERP GL (the
Debtors/Sales double entry posts on submit, OQ-SAR-1 #1). Per the owner ruling (OD-SAR-PMO-IS-THE-UI —
accountants work in PMO, so the approval step lives in PMO), submit is SoD-gated: **the approver must differ
from the author** (the user who submits the SI must not be the user who authored the draft). This mirrors the
procurement approver rule (ADR-0019 security-definer pattern).

- **FR-SAR-195 (SoD on SI submit — approver ≠ author, ADR-0019)** — The SI **submit** transition
  (`docstatus 0→1`) shall be gated by a **security-definer RPC** that enforces **approver ≠ author**: the
  submitting user (resolved from the JWT) must differ from the user who authored the draft (recorded on the
  draft's `created_by`/an explicit `author_user_id`). The SoD applies to **SUBMIT only** (the money
  commitment) — **draft authoring is ungated** (any authorized money-author role may create/edit a draft SI).
  The RPC follows the ADR-0019 pattern: security-definer, restrictive, **pgTAP-proven** (self-approval
  rejected with a typed `sod-self-approval` error; cross-user submit permitted), mirroring the procurement
  approver rule. The UI exposes the Submit/Approve affordance only to a user who is not the author
  (`can('submit_sales_invoice', …)` on the real JWT role + the RPC as the enforcement authority —
  NFR-SAR-SEC-003); the author sees the draft in an "awaiting approval" state. PE-receive submit is **not**
  SoD-gated in P3a (it allocates already-committed receivables; the commitment is the SI — an SoD on
  PE-receive is a future policy call if needed).

---

## 6. Non-functional requirements

- **NFR-SAR-SEC-001** — The adapter shall require **no ERP custom app** and speak only stock ERPNext/Frappe
  APIs (ADR-0055 §2). The SI/PE-receive bodies use only stock fields; the idempotency anchor reuses a stock
  text field (`remarks`/`reference_no`), no custom field (ADR-0058 §3).
- **NFR-SAR-SEC-002** — Per-org ERP credentials + webhook secrets are **server-only** (vault `AS`/function
  secrets via `secret_ref`, resolved **only** through the `erpnext/credentials.ts` seam —
  `resolveErpCredentials(secretRef, getEnv)`; OD-ENA-VAULT-SEAM: the Vault swap is a one-function change
  behind that seam). Never in browser code, never in mirrored tables, never logged (env-file-privacy rule).
- **NFR-SAR-SEC-003** — **RLS is the enforcement authority** for the revenue mirrors; the client/router
  branch + `can()`/`<CanWrite>` (ADR-0016) are UX/DX-only (P2 FR-ENA-170/NFR-ENA-SEC-003). The FE may be
  stricter than RLS; it is never weaker.
- **NFR-SAR-SEC-004** — The `revenue` flip shall preserve the `org_id` seam and ship pgTAP proofs for org
  isolation + machine-only native writes + the flip denial/allow per role (per-table, §7).
- **NFR-SAR-IDEM-001** — The idempotency contract (ADR-0058, FR-SAR-040..045) shall make duplicate SI or
  PE-receive creation **impossible** under retry-after-timeout / 429 / mirror-finalization-failure /
  concurrent-retry / lease-expiry-overlap, proven at the **real served boundary** with the
  `after-commit-before-mirror` fault seam (P2 FR-ENA-003). PE-receive's mutable-anchor `held`-on-
  inconclusive is the double-receive guard (C-1 verbatim).
- **NFR-SAR-DOC-001** — The docstatus/lineage contract (FR-SAR-050..053) shall prevent duplicate PMO
  mirrors during cancel/amend rename flows and out-of-order events for the revenue kinds (P2 NFR-ENA-DOC-001).
- **NFR-SAR-MONEY-001** — Decimal-string transport + numeric-only persistence shall eliminate JS float drift
  in revenue money mirrors; the money oracle is always the mirrored ERP header total (FR-SAR-071).
- **NFR-SAR-FEED-001** — The sweep cursor is monotonic per `(org, doctype)` and tolerant of equal-boundary
  `modified` timestamps via inclusive polling + idempotent dedupe + per-row `erp_modified` guard (P2
  NFR-ENA-FEED-001); the `payment_type` disambiguation (FR-SAR-081) does not affect cursor correctness.
- **NFR-SAR-PERF-001** — The adapter batches/pages change-feed + report calls conservatively for stock
  ERPNext worker realities, interactive commands prioritized over background sweep (P2 NFR-ENA-PERF-001).
  The AR aging refresh reuses the P2 cadence.
- **NFR-SAR-CONTRACT-001** — ERPNext/Frappe vocabulary (doctype names, `payment_type`, `remarks`,
  `reference_no`, account names) lives **solely** under `pmo-portal/src/lib/adapterSeam/erpnext/**` + the
  ERPNext webhook edge function; no code above the adapter contract names a doctype/field (P2
  NFR-ENA-CONTRACT-001). The new `revenue` domain name + `sales-invoice`/`incoming-payment` kinds are
  PMO-side verbs that cross the contract (never Frappe doctype names).
- **NFR-SAR-REV-001** — Every P3a migration is reversible (drop the new tables/columns + RLS gates +
  triggers → restore pre-P3a behavior), follows additive discipline, ships pgTAP; seed is local-only
  (`docs/environments.md`). The new tables are additive — no existing table's columns are altered (only the
  `external_org_bindings.config` jsonb grows keys, which is data not schema).
- **NFR-SAR-TEST-001** — Each AC has exactly one owning test at its lowest sufficient layer (unit / pgTAP /
  served-fn e2e). **Every money-command e2e uses the real served function boundary** (P2 FR-ENA-001) with
  the server-side fault seams (P2 FR-ENA-003) — **never `page.route`**. The money-command e2e files live in
  `pmo-portal/e2e/serial/AC-SAR-*.spec.ts` (the serial lane, same as `AC-ENA-*`), wrapped in
  `scripts/with-db-lock.sh` + the shared ERPNext-stack lock.
- **NFR-SAR-DEVBED-001** — The canonical dev/test bed is the **same** fresh stock Docker ERPNext v15 stack
  P2 uses (`frappe/erpnext:v15.94.3` at `localhost:8080`, `PMO Smoke Co`); the OQ-SAR-1 spike runs there.

---

## 7. Per-table flip enumeration (the RLS observables table)

Every table names its **native mirrored columns** (machine-written read-model of ERP fields), its
**PMO-owned columns** (enhancement — stays user-writable through the future PMO-native path), its **write
policy under flip**, its **trigger handling**, and its **pgTAP proof**. The two new tables ship the flip-
shaped RLS mirroring 0097–0100 (INSERT `WITH CHECK … not domain_externally_owned('revenue')`; UPDATE
trigger-pin; DELETE 0-row no-op) **forward-compat**: today the only writer is the service role (no PMO-native
revenue RPC exists), so the user-JWT INSERT is inert-but-allowed for a non-`revenue` org and denied for an
employing org. Both ship all four `erp_*` feed columns **from day one** (the 0103 lesson).

| Table | Native mirrored (machine-only under flip) | PMO-owned (stays user-writable via the future native path) | Trigger handling | pgTAP proof |
|---|---|---|---|---|
| **`sales_invoices`** (new) | `si_number`, `customer_id`, `reference_number`, `invoice_date`, `amount`, `erp_outstanding_amount`, `project_id` (machine-resolved), `status` (derived), `erp_docstatus`, `erp_modified`, `erp_amended_from`, `erp_cancelled_at` | *(none in P3a — the dispatch owns all writes; a future PMO-native revenue feature may add enhancement columns)* | `stamp_org_id()` (0074 pattern) overrides null/seed org only — safe; **no `GENERATED` column, no derived-completion trigger** → no service-role bypass needed (stated per FR-SAR-171); the `sales_invoices_native_mirror_guard` BEFORE-UPDATE trigger column-pins the native set while flipped | user-JWT native write denied (`42501`) while flipped; service-role write ok; org-isolated; `project_id` machine-only; INSERT/DELETE flip-gated; the four `erp_*` columns exist (day-one check) |
| **`incoming_payments`** (new) | `ip_number`, `customer_id`, `sales_invoice_id`, `reference_number` (also the anchor carrier), `date`, `amount`, `status` (derived), `erp_docstatus`, `erp_modified`, `erp_amended_from`, `erp_cancelled_at` | *(none in P3a — dispatch-owned)* | `stamp_org_id()` safe; **no `GENERATED` column, no derived-completion trigger** → no bypass needed; the `incoming_payments_native_mirror_guard` BEFORE-UPDATE trigger column-pins the native set while flipped | as above; `sales_invoice_id` FK preserved; `reference_number` machine-only (the anchor carrier); the AR same-scope invariant (FR-SAR-161) holds |

Each table ships a **reversible flip migration** (add the table + mirror columns + the per-command RLS
split + the `*_native_mirror_guard` trigger + confirm trigger safety) and its pgTAP proof file
(`supabase/tests/erpnext_sales_invoices_flip_rls.test.sql`,
`supabase/tests/erpnext_incoming_payments_flip_rls.test.sql`). The `external_org_bindings.config` jsonb
addition (receivable-side accounts, §4.3) is data, not schema — applied by the binding-resolution/onboarding
path, no migration column change. The Customer `companies` flip and `erp_ar_aging_snapshot` are **reused
unchanged** from P2 — no §7 row for them here.

---

## 8. Acceptance criteria (Given/When/Then)

> The non-ERPNext invariant (AC-SAR-001..003) and the idempotency/lineage money-safety ACs are the heart of
> P3a. **Every money-command e2e uses the real served `adapter-dispatch` boundary + a named server-side
> fault seam — NO `page.route`** (P2 Finding 13, NFR-SAR-TEST-001). Flip-RLS + org-isolation ACs are pgTAP;
> mapping/idempotency-logic/lineage/amount-shape ACs are Vitest; cross-stack money flows are served-fn e2e
> in `e2e/serial/AC-SAR-*`. Each AC is owned by exactly one test at its lowest sufficient layer (ADR-0010).

### The non-ERPNext byte-for-byte invariant (additive)

- **AC-SAR-001** — No `revenue`→`erpnext` employed ⇒ P2 procurement/parties writes are byte-for-byte
  unchanged; revenue commands are rejected. **[unit]**
  **Given** an org with no `revenue`→`erpnext` assignment (the shipped default) and any procurement/company
  write, and separately a revenue command,
  **When** each is performed,
  **Then** the procurement/company write executes through the existing direct DAL/RPC — no dispatch, no
  pending-push, identical to pre-P3a (P2 FR-ENA-004 intact); and the revenue command is rejected at the
  repository layer (`config-rejected`/`revenue-not-enabled`) with no ERP call. (FR-SAR-004, FR-SAR-005)
- **AC-SAR-002** — The P2 ERPNext acceptance suite remains green (zero regression from the additive
  `revenue` domain + 2 new kinds). **[cross-layer regression gate]**
  **Given** the `revenue` domain + the two new kinds + the two new tables are installed and no org employs
  `revenue`,
  **When** the P2 suite (Vitest + pgTAP + `e2e/serial/AC-ENA-*`) runs unchanged,
  **Then** every previously-passing P2 test still passes. (FR-SAR-004) *(Owning layer: the unchanged P2
  suite IS the proof; a meta-AC, mirrors AC-ENA-002.)*
- **AC-SAR-003** — The flip is org-scoped. **[pgTAP]**
  **Given** org A owns `revenue`→`erpnext` and org B does not,
  **When** a service-role mirror write lands in org A's `sales_invoices` and a user-JWT write is attempted
  in both orgs,
  **Then** org A's user write is denied (`42501`), org A's service write succeeds, org B's `sales_invoices`
  is empty and untouched, and org B's procurement behavior is byte-for-byte pre-P3a. (FR-SAR-004, FR-SAR-170)

### Idempotency / post-commit safety (ADR-0058 — real boundary + fault seam)

- **AC-SAR-010** — Duplicate retry cannot double-create a PE-receive (interrupted response, real boundary).
  **[served-fn e2e]**
  **Given** the served `adapter-dispatch` + stock Docker ERPNext v15, a PE-receive command with an
  `idempotencyKey`, and the server-side fault seam **`after-commit-before-mirror`** armed (ERP commit
  succeeds, function response interrupted **server-side** — no `page.route`),
  **When** the exact command is retried,
  **Then** ERPNext contains **one** Receive Payment Entry, the outbox reconciles (`pending`/`committed` →
  `confirmed` via the `reference_no`-anchor or composite probe), PMO holds **one** `incoming_payments`
  mirror row, and no duplicate is created. (FR-SAR-040..045, NFR-SAR-IDEM-001)
- **AC-SAR-011** — SI create retry-after-post-commit-mirror-failure adopts the existing SI (no duplicate).
  **[served-fn e2e]**
  **Given** a SI command whose ERP create committed but the outbox is left `pending`/`committed` (fault
  `after-commit-before-mirror`),
  **When** the sweep or a retry runs,
  **Then** it adopts the existing ERP SI (via `committed` fenced-finalize or the `remarks`-key probe) and
  finishes one `sales_invoices` mirror row — never minting a second. (FR-SAR-045)
- **AC-SAR-012** — The outbox unique key rejects a concurrent duplicate revenue command atomically.
  **[pgTAP]**
  **Given** an `external_command_outbox` row for `(org, 'revenue', pmo_record_id, idempotency_key)`,
  **When** a second insert of the **same** key is attempted,
  **Then** it is rejected by `unique (org_id, domain, pmo_record_id, idempotency_key)` (`23505`). (FR-SAR-041)
- **AC-SAR-013** — PE-receive post-window inconclusive recovery is HELD, never auto-reissued (C-1 verbatim).
  **[unit]**
  **Given** a quarantined PE-receive outbox row past its `reconcile_after` window whose composite probe
  (`payment_type='Receive'` + Customer + amount + SI-reference + creation window) returns 0 or >1 matches,
  **When** the recovery path runs,
  **Then** the row transitions to **`held`** (terminal, excluded from `outbox_reconcile_candidates`), a retry
  surfaces the non-retryable `command-held`, and **no second Payment Entry is ever created** (no reissue).
  (FR-SAR-042, FR-SAR-123, ADR-0058 §4 C-1)
- **AC-SAR-014** — The `payment_type` discriminator prevents cross-kind probe/recovery contamination.
  **[unit]**
  **Given** a PE-pay and a PE-receive with the same Customer/amount and the composite probe inputs,
  **When** `probeErpByPaymentComposite` runs for each with its `payment_type`,
  **Then** the PE-receive probe filters `payment_type='Receive'` and cannot adopt the PE-pay (and vice-versa),
  so a recovery never cross-links an AP payment to an AR receipt. (FR-SAR-083)

### Cancel / amend / lineage

- **AC-SAR-020** — SI/PE-receive cancel soft-tombstones the mirror and keeps lineage. **[unit]**
  **Given** a submitted ERPNext SI (and separately a PE-receive) that is cancelled (`docstatus 2`),
  **When** the feed applies the cancel,
  **Then** the mirror row is soft-tombstoned (`erp_cancelled_at`, `erp_docstatus=2`, hidden from active
  views), its `external_refs` mapping is retained, and an `external_ref_lineage` (`reason='cancelled'`) row
  is written. (FR-SAR-052)
- **AC-SAR-021** — SI cancel+amend rename reconciles to one mirror via `amended_from`. **[unit]**
  **Given** a submitted SI cancelled and amended into a **new** ERP `name` (`amended_from`=old),
  **When** the feed applies the amended document,
  **Then** `external_refs` for the same `pmo_record_id` **repoints** to the new `name`, `erp_amended_from`
  is stamped, a lineage (`reason='amended'`) row is written, and **no** duplicate mirror row is minted.
  (FR-SAR-053, NFR-SAR-DOC-001)
- **AC-SAR-022** — Cancel of a referenced SI is NOT hard-blocked by an active PE-receive (AR delta); the
  mirror reconciles the auto-unlink, PE-receive-first is policy. **[unit]**
  **Given** a submitted SI with a submitted PE-receive referencing it,
  **When** the adapter cancels the SI (whether PE-receive-first per policy, or SI-first per an operator
  action),
  **Then** ERPNext cancels the SI and **auto-un-links** the PE-receive's `references` (200, NOT a
  `LinkExistsError` block — the AR delta from procurement, OQ-SAR-1 #8), the SI mirror is tombstoned, the
  PE-receive mirror's `sales_invoice_id` is re-derived to null (it becomes on-account, keeping its money/GL
  impact), and the adapter's default ordering remains PE-receive-first. (FR-SAR-051, FR-SAR-102)

### Amount transport / mirror-write shape

- **AC-SAR-030** — Decimal strings round-trip SI total + outstanding without float drift. **[unit]**
  **Given** an ERPNext SI with cents-bearing `grand_total` + `outstanding_amount`,
  **When** they cross the adapter as decimal strings and mirror into PMO numerics,
  **Then** `sales_invoices.amount` = ERP `grand_total` exactly, `erp_outstanding_amount` = ERP
  `outstanding_amount` exactly, no JS float artifact, and the header total is the money oracle. (FR-SAR-070,
  FR-SAR-071, NFR-SAR-MONEY-001)
- **AC-SAR-031** — PE-receive `paid_amount`/`allocated_amount` round-trips into `incoming_payments.amount`;
  nulls/over-scale handled. **[unit]**
  **Given** a PE-receive with a decimal `paid_amount` + reference `allocated_amount`, and separately an
  absent optional money field and an over-`numeric(14,2)` value,
  **When** the adapter mirrors them,
  **Then** `incoming_payments.amount` = the ERP figure exactly, an absent optional maps to SQL `NULL` (not
  `0`), and the over-scale value is classified `commit-rejected` rather than truncated. (FR-SAR-070,
  FR-SAR-072)

### Sales Invoice + project linkage + PE-receive (real boundary — OQ-SAR-1 spike frozen first)

- **AC-SAR-040** — SI create + submit write-through succeeds across the real boundary and links the project.
  **[served-fn e2e]**
  **Given** the OQ-SAR-1 spike is frozen (binding receivable-side accounts resolved, body map pinned), a
  mirrored Customer, and a PMO project,
  **When** the user creates + submits a Sales Invoice through the served boundary,
  **Then** ERPNext commits the SI (two-step insert→submit), `sales_invoices` mirrors it (`si_number`←ERP
  name, `customer_id`←Customer, `amount`←`grand_total`, `erp_outstanding_amount`←`outstanding_amount`,
  `project_id`←the PMO project), the `external_refs` mapping (`'revenue'`) is recorded, the ERP-side project
  dimension is stamped, and no `page.route` is used. (FR-SAR-100, FR-SAR-101, FR-SAR-103)
- **AC-SAR-041** — PE-receive create + submit write-through succeeds; the referenced SI flips Paid.
  **[served-fn e2e]**
  **Given** a mirrored, submitted SI with a non-zero `erp_outstanding_amount` and the binding's receivable/
  cash accounts,
  **When** the user creates + submits a PE-receive (adapter supplies `paid_from`=receivable,
  `paid_to`=cash, `received_amount` explicit, `references[]` to the SI) through the served boundary,
  **Then** ERPNext commits the Receive Payment Entry, PMO mirrors `incoming_payments` (`amount`=paid_amount,
  `sales_invoice_id`→the SI, `reference_number`=the anchor carrier), and the SI flips `Paid`/
  `erp_outstanding_amount=0` server-side (mirrored). (FR-SAR-120, FR-SAR-121, FR-SAR-122, FR-SAR-161)
- **AC-SAR-042** — SI cancel + amend reconciles to one mirror across the real boundary. **[served-fn e2e]**
  **Given** a submitted SI,
  **When** the user cancels then amends it through the served boundary,
  **Then** the cancel soft-tombstones, the amend repoints `external_refs` to the new `name` + writes
  lineage, and PMO holds exactly one live `sales_invoices` row for the `pmo_record_id`. (FR-SAR-050,
  FR-SAR-052, FR-SAR-053)
- **AC-SAR-043** — Inbound natively-created SI mints a mirror with `project_id=NULL` and surfaces
  operator assignment. **[served-fn e2e]**
  **Given** a SI created natively in ERPNext (no PMO command) and an inbound webhook/sweep event,
  **When** the feed applies it,
  **Then** a `sales_invoices` mirror row is minted with `project_id=NULL` + an `action-required` operator
  task to assign the project; the webhook acks, the sweep re-surfaces it; no project is auto-assigned.
  (FR-SAR-085)

### AR aging read-back (reuse the P2 path)

- **AC-SAR-050** — AR aging snapshot comes from the report truth with pinned filters + provenance;
  invoice-only math is absent. **[served-fn e2e]**
  **Given** an ERPNext org owning `revenue` with open AR entries and the aging-report binding configured,
  **When** PMO refreshes AR aging through the served boundary,
  **Then** `erp_ar_aging_snapshot` stores report-backed buckets verbatim with `report_date`/`range_labels`/
  `ageing_based_on`/`as_of`/`report_version`, snapshot-replaced per scope, and **no** bucket is computed by
  invoice-only local math over `sales_invoices`. (FR-SAR-150, FR-SAR-151, FR-SAR-152; P2 AC-ENA-061 carried)
- **AC-SAR-051** — Customer `payment_terms` due-date display derives from the mirror, read-only.
  **[unit]**
  **Given** a mirrored Customer with `erp_payment_terms_days` and a mirrored SI with `invoice_date`,
  **When** the AR view derives a display due-date,
  **Then** it is `invoice_date + erp_payment_terms_days` (or ERP's own `due_date` when ERPNext provides
  one) as read-only display, and PMO never writes receivables-terms truth. (FR-SAR-141)

### Change-feed + RLS

- **AC-SAR-060** — Payment-Entry inbound event routes by `payment_type` to the correct mirror. **[unit]**
  **Given** an inbound Payment Entry event with `payment_type='Receive'` (and separately `'Pay'`),
  **When** the feed routes it,
  **Then** the Receive event mirrors into `incoming_payments` (`incoming-payment` kind, `'revenue'` domain)
  and the Pay event into `payments` (`payment` kind, `'procurement'` domain) — never cross-routed.
  (FR-SAR-081)
- **AC-SAR-061** — Flipped native mirror writes are machine-only; the four feed columns exist day one.
  **[pgTAP]**
  **Given** an org with `revenue` externally-owned,
  **When** a user JWT writes a native mirrored field (`sales_invoices.amount`, `incoming_payments.amount`,
  `sales_invoices.project_id`),
  **Then** RLS denies it (`42501`); **and when** the service role writes the mirror, it succeeds; **and**
  `information_schema.columns` confirms `erp_docstatus`/`erp_modified`/`erp_amended_from`/`erp_cancelled_at`
  exist on both tables. (FR-SAR-170, FR-SAR-171, NFR-SAR-SEC-003/004)
- **AC-SAR-062** — Webhook signature is the trust boundary for the new kinds. **[unit]**
  **Given** an inbound ERPNext webhook for a SI or PE-receive,
  **When** `X-Frappe-Webhook-Signature` is invalid/absent vs valid,
  **Then** invalid/absent → `401`, no side effect; valid → applied as a hint. (FR-SAR-084)

### Process gates (org-config — OD-SAR-GATES)

- **AC-SAR-070** — `require_project_on_si` ON blocks a null-project SI at the dispatch boundary. **[unit]**
  **Given** an org employing `revenue`→`erpnext` with `process_gates.require_project_on_si = true` and an SI
  command carrying a null `project_id`,
  **When** the dispatch resolves the command,
  **Then** it is rejected `commit-rejected` / `project-required` **before** any ERP call, the UI Submit
  affordance is disabled for a project-less SI (`can()`), and no `external_command_outbox` row is created.
  (FR-SAR-191, FR-SAR-192)
- **AC-SAR-071** — `require_project_on_si` OFF permits a null-project SI that rolls up as 'Unassigned'.
  **[served-fn e2e]**
  **Given** an org with `process_gates.require_project_on_si = false` (Admin-relaxed) and an SI command with
  a null `project_id`,
  **When** the user creates + submits the SI through the served boundary,
  **Then** ERP commits the SI (project-less), the `sales_invoices` mirror row has `project_id = NULL`, and
  the revenue-per-project view rolls it up under the **'Unassigned'** bucket (never silently dropped).
  (FR-SAR-191)
- **AC-SAR-072** — Gate defaults + Admin-only flip. **[pgTAP]**
  **Given** a freshly-employed `revenue` binding (no explicit `process_gates`) and a non-Admin user,
  **When** the binding is read and a non-Admin attempts to flip a gate,
  **Then** the defaults hold (`require_so_before_si=false`, `require_bast_before_si=false`,
  `require_project_on_si=true`) and the non-Admin flip is denied (only `can('manage_external_bindings')` may
  flip); a non-`revenue` org has no `process_gates` key. (FR-SAR-190, FR-SAR-192)

### Separation of duties on SI submit (ADR-0019)

- **AC-SAR-073** — SoD RPC blocks self-approval of an SI submit; permits cross-user. **[pgTAP]**
  **Given** a draft SI authored by user A and the security-definer SoD RPC,
  **When** user A submits it (self-approval) and separately user B submits it,
  **Then** user A's submit is rejected with the typed `sod-self-approval` error (no `docstatus` change, no
  ERP call), and user B's submit succeeds (approver ≠ author). Draft authoring by A is ungated (the SoD
  applies to submit, the money commitment, only). (FR-SAR-195, ADR-0019)

---

## 9. Traceability

| AC | Requirement(s) | Owning layer | Planned proof |
|---|---|---|---|
| AC-SAR-001 | FR-SAR-004, FR-SAR-005 | Vitest (unit) | `pmo-portal/src/lib/repositories/revenue.external.test.ts` |
| AC-SAR-002 | FR-SAR-004 | **Cross-layer regression gate** — the unchanged P2 suite (`npm run verify` + pgTAP + `e2e/serial/AC-ENA-*`) staying green IS the proof (mirrors AC-ENA-002) |
| AC-SAR-003 | FR-SAR-004, FR-SAR-170 | pgTAP | `supabase/tests/erpnext_sales_invoices_flip_rls.test.sql` |
| AC-SAR-010 | FR-SAR-040..045, NFR-SAR-IDEM-001 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-010-pe-receive-idempotency.spec.ts` |
| AC-SAR-011 | FR-SAR-045 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-011-si-recovery-adopt.spec.ts` |
| AC-SAR-012 | FR-SAR-041 | pgTAP | `supabase/tests/external_command_outbox_rls.test.sql` (extend the P2 file for the `'revenue'` domain) |
| AC-SAR-013 | FR-SAR-042, FR-SAR-123 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.test.ts` (extend for Receive + held) |
| AC-SAR-014 | FR-SAR-083 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.test.ts` |
| AC-SAR-020 | FR-SAR-052 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` (extend for revenue kinds) |
| AC-SAR-021 | FR-SAR-053, NFR-SAR-DOC-001 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` |
| AC-SAR-022 | FR-SAR-051, FR-SAR-102 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` (extend for SI/PE-receive cancel; assert the auto-unlink reconcile, NOT a `LinkExistsError`) |
| AC-SAR-030 | FR-SAR-070, FR-SAR-071, NFR-SAR-MONEY-001 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (extend for SI) |
| AC-SAR-031 | FR-SAR-070, FR-SAR-072 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (extend for PE-receive) |
| AC-SAR-040 | FR-SAR-100, FR-SAR-101, FR-SAR-103 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-040-sales-invoice.spec.ts` *(spike-frozen gate)* |
| AC-SAR-041 | FR-SAR-120..122, FR-SAR-161 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-041-pe-receive.spec.ts` *(spike-frozen gate)* |
| AC-SAR-042 | FR-SAR-050, FR-SAR-052, FR-SAR-053 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-042-si-cancel-amend.spec.ts` |
| AC-SAR-043 | FR-SAR-085 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-043-inbound-si-adopt.spec.ts` |
| AC-SAR-050 | FR-SAR-150..152 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-050-ar-aging-readback.spec.ts` |
| AC-SAR-051 | FR-SAR-141 | Vitest (unit) | `pmo-portal/src/lib/repositories/revenueDisplay.test.ts` |
| AC-SAR-060 | FR-SAR-081 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.test.ts` (extend for Payment Entry disambiguation) |
| AC-SAR-061 | FR-SAR-170, FR-SAR-171, NFR-SAR-SEC-003/004 | pgTAP | `supabase/tests/erpnext_sales_invoices_flip_rls.test.sql` + `erpnext_incoming_payments_flip_rls.test.sql` |
| AC-SAR-062 | FR-SAR-084 | Vitest (unit) | `supabase/functions/erpnext-webhook/index.test.ts` (extend for revenue kinds) |
| AC-SAR-070 | FR-SAR-191, FR-SAR-192 | Vitest (unit) | `pmo-portal/src/lib/repositories/revenue.external.test.ts` (gate-ON blocks null-project SI at the boundary) |
| AC-SAR-071 | FR-SAR-191 | served-fn e2e | `pmo-portal/e2e/serial/AC-SAR-071-gate-off-unassigned.spec.ts` |
| AC-SAR-072 | FR-SAR-190, FR-SAR-192 | pgTAP | `supabase/tests/process_gates_defaults.test.sql` (defaults + Admin-only flip) |
| AC-SAR-073 | FR-SAR-195, ADR-0019 | pgTAP | `supabase/tests/si_submit_sod.test.sql` (security-definer RPC: self-approval rejected, cross-user permitted) |

> NFR-SAR-SEC-001/002, CONTRACT-001, PERF-001, REV-001, DEVBED-001 are structural — proven transitively
> (no-custom-app + secret-confinement via `credentials.ts` + vocabulary-confinement + reversibility are
> preconditions exercised by the rows above) and reviewed at the plan/gate. NFR-SAR-IDEM-001 / DOC-001 /
> MONEY-001 / FEED-001 are owned by AC-SAR-010/013/014, AC-SAR-021/022, AC-SAR-030/031, AC-SAR-060
> respectively. AC-SAR-002 is a regression-gate meta-AC (mirrors AC-ENA-002). **AC-SAR-040/041 are
> spike-frozen gates** — they are now **unblocked** (the OQ-SAR-1 spike froze the SI/PE-receive body map on
> 2026-07-14).

---

## 10. Error handling

| Condition | Classification | Required behavior |
|---|---|---|
| ERP validation rejection on SI/PE-receive (`MandatoryError`/`ValidationError`/`InvalidQtyError`) | `commit-rejected` | Parse `exc_type` then `_server_messages`; surface ERP message; no mirror mutation before ERP truth changes (P2 FR-ENA-013) |
| Empty/missing `items` on a SI → `500 TypeError` (**confirmed — OQ-SAR-1 #7**, same shape as PI) | `commit-rejected` (non-retryable) | Client pre-validates non-empty items; distinct non-retryable bucket — never blind-retried (FR-SAR-014/044) |
| Bad Customer link (`DoesNotExistError` / 404) | `commit-rejected` | Resolve Customer via `external_refs` (`Customer:<name>`); never a raw client id (FR-SAR-140) |
| ERP unreachable / timeout / 5xx-after-budget | `external-unreachable` | Fail honestly; preserve read-model; retry only through the guarded idempotency flow (FR-SAR-044) |
| Retry after post-commit mirror failure | guarded reconcile | Reconcile/adopt via outbox `committed`/anchor-or-composite probe; never re-create the money doc (FR-SAR-045) |
| Duplicate `idempotency_key` (concurrent revenue command) | `23505` (outbox unique) | One command proceeds; the loser reconciles to the winner's result (FR-SAR-041) |
| `UpdateAfterSubmitError` on a submitted SI/PE-receive | route to transition | Issue cancel+amend (SI) / cancel (PE-receive desk-only amend), never illegal write-after-submit (FR-SAR-050) |
| Cancel of a referenced SI while its PE-receive is active | **200 / auto-unlink (NOT a block)** | ERPNext auto-un-links the PE-receive's `references` and cancels the SI (AR delta — OQ-SAR-1 #8); the PE-receive becomes on-account, keeping its money/GL impact. Re-mirror: SI tombstoned, `incoming_payments.sales_invoice_id`→null. PE-receive-first remains policy (FR-SAR-051) |
| Cancel blocked by a linked submitted doc (`LinkExistsError`) | `commit-rejected` | Procurement-chain behavior — does **NOT** occur on the SI side (SI cancel is not hard-blocked). Other submittable links may still surface `LinkExistsError`; surface the blocking doc honestly (FR-SAR-051) |
| PE-receive post-window inconclusive recovery (no/ambiguous composite hit) | `command-held` (non-retryable) | Transition to `held`; **never auto-reissue** (double-receive guard, C-1) (FR-SAR-042/123) |
| Over-`numeric(14,2)` header total | `commit-rejected` (config) | Reject, never truncate (FR-SAR-072) |
| Invalid webhook signature | `401` / no side effect | Reject as untrusted (FR-SAR-084) |
| Out-of-order older `modified` event | no-op | Per-row `erp_modified` `>=` guard (FR-SAR-053/080) |
| Inbound SI with no project link | `action-required` | Mint mirror with `project_id=NULL`; surface operator task; never auto-assign (FR-SAR-085) |
| Revenue command for a non-`revenue` org | `config-rejected` / `revenue-not-enabled` | Reject at the repository layer; no ERP call (FR-SAR-005) |

---

## 11. Implementation TODO checklist

- [x] **OQ-SAR-1 spike (DONE — 2026-07-14):** the live-bench mandatory-field ladder ran against the stock
      Docker v15 bed; output frozen in `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md §R9-P3a spike` (file the
      `docs/spikes/YYYY-MM-DD-erpnext-si-pe-receive-fields.md` copy at plan time). Answers: SI body
      `{customer, items:[{item_code,qty,rate}]}` (accounts auto-derived — send neither); SI anchor `remarks`
      (immutable); PE-receive body incl. both adapter-supplied accounts + `received_amount`; PE-receive
      anchor `reference_no` (mutable); `project` field propagates to both GL legs (NOT `cost_center`); AR
      aging = AP shape (strip totals row); empty-`items` = 500 TypeError (pre-validate); SI cancel NOT
      hard-blocked (auto-unlinks). See §3 OQ-SAR-1.
- [ ] Registry: add the `revenue` domain (`ERPNEXT_REVENUE_DOMAIN`) + capability-map entry + the two
      `DOCTYPE_REGISTRY` kinds (`sales-invoice`: `remarks`/immutable; `incoming-payment`:
      `reference_no`/mutable) + the two `DOCTYPE_BODIES` pairs from the spike (additive, no fork).
- [ ] Storage: `sales_invoices` + `incoming_payments` tables (org seam + `stamp_org_id` + the four `erp_*`
      feed columns day-one) + the per-command RLS flip (mirror 0097–0100) + the `*_native_mirror_guard`
      triggers + pgTAP — reversible migrations `≥ 0104`.
- [ ] readModelWriters: register the `revenue` writer (SI → `sales_invoices` resolving customer+project;
      PE-receive → `incoming_payments` resolving customer+SI); extend `feedKinds.ts`
      (`revenue`/`sales_invoices`/`incoming_payments` + the Payment-Entry `payment_type` disambiguation).
- [ ] recoveryProbe: add `paymentType` to `ErpPaymentCompositeInput` + the filter set (FR-SAR-083); confirm
      the PE-receive composite cites `reference_doctype:'Sales Invoice'`.
- [ ] Outbox/idempotency: confirm the ADR-0058 algorithm serves `'revenue'` verbatim (no code change beyond
      the domain routing); verify `held`-on-inconclusive for `incoming-payment` (C-1).
- [ ] Transition/lineage: SI submit/cancel/amend + PE-receive submit/cancel; chain-reverse cancel; amend
      repoint + `external_ref_lineage`; out-of-order `erp_modified` guard (extend the P2 modules for the new
      kinds).
- [ ] Customer reuse: confirm SI/PE-receive resolve the Customer via `external_refs` (`Customer:<name>`);
      payment_terms due-date display (FR-SAR-141).
- [ ] AR aging wiring: confirm the bench-probed AR report shape; wire the AR scope into binding config +
      the `erpnext-sweep` scheduling (0102); no new snapshot table (reuse 0101).
- [ ] Inbound feed: extend `erpnextFeedDeps.ts` for `revenue` kinds (lifecycle stamp + adopt +
      `action-required` on project-less SI); webhook HMAC unchanged.
- [ ] Process gates (OD-SAR-GATES): add `external_org_bindings.config.process_gates` (jsonb key, no schema
      change) with `require_so_before_si`/`require_bast_before_si` inert + `require_project_on_si` default
      ON; enforce at the dispatch boundary + reflect in the UI; Admin-only flip (FR-SAR-190..192,
      AC-SAR-070..072).
- [ ] SoD on SI submit (ADR-0019): security-definer RPC enforcing approver≠author on the SI submit
      (`docstatus 0→1`) only; pgTAP self-approval-rejected proof; UI submit/approve affordance hidden from
      the author (FR-SAR-195, AC-SAR-073).
- [ ] Verification: `npm run verify` (incl. AC-SAR-002 regression net) + `scripts/with-db-lock.sh supabase
      test db` + served-fn e2e (`e2e/serial/AC-SAR-*`) against the Docker v15 bed. (AC-SAR-040/041 are now
      unblocked — the OQ-SAR-1 spike is frozen.)

---

## 12. Explicit residual risks

- **R-IDEM (carried from P2 R1/R3)** accepted only with the ADR-0058 contract applied verbatim to SI +
  PE-receive, proven at the real served boundary with the `after-commit-before-mirror` fault seam
  (AC-SAR-010/011). **PE-receive's mutable anchor is the sharpest edge** — the `held`-on-inconclusive
  policy (C-1) is the double-receive guard; no build ships PE-receive writes without it (AC-SAR-013).
- **R-SPIKE (OQ-SAR-1) — RESOLVED (2026-07-14).** The R9-P3a spike froze the SI + PE-receive body maps; the
  fallback risks did not materialize (SI `remarks` survives — anchors confirmed as drafted; the
  `project`-not-`cost_center` finding is captured in FR-SAR-101). AC-SAR-040/041 are unblocked. **New
  residual:** the SI-cancel-is-not-blocked delta (OQ-SAR-1 #8) means the cancel/lineage logic must not assume
  a `LinkExistsError` on the SI side — mitigated by the rewritten FR-SAR-051 + AC-SAR-022.
- **R-GATES (FR-SAR-190..192)** — new surface; risk is a gate mis-default (e.g. `require_project_on_si`
  shipping OFF would silently lose revenue-per-project). Mitigated by default-ON + AC-SAR-072 (defaults +
  Admin-only flip pgTAP) + dispatch-boundary enforcement before any ERP call (AC-SAR-070).
- **R-SOD (FR-SAR-195)** — the SoD RPC is a new authority; risk is a bypass (submit reaching ERP without the
  RPC). Mitigated by the ADR-0019 security-definer pattern + AC-SAR-073 (pgTAP self-approval rejected); the UI
  affordance is UX-only, the RPC is the enforcement authority (NFR-SAR-SEC-003).
- **R-DISAMBIG (FR-SAR-081/083)** — one Payment Entry doctype, two PMO kinds; a missed `payment_type`
  disambiguation would cross-route an AP payment into `incoming_payments` (or vice-versa). Mitigated by the
  feed disambiguation (FR-SAR-081) + the composite-probe `payment_type` discriminator (FR-SAR-083), both
  test-proven (AC-SAR-014/060).
- **R-PROJECT (FR-SAR-101/085)** — revenue-per-project depends on the ERP project/cost-center dimension
  (OQ-SAR-1 sub-question). A natively-created SI has no PMO project link and surfaces for operator
  assignment (FR-SAR-085) — never silently dropped or auto-assigned to the wrong project.
- **R-INVARIANT (FR-SAR-004)** — P3a is additive; the risk is the registry/wiring additions perturbing P2.
  Mitigated by AC-SAR-002 (the unchanged P2 suite IS the regression gate).
- **R10 (aging report-filter drift, carried from P2)** — mitigated by version-pinned filters (P2) with the
  ADR-0048-constrained mirrored-ledger fallback (FR-SAR-152).

---

## 13. Out-of-scope reminders for implementation

- Do not add Quotation / Sales Order / Delivery Note writes (FR-SAR-180 deferred; PMO pipeline owns
  presales).
- Do not build a PMO-native sales-invoice minting RPC/UI (OQ-SAR-6 deferred; the tables are flip-shaped for
  forward-compat only).
- Do not diverge from the OQ-SAR-1 frozen SI/PE-receive body maps (the R9-P3a spike output, §3) — the
  adapter sends neither `debit_to` nor `items[].income_account` (both server-derived), and must supply both
  PE-receive accounts + `received_amount`.
- Do not build the SO/BAST gates in P3a — they are inert config keys only (the fast-follow issue owns them);
  ship the `process_gates` seam with `require_project_on_si` active and the other two recognized-but-inert
  (FR-SAR-191).
- Do not assume a `LinkExistsError` on SI cancel — ERP auto-unlinks an active PE-receive (the AR delta,
  OQ-SAR-1 #8); cancel PE-receive-first as policy, but tolerate the unlinked state (FR-SAR-051).
- Do not design around a required ERP helper app (ADR-0055 §2).
- Do not recompute ERP accounting truth locally (money oracle = mirrored ERP header/ledger; invoice-only
  AR-aging math prohibited — FR-SAR-152).
- Do not hard-delete a revenue money document (cancel-only + soft-tombstone — stock REST enforces it, P2
  OQ-8).
- Do not auto-reissue a PE-receive on inconclusive recovery (C-1 — double-receive guard, FR-SAR-123).
- Do not thread `org_id` from the client or send ERP vocabulary above the adapter contract
  (NFR-SAR-CONTRACT-001).
- Do not use `page.route` in a money-command e2e — use the served boundary + server-side fault seams
  (NFR-SAR-TEST-001).
- Do not add a new Customer write path — reuse P2's (FR-SAR-140).

---

## 14. Owner sign-off — RESOLVED rulings (2026-07-14 rediscussion)

> The six sign-off questions are **all decided** (2026-07-14 rediscussion). The new owner rulings are
> **OD-SAR-GATES** (process-gating seam, §5.13) and **OD-SAR-PMO-IS-THE-UI** (the accountant's UI is PMO,
> §5.14/§14-SIGN-6); the R9-P3a spike froze OQ-SAR-1. There are **no remaining open questions** blocking
> plan sign-off.

### OQ-SAR-SIGN-1 — Chain scope — RESOLVED: SI + PE-receive + the gating seam; SO/BAST fast-follow.
**Ruling:** the P3a chain is **Sales Invoice + Payment Entry (Receive)** with the **process-gating seam
(`process_gates`, FR-SAR-190..192)** so an org can later require a Sales Order / BAST before an SI without a
schema change. **No Quotation/Sales Order/Delivery Note writes in P3a**; SO + BAST are a **fast-follow
issue** (the SO↔contract linkage + the BAST DN-doctype-vs-milestone ruling are that issue's, not P3a's).
SO↔contract linkage stays deferred (FR-SAR-180). *(OD-SAR-GATES.)*

### OQ-SAR-SIGN-2 — PE-receive mutable-anchor / `held` policy — RESOLVED: held, never auto-reissued.
**Ruling:** PE-receive is a mutable-anchor money doc exactly like PE-pay; composite probe,
`held`-on-inconclusive, **NEVER auto-reissued** (double-receive guard). **Live-bench-confirmed** by the
R9-P3a spike (`reference_no` survives submit; `remarks` clobbered — OQ-SAR-1 #4/OQ-SAR-3). AC-SAR-013 is the
gate.

### OQ-SAR-SIGN-3 — Tables ship flip-shaped — RESOLVED: the per-command RLS flip (0097–0100).
**Ruling:** the two new tables ship the **per-command RLS flip** mirroring 0097–0100 (forward-compat for a
future PMO-native revenue path, OQ-SAR-6). Today the only writer is the service role; the user-JWT INSERT is
flip-gated. (FR-SAR-170, §7.)

### OQ-SAR-SIGN-4 — SI lifecycle — RESOLVED: full cancel/amend; the accountant's UI is PMO.
**Ruling:** SI gets the **full cancel/amend lifecycle** (OD-SAR-PMO-IS-THE-UI — accountants author and
correct in PMO; ERPNext is the headless ledger engine, so the in-app correction path is required).
PE-receive is cancel-only (amend desk-only, mirroring OQ-7). AC-SAR-042 is the amend gate.

### OQ-SAR-SIGN-5 — Revenue-per-project — RESOLVED: `project_id` required-by-default via the gate.
**Ruling:** every PMO-authored SI carries a `project_id`; revenue-per-project is a first-class product view.
The ERP dimension is the SI **`project` field** (propagates to both GL legs — NOT `cost_center`; frozen by
OQ-SAR-1 #5, FR-SAR-101). The `require_project_on_si` gate (FR-SAR-191) makes it **required-by-default**,
**relaxable** to null (rolling up as 'Unassigned') for documented edge cases.

### OQ-SAR-SIGN-6 — Authorization + SoD — RESOLVED: flip-shaped RLS + SoD on SI submit.
**Ruling:** the flip-shaped RLS is the enforcement authority (OQ-SAR-SIGN-3); the coarse money-author role
set gates SI/PE-receive via `can()` (ADR-0016). **Plus — new owner ruling — an SoD: SI submit requires
approver ≠ author**, enforced by a **security-definer RPC** (ADR-0019, mirroring the procurement approver
rule), **pgTAP-proven** (FR-SAR-195, AC-SAR-073), with the **approval affordance in the UI**. The SoD applies
to **SUBMIT (the money commitment)**, **not** draft authoring.

SPEC-DONE
