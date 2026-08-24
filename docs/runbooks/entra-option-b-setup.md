# Entra Option-B registration and consent ceremony

**Audience:** the client tenant administrator and the PMO operator completing one onboarding
session. **Decision:** Option B from [DD-ENTRA-1](https://github.com/ariefsaid/PMO/issues/452)
and [ADR-0064](../adr/0064-entra-app-registration-topology.md): one application is registered in
the client's own tenant, as a **single-tenant** application. It is not the vendor-tenant default
(Option C) and is not the demo registration.

This is a public runbook. Do not put identifiers, callback values, credentials, personal data,
or screenshots containing them in this repository, an issue, or a ticket. The exact deployment
values are supplied and handled through the approved private handoff only. If a required value is
not available privately, stop; do not invent a replacement.

## Before the sitting

The PMO operator confirms privately that:

- the client's M365 entitlement is enabled;
- the two deployed callback values are ready to copy verbatim (one for Microsoft sign-in and one
  for the M365 token-custody return); and
- the private configuration and credential-receipt procedure is available.

The client administrator brings permission to register an application, grant tenant-wide delegated
consent, and create its confidential-client credential. A client member who can access a real
SharePoint document library should also be available for the final optional data-access check.

The roles remain separate:

| Role | Responsibility in this sitting |
| --- | --- |
| Client tenant administrator | Registers the app, adds the callbacks, grants organisation-wide consent, and creates/rotates the credential in the client tenant. |
| PMO operator | Supplies the exact callback values privately, receives identifiers and credential material privately, and completes PMO's private configuration procedure. |
| Client member | Later authorises their own delegated connection and supplies the final end-to-end proof. They need not be the tenant administrator. |

## 1. Register the application in the client tenant

1. In the client's Microsoft administration portal, open the app-registration area. If the current
   portal uses a different blade name, confirm the label with the administrator rather than
   guessing; the registration intent below is the authoritative part.
2. Register an application named **PMO Portal**.
3. Choose **Accounts in this organizational directory only (single tenant)**, or the portal's
   equivalent single-tenant choice. Do not choose multiple organisations, personal accounts, or
   a common-tenant option.
4. Add a **Web** redirect platform. Add both exact values privately supplied by the PMO operator:
   - the deployed Supabase Azure-provider callback, used by Microsoft sign-in; and
   - the deployed M365 token-custody callback, used when Microsoft returns the Graph
     authorisation-code flow.

   The actual URI strings are deployment-specific and must not be published here. Compare each
   value character-for-character before saving. Do not substitute a local-development callback,
   a guessed URL, or a value from another client. If either value is missing or conflicts with the
   registered deployment, stop and reschedule.
5. Save the registration. The administrator and operator should privately record that the app was
   created, without copying its identifiers into this public runbook.

### API permissions: what is requested and why

The list below is derived from the shipped M365 token-custody request in
[`supabase/functions/m365-token-custody/initiate.ts`](../../supabase/functions/m365-token-custody/initiate.ts)
and its OneDrive/SharePoint proxy. Add these as **Microsoft Graph delegated** permissions. They are
read-only:

| Permission identifier | Reason the application requests it |
| --- | --- |
| `Files.Read` | Lets the connecting member read files in that member's OneDrive. |
| `Files.Read.All` | Lets the connecting member read files they are allowed to access beyond their own drive, including SharePoint-backed content. |
| `Sites.Read.All` | Lets the connecting member read SharePoint sites and document libraries that Microsoft already permits that member to access. |

`Files.Read.All` and `Sites.Read.All` are needed because the current integration is SharePoint-
primary; `Files.Read` alone does not reach shared SharePoint libraries. All three are read scopes.
Do **not** add write, mail, calendar, Teams, Planner, or unrelated user-directory permissions.
The current M365 connect code deliberately does not request `User.Read`.

The following are OAuth/OIDC protocol scopes requested at runtime, not additional Graph data
permissions to add ad hoc to the API-permission list:

- `offline_access` supports the server-side refresh-token lifecycle, so a connection can continue
  after the initial access token expires;
- `openid` and `profile` provide identity claims used to bind the returned identity to the expected
  tenant and user flow; and
- `email` belongs to the separate Microsoft sign-in flow, where it is used for portal identity.

These sources are the reason for the distinction: the M365 connect scopes are declared in
`initiate.ts`; the sign-in request is in the portal's Microsoft auth provider. If the portal shows
different display wording for an identifier, confirm the wording and selected permission on screen
before proceeding; do not infer a permission from a similar-looking label.

## 2. Create the credential and complete private configuration

After the registration and permissions are visible, the client administrator creates the
confidential-client credential in the client's tenant. The exact portal label, expiry choices, and
maximum lifetime are not specified by the repository and must be confirmed during the ceremony.

The administrator sends the PMO operator, through the agreed private channel:

- the application (client) identifier;
- the directory (tenant) identifier; and
- the credential value, transferred as secret material rather than pasted into a ticket or chat
  transcript.

The PMO operator uses the approved `scripts/op-get.sh` procedure to retrieve or update the private
credential record and configures the corresponding deployment through the private operational
process. No identifier, credential value, storage coordinate, or private handoff transcript is
recorded in this repository. The operator confirms privately that the application and directory
identifiers match the registration just created.

## 3. Grant organisation-wide admin consent

1. With the registration, callbacks, permissions, and private configuration ready, the PMO
   operator opens the M365 integration's organisation-approval action in PMO.
2. The client tenant administrator follows the Microsoft approval flow in a top-level browser
   window and reviews the application name and the requested delegated read permissions before
   accepting. The administrator must refuse or stop if the app, tenant, redirect context, or
   permission list is not the expected one.
3. Complete the organisation-wide admin-consent action and allow Microsoft to return to the
   configured M365 callback.
4. On return, open the Integrations surface and confirm the success state: it says that the
   organisation has approved the app and instructs the viewer to connect their own Microsoft
   account. This proves organisation approval only; it does **not** prove that a personal token
   connection exists.

Microsoft's exact confirmation wording and current portal blade labels are not treated as fixed
by this repository. Confirm them on screen. If the result says approval is still required, consent
was denied, or the return URI is rejected, stop and resolve that privately before continuing.

## 4. Personal connection and smallest end-to-end proof

1. Use an active, entitled client member who is not the tenant administrator for this proof.
2. From the Integrations surface, choose the personal Microsoft 365 **Connect** action.
3. Authenticate as that member in the client tenant and accept the already-approved delegated
   request.
4. Confirm that Microsoft returns to PMO and that Integrations reports that **this member** is
   connected. This proves the registered client id, tenant binding, callbacks, code exchange, and
   secure connection registration work together.
5. Record the date, role of the verifier, and pass/fail result in the client's private operational
   record. Record no names, identifiers, tokens, or screenshots in this public repository.

If a licensed SharePoint-capable account and a known accessible library are available, the
authorised PMO operator may also run the existing private Graph-proxy diagnostic against that
library and record only its outcome privately. If either prerequisite is unavailable, mark
Graph-data verification **blocked by licensing or access**; do not call it passed merely because
personal connection succeeded.

## Secret rotation: an Option-B operating contract

The credential lives in the client's tenant, so **client IT initiates rotation** and owns the expiry
calendar. The PMO operator owns the private receiving and deployment-configuration procedure.
Before expiry, both parties agree privately on:

1. a replacement date and an overlap window;
2. an out-of-band coordination channel;
3. when the PMO operator will receive and configure the replacement through the approved
   `scripts/op-get.sh` procedure;
4. a reconnect/recovery plan if the old credential expires during cutover; and
5. retirement of the predecessor only after the end-to-end connection check passes.

The exact credential lifetime and the current portal rotation steps are not specified in the ADR or
code, so they must be confirmed by client IT at registration and written into the client's private
operations calendar. A rotation that is not coordinated with PMO can interrupt sign-in or Graph
connections; this coordination is the accepted operational cost of Option B.

## Stop conditions and evidence sign-off

Stop and coordinate privately if any of the following occurs:

- a callback value, application identifier, tenant identifier, or credential is missing or differs
  from the expected private handoff;
- Microsoft reports the wrong tenant, a consent denial, or that administrator approval is still
  required;
- the requested permissions include anything outside the three read permissions listed above;
- the personal connection does not return to PMO as connected; or
- a secret, identifier, personal detail, or sensitive screenshot is about to enter this repository.

Do not work around a failed ceremony by switching topology during the sitting. Option C is a
separate owner/director decision, not an improvised fallback. The ceremony is complete only when
organisation approval is visible **and** the personal connection check has a recorded private
pass/fail result; SharePoint data verification is separately marked passed or blocked.
