# Spec: ERPNext adapter — money core (Issue P2 — ADR-0055 P2 phase)

> **Status:** Draft for owner sign-off (major expansion round 2026-07-11 — resolves the adversarial-review
> REJECT: 6 Critical / 7 Important). Spec-complete for a full-chain money adapter.
>
> **Authority / grounds:** ADR-0055 §§1–8 (binding architecture; SoT-by-domain + additive-enhancement +
> synchronous write-through + capability map), ADR-0048 (standing: ERPNext as accounting engine, no
> homegrown ledger, **ledger-sourced-display rule** — PMO never recomputes externally-read figures),
> the shipped **P0 seam** (`docs/specs/external-adapter-seam.spec.md`; migrations 0087–0090; contract
> `pmo-portal/src/lib/adapterSeam/contract.ts`), the shipped **P1 ClickUp adapter**
> (`docs/specs/clickup-adapter.spec.md`; the change-feed engine + tombstone + atomic-adopt patterns this
> reuses), the **live R9 spike** `docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md` (now the frozen
> ground truth for PI/PE/PO/GR mappings — R9 RESOLVED), the **intake synthesis**
> `docs/spikes/2026-07-11-p2-intake-research.md` (risks R1–R13 + slice map are binding inputs),
> `docs/glossary.md` §Integration (terms used **exactly**: SoT, externally-owned domain, PMO-owned domain,
> enhancement, read-model, capability map, adapter, adapter contract, external tier), and the house
> conventions (EARS + `FR-ENA-`/`NFR-ENA-`/`AC-ENA-` ids; Given/When/Then; ADR-0010 test-pyramid
> traceability). The **real procurement + parties schema** (migrations 0001/0006/0012/0030/0035/0037/
> 0039/0040/0041/0051/0057/0058/0072/0074; DAL `src/lib/db/procurement*.ts`, `companies.ts`, `contacts.ts`)
> is cited by exact column name throughout — this spec conforms to the shipped schema, never invents it.
>
> **Owner intake rulings (binding, unchanged):** full procurement chain in **one P2** (parties +
> PR/RFQ/SQ/PO/GR/PI/Payment flip + AP commands + actuals/AP-AR aging read-back); dev bed = a **fresh
> stock Docker ERPNext v15** instance (the R9 bench: `frappe/erpnext:v15.94.3`, site `frontend` at
> **`http://localhost:8080`**, no custom apps); **served-edge-function e2e is slice zero** and every
> money-command e2e exercises the **real served `adapter-dispatch` boundary** (never `page.route`); no
> deadline.
>
> **Scope (locked, Director):** (a) one **`erpnext` adapter** speaking stock Frappe/ERPNext REST only,
> owning multiple PMO domains via an internal doctype registry; (b) a per-org **binding + credential**
> table (OQ-6); (c) the **money-idempotency contract extension + durable outbox** (R1/R3); (d) first-class
> **submit/cancel/amend transition + lineage** handling (R2); (e) **decimal-string amount transport** +
> numeric-only persistence (R4); (f) the **parties flip** (`companies`/`contacts` ↔ Supplier/Customer/
> Contact) with pull-adopt; (g) the **`procurement` domain flip** (one domain, seven ERP doctypes) over
> the real record tables; (h) **actuals + AP/AR aging** read-only snapshots (ADR-0048 ledger-sourced);
> (i) the **change-feed engine** for ERPNext (webhook ingress + modified-poll sweep, reusing the P1
> engine); (j) the **non-ERPNext byte-for-byte invariant** (P2's critical regression risk — explicit FR +
> AC + regression gate, exactly as P0/P1 did). ADR-0055 decisions and P0/P1 patterns are **not
> re-litigated** here.

---

## 0. Job story

> **When a client employs ERPNext as the money source of truth, PMO must let users operate the full
> buy-side chain and read financial truth from PMO while ERPNext remains the sole writer of committed/
> happened money — and every client who does NOT employ ERPNext stays byte-for-byte the pre-P2 system.**

PMO stays the app layer and user surface; ERPNext owns the native money objects; Supabase holds the
read-model plus PMO-only enhancements. Commands go down **synchronously** (guarded by an idempotency key +
outbox so a retry can never mint a duplicate money document), change-feed truth comes up via webhooks +
modified-poll sweep, and PMO never recomputes ERP figures beyond mirroring or summing mirrored ledger rows
(ADR-0048). The whole flip is per-org and reversible; with the shipped-empty ownership map it is inert.

---

## 1. Overview and user value

P2 is the first ERP adapter and the first **money** adapter. It extends the shipped P0 seam and the P1
real-adapter patterns to a **stock ERPNext v15** instance with **no custom app required** (ADR-0055 §2;
NFR-ENA-SEC-001). It flips three groups of domains for employing orgs:

1. **Parties** — PMO `companies`/`contacts` become the machine-written read-model + enhancement layer over
   ERPNext `Supplier`, `Customer`, and `Contact`.
2. **Procurement chain** — the PMO **`procurement`** domain (record tables `purchase_requests`, `rfqs`,
   `procurement_quotations`, `purchase_orders`, `procurement_receipts`, `procurement_invoices`, `payments`,
   with line items in `procurement_items`) becomes the read-model + enhancement layer over the stock
   buy-side doctypes: **Material Request (Purchase)**, **Request for Quotation**, **Supplier Quotation**,
   **Purchase Order**, **Purchase Receipt**, **Purchase Invoice**, **Payment Entry**. The PMO
   `procurements` **case folder** stays a PMO-owned aggregate (its `status` derived locally from mirrored
   ERP truth — FR-ENA-073).
3. **Accounting read-backs** — **actuals** plus **AP/AR aging** are mirrored into read-only PMO snapshot
   tables, sourced from ERPNext ledger/report truth (ADR-0048).

User value: procurement/admin users run the full buy-side chain from PMO without double-keying; finance
sees AP outcomes and aging from ERP truth in PMO; PMO preserves its richer case-folder UX, enhancement
state, and tenant/RLS model; ERP-side edits remain legitimate and reconcile back because ERPNext is SoT.

---

## 2. Scope

### In scope
- One **`erpnext`** adapter (`tier = 'erpnext'`) speaking stock Frappe/ERPNext v1 REST (`/api/resource`,
  `/api/method`) with token auth, owning the `companies` and `procurement` domains via an internal doctype
  registry; ClickUp-style domain routing generalized so one tier owns multiple domains.
- A per-org **`external_org_bindings`** table (site URL + resolved company/account/warehouse defaults +
  version handshake + webhook-secret ref) — OQ-6 resolved.
- The **money-idempotency contract extension** (`idempotencyKey` on `AdapterCommand`) + a durable
  **`external_command_outbox`** provisional-ref table with an atomic recovery algorithm (R1/R3).
- First-class **`transition`** (submit/cancel/amend) with **`amended_from` lineage** + an
  **`external_ref_lineage`** table + out-of-order event handling (R2).
- **Decimal-string** amount transport end-to-end + numeric-only persistence (R4).
- `companies`/`contacts` ↔ `Supplier`/`Customer`/`Contact` flip with **pull-adopt** + ambiguous-match
  operator resolution.
- Full **`procurement`** flip over the real record tables with per-doctype field maps folding the frozen
  R9 evidence.
- **AP command surface** (create/update-draft + submit/cancel/amend on Purchase Invoice; create+submit +
  cancel on Payment Entry).
- Read-only **actuals**, **AP aging**, **AR aging** snapshot tables (schema + provenance + refresh).
- Change-feed: ERPNext **webhook ingress** (HMAC) + **modified-poll reconciliation sweep**.
- The **non-ERPNext byte-for-byte invariant** for orgs that do not employ ERPNext.
- Served-edge-function money e2e lane (slice zero) with **named server-side fault-injection seams**.

### Out of scope
- **Sales money documents / Revenue-AR commands** (`Quotation`, `Sales Order`, `Sales Invoice`) — **P3+**,
  explicitly out here. AR aging is read-only *display* only; no receivables write is introduced.
- Odoo adapter — P4.
- e-Faktur, statutory close, period-close, and other native ERP desk workflows — stay ERPNext-native
  (ADR-0048).
- Budget projection / versioned-plan sync — separate issue under ADR-0055 §6.
- PMO recomputation of ERP figures beyond mirrored full-row upserts and ledger-row summation (ADR-0048).
- Any helper app requirement in ERPNext (ADR-0055 §2 — no adapter may require one).
- ERPNext timesheets (P3) and the sales-side of the `companies` party master beyond read-only mirroring.

---

## 3. Decided defaults and open questions

Four questions stay **[OWNER-DECISION]** flags (recommended defaults below); the rest are **resolved**
here (some empirically settled by the R9 spike).

### [OWNER-DECISION] OQ-1 — PMO Purchase Request ↔ ERPNext stock doctype
**Recommended default for sign-off:** PMO `purchase_requests` maps to **ERPNext `Material Request` with
`material_request_type = 'Purchase'`**. The R9 fit is clean: MR takes `{items:[{item_code, qty, rate,
schedule_date}]}` and server-defaults company/warehouse/UOM/cost-center. MR lacks a supplier / grand_total
/ chain-link field that a custom doctype would carry — but under this spec that chain state lives PMO-side
(the `procurements` case aggregate + record-table links), so the gap is by design, not a loss. **Residual
owner call:** accept Material Request, or keep PR **PMO-only** (no ERP mirror, chain starts at RFQ/PO). The
body specs Material Request; flipping to PMO-only PR removes FR-ENA-120..123 + AC-ENA-060 and starts the
ERP chain at RFQ.

### OQ-2 — Domain granularity for the chain — **RESOLVED**
Ownership flips as **one PMO domain, `procurement`**, with internal sub-doctype routing in the `erpnext`
doctype registry. Per-doctype domains would let a PR be ERP-owned while its PO is PMO-owned — an incoherent
partial-ownership state (R5). One domain, atomic flip. `companies` is a second, independent domain.

### [OWNER-DECISION] OQ-3 — Aging source (ADR-0048-constrained framing)
**Recommended default for sign-off:** aging read-back uses the **authoritative ERPNext report RPC**
(`POST /api/method/frappe.desk.query_report.run`, `report_name: "Accounts Payable" | "Accounts
Receivable"`, filters `{company, report_date, ageing_based_on: "Due Date", range1..4}`) and mirrors the
returned buckets into the snapshot tables (FR-ENA-160). **ADR-0048 constraint (binding on any fallback):**
the ledger-sourced-display rule means PMO may **only** mirror or **sum mirrored ERP ledger/report rows** —
so if a report-shape probe fails for a given minor, the *only* permitted fallback is bucketing **mirrored
`GL Entry` / `Payment Ledger Entry` rows** (also ERP truth), version-pinned per the handshake.
**Invoice-only local aging math on `procurement_invoices` is PROHIBITED** (FR-ENA-162) — it would be
PMO-authored accounting truth, which ADR-0048 forbids. **Residual owner call:** report-RPC-primary (this
default, authoritative but filter-drift-prone R10) vs mirrored-ledger-bucketing-primary (drift-stable, one
more sweep). Both are ERP-sourced; the prohibition on invoice-only math holds either way.

### [OWNER-DECISION] OQ-4 — Customer scope in P2
**Recommended default for sign-off:** P2 flips **both `Supplier` and `Customer`** under the `companies`
surface. Supplier write paths are required for procurement; Customer mirroring is required because **AR
aging is in scope** (read-only) and needs the customer party + its `payment_terms` for due-date display.
**No Customer *write* command and no sales-document command is introduced** — Customer flip is
create/update party + read-only. **Residual owner call:** flip Customers too (this default) vs
Suppliers-only + read-only AR parties later. If Suppliers-only, AR-aging (FR-ENA-161) narrows to
supplier-side counterparties or defers.

### OQ-5 — Amount representation at the adapter boundary — **RESOLVED**
All money and quantity values cross the adapter contract as **decimal strings** (R4). They are written to
PMO `numeric(14,2)` columns and ERPNext request bodies without JS float math. `PmoRecord` values that are
monetary are typed as `string` at the contract (FR-ENA-070). Integer-minor-units was rejected: ERPNext
returns decimal strings and the PMO columns are `numeric`, so decimal strings are the zero-conversion path.

### OQ-6 — Org binding + credential storage — **RESOLVED** (dedicated table)
ERPNext bindings are **per-org**, not per-project, and live in a **dedicated `external_org_bindings`
table** (not an org-sentinel row on the P0 per-project seam — the ERPNext binding carries site URL +
resolved account/warehouse defaults + version + webhook-secret ref that have no per-project meaning).
Credentials (api_key/api_secret, webhook secret) live in **1Password vault `AS` / Supabase function
secrets**, referenced by a **`secret_ref`** on the binding row — never stored in the DB, never in the
browser bundle (FR-ENA-011, NFR-ENA-SEC-002; env-file-privacy rule). Full schema in §4.

### [OWNER-DECISION] OQ-7 — AP command surface
**Recommended default for sign-off:** P2 includes, as PMO commands: create + update-draft + `transition`
(**submit / cancel / amend**) on **Purchase Invoice**; **create+submit** and **cancel** on **Payment
Entry** (amend on PE is desk-only in P2 — PE amend is rare and the R9 cancel-first path covers correction).
**Residual owner call:** this full AP surface (default) vs a narrower "submit PI + create+submit PE only,
cancel/amend desk-only" for a smaller first cut. The body specs the full surface; narrowing drops the
cancel/amend ACs (AC-ENA-030..032 partially) to desk-only.

### OQ-8 — Delete tracking policy — **EMPIRICALLY SETTLED by R9**
Money doctypes are **cancel-only, never hard-delete** — and the R9 spike proved this is not just policy but
what stock REST **enforces**: `DELETE` of a once-submitted money doc returns `417 LinkExistsError`, blocked
by the auto-created **Payment Ledger Entry** / GL Entry children even after cancel (spike §5). So P2 spec is
**cancel-first + soft-tombstone**: a cancelled ERP doc is mirrored in a `cancelled` state and its
read-model row is soft-tombstoned per the affected table (never row-deleted); the `external_refs` mapping
and `external_ref_lineage` are retained for audit (FR-ENA-052, FR-ENA-190). Emergency ERP-side hard deletes
of non-submittable docs are handled by the change-feed as a tombstone, not a normal path.

---

## 4. New storage (schema — reversible migrations, RLS on every table)

All new tables carry the `org_id` seam (`org_id uuid not null default '…0001'` + the shared
`stamp_org_id()` BEFORE-INSERT trigger, migration 0074 pattern) and are **machine-written only** (dispatch/
sync service role) with org-isolated `SELECT`, mirroring the P0 `external_refs`/`external_sync_watermarks`
RLS shape. Migration numbers are `≥` the current max at plan time (re-verify; another writer is active).

### 4.1 `external_org_bindings` (OQ-6)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | org seam; unique with tier |
| `external_tier` | text not null | e.g. `'erpnext'` |
| `site_url` | text not null | e.g. `http://localhost:8080` (dev bed) |
| `secret_ref` | text not null | pointer into vault `AS` / function-secret name; **no secret value stored** |
| `version_major` | int | stamped at handshake (P2 gates on `= 15`) |
| `config` | jsonb not null default `'{}'` | resolved defaults: `{company, default_payable_account, default_cash_account, default_bank_account, default_expense_account, cost_center, default_warehouse, naming_series?, aging_report_names, report_filter_shape}` (R9 §6: one `GET Company/<name>` fills the accounts) |
| `webhook_secret_ref` | text | pointer to the Frappe webhook HMAC secret |
| `activated_at` | timestamptz | null until handshake + defaults resolved |
| `created_at`/`updated_at` | timestamptz | |

Unique `(org_id, external_tier)`. RLS: org-member `SELECT`; service-role-only write. pgTAP: org isolation +
machine-only write.

### 4.2 `external_command_outbox` (R1/R3 — the durable provisional ref)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | org seam |
| `domain` | text not null | `'procurement'` / `'companies'` |
| `pmo_record_id` | text not null | the PMO record the command targets |
| `idempotency_key` | text not null | client-generated per non-read-only command |
| `external_tier` | text not null | |
| `operation` | text not null | `create` / `update` / `transition` (+ `sub` doctype/verb in `payload_digest`) |
| `state` | text not null | `pending` → `committed` → `confirmed` \| `failed` (CHECK) |
| `external_record_id` | text | ERP `name`, set at `committed` |
| `payload_digest` | text | stable hash of the canonical command (dedupe + tamper check) |
| `attempt_count` | int not null default 0 | |
| `last_error` | text | classified code + ERP message |
| `created_at`/`updated_at` | timestamptz | |

**Unique `(org_id, domain, pmo_record_id, idempotency_key)`** (the R1/R3 guard). RLS: service-role-only
write; org-member `SELECT` (for a "pushing/failed" UX read). pgTAP: uniqueness rejects a duplicate key
(`23505`); org isolation; machine-only write.

### 4.3 `external_ref_lineage` (R2 — cancel/amend history)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `domain` | text not null | |
| `pmo_record_id` | text not null | the stable PMO record |
| `superseded_external_record_id` | text not null | the old ERP `name` (cancelled or amended-from) |
| `successor_external_record_id` | text | the amended-into `name`; null for a pure cancel |
| `reason` | text not null | `'cancelled'` \| `'amended'` (CHECK) |
| `erp_docstatus` | smallint | 2 = cancelled |
| `at` | timestamptz not null default now() | |

Index `(org_id, domain, superseded_external_record_id)` (fast "is this ERP name a superseded lineage
entry?" lookup for out-of-order events, FR-ENA-053). RLS: service-role-only write; org-member `SELECT`.

### 4.4 Read-model snapshot tables (FR-ENA-160..164)
Three org-scoped, machine-written, read-only snapshot tables. Each row carries **provenance** columns so
the UI can show as-of + source and so a refresh **replaces** the prior snapshot atomically per scope.

`erp_actuals_snapshot` — `(id, org_id, project_id?, cost_center text, account text, fiscal_year text,
debit numeric(14,2), credit numeric(14,2), net numeric(14,2), as_of timestamptz, source_report text,
snapshot_id uuid, created_at)`. Sourced by summing mirrored `GL Entry` rows (ADR-0048; FR-ENA-150).

`erp_ap_aging_snapshot` / `erp_ar_aging_snapshot` — `(id, org_id, party text, party_type text,
company_id uuid?, currency text, total_outstanding numeric(14,2), current numeric(14,2),
b_0_30 numeric(14,2), b_31_60 numeric(14,2), b_61_90 numeric(14,2), b_90_plus numeric(14,2),
range_labels jsonb, report_date date, ageing_based_on text, as_of timestamptz, source_report text,
report_version text, snapshot_id uuid, created_at)`. Bucket boundaries mirror the report's `range1..4` so
PMO never re-buckets (FR-ENA-161/162).

**Refresh cadence + replacement:** the sweep writes a **new `snapshot_id`** per refresh scope
`(org, [project/company])`, then the prior snapshot rows for that scope are deleted in the same
service-role transaction (snapshot replacement, not append) so a read always sees exactly one coherent
`as_of`. RLS: org-member `SELECT`; service-role-only write. pgTAP: org isolation + machine-only write +
single-snapshot-per-scope after refresh.

### 4.5 Flip-migration additions to the real tables (§7 enumerates per table)
- `companies`: add machine-written mirror columns `erp_party_type text` (`'Supplier'`/`'Customer'`/dual),
  `erp_supplier_name text`, `erp_customer_name text`, `erp_tax_id text` (matching + display),
  `erp_payment_terms_days int` (Customer credit-days mirror for AR due-date display), `erp_cancelled_at
  timestamptz` (soft-tombstone). `type` (existing enum) and `name` remain the display fields.
- Each of the 7 record tables + `procurement_items`: add `erp_docstatus smallint`, `erp_modified text`
  (the per-row source-modification cursor, P1 FR-CUA-049 pattern), `erp_amended_from text`, `erp_cancelled_at
  timestamptz` (soft-tombstone). `procurement_invoices` additionally gets `erp_outstanding_amount
  numeric(14,2)`; `procurement_receipts`/`procurement_invoices` reuse existing `po_id` for PO linkage
  mirror; add `erp_line_amount numeric(14,2)` to `procurement_items` (the authoritative ERP line amount —
  because the existing `amount` column is `GENERATED ALWAYS AS (quantity*rate)` and PMO cannot set it;
  FR-ENA-071/072).
- `external_refs`: reuse the P1-added **`unique (org_id, domain, external_record_id)`** for atomic adopt
  dedupe (AC-ENA-041/054); no schema change beyond confirming it applies to the new domains.

---

## 5. Functional requirements (EARS)

### 5.1 Slice zero — served-edge-function money boundary + fault seams

- **FR-ENA-001** — The system shall provide a **served-edge-function** adapter lane so every money-command
  end-to-end acceptance test exercises the real `adapter-dispatch` function boundary through Supabase
  serve/Kong, **never** `page.route` or an in-process mock.
- **FR-ENA-002** — When the local money e2e lane runs, the system shall target a **fresh stock Docker
  ERPNext v15** dev bed (the R9 bench, `frappe/erpnext:v15.94.3` at `http://localhost:8080`) and a real
  served `adapter-dispatch`, proving command behavior against the same boundary production uses; the lane
  runs inside `scripts/with-db-lock.sh` (and a second lock/handle for the shared ERPNext stack).
- **FR-ENA-003 (server-side fault-injection seams)** — The served `adapter-dispatch` shall expose
  **named, server-side** fault seams, honored **only** when a serve-lane env flag `ERPNEXT_TEST_FAULTS=1`
  is set (never in prod), selected by a test-only request header `x-erpnext-test-fault`:
  `after-commit-before-mirror`, `after-submit-before-mirror`, `unreachable`, `reject-validation`,
  `timeout`. These make R1/R3/R2 provable at the **real** boundary with **no `page.route`** — the fault
  lives in the function, not the browser.

### 5.2 The non-ERPNext byte-for-byte invariant (Finding 1 — mirrors FR-EAS-010 / FR-CUA-030)

- **FR-ENA-004 (ubiquitous — THE INVARIANT)** — Where an org does **not** employ ERPNext (its
  `external_domain_ownership` has no `companies`→`erpnext` or `procurement`→`erpnext` assignment — the
  shipped default for every existing client), the system shall produce **byte-for-byte identical behavior**
  to the pre-P2 system for the `companies` and `procurement` domains: every write shall take the existing
  direct-DAL / RPC path (`transition_procurement`, `create_purchase_request`, `create_rfq`,
  `create_purchase_order`, `create_procurement_quotation`, `create_procurement_receipt`,
  `create_procurement_invoice`, `create_payment`, `companies_write`) with **no** adapter dispatch and
  **no** dispatch edge-function call; reads shall take the existing DAL path; **no** pending-push state
  shall be introduced; **every existing trigger shall behave exactly as before the flip** — the shared
  `stamp_org_id()` (0074), the parent-inherit `*_stamp_org` triggers on `purchase_requests`/`rfqs`/
  `purchase_orders`/`payments` (0035), and the `procurement_items.amount` **GENERATED** column — and all
  existing error codes, CHECK constraints, and the `procurement_quotations_one_selected_idx` invariant
  shall be unchanged. **Zero regression for every existing client.** *(This is P2's critical risk: the
  repository/dispatch wiring must not perturb the non-ERPNext path.)*
- **FR-ENA-005 (cold-start fail-closed routing)** — The routing decision shall read the org's ownership
  from the **cached own-org ownership map** (same load-on-auth lifecycle as P1 FR-CUA-031); an
  absent/not-yet-loaded/indeterminate map shall **default to `pmo`** (direct-DAL) — fail-closed to
  FR-ENA-004. A write routes to the `erpnext` adapter only when the map is loaded and positively asserts
  the domain → `erpnext`.

### 5.3 ERPNext tier core + per-org binding (OQ-6)

- **FR-ENA-010** — The system shall provide one **`erpnext` adapter** (`tier = 'erpnext'`) implementing the
  P0 `Adapter` contract, with a static `capabilityMap = {'companies', 'procurement'}`, registered in the
  `adapter-dispatch` registry — generalizing the P1 single-domain registration so one tier owns multiple
  domains (intake §2 extension 5; `routeDomainWrite(domain)`).
- **FR-ENA-011** — The `erpnext` adapter shall resolve its binding and credentials **per org** from
  `external_org_bindings` (§4.1): `site_url`, api key/secret + webhook secret via `secret_ref` (vault `AS`/
  function secrets, never the DB/browser), and the resolved `config` defaults (company + payable/cash/bank/
  expense accounts + cost center + warehouse), cached per binding — one `GET Company/<name>` fills the
  accounts (R9 §6.2).
- **FR-ENA-012** — When an ERPNext binding is created or refreshed, the adapter shall perform a **version
  handshake** (`GET /api/method/frappe.utils.change_log.get_versions`), stamp `version_major`, and gate
  behavior on it; P2 activates only `version_major = 15` semantics (a mismatch leaves the binding
  un-activated — error table).
- **FR-ENA-013** — The ERPNext client shall speak stock Frappe v1 REST (`/api/resource/<DocType>` with
  space-URL-encoding; `/api/method/<rpc>`) with `Authorization: token key:secret`, and shall classify
  Frappe error payloads into the P0 error contract, parsing **`exc_type` first** then `_server_messages`
  for display (R9 §6.7): `MandatoryError`/`ValidationError`/`InvalidQtyError`/`LinkExistsError`/
  `UpdateAfterSubmitError` → `commit-rejected`; `DoesNotExistError` (404) → `commit-rejected` (bad link);
  raw **`500` with `TypeError`** (the R9 empty-`items` crash) → a distinct **non-retryable** bucket (never
  blind-retried — FR-ENA-042); network/timeout/5xx-after-budget → `external-unreachable`.
- **FR-ENA-014** — The `erpnext` adapter shall own an internal **doctype registry** mapping
  `(domain, sub-doctype, operation)` → `{doctype, toBody, fromDoc, docstatusPolicy, readOnly?}`; the
  `capabilityMap` is its key set. Rate limiting is off-by-default in Frappe (intake R-note) — the client
  carries a modest token bucket + `429`/`Retry-After` backoff sized for worker-pool concurrency, not a hard
  quota, with **interactive commands prioritized over background sweep** (P1 NFR-CUA-PERF-003 pattern).

### 5.4 Money idempotency + post-commit safety (Finding 2 — R1/R3)

- **FR-ENA-040** — The adapter contract shall extend `AdapterCommand` with a client-generated
  **`idempotencyKey: string`** for every non-read-only ERPNext money command (added to `contract.ts`; the
  P0/P1 reference/ClickUp paths ignore it, preserving their behavior).
- **FR-ENA-041 (write-before-commit provisional ref)** — Before issuing a non-idempotent ERPNext create,
  the dispatch shall **`INSERT` an `external_command_outbox` row `state='pending'`** keyed by
  `(org, domain, pmo_record_id, idempotency_key)`; the **unique constraint** makes a concurrent/duplicate
  attempt fail atomically (`23505`), so two requests can never both proceed to create a money doc. The
  adapter shall additionally stamp the `idempotency_key` into a **stable stock text field** on the ERP body
  (the doctype's `remarks`/`remark`) so a recovery probe can find an orphaned commit (FR-ENA-043).
- **FR-ENA-042 (no blind retry)** — The ERPNext client shall **never** blindly retry a non-idempotent POST
  (create) on a retryable transport failure or on the `500`-`TypeError` bucket; a retry is permitted only
  through the guarded recovery algorithm (FR-ENA-043).
- **FR-ENA-043 (atomic recovery algorithm on retry/timeout)** — When a command reaches the dispatch with an
  already-present `idempotency_key`, the dispatch shall reconcile by outbox `state`, never re-issuing a
  second create:
  - `state = confirmed` → return the stored `external_record_id` + mirrored canonical record; **no ERP
    call**.
  - `state = committed` (ERP created but PMO failed before mirror/ref finalization) → **re-run only the
    finalization** (idempotent read-model upsert + `external_refs` record) and promote to `confirmed`;
    return.
  - `state = pending` (the dangerous window — the prior create may or may not have committed) → **probe
    ERP** by the stamped key: `GET /api/resource/<DocType>?filters=[["remark(s)","like","%<key>%"]]`; if a
    doc exists → adopt it (set `external_record_id`, `state='committed'`, then finalize → `confirmed`); if
    none → the create did not commit, so safely (re-)issue it under the same outbox row.
  - `state = failed` → the prior attempt was rejected pre-commit; a retry may re-issue the create.
- **FR-ENA-044 (two-step create→submit separates the idempotency windows)** — The adapter shall use the
  R9 **two-step** idiom (`POST` insert as draft → `PUT {docstatus:1}` submit) rather than create+submit in
  one POST, so the create-commit window (guarded by the outbox) is separate from the submit window; submit
  is separately idempotent — the adapter re-fetches `docstatus` first and treats an already-submitted doc as
  a no-op success (R9 §5). A stale `status:"Draft"` in a POST/PUT *response body* is never trusted — the
  adapter **re-fetches** the true `status`/`outstanding_amount` after submit (R9 §5 trap).
- **FR-ENA-045** — On an ERP command that commits in ERPNext but where PMO fails before mirror/ref
  finalization, the next retry **or** the sweep shall **adopt and finish** the existing record (via the
  outbox `committed` state or the `remarks`-key probe) rather than minting a duplicate PMO mirror row.

### 5.5 Transition semantics, docstatus, cancel/amend lineage (Finding 3 — R2)

- **FR-ENA-050** — The adapter shall treat ERPNext **`transition`** as a first-class operation for
  submittable doctypes, covering **submit** (`PUT {docstatus:1}`), **cancel** (`PUT {docstatus:2}`), and
  **amend** (native cancel + create-with-`amended_from`) — never an illegal update-after-submit (R9 §5:
  `UpdateAfterSubmitError` confirmed). A content change to a submitted doc routes to cancel+amend.
- **FR-ENA-051 (chain-reverse cancel ordering)** — When cancelling a doc with submitted downstream links,
  the adapter shall cancel the chain in **reverse dependency order** (R9 §5: cancelling a PO with a
  submitted PR against it → `417 LinkExistsError`; PR-then-PO → both 200; likewise PE-before-PI); a
  `LinkExistsError` shall surface honestly (naming the blocking doc) and **not** mutate the PMO mirror until
  ERP truth changes.
- **FR-ENA-052 (cancel keeps its mirror as a tombstone)** — When ERPNext cancels a doc (`docstatus 2`), the
  change-feed/mirror-apply shall **soft-tombstone** the read-model row (`erp_cancelled_at`, `erp_docstatus
  = 2`) rather than delete it, retain its `external_refs` mapping, and write an `external_ref_lineage` row
  (`reason='cancelled'`) — the cancelled doc keeps a read-only mirror for audit (OQ-8 settled). Active
  procurement views/rollups filter tombstoned rows out.
- **FR-ENA-053 (amend lineage + out-of-order events)** — When ERPNext amends a doc and produces a **new
  `name`** (`amended_from` = old name), the mirror-apply shall **repoint** `external_refs` for the same
  `pmo_record_id` to the new `name`, stamp `erp_amended_from`, and write an `external_ref_lineage` row
  (`reason='amended'`, `successor_external_record_id` = new name). Because ERPNext emits `modified` events
  for **both** the old (cancel) and new (amend) names, an inbound event whose ERP `name` matches a
  **superseded** `external_ref_lineage` entry shall apply **only** to that lineage tombstone (or be a
  no-op), **never** to the live `pmo_record_id` — guarded additionally by the per-row `erp_modified`
  source-modification timestamp (apply only if `>=` stored; a late old-name event is a no-op). This
  prevents a stale old-name event, arriving *after* the amend already repointed, from clobbering the live
  amended mirror. **No duplicate PMO mirror row** is ever minted for the amended doc.

### 5.6 Amount transport and mirror-write shape (Finding 4 — R4)

- **FR-ENA-070 (decimal-string transport)** — The adapter contract shall represent every money, rate,
  quantity, outstanding, allocated, and total value as **decimal strings** end-to-end (dispatch → adapter →
  ERP body/response → webhook apply → sweep apply); no monetary value shall pass through JS float math or
  `Number()` en route.
- **FR-ENA-071 (the money oracle + the GENERATED-column divergence)** — The **authoritative mirrored money
  figure** for a document is the ERPNext **server-computed** header total, mirrored verbatim (scale-2
  decimal string → `numeric(14,2)`) into the record header column: PI/PO/SQ `grand_total`/`total` →
  `procurement_invoices.amount` / `purchase_orders.amount` / `procurement_quotations.total_amount`; PI
  `outstanding_amount` → `procurement_invoices.erp_outstanding_amount`; PE `paid_amount`/reference
  `allocated_amount` → `payments.amount`. Line `qty`/`rate` mirror into `procurement_items.quantity`/`.rate`
  and the ERP-computed line `amount` mirrors into the **new `procurement_items.erp_line_amount`** — because
  the existing `procurement_items.amount` is `GENERATED ALWAYS AS (quantity*rate) STORED` and **PMO cannot
  set it**; the generated value is a display convenience that MAY diverge from `erp_line_amount` by scale-2
  rounding when an ERP `rate` carries >2 decimals, and it is **explicitly NOT** treated as ERP money truth.
  The money oracle for any total/outstanding/paid display is always the mirrored ERP header figure, never a
  PMO recomputation (ADR-0048).
- **FR-ENA-072 (over-scale + null handling)** — Money columns are `numeric(14,2)` (max 12 integer digits,
  2 fractional). The adapter shall (a) map ERP `null`/absent money fields to SQL `NULL` (not `0`) where the
  PMO column is nullable (`purchase_requests.amount`, `rfqs.amount`, `purchase_orders.amount`,
  `payments.amount`, `procurement_invoices.amount`), respecting the existing `*_amount_nonneg` CHECKs; (b)
  reject at classification a header total exceeding `numeric(14,2)` range as `commit-rejected` (config —
  IDR-scale bench realities keep this off the happy path) rather than silently truncating; (c) preserve the
  ERP scale-2 total exactly (no re-derivation from lines).
- **FR-ENA-073 (full-row upsert)** — Inbound ERP changes shall apply as **full-row upserts** of native
  mirrored fields so re-apply is idempotent and PMO never drifts by partial local recomputation; the PMO
  `procurements.status` and `procurements.total_value` remain **PMO-derived** (case aggregate) from the
  mirrored record rows, never overwritten by an ERP field.

### 5.7 Change-feed mechanics: modified poll + webhook hints (reuse P1 engine)

- **FR-ENA-080** — The ERPNext change-feed shall use **`modified` polling** as its source-of-truth sweep
  cursor, per org × doctype watermark on `external_sync_watermarks` (`modified` is a datetime string,
  sub-second, server-TZ — R6).
- **FR-ENA-081** — The sweep shall query each doctype with an **inclusive boundary** (`modified >=` the
  watermark) and dedupe by ERP `name`, so no doc sharing the boundary timestamp is skipped (the P1
  inclusive-cursor + idempotent-apply pattern, FR-CUA-007/046); `nextCursor` = max `modified` observed,
  never rewinding.
- **FR-ENA-082** — The system shall provide an **ERPNext webhook ingress** edge function that verifies
  `X-Frappe-Webhook-Signature` = `base64(HMAC-SHA256(secret, raw_body))` before any side effect, rejecting
  absent/invalid with `401` (R9/intake §2.13; STRIDE spoofing/tampering trust boundary).
- **FR-ENA-083** — ERPNext webhooks shall be **lossy latency hints only** (RQ background, 3 retries, empty
  payload if `webhook_json` unconfigured); the modified-poll sweep is the convergence authority (ADR-0055
  §3). Every apply (webhook or sweep) is idempotent and guarded by the per-row `erp_modified`
  source-modification timestamp (FR-ENA-053; P1 FR-CUA-049).
- **FR-ENA-084** — ERP-side desk edits shall be legitimate SoT changes and reconcile back through webhook
  and/or sweep; the ERP integration user needs full **read** perms on the flipped doctypes or the feed
  silently under-syncs (R13) — a binding-activation precondition.

### 5.8 Parties domain — `companies`/`contacts` ↔ Supplier/Customer/Contact (Finding 7)

- **FR-ENA-090** — Where `companies` is externally-owned by ERPNext, PMO `companies` shall be a
  machine-written read-model + PMO enhancements over ERPNext `Supplier` and `Customer`. **Column mapping
  (exact):** ERP `supplier_name`/`customer_name` → `companies.name` (prefer `*_name`, fall back to ERP
  `name`); the discriminator maps **`Supplier` → `companies.type = 'Vendor'`** and **`Customer` →
  `companies.type = 'Client'`** (the existing `company_type` enum `Internal|Client|Vendor`; **`Internal` is
  never ERP-flipped** — it is PMO's own org marker). Mirror columns (§4.5): `erp_party_type`,
  `erp_supplier_name`, `erp_customer_name`, `erp_tax_id`, `erp_payment_terms_days`. Enhancement (PMO-owned,
  stays user-writable): `archived_at` (soft-archive, ADR-0018), `contacts` relationships beyond the mirror.
- **FR-ENA-091 (Supplier/Customer collision rule)** — Because ERPNext models Supplier and Customer as
  **separate doctypes** while PMO `companies.type` is single-valued, a party that exists as **both** an ERP
  Supplier and an ERP Customer shall mirror as **two distinct `companies` rows** — one `type='Vendor'`, one
  `type='Client'` — keyed by distinct `external_refs.external_record_id` values that encode the ERP doctype
  (`Supplier:<name>` vs `Customer:<name>`). PMO does **not** auto-merge them; `erp_party_type='dual'` may be
  stamped on both for display. This makes the flip deterministic under the `unique (org_id, domain,
  external_record_id)` constraint.
- **FR-ENA-092** — The adapter shall support synchronous **create** and **update** commands for ERPNext
  `Supplier` (create body `{supplier_name}` minimal — R9 §0) and `Customer`, returning the canonical
  PMO-shaped company mirror. **No Customer write beyond party create/update, and no sales-document command,
  is introduced** (OQ-4).
- **FR-ENA-093 (pull-adopt + ambiguous-match)** — The parties flip shall support **pull-adopt** of
  pre-existing ERP suppliers/customers (mixed-state onboarding is normal — the P1 reject-both-non-empty rule
  does **not** apply to parties). Matching shall be by ERP `name` and, when present, `erp_tax_id`; an
  **ambiguous** match (same name, differing/absent tax id across candidates) shall be **surfaced for
  operator resolution — never auto-merged** (error table: `action-required`). Adopt is idempotent under the
  `unique (org_id, 'companies', external_record_id)` constraint (AC-ENA-041/054).
- **FR-ENA-094 (payment terms + due-date derivation)** — Customer `payment_terms` (→ `Payment Terms
  Template Detail.credit_days`, default 30) shall mirror into `companies.erp_payment_terms_days` as
  **read-model data only**; PMO shall use it for AR due-date *display* derivation but shall **never author
  its own receivables-terms truth** (ADR-0048; AR is read-only in P2).
- **FR-ENA-095 (contacts mirror)** — Where `companies` is externally-owned, PMO `contacts` shall mirror
  ERPNext `Contact` (`first_name`/`last_name` → `contacts.full_name`; `email_id` → `email`; `phone` →
  `phone`) linked to the parent `company_id`; `contacts.archived_at` stays a PMO enhancement. Contact-write
  commands are **out of scope** in P2 (read-only mirror) unless the owner extends OQ-4.

### 5.9 Procurement domain flip — one domain, seven doctypes (Finding 5, per-table enumeration in §7)

- **FR-ENA-100** — The PMO **`procurement`** domain shall flip as one externally-owned domain, with the
  `erpnext` adapter internally routing by sub-doctype across Material Request (Purchase), Request for
  Quotation, Supplier Quotation, Purchase Order, Purchase Receipt, Purchase Invoice, and Payment Entry
  (OQ-2).
- **FR-ENA-101** — While `procurement` is externally-owned, the seven **record tables** + `procurement_items`
  shall be **machine-written read-models** for their native/mirrored fields (§7), while PMO-only enhancement
  fields remain PMO-owned; the **`procurements` case row stays PMO-owned** (title/code/project_id/status/
  approval fields) — its `status` and `total_value` are **derived locally** from mirrored record truth
  (FR-ENA-073), never machine-overwritten by an ERP status field (R8: ERPNext derived `status` is volatile;
  PMO never writes it and never depends on custom ERP fields).
- **FR-ENA-102** — The PMO procurement **case folder** (`procurements` + its enhancement columns) remains
  the user-facing aggregate and enhancement surface, but ERPNext native document existence and native fields
  are authoritative for the flipped chain (ADR-0055 §5).
- **FR-ENA-103 (cross-document ref resolution)** — A PO/GR/PI/PE command shall resolve upstream ERP
  identifiers (supplier, PO `name`, **PO item child-row `name`** for GR linkage, PI `name` for PE
  reference) through `external_refs` + the multi-domain resolver (intake §2 extension 6) — never raw PMO
  ids and never a client-supplied ERP name.

### 5.10 Per-doctype subsections (Finding 6, folding frozen R9 — Finding 9)

Each subsection folds the R9 **minimal body**, the **server-defaulting**, the **traps**, the **commands**,
the **transitions**, the **mirror/enhancement split**, and the **failure modes**. `[SPIKE-PENDING]` markers
are **removed** — R9 is RESOLVED (`docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md`).

- **FR-ENA-110 (Material Request / Purchase Request)** — A PMO `purchase_requests` command maps to ERPNext
  **`Material Request`**, `material_request_type='Purchase'`. **Body** (R9 §3-adjacent + §0): `{items:
  [{item_code, qty, rate, schedule_date}]}`; the adapter enforces qty > 0, rate ≥ 0, resolves company from
  binding `config.company`, and lets ERP server-default UOM (`Nos`)/cost-center/warehouse. **Mirror:** ERP
  `name` → `external_refs` + `purchase_requests.pr_number` (display); `docstatus` → `erp_docstatus`;
  `modified` → `erp_modified`. **Enhancement:** `status` CHECK (`Draft|Submitted|Approved|Closed`) derived
  from `docstatus`. **Transitions:** PMO approval/SoD gates the **submit** (`PUT {docstatus:1}`), but
  ERPNext owns the native doc once submitted. **Failure:** empty `items` is a client-guarded pre-check
  (ERP crashes `500` on empty child rows for money docs — FR-ENA-042 bucket).
- **FR-ENA-111 (Request for Quotation)** — A PMO `rfqs` command maps to stock **`Request for Quotation`**.
  Mirror ERP `name` → `rfqs.rfq_number`, `docstatus`/`modified`. RFQ requires supplier + item rows;
  supplier resolved via `external_refs` (companies domain). Enhancement: `status` CHECK
  (`Draft|Issued|Closed`) derived.
- **FR-ENA-112 (Supplier Quotation)** — A PMO `procurement_quotations` command maps to stock **`Supplier
  Quotation`**. **Mirror:** ERP `grand_total` → `procurement_quotations.total_amount` (money oracle,
  FR-ENA-071); `valid_till` → `valid_until`; `vq_number` display; the `rfq_id` link mirrors the ERP RFQ
  linkage. **Enhancement (PMO-owned, preserved — Finding 8):** **`is_selected`** and the
  `procurement_quotations_one_selected_idx` one-selected-per-`procurement_id` invariant are **PMO
  comparison state**, not ERP truth — selection stays a PMO-side write and the unique index is preserved
  unchanged; ERP quote docs are evidence/source only.
- **FR-ENA-113 (Purchase Order)** — A PMO `purchase_orders` command maps to stock **`Purchase Order`**.
  **Body (R9 §3):** `{supplier, items:[{item_code, qty, rate, schedule_date}]}` — **`schedule_date` on the
  item row is mandatory** (`417 ValidationError: Please enter Reqd by Date`; header `schedule_date`
  cascades). **Mirror:** ERP `grand_total`/`total` → `purchase_orders.amount` (oracle); `name` →
  `po_number` + `external_refs`; `docstatus`/`modified`. **Enhancement:** `status` CHECK
  (`Draft|Issued|Acknowledged|Closed`) derived. **Ref resolution:** supplier + source PR via `external_refs`
  (FR-ENA-103). **Transitions:** create draft → submit (`status:"To Receive and Bill"`).
- **FR-ENA-114 (Purchase Receipt / Goods Receipt)** — A PMO `procurement_receipts` command maps to stock
  **`Purchase Receipt`**. **Body (R9 §4):** `{supplier, items:[{item_code, qty, rate, purchase_order,
  purchase_order_item}]}` — the **`purchase_order_item`** is the PO item **child-row `name`** (fetched from
  the PO doc), required per row for PO-fulfilment linkage; a standalone GR (no link fields) also works but
  loses fulfilment tracking. **Mirror:** ERP `name` → `gr_number` + `external_refs`; the `po_id` link →
  existing `procurement_receipts.po_id`; supplier delivery-note number → existing `reference_number`
  (Finding 8, preserved); `docstatus`/`modified`. **Enhancement:** `status` enum
  (`procurement_receipt_status`: `Partial|Complete`) derived. Warehouse server-defaults from the item's
  `item_defaults` — resolve from binding `config.default_warehouse` when needed (FR-ENA-011). Submit → PO
  flips `To Bill`, `per_received:100`.
- **FR-ENA-115 (Purchase Invoice)** — A PMO `procurement_invoices` command maps to stock **`Purchase
  Invoice`**. **Body (R9 §1):** minimal `{supplier, items:[{item_code, qty, rate}]}`; ERP server-defaults
  `credit_to`=`Creditors`, `posting_date`/`due_date`=today, currency/conversion, cost-center, warehouse, and
  computes `total`/`grand_total`/`outstanding_amount`. **Traps folded:** (a) missing/empty `items` →
  **`500 TypeError`** (unguarded crash) — client pre-validates non-empty items (FR-ENA-042); (b) a
  free-text (no `item_code`) row requires an explicit **`expense_account`**; (c) a **stock** item with no
  receipt force-swaps the expense head to `Stock Received But Not Billed` (informational) — the adapter does
  not fight it. **Mirror:** ERP `grand_total` → `procurement_invoices.amount` (oracle); `outstanding_amount`
  → `erp_outstanding_amount`; supplier `bill_no` → existing `reference_number` (Finding 8); `po_id` link
  mirrored; `name` → `vi_number` + `external_refs`; `docstatus`/`modified`. **Enhancement:** `status` enum
  (`procurement_invoice_status`: `Received|Scheduled|Paid`) derived from ERP `status` +
  `outstanding_amount==0` (R9 §2 paid-detection). **Transitions:** create draft → submit → (cancel/amend per
  OQ-7).
- **FR-ENA-116 (Payment Entry — the R9 core, now pinned)** — A PMO `payments` command maps to stock
  **`Payment Entry`**. **Body (R9 §2, frozen):** exactly `{payment_type:"Pay", party_type:"Supplier",
  party, paid_amount, received_amount, paid_from, paid_to, references:[{reference_doctype:"Purchase
  Invoice", reference_name, allocated_amount}]}`. **The R9 answer (binding):** the **REST API defaults
  NONE of the account fields** (unlike the desk UI) — the adapter **must supply `paid_from` + `paid_to`
  itself**, resolved from binding `config` (`default_cash_account`/`default_bank_account` → `paid_from`;
  `default_payable_account` → `paid_to` for a Pay-to-Supplier); once accounts are given,
  `received_amount` must be sent explicitly (not derived) but `source/target_exchange_rate` and
  `paid_from/to_account_currency` auto-derive; `mode_of_payment` is not mandatory. **Mirror:** ERP
  `paid_amount`/reference `allocated_amount` → `payments.amount` (oracle); `name` → `pay_number` +
  `external_refs`; the **`invoice_id`** link → existing `payments.invoice_id` (resolved from the PI's
  `external_refs` — Finding 8, preserved, with the same-case invariant of `create_payment` intact);
  supplier ref no. → `reference_number`; `docstatus`/`modified`. **Enhancement:** `status` CHECK
  (`Scheduled|Paid`) derived. **Transitions:** create draft → submit (`references` optional at both save
  and submit — an unreferenced PE is an on-account payment; paying a specific PI needs the `references`
  row); after a referenced-PE submit, the PI flips **`Paid`/`outstanding_amount 0`** server-side (R9
  paid-detection idiom → mirror the PI's new `erp_outstanding_amount`). Cancel per OQ-7; **amend is
  desk-only in P2**.
- **FR-ENA-117 (docstatus mechanics, cross-doctype)** — Submit = `PUT /api/resource/<DT>/<name>
  {docstatus:1}` (no RPC); cancel = `{docstatus:2}`; the adapter always uses **two-step insert-then-submit**
  (FR-ENA-044) and re-fetches derived status after submit; cancel ordering is chain-reverse (FR-ENA-051);
  a once-submitted money doc **cannot be REST-deleted** (`LinkExistsError` via Payment Ledger — OQ-8), so
  the only correction path is cancel (+ amend where allowed). Write side effects exist (first priced
  purchase auto-creates an **Item Price**) — the sweep tolerates docs/masters the adapter never created (R9
  §6.8).

### 5.11 Carried existing invariants (Finding 8 — preserve or supersede, each named)

- **FR-ENA-130** — The following shipped invariants are **PRESERVED unchanged** by the flip: (a)
  `procurement_quotations_one_selected_idx` unique-partial index (one `is_selected` per `procurement_id`)
  and the `is_selected` + `total_amount` columns — selection is PMO enhancement state (FR-ENA-112); (b)
  `procurement_receipts.reference_number` (supplier delivery-note no.) and `procurement_invoices.
  reference_number` (supplier invoice/`bill_no`) — repurposed to carry the ERP supplier-ref mirror, same
  column, same meaning; (c) `procurement_receipts.po_id` / `procurement_invoices.po_id` FK links to
  `purchase_orders` — mirrored from ERP PO linkage; (d) `payments.invoice_id` FK to
  `procurement_invoices` **and** the `create_payment` **same-case invariant** (42501 "invoice not in this
  case") — preserved: under the flip the service role writes but the same-case FK relationship still holds
  (the adapter resolves `invoice_id` from the PI mirror in the same `procurement_id`); (e) all record-table
  `status` CHECK constraints and the `procurement_status`/`procurement_receipt_status`/
  `procurement_invoice_status` enums — preserved, now populated by **derivation from ERP `docstatus`/
  `status`** rather than the PMO RPCs; (f) the `*_amount_nonneg` CHECKs — preserved (FR-ENA-072 maps ERP
  nulls to SQL NULL, non-negatives only).
- **FR-ENA-131 (superseded, explicitly)** — Under the flip, the **PMO minting RPCs** (`create_purchase_request`,
  `create_rfq`, `create_purchase_order`, `create_procurement_quotation`, `create_procurement_receipt`,
  `create_procurement_invoice`, `create_payment`, and the `transition_procurement` state machine) are
  **superseded as the write path for externally-owned orgs**: the dispatch/service-role writes the mirror
  directly, and the ERP `name` becomes the authoritative document number (mirrored into the PMO `*_number`
  display column). The RPCs and `next_procurement_doc_number` minter remain **unchanged and authoritative
  for PMO-owned orgs** (FR-ENA-004). This is the one place existing behavior is superseded — everywhere
  else invariants are preserved.

### 5.12 Actuals + aging read-only domains (Findings 10, 11)

- **FR-ENA-150 (actuals — ledger-sourced)** — The system shall provide a read-only **actuals** snapshot
  (`erp_actuals_snapshot`, §4.4) sourced from ERPNext **`GL Entry`** truth (filter `is_cancelled=0` /
  exclude `docstatus=2`), scoped by project/cost-center/fiscal-year per binding; PMO may **sum** mirrored
  ledger rows but shall **never** invent accounting numbers (ADR-0048 ledger-sourced-display).
- **FR-ENA-160 (aging — report-RPC primary)** — The system shall provide read-only **AP aging** and **AR
  aging** snapshots (`erp_ap_aging_snapshot`/`erp_ar_aging_snapshot`, §4.4) whose **primary** source is the
  authoritative report RPC `frappe.desk.query_report.run` (`Accounts Payable`/`Accounts Receivable`) with
  **version-pinned filters** (introspected once via `get_script` and stored in binding
  `config.report_filter_shape` — R10 drift mitigation), mirroring the returned bucket values +
  `range_labels` verbatim.
- **FR-ENA-161 (aging — bucket provenance)** — Aging snapshots shall carry `report_date`, `ageing_based_on`,
  `range_labels`, `as_of`, `source_report`, and `report_version` so the UI shows the as-of date, the exact
  bucket ranges, and the source report identity; the sweep refreshes by **snapshot replacement** per scope
  (§4.4), never append.
- **FR-ENA-162 (aging — constrained fallback + the prohibition)** — If a report-shape probe fails for a
  minor, the **only** permitted fallback is bucketing **mirrored `GL Entry` / `Payment Ledger Entry` rows**
  (ERP ledger truth), version-pinned. **Invoice-only local aging math over `procurement_invoices`
  (`due_date − today` bucketing on PMO rows) is PROHIBITED** — it is PMO-authored accounting truth, which
  ADR-0048 forbids (OQ-3).
- **FR-ENA-163** — Aging is **read-only** in P2: including AR aging introduces **no** sales-document or
  receivables write command (OQ-4). AR counterparties ride the Customer mirror (FR-ENA-090..094).

### 5.13 PMO read-model + RLS flip observables (Finding 5 mechanism)

- **FR-ENA-170** — While `companies` or `procurement` is externally-owned for an org, the corresponding
  **native mirrored columns** shall be **machine-written only**: user-JWT writes to native mirrored fields
  are RLS-denied and the dispatch/sync service role is permitted (generalizing the P1 0090/tasks flip). The
  **enhancement columns** (`companies.archived_at`; `procurement_quotations.is_selected`; the
  `procurements` case aggregate; `contacts.archived_at`) remain user-writable through the existing policies.
- **FR-ENA-171 (trigger bypass — R7)** — Each flipped table's flip-migration shall audit its triggers so a
  service-role mirror write is not corrupted or blocked: the shared `stamp_org_id()` and the parent-inherit
  `*_stamp_org` triggers only override a null/seed `org_id` (safe — the dispatch sets `org_id` explicitly
  from the bound context); the `procurement_items.amount` **GENERATED** column is never written by the
  adapter (FR-ENA-071 writes `erp_line_amount` instead). No procurement table carries a
  `stamp_task_completed_at`-style derived trigger, so no service-role bypass is needed there — but each flip
  migration **states this per table** (§7) rather than assuming it.
- **FR-ENA-172** — Reads for flipped domains shall continue to serve from Supabase read-model tables/
  repositories only; **no** UI/read path may synchronously query ERPNext (ADR-0055 §3; P0 FR-EAS-030).

---

## 6. Non-functional requirements

- **NFR-ENA-SEC-001** — The adapter shall require **no ERP custom app** and speak only stock ERPNext/Frappe
  APIs (ADR-0055 §2).
- **NFR-ENA-SEC-002** — Per-org ERP credentials + webhook secrets are **server-only** (vault `AS`/function
  secrets via `secret_ref`), never in browser code, never in mirrored tables, never logged (env-file-privacy
  rule).
- **NFR-ENA-SEC-003** — RLS is the enforcement authority for PMO mirrors + enhancement tables; the
  client/router branch is UX/DX-only (ADR-0016; P0 FR-EAS-037).
- **NFR-ENA-SEC-004** — Every externally-owned table flip shall preserve the `org_id` seam and ship pgTAP
  proofs for org isolation + machine-only native writes (per-table, §7).
- **NFR-ENA-IDEM-001** — The idempotency contract (FR-ENA-040..045) shall make duplicate Purchase Invoice
  **or** Payment Entry creation **impossible** under retry-after-timeout / 429 / mirror-finalization-failure
  conditions, proven at the **real served boundary** with the `after-commit-before-mirror` fault seam. **(R1,
  R3)**
- **NFR-ENA-DOC-001** — The docstatus/lineage contract (FR-ENA-050..053) shall prevent duplicate PMO mirrors
  during cancel/amend rename flows and out-of-order events. **(R2)**
- **NFR-ENA-MONEY-001** — Decimal-string transport + numeric-only persistence shall eliminate JS float drift
  in money mirrors; the money oracle is always the mirrored ERP header total (FR-ENA-071). **(R4)**
- **NFR-ENA-FEED-001** — The sweep cursor shall be monotonic per org × doctype and tolerant of
  equal-boundary `modified` timestamps via inclusive polling + idempotent dedupe + per-row source-mod guard.
- **NFR-ENA-PERF-001** — The adapter shall batch/page change-feed + report calls conservatively for stock
  ERPNext worker realities, with interactive commands prioritized over background sweep (P1
  NFR-CUA-PERF-003).
- **NFR-ENA-PERF-002** — The routing decision shall add **no round-trip** on the invariant path: it consults
  the cached own-org ownership map and short-circuits in-memory; the non-ERPNext write path is byte-for-byte
  the direct DAL/RPC with no dispatch hop (FR-ENA-004/005; P0 NFR-EAS-PERF-001).
- **NFR-ENA-CONTRACT-001** — ERPNext/Frappe vocabulary shall live **solely** under
  `pmo-portal/src/lib/adapterSeam/erpnext/**` + the ERPNext webhook edge function; no code above the adapter
  contract shall name a doctype, endpoint, or Frappe shape (P0 NFR-EAS-CONTRACT-001; P1 FR-CUA-012).
- **NFR-ENA-REV-001** — Every flip migration shall be reversible (drop the added mirror columns + RLS gates
  + trigger branches → restore 0002/0006/0035 behavior), follow additive discipline, and ship pgTAP; seed is
  local-only (`docs/environments.md`).
- **NFR-ENA-TEST-001** — Each AC has exactly one owning test at its lowest sufficient layer (unit / pgTAP /
  served-fn e2e). **Every money-command e2e uses the real served function boundary** (FR-ENA-001) with the
  server-side fault seams (FR-ENA-003) — **never `page.route`** (Finding 13).
- **NFR-ENA-DEVBED-001** — The canonical P2 dev/test bed is the fresh stock Docker ERPNext v15 stack (R9
  bench, `frappe/erpnext:v15.94.3` at `localhost:8080`); the broken legacy `~/Coding/frappe-bench` is not on
  the supported path (intake §3.1).

---

## 7. Per-table flip enumeration (Finding 5)

Every table names its **native mirrored columns** (machine-written read-model of ERP fields), its
**PMO-owned columns** (enhancement / aggregate — stay user-writable), its **write policy under flip**, its
**trigger handling**, and its **pgTAP proof**. Column names are the real shipped identifiers.

| Table | Native mirrored (machine-only under flip) | PMO-owned (stays user-writable) | Trigger handling | pgTAP proof |
|---|---|---|---|---|
| **`companies`** | `name`, `type` (Vendor/Client only), `erp_party_type`, `erp_supplier_name`, `erp_customer_name`, `erp_tax_id`, `erp_payment_terms_days`, `erp_cancelled_at` | `archived_at` (soft-archive); `Internal`-type rows never flipped | `companies_stamp_org_id` (0074) overrides null/seed org only — safe; service role sets org explicitly | user-JWT native write denied; service-role write ok; `archived_at` still user-writable; org-isolated |
| **`contacts`** | `full_name`, `email`, `phone` (from ERP `Contact`), link `company_id` | `archived_at`, `title`, `notes` (no ERP `Contact` equivalent mirrored in P2 — FR-ENA-095 maps only `full_name`/`email`/`phone`) | 0030 shipped contacts with **no dedicated stamp trigger** (org_id column default + `contacts_write` WITH CHECK only, by design); `contacts_stamp_org_id` (0074's later, unrelated 42-table blanket hardening — not authored for this flip) now exists and overrides null/seed org only — confirmed live (`pg_trigger`); the flip adds **no new trigger** for `contacts` | user native write denied; service ok; org-isolated |
| **`procurements`** (case) | *(none — PMO aggregate)* | whole row: `title`, `code`, `project_id`, `status` (derived), `total_value` (derived), `vendor_id`, approval/rejection notes, `pr_number`/`po_number` | `procurements_stamp_org_id`; `transition_procurement` RPC stays PMO path | **stays user-writable even when `procurement` externally-owned** (the case folder is PMO's) — pgTAP proves the aggregate is not machine-locked |
| **`procurement_items`** | `quantity`, `rate`, `erp_line_amount`, `erp_docstatus`, `erp_modified` | `name` (may stay PMO-labeled; enhancement) | `procurement_items_stamp_org` (parent-inherit, 0015) + `_stamp_org_id` (0074) — both override null/seed only, safe; **`amount` GENERATED — never written by adapter** (FR-ENA-071) | user native write denied; service ok; generated `amount` unaffected |
| **`purchase_requests`** | `pr_number` (ERP name), `reference_number`, `amount`, `date`, `erp_docstatus`, `erp_modified`, `erp_amended_from`, `erp_cancelled_at` | *(status derived from `erp_docstatus`)* | `purchase_requests_stamp_org` (parent-inherit, 0035) + `_stamp_org_id` (0074) — both override null/seed only, safe | user native write denied; service ok; `status` CHECK preserved; org-isolated |
| **`rfqs`** | `rfq_number`, `reference_number`, `amount`, `date`, `erp_*` | *(status derived)* | `rfqs_stamp_org` + `_stamp_org_id` safe | as above |
| **`procurement_quotations`** | `total_amount`, `valid_until`, `rfq_id`, `vq_number`, `reference`, `received_date`, `erp_*` | **`is_selected` (+ the one-selected unique index)** — PMO comparison state | `procurement_quotations_stamp_org_id` safe | user native write denied; **`is_selected` still user-writable**; one-selected index intact; org-isolated |
| **`purchase_orders`** | `po_number`, `reference_number`, `amount`, `date`, `erp_*` | *(status derived)* | `purchase_orders_stamp_org` + `_stamp_org_id` safe | user native write denied; service ok; `status` CHECK preserved |
| **`procurement_receipts`** | `gr_number`, `receipt_date`, `reference_number`, `po_id`, `erp_*` | *(status enum derived)* | `procurement_receipts_stamp_org_id` safe | user native write denied; service ok; `po_id` FK preserved |
| **`procurement_invoices`** | `vi_number`, `invoice_date`, `reference_number`, `amount`, `po_id`, `erp_outstanding_amount`, `erp_*` | *(status enum derived; paid = `erp_outstanding_amount==0`)* | `procurement_invoices_stamp_org_id` safe | user native write denied; service ok; `amount`/`po_id` preserved |
| **`payments`** | `pay_number`, `reference_number`, `amount`, `date`, `invoice_id`, `erp_*` | *(status CHECK derived)* | `payments_stamp_org` + `_stamp_org_id` safe | user native write denied; service ok; **`invoice_id` same-case invariant preserved** |

Each row ships a **reversible flip migration** (add mirror columns + RLS native-write gate on
`domain_externally_owned(auth_org_id(), <domain>)` + confirm trigger safety) and its pgTAP proof file
(`supabase/tests/erpnext_<table>_flip_rls.test.sql`).

---

## 8. Acceptance criteria (Given/When/Then)

> The non-ERPNext invariant (AC-ENA-001..003) and the idempotency/lineage money-safety ACs are the heart of
> P2. **Every money-command e2e uses the real served `adapter-dispatch` boundary + a named server-side
> fault seam — NO `page.route`** (Finding 13, NFR-ENA-TEST-001). Flip-RLS + org-isolation ACs are pgTAP;
> mapping/idempotency-logic/lineage/amount-shape ACs are Vitest; cross-stack money flows are served-fn e2e.
> Each AC is owned by exactly one test at its lowest sufficient layer (ADR-0010).

### The non-ERPNext byte-for-byte invariant (Finding 1)

- **AC-ENA-001** — No ERPNext employed ⇒ procurement/companies writes take the direct-DAL/RPC path
  (byte-for-byte). **[unit]**
  **Given** an org with no `procurement`→`erpnext` or `companies`→`erpnext` assignment (the shipped default)
  and any procurement/company write,
  **When** the write is performed,
  **Then** it executes through the existing direct DAL / RPC — no adapter dispatch, no dispatch
  edge-function, no pending-push — and the observable result (row written, returned shape, error `code`) is
  identical to the pre-P2 system. (FR-ENA-004, FR-ENA-005)

- **AC-ENA-002** — The pre-P2 procurement + companies acceptance suite remains green (zero regression).
  **[cross-layer regression gate]**
  **Given** the `erpnext` adapter + all flip migrations are installed and no org employs ERPNext,
  **When** the existing suite (Vitest + pgTAP + e2e) runs unchanged,
  **Then** every previously-passing procurement/company test still passes. (FR-ENA-004) *(Owning layer: the
  unchanged existing suite IS the proof; a meta-AC, see traceability — mirrors AC-EAS-003 / AC-CUA-002.)*

- **AC-ENA-003** — The flip is org-scoped (a non-employing org is unaffected by an employing org). **[pgTAP]**
  **Given** org A has `procurement`→`erpnext` and org B does not,
  **When** a delivery-role member of org B performs a native procurement write,
  **Then** it succeeds via the direct path (org B is byte-for-byte pre-P2). (FR-ENA-004, FR-ENA-170)

### Idempotency / post-commit safety (Finding 2 — real boundary + fault seam)

- **AC-ENA-010** — Duplicate retry cannot double-create a Payment Entry (interrupted response, real
  boundary). **[served-fn e2e]**
  **Given** the served `adapter-dispatch` + stock Docker ERPNext v15, a Payment Entry command with an
  `idempotencyKey`, and the server-side fault seam **`after-commit-before-mirror`** armed (the ERP commit
  succeeds but the function's response path is interrupted **server-side** — no `page.route`),
  **When** the exact command is retried,
  **Then** ERPNext contains **one** Payment Entry, the outbox reconciles (`pending`/`committed` →
  `confirmed` via the `remarks`-key probe or `committed` finalize), PMO holds **one** `payments` mirror row,
  and no duplicate is created. (FR-ENA-040..045, NFR-ENA-IDEM-001)

- **AC-ENA-011** — Non-idempotent blind retry is blocked; the 500-`TypeError` bucket is not retried. **[unit]**
  **Given** a non-idempotent create lacking safe reconciliation proof and a mocked retryable transport
  failure / a `500`+`TypeError` response,
  **When** the ERP client handles it,
  **Then** it refuses to blindly retry the POST and surfaces the guarded-reconciliation need (the
  `500`-`TypeError` maps to the distinct non-retryable bucket). (FR-ENA-042, FR-ENA-013)

- **AC-ENA-012** — The outbox unique key rejects a concurrent duplicate command atomically. **[pgTAP]**
  **Given** an `external_command_outbox` row for `(org, 'procurement', pmo_record_id, idempotency_key)`,
  **When** a second insert of the **same** key is attempted,
  **Then** it is rejected by `unique (org_id, domain, pmo_record_id, idempotency_key)` (`23505`), so at most
  one command proceeds. (FR-ENA-041)

- **AC-ENA-013** — Post-commit mirror-failure recovery adopts the existing PI (no duplicate mirror).
  **[served-fn e2e]**
  **Given** a Purchase Invoice command whose ERP create committed but the outbox is left `pending`/`committed`
  (fault `after-commit-before-mirror`),
  **When** the sweep or a retry runs,
  **Then** it adopts the existing ERP doc (via `committed` finalize or the `remarks`-key probe) and finishes
  one `procurement_invoices` mirror row — never minting a second. (FR-ENA-045)

### Cancel / amend / lineage (Finding 3)

- **AC-ENA-020** — Cancel soft-tombstones the mirror and keeps lineage. **[unit]**
  **Given** a submitted ERPNext Purchase Invoice that is cancelled (`docstatus 2`),
  **When** webhook/sweep applies the cancel,
  **Then** the `procurement_invoices` row is soft-tombstoned (`erp_cancelled_at`, `erp_docstatus=2`, hidden
  from active views), its `external_refs` mapping is retained, and an `external_ref_lineage`
  (`reason='cancelled'`) row is written. (FR-ENA-052)

- **AC-ENA-021** — Cancel+amend rename reconciles to one mirror via `amended_from`. **[unit]**
  **Given** a submitted PI cancelled and amended into a **new** ERP `name` (`amended_from`=old),
  **When** webhook/sweep applies the amended document,
  **Then** `external_refs` for the same `pmo_record_id` **repoints** to the new `name`, `erp_amended_from`
  is stamped, an `external_ref_lineage` (`reason='amended'`) row is written, and **no** duplicate mirror row
  is minted. (FR-ENA-053, NFR-ENA-DOC-001)

- **AC-ENA-022** — An out-of-order old-name event does not clobber the live amended mirror. **[unit]**
  **Given** an amended PI whose live mirror now points to the new `name`,
  **When** a **stale** `modified` event for the **old** (cancelled/superseded) `name` arrives afterward,
  **Then** it applies only to the lineage tombstone (or is a no-op via the `erp_modified` `>=` guard) and
  **never** overwrites the live amended `pmo_record_id` row. (FR-ENA-053)

- **AC-ENA-023** — Illegal update-after-submit routes to transition; cancel ordering is chain-reverse.
  **[unit]**
  **Given** a PMO edit targeting a submitted money doc, and a cancel of a PO with a submitted PR against it,
  **When** the adapter processes each,
  **Then** the edit issues cancel+amend (never an illegal write-after-submit → `UpdateAfterSubmitError`),
  and the cancel is ordered PR-then-PO (a premature PO cancel's `LinkExistsError` is surfaced, not
  swallowed). (FR-ENA-050, FR-ENA-051)

### Amount transport / mirror-write shape (Finding 4)

- **AC-ENA-030** — Decimal strings round-trip PI line + total without float drift. **[unit]**
  **Given** an ERPNext Purchase Invoice with cents-bearing `grand_total`, `outstanding_amount`, and line
  `qty`/`rate`/`amount`,
  **When** they cross the adapter as decimal strings and mirror into PMO numerics,
  **Then** `procurement_invoices.amount` = ERP `grand_total` exactly, `erp_outstanding_amount` = ERP
  `outstanding_amount` exactly, `procurement_items.erp_line_amount` = ERP line `amount` exactly, no JS float
  artifact appears, and the header total is the money oracle (not re-derived from lines). (FR-ENA-070,
  FR-ENA-071, NFR-ENA-MONEY-001)

- **AC-ENA-031** — Payment Entry `paid_amount`/`allocated_amount` round-trips into `payments.amount`;
  nulls/over-scale handled. **[unit]**
  **Given** a Payment Entry with a decimal `paid_amount` + reference `allocated_amount`, and separately an
  absent optional money field and an over-`numeric(14,2)` value,
  **When** the adapter mirrors them,
  **Then** `payments.amount` = the ERP allocated figure exactly, an absent optional maps to SQL `NULL` (not
  `0`, respecting `payments_amount_nonneg`), and the over-scale value is classified `commit-rejected`
  (config) rather than truncated. (FR-ENA-070, FR-ENA-072)

### Parties (Finding 7)

- **AC-ENA-040** — Supplier create/write-through succeeds through ERP truth (real boundary). **[served-fn
  e2e]**
  **Given** an org employing ERPNext for `companies` and a new vendor company in PMO,
  **When** the user creates the supplier through the real served `adapter-dispatch`,
  **Then** ERPNext `Supplier` is created (body `{supplier_name}`), `companies.name` ← `supplier_name`,
  `type='Vendor'`, `erp_party_type` stamped, the `external_refs` mapping is recorded, and no `page.route` is
  used. (FR-ENA-090, FR-ENA-092)

- **AC-ENA-041** — Existing ERP party pull-adopt is idempotent under concurrency; ambiguous match is
  surfaced. **[unit]**
  **Given** a pre-existing ERP Supplier/Customer with no PMO mapping, and separately two candidates sharing a
  name with differing/absent `tax_id`,
  **When** pull-adopt runs twice concurrently, and when the ambiguous pair is evaluated,
  **Then** exactly one `companies` mirror + one mapping exist per ERP party (the `unique (org_id,
  'companies', external_record_id)` guard), and the ambiguous match is surfaced for operator resolution —
  never auto-merged. (FR-ENA-093, FR-ENA-091)

- **AC-ENA-042** — Supplier/Customer collision maps to two distinct rows. **[unit]**
  **Given** an ERP party existing as both a `Supplier` and a `Customer` with the same `name`,
  **When** both are adopted,
  **Then** two `companies` rows exist — one `type='Vendor'`, one `type='Client'` — keyed by distinct
  `external_record_id` (`Supplier:<name>` / `Customer:<name>`), not merged. (FR-ENA-091)

### Procurement chain (per-doctype — real boundary, Findings 6 + 9)

- **AC-ENA-050** — Purchase Request maps to Material Request and submits through ERPNext. **[served-fn e2e]**
  **Given** a procurement case with valid items and binding defaults,
  **When** the user creates/submits the PR through the served boundary,
  **Then** ERPNext creates a purchase `Material Request` (two-step insert→submit), `purchase_requests`
  mirrors it (`pr_number`←ERP name, `erp_docstatus`), and the `external_refs` mapping is recorded.
  (FR-ENA-110, FR-ENA-044)

- **AC-ENA-051** — RFQ + Supplier Quotation mirror without breaking the PMO one-selected invariant.
  **[served-fn e2e]**
  **Given** a case with one RFQ and two supplier quotations,
  **When** the records are pushed through the served boundary and one quotation is selected in PMO,
  **Then** ERPNext holds the native RFQ/Supplier-Quotation docs, `procurement_quotations.total_amount`
  mirrors ERP `grand_total`, and exactly one `is_selected=true` row exists per `procurement_id`
  (`procurement_quotations_one_selected_idx` intact — PMO comparison state). (FR-ENA-111, FR-ENA-112,
  FR-ENA-130)

- **AC-ENA-052** — Purchase Order + Goods Receipt write-through resolves upstream refs incl. the PO
  item child-row. **[served-fn e2e]**
  **Given** mirrored supplier + upstream refs exist,
  **When** PMO creates a PO (item-row `schedule_date` supplied) then a GR (carrying `purchase_order` +
  `purchase_order_item` child-row name) through the served boundary,
  **Then** the adapter resolves ERP identifiers via `external_refs`, ERPNext commits both docs (PO →
  `To Receive and Bill`; GR submit → PO `To Bill`/`per_received:100`), and PMO mirrors `purchase_orders`
  (`po_number`, `amount`) + `procurement_receipts` (`gr_number`, `po_id`). (FR-ENA-113, FR-ENA-114,
  FR-ENA-103)

- **AC-ENA-053** — Purchase Invoice + Payment Entry AP flow succeeds across the real boundary (R9 mappings
  frozen). **[served-fn e2e]**
  **Given** a mirrored vendor-invoice candidate and the binding's resolved accounts,
  **When** the user creates/submits a Purchase Invoice (non-empty items pre-validated) and then creates+
  submits a Payment Entry (adapter supplies `paid_from`/`paid_to` from `config`, `received_amount`
  explicit, `references[]` to the PI) through the served boundary,
  **Then** ERPNext commits both AP docs, PMO mirrors `procurement_invoices.amount`/`erp_outstanding_amount`
  and, after the referenced-PE submit, the PI flips `Paid`/`outstanding 0` (mirrored), `payments.amount` =
  the allocated figure, and `payments.invoice_id` links the PI in the same case. (FR-ENA-115, FR-ENA-116,
  FR-ENA-130) *(Now signable — R9 RESOLVED, no `[SPIKE-PENDING]`.)*

- **AC-ENA-054** — Concurrent adopt of the same ERP procurement doc dedupes atomically. **[pgTAP]**
  **Given** an `external_refs` row mapping an ERP doc `name` under `procurement`,
  **When** a second insert maps the same `(org_id, 'procurement', external_record_id)` to a different
  `pmo_record_id`,
  **Then** it is rejected by `unique (org_id, domain, external_record_id)` (`23505`) — one mirror per ERP
  doc. (FR-ENA-103, FR-ENA-081)

### Read-only accounting read-backs (Findings 10, 11)

- **AC-ENA-060** — Actuals are ledger-sourced, snapshot-replaced, provenance-stamped. **[unit]**
  **Given** mirrored `GL Entry` rows,
  **When** PMO refreshes the actuals snapshot,
  **Then** `erp_actuals_snapshot` holds sums of mirrored ledger rows only (no PMO-authored figure), the
  refresh **replaces** the prior scope snapshot (single `as_of`), and `source_report`/`as_of` are stamped.
  (FR-ENA-150, FR-ENA-073)

- **AC-ENA-061** — Aging snapshot comes from report truth with pinned filters + provenance; invoice-only
  math is absent. **[served-fn e2e]**
  **Given** an ERPNext org with open AP/AR entries and the aging-report binding configured,
  **When** PMO refreshes AP/AR aging through the served boundary,
  **Then** `erp_ap_aging_snapshot`/`erp_ar_aging_snapshot` store report-backed buckets verbatim with
  `report_date`/`range_labels`/`ageing_based_on`/`as_of`/`report_version`, snapshot-replaced per scope, and
  **no** bucket is computed by invoice-only local math over `procurement_invoices`. (FR-ENA-160, FR-ENA-161,
  FR-ENA-162)

### Change-feed and RLS

- **AC-ENA-070** — Webhook signature is the trust boundary. **[unit]**
  **Given** an inbound ERPNext webhook,
  **When** `X-Frappe-Webhook-Signature` is invalid/absent vs valid,
  **Then** invalid/absent → `401`, no side effect; valid → applied as a hint. (FR-ENA-082, FR-ENA-083)

- **AC-ENA-071** — Modified-poll cursor is inclusive, deduped, and out-of-order-guarded. **[unit]**
  **Given** two ERPNext changes sharing a `modified` timestamp at a watermark boundary, and a later older
  change,
  **When** the sweep runs from that watermark,
  **Then** both boundary changes are seen exactly once, the watermark advances monotonically (max
  `modified`), and the older change is a no-op via the per-row `erp_modified` `>=` guard. (FR-ENA-080,
  FR-ENA-081, FR-ENA-083, NFR-ENA-FEED-001)

- **AC-ENA-072** — Flipped native mirror writes are machine-only; enhancements stay user-writable; the case
  aggregate stays PMO-owned. **[pgTAP]**
  **Given** an org with `companies` or `procurement` externally-owned,
  **When** a user JWT writes a native mirrored field (e.g. `procurement_invoices.amount`,
  `purchase_orders.po_number`, `companies.name`),
  **Then** RLS denies it (`42501`); **and when** the service role writes the mirror, it succeeds; **and
  when** a user writes an enhancement (`procurement_quotations.is_selected`, `companies.archived_at`) or the
  `procurements` case aggregate, it still succeeds. (FR-ENA-170, FR-ENA-171, NFR-ENA-SEC-003,
  NFR-ENA-SEC-004)

- **AC-ENA-073** — Binding requires a v15 handshake; a mismatched major does not activate. **[unit]**
  **Given** a new `external_org_bindings` row,
  **When** the version handshake returns `version_major ≠ 15`,
  **Then** the binding is not activated (`activated_at` stays null) and money commands for that org are
  refused as config-rejected. (FR-ENA-012)

---

## 9. Traceability

| AC | Requirement(s) | Owning layer | Planned proof |
|---|---|---|---|
| AC-ENA-001 | FR-ENA-004, FR-ENA-005 | Vitest (unit) | `pmo-portal/src/lib/repositories/procurement.external.test.ts` |
| AC-ENA-002 | FR-ENA-004 | **Cross-layer regression gate** — the unchanged existing procurement/companies suite (`npm run verify` + pgTAP + e2e) staying green IS the proof; no single new test (mirrors AC-EAS-003 / AC-CUA-002) |
| AC-ENA-003 | FR-ENA-004, FR-ENA-170 | pgTAP | `supabase/tests/erpnext_procurement_flip_rls.test.sql` |
| AC-ENA-010 | FR-ENA-040..045, NFR-ENA-IDEM-001 | served-fn e2e | `pmo-portal/e2e/AC-ENA-010-payment-idempotency.spec.ts` |
| AC-ENA-011 | FR-ENA-042, FR-ENA-013 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/client.test.ts` |
| AC-ENA-012 | FR-ENA-041 | pgTAP | `supabase/tests/external_command_outbox_rls.test.sql` |
| AC-ENA-013 | FR-ENA-045 | served-fn e2e | `pmo-portal/e2e/AC-ENA-013-pi-recovery-adopt.spec.ts` |
| AC-ENA-020 | FR-ENA-052 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` |
| AC-ENA-021 | FR-ENA-053, NFR-ENA-DOC-001 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` |
| AC-ENA-022 | FR-ENA-053 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` |
| AC-ENA-023 | FR-ENA-050, FR-ENA-051 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` |
| AC-ENA-030 | FR-ENA-070, FR-ENA-071, NFR-ENA-MONEY-001 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` |
| AC-ENA-031 | FR-ENA-070, FR-ENA-072 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` |
| AC-ENA-040 | FR-ENA-090, FR-ENA-092 | served-fn e2e | `pmo-portal/e2e/AC-ENA-040-supplier-write-through.spec.ts` |
| AC-ENA-041 | FR-ENA-093, FR-ENA-091 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.test.ts` |
| AC-ENA-042 | FR-ENA-091 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.test.ts` |
| AC-ENA-050 | FR-ENA-110, FR-ENA-044 | served-fn e2e | `pmo-portal/e2e/AC-ENA-050-purchase-request.spec.ts` |
| AC-ENA-051 | FR-ENA-111, FR-ENA-112, FR-ENA-130 | served-fn e2e | `pmo-portal/e2e/AC-ENA-051-rfq-quotation.spec.ts` |
| AC-ENA-052 | FR-ENA-113, FR-ENA-114, FR-ENA-103 | served-fn e2e | `pmo-portal/e2e/AC-ENA-052-po-gr.spec.ts` |
| AC-ENA-053 | FR-ENA-115, FR-ENA-116, FR-ENA-130 | served-fn e2e | `pmo-portal/e2e/AC-ENA-053-pi-payment.spec.ts` |
| AC-ENA-054 | FR-ENA-103, FR-ENA-081 | pgTAP | `supabase/tests/external_refs_adopt_unique.test.sql` |
| AC-ENA-060 | FR-ENA-150, FR-ENA-073 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts` |
| AC-ENA-061 | FR-ENA-160, FR-ENA-161, FR-ENA-162 | served-fn e2e | `pmo-portal/e2e/AC-ENA-061-aging-readback.spec.ts` |
| AC-ENA-070 | FR-ENA-082, FR-ENA-083 | Vitest (unit) | `supabase/functions/erpnext-webhook/index.test.ts` |
| AC-ENA-071 | FR-ENA-080, FR-ENA-081, FR-ENA-083, NFR-ENA-FEED-001 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.test.ts` |
| AC-ENA-072 | FR-ENA-170, FR-ENA-171, NFR-ENA-SEC-003/004 | pgTAP | `supabase/tests/erpnext_money_flip_rls.test.sql` (+ per-table §7 files) |
| AC-ENA-073 | FR-ENA-012 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts` |

> NFR-ENA-SEC-001/002, CONTRACT-001, PERF-001/002, REV-001, DEVBED-001 are structural — proven transitively
> (no-custom-app + secret-confinement + vocabulary-confinement + cached-map short-circuit + reversibility
> are preconditions exercised by the rows above) and reviewed at the plan/gate. NFR-ENA-IDEM-001 /
> DOC-001 / MONEY-001 / FEED-001 are owned by AC-ENA-010/013, AC-ENA-021/022, AC-ENA-030/031, AC-ENA-071
> respectively. AC-ENA-002 is a regression-gate meta-AC by nature (Finding 1's cross-layer traceability
> row, mirroring FR-EAS-010/AC-EAS-001).

---

## 10. Error handling

| Condition | Classification | Required behavior |
|---|---|---|
| ERP validation rejection (`MandatoryError`/`ValidationError`/`InvalidQtyError`) | `commit-rejected` | Parse `exc_type` then `_server_messages`; surface ERP message; no local mirror mutation before ERP truth changes |
| Empty/missing `items` on a money doc → `500 TypeError` | `commit-rejected` (non-retryable) | Client pre-validates non-empty items; distinct non-retryable bucket — **never blind-retried** (FR-ENA-042) |
| Bad link (`DoesNotExistError` / 404) | `commit-rejected` | Surface; resolve refs via `external_refs`, never a raw client id |
| ERP unreachable / timeout / 5xx-after-budget | `external-unreachable` | Fail honestly; preserve read-model; retry only through the guarded idempotency flow (FR-ENA-043) |
| Retry after post-commit mirror failure | guarded reconcile | Reconcile/adopt via outbox `committed`/`remarks`-key probe; **never** re-create the money doc |
| Duplicate `idempotency_key` (concurrent) | `23505` (outbox unique) | One command proceeds; the loser reconciles to the winner's result |
| `UpdateAfterSubmitError` on a submitted doc | route to transition | Issue cancel+amend, never illegal write-after-submit (FR-ENA-050) |
| Cancel blocked by linked submitted docs (`LinkExistsError`) | `commit-rejected` | Surface the blocking doc; cancel the chain in reverse order (FR-ENA-051); no fake PMO cancel |
| Delete of a once-submitted money doc (`LinkExistsError` via Payment Ledger) | not attempted | Cancel-only + soft-tombstone (OQ-8, FR-ENA-052) |
| Over-`numeric(14,2)` header total | `commit-rejected` (config) | Reject, never truncate (FR-ENA-072) |
| Invalid webhook signature | `401` / no side effect | Reject as untrusted (FR-ENA-082) |
| Out-of-order older `modified` event | no-op | Per-row `erp_modified` `>=` guard (FR-ENA-053/083) |
| Ambiguous party match during adopt | `action-required` | Operator resolution; do not auto-merge (FR-ENA-093) |
| Unsupported ERP `version_major ≠ 15` | config rejection | Binding not activated (`activated_at` null) (FR-ENA-012) |

---

## 11. Implementation TODO checklist

- [ ] Slice zero: served-edge-function money lane wrapper + health gate + **named server-side fault seams**
      (`ERPNEXT_TEST_FAULTS`, `x-erpnext-test-fault`) + ERPNext Docker v15 dev-bed docs (localhost:8080).
- [ ] Contract: add `idempotencyKey` to `AdapterCommand` (`contract.ts`); generalize dispatch for one tier /
      many domains (`routeDomainWrite`); per-domain read-model writer registry.
- [ ] Storage: `external_org_bindings`, `external_command_outbox` (unique 4-tuple), `external_ref_lineage`,
      the three snapshot tables — reversible migrations + RLS + pgTAP.
- [ ] `erpnext/client.ts`: token auth, `exc_type`/`_server_messages` classifier (incl. 500-`TypeError`
      non-retryable bucket), 429/`Retry-After` backoff **with no-blind-retry guard**, two-step create→submit.
- [ ] Binding + version handshake + per-org credential resolution (`secret_ref` → vault `AS`/function
      secrets) + `GET Company/<name>` defaults cache.
- [ ] Idempotency: outbox write-before-commit + `remarks`-key stamp + atomic recovery (pending/committed/
      confirmed/failed) + sweep-adopt of orphaned commits.
- [ ] Transition/lineage: submit/cancel/amend, chain-reverse cancel, `amended_from` repoint +
      `external_ref_lineage`, out-of-order `erp_modified` guard.
- [ ] Parties flip: `Supplier`/`Customer` create/update + collision rule + pull-adopt + ambiguous-match +
      `contacts` mirror + flip migration + pgTAP.
- [ ] Procurement flip: doctype registry MR/RFQ/SQ/PO/GR/PI/PE with the R9-frozen bodies/traps; per-table
      flip migrations + pgTAP (§7); multi-domain external-ref resolver (PO item child-row).
- [ ] Amount transport: decimal-string end-to-end, `erp_line_amount` column, money-oracle header mirror,
      null/over-scale handling.
- [ ] Change-feed: ERPNext webhook ingress (HMAC) + modified-poll sweep (reuse hoisted P1 engine).
- [ ] Actuals + AP/AR aging snapshots: report-RPC primary (pinned filters) + mirrored-ledger fallback +
      snapshot replacement + provenance.
- [ ] Verification: `npm run verify` (incl. AC-ENA-002 regression net) + `scripts/with-db-lock.sh supabase
      test db` + served-fn e2e against the Docker v15 bench.

---

## 12. Explicit residual risks

- **R1 / R3** accepted only with the idempotency contract + `external_command_outbox` + atomic recovery in
  place, proven at the real served boundary with the `after-commit-before-mirror` fault seam; no build ships
  money writes without it.
- **R2** accepted only with first-class submit/cancel/amend + `amended_from` lineage +
  `external_ref_lineage` + out-of-order `erp_modified` guard.
- **R4** accepted only with decimal-string transport + numeric-only persistence + the documented
  `procurement_items.amount` GENERATED-column divergence tolerance (money oracle = ERP header).
- **R9 RESOLVED** — PI/PE/PO/GR mappings frozen from `docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md`;
  AC-ENA-053 is signable. No `[SPIKE-PENDING]` remains.
- **R10** (aging report-filter drift) mitigated by version-pinned filters (`get_script` introspection stored
  in binding `config`) with the ADR-0048-constrained mirrored-ledger fallback.
- **R13** (ERP permission doctrine) — the per-org integration user needs full **read** perms on the flipped
  doctypes + reports (a binding-activation precondition, FR-ENA-084); PMO RLS remains the user-facing
  authority.

---

## 13. Out-of-scope reminders for implementation

- Do not add sales-document / receivables writes (AR aging is read-only display).
- Do not add budget projection / version sync here.
- Do not design around a required ERP helper app.
- Do not recompute ERP accounting truth locally (money oracle = mirrored ERP header/ledger; invoice-only
  aging math prohibited).
- Do not hard-delete a money document (cancel-only + soft-tombstone — stock REST enforces it).
- Do not thread `org_id` from the client or send ERP vocabulary above the adapter contract.
- Do not use `page.route` in a money-command e2e — use the served boundary + server-side fault seams.

SPEC-DONE
