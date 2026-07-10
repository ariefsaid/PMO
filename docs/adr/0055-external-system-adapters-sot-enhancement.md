# ADR-0055 — External-system adapters: SoT-by-domain, enhancement layer, synchronous write-through

- **Status:** Accepted (owner grill session 2026-07-10)
- **Date:** 2026-07-10
- **Deciders:** Owner, Director
- **Related:** ADR-0048 (partially superseded — see below), ADR-0047 (per-client topology),
  ADR-0017 (repository seam), `docs/glossary.md` §Integration, `docs/roadmap-spines.md` (spine 4).
- **Scope:** how PMO integrates with external systems that natively own domains — ERPs
  (ERPNext default, Odoo) and task platforms (ClickUp) — and what that makes Supabase.

## Context

Owner-directed revisit of ADR-0048 ("nothing is sacred", 2026-07-10), prompted by three things:
(1) the wish to reuse RIS-portal-2's data layer; (2) questioning the "not a bidirectional sync"
rule; (3) a strategic partnership with an ERPNext + ClickUp distributor in Indonesia, making
ClickUp task integration a near-term feature, and Odoo-owning prospects a real (not
hypothetical) segment. Exploration of RIS-portal-2 established: its real data layer is a Frappe
custom app (`ris_portal_ui/api/*.py`, 26 modules ~21k LOC Python, session/CSRF auth, Vue 3
frontend) — inseparable from Frappe, not portable into a React/Supabase app; its durable value
is doctype mappings and business rules. A local ERPNext v15 bench (`~/Coding/frappe-bench`)
with `ris_portal_ui` installed exists as the dev/test bed.

## Decision

### 1. Layering: PMO is the app layer; external systems are optional SoT tiers

- **Supabase = the platform + app layer**: auth, RLS/tenancy, edge functions, agent tier,
  storage, app-only domains, and (for externally-owned domains) read-models + enhancements.
  PMO runs **fully standalone** with no external system (all domains PMO-owned).
- **External-system tiers are optional per client.** Employing one flips the domains it
  natively owns (per its **capability map**) to externally-owned. ERPNext is the default ERP
  offer; Odoo is supported for clients who already run it (self-hosted; Odoo Online clients are
  migrated to self-host as a service); ClickUp is the task-platform tier.
- ERP swappability is a **real requirement** (mixed fleet), not a hedge — so PMO's canonical
  domain model + the ADR-0017 `Repositories` contract remain the seam. No PMO code couples to
  any external system's shapes.

### 2. Adapters: PMO-side TypeScript against stock APIs; helper apps optional

- One **adapter** per external product (ERPNext, Odoo, ClickUp), implementing one PMO-owned
  **adapter contract** (per domain: commands + reads), running PMO-side in edge functions.
- Adapters speak the **stock API only** (Frappe REST + token auth; Odoo JSON-RPC; ClickUp REST)
  — mandatory, because client-owned instances (esp. Odoo) accept no custom modules.
- A **helper app** (e.g. a Frappe custom app on vendor-controlled ERPNext instances) is a
  per-deployment accelerator; **no adapter may require one**.
- This **overturns ADR-0048's "no Python→Node port" note**: that rule assumed we always own the
  ERP box. RIS-portal-2's `api/*.py` is reused as (a) the mapping/business-rule spec for the
  ERPNext adapter (ported to TS where needed) and (b) source material for a future helper app.
  Its Vue/Pinia client layer and session auth are not reused. `ris-erp-portal/types.ts` +
  `api/*.py` docstrings serve as the field/endpoint contract reference.
- No third open-source ERP is designed for (Tryton/iDempiere/Axelor/Dolibarr/metasfresh all
  rejected on ecosystem depth); a third ERP later is just another adapter.

### 3. SoT rule + enhancement layer (supersedes the ADR-0048 sync framing)

- **When a client employs an external system, that system is the source of truth for every
  domain it natively owns.** Supabase holds a **read-model** (machine-written only) plus
  **enhancements**.
- **Enhancements are additive-only**: an enhancement never duplicates a field the native
  object carries; the external system owns the record's existence and all native fields. No
  field is writable in two places ⇒ field-level conflicts are impossible by construction.
- ADR-0048's single-writer rule survives strengthened: *the external system is the single
  writer of truth; read-models are written by sync machinery alone; users never write them.*
  "Two-way sync" is realized as **commands down + change-feed up** — no conflict resolution
  layer exists or is needed.
- Change-feed mechanics: **webhooks for latency** (ERPNext native Webhooks doctype, ClickUp
  native webhooks, Odoo `base_automation`) + a **watermark reconciliation sweep** (poll
  modified-since cursor) as the safety net. Webhooks for latency, sweep for truth.
- Edits made natively in the external system's own UI are legitimate by definition (it is SoT)
  and arrive via the change-feed.

### 4. Write semantics: synchronous write-through

PMO user actions on an externally-owned domain are **synchronous commands**: PMO → adapter →
external commit → read-model update → return. The external system's validation verdict surfaces
in the form immediately. External system down ⇒ writes to its domains fail honestly ("ERP
unreachable — try again"); reads keep serving from the read-model; PMO-owned domains are
unaffected. No queue, no write-behind, no divergence states. Where a surface needs snappiness
(e.g. board drag), add **optimistic UI per surface** with a visible pending state ("pushing to
ERP"), reconciling on the external answer — semantics unchanged underneath.

### 5. Ownership map (ERPNext capability map)

| PMO domain | Owner when ERPNext employed | Notes |
|---|---|---|
| Accounting (GL, AP/AR, payments, invoices) | **ERP** | always; PMO has no ledger (ADR-0048 stands) |
| Procurement chain (PR/RFQ/PO/GR/Invoice/Payment) | **ERP** | 1:1 native match; PMO is the UI over it |
| Companies/Contacts (Customer/Supplier/Contact) | **ERP** | party master; created via synchronous command |
| Sales money documents (Quotation, Sales Order, Sales Invoice) | **ERP** | = spine 4 Revenue/AR lands as commands |
| Timesheets | **ERP** | native + costing; PMO weekly-grid UX is the surface; approve = command |
| Budgets | **ERP object + PMO versions** | see §6 |
| Projects (header) | **PMO**, reference pushed down | ERP needs Project as accounting dimension; PMO pipeline semantics richer |
| Tasks + Milestones | **PMO** — or **ClickUp** when employed (§7) | milestone model is a deliberate PMO deviation |
| CRM pipeline + activities | **PMO** | pipeline record *is* the project record (one entity opportunity→delivery); ERPNext Lead/Opportunity convert-and-die model is lossy |
| Incidents | **PMO** | HSE/project ≠ helpdesk Issue |
| Documents register | **PMO** (Supabase Storage) | reference/link pushed down to ERP records |
| Agent tier, user views, credits, org/users | **PMO/platform** | by construction |

**Money principle:** money that has **happened or is committed** (invoices, payments, POs,
actuals, GL) is externally-owned, always. Planning artifacts wrap native objects as
enhancements (§6). Where an ERP's native capability is missing (e.g. Odoo gaps), the domain
stays PMO-owned for that client — the per-ERP capability map is a **commercial argument**
("port to ERPNext"), not an engineering workaround.

### 6. Versioned-plan pattern (budgets; generalizes)

Versions live PMO-side as enhancements; **exactly one active version is projected into the
ERP's native object** (ERPNext `Budget`, one per project × fiscal year — multi-year projects
project into one object per FY). Activating a version = synchronous command amending the ERP
object. ERP-side edits reconcile up into the active version with a "capture as new version"
offer. The ERP's figure wins unconditionally; PMO versions record lineage. Same pattern for
any planned/versioned artifact over a native object.

### 7. Tasks: ClickUp as SoT when employed

Same rule, third system: a client employing ClickUp flips tasks to ClickUp-owned — PMO task
tables become read-model + enhancements (milestone grouping, weights, dependencies, rollup
stay PMO-side, computed over mirrored tasks); task CRUD = synchronous ClickUp commands;
webhooks + sweep feed changes up. Free-tier ClickUp supports API + webhooks (~100 req/min),
so the adapter works pre-upsell — the distributor partnership's adoption wedge. **Noted
asymmetry:** ClickUp is US-hosted SaaS, unlike self-hosted ERPs — task-domain data locality
differs; state it in client conversations.

### 8. Phasing

| Phase | Content |
|---|---|
| **P0** | The seam: adapter contract, `external_refs` mapping table + watermarks, pending-push UI state, per-client capability map config |
| **P1** | **ClickUp adapter (tasks)** — deliberately before ERPNext: smallest real adapter, proves SoT/enhancement/read-model machinery at low stakes, partnership demo |
| **P2** | ERPNext adapter, money core: parties, procurement chain, AP commands + actuals/AP-AR aging read-back (old ADR-0048 F1, enlarged) |
| **P3** | ERPNext width: timesheets, budget projection, sales documents (spine 4) |
| **P4** | Odoo adapter, when a real Odoo client signs |

ADR-0048's v1 ("sign now, zero integration, side-by-side") is unchanged and remains the
entry wedge.

## Consequences

- **ADR-0048 partially superseded:** its integration architecture (Python `pmo_connector`
  Frappe app as *the* connector; "not a bidirectional sync" framing; F1–F3 phasing) is replaced
  by this ADR. Its core stands: ERPNext as the accounting engine, no homegrown ledger, no-Odoo-
  default rationale, v1 side-by-side, per-client instances, ledger-sourced display rule (PMO
  never recomputes externally-read figures).
- Read-model tables need RLS write policies restricted to the sync service role for
  externally-owned domains (per client capability map) — a per-domain, reversible flip.
- Flipping a domain to externally-owned for an *existing* client requires a backfill/promote
  runbook (push existing Supabase rows into the external system, then flip ownership).
- Per-client secrets grow again (ERP API token, ClickUp token) — 1Password vault-`AS` pattern.
- The agent tier and all pgTAP/RLS proofs keep working unchanged: reads (incl. agent reads)
  always hit Supabase; only the write path of externally-owned domains changes.
- Data-locality asymmetry (ClickUp US SaaS vs self-hosted ERP) is a stated client-facing fact.
