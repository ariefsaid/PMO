# ADR-0094 — PMO's route to a standalone ERP

- **Status:** Proposed
- **Date:** 2026-10-30
- **Related:** ADR-0048, ADR-0055, ADR-0058, ADR-0059; decision map #1481, especially #1485–#1486

## Context

The EPC prospect needs one usable interface across project control and standard ERP operations. An external ERP already supplies a ledger and other mature functions, while a permanent dependency on its user interface would prevent PMO becoming a standalone ERP. Two distinct meanings of ownership matter: an **ERP-owned domain** has authoritative native records in the connected ERP; a **PMO-owned process** has authoritative decisions and operational records in PMO, even when its approved outcome is mirrored to an ERP. A copy is not a second source of truth.

## Decision

PMO is the client's only interface. ERPNext or Odoo Community runs self-hosted and headless, either hosted as part of the service or on the client's server, with zero ERP customisation required. For the pilot, Odoo Community is the baseline; no Enterprise feature, custom or third-party module, or Studio change is required. PMO provides standard ERP workflows and screens for ERP-owned domains, as well as PMO-owned project workflows. These are product capabilities, not client-specific adaptations. PMO retains its own copy of relevant data and incrementally builds the capabilities needed to operate as an ERP without an external system. This is a destination, not a claim that standalone accounting is already available.

When connected, the ERP remains source of truth for the domains it owns, including its ledger, tax, vendor bills and payments, stock quantity and valuation, and asset and maintenance register; PMO's copy is reconciled, and commands and their outcomes remain visible to users. PMO owns its operational processes including project controls, acceptance, approvals, site cash workflow, attendance and payroll sheet, and project usage. ADR-0059's PMO-SoT side-mirror posture applies when PMO owns the process; connected ERP documents do not silently take ownership of that process. An issue of stock, for example, records project and work item in PMO while the connected ERP owns quantity and valuation; a failed or uncertain posting must be visible and reconciled, not represented as an ERP success.

Without an ERP, a domain is PMO-owned only once its standalone implementation and migration/cutover are actually delivered and validated. The sequence, ledger, tax, migration and coexistence decisions remain open; no dual writers or automatic ownership flip are authorised here.

## Relationship to earlier decisions

This **proposes to supersede ADR-0055 §1 and §3 insofar as “app layer” / additive-only enhancement over ERP-owned native features implies that PMO only supplements an ERP interface or need never implement standard ERP workflows and data**. PMO is now the sole interface and intentionally builds a full standard workflow and local copy on a path to standalone operation. This does not make the copy authoritative while the ERP owns that domain, nor permit independent conflicting writes. ADR-0055's optional integrations, canonical domain model and repository seam remain.

Retain the PMO-owned adapter contract, stock API-only rule, command/read boundary and change-feed reconciliation. Odoo 20 planning targets JSON-2 and a Community baseline; validate stock model and webhook behaviour against the actual version, and use a watermark sweep for recovery. ADR-0058's durable money outbox, idempotency, fenced recovery and honest outcome semantics remain, as do ADR-0059's process ownership and side-mirror invariants. The outbox is recovery and idempotency infrastructure, not permission to report an uncommitted ERP transaction as successful. ADR-0048's headless accounting-engine principle remains until a separately approved standalone-ledger decision replaces it.

## Consequences and alternatives

PMO gains a consistent user experience and reusable domain workflows across ERP implementations, at the cost of maintaining screens, canonical mappings, reconciliation and eventual cutover. Leaving the ERP UI as the operational interface was rejected because it fails the single-interface and standalone goals; replacing the ERP ledger immediately was rejected because the necessary sequencing and correctness decisions are not yet made. ERP unavailability and ambiguous outcomes must be shown honestly; an offline field capture does not bypass online approval or money rules. Owner approval of this proposed ADR and per-slice specs remains required before implementation.
