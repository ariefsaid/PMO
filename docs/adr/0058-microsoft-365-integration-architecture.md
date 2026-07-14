# ADR-0058 — Microsoft 365 integration architecture (auth hybrid · Graph-as-adapter · two-switch entitlement · topology-independent)

- **Status:** Accepted (owner grill 2026-07-14; priority + ADR-0059 topology ratified; token mechanism deferred to Phase 0)
- **Date:** 2026-07-14
- **Deciders:** Owner, Director
- **Related:** ADR-0059 (Entra app-registration topology), ADR-0055 (external-system adapters — the
  Graph-data pattern), ADR-0049 (Operator/entitlements — two-switch model), ADR-0047 (per-client siloed
  topology), ADR-0001 (org_id seam), ADR-0044 (agent automations/notifications), ADR-0036/0040 (agent
  tier), ADR-0016 (FE authz UX-only / RLS-as-ceiling). **Vision:** `docs/microsoft-365-integration.md`.
- **Scope:** the *shape* of how PMO integrates with Microsoft 365 (Entra ID, Graph: OneDrive/SharePoint,
  Teams, Outlook/Calendar, Planner). NOT the feature roadmap (that's the vision doc) and NOT the app
  registration topology (ADR-0059).

## Context

A client already on Teams/OneDrive prompted an SSO + doc-linking request (2026-07-14). Exploration
established M365 as a **layer** over PMO — auth + a family of Graph-data features — rather than a single
feature. Before committing feature work we need the architectural invariants fixed, so features don't each
re-invent auth, tenancy, entitlement, and token handling. Two facts constrain the design: PMO ships
**siloed one-project-per-client** today (ADR-0047) with the pooled seam preserved (ADR-0001); and PMO
already has a mature external-integration pattern (ADR-0055, ClickUp) and an agent tier (ADR-0036/0040).

## Decision

**1. Authentication and authorization stay separate (the SSO hybrid).**
Microsoft sign-in *authenticates* via Supabase's `azure` OAuth provider; PMO *authorizes* exclusively
through the existing invited-`profiles` + RLS model. OAuth is never an enrollment bypass
(`enable_signup=false`; an uninvited Microsoft user gets no profile, not data). One multi-tenant Entra
app authenticates across clients; each client's *data and authorization* remain siloed. This is the one
place "pooled" ships — at the auth layer only. (Shipped; `docs/environments.md`.)

**2. Graph *data* features follow the ADR-0055 adapter pattern.** OneDrive/SharePoint, Teams, Outlook,
and Planner are external surfaces PMO reads/commands through a **PMO-owned adapter contract** running in
edge functions, speaking the **stock Graph API only**, per client. Microsoft (SharePoint/Graph) remains
the **source of truth and permission authority** for documents linked by reference — PMO stores a
driveItem reference, never a copy (link/reference model; copy-into-Storage is rejected for M365 clients).
Change-feed = Graph webhooks for latency + a watermark reconciliation sweep for truth (the ADR-0055 /
`external_sync_watermarks` shape). A Microsoft **Planner** task integration is a new *tier* alongside the
ClickUp adapter (ADR-0056), not a bespoke build.

**3. Every integration has two switches with two owners (ADR-0049).** *Entitlement* (is the org allowed
to use M365 integration — a plan/billing gate) is **Operator**-owned via `org_features` /
`operator_toggle_feature`. *Configuration/activation* (the client wires up their own tenant: admin
consent, which pieces are on) is **org-Admin**-owned via an org settings surface. The Operator entitles;
the Admin activates. This pair is built once and reused for M365, ClickUp, and ERPNext.

**4. The agent tier extends to M365 unchanged (RLS-as-ceiling).** A Teams-invoked LLM assistant and
Teams actionable-approval cards are new *entry points* to the existing agent + RPC layer, not new
authority. Approvals call the existing server-enforced SoD RPCs (ADR-0019); the Teams bot runs under the
invoking user's identity/permissions — a "show me all orgs" prompt still hits that user's RLS
(ADR-0036/0044 deputy model). No M365 surface is handed `service_role`.

**5. The integration is topology-independent.** Nothing here depends on pooled-vs-siloed (ADR-0047/0001).
It works identically under both; the only topology-sensitive choice is the Entra app registration, which
is isolated to **ADR-0059**. Consequently this integration can proceed without reopening ADR-0047.

**6. Shared Graph token lifecycle, built once.** Supabase returns a `provider_token` at sign-in but does
not refresh it; durable Graph access requires a deliberate token layer (MSAL on the client OR an
edge-function refresh-token store — chosen in Phase 0). This foundation is built once and underpins docs,
Teams, calendar, and tasks — not re-solved per feature.

## Consequences

- **Positive:** features inherit auth, tenancy, entitlement, agent-authority, and token handling from
  fixed invariants — each feature is "an adapter + a surface," not a platform. Security posture
  (RLS-as-ceiling, server-enforced SoD, invite-only authz) is preserved by construction. Decoupled from
  the pooled/siloed decision, so it never blocks on it.
- **Cost / negative:** the token lifecycle and the two-switch settings surface are real Phase-0
  investments before the first user-visible feature. Teams interactive features require a Teams app
  package (custom-upload per client until a store listing exists). Per-client secrets multiply (the
  vault-`AS` pattern extends — see ADR-0059).
- **Risk if skipped:** without these invariants, each M365 feature would re-implement token handling and
  entitlement ad hoc, and the SSO "authentication ≠ authorization" line could erode into an accidental
  signup bypass.

## Ratified (2026-07-14) & open

- **Priority frame (ratified):** M365 is a **delight layer positioned to drive enterprise adoption** —
  the wedge for orgs that already live in Teams and the Microsoft ecosystem. Delight-first in build
  order (§3 sequencing), enterprise-adoption in *positioning*: the integrations are what make a
  Teams-native org choose and stay on PMO. Not a self-serve/PLG motion (that remains deferred with the
  pooled topology, ADR-0047).
- **Topology (ratified):** ADR-0059 → Option C default, B escape hatch.
- **Open:** token lifecycle mechanism (§Decision 6) — decided in Phase 0; publisher verification
  sequencing (needed for C).
