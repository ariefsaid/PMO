# Spec: Procurement lifecycle (procure-to-pay) module — state machine + ERP audit (Issue: build-wave #2)

Second issue of the build wave. Ships the procurement **write/transition module**: a centralized,
permissive, skippable status state machine driven by a single `transition_procurement()` security-definer
RPC; the role×transition **authorization matrix with separation-of-duties**; the full **ERP document
audit trail** (PR → VQ → PO → GR → VI) with **server-side auto-generated reference numbers**; two new
child tables (`procurement_receipts`, `procurement_invoices`); RLS/tenancy on them; and the procurement
detail/lifecycle UI. This module produces the **Committed-basis** data that the later dashboard `spent`
derivation consumes (OD-BUDGET-2) — it does not consume it.

- **Grounds:** `docs/decisions.md` **OD-PROC-1/2/3/4/6** (binding) + **OD-BUDGET-2** (downstream data
  contract); ADR-0011 (the `security definer` RPC + internal-authz + anon-revoke pattern OD-PROC-4
  mandates); ADR-0009 (read-RPC + anon-revoke precedent); ADR-0010 (test pyramid + AC-id tagging);
  ADR-0003 (DAL), ADR-0005 (TanStack Query). Reuses the write/DAL patterns of `src/lib/db/procurements.ts`,
  the hook pattern of `src/hooks/*`, the `// @ts-expect-error` + `as unknown as <T>` RPC-DAL cast
  established in `dashboard.ts` / `budget.ts`, and `formatCurrency` from `src/lib/format.ts`.
- **Schema baseline — verified `supabase/migrations/0001_init_schema.sql` §5.6:**
  `procurements(id, org_id, code, title, project_id, requested_by_id, status procurement_status
  DEFAULT 'Draft', total_value numeric(14,2), vendor_id, created_at, updated_at)` with
  `unique(org_id, code)`; `procurement_items` (generated `amount = quantity*rate`); `procurement_quotations`
  (`is_selected` + partial unique `procurement_quotations_one_selected_idx`); `procurement_documents`.
  Enum `procurement_status = ('Draft','Requested','Approved','Rejected','Vendor Quoted','Quote Selected',
  'Ordered','Received','Vendor Invoiced','Paid','Cancelled')`. `user_role =
  ('Executive','Project Manager','Finance','Engineer','Admin')`.
- **RLS baseline — verified `supabase/migrations/0002_rls.sql`:** `auth_org_id()` / `auth_role()` are
  `security definer set search_path = public`, sourced from `profiles`. `procurements`: read-in-org;
  **any member may INSERT** (`procurements_insert` — raise a request); UPDATE gated to
  `Admin/Executive/Project Manager/Finance` (`procurements_update`) — but the comment explicitly DEFERS
  the full role×status transition matrix to this module's RPC ("Status transitions go through RPC … full
  role×status matrix DEFERRED §14"). The three existing child tables carry the 4-role write gate **plus a
  parent-org guard** (`exists (… procurements p where p.id = …procurement_id and p.org_id = auth_org_id())`)
  — the audit HIGH-2 lesson this module repeats on its two new tables. `org_id` is client-unspoofable:
  column default (0001) + `with check (org_id = auth_org_id())` (0002).

---

## AS-IS (what exists today)

- The `procurements` aggregate and its three children (`procurement_items`, `procurement_quotations`,
  `procurement_documents`) exist and are seeded; there is a read DAL/UI for procurement listing but **no
  write/transition module** — status is only ever the seeded value, and nothing changes it. There is **no
  centralized state machine**: the only mutation surface is the coarse `procurements_update` RLS policy
  (`update gated to the 4 roles`), which has **no notion of which transitions are legal, who may make each
  one, or separation-of-duties** — it would let any of the 4 roles set any status to any other, including
  illegal jumps and self-approval. The RLS comment defers the real matrix to this module's RPC.
- **No ERP document-number capture.** `procurements` has no `pr_number` / `po_number` /
  `approval_notes` / `rejection_notes`; `procurement_quotations` has no `vq_number` (only a free-text
  `reference`); there is **no goods-receipt and no vendor-invoice table at all**. The generic
  `procurement_documents` table (free `type` + `reference_number` text) is **not** the structured PR/VQ/PO/
  GR/VI audit trail OD-PROC-2 requires and is left as-is (not the mechanism for this issue).
- **No reference-number generator.** Nothing produces the `{PREFIX}-YYMMDD####` daily-reset per-org
  numbers (OD-PROC-3).
- The Committed-basis `spent` derivation (OD-BUDGET-2) does **not** exist yet; `projects.spent` is a
  static seed scalar. This module makes the committed-status data exist; the derivation/dashboard
  consumption is a **later** issue (see OUT).

## Scope (strict in/out)

**IN:**
1. **State machine (OD-PROC-4):** a centralized, **permissive, skippable** transition map defined as
   **data** (a status→{allowed-next-status} superset), driving all status changes through a single
   `transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)`
   **`security definer`** RPC (mirrors ADR-0011). Optional stages are skippable (e.g. `Approved → Ordered`
   directly when there is no formal sourcing; `Vendor Quoted`/`Quote Selected` may be bypassed). One fixed
   superset flow for MVP; the transition map is the OD-PROC-6 seam for future per-org config.
2. **Authorization matrix + SoD (OD-PROC-1):** a flat role×transition gate (NO dollar thresholds),
   re-asserted **inside** the RPC via `auth_role()` / `auth_org_id()`, raising `42501` on deny. Exactly the
   OD-PROC-1 matrix (§FR-PROC-001..009). **Separation-of-duties:** (a) requester ≠ approver of the same
   procurement (`Requested → Approved|Rejected` blocked for `procurements.requested_by_id = auth.uid()`);
   (b) approver ≠ payer (whoever performed the `Requested → Approved` transition may not perform the
   `Vendor Invoiced → Paid`). Admin is break-glass (may perform any transition the map permits, exempt
   from the role-list and SoD checks).
3. **ERP document audit (OD-PROC-2):** schema additions on `procurements` (`pr_number`, `po_number`,
   `approval_notes`, `rejection_notes`) and `procurement_quotations` (`vq_number`); two **new** child
   tables `procurement_receipts` (`gr_number`, date, status `Partial|Complete`) and `procurement_invoices`
   (`vi_number`, date, status `Received|Scheduled|Paid`). GR/VI are **header records** (number + status)
   for MVP; per-line quantity matching deferred.
4. **Auto-generated reference numbers (OD-PROC-3):** `{PREFIX}-YYMMDD####` (PREFIX ∈ `PR|VQ|PO|GR|VI`),
   `####` = that doc type's **per-org, per-day** sequence, zero-padded width 4, **daily-reset**,
   **server-side**, generated in the transition/creation RPC — gap-tolerant and collision-free under
   concurrency. PR# set on `→ Requested`; VQ# per quotation row; PO# on `→ Ordered`; GR# on receipt
   creation; VI# on invoice creation.
5. **RLS / tenancy:** reads in-org for the two new tables; writes gated to the same 4 roles
   **plus the parent-org guard** (the procurement they attach to must belong to the caller's org — the
   budget HIGH-BV-1 / procurement HIGH-2 lesson). `org_id` never client-supplied (column default +
   `with check`). The `transition_procurement` RPC re-asserts authz internally (ADR-0011 discipline) and
   does not rely on RLS being bypassed by definer rights.
6. **Committed-status data contract (OD-BUDGET-2):** this module makes a procurement reach
   `status ∈ ('Ordered','Received','Vendor Invoiced','Paid')` — the **Committed basis** the later `spent`
   derivation sums. The module owns producing this status correctly; it does **not** compute `spent`.
7. **UI — procurement detail / lifecycle view:** show current status, the document trail
   (PR/VQ/PO/GR/VI numbers + GR/VI status), and **stage-appropriate transition actions gated to allowed
   roles** (cosmetic gate; the RPC is the real authority). Real loading / empty / error+retry states
   (Frontend DoD); every monetary value via `formatCurrency`. Mirror existing page/detail patterns.

**OUT (explicit non-goals — do not bleed scope):**
- **Dollar-threshold approvals, per-org pipeline config UI, role×stage matrix UI, custom roles** — the
  whole configurability engine is **seamed, not built** (OD-PROC-6). The transition map + the single-RPC
  authz choke point ARE the seam; no config tables this issue.
- **Petty cash / reimbursement** (`expense_claims`) — a separate future flow, must NOT be modeled inside
  `procurements` (OD-PROC-5).
- **Dashboard `spent` / margin consumption** (OD-BUDGET-2 derivation + OD-MARGIN dual-lens) — a later
  dashboard issue. This module only makes the committed-status data exist; named here only as the
  downstream consumer.
- **Per-line quantity matching** on GR/VI (received 3 of 5) — deferred; GR/VI are header records this issue.
- **Document file uploads / Storage** for PR/VQ/PO/GR/VI artifacts — Storage is disabled (tracked debt);
  numbers + status only, no `file_url` wiring this issue.
- **Rewriting the existing `procurements` / children RLS** beyond the two new tables and what the RPC needs
  — the coarse `procurements_update` policy stays (the RPC, not the policy, enforces the real matrix; the
  policy remains the backstop for any non-RPC write path).

## `[OWNER-DECISION]` flags (assumed defaults — flag, don't silently invent)

Most behavior is locked by OD-PROC-1..6. The following are **implementation defaults** the spec assumes
where OD-PROC is silent; flag for confirmation (non-blocking for build start, pin before merge):

- **OD-PROC-A (approver-≠-payer tracking) — assumed:** SoD rule (b) "approver ≠ payer" requires knowing
  **who approved**. OD-PROC-2 adds `approval_notes` but no approver *identity* column. Assume the module
  records the approver id when `→ Approved` fires (a new nullable `approved_by_id uuid references
  profiles(id)` on `procurements`, the cheapest seam — mirrors timesheet `approved_by`) and the
  `Vendor Invoiced → Paid` SoD check compares `auth.uid()` against it. *Confirm* adding `approved_by_id`
  (vs. deriving the approver from a future status-history table, which MVP doesn't have).
- **OD-PROC-B (Cancel early-vs-late boundary) — assumed:** OD-PROC-1 says Cancel is by "requester (early)
  or PM/Finance/Executive (later)". Assume **"early" = status ∈ {Draft, Requested}** (requester may cancel
  their own un-approved request) and **"later" = any other non-terminal status** (PM/Finance/Exec only).
  Terminal statuses (`Paid`, `Cancelled`, `Rejected`) cannot be cancelled. *Confirm* the early/late cut.
- **OD-PROC-C (VQ# / GR# / VI# creation surface) — assumed:** PR#/PO# are minted *during* a status
  transition, so they live in `transition_procurement`. VQ#/GR#/VI# are minted on **child-row creation**,
  which is a single insert, not a status transition. Assume each gets its **own** thin `security definer`
  creation RPC (`create_procurement_quotation` / `create_procurement_receipt` / `create_procurement_invoice`)
  so the server mints the number atomically and re-asserts authz (rather than a client insert + a DB
  default function, which can't easily express the daily-reset per-org sequence collision-free). *Confirm*
  the per-child creation-RPC shape (vs. a shared `next_doc_number(prefix)` helper called from a trigger).
- **OD-PROC-D (receipt/invoice → status coupling) — assumed:** creating a `procurement_receipt` does not
  *itself* move status; the user separately transitions `Ordered → Received` (and `Received → Vendor
  Invoiced`/`→ Paid`). Assume the module **does not** force GR-before-`Received` or VI-before-`Vendor
  Invoiced` for MVP (permissive, matching OD-PROC-4); the happy-path UI creates the GR/VI alongside the
  transition but the DB does not hard-require it. *Confirm* the no-hard-coupling default.

## Functional requirements (EARS)

**State machine — transition map (permissive, skippable)**
- **FR-PROC-001** — The system shall define the legal procurement status transitions as **data** (a
  status→allowed-next-status map) inside `transition_procurement()`, and shall reject (`P0001`) any
  transition whose `(from, to)` pair is not in the map.
- **FR-PROC-002** — The transition map shall be a **permissive superset** allowing optional stages to be
  **skipped**: `Approved → Ordered` (skip sourcing), `Approved → Vendor Quoted → Quote Selected → Ordered`
  (full sourcing), and any non-terminal status `→ Cancelled` (subject to FR-PROC-009). Terminal statuses
  (`Paid`, `Cancelled`) have no outgoing transitions; `Rejected → Draft` is the only exit from `Rejected`.
- **FR-PROC-003** — The system shall route **all** status changes through `transition_procurement()`; the
  coarse `procurements_update` RLS policy remains only as a backstop and is not the transition authority.

**Authorization matrix + separation-of-duties (re-asserted inside the RPC)**
- **FR-PROC-004** — When a user invokes `transition_procurement()`, the system shall re-assert, **inside**
  the `security definer` function: (a) the procurement's `org_id = auth_org_id()` (tenant isolation), and
  (b) that `auth_role()` is permitted for the requested transition per the OD-PROC-1 matrix — raising
  `42501` otherwise.
- **FR-PROC-005** — *Submit.* When the requested transition is `Draft → Requested`, the system shall
  permit **any in-org member** (incl. `Engineer`) to perform it.
- **FR-PROC-006** — *Approve / Reject (SoD-a).* When the requested transition is `Requested → Approved` or
  `Requested → Rejected`, the system shall permit only `Project Manager / Finance / Executive` (and Admin
  break-glass), **and shall reject it when the caller is the procurement's requester**
  (`procurements.requested_by_id = auth.uid()`) — requester ≠ approver. On `→ Approved` it shall record
  the approver (`approved_by_id`, OD-PROC-A) and on `→ Rejected` store `rejection_notes`.
- **FR-PROC-007** — *Rework.* When the requested transition is `Rejected → Draft`, the system shall permit
  the **requester** to perform it.
- **FR-PROC-008** — *Sourcing & PO & receipt.* The system shall permit `Approved → Vendor Quoted`,
  `Vendor Quoted → Quote Selected`, and `Quote Selected → Ordered` (and the skip `Approved → Ordered`) to
  `Project Manager / Finance` (and Admin); and `Ordered → Received` to the **requester or Project Manager**
  (and Admin).
- **FR-PROC-009** — *Pay (SoD-b) & Cancel.* The system shall permit `Received → Vendor Invoiced` and
  `Vendor Invoiced → Paid` to **Finance only** (and Admin), **and shall reject `Vendor Invoiced → Paid`
  when the caller approved this procurement** (`auth.uid() = approved_by_id`) — approver ≠ payer; and shall
  permit `<non-terminal> → Cancelled` to the **requester while status ∈ {Draft, Requested}** or to
  `PM / Finance / Executive` (and Admin) at **any** later non-terminal status (OD-PROC-B).

**Reference-number generation (server-side, daily-reset, per-org)**
- **FR-PROC-010** — When a status transition or child-row creation mints a document, the system shall
  generate its reference number server-side as `{PREFIX}-YYMMDD####` where `YYMMDD` is the server date and
  `####` is that `(org_id, prefix, date)` triple's next sequence value, zero-padded to width 4, **resetting
  daily**, and shall guarantee the value is **collision-free and gap-tolerant under concurrency**.
- **FR-PROC-011** — The system shall mint `PR-` on `Draft → Requested` (store on `procurements.pr_number`),
  `PO-` on `→ Ordered` (`procurements.po_number`), `VQ-` per quotation row (`procurement_quotations.
  vq_number`), `GR-` on receipt creation (`procurement_receipts.gr_number`), and `VI-` on invoice creation
  (`procurement_invoices.vi_number`). A document's number, once minted, shall be immutable.

**New tables + notes fields (ERP audit)**
- **FR-PROC-012** — The system (migration) shall add `pr_number text`, `po_number text`, `approval_notes
  text`, `rejection_notes text`, and `approved_by_id uuid references profiles(id)` to `procurements`, and
  `vq_number text` to `procurement_quotations` (all nullable; populated by the RPCs).
- **FR-PROC-013** — The system (migration) shall create `procurement_receipts(id, org_id default <org>,
  procurement_id → procurements on delete cascade, gr_number text, receipt_date date, status
  procurement_receipt_status not null, created_at)` with `procurement_receipt_status =
  ('Partial','Complete')` and an index on `procurement_id`.
- **FR-PROC-014** — The system (migration) shall create `procurement_invoices(id, org_id default <org>,
  procurement_id → procurements on delete cascade, vi_number text, invoice_date date, status
  procurement_invoice_status not null, created_at)` with `procurement_invoice_status =
  ('Received','Scheduled','Paid')` and an index on `procurement_id`.

**RLS / tenancy on the new tables**
- **FR-PROC-015** — The system shall enable RLS on `procurement_receipts` and `procurement_invoices` with
  read-in-org (`org_id = auth_org_id()`) for any authenticated in-org user.
- **FR-PROC-016** — The system shall gate writes on both new tables to `auth_role() in ('Admin',
  'Executive','Project Manager','Finance')` **and** a **parent-org guard** (`exists (… procurements p
  where p.id = <table>.procurement_id and p.org_id = auth_org_id())`), on both `using` and `with check`
  — mirroring the existing procurement-children policies (audit HIGH-2 lesson).
- **FR-PROC-017** — The system shall never accept a client-supplied `org_id` on any procurement-module
  write; `org_id` is defaulted from the org context and re-checked by RLS `with check`. The
  `security definer` RPCs (`transition_procurement` + the creation RPCs) shall `revoke all from public`,
  `grant execute to authenticated`, `revoke execute from anon`, and pin `search_path = public`
  (ADR-0011 / ADR-0009 discipline).

**Downstream data contract**
- **FR-PROC-018** — The system shall, through the transition map, allow a procurement to reach
  `status ∈ ('Ordered','Received','Vendor Invoiced','Paid')`, which is the **Committed basis** the later
  `spent = Σ total_value where status IN (…)` derivation consumes (OD-BUDGET-2). This module owns producing
  the status; it shall **not** compute or store `spent`.

## NFR
- **NFR-PROC-ATOM-001** — A status transition (status update + any minted PR#/PO# + approver stamp) shall
  be a **single atomic** server-side operation; no observable partial state (e.g. status `Requested` with a
  null `pr_number`).
- **NFR-PROC-SEQ-001** — Reference-number minting (FR-PROC-010) shall be **concurrency-safe**: two
  simultaneous mints of the same `(org, prefix, day)` shall not collide on `####` (sequence/`for update`
  backstop), and gaps from rolled-back transactions are acceptable (gap-tolerant).
- **NFR-PROC-UI-001** — The procurement lifecycle view shall render distinct **loading**, **empty**, and
  **error + retry** states (Frontend DoD), and format every monetary value via shared `formatCurrency`.

## RLS (verification this issue owns)

This issue **adds** RLS to the two new tables (FR-PROC-015/016) and **proves**, at the pgTAP layer:
- read-in-org for all roles on receipts/invoices; write blocked for `Engineer`; write allowed for the
  4 roles; the **parent-org guard** holds (cannot attach a receipt/invoice to another org's procurement);
- the `transition_procurement` RPC's **internal** authz (`auth_org_id()` + `auth_role()` + SoD), proven
  independently of RLS (definer bypasses RLS — the in-function re-assertion is the gate);
- anon cannot execute any module RPC (anon-revoke).
The existing `procurements` / children policies are reused as-is (the coarse `procurements_update` stays
as a non-RPC backstop); this issue does not rewrite them.

## Acceptance criteria (Given/When/Then)

AC range **AC-800..AC-816** (confirmed unused: Dashboard owns 701–711, Budget owns 720–733; `grep -r`
finds no AC-8xx). Each AC names its id as the leading token (traceability) and is annotated with its
**owning layer (ADR-0010)**.

- **AC-800** *(Unit)* — Transition map: legal pair accepted, illegal rejected.
  Given the transition-map logic, When asked `Draft → Requested` Then it is legal; When asked
  `Draft → Paid` (illegal jump) or `Paid → <any>` (terminal) Then it is rejected. *(FR-PROC-001)*
- **AC-801** *(Unit)* — Skippable optional stages.
  Given the map, When asked `Approved → Ordered` (skip sourcing) Then it is legal; And `Approved → Vendor
  Quoted` and `Quote Selected → Ordered` are also legal. *(FR-PROC-002)*
- **AC-802** *(Unit)* — Cancel boundary logic (OD-PROC-B).
  Given the map+role logic, When a requester cancels at `Requested` Then allowed; When a requester cancels
  at `Ordered` Then denied (only PM/Finance/Exec late); When already `Paid`/`Cancelled` Then no cancel.
  *(FR-PROC-002/009)*
- **AC-803** *(Unit)* — Reference-number formatter.
  Given prefix `PO`, server date 2026-06-04, sequence 1, When the number is formatted, Then it equals
  `PO-2606040001`; And sequence 42 → `PO-2606040042` (width-4 zero-pad). *(FR-PROC-010)*
- **AC-804** *(Unit)* — Lifecycle view loading / empty / error+retry states.
  Given the procurement lifecycle view, When the query is pending Then a skeleton (`procurement-loading`)
  renders; When it resolves with no procurement Then `procurement-empty`; When it errors Then an error +
  Retry renders and Retry re-runs the query. *(NFR-PROC-UI-001)*
- **AC-805** *(Unit)* — Transition actions gated cosmetically by role.
  Given a signed-in `Engineer` viewing a `Requested` procurement, When the lifecycle actions render, Then
  Approve/Reject are not offered (cosmetic gate); And given a `Finance` viewer they are offered. *(FR-PROC-006, UI)*
- **AC-806** *(Unit)* — DAL surfaces the RPC error (deny/illegal).
  Given the transition DAL, When the RPC raises `42501`/`P0001`, Then the DAL surfaces a typed error the UI
  can show (does not swallow it). *(FR-PROC-003/004)*
- **AC-807** *(pgTAP)* — Tenant isolation inside the RPC.
  Given an org-A user and an org-B procurement, When the org-A user calls `transition_procurement` on it,
  Then it raises `42501` (the procurement's `org_id ≠ auth_org_id()`); cross-org transition impossible.
  *(FR-PROC-004)*
- **AC-808** *(pgTAP)* — Role gate on transitions.
  Given a signed-in `Engineer`, When they call `transition_procurement(… , 'Approved')` on a `Requested`
  procurement, Then `42501`; And a `Finance` caller (not the requester) succeeds. *(FR-PROC-006)*
- **AC-809** *(pgTAP)* — SoD-a: requester ≠ approver.
  Given a procurement whose `requested_by_id` is user X (a PM), When X calls
  `transition_procurement(…, 'Approved')` on it, Then `42501`; When a different authorized user calls it,
  Then it succeeds and `approved_by_id` is set. *(FR-PROC-006)*
- **AC-810** *(pgTAP)* — SoD-b: approver ≠ payer.
  Given a procurement approved by Finance-user Y and now `Vendor Invoiced`, When Y calls
  `transition_procurement(…, 'Paid')`, Then `42501`; When a different `Finance` user calls it, Then it
  succeeds. *(FR-PROC-009)*
- **AC-811** *(pgTAP)* — Transition atomicity + PR#/PO# minted.
  Given a `Draft` procurement with null `pr_number`, When an authorized user transitions it to `Requested`,
  Then in one atomic step status = `Requested` and `pr_number` matches `^PR-\d{10}$` (no `Requested` with
  null `pr_number`); And `→ Ordered` mints `po_number ^PO-\d{10}$`. *(FR-PROC-011, NFR-PROC-ATOM-001)*
- **AC-812** *(pgTAP)* — Reference-number uniqueness + daily reset under concurrency.
  Given two PO numbers minted on the same server day in the same org, When compared, Then the `####`
  suffixes differ (no collision); And the first PO minted on a day ends `0001` (daily reset). *(FR-PROC-010,
  NFR-PROC-SEQ-001)*
- **AC-813** *(pgTAP)* — New-table RLS: Engineer read-allowed, write-blocked; parent-org guard.
  Given a signed-in `Engineer`, When they SELECT `procurement_receipts` / `procurement_invoices` in their
  org Then rows return; When they INSERT one Then `42501`; And given a `Finance` user, When they INSERT a
  receipt whose `procurement_id` belongs to **another org**, Then the parent-org guard rejects it.
  *(FR-PROC-015/016)*
- **AC-814** *(pgTAP)* — `org_id` not client-supplied + anon-revoke.
  Given a receipt/invoice insert supplying a foreign/explicit `org_id`, When attempted, Then RLS
  `with check` rejects it; And given the `anon` role, When it attempts to execute `transition_procurement`
  or any creation RPC, Then execute is denied. *(FR-PROC-017)*
- **AC-815** *(pgTAP)* — Committed-status data contract.
  Given a procurement transitioned to `Ordered` (then `Received`/`Vendor Invoiced`/`Paid`), When its status
  is read, Then it is in `('Ordered','Received','Vendor Invoiced','Paid')` — the Committed set the future
  `spent` derivation sums; And a `Quote Selected` procurement is NOT in that set. *(FR-PROC-018)*
- **AC-816** *(E2E)* — Full procure-to-pay happy path with document trail (single curated journey).
  Given a signed-in authorized user (Finance/Admin acting through the required role hops, with a distinct
  requester for SoD) on a `Draft` procurement, When they drive
  `Draft → Requested → Approved → Ordered → Received → Vendor Invoiced → Paid` and create the GR and VI,
  Then the lifecycle view shows final status `Paid` and the document trail displays the minted `PR-…`,
  `PO-…`, `GR-…`, and `VI-…` numbers. *(FR-PROC-002/005/006/008/009/010/011, NFR-PROC-UI-001)*

## Traceability (FR → AC → owning layer)

| Requirement | AC(s) | Owning layer (ADR-0010) |
|---|---|---|
| FR-PROC-001 (transition map legality) | AC-800 | Unit |
| FR-PROC-002 (permissive/skippable) | AC-801, AC-816 | Unit (E2E end-to-end) |
| FR-PROC-003 (all changes via RPC) | AC-806 | Unit |
| FR-PROC-004 (internal authz: org+role) | AC-807, AC-808 | pgTAP |
| FR-PROC-005 (submit: any member) | AC-816 | E2E (exercised in journey) |
| FR-PROC-006 (approve/reject + SoD-a) | AC-808, AC-809, AC-805 | pgTAP (UI gate at Unit) |
| FR-PROC-007 (rework `Rejected → Draft`) | AC-800/802 (map) | Unit |
| FR-PROC-008 (sourcing/PO/receipt roles) | AC-808, AC-816 | pgTAP (E2E end-to-end) |
| FR-PROC-009 (pay SoD-b + cancel boundary) | AC-810, AC-802 | pgTAP (boundary logic at Unit) |
| FR-PROC-010 (ref-number format + uniqueness) | AC-803, AC-812 | Unit (format) + pgTAP (uniqueness) |
| FR-PROC-011 (mint PR/VQ/PO/GR/VI; immutable) | AC-811, AC-816 | pgTAP (E2E end-to-end) |
| FR-PROC-012 (procurements/quotation columns) | AC-811 | pgTAP |
| FR-PROC-013 (`procurement_receipts` table) | AC-813, AC-816 | pgTAP (E2E end-to-end) |
| FR-PROC-014 (`procurement_invoices` table) | AC-813, AC-816 | pgTAP (E2E end-to-end) |
| FR-PROC-015 (new-table read-in-org) | AC-813 | pgTAP |
| FR-PROC-016 (new-table write gate + parent-org) | AC-813 | pgTAP |
| FR-PROC-017 (org_id not client-supplied + anon-revoke) | AC-814 | pgTAP |
| FR-PROC-018 (Committed-status data contract) | AC-815 | pgTAP |
| NFR-PROC-ATOM-001 (atomic transition) | AC-811 | pgTAP |
| NFR-PROC-SEQ-001 (concurrent ref-number) | AC-812 | pgTAP |
| NFR-PROC-UI-001 (loading/empty/error states) | AC-804, AC-816 | Unit (E2E end-to-end) |

Per-layer AC split: **Unit** AC-800/801/802/803/804/805/806 (**7**) · **pgTAP** AC-807/808/809/810/811/812/
813/814/815 (**9**) · **E2E** AC-816 (**1**, curated full procure-to-pay journey). Authorization, SoD,
transition atomicity, tenancy, ref-number uniqueness, and the Committed-status contract all sit at
**pgTAP** (the DB is the real gate); transition-map logic, ref-number formatting, DAL error surfacing, and
UI states sit at **Unit**; one end-to-end happy path at **E2E**. No AC is pushed up a layer to satisfy a
convention (ADR-0010); ACs referenced at multiple layers name a single owning layer above.

## Seed enrichment required (verified `supabase/seed.sql` §procurements)

Seed a **couple of procurements at various lifecycle stages with their minted doc numbers**, so the
lifecycle UI, the Committed-status contract, and the document-trail rendering have data without a live
transition run. Respect `unique(org_id, code)`, supply `org_id` via the **column default** (do not
hard-code it on inserts — keeps the client-unspoofable seam consistent), and set `requested_by_id` /
`approved_by_id` to **distinct** seeded profiles (so SoD is representable). Suggested:
- **One mid-flow** procurement at `Ordered` (or `Received`) on a real project: `pr_number` `PR-26mmdd0001`,
  `po_number` `PO-26mmdd0001`, a selected quotation with `vq_number` `VQ-26mmdd0001`, and a
  `procurement_receipts` row (`gr_number` `GR-26mmdd0001`, status `Partial`). This row lands in the
  **Committed** set (feeds the future `spent`).
- **One completed** procurement at `Paid`: full PR/VQ/PO/GR/VI trail with a `procurement_invoices` row
  (`vi_number` `VI-26mmdd0001`, status `Paid`), `approved_by_id` ≠ `requested_by_id` ≠ the payer.
- **One early** procurement at `Requested` (PR# only, no PO/GR/VI) — exercises the empty-trail rendering
  and a procurement **outside** the Committed set.
Keep seed dates internally consistent so the `YYMMDD` in seeded numbers matches each row's `created_at`
date (seed numbers are illustrative — production numbers are RPC-minted).

## Open questions / decisions-applied

**Decisions applied (cited):**
- **OD-PROC-1** — flat role×transition matrix, no dollar thresholds, SoD (requester≠approver,
  approver≠payer), Admin break-glass. ⇒ FR-PROC-004..009, AC-808/809/810.
- **OD-PROC-2** — PR/VQ/PO/GR/VI audit: `procurements` + `procurement_quotations` columns, new
  `procurement_receipts` / `procurement_invoices` header tables. ⇒ FR-PROC-012/013/014, AC-811/813.
- **OD-PROC-3** — `{PREFIX}-YYMMDD####` server-side, daily-reset, per-org, gap-tolerant, collision-free.
  ⇒ FR-PROC-010/011, AC-803/811/812.
- **OD-PROC-4** — centralized permissive/skippable transition map in one `security definer`
  `transition_procurement` RPC (ADR-0011 shape). ⇒ FR-PROC-001/002/003, AC-800/801/816.
- **OD-PROC-6** — configurability seamed not built: the transition map + single RPC authz choke point ARE
  the seam; no config tables. ⇒ Scope OUT; FR-PROC-001 (map-as-data) is the seam.
- **OD-BUDGET-2** — Committed basis = status ≥ Ordered; this module produces it, does not consume it.
  ⇒ FR-PROC-018, AC-815; Scope OUT (derivation/dashboard later).

**Open / needs owner confirmation (flagged above, non-blocking for build start; pin before merge):**
- **OQ-1 → OD-PROC-A:** add `approved_by_id` to `procurements` to make "approver ≠ payer" checkable in
  MVP (vs. a deferred status-history table). Spec assumes the column.
- **OQ-2 → OD-PROC-B:** Cancel early/late boundary = early ∈ {Draft, Requested} (requester) / later = any
  other non-terminal (PM/Finance/Exec). Confirm the cut.
- **OQ-3 → OD-PROC-C:** VQ#/GR#/VI# minted via per-child `security definer` creation RPCs (vs. a shared
  `next_doc_number(prefix)` helper + trigger). Implementation default; eng-planner finalizes in the plan
  and may capture it in a short ADR (the procurement counterpart to ADR-0011).
- **OQ-4 → OD-PROC-D:** creating a GR/VI does not force the corresponding status transition (no hard
  coupling) for MVP. Confirm the permissive default.
