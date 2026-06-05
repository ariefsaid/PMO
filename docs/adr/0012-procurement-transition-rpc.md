# ADR-0012: Procurement lifecycle writes via a `transition_procurement` state-machine RPC + a shared doc-number minter

**Status:** Accepted — 2026-06-04
**Deciders:** Director, eng-planner
**Issue:** build-wave #2 — Procurement lifecycle (procure-to-pay) module
**Spec:** `docs/specs/procurement-lifecycle.spec.md` (FR-PROC-001..018, AC-800..816)
**Decisions:** `docs/decisions.md` OD-PROC-1/2/3/4/6 (binding) + OD-BUDGET-2 (downstream data contract);
ratified owner-flags OD-PROC-A / OD-PROC-B / OD-PROC-D; **this ADR resolves OD-PROC-C**.
**Precedent:** ADR-0011 (budget mutation RPCs) — this is the **same pattern generalized**; ADR-0009
(read-RPC + anon-revoke); ADR-0010 (test pyramid + AC-id tagging); ADR-0006 (`db reset` reversibility).

---

## Context

OD-PROC-4 mandates a **centralized, permissive, skippable** procurement status state machine driven by a
single RPC, with the transition rules expressed **as data** (the OD-PROC-6 config seam) rather than
scattered across UI/RLS. OD-PROC-1 layers a flat role×transition authorization matrix plus two
separation-of-duties (SoD) rules — requester ≠ approver, and approver ≠ payer — onto every transition.
OD-PROC-2/3 require an ERP document audit trail (PR → VQ → PO → GR → VI) with server-minted
`{PREFIX}-YYMMDD####` reference numbers that reset daily per org, are collision-free and gap-tolerant.

A status transition is **multi-write and atomicity-critical**: e.g. `Draft → Requested` must, in one
indivisible step, set `status='Requested'` *and* mint+store `pr_number` (NFR-PROC-ATOM-001 — no observable
`Requested` with a null `pr_number`); `Requested → Approved` must set status *and* stamp the approver
identity used later for the approver≠payer SoD check. PostgREST gives the client no atomic multi-statement
transaction boundary, and the authorization is the real security gate — exactly the situation ADR-0011
addressed for budget activation.

The existing coarse `procurements_update` RLS policy (`0002_rls.sql`) gates UPDATE to four roles with no
notion of *which* transition, *who* may make it, or SoD; its own comment defers the real matrix to this
module's RPC. It stays as a **backstop** for any non-RPC write path; it is not the transition authority.

The budget audit found **HIGH-BV-1**: a child/related row stamped with the caller's own `org_id` but
pointing at a *parent in another org* lets a definer-context function act across tenants. The two new
child tables (`procurement_receipts`, `procurement_invoices`) reproduce that risk and MUST carry a
**parent-org guard** (parent procurement in the caller's org) in BOTH their RLS policies AND in the
creation RPCs.

Open question **OQ-3 / OD-PROC-C** (delegated to this plan): *how* are VQ#/GR#/VI# minted on child-row
creation, and *how* is the `####` counter implemented so it is daily-reset, per-org, atomic, and
gap-tolerant under concurrency?

---

## Decision

Add migration `0006_procurement_lifecycle.sql` (forward-only, additive; reversibility = `supabase db
reset`, ADR-0006) containing five things, all following the ADR-0011 `security definer` + internal-authz +
pinned-`search_path` + revoke-anon discipline.

### 1. `transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)` — `security definer`

One server-side transaction that drives **all** status changes. It:

1. **Loads** the procurement (`status`, `org_id`, `requested_by_id`, `approved_by_id`, `project_id`)
   `for update` (row lock; serializes concurrent transitions on the same procurement). Raises `P0002` if
   not found.
2. **Tenant isolation (FR-PROC-004a):** raises `42501` if `org_id is distinct from auth_org_id()` — proven
   independently of RLS because definer rights bypass RLS (AC-807). This re-assertion MUST stay (removing
   it leaks cross-org writes); the migration carries an inline comment to that effect (ADR-0011 lesson).
3. **Transition-map legality (FR-PROC-001/002):** the legal `(from → {allowed next})` superset is encoded
   **as data** inside the function (a `jsonb`/array literal map; see §map below). Raises `P0001` if the
   `(current_status, p_to)` pair is not in the map. Terminal `Paid`/`Cancelled` have no outgoing edges;
   `Rejected`'s only edge is `→ Draft`.
4. **Role×transition authorization + SoD (FR-PROC-004b..009):** re-asserts `auth_role()` against the
   per-transition allowed-role set (the OD-PROC-1 matrix, also carried as data keyed by `to`-status /
   transition), with `Admin` exempt (break-glass). SoD:
   - **SoD-a (requester ≠ approver):** on `Requested → Approved|Rejected`, raise `42501` if
     `requested_by_id = auth.uid()`.
   - **SoD-b (approver ≠ payer):** on `Vendor Invoiced → Paid`, raise `42501` if `approved_by_id =
     auth.uid()`.
   - **Cancel boundary (OD-PROC-B):** `<non-terminal> → Cancelled` allowed for the **requester** while
     `current_status ∈ {Draft, Requested}`, else only `PM/Finance/Executive` (and Admin).
   All denials raise `42501`.
5. **Mints + stamps atomically:**
   - `Draft → Requested` → `pr_number = next_procurement_doc_number(org_id,'PR')`.
   - `* → Ordered` → `po_number = next_procurement_doc_number(org_id,'PO')`.
   - `Requested → Approved` → `approved_by_id = auth.uid()`, `approval_notes = p_notes` (OD-PROC-A).
   - `Requested → Rejected` → `rejection_notes = p_notes`.
   - All in the **same** `update`, so there is no observable partial state (NFR-PROC-ATOM-001, AC-811).
   - A minted number is written once and never overwritten on later transitions (immutability,
     FR-PROC-011): the `update` only sets `pr_number`/`po_number` on the transition that mints them, using
     `coalesce(existing, minted)` so re-entry cannot clobber.

### 2. `next_procurement_doc_number(p_org uuid, p_prefix text)` — `security definer` (resolves OD-PROC-C)

**Chosen: a single shared minter backed by a per-`(org_id, prefix, doc_date)` counter table**, not a
per-doc-table function and not a Postgres `sequence` per type.

A tiny table `procurement_doc_counters(org_id uuid, prefix text, doc_date date, last_seq int, primary
key(org_id, prefix, doc_date))`. The minter does one atomic upsert-increment:

```sql
insert into procurement_doc_counters (org_id, prefix, doc_date, last_seq)
values (p_org, p_prefix, current_date, 1)
on conflict (org_id, prefix, doc_date)
  do update set last_seq = procurement_doc_counters.last_seq + 1
returning last_seq;       -- v_seq
-- format: PREFIX-YYMMDD0001
return p_prefix || '-' || to_char(current_date,'YYMMDD') || lpad(v_seq::text, 4, '0');
```

`on conflict do update ... returning` is a single atomic statement: concurrent mints of the same
`(org, prefix, day)` each take a row lock on the conflicting key and are serialized by Postgres, so each
gets a **distinct** `last_seq` — collision-free (NFR-PROC-SEQ-001, AC-812). A rolled-back transaction
leaves `last_seq` advanced ⇒ gaps are possible and **accepted** (gap-tolerant, OD-PROC-3). The `doc_date`
key gives the **daily reset** for free: the first mint on a new server day inserts a fresh row at
`last_seq = 1` ⇒ `…0001` (AC-812). `org_id` in the key gives per-org isolation; the format helper is a
pure deterministic function (`format_doc_number(prefix, date, seq)`) unit-tested at AC-803.

> The counter table carries `org_id` and read-RLS (`org_id = auth_org_id()`) for consistency, but is only
> ever written via the `security definer` minter (never client-writable: no write policy, and the minter
> re-asserts org). It is an internal sequence store, not a business table — documented as such inline.

### 3. Three thin creation RPCs — all `security definer`

`create_procurement_quotation(p_procurement_id, p_vendor_id, p_total_amount, p_received_date)`,
`create_procurement_receipt(p_procurement_id, p_status, p_receipt_date)`,
`create_procurement_invoice(p_procurement_id, p_status, p_invoice_date)`. Each:

- re-asserts the **parent procurement is in `auth_org_id()`** (the HIGH-BV-1 parent-org guard) and
  `auth_role() in ('Admin','Executive','Project Manager','Finance')`, raising `42501` otherwise;
- mints its number via `next_procurement_doc_number(<parent org>, 'VQ'|'GR'|'VI')` and inserts the child
  row with the org defaulted from the parent (never client-supplied), `returning` the new row.

This is OD-PROC-C **resolved in favor of per-child creation RPCs that share the one minter** — versus a DB
default function or a trigger. Rationale below.

### 4. RLS on the two new tables (FR-PROC-015/016)

`procurement_receipts` and `procurement_invoices` each get `enable row level security`, a read-in-org
`select` policy (`org_id = auth_org_id()`), and a write policy gated to the four roles **plus a parent-org
guard** — byte-for-byte the shape of the existing `procurement_items_write` / `procurement_quotations_write`
policies in `0002_rls.sql` (the HIGH-2 lesson). The creation RPCs do not rely on RLS being bypassed; the
RLS is the backstop for any non-RPC insert path and the proof surface for AC-813/814.

### 5. Schema additions (FR-PROC-012/013/014)

On `procurements`: `pr_number text`, `po_number text`, `approval_notes text`, `rejection_notes text`,
`approved_by_id uuid references profiles(id)` (OD-PROC-A). On `procurement_quotations`: `vq_number text`.
New enums `procurement_receipt_status ('Partial','Complete')` / `procurement_invoice_status ('Received',
'Scheduled','Paid')` and the two header tables (`org_id` default + parent FK `on delete cascade` +
`procurement_id` index).

All five functions: `revoke all from public` + `grant execute to authenticated` + `revoke execute from
anon` + (the definer ones) `set search_path = public`.

### The transition map (data, the OD-PROC-6 seam)

| From | Allowed `→ to` | Roles (besides Admin) | Mint / stamp |
|---|---|---|---|
| Draft | Requested, Cancelled | any member (submit); requester (cancel) | PR# on Requested |
| Requested | Approved, Rejected, Cancelled | PM/Finance/Exec (≠ requester); requester may Cancel | approver+notes / rejection_notes |
| Approved | Vendor Quoted, Ordered, Cancelled | PM/Finance (sourcing/PO); PM/Fin/Exec (cancel) | PO# on Ordered |
| Vendor Quoted | Quote Selected, Cancelled | PM/Finance; PM/Fin/Exec (cancel) | — |
| Quote Selected | Ordered, Cancelled | PM/Finance; PM/Fin/Exec (cancel) | PO# on Ordered |
| Ordered | Received, Cancelled | requester or PM; PM/Fin/Exec (cancel) | — |
| Received | Vendor Invoiced, Cancelled | Finance; PM/Fin/Exec (cancel) | — |
| Vendor Invoiced | Paid, Cancelled | Finance (≠ approver); PM/Fin/Exec (cancel) | — |
| Rejected | Draft | requester (rework) | — |
| Paid / Cancelled | — (terminal) | — | — |

Committed set (OD-BUDGET-2 / FR-PROC-018): `status ∈ ('Ordered','Received','Vendor Invoiced','Paid')`.

### Alternatives considered

- **Per-table `next_<doc>_number()` minters (one per prefix):** rejected — five near-identical functions
  duplicating the upsert-increment + format logic; the shared minter parameterized by `prefix` is one
  audited surface and the OD-PROC-6/future-config seam. (This is the option OD-PROC-C explicitly flagged.)
- **Postgres `sequence` per `(org, prefix)`:** rejected — sequences are not transactional (gap-tolerant,
  good) but they do **not reset daily** and cannot be keyed by a date without dynamically creating one
  sequence per org per prefix per day (unbounded DDL). The counter table expresses the daily-reset
  natural key directly and stays gap-tolerant.
- **`count(*)`-in-transaction (count existing rows for the day, +1):** rejected — two concurrent mints
  reading the same count both produce the same `####` (collision), violating NFR-PROC-SEQ-001 unless wrapped
  in a serializable/advisory-lock dance; the `on conflict do update returning` upsert is collision-free with
  no extra locking ceremony.
- **DB column `default` function / `before insert` trigger to mint child numbers:** rejected as the primary
  surface — a trigger/default cannot cleanly re-assert `auth_role()` + the parent-org guard the way a
  `security definer` creation RPC does, and would split the authz story across RLS + trigger. Thin creation
  RPCs keep one authz choke point per write (ADR-0011 shape) and let the DAL surface a typed error.
- **Encoding the matrix in a config table now:** rejected for MVP (OD-PROC-6 — *seam, don't build*). The
  map-as-data inside the one RPC IS the seam; a later issue swaps the literal for a per-org config read
  without touching callers, RLS, or the DAL.
- **Keeping status changes on the coarse `procurements_update` RLS policy:** rejected as the authority — it
  cannot express legal-transition / who / SoD. It remains only as a non-RPC backstop (unchanged).

---

## Consequences

**Positive:**
- One authorization + atomicity choke point for procurement lifecycle writes (the OD-PROC-6 seam),
  swappable later for config-driven authz without touching callers or RLS — same shape as ADR-0011.
- Transitions are atomic and race-safe (`for update` lock + single `update`): no `Requested`-with-null-PR#
  partial state (NFR-PROC-ATOM-001).
- Ref-numbers are collision-free, daily-reset, per-org, gap-tolerant via one audited minter
  (NFR-PROC-SEQ-001) reused by the transition RPC and all three creation RPCs — no duplicated counter logic.
- Parent-org guards on both new tables (RLS) AND the creation RPCs close the HIGH-BV-1 cross-tenant graft
  on receipts/invoices.
- The Committed-status data the later `spent` derivation (OD-BUDGET-2) consumes is produced correctly here;
  this module does not compute `spent`.

**Negative / risks:**
- New `security definer` surface (five functions): the security-auditor MUST verify each one's internal
  `auth_org_id()` + `auth_role()` + SoD re-assertion, the pinned `search_path = public`, the parent-org
  guards in the creation RPCs, and the anon-execute revoke before ship. Inline comments state the authz
  MUST stay (removing it bypasses RLS).
- `database.types.ts` gains no auto-generated `Functions` entries until the local stack is regenerated; the
  DAL uses the contained `// @ts-expect-error` + `as unknown as <T>` cast established in `dashboard.ts` /
  `budgets.ts`.
- Lifecycle logic lives in SQL rather than TypeScript — intentional (atomicity + single authz point),
  mirroring ADR-0011 and the OD-PROC-4 direction.
- `procurement_doc_counters` is a new internal table; gaps in `####` are expected and acceptable (documented)
  — not a defect. If a future requirement demands gapless numbering, that is a separate (heavier) design.

**Pattern:** this is ADR-0011 generalized to a state machine + a shared doc-number minter. Future
multi-statement, atomicity- or authorization-critical writes follow the same `security definer` +
internal-authz + revoke-anon shape; single-write child creates that must mint a server number go through a
thin creation RPC sharing `next_procurement_doc_number`.
