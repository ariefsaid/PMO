# Microsoft 365 integration — product vision & feature map

- **Owner-requested** (2026-07-14 grill, this session). Durable home of the M365 integration vision.
- **Status:** living document. Auth layer (SSO) shipped; everything below the auth line is proposed.
- **Controlling ADRs:** [ADR-0058](adr/0058-microsoft-365-integration-architecture.md) (integration
  architecture), [ADR-0059](adr/0059-entra-app-registration-topology.md) (Entra app topology).
  **Related:** ADR-0055 (external adapters — the pattern Graph *data* features follow), ADR-0049
  (Operator/entitlements — the two-switch model), ADR-0047 (per-client siloed topology), ADR-0001
  (org_id seam), ADR-0044 (agent automations/notifications), ADR-0056 (ClickUp task adapter).

## 1. Why this exists (vision evolution)

The trigger was narrow: *"a client already on Teams/OneDrive — can they log in with Microsoft and see
their docs linked to project docs?"* Pulling that thread showed the real opportunity is **not one
feature but a layer.** Our target customer — contract/project-based orgs — very often already lives in
Microsoft 365 (Teams, OneDrive/SharePoint, Outlook, Entra ID). Every PMO capability we already ship
(timesheet approvals, procurement lifecycle, delivery milestones, CRM activity, incidents, the agent
tier) has a natural M365 surface. So M365 becomes a **distribution and delight layer over the app we
already built**, not a new product.

**Positioning (owner, 2026-07-14):** M365 is a **delight layer positioned to drive enterprise
adoption** — the wedge for orgs that already live in Teams and the Microsoft ecosystem. Delight-first in
*build order*; enterprise-adoption in *positioning*. It is not a self-serve/PLG acquisition motion (that
stays deferred with pooled topology, ADR-0047) — it is what makes a Teams-native org choose PMO and stay.

**The load-bearing architectural insight:** M365 integration sits **above** the deployment-topology
question (siloed one-project-per-client vs pooled many-orgs-per-DB, ADR-0047/ADR-0001). It works the
same under both. So we can build it now without reopening that decision — the org_id seam and the
per-client adapter pattern already give it a home. This doc therefore never depends on a pooled-vs-siloed
resolution; where topology matters, it's isolated to ADR-0059 (app registration) only.

## 2. The two structural primitives everything reuses

**(a) Auth vs data (the SSO hybrid — already shipped).** One Microsoft sign-in *authenticates*; PMO
*authorizes* via the existing invited-`profiles` + RLS model. OAuth never bypasses provisioning
(`enable_signup=false`). Details: `docs/environments.md` → "Microsoft (Entra ID) OAuth provider".

**(b) Two switches, two owners (ADR-0049 entitlement/config split).** Every integration has *two* gates
belonging to different personas — build the pair once, reuse for M365, ClickUp, ERPNext alike:

| Switch | Owner | Mechanism | Example (M365) |
|---|---|---|---|
| **Entitlement** — *is this org allowed to use it* (plan/billing) | **Operator** (you) | `org_features` / `operator_toggle_feature` | Turn on "M365 integration" entitlement for the org |
| **Configuration/activation** — *wire up our tenant* | **Org Admin** (client) | org settings UI + admin-consent flow | Grant Microsoft admin consent; pick which pieces (docs, Teams) are on |

## 3. Feature map

Legend — **Consent:** U=per-user delegated consent · A=org-admin consent · V=vendor-side only.
**Adapter fit:** whether it follows the ADR-0055 Graph-data adapter shape. **Effort:** rough, relative.

### 3.1 Auth & identity
| Feature | What | Value | Consent | Effort |
|---|---|---|---|---|
| **Sign in with Microsoft** ✅ *shipped* | `azure` OAuth provider + login button | Removes password friction for M365 orgs | A (or U) | done |
| Entra group → PMO role provisioning | Map security groups → roles; auto-provision on first SSO | Zero-touch onboarding | A | M |
| Auto-deactivate on offboard | IT disables in Entra → PMO access revoked | Security/compliance selling point | A | M |
| Presence dots | Show Teams presence next to assignees/approvers | Small delight | U | S |

### 3.2 Documents (OneDrive / SharePoint)
| Feature | What | Value | Consent | Effort |
|---|---|---|---|---|
| **OneDrive doc linking** (link/reference model) | Attach Graph driveItem refs to `project_documents`; Microsoft stays the permission authority | No file duplication; inherits M365 access control | U | M |
| In-app browse/preview via Graph | List/preview SharePoint/OneDrive files inside the project | Seamless, but owns token lifecycle | U | L |
| ~~Import/copy into Supabase Storage~~ | (Rejected for M365 clients — duplicates their source of truth) | — | — | — |

### 3.3 Teams
| Feature | What | Value | Consent | Effort |
|---|---|---|---|---|
| Outbound notifications (Adaptive Cards) | Milestone slip / approval pending / incident → project channel | Cheapest entry; hooks `agent_automations_notifications` (ADR-0044) | A (or webhook) | S–M |
| **Actionable approvals in Teams** | Approve/Reject card → calls existing SoD RPCs | Kills approval latency (top PMO complaint); server SoD intact | A + Teams app | L |
| **LLM assistant invoked from Teams** | The PMO agent (ADR-0036/0040) reachable as a Teams bot: "@PMO status of Acme contract?" | Extends the agent tier to where users already are; RLS-as-ceiling holds | A + Teams app | L |
| Teams tab (embedded dashboard) | Project dashboard as a channel tab; SSO carries over | Portal becomes ambient in Teams | A + Teams app | M |
| Message extension / link unfurling | Paste a PMO link → status card | Lightweight virality | A + Teams app | M |
| Channel provisioning | New PMO project → auto-create Teams channel + folders | Pairs with doc linking | A | M |

### 3.4 Tasks (Planner / To Do)
| Feature | What | Value | Consent | Adapter fit |
|---|---|---|---|---|
| Publish PMO tasks → Planner | One-way push to the project's Planner | Tractable; visible | A/U | **Yes — a Planner tier alongside ClickUp (ADR-0055/0056)** |
| Two-way Planner sync | Full bidirectional | High want, **tar pit** (conflict resolution) | A/U | Yes, but a quarter not a sprint |
| MS Project import | Schedule import for migrating clients | One-time onboarding tool | — | partial |

### 3.5 Outlook / Calendar
| Feature | What | Value | Consent | Effort |
|---|---|---|---|---|
| Milestone → calendar (one-way) | Push `delivery_milestones`/task due dates to Outlook | High visibility, low complexity | U/A | M |
| Email-to-project capture | Project inbox / Outlook add-in → logs to `crm_contacts_activity` | How client-facing teams actually work | U | L |
| Send-as-org notifications | Auth/notification email from the client's own domain via Graph | Trust/deliverability | A | M |

### 3.6 Reporting & platform (later, stickier)
| Feature | What | Value | Consent |
|---|---|---|---|
| Power BI on PMO data (RLS-respecting) | Client analysts build their own dashboards | Clients with M365 usually have Power BI people | A |
| Power Automate connector / outbound webhooks | Publish PMO events; client wires their own automations | One seam absorbs endless "can it also notify X" | A |
| Graph connector → Microsoft Search / Copilot | Index PMO data, permission-trimmed, into Copilot | "Works with your Copilot" is becoming a procurement checkbox | A/V |

## 4. Sequencing recommendation

The common foundation is the **Graph token lifecycle** — ratified as a **server-side, confidential-client
refresh-token store** with best-practice security (envelope encryption, forced-RLS token table, proxied
Graph calls, least-privilege consent, rotation/revocation/audit), specified in **ADR-0060**. Build it
**once**; it underpins docs, Teams, calendar, tasks. Design the docs work so this layer is built here,
not per-feature.

1. **Phase 0 — foundation:** Graph token lifecycle + the two-switch entitlement/config surface +
   provisioning hardening (graceful "not provisioned yet" instead of the raw profile error; decide
   JIT-vs-invite). Small, unblocks everything.
2. **Phase 1 — OneDrive doc linking (link/reference model).** Highest value, lowest risk, follows
   ADR-0055. First real M365 feature in a client's hands.
3. **Phase 2 — Teams outbound notifications** (Adaptive Cards over the existing automations tier).
4. **Phase 3 — Teams actionable approvals + Teams LLM assistant.** The monetizing pair; needs the
   Teams app package (custom-upload per client until store listing).
5. **Phase 4 — Planner task tier (one-way), Outlook calendar (one-way).**
6. **Later:** Entra group provisioning, Power Automate webhooks, Graph connector / Copilot.

## 5. Decisions

**Decided (owner, 2026-07-14):**
1. **Entra app topology → Option C** (per-client app in the vendor tenant) as the standing default, with
   **B** (client-tenant app, no publisher verification) as the escape hatch. ADR-0059.
2. **Priority frame → delight-first, positioned to drive enterprise adoption** for orgs already in the
   Teams/Microsoft ecosystem — not a self-serve/PLG motion. ADR-0058.
3. **Graph token lifecycle → server-side custody** (confidential-client refresh-token store, best-practice
   security). ADR-0060.
4. **Encryption (D1) → app-layer AES-256-GCM** in the edge function, KEK in secrets. ADR-0060 §3.
5. **Bootstrap (D2) → server-side auth-code + PKCE** Graph exchange, separate from SSO. ADR-0060 §1.

**Still open:**
6. **Publisher verification** — needed for Option C (and a future Teams store listing). Business task,
   weeks of lead time; can onboard early clients via admin-consent meanwhile. See session history +
   `docs/environments.md`.
7. **Provisioning model** — keep invite-first, or add JIT provisioning (domain→org or Entra-group
   mapping on first SSO)? Ties to the Entra-group provisioning feature (§3.1).
