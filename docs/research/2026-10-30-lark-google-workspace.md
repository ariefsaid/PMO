# Lark and Google Workspace Integration Options for PMO

- **Date:** 2026-10-30
- **Ticket:** Wayfinder Research Ticket [#1492](https://github.com/ariefsaid/PMO/issues/1492) (Parent: [#1481](https://github.com/ariefsaid/PMO/issues/1481))
- **Subject:** Lark (notifications, approval cards, bot, SSO) and Google Workspace (Drive document linking, Google sign-in, Calendar) via stock APIs.
- **Context:** The EPC prospect operates on Google Workspace and Lark alongside their planned Odoo Enterprise deployment. PMO must evaluate stock API feasibility, auth model, admin consent requirements, rate limits, and implementation effort relative to the shipped Microsoft 365 (M365) integration.
- **Privacy Notice:** The repository is public. This document refers only to "the EPC prospect" without disclosing prospect identity, personal names, or credentials.

---

## 1. Executive Summary & Answer First

PMO can integrate with both Lark and Google Workspace entirely via their stock, officially supported APIs without custom modules or non-standard protocols. 

The table below summarizes each capability across authentication, admin consent, API quotas, and implementation effort relative to PMO's shipped M365 integration ([`docs/microsoft-365-integration.md`](../microsoft-365-integration.md) and [ADR-0060](../adr/0060-microsoft-graph-token-custody.md)):

| Integration & Capability | Stock API / Mechanism | Auth & Token Model | Admin Consent & Approval | API Rate Limits & Quotas | Effort Relative to M365 |
|---|---|---|---|---|---|
| **Google Sign-In (SSO)** | Google Identity Services / OpenID Connect | User OAuth 2.0 via Supabase Auth `google` provider | None for users in Workspace domain (or one-time admin app approval) | N/A (Standard GoTrue session lifecycle) | **S (Trivial)** — Parity with shipped M365 SSO. Configuration only in Supabase; zero new backend code. |
| **Google Drive Document Linking** | Google Picker API + Drive REST API v3 (`files.get`) | `https://www.googleapis.com/auth/drive.file` scope (Non-Sensitive) | Internal GCP project: zero verification. Multi-tenant: standard app verification (NO restricted CASA audit required under `drive.file`) | 1,000,000 quota units / min / project; 325,000 units / min / user; 1 TB egress / day | **M (Moderate)** — Parity with M365 OneDrive spec (`docs/specs/m365-onedrive-doc-linking.spec.md`). Reuses link/reference model and ADR-0060 envelope encryption. |
| **Google Calendar Sync** | Google Calendar REST API v3 (`events.insert`, `events.patch`) | OAuth 2.0 with offline access (`access_type=offline`) using `calendar.events` scope | Sensitive Scope verification (demo video + privacy policy review) required if external; zero if internal GCP app | 1,000,000 queries / day / project; 500 requests / 100 sec / user (~5 QPS) | **M (Moderate)** — Comparable to M365 Phase 4 Outlook calendar push. One-way push of milestone deadlines and task due dates. |
| **Lark Sign-In (SSO)** | Lark OIDC (`authen/v1/authorize`, `oidc/access_token`, `user_info`) | Authorization code flow returning `user_access_token` (2h) + `refresh_token` (30d) | Workspace Admin approval during Custom App version release | 50 requests / sec (OpenAPI level) | **M (Moderate)** — Higher effort than M365 SSO because Supabase Auth lacks native Lark OAuth. Requires custom Edge Function auth bridge or Enterprise SAML 2.0. |
| **Lark Outbound Notifications** | Custom Bot Webhook or OpenAPI `im/v1/messages` | Webhook URL (no token) OR `tenant_access_token` (2h validity) | Webhook: Chat group admin adds bot. OpenAPI: Workspace Admin approves Custom App scopes | OpenAPI: 50 req/sec, 1,000 req/min; Anti-disturbance: 5 QPS per user / chat | **S (Low)** — Lower effort than Teams Adaptive Cards. Simpler payload schemas and instant webhook delivery. |
| **Lark Interactive Approval Cards** | Interactive Message Cards (Card Schema 2.0) + `card.action.trigger` callback | App-level `tenant_access_token` + HMAC signature verification (`X-Lark-Signature`) | Workspace Admin approves bot and message card scopes on Custom App release | Callback must return response within 3 seconds; 5 QPS anti-disturbance limit | **M (Moderate)** — Equivalent to M365 Phase 3 Teams Actionable Approvals. Server-side SoD RPCs hook cleanly into webhook action payloads. |
| **Lark Conversational Bot / Assistant** | Event subscription `im.message.receive_v1` + `im/v1/messages/{id}/reply` | `tenant_access_token` + server-side event signature check | Workspace Admin approves bot capability and message event scopes | 50 req/sec OpenAPI limit; event callbacks must return HTTP 200 within 3 seconds | **M (Moderate)** — Lower plumbing effort than Teams Bot Framework (no Azure Bot Service registration required; standard HTTP webhooks directly to Supabase Edge Function). |

---

## 2. Lark Integration Details

Lark (the international enterprise collaboration platform developed by ByteDance, known as Feishu in mainland China) provides an open developer platform ([open.larksuite.com](https://open.larksuite.com/)) with native APIs for bots, interactive message cards, and identity management.

### 2.1 Application Architecture & Hosting Model

For enterprise deployments such as the EPC prospect, Lark supports two app models:
1. **Custom App (Enterprise Internal App):** Built specifically for a single organization. Registered in the prospect's Lark Developer Console. Scopes and event subscriptions are managed directly by the prospect's administrators. This is the **recommended approach** for the EPC prospect pilot.
2. **Store App (Marketplace / ISV):** Multi-tenant SaaS app listed in the Lark App Directory. Requires third-party vendor verification, multi-tenant token negotiation (`app_access_token` + `tenant_key` to acquire `tenant_access_token`), and directory review.

*Primary documentation:*
- Custom Apps vs Store Apps: [Lark Open Platform — App Types](https://open.larksuite.com/document/home/introduction-to-lark-open-platform/app-types)

### 2.2 Authentication & Token Model

Lark utilizes a hierarchical token architecture:
- **`tenant_access_token`:** Authorizes API calls made by the application on behalf of the company/tenant (e.g. sending messages as a bot, reading organization directory, updating approval cards).
  - *Internal Custom App Endpoint:* `POST https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal`
  - *Request parameters:* `app_id` and `app_secret`.
  - *Validity:* 2 hours (7,200 seconds). A refreshed token can be obtained when the remaining validity is under 30 minutes; during this overlap window both old and new tokens remain valid.
  - *Storage:* PMO stores this server-side in memory or cached in a dedicated edge function Redis/KV store, never in the frontend.
  - *Primary Source:* [Lark Docs — Obtain tenant_access_token (internal)](https://open.larksuite.com/document/server-docs/authentication-management/access-token/tenant_access_token_internal)
- **`user_access_token` & `refresh_token`:** Authorizes calls on behalf of an individual user (SSO, personal resource access).
  - *Authorize:* `GET https://open.larksuite.com/open-apis/authen/v1/authorize`
  - *Token exchange:* `POST https://open.larksuite.com/open-apis/authen/v1/oidc/access_token`
  - *Refresh:* `POST https://open.larksuite.com/open-apis/authen/v1/oidc/refresh_access_token`
  - *Validity:* `user_access_token` is valid for ~2 hours; `refresh_token` is valid for 30 days.
  - *User Profile:* `GET https://open.larksuite.com/open-apis/authen/v1/user_info` returns `open_id`, `union_id`, `name`, `avatar_url`, and (if permitted) `email` and `mobile`.
  - *Primary Source:* [Lark Docs — OIDC Access Token](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/oidc-access_token/create), [Lark Docs — User Info](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)

### 2.3 Admin Consent & Approval Flow

Unlike Microsoft Entra ID (which allows individual users to consent to basic delegated scopes unless blocked by tenant policy), Lark enforces administrative review for all Custom Apps:
1. The developer configures permissions (e.g. `im:message`, `im:message.p2p_msg:readonly`, `contact:user.base:readonly`) in the Lark Developer Console.
2. The developer submits a **Version Release** (`Version Management & Release > Create a version`).
3. An approval task is automatically routed to the organization's **Lark Workplace Administrator** or Primary Administrator via Lark's built-in Approval center.
4. Once the administrator approves the release version, all requested scopes and event subscriptions become active immediately for users within the configured availability scope.
- *Primary Source:* [Lark Docs — Guide for approval of custom app releases](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/app-approval/guide-for-approval-of-custom-app-releases), [Lark Docs — Review Custom Apps](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/application-management/manage-apps/review-custom-apps)

### 2.4 Notifications & Outbound Messaging

Lark provides two primary methods for outbound notifications:
1. **Group Custom Webhook Bots:**
   - Any group chat administrator can add a "Custom Robot" to generate a webhook URL: `https://open.larksuite.com/open-apis/bot/v2/hook/{webhook_token}`.
   - PMO can POST raw JSON message cards or text directly to this webhook without token negotiation.
   - Ideal for low-friction milestone slip alerts, daily procurement digest, and site delivery broadcast channels.
2. **OpenAPI Message Dispatch (`im/v1/messages`):**
   - Endpoint: `POST https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type={open_id|email|user_id|chat_id}`
   - Header: `Authorization: Bearer <tenant_access_token>`
   - Body: Specifying `msg_type: "interactive"` with a Card JSON body, or `msg_type: "text"`.
   - Allows targeted 1-on-1 notifications to specific project managers, quantity surveyors, or approvers.
   - *Primary Source:* [Lark Docs — Send Message API](https://open.larksuite.com/document/server-docs/im-v1/message/create)

### 2.5 Actionable Approval Cards (Card Schema 2.0 & `card.action.trigger`)

Lark's Interactive Message Cards allow rich, in-chat action execution without leaving the mobile or desktop app:
- **Card Structure:** Defined using Lark Card JSON schema 2.0. Can contain header styles (color bands), markdown fields (BoQ item, vendor, amount, project code), and action containers holding buttons (e.g. "Approve", "Reject", "View in PMO").
- **Action Triggers:** Action buttons contain an attached JSON `value` (e.g. `{"action": "approve", "doc_type": "PO", "doc_id": "po_88291", "step": 1}`).
- **Callback Mechanism:**
  - When the user taps a button, Lark sends an HTTP POST event to PMO's configured request URL (`/functions/v1/lark-card-action`).
  - Event type: `card.action.trigger` (Schema 2.0).
  - The payload carries the operator's identity (`open_id`, `user_id`), the component tag (`button`), and the custom action value.
- **Strict SLA:** Lark requires the receiving server to respond with HTTP 200 within **3 seconds**. PMO's edge function must validate signatures, verify caller permissions via existing Separation of Duties (SoD) RPCs, and respond with an immediate toast or card update:
  - Immediate update: Return replacement card JSON reflecting new status (e.g., "Approved by [User] at 14:32").
  - Toast response: `{"toast": {"type": "success", "content": "PO approved successfully."}}`.
- **Security & Verification:** Lark signs outbound event webhooks using a configured Verification Token or Encrypt Key. The edge function verifies `X-Lark-Signature` using SHA-256 HMAC over timestamp, nonce, and raw request body.
- *Primary Source:* [Lark Docs — Card Callback Interaction](https://open.larksuite.com/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication/card-callback-interaction), [Lark Docs — Handle Card Callbacks](https://open.larksuite.com/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication/handle-card-callbacks)

### 2.6 Lark Conversational Bot / LLM Assistant

PMO can expose its conversational agent tier (ADR-0036 / ADR-0040) directly inside Lark:
- **Event Subscription:** Configure app to subscribe to `im.message.receive_v1` events.
- **Routing:** When a user sends a 1-on-1 direct message to the bot or mentions `@PMO` in a project group chat, Lark delivers the message event via webhook to PMO's edge function (`/functions/v1/lark-bot`).
- **Response:** PMO verifies the user's role against PMO `profiles`, evaluates the query through the PMO assistant agent within the user's Row-Level Security (RLS) boundary, and replies via:
  `POST https://open.larksuite.com/open-apis/im/v1/messages/{message_id}/reply`
- *Primary Source:* [Lark Docs — Receive Message Event](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive), [Lark Docs — Reply Message](https://open.larksuite.com/document/server-docs/im-v1/message/reply)

### 2.7 Rate Limits & Error Handling

- **OpenAPI Level:** 50 requests/second and 1,000 requests/minute per app across `open.larksuite.com/open-apis/im/v1/messages`.
- **Anti-Disturbance / Receiver Throttling:** Maximum 5 requests/second targeting the same user or same group chat.
- **Limit Exceeded Codes:** Returns HTTP `429 Too Many Requests` (or legacy `400`) with error code `99991400` (`"request trigger frequency limit"`). Response headers `x-ogw-ratelimit-limit` and `x-ogw-ratelimit-reset` specify the recovery window.
- *Primary Source:* [Lark Docs — Rate limits for IM APIs](https://open.larksuite.com/document/server-docs/im-v1/message/create)

---

## 3. Google Workspace Integration Details

Google Workspace provides standardized REST APIs across Google Drive and Google Calendar, alongside OAuth 2.0 / OpenID Connect authentication.

### 3.1 Google Sign-In (SSO)

- **Mechanism:** Supabase Auth natively supports Google as a social/OIDC provider (`provider: 'google'`).
- **Architecture Alignment:** Exactly matches PMO's shipped Entra ID (`azure`) configuration documented in `docs/environments.md`.
- **Security Boundary:** As established in PMO's auth architecture, OAuth *authenticates*, while PMO *authorizes*. Supabase Auth `enable_signup=false` ensures that an uninvited Google user cannot self-provision; the `profiles` table and RLS remain the sole authorization authority.
- **Effort:** **S (Trivial)** — 1 to 2 developer days. Requires only setting up OAuth 2.0 Web Client credentials in Google Cloud Console and setting `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` / `GOTRUE_EXTERNAL_GOOGLE_SECRET`.
- *Primary Source:* [Supabase Docs — Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Google Identity — OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

### 3.2 Google Drive Document Linking (Link/Reference Model)

In PMO's architecture, document integration deliberately avoids duplicating large CAD drawings, site inspection photos, or contractual PDFs inside Supabase Storage (see [`docs/specs/m365-onedrive-doc-linking.spec.md`](../specs/m365-onedrive-doc-linking.spec.md)). Instead, PMO adopts a **link/reference model**:
- Google Drive remains the sole storage and permission authority.
- PMO stores an external reference in `project_documents`:
  - `provider`: `'google_drive'`
  - `external_item_id`: Google Drive File ID (e.g. `1BxiMVs0XRA5nFMdKvBHK9...`)
  - `external_web_url`: File `webViewLink` (direct link opening in Google Docs/Drive web interface)
  - `name`, `mime_type`, `size_bytes`, `external_last_modified_at`.

#### The Non-Sensitive Scope Advantage: Google Picker + `drive.file`
A critical compliance and development finding:
- **Broad scopes (`drive`, `drive.readonly`):** Google classifies these as **Restricted Scopes**. Applications requesting restricted scopes must undergo mandatory third-party CASA (Cloud Application Security Assessment) audits (Tier 2/3), costing substantial fees and taking weeks to certify.
- **Targeted scope (`https://www.googleapis.com/auth/drive.file`):** Google explicitly classifies `drive.file` as **Non-Sensitive**.
  - When the web frontend invokes the client-side **Google Picker API** (`google.picker.PickerBuilder`), the user selects specific drawings or spreadsheets from their Google Drive inside Google's trusted modal dialog.
  - Upon user selection, Google automatically authorizes the app's OAuth token for that specific file ID under `drive.file`.
  - PMO never needs broad read access to the client's whole Drive, completely bypassing restricted scope verification and annual third-party audits.
- *Metadata & Sync API:* `GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=id,name,mimeType,webViewLink,iconLink,size,modifiedTime`
- *Quotas:* 1,000,000 quota units per minute per project; 325,000 quota units per minute per user per project; 1 TB egress per day.
- *Primary Sources:*
  - [Google Drive API — Quotas and Limits](https://developers.google.com/drive/api/guides/limits)
  - [Google Drive API — Files.get Reference](https://developers.google.com/drive/api/v3/reference/files/get)
  - [Google Picker API Overview](https://developers.google.com/drive/picker/guides/overview)
  - [Google Identity — OAuth Scopes Classification](https://developers.google.com/identity/protocols/oauth2/scopes#drive)

### 3.3 Google Calendar Integration

PMO's delivery milestones, inspection schedules, and progress billing target dates can be synchronized to project calendars:
- **Architecture:** One-way push (PMO $\rightarrow$ Google Calendar). Avoids bidirectional two-way conflict synchronization tar-pits.
- **REST Endpoints:**
  - Create event: `POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`
  - Update event: `PATCH https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}`
- **Scope & Verification:**
  - Requires `https://www.googleapis.com/auth/calendar.events` (View and edit events on calendars the user has access to).
  - Classified as a **Sensitive Scope** by Google.
  - If registered as an **Internal** GCP application within the prospect's Google Workspace organization, no Google review is required.
  - If registered as an **External** multi-tenant application, Google requires sensitive scope verification (written justification, domain verification in Google Search Console, and an unlisted YouTube video demonstrating the OAuth consent screen and feature in action).
- **Quotas:** 1,000,000 queries per day per project; 500 requests per 100 seconds per user (~5 QPS).
- *Primary Sources:*
  - [Google Calendar API — Events: insert](https://developers.google.com/calendar/api/v3/reference/events/insert)
  - [Google Calendar API — Scopes](https://developers.google.com/calendar/api/auth)
  - [Google Calendar API — Quotas](https://developers.google.com/calendar/api/guides/quota)
  - [Google Identity — Sensitive Scope Verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

### 3.4 Token Custody for Google Background Operations

For background tasks (such as nightly milestone sync or scheduled calendar updates when the user is offline), PMO must custody Google OAuth refresh tokens:
- **Design Pattern:** Strictly reuses **ADR-0060** (Microsoft Graph token custody).
- **Security Controls:**
  1. Refresh tokens are obtained via server-side authorization code exchange (`access_type=offline`, `prompt=consent`).
  2. Stored in a locked-down `google_workspace_connections` table with RLS enabled and forced, no client-readable policy.
  3. App-layer envelope encryption using **AES-256-GCM** inside Supabase Edge Functions with Key Encryption Keys (KEK) held in environment secrets.
  4. Frontend never touches Google refresh tokens; all background updates execute in edge functions.

---

## 4. Comparison with Shipped Microsoft 365 Integration

PMO already ships an Entra ID SSO layer and has ratified detailed architecture decisions for M365 (ADR-0060 token custody, ADR-0063 integration architecture, ADR-0064 app registration topology, and [`docs/specs/m365-onedrive-doc-linking.spec.md`](../specs/m365-onedrive-doc-linking.spec.md)).

Here is how the Lark and Google Workspace integrations compare to the shipped M365 baseline:

| Dimension | Microsoft 365 (Shipped Baseline) | Google Workspace | Lark |
|---|---|---|---|
| **Identity & SSO** | Native Supabase `azure` provider. Shipped and operational. | Native Supabase `google` provider. **Parity effort (S)**; 1–2 days configuration. | No native Supabase provider. Requires custom Edge Function bridge or Enterprise SAML 2.0. **Higher effort (M)**. |
| **Document Linking** | OneDrive / SharePoint via Graph `driveItem` IDs. Specified, ready to build. | Google Drive via Google Picker + `drive.file` scope. Reuses link/reference schema. **Equal effort (M)**; avoids CASA audit. | Lark Drive/Docs API exists, but prospect primarily uses Google Drive for document storage. (Out of immediate pilot scope). |
| **Notifications** | Teams Adaptive Cards over webhooks or Bot Framework. | Not applicable (Google Workspace lacks a standalone enterprise chat channel equivalent to Teams/Lark). | Lark Webhook bots & `im/v1/messages`. **Lower effort (S)**; simpler schema than Adaptive Cards. |
| **Interactive Approvals** | Teams Actionable Cards with SoD RPC triggers (M365 Phase 3). | Not applicable. | Lark Interactive Message Cards (Schema 2.0) with `card.action.trigger` callbacks. **Equal effort (M)**; 3-second SLA requires fast edge execution. |
| **Conversational Bot** | Teams Bot Framework via Azure Bot Service. High plumbing overhead (Phase 3). | Not applicable. | Lark Bot (`im.message.receive_v1`) via direct HTTP webhook. **Lower effort (M)**; bypasses Azure Bot Service infrastructure. |
| **Calendar Sync** | Microsoft Graph Calendar API (`/me/events`). Phase 4 proposed. | Google Calendar REST API v3 (`events.insert`). **Equal effort (M)**; requires sensitive scope review if external. | Lark Calendar API exists, but prospect lives in Google Calendar for meeting/schedule coordination. |
| **App Topology** | Option C (vendor multi-tenant app) with Option B (client tenant) fallback (ADR-0064). | Internal GCP App (pilot) $\rightarrow$ Verified OAuth App in Google Workspace Marketplace (multi-tenant). | Custom App in prospect's Lark workspace (pilot) $\rightarrow$ Lark Store App (multi-tenant ISV). |

### Key Architectural Takeaways for PMO
1. **Splitting Communication vs Document Storage:**
   The prospect's tech stack splits functions cleanly: **Google Workspace for Identity, Documents (Drive), and Calendar**; **Lark for Communications, Notifications, and Approvals**. This is advantageous because PMO does not need to build redundant doc linking in Lark or redundant chat bots in Google.
2. **Reusing the Two-Switch Model (ADR-0049 / ADR-0061):**
   Both integrations map cleanly onto PMO's existing two-switch model:
   - *Operator Entitlement:* `google_workspace` and `lark_suite` feature flags in `org_features`.
   - *Client Activation:* In-app org settings page where the client admin supplies their Lark `app_id` / `app_secret` or connects their Google Workspace domain.
3. **Preserving Separation of Duties (SoD):**
   Whether an approval originates from PMO Portal, Microsoft Teams, or a Lark Interactive Message Card, the action routes through the same Postgres security-definer RPCs (`approve_purchase_order`, `approve_site_expense`). The approval card is merely an ambient transport layer; all business rules and ledger locks remain intact in Postgres.

---

## 5. Open Unknowns & Implementation Risks

1. **Prospect Tenant Topology:**
   - *Question:* Does the EPC prospect utilize a single unified Lark tenant and Google Workspace domain across all site operations, or do sub-contracted project sites operate on disparate domains?
   - *Impact:* Multi-domain setups require multi-tenant connection mapping in PMO's connection tables.
2. **Lark Pilot App Provisioning:**
   - *Question:* Will the prospect grant PMO developers access to register the Custom App in their Lark Developer Console, or will PMO provide an exportable app manifest / step-by-step wizard ([`wizard` skill](../../.agents/skills/wizard/SKILL.md)) for the prospect's IT administrator?
   - *Impact:* An admin-assisted wizard reduces vendor access requirements and respects enterprise credential boundaries.
3. **Google OAuth Verification Boundary:**
   - *Question:* For the pilot, can the prospect configure the Google Cloud Project as "Internal" to their Google Workspace organization?
   - *Impact:* Marking the GCP project as "Internal" eliminates Google's 4-to-6 week OAuth verification process and demo video requirement, unblocking the pilot immediately.
4. **Site Network Connectivity & Webhook Latency:**
   - *Question:* Do remote site users (e.g. mining / oil & gas camps) accessing Lark over satellite (VSAT) or high-latency cellular connections face card callback timeouts?
   - *Impact:* Lark's strict 3-second callback timeout means the edge function must return an HTTP 200 immediately (within <500ms) with a loading toast, deferring heavy database processing to an asynchronous worker if network latency is elevated.
5. **Approver User Identification:**
   - *Question:* How do approver identities correlate between Lark and PMO?
   - *Verification Needed:* Lark returns `open_id` and `user_id`. If user email access is granted in Lark (`contact:user.email:readonly`), PMO can automatically match incoming Lark actions to `profiles.email`. If email scope is withheld by the prospect's IT, PMO must store an explicit `lark_user_id` mapping in `profiles`.

---

## 6. Primary References & Citation Links

### Lark Developer Documentation
- [Lark Open Platform — Application Types](https://open.larksuite.com/document/home/introduction-to-lark-open-platform/app-types)
- [Lark Open Platform — Obtain tenant_access_token (Internal)](https://open.larksuite.com/document/server-docs/authentication-management/access-token/tenant_access_token_internal)
- [Lark Open Platform — Obtain tenant_access_token (Store App)](https://open.larksuite.com/document/server-docs/authentication-management/access-token/tenant_access_token)
- [Lark Open Platform — OIDC Authorization & Tokens](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/oidc-access_token/create)
- [Lark Open Platform — User Information API](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- [Lark Open Platform — Send Message API (`im/v1/messages`)](https://open.larksuite.com/document/server-docs/im-v1/message/create)
- [Lark Open Platform — Receive Message Events (`im.message.receive_v1`)](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)
- [Lark Open Platform — Card Callback Communication (`card.action.trigger`)](https://open.larksuite.com/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication/card-callback-interaction)
- [Lark Open Platform — App Approval & Release Guide](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/app-approval/guide-for-approval-of-custom-app-releases)

### Google Workspace & Cloud Documentation
- [Google Drive API — Quotas and Rate Limits](https://developers.google.com/drive/api/guides/limits)
- [Google Drive API v3 — `files.get`](https://developers.google.com/drive/api/v3/reference/files/get)
- [Google Drive Picker API Guide](https://developers.google.com/drive/picker/guides/overview)
- [Google Identity — OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes#drive)
- [Google Identity — Sensitive and Restricted Scopes Verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Google Calendar API v3 — Events: insert](https://developers.google.com/calendar/api/v3/reference/events/insert)
- [Google Calendar API — Auth and Scopes](https://developers.google.com/calendar/api/auth)
- [Google Calendar API — Usage Limits and Quotas](https://developers.google.com/calendar/api/guides/quota)
- [Supabase Auth — Google Social Login Provider](https://supabase.com/docs/guides/auth/social-login/auth-google)
