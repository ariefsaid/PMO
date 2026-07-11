# Spec: ERPNext adapter — money core (ADR-0055 P2, with the owner's full-chain money-core ruling)

> **Status:** Draft for owner sign-off.
>
> **Authority:** ADR-0055 §5/§6/§8, ADR-0048 standing ledger-sourced-display rule, `docs/specs/external-adapter-seam.spec.md` (P0), `docs/specs/clickup-adapter.spec.md` (P1 patterns), `docs/spikes/2026-07-11-p2-intake-research.md` (grounding synthesis; risks R1-R4/R9 and slice map are binding inputs), `docs/glossary.md` §Integration, `CLAUDE.md` spec/test conventions.
>
> **Owner intake rulings (binding):** full procurement chain in one P2 (parties + PR/RFQ/SQ/PO/GR/PI/Payment flip + AP commands + actuals/AP-AR aging read-back); dev bed = fresh stock Docker ERPNext v15; served-edge-function e2e is slice zero and every money-command e2e uses the **real served function boundary** (never `page.route`); no deadline.

## 0. Job story

> **When a client employs ERPNext as the money source of truth, PMO must let users operate the full buy-side chain and read financial truth from PMO while ERPNext remains the sole writer of committed/happened money.**

PMO stays the app layer and user surface; ERPNext owns the native money objects; Supabase holds the read-model plus PMO-only enhancements. Commands go down synchronously, change-feed truth comes up via webhooks + sweep, and PMO never recomputes ERP figures beyond mirroring or summing mirrored ledger rows per ADR-0048.

---

## 1. Overview and user value

P2 is the first ERP adapter and the first money adapter. It extends the shipped seam from P0 and the real-adapter patterns from P1 to a stock ERPNext v15 instance with **no custom app required**. It flips three groups of domains for employing orgs:

1. **Parties** — PMO `companies` become the read-model/enhancement layer over ERPNext `Supplier` and `Customer`.
2. **Procurement chain** — PMO's procurement case + record tables become the read-model/enhancement layer over ERPNext stock buy-side doctypes: Material Request (Purchase), Request for Quotation, Supplier Quotation, Purchase Order, Purchase Receipt, Purchase Invoice, Payment Entry.
3. **Accounting read-backs** — actuals plus AP/AR aging are mirrored into PMO read-only snapshots, sourced from ERPNext ledger/report truth.

User value:
- procurement/admin users can run the full buy-side chain from PMO without double-keying;
- finance sees AP outcomes and aging from ERP truth in PMO;
- PMO preserves its richer case-folder UX, enhancement state, and tenant/RLS model;
- ERP-side edits remain legitimate and reconcile back because ERPNext is the source of truth.

---

## 2. Scope

### In scope
- One **`erpnext`** adapter speaking stock Frappe/ERPNext REST only.
- Served-edge-function test lane as slice zero for adapter-dispatch through the real function boundary.
- Per-org ERPNext binding, credential resolution, version handshake, and doctype registry.
- `companies` ↔ ERPNext `Supplier` / `Customer` flip.
- Full procurement-chain flip: PR/RFQ/SQ/PO/GR/PI/Payment over PMO procurement read-models.
- AP command surface, including submit/cancel/amend semantics.
- Actuals read-back from ERP ledger truth.
- AP/AR aging read-back.
- Webhook ingress + modified-poll reconciliation sweep.
- Idempotency / provisional-ref protection for money commands.

### Out of scope
- Sales money documents / Revenue-AR commands (`Quotation`, `Sales Order`, `Sales Invoice`) — **P3+ and explicitly out here**.
- Odoo adapter — P4.
- e-Faktur, statutory close, period-close workflows, and other native ERP desk workflows — stay ERPNext-native per ADR-0048.
- Budget projection/versioned-plan sync — separate issue under ADR-0055 §6.
- PMO recomputation of ERP figures beyond mirrored full-row upserts and ledger-row summation.
- Any helper app requirement in ERPNext.

---

## 3. Decided defaults for open questions

### [OWNER-DECISION] OQ-1 — PMO PR ↔ ERPNext stock doctype
**Default for sign-off:** PMO Purchase Request maps to **ERPNext `Material Request` with `material_request_type = 'Purchase'`**. PMO retains richer chain/display state in enhancement columns; ERPNext owns the native request document.

### OQ-2 — Domain granularity for the chain
**Resolved here:** ownership flips as one PMO domain, **`procurement`**, with internal sub-doctype routing in the ERPNext adapter registry. This avoids incoherent partial ownership across PR/PO/PI/Payment.

### [OWNER-DECISION] OQ-3 — Aging source
**Default for sign-off:** aging read-back uses the authoritative ERPNext **report RPC** (`frappe.desk.query_report.run`) and mirrors the returned buckets into PMO snapshots. If the binding-time probe proves a report-shape incompatibility for that ERPNext minor, the implementation may temporarily fall back to mirrored bucket math, but the default product contract is report truth.

### [OWNER-DECISION] OQ-4 — Customer scope in P2
**Default for sign-off:** P2 flips **both Suppliers and Customers** under the `companies` surface. Supplier write paths are required for procurement; Customer mirroring is included because AR aging is in scope even though sales-document commands are not.

### OQ-5 — Amount representation at the adapter boundary
**Resolved here:** all money and quantity values cross the adapter contract as **decimal strings**. They are written to PMO `numeric` columns and ERPNext request bodies without JS float math.

### OQ-6 — Org binding shape
**Resolved here:** ERPNext bindings are **per-org**, not per-project. The implementation may use an org-sentinel row on the P0 binding seam or a dedicated org-binding table, but the spec contract is org-level resolution.

### [OWNER-DECISION] OQ-7 — AP command surface
**Default for sign-off:** P2 includes create/update-draft plus explicit `transition` commands for **submit / cancel / amend** on Purchase Invoice, create+submit for Payment Entry, and explicit cancel for Payment Entry where ERPNext permits it.

### [OWNER-DECISION] OQ-8 — Delete tracking policy
**Default for sign-off:** money doctypes are **cancel-first, never hard-delete in PMO flows**. Change-feed deletion handling exists for non-submittable doctypes and emergency ERP-side hard deletes, but normal product behavior uses cancel/amend, not delete.

---

## 4. Functional requirements (EARS)

## 4.1 Slice zero — served-edge-function money boundary

- **FR-ENA-001** — The system shall provide a served-edge-function adapter lane for the ERPNext money adapter, so every money-command end-to-end acceptance test exercises the real `adapter-dispatch` function boundary through Supabase serve/Kong rather than `page.route` or a direct in-process mock.
- **FR-ENA-002** — When the local money e2e lane runs, the system shall target a fresh stock Docker ERPNext v15 dev bed pinned to the researched minor line and a real served `adapter-dispatch` function, proving command behavior against the same boundary production uses.

## 4.2 ERPNext tier core

- **FR-ENA-010** — The system shall provide one **`erpnext` adapter** implementing the P0 adapter contract, with ClickUp-style domain routing generalized so one external tier can own multiple PMO domains.
- **FR-ENA-011** — The ERPNext adapter shall resolve credentials and binding config **per org**, not per project, including site URL, API key/secret, company defaults, warehouse defaults, naming/default slots, and webhook secret.
- **FR-ENA-012** — When an ERPNext binding is created or refreshed, the adapter shall perform a **version handshake** against ERPNext and gate behavior by major version; P2 targets ERPNext v15 semantics.
- **FR-ENA-013** — The ERPNext client shall speak stock Frappe REST with token auth and shall classify ERP/Frappe error payloads into the P0 adapter error contract.
- **FR-ENA-014** — The ERPNext adapter shall own a doctype registry mapping PMO domain + PMO operation to ERPNext doctype, body mapper, read mapper, docstatus policy, and read-only/write-capable status.

## 4.3 Money idempotency and post-commit safety (R1, R3)

- **FR-ENA-020** — The adapter contract shall extend `AdapterCommand` with a client-generated **`idempotencyKey`** for every non-read-only ERPNext money command.
- **FR-ENA-021** — Before issuing a non-idempotent ERPNext create/submit command, the dispatch shall persist a **provisional external reference / outbox marker** keyed by `(org, domain, pmo_record_id, idempotencyKey)` so a retry after timeout/429/post-commit mirror failure cannot create a duplicate ERP money document.
- **FR-ENA-022** — When a retry reaches the dispatch with an already-seen `idempotencyKey`, the system shall reconcile to the prior external commit result or its provisional-ref state rather than issuing a second ERP create.
- **FR-ENA-023** — The ERPNext client shall never blindly retry a non-idempotent POST unless the idempotency guard proves the first attempt did not commit or can be reconciled safely.
- **FR-ENA-024** — When an ERP command commits in ERPNext but PMO fails before mirror/ref finalization, the next retry or sweep shall adopt and finish the existing record rather than minting a duplicate PMO mirror row.

## 4.4 Transition semantics, docstatus, cancel/amend lineage (R2)

- **FR-ENA-030** — The adapter shall treat ERPNext **`transition`** as a first-class PMO adapter operation for submittable doctypes, covering `submit`, `cancel`, and `amend` semantics explicitly.
- **FR-ENA-031** — When a PMO command targets a submitted ERPNext record that requires content change, the adapter shall use ERPNext's native **cancel + amend** flow rather than attempting an illegal update-after-submit.
- **FR-ENA-032** — When ERPNext amends a document and produces a **new `name`**, the change-feed and mirror-apply logic shall link the amended document to the existing PMO mirror via `amended_from` lineage and update `external_refs`, rather than adopting a duplicate mirror row.
- **FR-ENA-033** — Cancellation failures caused by ERPNext linked-document rules shall surface honestly to the caller and shall not mutate the PMO mirror until ERP truth changes.

## 4.5 Amount transport and mirror writes (R4)

- **FR-ENA-040** — The adapter contract shall represent money, rate, quantity, outstanding, and total values as **decimal strings** end-to-end across dispatch, adapter, webhook apply, and sweep apply.
- **FR-ENA-041** — The PMO money read-model tables shall store monetary values in `numeric` columns only; no mirrored ERP figure shall be stored in `float8` or recomputed through JS float math.
- **FR-ENA-042** — Inbound ERP changes shall apply as **full-row upserts** of native mirrored fields so re-apply is idempotent and PMO never drifts by partial local recomputation.

## 4.6 Change-feed mechanics: modified poll + webhook hints

- **FR-ENA-050** — The ERPNext change-feed shall use **`modified` polling** as its source-of-truth sweep cursor, per org × doctype watermark.
- **FR-ENA-051** — The sweep shall query each doctype with an **inclusive boundary** (`>=` semantics) and dedupe by ERP document name so no record sharing the boundary timestamp is skipped.
- **FR-ENA-052** — The system shall provide an ERPNext webhook ingress function that verifies `X-Frappe-Webhook-Signature` HMAC over the raw payload body before applying any hint.
- **FR-ENA-053** — ERPNext webhooks shall be treated as **lossy latency hints only**; the modified-poll sweep is the convergence authority.
- **FR-ENA-054** — ERP-side edits made in the ERPNext desk shall be treated as legitimate source-of-truth changes and shall reconcile back into PMO through webhook and/or sweep.

## 4.7 Parties domain (`companies` ↔ Supplier / Customer)

- **FR-ENA-060** — Where the `companies` domain is externally-owned by ERPNext, PMO `companies` shall be a machine-written read-model plus PMO-only enhancements over ERPNext `Supplier` and `Customer`.
- **FR-ENA-061** — The adapter shall support synchronous **create** and **update** commands for ERPNext `Supplier` and `Customer` using stock REST, returning the canonical PMO-shaped company mirror.
- **FR-ENA-062** — The parties adapter shall support **pull-adopt** of pre-existing ERPNext suppliers/customers, because mixed-state onboarding is normal and the P1 reject-both-non-empty pattern does not apply here.
- **FR-ENA-063** — The parties onboarding flow shall support deterministic matching by at least ERP name and optional tax/business identifier, and shall surface ambiguous matches for operator resolution rather than auto-merging incorrectly.
- **FR-ENA-064** — Supplier display in PMO shall prefer ERPNext `supplier_name` and fall back to `name`; Customer display shall prefer `customer_name` and fall back to `name`.
- **FR-ENA-065** — Customer `payment_terms` / credit-days information shall mirror into PMO as read-model data for due-date and aging display; PMO shall not author its own receivables terms truth.

## 4.8 Procurement domain flip (one PMO domain, many ERP doctypes)

- **FR-ENA-070** — The PMO **`procurement`** domain shall flip as one externally-owned domain for employing orgs, with the ERPNext adapter internally routing by sub-doctype across Material Request, Request for Quotation, Supplier Quotation, Purchase Order, Purchase Receipt, Purchase Invoice, and Payment Entry.
- **FR-ENA-071** — While `procurement` is externally-owned, PMO procurement tables shall act as the **read-model plus enhancement layer**: native ERP fields are machine-written only, while PMO-only enhancement fields remain PMO-owned.
- **FR-ENA-072** — The PMO procurement **case folder** remains the user-facing aggregate and enhancement surface, but ERPNext native document existence and native fields are authoritative for the flipped chain.
- **FR-ENA-073** — PMO shall derive its procurement display stage/status locally from mirrored ERP truth and PMO enhancement state; it shall never attempt to overwrite ERPNext's derived `status` field or rely on custom ERP fields.

## 4.9 Material Request / Purchase Request

- **FR-ENA-080** — A PMO Purchase Request command shall map to ERPNext **`Material Request`** with `material_request_type = 'Purchase'`.
- **FR-ENA-081** — When creating a purchase Material Request, the adapter shall enforce the researched stock-safe rules: quantity > 0, amount/rate > 0, `rate = amount / qty`, ERP company resolution from binding/defaults, item/UOM resolution, schedule date defaulting, and any mandatory total stamping required by stock ERPNext.
- **FR-ENA-082** — PMO approval workflow and SoD policy shall gate the **submit** command for Purchase Request, but ERPNext remains the native document owner once submitted.

## 4.10 RFQ and Supplier Quotation

- **FR-ENA-090** — The adapter shall support Request for Quotation creation/read-back against ERPNext stock `Request for Quotation`.
- **FR-ENA-091** — The adapter shall support Supplier Quotation creation/read-back against ERPNext stock `Supplier Quotation`.
- **FR-ENA-092** — PMO shall enforce the **one-selected-quotation invariant** and supplier-stamping enhancement logic locally; ERPNext quote documents are evidence and source documents, but PMO owns the comparison UX/state.
- **FR-ENA-093** — A mirrored Supplier Quotation shall carry amount and validity fields needed by PMO's existing procurement UX and later comparison features.

## 4.11 Purchase Order and Goods Receipt

- **FR-ENA-100** — The adapter shall support Purchase Order create/read/submit against stock ERPNext `Purchase Order`.
- **FR-ENA-101** — Purchase Order create shall resolve cross-document references, including supplier and upstream request/quotation linkage, through `external_refs` rather than raw PMO ids.
- **FR-ENA-102** — The adapter shall support Purchase Receipt create/read/submit against stock ERPNext `Purchase Receipt`.
- **FR-ENA-103** — Warehouse and stock defaults required for Purchase Receipt creation shall resolve from the org binding config, not from PMO client input.
- **FR-ENA-104** — PMO's committed-spend and procurement read-models shall mirror Purchase Order and Purchase Receipt amounts from ERP truth, never recomputing them locally.

## 4.12 Purchase Invoice and Payment Entry (R9)

- **FR-ENA-110** — The adapter shall support Purchase Invoice create/read/submit/cancel/amend against stock ERPNext `Purchase Invoice`.
- **FR-ENA-111 [SPIKE-PENDING R9]** — The exact mandatory-field mapping for Purchase Invoice create/update/submit shall be finalized from the live stock ERPNext v15 spike before implementation sign-off; until then the spec contract is that the adapter uses stock-safe mandatory defaults and returns ERP validation messages honestly.
- **FR-ENA-112** — PMO paid-state display for vendor invoices shall derive from mirrored ERPNext truth, including `outstanding_amount` and linked submitted Payment Entry references.
- **FR-ENA-113** — The adapter shall support Payment Entry create/read/submit and, where ERPNext permits, cancel/amend against stock ERPNext `Payment Entry`.
- **FR-ENA-114 [SPIKE-PENDING R9]** — The exact mandatory-field mapping for Payment Entry, including party/account/default-account/reference allocation rules, shall be finalized from the live stock ERPNext v15 spike before implementation sign-off.
- **FR-ENA-115** — Payment Entry create shall write child reference rows linking the payment to the mirrored Purchase Invoice and allocated amount, and shall surface ERP validation failures without local guesswork.

## 4.13 Actuals and aging read-only domains

- **FR-ENA-120** — The system shall provide a read-only **actuals** mirror sourced from ERPNext ledger truth (`GL Entry` or an authoritative ERP ledger read), scoped by project/cost-center rules defined in the binding.
- **FR-ENA-121** — PMO actuals display shall follow ADR-0048's **ledger-sourced display** rule: PMO may mirror or sum mirrored ledger rows, but shall never invent its own accounting truth.
- **FR-ENA-122** — The system shall provide read-only **AP aging** and **AR aging** snapshots sourced from ERPNext's authoritative report RPC by report date and bucket filters.
- **FR-ENA-123** — PMO shall treat aging as read-only in P2: no sales-document or receivables write command is introduced by including AR aging.
- **FR-ENA-124** — Aging snapshots shall carry enough metadata to show the as-of date, bucket ranges, and source report identity used to produce the PMO display.

## 4.14 PMO read-model and RLS flip observables

- **FR-ENA-130** — While `companies` or `procurement` are externally-owned for an org, the corresponding PMO mirrored native fields shall be **machine-written only**; user-JWT writes to native mirrored fields are denied by RLS, and sync/dispatch service-role writes are permitted.
- **FR-ENA-131** — PMO enhancement fields and PMO-only relationships that do not duplicate ERP native fields shall remain writable through existing PMO policies while the mirrored native fields are externally-owned.
- **FR-ENA-132** — Reads for flipped domains shall continue to serve from Supabase read-model tables and repositories only; no UI/read path may synchronously query ERPNext directly.

---

## 5. Non-functional requirements

- **NFR-ENA-SEC-001** — The adapter shall require no ERP custom app and shall speak only stock ERPNext/Frappe APIs.
- **NFR-ENA-SEC-002** — Per-org ERP credentials and webhook secrets are server-only and never reach browser code or mirrored tables.
- **NFR-ENA-SEC-003** — RLS remains the enforcement authority for PMO mirrors and enhancement tables; client/router branching is UX only.
- **NFR-ENA-SEC-004** — Every externally-owned money table flip shall preserve the `org_id` seam and ship pgTAP proofs for org isolation and machine-only native writes.
- **NFR-ENA-IDEM-001** — The idempotency contract of FR-ENA-020..024 shall make duplicate Purchase Invoice or Payment Entry creation impossible under retry-after-timeout / 429 / mirror-finalization failure conditions. **(R1, R3)**
- **NFR-ENA-DOC-001** — The docstatus/lineage contract of FR-ENA-030..033 shall prevent duplicate PMO mirrors during cancel/amend rename flows. **(R2)**
- **NFR-ENA-MONEY-001** — Decimal-string amount transport and numeric-column persistence shall eliminate JS float drift in money mirrors. **(R4)**
- **NFR-ENA-FEED-001** — The sweep cursor shall be monotonic per org × doctype and tolerant of equal-boundary timestamps through inclusive polling plus idempotent dedupe.
- **NFR-ENA-PERF-001** — The adapter shall batch and page ERPNext change-feed and report calls conservatively enough for stock ERPNext rate/worker realities, with interactive commands prioritized over background sweep work.
- **NFR-ENA-TEST-001** — Each acceptance criterion shall have exactly one owning test at the lowest sufficient layer: unit, pgTAP, or served-function e2e. Money-command e2e ownership shall use the real served function boundary.
- **NFR-ENA-DEVBED-001** — The canonical P2 dev/test bed is a fresh stock Docker ERPNext v15 stack pinned to the researched minor line; the broken legacy bench is not part of the supported path.

---

## 6. Acceptance criteria (Given/When/Then)

### Slice zero / boundary

- **AC-ENA-001** — Served-function money boundary is real. **[served-fn e2e]**
  **Given** the local adapter lane is started against served Supabase functions and a stock Docker ERPNext v15 site,
  **When** a money command is issued through `adapter-dispatch`,
  **Then** the request crosses the real function boundary and returns the function's real classification/result without `page.route` interception. (FR-ENA-001, FR-ENA-002)

### Idempotency / post-commit safety

- **AC-ENA-010** — Duplicate retry cannot double-create a Payment Entry. **[served-fn e2e]**
  **Given** a Payment Entry command with an `idempotencyKey` whose first attempt commits in ERPNext but the PMO response path is interrupted,
  **When** the exact command is retried,
  **Then** ERPNext contains one payment document, PMO reconciles to that document, and no duplicate mirror row is created. (FR-ENA-020..024, NFR-ENA-IDEM-001)

- **AC-ENA-011** — Non-idempotent blind retry is blocked. **[unit]**
  **Given** a non-idempotent create command lacking safe reconciliation proof,
  **When** the ERP client receives a retryable transport failure,
  **Then** it refuses to blindly retry the POST and surfaces the need for guarded reconciliation. (FR-ENA-023)

### Cancel/amend / lineage

- **AC-ENA-020** — Cancel/amend rename reconciles to one mirror. **[unit]**
  **Given** a submitted ERPNext Purchase Invoice that is cancelled and amended into a new ERP `name`,
  **When** webhook or sweep applies the amended document,
  **Then** the PMO mirror links through `amended_from`, updates the existing mirror/ref lineage, and does not mint a duplicate PMO mirror row. (FR-ENA-030..032, NFR-ENA-DOC-001)

- **AC-ENA-021** — Illegal update-after-submit is routed to transition semantics. **[unit]**
  **Given** a PMO edit targeting a submitted stock ERPNext money document,
  **When** native ERP semantics require amend rather than update,
  **Then** the adapter issues the transition path and does not attempt illegal write-after-submit mutation. (FR-ENA-030, FR-ENA-031)

### Amount transport / mirror write shape

- **AC-ENA-030** — Decimal strings round-trip without float drift. **[unit]**
  **Given** ERP and PMO money values with cents and fractional quantities,
  **When** they cross the adapter boundary and are mirrored into PMO numerics,
  **Then** the canonical values are preserved exactly and no JS float rounding artifact is introduced. (FR-ENA-040..042, NFR-ENA-MONEY-001)

### Parties

- **AC-ENA-040** — Supplier create/write-through succeeds through ERP truth. **[served-fn e2e]**
  **Given** an org employing ERPNext for companies and a new vendor company in PMO,
  **When** the user creates the supplier through the real served adapter-dispatch boundary,
  **Then** ERPNext `Supplier` is created, the PMO company mirror is updated from ERP's answer, and the external ref is recorded. (FR-ENA-060, FR-ENA-061, FR-ENA-064)

- **AC-ENA-041** — Existing ERP party pull-adopt is idempotent. **[unit]**
  **Given** a pre-existing ERP Supplier or Customer and no PMO mapping yet,
  **When** pull-adopt runs twice,
  **Then** one PMO mirror row and one mapping exist for that ERP party. (FR-ENA-062, FR-ENA-063)

### Procurement chain

- **AC-ENA-050** — Purchase Request maps to Material Request and submits through ERPNext. **[served-fn e2e]**
  **Given** a procurement case with valid items and defaults,
  **When** the PMO user creates/submits the purchase request through the served function boundary,
  **Then** ERPNext creates a purchase `Material Request`, PMO mirrors it back, and the external ref maps the PMO record to the ERP document. (FR-ENA-080..082)

- **AC-ENA-051** — RFQ + Supplier Quotation mirror without breaking PMO quote-selection invariant. **[served-fn e2e]**
  **Given** a procurement case with one RFQ and two supplier quotations,
  **When** the records are pushed and one quotation is selected in PMO,
  **Then** ERPNext holds the native RFQ/quotation documents and PMO preserves one selected quotation in its enhancement/read-model logic. (FR-ENA-090..093)

- **AC-ENA-052** — Purchase Order + Goods Receipt write-through resolves upstream refs. **[served-fn e2e]**
  **Given** mirrored supplier and upstream procurement refs already exist,
  **When** PMO creates a Purchase Order and then a Goods Receipt through the served function boundary,
  **Then** the adapter resolves ERP identifiers through `external_refs`, ERPNext commits both native documents, and PMO mirrors them back. (FR-ENA-100..104)

- **AC-ENA-053** — Purchase Invoice + Payment Entry AP flow succeeds across the real boundary. **[served-fn e2e]**
  **Given** a mirrored vendor invoice candidate and required ERP defaults,
  **When** the user creates/submits a Purchase Invoice and creates/submits a Payment Entry through the served function boundary,
  **Then** ERPNext commits the AP documents, PMO mirrors invoice outstanding/payment truth back, and the payment references the invoice correctly. (FR-ENA-110..115)

### Read-only accounting read-backs

- **AC-ENA-060** — Actuals are ledger-sourced, not PMO-invented. **[unit]**
  **Given** mirrored ledger rows from ERPNext,
  **When** PMO computes its actuals display snapshot,
  **Then** it uses mirrored ERP ledger truth only and does not substitute locally-authored accounting numbers. (FR-ENA-120, FR-ENA-121)

- **AC-ENA-061** — Aging snapshot comes from report truth. **[served-fn e2e]**
  **Given** an ERPNext org with open AP/AR entries and the aging report binding configured,
  **When** PMO refreshes AP/AR aging through the served function boundary,
  **Then** PMO stores and displays the report-backed bucket values with the as-of date and source metadata. (FR-ENA-122..124)

### Change-feed and RLS

- **AC-ENA-070** — Webhook signature is the trust boundary. **[unit]**
  **Given** an inbound ERPNext webhook request,
  **When** `X-Frappe-Webhook-Signature` is invalid or absent,
  **Then** the request is rejected with no side effect; when valid, it may be applied as a hint. (FR-ENA-052, FR-ENA-053)

- **AC-ENA-071** — Modified-poll cursor is inclusive and deduped. **[unit]**
  **Given** two ERPNext changes sharing the same `modified` timestamp at a watermark boundary,
  **When** the sweep runs from that watermark,
  **Then** both changes are seen exactly once in the PMO mirror outcome. (FR-ENA-050, FR-ENA-051, NFR-ENA-FEED-001)

- **AC-ENA-072** — Flipped native mirror writes are machine-only. **[pgTAP]**
  **Given** an org with `companies` or `procurement` externally-owned,
  **When** a user JWT attempts to write a native mirrored field directly,
  **Then** RLS denies the write, and the sync/dispatch service role may perform the mirrored native write. (FR-ENA-130, FR-ENA-131, NFR-ENA-SEC-003, NFR-ENA-SEC-004)

---

## 7. Traceability

| AC | Requirement(s) | Owning layer | Planned proof |
|---|---|---|---|
| AC-ENA-001 | FR-ENA-001, FR-ENA-002 | served-fn e2e | `e2e/AC-ENA-001-money-boundary.spec.ts` |
| AC-ENA-010 | FR-ENA-020..024, NFR-ENA-IDEM-001 | served-fn e2e | `e2e/AC-ENA-010-payment-idempotency.spec.ts` |
| AC-ENA-011 | FR-ENA-023 | unit | `pmo-portal/src/lib/adapterSeam/erpnext/client.test.ts` |
| AC-ENA-020 | FR-ENA-030..032, NFR-ENA-DOC-001 | unit | `pmo-portal/src/lib/adapterSeam/erpnext/amendLineage.test.ts` |
| AC-ENA-021 | FR-ENA-030, FR-ENA-031 | unit | `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` |
| AC-ENA-030 | FR-ENA-040..042, NFR-ENA-MONEY-001 | unit | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` |
| AC-ENA-040 | FR-ENA-060, FR-ENA-061, FR-ENA-064 | served-fn e2e | `e2e/AC-ENA-040-supplier-write-through.spec.ts` |
| AC-ENA-041 | FR-ENA-062, FR-ENA-063 | unit | `pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.test.ts` |
| AC-ENA-050 | FR-ENA-080..082 | served-fn e2e | `e2e/AC-ENA-050-purchase-request.spec.ts` |
| AC-ENA-051 | FR-ENA-090..093 | served-fn e2e | `e2e/AC-ENA-051-rfq-quotation.spec.ts` |
| AC-ENA-052 | FR-ENA-100..104 | served-fn e2e | `e2e/AC-ENA-052-po-gr.spec.ts` |
| AC-ENA-053 | FR-ENA-110..115 | served-fn e2e | `e2e/AC-ENA-053-pi-payment.spec.ts` |
| AC-ENA-060 | FR-ENA-120, FR-ENA-121 | unit | `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts` |
| AC-ENA-061 | FR-ENA-122..124 | served-fn e2e | `e2e/AC-ENA-061-aging-readback.spec.ts` |
| AC-ENA-070 | FR-ENA-052, FR-ENA-053 | unit | `supabase/functions/erpnext-webhook/index.test.ts` |
| AC-ENA-071 | FR-ENA-050, FR-ENA-051, NFR-ENA-FEED-001 | unit | `pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.test.ts` |
| AC-ENA-072 | FR-ENA-130, FR-ENA-131, NFR-ENA-SEC-003, NFR-ENA-SEC-004 | pgTAP | `supabase/tests/erpnext_money_flip_rls.test.sql` |

---

## 8. Error handling

| Condition | Classification | Required behavior |
|---|---|---|
| ERP validation rejection | `commit-rejected` | Surface ERP message; no local mirror mutation before ERP truth changes |
| ERP unreachable / timeout | `external-unreachable` | Fail honestly; preserve read-model; retry only through guarded idempotency flow |
| Retry after post-commit mirror failure | guarded reconcile | Reconcile/adopt prior commit; never re-create money doc |
| Cancel blocked by linked ERP docs | `commit-rejected` | Surface ERP reason; no fake PMO cancel |
| Invalid webhook signature | `401` / no side effect | Reject as untrusted |
| Ambiguous party match during adopt | operator/action-required | Do not auto-merge |
| Unsupported ERP version-major | config rejection | Binding is not activated for P2 semantics |

---

## 9. Implementation TODO checklist

- [ ] Slice zero: served-edge-function money lane wrapper + health gate + ERPNext Docker v15 dev-bed docs.
- [ ] Generalize P0/P1 dispatch for one tier owning multiple domains/doctypes.
- [ ] Add `idempotencyKey` + provisional-ref/outbox protection to the adapter command path.
- [ ] Implement ERPNext client, version handshake, error classifier, and guarded retry policy.
- [ ] Add per-org ERPNext binding + secret resolution.
- [ ] Implement parties flip (`Supplier`, `Customer`) with adopt flow.
- [ ] Implement `procurement` domain routing for MR/RFQ/SQ/PO/PR/PI/PE.
- [ ] Add submit/cancel/amend transition handling with amended-from lineage reconciliation.
- [ ] Add modified-poll sweep + ERPNext webhook ingress with signature verification.
- [ ] Add actuals and AP/AR aging snapshots.
- [ ] Add RLS flips and pgTAP proofs for externally-owned native fields.
- [ ] Finalize Purchase Invoice and Payment Entry mandatory-field maps from the live stock-v15 spike. **[SPIKE-PENDING R9]**

---

## 10. Explicit residual risks

- **R1 / R3** are accepted only with the idempotency/provisional-ref contract in place; no build may ship money writes without it.
- **R2** is accepted only with first-class submit/cancel/amend handling and amended-from adopt logic.
- **R4** is accepted only with decimal-string transport and numeric-only persistence.
- **R9** remains open until the live stock ERPNext mandatory-field spike lands; AP command field maps are provisional until then.

---

## 11. Out-of-scope reminders for implementation

- Do not add sales-document writes.
- Do not add budget projection/version sync here.
- Do not design around a required ERP helper app.
- Do not recompute ERP accounting truth locally.
- Do not use hard delete as the normal PMO path for money documents.

SPEC-DONE
