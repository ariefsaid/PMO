# Google Workspace: Google sign-in and one-way Calendar events for milestones and deadlines

Issue #1583 (map #459). Status: **Draft, 2026-11-15**, awaiting owner answers in the plan. Scope source:
`docs/research/2026-10-30-lark-google-workspace.md` §3.1, §3.3, §3.4. Pattern source: ADR-0060 (token custody),
ADR-0063 (integration architecture), `docs/specs/m365-phase1-graph-token-custody.spec.md`.

**Money path: none.** No posting, no SoD change, no change to any financial record. New server-only token table
and one new edge function, so the security-auditor gate applies in full.

**Job story.** When a project's phase target dates or end date are set or moved, I want them to appear (and
stay current) in my team's Google Calendar, so that deadlines are visible where people already plan their day,
without anyone re-typing dates.

## 1. AS-IS (shipped)

- Sign-in: Supabase Auth with the Microsoft provider only (`pmo-portal/src/auth/LoginPage.tsx`,
  `AuthProvider.tsx`; local template in `supabase/config.toml`). No Google button. Self-signup stays off; the
  `profiles` row and RLS remain the authorization authority.
- Dates: `project_milestones.target_date` (shown to users as **Phase**; nullable, org-scoped RLS, write by
  Admin / Project Manager, `0023_delivery_milestones.sql`), `projects.end_date`. A read-only in-app calendar
  already lists dated phases (`get_projects_milestone_dates`, `0029_calendar_milestone_dates.sql`,
  `pmo-portal/src/lib/db/milestones.ts`).
- Token custody precedent: `ms_graph_connections` (forced RLS, no client policy, ciphertext only),
  `supabase/functions/m365-token-custody/` (initiate, callback, refresh, revoke, audit), AES-256-GCM envelope in
  `pmo-portal/src/lib/m365/graphTokenCrypto.ts`, two-switch entitlement via `org_features` +
  `operator_toggle_feature` (`0107_org_features_add_m365.sql`, `pmo-portal/src/lib/features.ts`).
- Nothing exists for Google Calendar: no connection table, no function, no feature key, no event mapping.

## 2. Scope

In: (A) "Continue with Google" sign-in; (B) Google connection by an org Admin; (C) one-way push of dated
phases and the project end date as all-day events to one chosen calendar; (D) status and disconnect UI.
Out: reading Google data, two-way sync, task due dates, work-order dates, attendees/invites, Drive linking
(separate issue), Lark, per-user personal calendars, mobile.

## 3. Requirements (EARS)

### A. Google sign-in
- **FR-GCAL-001** The login page shall offer "Continue with Google" beside the existing Microsoft button, using
  Supabase's Google provider.
- **FR-GCAL-002** When a Google identity has no invited `profiles` row, the system shall refuse sign-in and
  create no account (authentication does not authorize).
- **FR-GCAL-003** Where the provider is not configured for the environment, the system shall hide the button.

### B. Connection and custody
- **FR-GCAL-010** The system shall provide an `org_features` entitlement `google_calendar` (Operator-owned,
  default off, through the existing `operator_toggle_feature`); while off, no Google UI, route or function path
  is reachable and no event is pushed.
- **FR-GCAL-011** When an org Admin starts a connection, the system shall run a server-side authorization-code
  + PKCE flow requesting offline access and only the calendar-events scope; the browser shall never receive a
  Google token.
- **FR-GCAL-012** The system shall store the refresh token only as AES-256-GCM ciphertext in a new
  `google_calendar_connections` table with forced RLS, no client policy and no client grant, one active
  connection per org (`org_id` stamped by the writer; `org_id` seam preserved).
- **FR-GCAL-013** When Google reports the grant invalid, the system shall mark the connection `stale`, stop
  pushing, record an audit and error event (metadata only), and show "Reconnect" to Admins.
- **FR-GCAL-014** When an Admin disconnects, the system shall revoke the token at Google (best effort), delete
  the ciphertext, set the connection `revoked`, and leave existing calendar events untouched.
- **FR-GCAL-015** The system shall let the connecting Admin choose the target calendar from the calendars their
  grant can write, defaulting to a calendar named for the product; the choice is stored on the connection.

### C. One-way event push
- **FR-GCAL-020** For each dated phase and each project end date in the org, the system shall maintain exactly
  one all-day Google event in the target calendar, identified by a deterministic event id derived from the PMO
  record, so a retry never duplicates.
- **FR-GCAL-021** The event title shall be "<project name>: <phase name>" (phase) or "<project name>: deadline"
  (end date); the description shall carry a link to the project in PMO and no financial data.
- **FR-GCAL-022** When a phase date, phase name or project end date changes, the system shall patch the same
  event; when the date is cleared or the phase/project is deleted or archived, the system shall delete the event.
- **FR-GCAL-023** Pushing shall be asynchronous: a database trigger enqueues a change row in a locked-down
  outbox in the same transaction as the edit; a scheduled sweep drains it. A Google outage never blocks or fails
  the user's edit.
- **FR-GCAL-024** The sweep shall be idempotent and bounded: it honours Google's 429/5xx with backoff, caps calls
  per run, and records each outcome per row (`pending`, `synced`, `failed` with a reason code, no payload).
- **FR-GCAL-025** The sweep shall ignore edits made to the events in Google (one-way); the next PMO change
  overwrites them. The UI says so.
- **FR-GCAL-026** When a connection is first made, the system shall backfill all currently dated phases and end
  dates of non-archived projects.

### D. Status UI
- **FR-GCAL-030** The Integrations area shall show, to Admins only, connection state (not connected, active,
  needs reconnect), target calendar, last successful push time, count of failed items, and Connect / Reconnect /
  Disconnect actions, gated by `can()` and the entitlement.
- **FR-GCAL-031** Non-Admins shall see no Google Calendar controls.

## 4. Non-functional requirements
- **NFR-GCAL-001** Tokens exist in plaintext only inside the edge function's memory; never in logs, error
  messages, responses, realtime, audit or error-event payloads (ADR-0060 controls reused).
- **NFR-GCAL-002** The state/PKCE parameters are single-use, short-lived and bound to the initiating user.
- **NFR-GCAL-003** The sweep processes at most a fixed batch per run and stays within Google's per-user quota.
- **NFR-GCAL-004** Event content is limited to names, dates and a PMO link; no amounts, no client data.
- **NFR-GCAL-005** Every new table has RLS and the `org_id` seam; rollback script provided.

## 5. Acceptance criteria (Given/When/Then)

- **AC-GCAL-001** (FR-001, 003) Given Google is configured, when the login page renders, then "Continue with
  Google" is shown; given it is not configured, then it is absent.
- **AC-GCAL-002** (FR-002) Given a Google identity with no invited profile, when it completes sign-in, then no
  session or account results and the user sees the not-invited message.
- **AC-GCAL-003** (FR-010, 031) Given the entitlement is off or the user is not an Admin, when any Google
  Calendar route or function is called, then it is refused and no UI renders.
- **AC-GCAL-004** (FR-011, 012, NFR-001) Given an Admin completes consent, when the callback runs, then a
  connection row exists with ciphertext only, no response or log contains a token, and a client JWT cannot read
  or write the table.
- **AC-GCAL-005** (NFR-002) Given a reused, expired or foreign-user state value, when the callback runs, then it
  is rejected and nothing is stored.
- **AC-GCAL-006** (FR-020, 021, 026) Given a project with two dated phases and an end date, when the connection
  is first made, then exactly three all-day events exist with the specified titles and links and no money.
- **AC-GCAL-007** (FR-020) Given the same change row is delivered twice, when the sweep runs, then Google holds
  one event (deterministic id; a 409 on insert is treated as success followed by patch).
- **AC-GCAL-008** (FR-022) Given a synced phase, when its date moves, name changes, date clears or it is
  deleted, then the event is patched or deleted accordingly.
- **AC-GCAL-009** (FR-023, 024) Given Google returns 5xx or 429, when a PM edits a phase date, then the edit
  saves, the row stays pending with backoff, and a later sweep succeeds.
- **AC-GCAL-010** (FR-013) Given Google answers invalid-grant, when the sweep runs, then the connection becomes
  stale, pushes stop, audit and error event exist, and Admins see Reconnect.
- **AC-GCAL-011** (FR-014) Given an active connection, when the Admin disconnects, then ciphertext is deleted,
  status is revoked, and no further calls to Google are made.
- **AC-GCAL-012** (FR-015, 030) Given the Admin opens status, when calendars load, then they can pick the target
  and see state, last push and failure count.
- **AC-GCAL-013** (NFR-005) Given two orgs, when org A's edits drain, then only org A's connection is used and
  org B's events are untouched.
