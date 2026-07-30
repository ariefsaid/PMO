# ADR-0063 — Microsoft 365 integration architecture (auth hybrid · Graph-as-adapter · two-switch entitlement · topology-independent)

> ⚑ **Renumbered 0058 → 0063 on 2026-07-25.** It was created on 2026-07-20 at a number already
> taken, so `grep ADR-0063` resolved to unrelated documents. The ADR that CREATED the number keeps it
> (first-created wins); this one moved. Older citations of "ADR-0063" in M365/admin-connect context
> mean THIS document.

- **Status:** Accepted (owner grill 2026-07-14; priority + ADR-0064 topology ratified; token mechanism deferred to Phase 0)
- **Date:** 2026-07-14
- **Deciders:** Owner, Director
- **Related:** ADR-0064 (Entra app-registration topology), ADR-0055 (external-system adapters — the
  Graph-data pattern), ADR-0049 (Operator/entitlements — two-switch model), ADR-0047 (per-client siloed
  topology), ADR-0001 (org_id seam), ADR-0044 (agent automations/notifications), ADR-0036/0040 (agent
  tier), ADR-0016 (FE authz UX-only / RLS-as-ceiling). **Vision:** `docs/microsoft-365-integration.md`.
- **Scope:** the *shape* of how PMO integrates with Microsoft 365 (Entra ID, Graph: OneDrive/SharePoint,
  Teams, Outlook/Calendar, Planner). NOT the feature roadmap (that's the vision doc) and NOT the app
  registration topology (ADR-0064).

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

> **⚑ AMENDMENT 2026-07-24 (owner) — M365 *activation* is OPERATOR-gated, not org-Admin-gated.**
> The rule above still holds for **ClickUp and ERPNext**: the client supplies their own API
> credential, so their org-Admin opts in (`external-connect` gates on *Admin-of-org OR Operator*).
> It does **not** hold for M365. Under [ADR-0064](0064-entra-app-registration-topology.md) Option C
> the **Entra app registration lives in the vendor tenant** — it is our credential, not the
> client's — so initiating a Graph token connection is a *platform* action, not a client opt-in.
> Letting a client org-Admin bind our vendor-owned app registration would hand them control of a
> credential they do not own.
>
> **The rule this establishes:** *whoever owns the credential owns the activation switch.* Client
> supplies it → org-Admin activates. Vendor owns it → Operator activates. Entitlement stays
> Operator-owned in both cases, unchanged.
>
> **As-built:** `m365-token-custody/auth.ts` (`authorizeOperatorEntitled`) checks
> `platform_operators` **service-side** — the table has no caller-readable policy — using the
> `userId` from `verifyCallerJwt`, so impersonation cannot reach it (ADR-0016). The FE card is
> gated by `useIsOperator()`; that gate is **UX only** — the edge function rejects independently.
> Coverage: `AC-M365-131` (an org Admin who is *not* an Operator is FORBIDDEN — the load-bearing
> case), plus `AC-M365-102` / `AC-M365-151` at the initiate and status handlers. Mutation-checked:
> disabling the gate turns 4 tests red across 3 files.
>
> **Scope limit (deliberate):** the org is still resolved from the **caller's own profile**, so an
> Operator connects **their own org only**. "Operator connects M365 on behalf of client org X"
> needs an explicit org parameter and a cross-org authorization story — out of scope here, and it
> must not be added by widening this gate silently.

> **⚑⚑ AMENDMENT 2026-07-30 (owner) — the amendment above is CORRECTED. The connection belongs to the
> CLIENT's Microsoft 365, and client users make it. Operator-gating the *use* of a connection was wrong.**
>
> The 2026-07-24 amendment reasoned correctly about credential ownership and then applied it to the
> wrong switch. Owning the app registration governs **whether the app exists and which orgs are
> entitled**. It does not govern **who may authorize that app to act inside their own tenant** — that
> was always the client's act. A client admin *consents to* our vendor-owned app; they never own it,
> so nothing is handed over. ADR-0064 Option C is unaffected.
>
> **The two models are mutually exclusive, so this is forced, not a preference.** `callback.ts:123`
> asserts `id_token.tid === env.m365TenantId`. Point that secret at a client's tenant — which is what
> "connect to the client's Microsoft 365" means — and an Operator can never complete a connect: an
> account in the vendor tenant is rejected by that assertion and nothing is stored. Operator-gated
> connect and client-tenant connection cannot both hold.
>
> ⚑ **The 2026-07-24 live connect therefore proved the discarded model.** It succeeded only because the
> tenant secret pointed at the vendor's own tenant (`gordi.id`). It is not evidence for the model below.
>
> **How the gate came to sit on the data path:** a DRY refactor ("quality #6") put `initiate_connect`,
> `graph_proxy`, `disconnect` and `connection_status` behind one shared `resolveOrgOrResult` →
> `authorizeOperatorEntitled` gate (`auth.ts:89`). An **activation** gate thereby landed on a **data
> access** path, and the authorization question for that path was never asked separately. A shared
> helper is the right shape; sharing a gate between two different authorization questions is not.
> **Rule:** an activation gate and a data-access gate may share code, never a single decision.
>
> **The four layers, with four different owners:**
>
> | Layer | Owner | Act | Enforced by |
> |---|---|---|---|
> | Entitlement | **Operator** (vendor) | this org may use M365 | `org_features` / `operator_toggle_feature` — unchanged |
> | Tenant consent | **client's Microsoft admin** | this app may act in our tenant | Microsoft / Entra |
> | Personal connection | **any client user who browses** | grant their own delegated token | PMO gate + Microsoft |
> | Project ↔ library binding | **client Project Manager** | which library this project uses | `can('edit','project')`, bounded by that user's own SharePoint access |
>
> **Consequences of the split:**
> - **`graph_proxy` de-gates from Operator to "member of an entitled org".** `initiate_connect` follows.
>   `graph_proxy` already loads `.eq('user_id', userId)` from the verified caller JWT (`proxy.ts:69`), so
>   every user browses with **their own** Microsoft token — the correct per-user permission model is
>   already plumbed; only the gate blocked it. Entitlement, disentitlement cascade, and the Operator
>   ownership of `org_features` are untouched.
> - **No approval step for the project↔library binding, deliberately.** A PM can only bind a library
>   their own Microsoft account can already read; Microsoft is the authority. An approval gate would be
>   ceremony over authority PMO does not hold. Audit the binding to `audit_events` instead.
> - **Tenant admin consent is now on the onboarding critical path — a direct cost of SharePoint-primary
>   (owner, 2026-07-29).** `Sites.Read.All` and `Files.Read.All` are delegated permissions that require
>   tenant admin consent; a PM cannot grant them. Every client onboarding gains a one-time step needing
>   their IT department. `Files.Read` alone avoids it and reaches no SharePoint at all — so this is the
>   price of the SharePoint decision, not an implementation detail.
> - **Per-org tenant id becomes a seam.** One global `M365_TENANT_ID` is adequate while each client has
>   its own deployment (ADR-0047 siloed) and breaks under pooled. Keep the env var as the default and
>   have the `tid` assertion prefer the org's recorded tenant where one exists — a small seam now
>   instead of a security-critical rewrite later. Consistent with §5 (topology independence).
> - **The proof reconnect changes.** It must run against a client-like tenant as a **non-Operator**
>   user, after admin consent, with the SharePoint scopes. An Operator connect re-proves the discarded
>   model. (Backlog M365 entry, TBD.)
>
> **This is a change to a shipped, security-audited authorization boundary.** It widens who may reach a
> Graph token path, so it requires its own `security-auditor` pass — `AC-M365-131` currently asserts the
> *old* rule (an org Admin who is not an Operator is FORBIDDEN) and must be re-specified rather than
> quietly deleted. Mutation-check the replacement: a disabled entitlement or a non-member must still be
> rejected.

**4. The agent tier extends to M365 unchanged (RLS-as-ceiling).** A Teams-invoked LLM assistant and
Teams actionable-approval cards are new *entry points* to the existing agent + RPC layer, not new
authority. Approvals call the existing server-enforced SoD RPCs (ADR-0019); the Teams bot runs under the
invoking user's identity/permissions — a "show me all orgs" prompt still hits that user's RLS
(ADR-0036/0044 deputy model). No M365 surface is handed `service_role`.

**5. The integration is topology-independent.** Nothing here depends on pooled-vs-siloed (ADR-0047/0001).
It works identically under both; the only topology-sensitive choice is the Entra app registration, which
is isolated to **ADR-0064**. Consequently this integration can proceed without reopening ADR-0047.

**6. Shared Graph token lifecycle, built once — server-side custody (ADR-0060).** Supabase returns a
`provider_token` at sign-in but does not refresh it; durable Graph access requires a deliberate token
layer. **Ratified: Option 2 — a server-side, confidential-client refresh-token store** (rejected the
client-side MSAL option), because the high-value features act on the user's behalf while offline. Full
best-practice controls (server-only custody, proxied Graph calls, envelope encryption, forced-RLS token
table, least-privilege incremental consent, rotation/revocation, audit) are binding in **ADR-0060**.
Built once; underpins docs, Teams, calendar, and tasks.

## Consequences

- **Positive:** features inherit auth, tenancy, entitlement, agent-authority, and token handling from
  fixed invariants — each feature is "an adapter + a surface," not a platform. Security posture
  (RLS-as-ceiling, server-enforced SoD, invite-only authz) is preserved by construction. Decoupled from
  the pooled/siloed decision, so it never blocks on it.
- **Cost / negative:** the token lifecycle and the two-switch settings surface are real Phase-0
  investments before the first user-visible feature. Teams interactive features require a Teams app
  package (custom-upload per client until a store listing exists). Per-client secrets multiply (the
  vault-`AS` pattern extends — see ADR-0064).
- **Risk if skipped:** without these invariants, each M365 feature would re-implement token handling and
  entitlement ad hoc, and the SSO "authentication ≠ authorization" line could erode into an accidental
  signup bypass.

## Ratified (2026-07-14) & open

- **Priority frame (ratified):** M365 is a **delight layer positioned to drive enterprise adoption** —
  the wedge for orgs that already live in Teams and the Microsoft ecosystem. Delight-first in build
  order (§3 sequencing), enterprise-adoption in *positioning*: the integrations are what make a
  Teams-native org choose and stay on PMO. Not a self-serve/PLG motion (that remains deferred with the
  pooled topology, ADR-0047).
- **Topology (ratified):** ADR-0064 → Option C default, B escape hatch.
- **Token lifecycle (ratified):** server-side custody — ADR-0060; encryption = app-layer AES-256-GCM
  (D1), bootstrap = server-side auth-code + PKCE (D2), both owner-confirmed 2026-07-14.
- **Open:** publisher verification sequencing (needed for C); provisioning model (invite-first vs JIT).
