# Plan — Entra Option-B ceremony runbook

## Goal

Add a public-safe, operator-ready runbook for the client-tenant Option-B Entra registration selected by DD-ENTRA-1. It must let a client tenant administrator and the PMO operator complete the one-sitting setup, grant only the scopes the shipped M365 surfaces request, and leave with a demonstrated personal connection.

## Scope and constraints

- **New file only:** `docs/runbooks/entra-option-b-setup.md`.
- This is a documentation-only change: no application, migration, test, configuration, deployment, or ADR change is needed. ADR-0064 already records the topology decision; the runbook applies it to this client.
- The issue supplies no numbered `AC-###` criteria. Traceability below therefore uses the explicit Issue #494 coverage items; no runtime behavior or test owner is introduced.
- Do not add a wizard. No `wizard` skill is present in this worktree, and the existing application already supplies the relevant top-level approval and personal-connect journeys. A concise static runbook is more useful to the people in the ceremony than a new, unbuilt interactive surface.
- Treat this as a public document: never record values, credentials, credential-store coordinates, environment-variable names, internal hosts, tenant/client identifiers, personal data, or any endpoint value that would identify a client deployment. Where an exact deployment-specific value is indispensable (the callback values and post-registration identifiers), write a conspicuous neutral handoff stub: obtain it from the authorized PMO operator through the approved private procedure; do not guess or enter a sample value.

## Design and evidence

### Authoritative inputs

- DD-ENTRA-1 in Issue #452 fixes this client to **Option B**: one app in the client tenant, single-tenant, with client IT accepting registration/credential-rotation coordination to avoid the cross-tenant unverified-publisher risk.
- `docs/adr/0064-entra-app-registration-topology.md` establishes the Option-B ownership, automatic tenant lock, isolated credential, and per-client configuration seam.
- `supabase/functions/m365-token-custody/initiate.ts` is the source of truth for the Graph connect request: delegated `Files.Read`, `Files.Read.All`, and `Sites.Read.All`, plus the protocol scopes `offline_access`, `openid`, and `profile`.
- `pmo-portal/src/auth/AuthProvider.tsx` requests `openid profile email` for Microsoft sign-in. The runbook must distinguish these OAuth/OIDC protocol scopes from portal API-permission entries and say why each exists.
- `docs/environments.md` establishes the Supabase Azure callback shape; `initiate.ts`/`callback.ts` establish the separate token-custody callback. Each live URI is deployment-specific and must be supplied privately, copied verbatim, and confirmed before saving.
- `supabase/functions/m365-token-custody/orgApproval.ts` and `callback.ts` establish the one-time organisation-approval return; `pages/Integrations.tsx` and `M365ConnectionCard.tsx` establish the user-visible success outcome. On success, the existing Integrations surface says the organisation has approved the app and instructs the person to connect their own account; it does not claim that approval created a personal connection.
- `docs/spikes/2026-08-18-m365-use-leg-live-probe.md` establishes the meaningful live proof boundary: a successful personal connection proves the OAuth code exchange and secure registration configuration; SharePoint data access additionally depends on client tenant licensing and a real accessible library. The runbook must not falsely promise a Graph-data success when that prerequisite is absent.

### Runbook structure

The document will use a short read-before-start checklist, numbered ceremony steps, a permission-and-reason table, explicit stop/escalation conditions, a rotation handoff, and a signed-off evidence checklist. It will explicitly separate three actions that are often confused:

1. PMO operator enables the product entitlement before the sitting.
2. Client tenant administrator registers and grants the organisation-level application approval.
3. A permitted client member later grants their own delegated connection.

This preserves the existing architecture: Microsoft remains the approval authority, while PMO does not store an invented “approval complete” flag.

## Implementation plan

### Task 1 — Create the ceremony frame, inputs, and public-safe boundaries

**File:** `docs/runbooks/entra-option-b-setup.md` (new)

1. Add a title identifying this as the Option-B Entra registration and admin-consent ceremony runbook, an audience statement (client tenant administrator plus PMO operator), and links to Issue #494/DD-ENTRA-1, ADR-0064, and the M365 integration architecture.
2. State the locked decision in plain language: the app is registered in the client’s own tenant as a single-tenant application; it is not the vendor-tenant default and is not the demo registration.
3. Add a “before the sitting” checklist that assigns the operator to confirm the M365 entitlement and privately prepare the two exact production callback values, while assigning the client administrator the tenant role and a real SharePoint-capable verification account/library. State that the sitting stops and is rescheduled if those private inputs or a suitable administrator are unavailable.
4. Add a “public-document boundary” note that directs any deployment-specific identifier, callback, credential value, or credential-store coordinate through the approved private handoff. Point the operator to `scripts/op-get.sh` by procedure name only; do not expose its arguments or describe a storage location.
5. Add a roles table that distinguishes the client tenant administrator, PMO operator, and verifying client member, including who may approve, who configures PMO privately, and who completes a personal connect.

**Issue #494 traceability:** setup in the client tenant; safe receipt/configuration procedure; a session runnable without improvising secret handling.

**Verify:**
```bash
test -s docs/runbooks/entra-option-b-setup.md && git diff --check -- docs/runbooks/entra-option-b-setup.md
```

### Task 2 — Document the exact registration intent, callbacks, and least-privilege grant rationale

**File:** `docs/runbooks/entra-option-b-setup.md`

1. Add the client-administrator registration sequence using only portal labels confirmed by the repository evidence. Specify the public-safe app display name **PMO Portal**, a single-tenant supported-account choice, and the Web application redirect category only where the existing environment runbook confirms it. For any portal blade label not established by the ADR/code/runbooks, instruct the reader to confirm the current portal label during the ceremony rather than inventing it.
2. Enumerate the two required live redirect destinations by purpose: the Supabase Azure-provider callback for Microsoft sign-in and the token-custody callback for the Graph authorisation-code return. For each, require the admin to paste the exact value privately provided by the operator, compare it back character-for-character, and stop on a missing or conflicting value. Explain that neither a fabricated sample URL nor a local-development callback is a substitute for the deployed callback in this ceremony.
3. Add an API-permissions table that identifies the three Microsoft Graph **delegated** permissions requested by the shipped token-custody code and gives the code-derived reason for each:
   - `Files.Read`: read the connecting person’s OneDrive files;
   - `Files.Read.All`: read files the connecting person can access, including SharePoint-backed content;
   - `Sites.Read.All`: read SharePoint sites/libraries the connecting person can access.
   State that all three are read-only and that the latter two are required for the SharePoint-primary integration, which is why tenant admin approval is needed.
4. Add a separate protocol-scope note so an administrator is not asked to grant unexplained items: `offline_access` enables the server-side refresh-token lifecycle; `openid` and `profile` provide the identity claims used for the tenant/user binding; `email` is used by the separate Microsoft sign-in flow. Make clear these are runtime OAuth/OIDC requests, not extra Graph data permissions to add ad hoc in the portal.
5. Explicitly state the least-privilege boundary: do not add write, mail, calendar, Teams, Planner, or user-profile permissions; the current code deliberately does not request `User.Read`. If the portal’s display wording differs from the scope identifiers above, record that it must be confirmed on screen before consent rather than guessing a display string.

**Issue #494 traceability:** app name; single-tenant type; redirect URIs; every permission and its reason; no invented portal labels/display strings.

**Verify:**
```bash
rg -n "Files\.Read|Files\.Read\.All|Sites\.Read\.All|offline_access|openid|profile|email" docs/runbooks/entra-option-b-setup.md && git diff --check -- docs/runbooks/entra-option-b-setup.md
```

### Task 3 — Document grant, confidential-client handoff, rotation, and live evidence

**File:** `docs/runbooks/entra-option-b-setup.md`

1. Add the ordered consent procedure: after registration and the private PMO configuration are complete, have the client administrator use the shipped organisation-approval action in PMO, complete Microsoft’s organisation-level approval in a top-level browser window, and return through the configured callback. State the observable success condition from shipped UI: the Integrations page confirms organisation approval and asks the viewer to connect their own Microsoft account; this is approval only, not proof of an individual connection. State that any Microsoft consent-page wording not evidenced in the repository is to be confirmed during the ceremony, not described as fact.
2. Add the post-registration handoff: the client administrator supplies the application/client identifier and tenant/directory identifier to the PMO operator through the agreed private channel; the administrator creates the confidential-client credential and transfers only its value through the same approved channel. The operator installs/updates it through the sanctioned `scripts/op-get.sh` procedure and configures the corresponding deployment privately. Prohibit recording values or storage coordinates in the runbook, tickets, chat transcripts, or screenshots.
3. Add the Option-B rotation contract: client IT owns the calendar reminder and initiates replacement before expiry; PMO owns the private receiving/configuration procedure and confirms cutover; both parties agree an overlap window, a named out-of-band coordination channel, a reconnect/recovery plan, and retirement of the predecessor only after verification. Do not claim a precise expiry period or portal workflow because neither is specified by the code/ADR; flag those as ceremony confirmations.
4. End with a smallest honest end-to-end verification checklist: (a) confirm the organisation-approval return on Integrations, (b) sign in as an active entitled client member who is not the tenant administrator, (c) use the personal Microsoft 365 Connect action, authenticate with that member’s Microsoft account, and confirm the returned Integrations screen reports that member as connected. Record the date, roles (not names), and pass/fail outcome in the client’s private operational record. Add a conditional final check: if a licensed SharePoint account and known accessible library are available, the authorized operator performs the existing private Graph-proxy diagnostic against it and records only the outcome; if unavailable, mark Graph-data verification as blocked by licensing/access rather than declaring it passed.
5. Add explicit stop/escalation cases: missing private callback handoff, mismatch between returned tenant identity and expected client tenant, consent denial, missing tenant approval, no SharePoint-capable verification account/library, or any secret/identifier about to be placed in the public repository. The response is to stop, preserve no sensitive artifact in the repo, and coordinate privately; Option C is a director/owner escalation, not an in-ceremony workaround.

**Issue #494 traceability:** admin-consent procedure and screen result; identifier/credential handling; rotation ownership; end-to-end evidence; explicit treatment of unknowns.

**Verify:**
```bash
rg -n "rotation|Connect|approved|private|blocked|stop" docs/runbooks/entra-option-b-setup.md && git diff --check -- docs/runbooks/entra-option-b-setup.md
```

### Task 4 — Perform documentation QA and repository-safety review

**Files:** `docs/runbooks/entra-option-b-setup.md` (review only)

1. Read the final document as a first-time client administrator and verify that prerequisites, role handoffs, sequence, permission reasons, proof, and escalation are all explicit and in chronological order.
2. Compare its permission and success claims to `supabase/functions/m365-token-custody/initiate.ts`, `orgApproval.ts`, `callback.ts`, and `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`; correct any claim that is not supported by those sources.
3. Conduct a public-repository hygiene pass: remove all concrete identifiers, redirect values, credentials, credential-store coordinates, environment-variable names, internal hosts, personnel details, and copied portal wording that was not verified. Ensure every necessary but unpublishable value remains an explicit neutral private-handoff stub rather than a believable fake value.
4. Confirm no ADR is created: this documents an already-accepted topology and does not make a new architectural decision.

**Issue #494 traceability:** public-repo rule; “do not invent”; newcomer can complete the session and finish with truthful evidence.

**Verify:**
```bash
git diff --check && git diff -- docs/runbooks/entra-option-b-setup.md
```

## Traceability

| Issue #494 coverage item | Owning task |
| --- | --- |
| Client-tenant registration, app name, single-tenant type, redirect procedures | Task 2 |
| Every permission plus understandable reason, sourced from shipped code | Task 2 |
| Organisation admin-consent flow and visible success result | Task 3 |
| Private receipt/configuration procedure for identifiers and credential | Tasks 1 and 3 |
| Client-owned secret rotation and coordinated handoff | Task 3 |
| Smallest end-to-end proof, including truthful licensing/access limit | Task 3 |
| No invented facts or public sensitive material | Task 4 |

## Final verification

```bash
git diff --check && test -s docs/runbooks/entra-option-b-setup.md
```
