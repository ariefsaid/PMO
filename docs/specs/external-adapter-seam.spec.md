# Spec: External-system adapter seam (Issue P0 — ADR-0055 P0 phase)

> **Status:** **Signed off** (owner, 2026-07-10) — review battery green (gpt-5.4 spec review →
> 5 fixes → confirm); OD-1..OD-4 decided (§10): Operator-only write · read-only Integrations
> view IN P0 · client-side routing branch (RLS = authority) · synthetic reference domain.
>
> P0 (the seam) of **ADR-0055** (`docs/adr/0055-external-system-adapters-sot-enhancement.md`,
> §8 phasing table). Conforms to house conventions (EARS + `FR-EAS-`/`NFR-EAS-`/`AC-EAS-` ids;
> Given/When/Then; ADR-0010 test-pyramid traceability). Grounds: ADR-0055 §§1–5, 8 (binding
> architecture); `docs/glossary.md` §Integration (terms used **exactly**: SoT, externally-owned
> domain, PMO-owned domain, enhancement, read-model, capability map, adapter, adapter contract,
> external tier); ADR-0017 (repository seam — the contract this routes behind); ADR-0010 (test
> pyramid); ADR-0016 (`can()` UX-only, RLS is authority); ADR-0018 (soft-archive, n/a here — these
> tables are machine-written); ADR-0001 (`org_id` seam). RLS helpers reused from
> `supabase/migrations/0002_rls.sql` (`auth_org_id()`, `auth_role()`, `auth.uid()`).
>
> **Scope (locked, Director):** the **seam only** — (a) the PMO-owned adapter contract
> (behavioral, not TS code); (b) `external_refs` mapping + `external_sync_watermarks` storage; (c)
> org-level `external_domain_ownership` configuration, **default empty**; (d) the pending-push UI
> behavior (shared state machine, not a component); (e) the write-routing seam (externally-owned ⇒
> synchronous write-through via adapter dispatch; reads ALWAYS from the Supabase read-model); plus
> (f) the critical invariant — empty domain-ownership map ⇒ byte-for-byte pre-adapter behavior. A
> **reference (test-double) adapter** makes every AC provable with **no real external system**.
>
> **Out of scope (later phases — do NOT build here):** any ClickUp / ERPNext / Odoo API specifics
> or real adapters (P1 ClickUp, P2 ERPNext, P3 ERPNext width, P4 Odoo); the webhook ingress + the
> watermark reconciliation-sweep engine (P1); real read-model tables for real domains and their
> population (P1+, when a domain actually flips); the backfill/promote runbook for flipping an
> existing client; per-client secret provisioning (1Password wiring); helper apps; the versioned-plan
> (budget) projection and sales-document commands (P2/P3 domain work). **No re-litigation of any
> ADR-0055 decision** — this spec specifies P0 of an accepted architecture, nothing more.

---

## 0. Job story

> **When a client employs an external system (ClickUp/ERPNext), PMO must route that system's
> domains to it as SoT while remaining byte-identical for clients without one.**

The whole seam exists to make that one sentence true **mechanically**, not by convention: the
domain-ownership map is the switch, the adapter contract is the shape, the routing is the wire, and the
empty-map invariant is the guarantee that the switch being off is indistinguishable from the
system having no switch at all.

---

## 1. Context (AS-IS) and scope

ADR-0055 decides that PMO is the **app layer** and that an **external tier** (an ERP, ClickUp) is
an **optional, per-client** choice. Employing one flips the domains it natively owns — per its
**capability map** — to **externally-owned**: that external system becomes the **source of truth
(SoT)** for those domains, and Supabase holds a **read-model** (machine-written only) plus
additive **enhancements**. PMO runs fully standalone with no external tier (all domains
PMO-owned); ADR-0055 §1.

Today PMO has the full CRUD/RBAC foundation: a typed DAL (`src/lib/db/*`), a repository seam that
normalizes thrown values to a code-bearing `AppError` (`src/lib/repositories/{types,index}.ts`,
ADR-0017), org-scoped RLS (`0002_rls.sql`, ADR-0016), and TanStack hooks (ADR-0005). The
repository seam is explicitly the backend-swap seam: *"a future ERP/REST backend is a new
implementation behind the same interface with ZERO FE change"* (ADR-0017). ADR-0055 §1 ratifies
this: *"PMO's canonical domain model + the ADR-0017 `Repositories` contract remain the seam. No
PMO code couples to any external system's shapes."*

P0 builds the seam that the future adapters plug into. It does **not** build any adapter that
speaks a real API, and it does **not** flip any real domain. It proves the machinery with a
reference (test-double) adapter against an empty (shipped-default) domain-ownership map and a
test-flipped domain, so the contract, routing, storage, and pending state are all exercised with
**zero external dependency**.

The shipped state is the invariant: **every org's domain-ownership map is empty**, so on day one of P0
merge the system is, and must remain, byte-for-byte the pre-adapter system.

## 2. Goals

- **G-1 (the switch)** An org-level domain-ownership configuration records which external tiers an
  org employs and which domains are consequently externally-owned; it **defaults to empty**.
- **G-2 (the shape)** A single PMO-owned adapter contract that every adapter implements, expressed
  in PMO domain language, plus a reference adapter that implements it for proving the seam.
- **G-3 (the wire)** A write-routing seam: externally-owned writes route through synchronous
  adapter dispatch (ADR-0055 §4); PMO-owned writes route through the existing direct DAL; reads
  ALWAYS serve from the Supabase read-model via the existing DAL, regardless of ownership.
- **G-4 (the bookkeeping)** `external_refs` (PMO record id ↔ external record id, per domain,
  org-scoped, machine-written) + `external_sync_watermarks` storage (per org × tier × domain
  cursor) — both RLS-protected, both machine-written only.
- **G-5 (the visible state)** A shared pending-push behavior (state names + transitions + error
  surface) for synchronous write-through, reusable across surfaces — not a hard-coded component.
- **G-6 (the guarantee)** With an empty domain-ownership map, behavior is byte-for-byte unchanged: no
  adapter dispatch, no edge-function call on the write path, no pending-push state, no new errors —
  zero regression for every existing client.

## 3. Functional requirements (EARS)

### 3.1 Domain-ownership configuration (the switch)

- **FR-EAS-001** (ubiquitous) The system shall provide an org-scoped `external_domain_ownership`
  configuration that records, per org, which external tiers are employed and which PMO domains are
  consequently externally-owned for that org.
- **FR-EAS-002** (ubiquitous) The `external_domain_ownership` configuration shall **default to
  empty** for every org: a newly created org with no configuration written shall have no external
  tier employed and every domain PMO-owned.
- **FR-EAS-003** (ubiquitous) A domain shall be externally-owned for an org **if and only if** the
  org's `external_domain_ownership` assigns that domain to an employed external tier; absent such an
  assignment, the domain is PMO-owned.
- **FR-EAS-004** (ubiquitous) Each external tier shall declare a **static per-system capability
  map** (the set of PMO domains it can natively own) as part of its adapter; an org's
  `external_domain_ownership` may assign to a tier only domains within that tier's static capability
  map, so the effective flip set is bounded by the employed tier's real capabilities.
- **FR-EAS-005** (state-driven) While a caller reads the `external_domain_ownership`, the system
  shall enforce org isolation: a member shall see only their own org's rows, and a cross-org read
  shall return nothing.
- **FR-EAS-006** (event-driven) When the `external_domain_ownership` is written, the system shall
  restrict writes to the platform **Operator** (decided OD-1, owner 2026-07-10), shall stamp
  `org_id` server-side (column default + RLS `WITH CHECK`), and shall reject a write whose
  `org_id` is set to another org; the client shall never send `org_id`.
- **FR-EAS-007** (ubiquitous) The system shall provide a **read-only Integrations view** (decided
  OD-2, owner 2026-07-10) showing the caller's org's employed external tiers and the consequently
  externally-owned domains; where the org's `external_domain_ownership` is empty, the view shall
  show an explicit "no external systems employed" empty state. The view shall offer **no write
  affordances** (writes are Operator-provisioned per FR-EAS-006).

### 3.2 The critical invariant (empty map ⇒ byte-for-byte)

- **FR-EAS-010** (ubiquitous — **THE INVARIANT**) Where an org's `external_domain_ownership` is
  empty, the system shall produce **byte-for-byte identical behavior** to the pre-adapter system
  for every domain: repository writes shall take the existing direct-DAL path with **no** adapter
  dispatch and **no** dispatch edge-function call, repository reads shall take the existing DAL
  path, **no** pending-push state shall be introduced, and the `org_id` seam, RLS, and all existing
  error codes shall be unchanged. Zero regression for existing clients.

### 3.3 The adapter contract (the shape)

- **FR-EAS-020** (ubiquitous) The system shall define a single **PMO-owned adapter contract** that
  every adapter implements, expressed entirely in PMO's domain language (entity + operation +
  PMO-shaped payload) and **never** in any external system's vocabulary; no PMO code above the
  contract shall couple to any external system's shapes.
- **FR-EAS-021** (ubiquitous) The adapter contract shall require each adapter to declare (a) its
  static per-system capability map (the PMO domains it can natively own) and (b) for each owned
  domain a set of **commands** (`create` / `update` / `delete` / `transition` as applicable to that
  domain) and a set of **reads** (`list-changes-since-watermark` and `get-by-external-id`), each in
  PMO domain language.
- **FR-EAS-022** (event-driven) When a command is issued to an adapter, the adapter shall
  **synchronously** commit the change to its external system and return the external system's
  record id **plus** the canonical PMO-shaped record, so the read-model is updated from one
  authoritative answer (ADR-0055 §4 synchronous write-through).
- **FR-EAS-023** (event-driven) When the external system rejects a command — validation, conflict,
  or unreachability — the adapter shall surface that verdict as a **classified error**
  (`commit-rejected` or `external-unreachable`) carrying the external system's message, so the
  dispatch can map it to the user-facing error surface.
- **FR-EAS-024** (ubiquitous) An adapter shall **never** receive or stamp `org_id`; the dispatch
  shall bind the org context server-side from the caller's JWT, and the adapter shall operate within
  that bound context. (ADR-0017 seam: `org_id` is never threaded from the client; the adapter sits
  below the seam.)
- **FR-EAS-025** (ubiquitous) The system shall provide a **reference adapter (test-double)** that
  implements the adapter contract for at least one domain with **configurable outcomes**
  (`commit-success`, `commit-rejected-validation`, `external-unreachable`), so that every
  acceptance criterion in this spec is provable with **no real external system present**.

### 3.4 Write-routing seam (the wire)

- **FR-EAS-030** (ubiquitous) Repository reads shall **ALWAYS** be served from Supabase via the
  existing DAL (the read-model), regardless of whether the domain is externally-owned; **no** read
  shall be routed to an adapter. (ADR-0055 §3: read-models are for display/querying/the Assistant;
  the user never reads through the external system synchronously.)
- **FR-EAS-031** (event-driven) When a repository write targets a domain that is externally-owned
  for the caller's org, the system shall route the write through the **adapter dispatch path**: the
  direct-DAL write shall **not** be taken; instead the write shall dispatch to the employed
  adapter as a synchronous command (ADR-0055 §4).
- **FR-EAS-032** (event-driven) When a repository write targets a domain that is PMO-owned for the
  caller's org, the system shall route the write through the existing **direct-DAL path**, identical
  to the pre-adapter system (no dispatch, no edge-function call).
- **FR-EAS-033** (ubiquitous) The routing decision (externally-owned vs PMO-owned) shall be made
  from the caller's **own-org** `external_domain_ownership`; the client shall never send `org_id` or
  any external-system concern to the dispatch, and the `Repositories` interface (ADR-0017) shall be
  unchanged — only the internal implementation of write methods branches.
- **FR-EAS-034** (event-driven) When an externally-owned write succeeds, the dispatch shall, **in
  order**: (1) invoke the adapter command, (2) on external commit, update the read-model in Supabase
  from the adapter's canonical answer, (3) record the `external_refs` mapping, and (4) return to the
  caller; the caller shall not observe success until the external system has committed
  (synchronous write-through — ADR-0055 §4).
- **FR-EAS-035** (event-driven) When an externally-owned write fails because the external system
  rejected the command or was unreachable, the dispatch shall **not** update the read-model, shall
  **not** record an `external_refs` mapping, and shall surface a classified error to the caller;
  reads of that domain shall continue to serve the existing read-model unchanged.
- **FR-EAS-036** (state-driven) While the external system is unreachable, the system shall fail
  externally-owned writes honestly with an "external system unreachable — try again" error and shall
  leave PMO-owned domains entirely unaffected (ADR-0055 §4: PMO-owned domains are never blocked by
  an external-tier outage).
- **FR-EAS-037** (state-driven) While a domain is externally-owned for an org, the system shall
  enforce, via RLS, that user-JWT writes to that domain's read-model tables are DENIED and writes
  are permitted only to the dispatch/sync service role; **RLS is the enforcement authority**
  (ADR-0016; ADR-0055 Consequences bullet 2), and the repository routing branch (FR-EAS-033 / OD-3)
  is UX/DX-only routing, never the authority.

### 3.5 `external_refs` mapping (the bookkeeping — ids)

- **FR-EAS-040** (ubiquitous) The system shall provide an `external_refs` table mapping, per domain
  and per org, a PMO record id to the corresponding external-system record id (and the owning
  external tier), so a record is addressable from either side.
- **FR-EAS-041** (state-driven) While an `external_refs` row is read, the system shall enforce org
  isolation: a member shall see only their own org's refs, and a cross-org read shall return
  nothing.
- **FR-EAS-042** (ubiquitous) `external_refs` shall be **machine-written only**: `INSERT` /
  `UPDATE` / `DELETE` shall be permitted solely to the dispatch/sync service role (during
  synchronous write-through and, later, the change-feed), **never** to a user JWT directly; org
  members may `SELECT` their own org's refs. (ADR-0055 consequence: read-model write policies are
  restricted to the sync service role.)
- **FR-EAS-043** (event-driven) When a synchronous write-through commits for an externally-owned
  domain, the dispatch shall record (or update) the `external_refs` mapping for that record; the
  mapping shall not be writable by the user.

### 3.6 Sync watermarks storage (the bookkeeping — cursor)

- **FR-EAS-050** (ubiquitous) The system shall provide an `external_sync_watermarks` table storing,
  per org × external tier × domain, a modified-since cursor (watermark) to be consumed by the
  reconciliation sweep.
- **FR-EAS-051** (ubiquitous) The `external_sync_watermarks` table shall be **machine-written
  only** (dispatch/sync service role) and org-isolated on read. **P0 establishes storage + RLS
  only**; the sweep engine that populates and advances watermarks is P1 and is not built here.
- **FR-EAS-052** (event-driven) When the dispatch or (later) the sweep advances a watermark, it
  shall upsert **exactly one** row per `(org, tier, domain)` key with the new cursor (no duplicate
  keys).

### 3.7 Pending-push UI state (the visible state — shared behavior)

- **FR-EAS-060** (ubiquitous) The system shall define a **shared pending-push behavior** — state
  names + transitions + error surface — for synchronous write-through on externally-owned domains,
  reusable across surfaces; it is **not** a single hard-coded component.
- **FR-EAS-061** (ubiquitous) The pending-push behavior shall expose the states `idle`, `pushing`,
  `pushed`, and `push-failed`: `pushing` shall be shown immediately when an externally-owned write
  is submitted; `pushed` shall be shown on successful external commit (read-model updated);
  `push-failed` shall be shown when the external system rejects the command or is unreachable.
- **FR-EAS-062** (state-driven) While a domain is PMO-owned for the caller's org, the system shall
  **not** introduce any pending-push state — a write shall have no visible in-flight external-push
  indicator (consistent with FR-EAS-010).
- **FR-EAS-063** (event-driven) When an externally-owned write fails, the `push-failed` state shall
  surface the classified external error (`external-unreachable` → "external system unreachable — try
  again"; `commit-rejected` → the external system's validation message) via the shared
  `{headline, detail}` error contract (reusing `classifyMutationError`'s shape, ADR-0017).

## 4. Non-functional requirements

- **NFR-EAS-SEC-001** (tenancy) The `org_id` single-tenant→B2B seam shall be enforced on all three
  tables (`external_refs`, `external_sync_watermarks`, `external_domain_ownership`) via column default
  + RLS `WITH CHECK`; `org_id` shall never be sent by the client (ADR-0001).
- **NFR-EAS-SEC-002** (authority) RLS shall be the enforcement authority: `external_refs` and
  `external_sync_watermarks` shall be machine-written only (service role); `external_domain_ownership`
  shall be Operator-write (OD-1) and org-member-read; a domain's read-model tables, once that domain
  is externally-owned for an org, shall deny user-JWT writes and permit writes only to the
  dispatch/sync service role (FR-EAS-037; ADR-0055 Consequences bullet 2). The FE may be stricter but
  never the authority (ADR-0016).
- **NFR-EAS-PERF-001** (no added latency on the invariant path) The routing decision shall add
  **no round-trip** to the write path: it shall consult a cached (TanStack) domain-ownership map and
  branch in-memory; the empty-map write path shall be byte-for-byte the direct DAL with no dispatch
  hop (FR-EAS-010).
- **NFR-EAS-CONTRACT-001** (single coupling seam) The adapter contract shall be the **only** seam
  that knows an external system exists; no PMO code above the contract shall import, reference, or
  name any external system's shapes, endpoints, or vocabulary.
- **NFR-EAS-REV-001** (reversibility) The migration shall be reversible (three tables + policies +
  indexes droppable), follow the additive migration discipline, and ship with pgTAP proofs; any seed
  is local-only, never prod (`docs/environments.md`).
- **NFR-EAS-TEST-001** (pyramid) Unit tests shall use a **mocked** DAL and the reference
  (test-double) adapter; no Vitest test shall require a live database or a real external system.
  RLS / org-isolation / machine-only-write / default-empty / Operator-authority contracts are proven
  by **pgTAP** (`supabase test db`) per ADR-0010. No e2e in P0 — the read-only Integrations
  view's states are unit-owned (RTL render tests, AC-EAS-015) and no cross-stack journey exists
  until a real adapter lands (P1); the pending-push behavior is a shared state machine, not a page.

## 5. Acceptance criteria (Given/When/Then)

> The invariant (AC-EAS-001..003) is the heart of P0. AC-EAS-010..013 (domain ownership) and
> AC-EAS-040..051 (storage) are **pgTAP** (RLS/tenancy/authority contracts). All routing, contract,
> state-machine, view-render, and ordering ACs are **Vitest** (mocked DAL + reference adapter).
> No e2e this issue (no cross-stack journey until P1). Each AC is owned by exactly one test at its
> lowest sufficient layer (ADR-0010).

### The critical invariant

- **AC-EAS-001** — Empty domain-ownership map ⇒ write takes the direct-DAL path (byte-for-byte).
  **Given** an org whose `external_domain_ownership` is empty and a repository write for any domain,
  **When** the write is performed,
  **Then** the write is executed through the existing direct DAL — no adapter dispatch is invoked
  and no adapter command is called — and the observable result (row written, returned shape, error
  `code` on failure) is identical to the pre-adapter system. (FR-EAS-010, FR-EAS-032)

- **AC-EAS-002** — Empty domain-ownership map ⇒ reads from the DAL and no pending-push state.
  **Given** an org with an empty `external_domain_ownership`,
  **When** a repository read is performed and a write is submitted,
  **Then** the read is served from the existing DAL and no `pushing` / `pushed` / `push-failed`
  state is introduced. (FR-EAS-010, FR-EAS-030, FR-EAS-062)

- **AC-EAS-003** — The pre-adapter acceptance suite remains green (zero regression).
  **Given** the adapter seam is installed and every org's `external_domain_ownership` is empty (the
  shipped default),
  **When** the existing test suite (Vitest + pgTAP + e2e) is run unchanged,
  **Then** every previously-passing test still passes — no regression. (FR-EAS-010)
  *(Owning layer: cross-layer regression gate — the unchanged existing suite IS the proof; this is a
  meta-AC, see traceability.)*

### Domain-ownership configuration

- **AC-EAS-010** — The domain-ownership map defaults to empty for a new org.
  **Given** a freshly created org with no configuration written,
  **When** the org's `external_domain_ownership` is read,
  **Then** zero rows are returned (no external tier employed, all domains PMO-owned). (FR-EAS-001,
  FR-EAS-002)

- **AC-EAS-011** — The domain-ownership map is org-isolated.
  **Given** org A has an `external_domain_ownership` row and org B exists,
  **When** a member of org B reads the domain-ownership map,
  **Then** org A's rows are not visible (cross-org read returns nothing). (FR-EAS-005)

- **AC-EAS-012** — Domain-ownership writes are Operator-gated and org-scoped; a spoofed cross-org
  write is rejected.
  **Given** an Operator and a non-Operator org member,
  **When** the non-Operator attempts to write an `external_domain_ownership` row, **then** the write
  is denied; **and when** a write supplies an `org_id` belonging to another org, **then** it is
  rejected (`42501`). (FR-EAS-006, NFR-EAS-SEC-002) *(Subject to OD-1.)*

- **AC-EAS-013** — A domain assignment is bounded by the employed tier's static capability map.
  **Given** an external tier whose static capability map is `{D1, D2}`,
  **When** the `external_domain_ownership` attempts to assign domain `D3` (not in the tier's map) to
  that tier,
  **Then** the assignment is rejected. (FR-EAS-004)

- **AC-EAS-014** — The ownership-decision function routes by own-org ownership only.
  **Given** the ownership-decision function and org A's `external_domain_ownership` assigning domain
  `D` to an employed tier (with org B holding a different assignment),
  **When** the function is evaluated for a caller in org A for domain `D`, for an unassigned domain,
  and with org B's rows present,
  **Then** domain `D` is routed to dispatch, an unassigned domain is routed to the direct DAL, and
  org B's `external_domain_ownership` rows never affect org A's branch. (FR-EAS-003, FR-EAS-033)

- **AC-EAS-015** — The read-only Integrations view renders both states with no write affordances.
  **Given** (a) an org whose `external_domain_ownership` is empty and (b) an org with a tier
  employed owning domains `{D1, D2}`,
  **When** the Integrations view is rendered for each,
  **Then** (a) shows the "no external systems employed" empty state and (b) lists the employed
  tier and its owned domains — and in both, no write affordance (create/edit/delete/toggle) is
  rendered. (FR-EAS-007)

### The adapter contract

- **AC-EAS-020** — The reference adapter implements the contract in PMO domain language.
  **Given** the reference (test-double) adapter,
  **When** its contract surface is inspected and invoked,
  **Then** it declares a static capability map and, for each owned domain, the command and read
  operations, all in PMO domain language with no external-system vocabulary. (FR-EAS-020,
  FR-EAS-021, FR-EAS-025)

- **AC-EAS-021** — A command synchronously returns the external id + canonical record.
  **Given** the reference adapter configured to `commit-success`,
  **When** a create command is issued,
  **Then** the adapter returns a non-null external record id and a canonical PMO-shaped record.
  (FR-EAS-022)

- **AC-EAS-022** — An external rejection / unreachability surfaces as a classified error.
  **Given** the reference adapter configured to (a) `commit-rejected-validation` then (b)
  `external-unreachable`,
  **When** a command is issued in each mode,
  **Then** the adapter surfaces a classified error (`commit-rejected` / `external-unreachable`)
  carrying a message. (FR-EAS-023)

- **AC-EAS-023** — The adapter never receives `org_id`.
  **Given** the dispatch bound to an org context,
  **When** a command is dispatched,
  **Then** the adapter is invoked with no `org_id` argument (the org context is bound at the
  dispatch, above the adapter). (FR-EAS-024, FR-EAS-033)

### Write-routing seam

- **AC-EAS-030** — Reads ALWAYS serve from Supabase, even for an externally-owned domain.
  **Given** a domain `D` is externally-owned for the org and the read-model holds a row for `D`,
  **When** a repository read for `D` is performed,
  **Then** the read is served from the existing DAL (Supabase) and no adapter read is invoked.
  (FR-EAS-030)

- **AC-EAS-031** — An externally-owned write routes through the dispatch (not the direct DAL).
  **Given** domain `D` is externally-owned for the org,
  **When** a repository write for `D` is performed,
  **Then** the direct-DAL write is **not** called and the adapter command **is** invoked via the
  dispatch. (FR-EAS-031)

- **AC-EAS-032** — A PMO-owned write routes through the direct DAL (not the dispatch).
  **Given** domain `D` is PMO-owned for the org,
  **When** a repository write for `D` is performed,
  **Then** the existing direct-DAL write **is** called and no adapter dispatch occurs. (FR-EAS-032)

- **AC-EAS-033** — Synchronous write-through order: command → read-model update → external_refs →
  return.
  **Given** domain `D` is externally-owned and the reference adapter is configured to
  `commit-success`,
  **When** a create write for `D` is performed,
  **Then**, in order, the adapter command is invoked, the read-model is updated from the adapter's
  canonical answer, the `external_refs` mapping is recorded, and success is returned only after the
  external commit. (FR-EAS-034)

- **AC-EAS-034** — External-unreachable ⇒ write fails honestly, read-model unchanged, PMO-owned
  domains unaffected.
  **Given** domain `D` is externally-owned and the reference adapter is configured to
  `external-unreachable`,
  **When** a write for `D` is performed,
  **Then** the write fails with an "external system unreachable — try again" classified error, the
  read-model for `D` is not updated, a subsequent read returns the prior read-model state, and a
  concurrent write to a PMO-owned domain succeeds. (FR-EAS-035, FR-EAS-036)

- **AC-EAS-035** — A user-JWT write to an externally-owned domain's read-model is denied by RLS.
  **Given** domain `D` is externally-owned for org A and the reference domain's read-model table
  (`external_reference_items`) is flipped to machine-only-write for that org,
  **When** a member of org A (user JWT) attempts to `INSERT` / `UPDATE` / `DELETE` a read-model row,
  **then** the write is denied (`42501`); **and when** the dispatch/sync service role writes, **then**
  it succeeds. (FR-EAS-037, NFR-EAS-SEC-002)

### `external_refs` mapping

- **AC-EAS-040** — `external_refs` is org-isolated on read.
  **Given** org A has an `external_refs` row and org B exists,
  **When** a member of org B selects from `external_refs`,
  **Then** org A's row is not visible. (FR-EAS-041)

- **AC-EAS-041** — `external_refs` is machine-written only (a user JWT cannot write).
  **Given** a regular org member (user JWT) and the dispatch/sync service role,
  **When** the member attempts to `INSERT` / `UPDATE` / `DELETE` an `external_refs` row, **then**
  the write is denied; **and when** the service role writes, **then** it succeeds. (FR-EAS-042)

- **AC-EAS-042** — A successful write-through records the `external_refs` mapping.
  **Given** a successful externally-owned write-through (reference adapter `commit-success`),
  **When** the write completes,
  **Then** an `external_refs` row mapping the PMO record id ↔ external record id (and owning tier)
  exists for that domain/org. (FR-EAS-043)

### Sync watermarks storage

- **AC-EAS-050** — The watermarks table is org-isolated and machine-written only.
  **Given** the `external_sync_watermarks` table,
  **When** a regular member reads, **then** they see only their org's rows; **and when** a regular
  member attempts to write, **then** it is denied; **and** the service role may upsert.
  (FR-EAS-050, FR-EAS-051)

- **AC-EAS-051** — A watermark upsert is one row per `(org, tier, domain)`.
  **Given** the service role advancing a watermark for `(org, tier, domain)`,
  **When** it upserts the cursor,
  **Then** exactly one row exists for that key (no duplicates), updated in place. (FR-EAS-052)

### Pending-push UI state (shared behavior)

- **AC-EAS-060** — The pending-push state machine transitions correctly.
  **Given** the shared pending-push behavior,
  **When** an externally-owned write is submitted, **then** the state is `pushing`; **when** it
  commits, **then** the state is `pushed`; **when** it is re-submitted with the adapter
  unreachable, **then** the state is `push-failed`. (FR-EAS-061)

- **AC-EAS-061** — `push-failed` surfaces the classified external error via the shared contract.
  **Given** an externally-owned write that fails (unreachable / rejected),
  **When** the `push-failed` state is reached,
  **Then** the error is surfaced via the shared `{headline, detail}` contract
  (`external-unreachable` → "external system unreachable — try again"). (FR-EAS-063)

- **AC-EAS-062** — PMO-owned writes introduce no pending-push state.
  **Given** a PMO-owned domain,
  **When** a write is submitted,
  **Then** no `pushing` / `pushed` / `push-failed` state is produced. (FR-EAS-062)

### No real external system required

- **AC-EAS-070** — The adapter-contract, write-routing, and pending-push bands pass using only the
  reference adapter.
  **Given** only the reference (test-double) adapter is configured (no ClickUp / ERPNext / Odoo
  present),
  **When** the P0 acceptance suite is run,
  **Then** every AC in the adapter-contract, write-routing, and pending-push bands
  (AC-EAS-020..034, 042, 060..062) passes using only the reference adapter; the pgTAP RLS ACs
  (AC-EAS-010..012, 035, 040..041, 050) and the AC-EAS-003 regression gate are explicitly excluded
  from this claim. (FR-EAS-025)
  *(Owning layer: meta — proven by the reference adapter backing every unit AC in the named bands.)*

## 6. Traceability

| AC | Requirement(s) | Owning layer | Planned test file |
|---|---|---|---|
| AC-EAS-001 | FR-EAS-010, FR-EAS-032 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/router.test.ts` |
| AC-EAS-002 | FR-EAS-010, FR-EAS-030, FR-EAS-062 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/router.test.ts` |
| AC-EAS-003 | FR-EAS-010 | **Cross-layer regression gate** — the unchanged existing suite (`npm run verify` + pgTAP + e2e) remaining green IS the proof; no single new test |
| AC-EAS-010 | FR-EAS-001, FR-EAS-002 | pgTAP | `supabase/tests/external_domain_ownership_rls.test.sql` |
| AC-EAS-011 | FR-EAS-005 | pgTAP | `supabase/tests/external_domain_ownership_rls.test.sql` |
| AC-EAS-012 | FR-EAS-006, NFR-EAS-SEC-002 | pgTAP | `supabase/tests/external_domain_ownership_rls.test.sql` |
| AC-EAS-013 | FR-EAS-004 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/capabilityMap.test.ts` |
| AC-EAS-014 | FR-EAS-003, FR-EAS-033 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/router.test.ts` |
| AC-EAS-015 | FR-EAS-007 | Vitest (unit, RTL) | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-EAS-020 | FR-EAS-020, FR-EAS-021, FR-EAS-025 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/referenceAdapter.test.ts` |
| AC-EAS-021 | FR-EAS-022 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/referenceAdapter.test.ts` |
| AC-EAS-022 | FR-EAS-023 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/referenceAdapter.test.ts` |
| AC-EAS-023 | FR-EAS-024, FR-EAS-033 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` |
| AC-EAS-030 | FR-EAS-030 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/router.test.ts` |
| AC-EAS-031 | FR-EAS-031 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/router.test.ts` |
| AC-EAS-032 | FR-EAS-032 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/router.test.ts` |
| AC-EAS-033 | FR-EAS-034 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` |
| AC-EAS-034 | FR-EAS-035, FR-EAS-036 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` |
| AC-EAS-035 | FR-EAS-037, NFR-EAS-SEC-002 | pgTAP | `supabase/tests/external_reference_items_rls.test.sql` |
| AC-EAS-040 | FR-EAS-041 | pgTAP | `supabase/tests/external_refs_rls.test.sql` |
| AC-EAS-041 | FR-EAS-042 | pgTAP | `supabase/tests/external_refs_rls.test.sql` |
| AC-EAS-042 | FR-EAS-043 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` |
| AC-EAS-050 | FR-EAS-050, FR-EAS-051 | pgTAP | `supabase/tests/external_sync_watermarks_rls.test.sql` |
| AC-EAS-051 | FR-EAS-052 | Vitest (unit) | `pmo-portal/src/lib/db/externalSyncWatermarks.test.ts` |
| AC-EAS-060 | FR-EAS-061 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/pendingPush.test.ts` |
| AC-EAS-061 | FR-EAS-063 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/pendingPush.test.ts` |
| AC-EAS-062 | FR-EAS-062 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/pendingPush.test.ts` |
| AC-EAS-070 | FR-EAS-025 | Vitest (meta) | proven by the reference adapter backing every unit AC in the adapter-contract / write-routing / pending-push bands (AC-EAS-020..034, 042, 060..062) |

> NFR-EAS-SEC-001, NFR-EAS-CONTRACT-001, NFR-EAS-PERF-001, NFR-EAS-REV-001, and NFR-EAS-TEST-001
> are structural/enabling requirements proven transitively (org_id seam + RLS-enabled + contract-shape
> are preconditions exercised by the rows above; the no-added-latency and reversibility claims are
> reviewed at the plan/gate, not a standalone runtime test). FR-EAS-003 and FR-EAS-033 are owned
> directly by AC-EAS-014. AC-EAS-003 is a regression-gate meta-AC by nature.

## 7. Error handling

| Error condition | Classification | User-facing surface | Notes |
|---|---|---|---|
| Empty domain-ownership map (default) | — (no error) | Normal direct-DAL path; identical to pre-adapter | The invariant path (FR-EAS-010) |
| External system rejects command (validation / conflict) | `commit-rejected` | `{headline, detail}` toast carrying the external system's message | Surfaces in-form immediately (ADR-0055 §4); read-model not updated |
| External system unreachable | `external-unreachable` | "external system unreachable — try again" | Write fails honestly; reads keep serving the read-model; PMO-owned domains unaffected (FR-EAS-036) |
| PMO-owned domain error | unchanged | existing error `code` + existing classifier | Byte-for-byte preserved (FR-EAS-010) |
| Cross-org read of any of the three tables | RLS → empty result | (none — rows simply absent) | org isolation (FR-EAS-005/041, NFR-EAS-SEC-002) |
| Non-Operator writes `external_domain_ownership` | `42501` | "you don't have permission" | Operator-gated (FR-EAS-006; OD-1) |
| User JWT writes `external_refs` / `external_sync_watermarks` | `42501` | "you don't have permission" | Machine-written only (FR-EAS-042/051) |
| User JWT writes an externally-owned domain's read-model | `42501` | "you don't have permission" | Machine-written only — RLS write-policy flip (FR-EAS-037; ADR-0055 Consequences bullet 2) |
| Domain assigned to a tier that can't own it | `commit-rejected` (config) | "this system cannot own that domain" | Bounded by static capability map (FR-EAS-004) |

## 8. Implementation TODO (build plan inputs — docs only here)

### Schema / migrations (reversible; RLS on every table)
- [ ] Migration creating `external_domain_ownership` (org-scoped; records employed tiers + flipped
      domains; `org_id` default + `WITH CHECK`); indexes on `(org_id)` and the domain lookup hot path.
- [ ] Migration creating `external_refs` (org_id, domain, pmo_record_id, external_tier,
      external_record_id; `org_id` default + `WITH CHECK`); unique on `(org_id, domain, pmo_record_id)`;
      index on `(org_id, domain, external_record_id)` (reverse lookup).
- [ ] Migration creating `external_sync_watermarks` (org_id, external_tier, domain, watermark cursor,
      updated_at; `org_id` default + `WITH CHECK`); unique on `(org_id, external_tier, domain)`.
- [ ] Migration creating `external_reference_items` (the synthetic reference domain's minimal
      read-model table; org-scoped; `org_id` default + `WITH CHECK`) per OD-4 — the table whose
      write-policy flip makes FR-EAS-037 / AC-EAS-035 provable in P0.
- [ ] RLS policies: org-member `SELECT` on all three seam tables; service-role-only write on
      `external_refs` and `external_sync_watermarks`; Operator-only write on
      `external_domain_ownership` (OD-1); on the reference read-model `external_reference_items`, a
      write-policy flip that denies user-JWT writes and permits only the dispatch/sync service role
      (the FR-EAS-037 mechanism — the pgTAP proof of AC-EAS-035).
- [ ] pgTAP proofs for AC-EAS-010..012, AC-EAS-035, AC-EAS-040..041, AC-EAS-050 (default-empty,
      org isolation, machine-only write, Operator authority, spoofed-org_id rejected; AC-EAS-035
      proves the read-model write-policy flip denies user-JWT and permits the service role).

### Adapter contract + reference adapter
- [ ] Define the adapter contract (declarative capability map + per-domain commands/reads) in PMO
      domain language — types only, no external vocabulary (AC-EAS-020).
- [ ] Implement the reference (test-double) adapter for ≥1 domain with configurable outcomes
      (`commit-success` / `commit-rejected-validation` / `external-unreachable`) (AC-EAS-020..022, 070).

### Write-routing seam
- [ ] Routing decision from the cached own-org domain-ownership map (no `org_id` sent) (AC-EAS-001, 031,
      032, 013).
- [ ] Dispatch edge function: bind org context from JWT, select adapter, invoke command, update
      read-model, record `external_refs`, return — in order (AC-EAS-023, 033, 034, 042).
- [ ] Repository write-method branch (interface UNCHANGED — ADR-0017): PMO-owned ⇒ direct DAL;
      externally-owned ⇒ dispatch. Empty-map branch is a no-op short-circuit (AC-EAS-001).

### DAL + pending-push behavior
- [ ] `external_refs` and `external_sync_watermarks` DAL modules (service-role writes; no `org_id`
      sent) + repository entries (AC-EAS-042, 051).
- [ ] Shared pending-push behavior (state machine: `idle`/`pushing`/`pushed`/`push-failed` + error
      mapping to `{headline, detail}`) (AC-EAS-060..062).
- [ ] Read-only Integrations view (empty state + employed-tiers/owned-domains list, no write
      affordances; DESIGN.md tokens; RTL render tests) (AC-EAS-015).

### Verification (final gate — run from `pmo-portal/` + repo root)
- [ ] `npm run verify` (typecheck + lint:ci + test + build) green — includes the regression net
      (AC-EAS-003).
- [ ] `scripts/with-db-lock.sh supabase test db` green (the pgTAP band) (AC-EAS-010..012, 035,
      040..041, 050).

## 9. Out of scope (explicit — later phases)

- **Real adapters / external API specifics** — ClickUp (P1), ERPNext (P2), ERPNext width (P3), Odoo
  (P4). No Frappe REST, Odoo JSON-RPC, or ClickUp REST detail in P0.
- **Webhook ingress + the watermark reconciliation-sweep engine** (P1). P0 stores watermarks; it does
  not run a sweep. Webhooks for latency + sweep for truth is the P1 change-feed (ADR-0055 §3).
- **Real read-model tables for real domains** and their population (P1+, when a domain actually
  flips). P0 proves the seam with the reference adapter; no real domain is flipped.
- **Backfill / promote runbook** for flipping an existing client (ADR-0055 consequence — operational,
  per-flip, later).
- **Per-client secret provisioning** (ERP/ClickUp tokens in 1Password vault `AS`) — wiring is P1+.
- **Helper apps** (ADR-0055 §2 — a per-deployment accelerator; no adapter may require one).
- **Versioned-plan (budget) projection, sales-document commands, party/procurement AP commands**
  (P2/P3 domain work).
- **Enhancement storage schema** beyond the id/cursor bookkeeping here — enhancements are additive
  PMO-side data per externally-owned record; their storage lands with the domain that needs them
  (P1+). P0 names the concept (glossary) but specifies no enhancement table.
- **A write-capable admin surface** for the domain-ownership map — P0 ships the storage + write
  contract (RPC) and the **read-only** Integrations view (FR-EAS-007, decided OD-2); an admin
  surface with write affordances is deferred (Operator provisions via RPC).
- **Optimistic-UI reconciliation** — the per-surface reconcile of an optimistic state against the
  external answer (e.g. a board drag) lands with the first real routed UI surface (P1+); it composes
  the shared pending-push behavior (FR-EAS-060..063) shipped in P0. Not built here.

## 10. Open questions / owner-decision flags

- **[DECIDED — owner, 2026-07-10] OD-1 — Domain-ownership write authority: Operator-only.**
  `external_domain_ownership` writes are restricted to the platform **Operator** (employing an
  external tier is an integration-provisioning action: it flips domains and involves per-client
  secrets); org members read their own org's rows. Granting org-Admin write later is a one-line
  RLS change. (FR-EAS-006 / AC-EAS-012.)
- **[DECIDED — owner, 2026-07-10] OD-2 — Admin surface in P0: minimal READ-ONLY Integrations
  view.** P0 ships the domain-ownership storage + write contract (RPC) **plus** a read-only
  Integrations view (employed tiers + owned domains, explicit empty state, no write affordances)
  — FR-EAS-007 / AC-EAS-015. A write-capable admin surface stays deferred (§9).
- **[DECIDED — owner, 2026-07-10] OD-3 — Routing-decision location: client-side branch on the
  cached map.** FR-EAS-033 places the branch in the repository implementation, consulting a
  **cached** own-org domain-ownership map (no write-path round-trip; empty-map short-circuit ⇒
  byte-for-byte). This branch is **UX/DX-only routing** — never the write authority. RLS remains
  the enforcement authority: for an externally-owned domain, RLS denies user-JWT writes to that
  domain's read-model and permits writes only to the dispatch/sync service role (FR-EAS-037).
  The alternative — *always* dispatch to a server edge function that branches server-side — is
  **rejected**: it changes the path for every domain (even PMO-owned) and breaks the
  byte-for-byte invariant.
- **[DECIDED — owner, 2026-07-10] OD-4 — Reference adapter's domain: synthetic/isolated.** The
  reference adapter proves the seam against a **synthetic test-only domain** (zero contact with
  real-domain behavior), shipping a **minimal read-model table** (`external_reference_items`,
  org-scoped, machine-written) whose write-policy flip — deny user-JWT, permit only the
  dispatch/sync service role — is the pgTAP proof of the FR-EAS-037 / AC-EAS-035 mechanism.
- **OQ-1 — Watermark cursor type.** Whether the cursor is a timestamp, an opaque token, or an
  integer offset is a plan detail (it depends on the P1 sweep + each external system's
  modified-since semantics). P0 only requires that storage exists and is upsertable per
  `(org, tier, domain)`.
- **OQ-2 — `external_refs` richness.** P0 stores the minimal mapping (org, domain, pmo_record_id,
  external_tier, external_record_id). Whether it later carries a last-synced timestamp / sync health
  state is a P1 concern (when the change-feed needs it); not added in P0.
- **OQ-3 — Optimistic-UI surface set.** Optimistic display (reconcile on the external answer,
  ADR-0055 §4) is deferred to P1+ per §9 — P0 names no specific surface (e.g. board drag); those
  land with the real-domain UIs. The shared pending-push behavior is what they will compose.
