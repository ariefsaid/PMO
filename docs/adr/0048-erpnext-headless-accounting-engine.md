# ADR-0048 — ERPNext as headless accounting engine under PMO (no homegrown ledger, no Odoo)

- **Status:** Accepted (owner-directed 2026-07-04)
- **Date:** 2026-07-04
- **Deciders:** Owner, Director
- **Related:** ADR-0047 (GTM topology), `docs/roadmap-spines.md` (spine 4 Revenue/AR),
  product vision "operational layer over a pluggable ERP backend"
  (memory: product-vision-operational-layer).
- **Scope:** how PMO provides an auditable accounting layer for clients who need an ERP
  underneath the tracker — including two current prospects with no existing ERP.

## Context

Two GTM prospects want PMO's project tracking + UI **and** an auditable accounting data layer
(GL, AP/AR, Indonesian tax). They run no ERP today; they have Odoo brand awareness but are not
Odoo users, and they preferred PMO's UI in demos. Options considered:

1. **Build accounting in Supabase/PMO** — REJECTED outright: double-entry GL, period close,
   PPN/e-Faktur, auditor-grade statements are years of undifferentiated work, and a homegrown
   ledger has negative credibility with auditors. Accounting is the canonical "buy".
2. **Odoo underneath** — REJECTED: Odoo *Community* lacks full accounting (Enterprise is
   per-user paid); our reusable asset base (RIS-portal-2, Frappe experience) is ERPNext-side.
   Odoo brand awareness is a sales objection to answer, not an architecture input.
3. **ERPNext underneath** — ACCEPTED (below).

## Decision

**The packaged offer is PMO (cockpit, Supabase) + a per-client ERPNext instance (accounting
system-of-record; Frappe Cloud managed, or the ADR-0047 VPS exit path).** PMO aims to become
the UI for every persona including the accountant; ERPNext trends toward a **headless
accounting engine**.

Integration architecture (fast-follow, not MVP):

- ERPNext-side: a **`pmo_connector` Frappe custom app in Python** — trimmed/hardened from
  RIS-portal-2's `api/*.py` layer (which already encapsulates DocType knowledge behind
  business-shaped, permission-checked whitelisted endpoints; its ADR-007 seam anticipated
  this reuse). Rework = session auth → API token, cut UI-serving code. **No Python→Node
  refactor**: Frappe server logic must be Python inside the bench; the seam is HTTPS/JSON.
- PMO-side: a thin **TypeScript client in edge functions**.
- **Not a bidirectional sync — a command/query split.** Writes go down as idempotent
  commands (record vendor invoice, record payment, issue client invoice); reads come up
  (actuals, GL balances, AP/AR aging). **Single-writer rule per DocType** (PMO writes it or
  ERPNext does, never both) — the one rule that prevents integration hell. With PMO as the
  only human surface there is nothing to "sync" and no conflicts by construction.

Phasing (sell the destination, ship the phases):

| Phase | Accountant surface | Build |
|---|---|---|
| v1 (sign now) | ERPNext UI, manual keying from PMO data | zero |
| F1 | PMO pushes AP checkpoints (vendor invoice, payment) + reads back actuals; **AR/AP aging views in PMO** (read-only, rides the same read-back) | connector + TS client + aging views |
| F2 | Client invoicing from PMO — this becomes PMO's Revenue/AR spine 4 | AR commands + UI |
| F3+ | Accountant workspace grows in **small incremental chunks** (payment runs, reconciliation views, …), each its own issue | incremental |

**Owner-directed 2026-07-04: the accountant workspace is deliberately chunked and pulled
forward** (aging first, in F1) rather than one large late build. **Period-close, e-Faktur and
other statutory workflows stay in ERPNext's native UI indefinitely — deferred until explicitly
picked up**, likely never for e-Faktur.

## Consequences

- These clients can be signed with **zero integration build** (v1 side-by-side).
- Per-client infra grows to two managed services (Supabase project + ERPNext instance);
  provisioning runbook (ADR-0047) gains an ERPNext leg.
- PMO's missing Revenue/AR spine stops blocking GTM — invoicing lives in ERPNext until F2.
- An **Odoo connector is a separate future build** (different API/models); ERPNext is
  sequenced first because that's where prospects and reusable code are.
- Financial figures shown in PMO after F1 come from ERPNext reads — PMO must display them as
  ledger-sourced, not recompute them, or the two systems' numbers will drift in demos.
