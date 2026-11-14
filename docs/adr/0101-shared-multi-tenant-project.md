---
status: accepted
date: 2026-11-14
---

# ADR-0101 — One shared hosted project for all client organizations

- **Decided by:** owner, 2026-11-14.
- **Changes:** the deployment posture that followed ADR-0001 (one hosted project per client). ADR-0001's
  `org_id` seam and its row rules stay exactly as they are; this ADR is the "go multi-tenant" step it prepared.
- **Relates to:** ADR-0016 (authorization), ADR-0047 (backups), ADR-0055 (adapter seam), ADR-0060 (token custody).

## Context

Until now each client was to get its own hosted project. Two clients are onboarding at the same time, on
different ERPs (one ERPNext, one Odoo). A project per client multiplies cost, migrations, deploys, secrets and
monitoring, and the hosted project already holds more than one organization.

An audit on 2026-11-14 read every table and row rule, every client-callable database function, storage, every
edge function and the app. It found no path for one organization to read or change another's data. It also
found work that a shared project needs before two real clients run in it.

## Decision

All client organizations live in **one hosted project**. Tenancy is the organization, enforced by row rules on
every business table and by server functions that take the organization from the caller's identity, never from
a request.

Rules that follow:

- **Every new table, function, edge function, schedule, secret and setting is per organization unless it is
  provably global reference data.** A reviewer asks "what happens with two organizations?" of every change.
- **A write with no organization fails.** No default organization for server-side writes.
- **Shared resources need a fairness rule**: a schedule or budget that serves all organizations must not let
  one starve another.
- **Per-organization configuration** for every integration (ERP, document storage, mail, assistant): one
  client's setup never limits another's.
- **Sample and test organizations never share the production project's data paths** with real clients; the
  demo seed can never run against it.
- **Onboarding is "add an organization"**, not "create a project": scripted, repeatable, with an explicit plan.

## Consequences

- **Accepted costs of sharing:** a database restore affects every organization (per-organization recovery
  means export and re-import, not point-in-time restore); connections, rate limits and platform quotas are
  shared; one migration reaches every client at once.
- **Work before two real clients share the project** is tracked under the map issue "Shared multi-tenant
  project". Detail of anything not yet fixed is kept out of this repository until its fix ships.
- **Later:** per-organization export and offboarding; fairness for shared schedules; per-organization usage
  reporting.
- A client that needs physical separation (contract or regulation) can still get its own project: the code is
  the same; only the deployment differs.
