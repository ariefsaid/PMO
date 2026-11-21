# Payment channel on a purchase request (#2698)

Status: draft for Director review · Map #2516 · Migrations `1355_payment_channel_schema.sql`, `1356_payment_channel_rpcs.sql`

## 1. Overview and user value

**Job story.** When a purchase is made, I want to record how it will be paid, so finance sees the channel.

A purchase request (the `procurements` record) gains one optional field, its **payment channel**: how the purchase will
be paid (for example bank transfer or cash). It sits next to the request's existing sourced, paid and received status and
is shown wherever finance reads that status. The list of channels is organisation data an Admin manages (OD-SCOPE-2):
empty by default, and no code ever branches on a channel's name.

## 2. Decisions taken (the Director may overturn any of these)

| ID | Decision | Why |
|---|---|---|
| D-PCH-1 | The channel is a row in a new per-organisation list table, referenced by `procurements.payment_channel_id`. | A client-defined list is data, not an enum; a reference keeps a renamed channel consistent on old requests. |
| D-PCH-2 | The switch is its own table `org_payment_channel_settings` (one row per org), not a column on a shared settings table. | Parallel tickets #2696 and #2697 also add purchase settings; separate objects merge without conflict. |
| D-PCH-3 | The channel is set through a small security-definer RPC `set_procurement_payment_channel`, not by `create_procurement_with_items` and not by direct update. | #2697 re-creates the create RPC; this ticket must not touch it. The `procurements` update grant is an explicit column list, so the new column is RPC-only by default. |
| D-PCH-4 | Who may set it: exactly the existing header-edit rule (`update_procurement_header`, 0393): an active member of the org, procurement on, request in Draft or Rejected, and the caller is the requester or an Admin. | The header edit is the existing rule for editing a request's own fields at that stage. No looser rule is invented. |
| D-PCH-5 | A channel is archived, never deleted (ADR-0018). An archived channel stays on requests that carry it and cannot be newly chosen. | Old requests keep their history. |
| D-PCH-6 | Turning the feature on seeds general starter channels once, only when the org has no channel rows at all. Turning it off and on again never re-seeds or duplicates. | Idempotent; an Admin's edits are never overwritten. |
| D-PCH-7 | Off by default. While off, no read of the channel, no field, no column and no Admin list shows, and the set RPC refuses. | OD-SCOPE: nothing changes for an existing organisation. |

## 3. Functional requirements (EARS)

- **FR-PCH-001** (settings) — Where an organisation's Admin sets the payment channel feature, the system shall store on or
  off for that org, stamp who and when, audit the change, and refuse any other role.
- **FR-PCH-002** (starter rows) — When the feature is turned on and the org has no channel rows, the system shall insert the
  general starter rows (Bank transfer, Cash, Cheque, Card) once; it shall not insert when any row (live or archived)
  exists.
- **FR-PCH-003** (channel list) — Where the feature is on, an Admin shall add, rename and archive or restore channels. A
  name is trimmed, 1 to 60 characters and unique among the org's live channels, case-insensitive. Any other role shall be
  refused.
- **FR-PCH-004** (read) — The system shall let every active member of the org read the org's channel list and settings, and
  no member of another org.
- **FR-PCH-005** (set on a request) — When the feature is on and a caller allowed by D-PCH-4 sets a channel on a request, the
  system shall store it. The channel must belong to the request's org and be live. Passing no channel clears it.
- **FR-PCH-006** (refusals) — The system shall refuse, with 42501, a caller outside D-PCH-4, a request of another org, a
  request past Draft or Rejected, an archived or foreign channel, and any call while the feature is off.
- **FR-PCH-007** (tenancy seam) — The system shall never accept a client-supplied `org_id`; org comes from the caller's
  JWT, and the channel column on a request is writable only through FR-PCH-005.
- **FR-PCH-008** (UI: set) — Where the feature is on, the request's header edit shall offer a Payment channel select
  (shared form primitives) to a caller who may set it, and shall not render for anyone else or when off.
- **FR-PCH-009** (UI: finance sees it) — Where the feature is on, the request's details (beside its payment status) and the
  finance payables list shall show the channel (name, or a dash when unset). When off, neither shows anything new.
- **FR-PCH-010** (UI: Admin list) — Where the caller may manage org accounting, Administration shall offer the on/off switch
  and the channel list management, in English and Bahasa Indonesia. Not shown to other roles.
- **NFR-PCH-001** — No channel name, client term or count appears in code; the starter rows are the only literals and are
  general words in the migration, editable by the Admin.

## 4. Settings

| Setting | Where | Default |
|---|---|---|
| Payment channel feature on or off | `org_payment_channel_settings.enabled`, per org, Admin only | off (no row = off) |
| Payment channel list | `org_payment_channels`, per org, Admin managed | empty; four general rows seeded only when an Admin first turns the feature on |

## 5. Default-off statement

With no settings row (every existing org) the feature is off: `procurements.payment_channel_id` is null and unread; the
procurement select, the header edit form, the details view, the payables list and Administration render exactly as before;
the set RPC refuses. No existing function, trigger, policy or test is changed (`create_procurement_with_items`,
`update_procurement_header` and `transition_procurement` are untouched), so existing tests pass unedited.

## 6. Acceptance criteria (Given / When / Then)

- **AC-PCH-001** Given an org with no settings row, When an Admin of another org reads, Then they see no row; And when this
  org's member reads settings, Then they see none (off). *(pgTAP, FR-PCH-004, FR-PCH-007)*
- **AC-PCH-002** Given an Admin, When they turn the feature on for the first time, Then the four starter rows exist; And when
  they turn it off and on again, Then there are still exactly four. *(pgTAP, FR-PCH-001/002)*
- **AC-PCH-003** Given a non-Admin (Finance, Project Manager), When they call the settings or list-management RPCs, Then
  42501 and nothing changes. *(pgTAP, FR-PCH-001/003)*
- **AC-PCH-004** Given an Admin and the feature on, When they add a channel with a duplicate name (any case) or an empty
  or 61-character name, Then it is refused; And rename and archive/restore work. *(pgTAP, FR-PCH-003)*
- **AC-PCH-005** Given a member of org A, When they select from the channel list or settings, Then they see only org A's
  rows. *(pgTAP, FR-PCH-004)*
- **AC-PCH-006** Given the feature on and a Draft request raised by user R, When R or an Admin sets a live channel, Then it
  is stored; And when clearing with null, Then it is null. *(pgTAP, FR-PCH-005)*
- **AC-PCH-007** Given the same request, When a different non-Admin (including Finance), a caller from another org, a
  request in Requested or later, an archived channel, a channel of another org, or the feature off applies, Then 42501 and
  the value is unchanged. *(pgTAP, FR-PCH-006)*
- **AC-PCH-008** Given an authenticated user, When they `update procurements set payment_channel_id` directly, Then it is
  refused (no column grant). *(pgTAP, FR-PCH-007)*
- **AC-PCH-009** Given the feature on and a request with a channel, When Finance opens the request details and the payables
  list, Then the channel name shows beside the payment status; And with the feature off, Then nothing extra shows.
  *(Unit, FR-PCH-009)*
- **AC-PCH-010** Given the feature on, When the requester edits the header, Then a Payment channel select lists live
  channels and saves through the RPC; And a user who may not set it sees no select; And off shows none. *(Unit, FR-PCH-008)*
- **AC-PCH-011** Given an Admin on Administration, When they switch the feature on and add, rename and archive a channel,
  Then the list updates; And a non-Admin sees no control. English and Bahasa Indonesia strings exist. *(Unit, FR-PCH-010)*
- **AC-PCH-012** Given the new RPCs, When the anon-definer inventory and the initplan guard run, Then both pass.
  *(pgTAP 0178 and 0646 plus fragments)*

## 7. Mutation checks (written now, run by the orchestrator)

Each must turn its named test red when the rule is broken, then restored:

1. In `set_procurement_payment_channel`, drop the requester-or-Admin check (`or true`): AC-PCH-007 goes red.
2. Drop the Draft/Rejected status check: AC-PCH-007 goes red.
3. Drop the same-org channel check: AC-PCH-007 goes red.
4. In `set_payment_channel_settings`, drop the Admin check: AC-PCH-003 goes red.
5. Make the seed unconditional: AC-PCH-002 goes red (eight rows).
6. Grant update on `payment_channel_id` to authenticated: AC-PCH-008 goes red.

## 8. Out of scope

Paying through a channel, channel-specific rules, ERP mapping of channels, channel on other documents. No later ticket
implied.
