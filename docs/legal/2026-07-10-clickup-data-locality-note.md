# ClickUp Data Locality Note

**Date:** 2026-07-10
**Applies to:** PMO Portal with ClickUp adapter integration

## Overview

When an organization employs ClickUp as the external system of truth for the Tasks domain (via the ClickUp adapter), task-domain data resides with ClickUp servers. This creates a data-locality asymmetry that customers must be aware of.

## Data Residency

- **ClickUp is US-hosted SaaS** — All task data synchronized via the ClickUp adapter resides on ClickUp's servers located in the United States.
- **The PMO Portal** — Remains the application layer and stores mirror data in the Supabase PostgreSQL database for read-only access and reporting purposes.
- **Source of Truth** — ClickUp is the authoritative source for task data. All writes (create, update, delete, status transitions) originate from ClickUp and are reflected in the PMO Portal via the adapter seam.

## Implications

1. **Cross-border Data Transfers** — Task data crosses national borders to and from US-hosted ClickUp infrastructure.
2. **Data Governance** — Organizations employing ClickUp must ensure their data governance policies permit US data residency.
3. **Compliance** — It is the customer's responsibility to verify that using ClickUp complies with applicable data protection regulations (GDPR, CCPA, etc.).

## Customer Disclosure

This information is surfaced to customers in two places:
1. The **Integrations view** in the Administration section — Displays the locality note when ClickUp is employed.
2. This **legal documentation** — Provides the comprehensive statement for legal/compliance review.

## Related Documentation

- [ClickUp Adapter Specification](../specs/clickup-adapter.spec.md)
- [External Adapter System Design Decision](../adr/0055-external-adapters.md)
- [Data Locality Non-Functional Requirement](../specs/clickup-adapter.spec.md) — NFR-CUA-LOCALITY-001