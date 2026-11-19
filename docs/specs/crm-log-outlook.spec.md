# CRM: log an Outlook email or meeting to a contact (manual "log to PMO")

Issue #1575 (map #791). Status: **Draft, 2026-11-15**, awaiting owner answers (end of the plan).
Executor on sign-off: Orca worker per `docs/orca-dispatch.md`; plan `docs/plans/2026-11-15-crm-log-outlook.md`.
Source: competitor review (private), section 3b. Size M.

**Owner rulings this encodes**
- **OD-CR-2** (`docs/decisions.md:1107`): v1 is a **manual** log: the user picks an email or meeting and files it as an
  activity. No background auto-sync; model it so auto-sync can ship later as a per-org opt-in flag.
- **ADR-0063** (M365 architecture): Graph is an adapter behind `graph_proxy`; Microsoft stays the source of truth and PMO
  stores a **reference**, never a copy of the mailbox; every user acts with **their own** delegated token; entitlement is
  Operator-owned (`org_features`), the personal connection is the user's own act (second amendment, 2026-07-30).
- **ADR-0016**: `can()` is UX only, RLS is the authority. **ADR-0010**: one owning test per AC at the lowest layer.

**Job story.** When I have just emailed or met a client contact in Outlook, I want to file that email or meeting against
the contact in PMO in a couple of clicks, so the account's timeline shows what was said without me retyping it.

## 1. AS-IS (shipped, cited against `origin/dev`)

- `public.crm_activities` (`supabase/migrations/0030_crm_contacts_activity.sql:45-56`): `contact_id` NOT NULL (cascade),
  `company_id`, `project_id`, `kind` (`Call|Email|Meeting|Note`), `subject`, `body`, `occurred_at`, `logged_by_id`.
  RLS: select by org; write for Admin, Executive, Project Manager, Finance with a parent-contact org guard (`:61-69`);
  a BEFORE INSERT trigger stamps `org_id` from the contact (`:77`). There is no field marking where an activity came from.
- DAL `pmo-portal/src/lib/db/crmActivities.ts` (`createActivity`, `updateActivity`, paged lists); UI is the contact
  activity panel `pmo-portal/pages/contact/ContactActivityPanel.tsx` (manual form: kind, subject, body, date) and the
  company page card `pages/company/AccountActivityCard.tsx`, which already merges the company's contacts' activities.
- `contacts.email` exists (`0030:14-25`), so a message participant can be matched to a contact by address.
- M365: personal connection via `m365-token-custody` (`initiate_connect`, `graph_proxy`). Requested scopes today are
  `Files.Read`, `Files.Read.All`, `Sites.Read.All` plus protocol scopes (`pmo-portal/src/lib/m365/graphPkce.ts:23`);
  `Sites.Selected` is an **incremental consent** requested only by `initiate_connect {folders:true}`
  (`supabase/functions/m365-token-custody/initiate.ts`). `graph_proxy` is GET-only for reads and allowlists named
  OneDrive/SharePoint paths (`graphRead.ts` `isOneDrivePath`, `scopeCoversPath`); any other path is refused.
- **Not shipped:** any Outlook mail or calendar scope, path, client, or UI; any link from an activity to a Microsoft item.

## 2. TO-BE (new)

A user with a personal Microsoft connection opens "Log from Outlook" on a contact, searches their recent mail or
calendar, picks one item, confirms, and PMO files an activity on that contact holding a **snapshot of the headline fields
plus a reference** (Microsoft message/event id and web link). Re-logging the same item to the same contact is refused as a
duplicate. Nothing is read or filed without the user picking it.

### 2.1 Requirements (EARS)

**Consent and access**
- **FR-OUTL-001** *(optional feature)* Where the org is entitled to M365 and the user holds a personal connection, the
  contact activity panel shall show a **Log from Outlook** action to users who may write CRM activities.
- **FR-OUTL-002** The system shall request the delegated read scopes `Mail.Read` and `Calendars.Read` only through an
  **incremental consent** (`initiate_connect` with `outlook: true`); the default connect scopes shall not change.
- **FR-OUTL-003** While the connection lacks the Outlook scopes, the action shall offer **Allow Outlook access** (reconnect
  with `outlook: true`) instead of the picker.
- **FR-OUTL-004** The Outlook scopes shall never authorize any non-GET Graph call, and shall never authorize a path
  outside the allowlist in FR-OUTL-010.

**Picking**
- **FR-OUTL-005** When the picker opens, the system shall list the user's most recent messages (default last 14 days,
  newest first, 25 per page) or, on the Meetings tab, their calendar events in a chosen date range, via `graph_proxy`.
- **FR-OUTL-006** When the user types a search term, the system shall filter the message list through Graph search;
  an empty term restores the recent list.
- **FR-OUTL-007** The system shall highlight messages and events whose participant addresses match the open contact's
  `email` (case-insensitive), listing them first, and shall still allow the user to pick any item.
- **FR-OUTL-008** When Graph answers with an expired or revoked connection, throttling, or a consent error, the picker
  shall show the existing localized M365 error copy and a retry or reconnect action, never raw Graph text.

**Filing**
- **FR-OUTL-009** When the user confirms a picked item, the system shall create one `crm_activities` row on the open
  contact: kind `Email` for a message, `Meeting` for an event; `subject` from the item; `occurred_at` from the message
  received time or the event start; `body` from the item's body preview truncated to 500 characters; plus
  `source='outlook'`, the Graph item id, and its web link. The user may edit subject and body before confirming.
- **FR-OUTL-010** `graph_proxy` shall allow exactly these new read paths when the connection holds the matching scope:
  `/me/messages` (list, search), `/me/messages/{id}`, `/me/calendarView`, `/me/events/{id}`; with a server-side fixed
  `$select` limited to id, subject, from, toRecipients, ccRecipients, receivedDateTime, start, end, bodyPreview, webLink,
  isCancelled. Message bodies, attachments and headers shall never be requested.
- **FR-OUTL-011** If the same Microsoft item was already filed on the same contact, the system shall refuse with a
  "Already logged" message (enforced by a unique index, not by the client) and shall not create a second row.
- **FR-OUTL-012** The filing path shall use the existing `crm_activities_write` RLS and role set; no new role, RPC, or
  `SECURITY DEFINER` function is added, and `org_id` is never sent by the client.

**Display**
- **FR-OUTL-013** An activity with `source='outlook'` shall show an **Outlook** badge and an **Open in Outlook** link that
  opens the stored web link in a new tab with `rel="noopener noreferrer"`; the link is shown only when it is an
  `https` Microsoft Outlook host URL.
- **FR-OUTL-014** The new activity shall appear in the contact timeline and in the company's merged timeline without
  extra work (existing readers), and shall be editable and deletable like any activity; editing never changes the stored
  reference.

**Non-functional**
- **NFR-OUTL-001** No Graph response text, subject, address or id shall be logged server-side (status only), matching the
  existing redaction rule for record-folder reads.
- **NFR-OUTL-002** The stored snapshot is a convenience copy of headline fields; Microsoft remains the source of truth and
  the permission authority for the full item.
- **NFR-OUTL-003** All new UI strings are localized (en and id-ID) and follow `DESIGN.md` tokens and
  `docs/ux/screen-rules.md`; the picker is keyboard operable.
- **NFR-OUTL-004** Auto-sync is out of scope. The `source` column and the reference fields are the seam a later per-org
  opt-in sync would reuse (OD-CR-2).

### 2.2 Out of scope
Background sync; attachments; sending mail; full message bodies; filing against a company with no contact (see owner
question 1); shared/delegated mailboxes; Outlook add-in; calendar push (a different roadmap row).

## 3. Acceptance criteria (Given/When/Then)

- **AC-OUTL-001** *(FR-001)* Given an entitled org, a connected user in a CRM write role, and Outlook scopes held, when they
  open a contact, then **Log from Outlook** is shown; given a non-write role or no connection or no entitlement, it is not.
- **AC-OUTL-002** *(FR-002)* Given the default connect, when `initiate_connect` builds the authorize URL, then its scopes
  equal today's list; given `outlook: true`, then `Mail.Read` and `Calendars.Read` are added and nothing else.
- **AC-OUTL-003** *(FR-003)* Given a connection without Outlook scopes, when the user clicks the action, then they see
  **Allow Outlook access**, and no Graph call is made.
- **AC-OUTL-004** *(FR-004, 010)* Given a token holding only `Mail.Read`, when `graph_proxy` is asked for a calendar path,
  a non-GET method, a path with traversal or encoded separators, `/me/messages/{id}/attachments`, or a `$select` asking
  for `body`, then it answers 403 or 400 and calls Graph zero times.
- **AC-OUTL-005** *(FR-005)* Given Graph returns 30 messages, when the picker opens, then 25 are shown newest first with
  a way to load the rest; the Meetings tab shows events in the chosen range.
- **AC-OUTL-006** *(FR-006)* Given a search term, when the user types it, then the Graph request carries it as a search
  parameter; given it is cleared, the recent list returns.
- **AC-OUTL-007** *(FR-007)* Given the open contact's email matches a recipient on message B but not A, when the list
  renders, then B is listed before A with a match marker; both remain pickable.
- **AC-OUTL-008** *(FR-008)* Given Graph answers 401 revoked, 429, and 403 consent in turn, then the picker shows the
  localized message with Reconnect or Retry and shows no raw Graph text.
- **AC-OUTL-009** *(FR-009)* Given a picked message, when confirmed, then one Email activity exists on the contact with
  the subject, received time, a body of at most 500 characters, `source='outlook'`, item id, and web link; a picked event
  creates a Meeting at its start time.
- **AC-OUTL-010** *(FR-011)* Given the item is already filed on this contact, when filed again, then the database rejects
  it, the user sees "Already logged", and the row count is unchanged; the same item on a different contact succeeds.
- **AC-OUTL-011** *(FR-012)* Given a Project Manager of org A and a contact of org B, when they insert an Outlook-sourced
  activity, then RLS rejects it; given a Viewer role, the insert is rejected; given a client-sent `org_id`, it is ignored
  or rejected exactly as for manual activities.
- **AC-OUTL-012** *(FR-013)* Given an Outlook-sourced activity with an `https` Outlook URL, then the badge and link render
  with the safe rel; given a stored URL on another host or scheme, then no link renders.
- **AC-OUTL-013** *(FR-014)* Given a filed activity, then it appears in the contact and company timelines, can be edited
  or deleted, and an edit leaves `source` and the reference unchanged.
- **AC-OUTL-014** *(NFR-001)* Given any proxied Outlook call, then the redacted log line contains status only.
- **AC-OUTL-015** *(journey)* Given a connected Project Manager, when they open a contact, pick an email from the mocked
  mailbox, confirm, and reopen the page, then the Email activity with an Outlook badge is in the timeline.
