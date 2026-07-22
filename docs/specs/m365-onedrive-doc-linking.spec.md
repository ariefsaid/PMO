# Microsoft 365 integration — Phase 1 (OneDrive / SharePoint Document **Linking**) — spec

> **⏸️ NOT BUILT (as of 2026-07-22).** This spec is written and awaiting owner sign-off; **no code exists for
> it**. Its enabling runtime (Graph token custody) IS built, security-hardened and merged to `dev`.
> **Build is gated on ONE proven live Microsoft connection** — the runtime has never contacted Microsoft
> (all tests mock `fetch`), so building this on top first would risk reworking both layers. Live state, TBDs
> and gotchas: the M365 entry in [`docs/backlog.md`](../backlog.md). Parent: the
> [vision §3.2](../microsoft-365-integration.md).
>
> ⚠️ **Cite ADRs by filename, not number** — three ADRs share the number 0059 and two share 0058 (a
> known repo-wide collision, see the M365 gotchas in the backlog).

- **Status:** Draft for Director/owner review — **NOT BUILT**.
- **Controlling ADRs (ACCEPTED, binding):** [ADR-0058](../adr/0058-microsoft-365-integration-architecture.md)
  (integration architecture — Graph data follows the ADR-0055 external-adapter pattern; auth≠authz;
  two-switch entitlement), [ADR-0059](../adr/0059-entra-app-registration-topology.md) (Entra app
  topology), [ADR-0060](../adr/0060-microsoft-graph-token-custody.md) (the token-custody runtime this
  feature consumes). **Related:** ADR-0055/0056 (external adapters + watermarks — the shape a Graph
  *data* feature takes), ADR-0017 (repository seam), ADR-0016 (FE authz UX-only / RLS-as-ceiling),
  ADR-0018 (soft-archive), ADR-0019 (security-definer RPC + destructive deletes), ADR-0010 (test
  pyramid), ADR-0001 (org_id seam), ADR-0076 (audit_events).
- **Vision:** [`docs/microsoft-365-integration.md`](../microsoft-365-integration.md) §3.2 —
  *"OneDrive doc linking (link/reference model) — Attach Graph driveItem refs to `project_documents`;
  Microsoft stays the permission authority. No file duplication; inherits M365 access control."* The
  same table explicitly **REJECTS** *"Import/copy into Supabase Storage"* for M365 clients (it
  duplicates their source of truth). This spec encodes that decision verbatim — **link/reference
  ONLY, never copy.**
- **Consumes (built, merged):** [`docs/specs/m365-phase1-graph-token-custody.spec.md`](m365-phase1-graph-token-custody.spec.md)
  — the `graph_proxy` action, its scope gate, and its error taxonomy are this feature's transport.
  The Connect flow is wired (commit `e01a5c8f`, PR #337). This is the **first user-visible feature
  that consumes that runtime** — the payoff the whole vision was for.
- **Scope:** attaching a Microsoft Graph `driveItem` **reference** to a `project_documents` row;
  the Admin/PM browse-and-link flow over `graph_proxy`; the rendered document surface for a linked
  doc; the degradation UX when the connection is absent/stale/revoked or the item is deleted/renamed;
  and the authorization rules for link/unlink. It does **NOT** copy bytes, preview file contents
  in-app, write back to OneDrive, or background-sync.

---

## 1. Context

The token-custody runtime (PR #333) and the Connect flow (PR #337) are merged: an entitled org's
Admin can connect their Microsoft 365 tenant, the `ms_graph_connections` row holds the encrypted
tokens, and `graph_proxy` will decrypt + call Graph + return data on the caller's behalf — the
browser never holds a token (NFR-M365-101/102). Everything above that line is built.

This spec is the first thing **below** that line: a PMO user picks a OneDrive/SharePoint file and
*links* it to a project document. The non-negotiable model, straight from vision §3.2, is
**link/reference, not copy**:

- We persist **only the Graph reference** — `driveId`, `itemId`, `webUrl`, the item's `name` — to the
  existing `project_documents` row. **No file bytes** are copied into Supabase Storage.
- **Microsoft remains the permission authority.** Opening a linked document navigates the viewer's
  browser to Microsoft, which enforces the viewer's *own* M365 permissions. PMO never re-authorizes
  M365 access. The PMO-held token is used **only** to *browse at link time*; it is **not** used to
  *open* an already-linked document (the stored `webUrl` is a plain browser URL).
- A linked doc is **first-class in the existing Documents surface** — it co-exists with uploaded
  files, flows the same Draft→Issued→Approved status workflow, and is governed by the same
  `can('create'/'edit'/'delete', 'document')` permissions. No new role model.

The elegant payoff of the link model — and the architectural reason it degrades gracefully — is that
**the connection state gates NEW linking, never the viewing of an existing link.** A linked doc is
displayed and openable whether the org's connection is active, stale, revoked, or absent, because the
reference is a URL, not a token-mediated stream.

The build reuses shipped patterns verbatim: the repository seam (ADR-0017 — `repositories.document`),
the `EntityFormModal`/`useEntityForm` shared primitives, `classifyMutationError` for toast mapping,
the `M365ConnectionCard`'s `connection_status` + `describeM365Error` UX mapping, and the existing
`project_documents_select`/`project_documents_write` RLS (0002).

---

## 2. Non-functional requirements

- **NFR-M365DOC-001 (Link/reference ONLY — vision §3.2 rejection).** The feature shall store **only
  the Graph reference** (`driveId`, `itemId`, `webUrl`, `name`) on the document row. It shall **never**
  copy, import, mirror, or cache Microsoft file bytes into Supabase Storage or any PMO table. The
  rejected "Import/copy into Supabase Storage" row of vision §3.2 is binding.
- **NFR-M365DOC-002 (Microsoft is the permission authority).** PMO shall **not** re-authorize or
  re-proxy M365 access when a user *opens* a linked document. The stored `webUrl` is opened by the
  viewer's browser directly against Microsoft; Microsoft enforces the viewer's own M365 permissions.
  PMO's token custody is used **only** for the browse step of *linking* a new document.
- **NFR-M365DOC-003 (Token never reaches the browser — inherits NFR-M365-101/102).** All Graph reads
  performed during the browse-and-link flow shall go through the existing `graph_proxy` action
  (server-side decrypt → Graph → return data). The browser shall receive **only the resulting
  driveItem metadata**; no Microsoft access/refresh token, `code_verifier`, or `oid` shall transit
  or persist client-side.
- **NFR-M365DOC-004 (org_id + RLS consistency).** The Graph reference columns live on
  `project_documents`, which is already `org_id`-scoped with RLS (`project_documents_select` /
  `project_documents_write`, migration 0002). The feature shall add **no** new table and **no** new
  RLS policy; the existing policies shall govern the new columns by virtue of being on the same row.
- **NFR-M365DOC-005 (Graceful degradation — never a raw error/token/oid).** Every degraded state
  (not-connected, stale, revoked, scope-insufficient, item-deleted, item-renamed, Graph-error,
  network) shall render reviewed human copy. A raw Microsoft error string, an `oid`, a tenant id, a
  driveItem id in an error message, or any token shall **never** reach the DOM (mirrors the
  `M365ConnectionCard` + `describeM365Error` discipline).
- **NFR-M365DOC-006 (Invariant enforced structurally, not by app discipline).** The "a document is
  EITHER an uploaded file OR a Microsoft link OR neither — never both, never a half-ref" invariant
  shall be enforced by a **CHECK constraint at the Postgres boundary**, not merely by FE/repository
  discipline. A future code path that forgets the rule cannot corrupt the row.
- **NFR-M365DOC-007 (No background sync / watermark reconciliation).** There shall be **no**
  scheduled job, no change-feed, no Graph delta query, and no watermark tracking for linked items.
  The reference's `ms_last_verified_at` (§3.1) is updated **lazily** — only as a side-effect of a
  user-initiated browse — never by a background process. (Vision §3.2 lists in-app browse/preview and
  background sync as separate, larger items; both are out of scope here.)
- **NFR-M365DOC-008 (Audit without secret leakage).** Link and unlink shall emit `audit_events` rows
  with metadata only (`org_id`, `actor_id`, `document_id`, `ms_drive_id`, `ms_item_id` — these are
  non-secret Graph identifiers, like the `entra_*` audit fields in the custody spec) — never a token,
  never the `webUrl`'s query portion if one were ever present, and never a raw Microsoft error.

---

## 3. Functional requirements

### 3.1 Data model — extend `project_documents` with nullable Graph reference columns

- **FR-M365DOC-001 (Ubiquitous — columns on the existing row).** The system shall extend
  `project_documents` (migration 0001) with nullable, Microsoft-reference columns. Chosen columns
  (all nullable unless noted), prefixed `ms_` so a future external-source family (`gdrive_*`, etc.)
  slots in without polluting core columns and so a reader never mistakes them for the Supabase
  Storage `file_path`:
  - `source public.doc_source` — nullable discriminator enum (new type `doc_source` ∈ `{ 'upload',
    'onedrive' }`). `NULL` = metadata-only register entry (no file, no link — the *current* reality
    for rows created while Storage was disabled); `'upload'` = a Supabase Storage file lives at
    `file_path`; `'onedrive'` = a Microsoft `driveItem` reference lives in the `ms_*` columns.
  - `ms_drive_id text` — the Graph `parentReference.driveId` (the drive/container that owns the item).
  - `ms_item_id text` — the Graph `driveItem.id` (the stable item identifier within the drive).
  - `ms_web_url text` — the Graph `driveItem.webUrl` (the browser-openable Microsoft URL — the load-
    bearing field; this is what "open" navigates to).
  - `ms_item_name text` — the Graph `driveItem.name` at link time (display copy; may drift if the
    item is later renamed in Microsoft — see FR-M365DOC-034).
  - `ms_linked_by uuid` — the PMO `profiles.id` of the user who created the link (mirrors `author_id`;
    for audit/forensics; not an SoD axis).
  - `ms_linked_at timestamptz` — immutable, set on link.
  - `ms_last_verified_at timestamptz` — nullable; updated **lazily** only when a browse re-confirms
    the item still resolves (FR-M365DOC-014). Renamed from "synced" deliberately — "sync" implies the
    rejected background-sync non-goal (NFR-M365DOC-007).

  **Decision — extend vs separate table (justification).** Extend `project_documents`. Rationale:
  (a) the relation is **1:1** with the document row (a document has at most one source — the
  invariant in NFR-M365DOC-006); a 1:1 that is always co-selected with its parent is a column, not a
  table. (b) The existing `project_documents_select`/`project_documents_write` RLS then governs the
  new columns for free — a separate `project_document_links` table would need its own `org_id`, its
  own RLS policies, and its own join, duplicating the parent's security model for zero gain. (c) The
  existing `document.create/edit/delete` policy (`can()`) automatically governs linking because the
  columns are on the same row — no new permission entity (per the "do NOT invent a new role model"
  constraint). (d) The either/or invariant is a **single-row CHECK** (FR-M365DOC-002); a separate
  table would make it a cross-table constraint requiring a trigger. (e) It is trivially reversible
  (nullable columns; `alter table … drop column`).

- **FR-M365DOC-002 (State-driven — the either/or invariant, structurally enforced).** While a
  `project_documents` row exists, it shall satisfy exactly one of three mutually-exclusive source
  states, enforced by a **CHECK constraint** at the Postgres boundary (NFR-M365DOC-006):
  - `source IS NULL` **AND** `file_path IS NULL` **AND** `ms_item_id IS NULL` — metadata-only;
  - `source = 'upload'` **AND** `file_path IS NOT NULL` **AND** `ms_item_id IS NULL` **AND**
    `ms_drive_id IS NULL` — an uploaded Supabase Storage file;
  - `source = 'onedrive'` **AND** `file_path IS NULL` **AND** `ms_item_id IS NOT NULL` **AND**
    `ms_drive_id IS NOT NULL` **AND** `ms_web_url IS NOT NULL` — a Microsoft link.
  Any other combination (both `file_path` and `ms_item_id` set; `source='onedrive'` without an
  `ms_item_id`; `source='upload'` with an `ms_item_id`; etc.) shall be **rejected** (CHECK violation,
  errcode `23514`) — including by the existing `confirmUpload` path (an upload to a linked row is
  structurally impossible) and by `linkMicrosoftDocument` (FR-M365DOC-011).

- **FR-M365DOC-003 (Ubiquitous — RLS reuse, no new policy).** The Graph reference columns shall be
  governed by the **existing** `project_documents_select` (read in-org) and `project_documents_write`
  (write in-org + MASTER_DATA role + parent-project-in-org) RLS policies. No new policy and no new
  grant shall be introduced. A client JWT shall not be able to write `ms_*` columns on a row outside
  its org or when its role lacks MASTER_DATA.

- **FR-M365DOC-004 (Where — org_id seam).** Where a row is linked, its `org_id` shall continue to be
  stamped by the existing column default + `project_documents_write` `WITH CHECK` (org_id =
  `auth_org_id()`). The link write shall **never** send `org_id` from the client — it is an `UPDATE`
  of `ms_*` columns on an already-org-scoped row (the repository's `linkMicrosoftDocument`
  FR-M365DOC-011 mirrors `updateProjectDocument`).

- **FR-M365DOC-005 (Ubiquitous — migration backfill is no-op-safe).** The adding migration shall
  add the columns nullable and shall backfill `source = 'upload'` for existing rows where
  `file_path IS NOT NULL`, leaving all other rows `source IS NULL`. No existing row shall violate the
  new CHECK (the backfill guarantees it). The migration is reversible (`alter table … drop column …`,
  `drop type doc_source`).

### 3.2 The linking flow (browse → select → persist reference)

- **FR-M365DOC-010 (Event-driven — browse via `graph_proxy`).** When a user opens the "Link from
  OneDrive" affordance (§3.4 gating), the FE shall enumerate candidate items by calling the existing
  `graph_proxy` action on the `m365-token-custody` edge function with `method: 'GET'` and a OneDrive
  path family permitted by the custody runtime's scope gate (e.g. `/me/drive/root/children`,
  `/me/drive/items/{id}/children`, `/drives/{drive-id}/items/{id}/children`,
  `/me/drive/search(q='{term}')`). The FE shall receive only the resulting `value[]` of driveItems;
  the browser shall never hold a Microsoft token (NFR-M365DOC-003). The FE transport (a new
  `browseOneDrive()` helper alongside `connectClient.ts`'s existing invoke wrappers) shall classify
  every error via the existing `describeM365Error` taxonomy.

- **FR-M365DOC-011 (Event-driven — persist reference only).** When the user selects a driveItem, the
  FE shall persist **only the reference** by calling `repositories.document.linkMicrosoftDocument(
  docId, { drive_id, item_id, web_url, name })` — a normal Supabase `UPDATE` of the `ms_*` columns +
  `source='onedrive'` + `ms_linked_by`/`ms_linked_at`, governed by RLS and the CHECK invariant
  (FR-M365DOC-002). **No file bytes** are transferred; **no Graph call** is made on the persist step
  (the reference was already obtained during browse). The update shall be rejected by the CHECK if
  the row currently has `file_path` set (FR-M365DOC-002).

- **FR-M365DOC-012 (Event-driven — link-on-create).** When the user picks "Add document → from
  OneDrive", the FE shall create a new `project_documents` row (via the existing `create` path) with
  `source='onedrive'` and the `ms_*` columns populated in one step. The row enters the workflow at
  `status='Draft'`, `author_id` = current user (unchanged from the upload create path); only the
  *source* of the document differs.

- **FR-M365DOC-013 (Event-driven — link-on-existing Draft).** When the user picks "Link from
  OneDrive" on an existing **Draft** row that has no file and no link (`source IS NULL,
  file_path IS NULL, ms_item_id IS NULL`), the FE shall update that row's `ms_*` columns + `source`.
  Linking onto a row that already has `file_path` (an upload) or `ms_item_id` (a link) shall be
  rejected by the CHECK (FR-M365DOC-002) and surfaced via `classifyMutationError`.

- **FR-M365DOC-014 (Where — lazy verification, no background sync).** Where the browse-list step
  (FR-M365DOC-010) returns an item whose `id` matches an already-linked `ms_item_id` on some row in
  the project, the FE may opportunistically refresh that row's `ms_item_name` and `ms_last_verified_at`
  (a single additional `UPDATE`). This is the **only** update to `ms_last_verified_at` — there is no
  scheduled reconcile, no delta query, no watermark (NFR-M365DOC-007).

- **FR-M365DOC-015 (State-driven — the linker must hold an active connection).** While the
  `graph_proxy` action resolves the **caller's own** `(org_id, user_id)` connection (`ms_graph_connections`
  is `unique(org_id, user_id)`, migration 0106), the browse step shall succeed only when the caller
  has an `active` connection of their own. The FE "Link from OneDrive" affordance shall therefore be
  gated on the viewer's `connection_status` (`status='active'`); a viewer without an active connection
  sees the degradation UX (§3.5) instead of the browser. **Phase-1 limitation (documented):** because
  the runtime is per-user and the connection card is Admin-gated today, linking is in practice limited
  to the connected Admin (or any user who has connected their own M365). An org-level service-account
  connection is a separate, larger item (out of scope, §6).

### 3.3 Rendering + access (Microsoft is the permission authority)

- **FR-M365DOC-020 (Ubiquitous — linked-doc appearance).** A linked document (`source='onedrive'`)
  shall render in the existing Documents register (table row + quick-view Drawer) unchanged in layout,
  with: (a) a **Microsoft indicator** (icon + "OneDrive"/"SharePoint" provenance label using the
  `ms_web_url` host) in the File column, in place of the Supabase-Storage `FileCell` upload/preview
  controls; (b) the document `title` remains the row identity (the `ms_item_name` is secondary copy
  shown only when it differs from `title`); (c) the status pill + status workflow + revision lineage
  render exactly as for an uploaded document.

- **FR-M365DOC-021 (Event-driven — open in Microsoft).** When a user activates "Open in OneDrive"
  (or "Open in SharePoint") on a linked document, the FE shall open `ms_web_url` in a **new browser
  tab** (`window.open(url, '_blank', 'noopener,noreferrer')`). The PMO application shall make **no**
  Graph call and shall use **no** PMO-held token on this path — the URL is opened directly, and
  Microsoft authenticates the viewer and enforces the viewer's own M365 permissions (NFR-M365DOC-002).

- **FR-M365DOC-022 (Ubiquitous — Microsoft is the permission authority).** Whether the viewer may
  read/edit the underlying Microsoft file is decided **by Microsoft alone**, at the moment the
  `webUrl` is opened. PMO shall not pre-check, proxy, or gate the open on any PMO-side permission or
  connection state. A viewer the Microsoft tenant denies (no license, no share, different tenant,
  MFA challenge) shall receive Microsoft's own denial/login UX — PMO does not interpose.

- **FR-M365DOC-023 (Where — viewer lacks M365 access to the item).** Where a PMO user can see the
  document row (RLS permits — they're in-org) **but** their own Microsoft identity lacks access to
  the linked item, the FE shall (a) still render the row and the "Open" affordance, and (b) show a
  clarifying hint near the action: *"Opens in Microsoft. Access depends on your Microsoft permissions
    on this file."* The click is not disabled — Microsoft's denial is the authority, and a user who
  later gains access (or signs in with a different identity) shall be able to open it without a PMO
  change.

- **FR-M365DOC-024 (Where — viewer with no PMO-M365 connection at all).** Where the viewer has no
  `ms_graph_connections` row (or the org has never connected), the FE shall **still** render and allow
  opening any already-linked document — opening requires no PMO token (FR-M365DOC-021). The PMO-M365
  connection is required **only to link a new document** (FR-M365DOC-015), never to view one.

### 3.4 Degradation (explicit — the reference outlives the connection)

**Core principle (FR-M365DOC-030):** a linked document is **never hidden, greyed-out, or removed**
as a function of the PMO-M365 connection state, of a Graph error, or of the item's Microsoft-side
existence. The reference is meaningful independent of the token: it remains a valid row in the
document register, flows the status workflow, and opens to Microsoft (which then says yes or no).
Connection state gates **only** the *browse-to-link-a-new-document* affordance.

- **FR-M365DOC-030 (Ubiquitous — link display is connection-independent).** The Documents register
  shall render a linked row identically whether the caller's M365 connection is `active`, `stale`,
  `revoked`, or absent (`NOT_CONNECTED`). No "loading"/"error" placeholder shall replace the row. The
  open action (FR-M365DOC-021) shall remain enabled.

- **FR-M365DOC-031 (State-driven — browse blocked when not connected).** While the viewer has no
  M365 connection (`NOT_CONNECTED`), the "Link from OneDrive" affordance shall be replaced with an
  honest "Connect Microsoft 365 first" prompt linking to Administration → Integrations. The prompt
  shall name no token, `oid`, or tenant.

- **FR-M365DOC-032 (State-driven — browse blocked when stale / revoked).** While the viewer's
  connection is `stale` or `revoked` (`CONNECTION_STALE` / `CONNECTION_REVOKED` from `graph_proxy`),
  the browse affordance shall surface *"The Microsoft 365 connection expired. Reconnect to link more
  documents."* + a "Reconnect Microsoft 365" action routing to the Integrations card's reconnect path
  (`initiateM365Connect()`). **Already-linked documents remain fully visible and openable**
  (FR-M365DOC-030).

- **FR-M365DOC-033 (Event-driven — item deleted in OneDrive).** When the underlying Microsoft item
  has been deleted, the linked row shall **still** render. Opening the `webUrl` shall navigate to
  Microsoft, which surfaces its own "item not found"/"deleted" state; PMO shall not pre-empt this.
  A lazy browse that detects the item is gone (a 404 from `graph_proxy` for that `ms_item_id`) may
  annotate the row with a subdued *"Microsoft could not find this file"* hint and stop updating
  `ms_last_verified_at`, but shall **not** auto-unlink (the user decides; FR-M365DOC-041).

- **FR-M365DOC-034 (Event-driven — item renamed in OneDrive).** When the Microsoft item is renamed,
  the reference remains valid — `ms_drive_id`, `ms_item_id`, and `ms_web_url` are stable. The row's
  PMO `title` is unchanged (it is the PMO document's identity). The cached `ms_item_name` may drift;
  it shall be refreshed lazily on the next browse that returns the item (FR-M365DOC-014), never by a
  background job.

- **FR-M365DOC-035 (State-driven — scope insufficient).** While the viewer's connection lacks a
  Graph scope required for the requested browse path (`SCOPE_INSUFFICIENT` — e.g. a SharePoint site
  library needing `Sites.Read.All`/`Files.Read.All`, §7), the FE shall surface *"The connection needs
  additional permissions. Reconnect to grant them."* + the reconnect action. No raw Graph path or
  scope string shall reach the DOM.

- **FR-M365DOC-036 (Ubiquitous — no raw error/token).** Every degraded UI surface (browse error,
  stale, revoked, scope-insufficient, item-deleted, network) shall display reviewed human copy mapped
  from the stable `M365ErrorCode` via `describeM365Error` (the existing `connectClient.ts` mapping, or
  a parallel `graphClient.ts` mapping). A raw Microsoft `error_description`, an `oid`, a tenant id, a
  `driveItem` id in an error string, or any token shall never reach the DOM (NFR-M365DOC-005).

### 3.5 Authorization (reuse `can()` — no new role model)

- **FR-M365DOC-040 (Ubiquitous — link = create/edit on the document).** The ability to link a
  Microsoft file to a document shall be gated by the **existing** `can('create', 'document')`
  (link-on-create) and `can('edit', 'document')` (link-on-existing-Draft) predicates in
  `pmo-portal/src/auth/policy.ts` — i.e. MASTER_DATA roles (Admin·Executive·PM·Finance), with edit
  additionally author-or-Admin (record-scoped). **No new permission entity** (no `can('link', …)`).

- **FR-M365DOC-041 (Ubiquitous — unlink = edit on the document).** Unlinking shall be gated by
  `can('edit', 'document')` (author-or-Admin). Unlink shall set `source=NULL, ms_drive_id=NULL,
  ms_item_id=NULL, ms_web_url=NULL, ms_item_name=NULL, ms_linked_by=NULL, ms_linked_at=NULL,
  ms_last_verified_at=NULL` on the row, reverting it to metadata-only. The row itself, its status,
  and its workflow history are unchanged.

- **FR-M365DOC-042 (Ubiquitous — unlink is non-destructive to the Microsoft file).** Unlinking shall
  make **no** Graph call — in particular **no** `DELETE` to the driveItem. The Microsoft file is
  entirely untouched; only PMO's *reference* to it is dropped. (This is the whole point of the link
  model — say it explicitly.) The custody runtime's `Files.Read`-only scope set (NFR-M365-005) makes
  a destructive write structurally impossible even if a future code path attempted it
  (`scopeCoversPath` rejects write methods without `Files.ReadWrite*`).

- **FR-M365DOC-043 (Ubiquitous — SoD unchanged).** Linking and unlinking are **not** segregation-of-
  duties axes; the existing approver-≠-author SoD on `transition_document_status` (migration 0017/0025)
  is unchanged and applies identically to linked and uploaded documents.

- **FR-M365DOC-044 (Event-driven — delete drops the reference only).** When an Admin deletes a
  linked document row (`can('delete', 'document')`), the `ms_*` reference is dropped along with the
  row (cascade of the row delete). **No** Graph `DELETE` is issued — the Microsoft file is untouched
  (same as unlink, FR-M365DOC-042). Existing 23503 FK-block semantics for referenced rows are
  unchanged.

### 3.6 Audit (ADR-0076)

- **FR-M365DOC-050 (Event-driven — link/unlink audit).** The repository write path shall emit an
  `audit_events` row on link and on unlink, via the existing `log_audit` security-definer helper
  (migration 0076): action `'project_document.m365_linked'` / `'project_document.m365_unlinked'`,
  with `org_id`, `actor_id`, `entity_id` = document id, and `detail` JSONB carrying `ms_drive_id`,
  `ms_item_id`, and (link only) a redacted `ms_web_url` host. **No** token, no `oid`, no tenant id,
  no Graph error string.

---

## 4. Acceptance criteria (Given/When/Then)

> **AC namespace:** `AC-M365DOC-0xx`. Chosen because it is unambiguous (a repo-wide
> `grep -r AC-M365DOC` finds only this feature), parallels the parents — `AC-M365-0xx` (Phase 0),
> `AC-M365-1xx` (Phase-1 custody), `AC-DOC-xxx` (the documents surface being extended) — and the
> `DOC` suffix marks it as the doc-linking subset of M365. The namespace does not collide with any
> existing AC id.
>
> Each AC is owned by **one** test at the lowest sufficient layer (ADR-0010); the owning test names
> its `AC-M365DOC-xxx` as the leading title token (Vitest `it(...)`, pgTAP leading description token,
> or Playwright leading `test(...)` title). **A true cross-stack e2e requires a live Microsoft
> connection + admin-consented scopes** (§7), so it is **deferred and owner-gated** (AC-M365DOC-050);
> every other AC is unit (Vitest/RTL, Graph mocked) or pgTAP (DB constraints/RLS), runnable in CI today.

### 4.1 Data model + invariants (pgTAP)

**AC-M365DOC-001 (source enum + columns exist, nullable — pgTAP).**
Given the migrated `project_documents` table,
When its columns are inspected,
Then `source` is a nullable `doc_source` enum (`'upload'|'onedrive'`), `ms_drive_id`/`ms_item_id`/
`ms_web_url`/`ms_item_name` are nullable `text`, `ms_linked_by` is nullable `uuid`, and
`ms_linked_at`/`ms_last_verified_at` are nullable `timestamptz`; and every pre-existing row's
`source` is `'upload'` where `file_path IS NOT NULL`, else `NULL`. *(Owns FR-M365DOC-001,
FR-M365DOC-005, NFR-M365DOC-006.)*

**AC-M365DOC-002 (either/or/none invariant — CHECK rejects all collisions — pgTAP).**
Given the `project_documents` CHECK constraint,
When an INSERT/UPDATE would produce a disallowed combination — (a) both `file_path` and `ms_item_id`
set; (b) `source='onedrive'` with `ms_item_id IS NULL`; (c) `source='upload'` with `ms_item_id` set;
(d) `source='onedrive'` with `file_path` set; (e) `source='upload'` without `file_path`,
Then each is rejected with errcode `23514`; and the three allowed combinations (metadata-only /
upload / onedrive-link) are all accepted. *(Owns FR-M365DOC-002, NFR-M365DOC-006.)*

**AC-M365DOC-003 (RLS covers the `ms_*` columns — cross-org / cross-role blocked — pgTAP).**
Given two orgs A and B and a non-MASTER_DATA viewer,
When a client JWT from org A attempts `UPDATE project_documents SET ms_web_url=…` on (i) an org-B
row or (ii) an org-A row while holding a read-only role,
Then both are rejected (42501) by the existing `project_documents_write` policy — no new policy was
added. *(Owns FR-M365DOC-003, FR-M365DOC-004, NFR-M365DOC-004.)*

### 4.2 Repository + linking write (unit — Vitest, Supabase mocked)

**AC-M365DOC-010 (linkMicrosoftDocument persists reference only, no bytes — unit).**
Given a Draft document row with `source IS NULL, file_path IS NULL`,
When `repositories.document.linkMicrosoftDocument(docId, { drive_id, item_id, web_url, name })` is
called,
Then it issues exactly one Supabase `UPDATE project_documents` setting `source='onedrive'` and the
`ms_*` columns + `ms_linked_by`/`ms_linked_at`, it issues **no** `storage` upload and **no** edge-
function invoke, and it emits a `project_document.m365_linked` audit event. *(Owns FR-M365DOC-011,
FR-M365DOC-050, NFR-M365DOC-001.)*

**AC-M365DOC-011 (link-on-create from a Graph item — unit).**
Given the "Add document → from OneDrive" path with a selected driveItem,
When `repositories.document.create` is called with `source='onedrive'` + the `ms_*` fields,
Then a single INSERT creates a `Draft` row with `author_id` = current user, `source='onedrive'`,
`file_path` NULL, and the `ms_*` columns populated. *(Owns FR-M365DOC-012.)*

**AC-M365DOC-012 (link onto an uploaded row is rejected by the CHECK — unit).**
Given a row with `source='upload', file_path='…/x.pdf'`,
When `linkMicrosoftDocument` is called on it,
Then the UPDATE is rejected (23514, surfaced as `AppError` with the code preserved) and
`classifyMutationError` maps it to a user-facing "this document already has an uploaded file"
toast. *(Owns FR-M365DOC-002, FR-M365DOC-013.)*

**AC-M365DOC-013 (browse via graph_proxy returns items, never a token — unit).**
Given the FE transport with `supabase.functions.invoke` mocked to return
`{ value: [{ id, name, webUrl, parentReference:{driveId} }, …] }`,
When `browseOneDrive({ path: '/me/drive/root/children' })` is called,
Then it invokes `m365-token-custody` with `{ action:'graph_proxy', method:'GET',
path:'/me/drive/root/children' }` and returns the driveItems; and the returned object contains no
`access_token`/`refresh_token`/`code_verifier`/`oid` field. *(Owns FR-M365DOC-010,
NFR-M365DOC-003.)*

**AC-M365DOC-014 (linker-must-be-connected gate — unit, RTL).**
Given the Documents tab and the viewer's `connection_status`,
When the viewer has no `active` connection,
Then the "Link from OneDrive" affordance is not offered (or is replaced by the §3.5 prompt) and no
`graph_proxy` call is made. *(Owns FR-M365DOC-015.)*

### 4.3 Rendering + open (unit — RTL)

**AC-M365DOC-020 (linked doc renders with Microsoft indicator + Open action — unit, RTL).**
Given a project with one linked document (`source='onedrive'`, `ms_web_url` set, `ms_item_name`
set),
When the Documents tab renders,
Then the row's File column shows a Microsoft/OneDrive provenance indicator and an "Open in OneDrive"
action (in place of the Supabase `FileCell` upload controls); the title, status pill, and revision
lineage render identically to an uploaded document. *(Owns FR-M365DOC-020.)*

**AC-M365DOC-021 (Open opens ms_web_url in a new tab, makes no Graph call — unit, RTL).**
Given a rendered linked document with a mocked `window.open`,
When the user activates "Open in OneDrive",
Then `window.open` is called with the `ms_web_url` and `'_blank','noopener,noreferrer'`, and **no**
`graph_proxy` invoke and **no** `m365-token-custody` call occurs on this path. *(Owns FR-M365DOC-021,
FR-M365DOC-022, NFR-M365DOC-002.)*

**AC-M365DOC-022 (viewer lacks M365 access — link still shown, hint rendered — unit, RTL).**
Given a linked document and a viewer who is in-org (RLS permits) but has no Microsoft access,
When the Documents tab renders,
Then the row and "Open" affordance are shown, and a clarifying hint *"Opens in Microsoft. Access
depends on your Microsoft permissions on this file."* is present; the affordance is not disabled.
*(Owns FR-M365DOC-023.)*

**AC-M365DOC-023 (viewer with no PMO connection still sees + opens the link — unit, RTL).**
Given a linked document and a viewer whose `connection_status` returns `NOT_CONNECTED`,
When the Documents tab renders,
Then the linked row is shown and "Open in OneDrive" opens the `ms_web_url` (FR-M365DOC-024) — the
absence of a PMO connection does not hide or disable the link. *(Owns FR-M365DOC-024,
FR-M365DOC-030.)*

### 4.4 Degradation (unit — RTL, Graph mocked)

**AC-M365DOC-030 (link display is connection-independent — unit, RTL).**
Given a linked document, when the viewer's connection is `active`, `stale`, `revoked`, or absent,
Then in every case the linked row renders with title/status/open-action unchanged — no
loading/error placeholder replaces it. *(Owns FR-M365DOC-030, NFR-M365DOC-005.)*

**AC-M365DOC-031 (browse blocked when not-connected → Connect prompt — unit, RTL).**
Given the viewer's `connection_status` is `NOT_CONNECTED`,
When the Documents tab renders,
Then the "Link from OneDrive" affordance is replaced by a "Connect Microsoft 365 first" prompt
linking to Administration → Integrations, and no `graph_proxy` call fires. *(Owns FR-M365DOC-031.)*

**AC-M365DOC-032 (browse blocked when stale/revoked → Reconnect — unit, RTL).**
Given the viewer's connection is `stale` (or `revoked`),
When `graph_proxy` returns `CONNECTION_STALE` (or `CONNECTION_REVOKED`) on browse,
Then the browse surface shows *"The Microsoft 365 connection expired. Reconnect to link more
documents."* + a "Reconnect Microsoft 365" action, while already-linked documents remain openable.
*(Owns FR-M365DOC-032.)*

**AC-M365DOC-033 (item deleted in OneDrive — link still shown, graceful on open — unit, RTL).**
Given a linked document whose `ms_item_id` no longer resolves (a `graph_proxy` 404 during a lazy
browse),
When the Documents tab renders,
Then the row is still shown (optionally with a subdued *"Microsoft could not find this file"* hint),
the row is **not** auto-unlinked, and "Open" still navigates to Microsoft (which surfaces its own
not-found UX). *(Owns FR-M365DOC-033.)*

**AC-M365DOC-034 (scope insufficient → Reconnect-to-grant — unit, RTL).**
Given a browse that returns `SCOPE_INSUFFICIENT` (e.g. a SharePoint library path the connection's
scopes don't cover),
When the surface renders the error,
Then it shows *"The connection needs additional permissions. Reconnect to grant them."* + reconnect
action, and no raw Graph path, scope string, or `error_description` appears in the DOM. *(Owns
FR-M365DOC-035, FR-M365DOC-036, NFR-M365DOC-005.)*

**AC-M365DOC-035 (no raw error/token/oid in any degraded UI — unit, RTL).**
Given each degraded path (not-connected, stale, revoked, scope-insufficient, item-deleted, network,
Graph-error),
When the Documents tab + browse modal render,
Then no rendered string contains a Microsoft `error_description`, an `oid`, a tenant id, a raw
`driveItem` id in an error message, or any token; every message is the reviewed `describeM365Error`
copy. *(Owns FR-M365DOC-036, NFR-M365DOC-005.)*

### 4.5 Authorization (unit — RTL + a unit assertion for the no-Graph-call invariant)

**AC-M365DOC-040 (link gated by can('create'/'edit','document') — unit, RTL).**
Given a viewer with a MASTER_DATA role + an active connection, the "Link from OneDrive" affordance
is offered; given a viewer whose role is not MASTER_DATA, it is not offered; given a viewer who is
MASTER_DATA but not the author of an existing Draft row, "Link from OneDrive" on that row is gated
by the author-or-Admin edit rule (hidden for a non-author non-Admin). No new permission predicate is
consulted. *(Owns FR-M365DOC-040.)*

**AC-M365DOC-041 (unlink gated by can('edit','document'); nulls `ms_*` — unit).**
Given a linked document and an author (or Admin) viewer,
When `repositories.document.unlinkMicrosoftDocument(docId)` is called,
Then it issues one `UPDATE` nulling `source` + every `ms_*` column (reverting to metadata-only),
emits a `project_document.m365_unlinked` audit event, and issues **no** `graph_proxy` call and **no**
Supabase Storage call. *(Owns FR-M365DOC-041, FR-M365DOC-042, FR-M365DOC-050.)*

**AC-M365DOC-042 (Admin delete drops the reference; Microsoft file untouched — unit).**
Given a linked document and an Admin viewer,
When `repositories.document.delete(docId)` is called,
Then the row (and its `ms_*` reference) is deleted, **no** `graph_proxy` `DELETE` is issued, and the
Microsoft driveItem is not touched. *(Owns FR-M365DOC-044, NFR-M365DOC-001.)*

### 4.6 The cross-stack journey (DEFERRED — owner-gated)

**AC-M365DOC-050 (real link journey end-to-end — e2e, DEFERRED).**
Given an entitled org with the M365 runtime deployed + live secrets (§7) and an Admin who has a
proven `active` Microsoft 365 connection consenting `Files.Read` (+ `Files.Read.All`/`Sites.Read.All`
for SharePoint, §7),
When the Admin opens a project, picks "Add document → from OneDrive", browses real items via
`graph_proxy`, selects one, and activates "Open in OneDrive",
Then the document row is created with `source='onedrive'`, the `ms_web_url` opens the real file in
Microsoft in a new tab, and a second PMO user (in-org, with their own Microsoft access to the item)
can open it; a third user with no Microsoft access sees the link but is denied by Microsoft on open.
*(Owns the cross-stack proof of FR-M365DOC-010/011/021/022/023. **Honest deferral:** this e2e
requires a live Microsoft tenant + admin-consented scopes and is **not runnable in CI**; it is
verified manually at ship and re-verified in the owner-gated integration window. All other ACs are
unit/pgTAP with Graph mocked.)*

---

## 5. Traceability (AC → owning layer/test, per ADR-0010)

| AC | Satisfies | Owning layer | Owning test (leading AC-id) | Verifiable |
|---|---|---|---|---|
| AC-M365DOC-001 | FR-001/005, NFR-006 | pgTAP (schema) | `supabase/tests/015x_project_documents_m365_columns.test.sql` | **DB** |
| AC-M365DOC-002 | FR-002, NFR-006 | pgTAP (CHECK) | same file | **DB** |
| AC-M365DOC-003 | FR-003/004, NFR-004 | pgTAP (RLS) | `supabase/tests/015y_project_documents_m365_rls.test.sql` | **DB** |
| AC-M365DOC-010 | FR-011/050, NFR-001 | Unit (Vitest, Supabase mock) | `pmo-portal/src/lib/repositories/__tests__/document.m365-link.test.ts` | **Now** |
| AC-M365DOC-011 | FR-012 | Unit | same file | **Now** |
| AC-M365DOC-012 | FR-002/013 | Unit (23514 → AppError) | same file | **Now** |
| AC-M365DOC-013 | FR-010, NFR-003 | Unit (invoke mock; assert no token in payload) | `pmo-portal/src/lib/m365/__tests__/graphClient.browse.test.ts` | **Now** |
| AC-M365DOC-014 | FR-015 | Unit (RTL) | `pmo-portal/pages/project-detail/tabs/__tests__/DocumentsTab.m365-gate.test.tsx` | **Now** |
| AC-M365DOC-020 | FR-020 | Unit (RTL) | `…/__tests__/DocumentsTab.m365-render.test.tsx` | **Now** |
| AC-M365DOC-021 | FR-021/022, NFR-002 | Unit (RTL, `window.open` mock) | same file | **Now** |
| AC-M365DOC-022 | FR-023 | Unit (RTL) | same file | **Now** |
| AC-M365DOC-023 | FR-024/030 | Unit (RTL) | same file | **Now** |
| AC-M365DOC-030 | FR-030, NFR-005 | Unit (RTL) | same file | **Now** |
| AC-M365DOC-031 | FR-031 | Unit (RTL) | `…/__tests__/DocumentsTab.m365-degradation.test.tsx` | **Now** |
| AC-M365DOC-032 | FR-032 | Unit (RTL) | same file | **Now** |
| AC-M365DOC-033 | FR-033 | Unit (RTL) | same file | **Now** |
| AC-M365DOC-034 | FR-035/036, NFR-005 | Unit (RTL) | same file | **Now** |
| AC-M365DOC-035 | FR-036, NFR-005 | Unit (RTL, DOM scan) | same file | **Now** |
| AC-M365DOC-040 | FR-040 | Unit (RTL) | `…/__tests__/DocumentsTab.m365-authz.test.tsx` | **Now** |
| AC-M365DOC-041 | FR-041/042/050 | Unit (assert no invoke + no storage call) | `pmo-portal/src/lib/repositories/__tests__/document.m365-unlink.test.ts` | **Now** |
| AC-M365DOC-042 | FR-044, NFR-001 | Unit (assert no invoke DELETE) | same file | **Now** |
| AC-M365DOC-050 | FR-010/011/021/022/023 | Playwright e2e | `pmo-portal/e2e/AC-M365DOC-050-onedrive-link-journey.spec.ts` | **DEFERRED — owner-gated** (live M365 tenant + admin-consented scopes; not CI-runnable) |

**NFR verification schedule.** NFR-M365DOC-001/002/003 are proven by the unit ACs (AC-010/013/021/041/042)
with Graph/Storage mocked. NFR-M365DOC-004/006 are proven **structurally** by the pgTAP ACs (AC-001/002/003).
NFR-M365DOC-005 is proven by the DOM-scan unit AC (AC-035) across every degraded path. NFR-M365DOC-007 is
proven **negatively** — the spec + the absence of any cron/delta/watermark code path (verified at code
review by `spec-reviewer`/`code-quality-reviewer`). NFR-M365DOC-008 is proven by the audit-emit unit
assertions (AC-010/041). The **live integration** (real Graph browse, real `webUrl` open, real Microsoft
deny for an unauthorized viewer) is verified by the deferred e2e (AC-M365DOC-050) + the mandatory
`security-auditor` gate on the *consumed* runtime (already shipped on the custody edge function).

---

## 6. Non-Goals (explicitly out of scope)

- **No copy/import into Supabase Storage.** Bytes are never copied, mirrored, or cached (NFR-M365DOC-001;
  vision §3.2 rejects this explicitly). The `project-documents` Storage bucket (migration 0025) is **not**
  used by this feature.
- **No in-app preview/browse beyond what linking needs.** Vision §3.2 lists "In-app browse/preview via
  Graph" as a separate, larger item (`Effort: L`) that owns the token lifecycle for sustained preview.
  This feature's browse is the **minimal** picker needed to choose a file to link — not a file viewer.
- **No write-back to OneDrive.** Linking is read-only; the custody scope set is `Files.Read`-family
  (NFR-M365-005). The scope gate in `proxy.ts` rejects write methods without `Files.ReadWrite*`.
- **No background sync / watermark reconciliation / change feed / Graph delta.** `ms_last_verified_at`
  is updated lazily only (NFR-M365DOC-007).
- **No Teams, Outlook/Calendar, Planner, or Entra-group provisioning.** Those are Phases 2–5 of the vision.
- **No org-level service-account connection.** The runtime is per-`(org_id,user_id)`; Phase-1 linking is
  limited to users holding their own active connection (FR-M365DOC-015). A shared/org-level connection is
  a separate, larger item.
- **No new role/permission entity.** Link/unlink reuse `can('create'/'edit'/'delete','document')`
  (FR-M365DOC-040/041/044).
- **No change to the document status workflow or SoD.** `transition_document_status` (0017/0025) and the
  approver-≠-author rule are unchanged (FR-M365DOC-043).
- **No ADR from this spec.** The link/reference model and "Microsoft is the permission authority" are
  already ratified by vision §3.2 + ADR-0058 (Graph-follows-ADR-0055) + ADR-0055 (external adapters). The
  data-model decision (extend `project_documents` vs separate table) is a localized, reversible choice
  justified in FR-M365DOC-001 — not cross-cutting enough to warrant a new ADR.

---

## 7. Dependencies / Owner-gated inputs (must be resolved before the feature works end-to-end)

| Dependency | Source | Status | Owner action |
|---|---|---|---|
| **M365 token-custody runtime deployed with live secrets** — `M365_TOKEN_KEK`, `M365_CLIENT_SECRET`, `M365_CLIENT_ID`, `M365_TENANT_ID`, `M365_REDIRECT_URI` in Supabase secrets; `m365-token-custody` edge fn deployed | PR #333 (merged) + deploy | **Required (deploy)** | Deploy the fn to the target project with the per-client Entra app secrets (ADR-0059 Option C). Without live secrets, `graph_proxy` cannot run. |
| **One proven `active` Microsoft connection** — an entitled org's Admin has completed Connect and the `ms_graph_connections` row is `status='active'` | PR #337 (merged) + a real Connect | **Required (integration)** | The owner/Director verifies a real Connect round-trip in the target environment before declaring this feature shippable. |
| **`m365_integration` entitlement on for the org** (Operator switch) + Admin viewer (config switch) | Phase 0 (shipped) | **Required** | Operator toggles `m365_integration`; org Admin signs in. |
| **Graph scope: `Files.Read` (minimum — personal OneDrive)** | Microsoft Graph permission | **Required** | Already consented by the Phase-1 custody connect (the authorize URL requests `Files.Read offline_access`). Covers `/me/drive/…`. |
| **Graph scope: `Files.Read.All` — REQUIRED for SharePoint / shared OneDrive content** | Microsoft Graph permission (delegated, **admin-consent required**) | **Required for SharePoint linking** | `Files.Read` covers only the *connected user's own* OneDrive. To enumerate **SharePoint document libraries** (`/sites/{id}/drives`, `/drives/{drive-id}/items/…` for shared drives) Microsoft requires `Files.Read.All` (tenant-wide read) and/or `Sites.Read.All`. These are **admin-consented** delegated scopes — add them to the Entra app registration and re-consent. **Flag:** the custody runtime's `scopeCoversPath` gate (proxy.ts) *permits* the `/sites` and `/drives` path prefixes under a `Files.Read`-only grant, so the **gate will not reject** a SharePoint browse — **Microsoft will 403** at call time, surfaced to the FE as `GRAPH_ERROR` (then mapped to the §3.5 "needs additional permissions" UX). The scope must therefore be granted at the Entra layer; do not assume the gate's permissiveness means the call works. |
| **Graph scope: `Sites.Read.All` (optional, for `/sites?search=…` site discovery)** | Microsoft Graph permission (delegated, admin-consent) | **Optional** | Needed only if the browse picker offers a "search SharePoint sites" entry. If Phase-1 browse is OneDrive-rooted only, `Files.Read.All` suffices; add `Sites.Read.All` when SharePoint-site browsing ships. |
| **Migration adding `ms_*` columns + `doc_source` enum + CHECK** (next sequential migration on this branch; runtime migrations 0106–0117 already present) | New migration (this feature's build slice) | **To be built** | Reversible (`drop column`/`drop type`); backfills `source='upload'` for existing `file_path` rows (FR-M365DOC-005). |
| **`security-auditor` sign-off on this feature's consumption of the runtime** | STRIDE on the link/unlink paths + the rendered `webUrl` | **Mandatory gate** | Confirm no token leakage on browse, no open-redirect risk on `ms_web_url` rendering (see §8), and the CHECK invariant is structural. |

**Scope-gate dependency called out explicitly (per the task):** does the feature need a Graph path or
method the current `graph_proxy` scope gate would **reject**? **No.** Every browse this feature issues
is a `GET` under the OneDrive path family — `/me/drive/…`, `/drives/…`, `/sites/…` — and
`scopeCoversPath` in `supabase/functions/m365-token-custody/proxy.ts` accepts exactly that family for
any `GET` under a `Files.Read*` grant. The feature issues **no** write method (`POST`/`PATCH`/`PUT`/
`DELETE`), so the gate's write-needs-`Files.ReadWrite*` branch is never exercised. **The dependency is
therefore Microsoft-side scope, not gate logic:** the gate *permits* `/sites/…` and shared `/drives/…`
browse under a `Files.Read`-only grant, but **Microsoft itself 403s** those calls without
`Files.Read.All` (and `/sites?search=…` without `Sites.Read.All`). The feature relies on Microsoft to
enforce that real scope requirement; if the scopes are not admin-consented, SharePoint browse returns
`GRAPH_ERROR` (Microsoft 403), mapped to the §3.5 scope-insufficient/reconnect UX. This is a **config
dependency on the Entra app**, not a code path the feature can satisfy itself.

---

## 8. Implementation notes (for the `eng-planner` plan + `implementer`/`ui-implementer`)

- **Data slice (migration, next sequential).** `alter table project_documents add column source doc_source,
  add column ms_drive_id text, add column ms_item_id text, add column ms_web_url text, add column
  ms_item_name text, add column ms_linked_by uuid references profiles(id), add column ms_linked_at
  timestamptz, add column ms_last_verified_at timestamptz;` + `create type doc_source as enum
  ('upload','onedrive');` + the CHECK (FR-M365DOC-002) + `update project_documents set source='upload'
  where file_path is not null;` + indexes: `create index on project_documents (ms_drive_id, ms_item_id)
  where ms_item_id is not null;` (forensics/lookup). Reversibility: `drop column …` + `drop type
  doc_source`. **No** new RLS policy, **no** new grant.
- **Repository seam (ADR-0017).** Extend `DocumentRepository` (`pmo-portal/src/lib/repositories/types.ts`)
  + the Supabase implementation (`repositories/document`) with:
  - `linkMicrosoftDocument(docId, ref: { drive_id, item_id, web_url, name }): Promise<void>` — one
    `UPDATE` setting `source='onedrive'` + `ms_*` + `ms_linked_by`/`ms_linked_at`; CHECK-rejected →
    `AppError` (code 23514 preserved).
  - `unlinkMicrosoftDocument(docId): Promise<void>` — one `UPDATE` nulling `source` + all `ms_*`.
  - `create(...)` accepts an optional `source` + `ms_*` block (link-on-create); default unchanged.
  The DAL functions live in `pmo-portal/src/lib/db/documents.ts` (mirroring `updateProjectDocument`);
  the repository wraps them.
- **FE transport.** A new `pmo-portal/src/lib/m365/graphClient.ts` (sibling to `connectClient.ts`)
  exports `browseOneDrive({ path, query? }): Promise<DriveItem[]>` — a thin wrapper over
  `supabase.functions.invoke('m365-token-custody', { body: { action:'graph_proxy', method:'GET',
  path, query } })`, classifying every error via the existing `describeM365Error`. **No** new edge-
  function action; `graph_proxy` already supports this (types.ts `GraphProxyRequest`).
- **FE surface.** Extend `DocumentsTab.tsx` (`pmo-portal/pages/project-detail/tabs/`):
  - the File column renders a `<LinkedDocCell>` (provenance icon + "Open in OneDrive/SharePoint")
    when `source='onedrive'`, else the existing `<FileCell>`;
  - "Add document" gains a source toggle (Upload | OneDrive); the OneDrive path opens a
    `<OneDrivePickerModal>` (browse via `browseOneDrive`, select → `linkMicrosoftDocument` or create);
  - on a Draft row with no source, a "Link from OneDrive" row-menu item (gated by `can('edit')` +
    active connection); on a linked row, "Unlink" (gated by `can('edit')`) + "Open in OneDrive".
- **Connection-state for the tab.** The Documents tab reads the viewer's `connection_status` once
  (reuse `getM365ConnectionStatus()` from `connectClient.ts`) to gate the **browse** affordance only.
  A failed status fetch → treat as "not connected" for the browse affordance (honest), **without**
  hiding any already-linked rows (FR-M365DOC-030).
- **`ms_web_url` rendering — open-redirect hardening.** The `webUrl` originates from Microsoft Graph
  (trusted source) but is rendered into `window.open`. The implementer shall assert the URL scheme is
  `https:` before navigating (defense-in-depth; reject `javascript:`/`data:`/non-http schemes). This
  is a Layer-1 deterministic gate-test (URL-scheme assertion) and a `security-auditor` review point.
- **No Graph write path.** The feature issues only `GET` `graph_proxy` calls (browse). No `POST`/
  `PATCH`/`PUT`/`DELETE` to Graph — unlink/delete are PMO-local writes. The custody scope set
  (`Files.Read` + `offline_access`) is sufficient **for personal-OneDrive linking** and is
  least-privilege (NFR-M365-005); do **not** request `Files.ReadWrite*`. **SharePoint / shared-library
  linking additionally requires `Files.Read.All` (admin-consented) — see §7;** that is an Entra-app
  config change, not a code path.
- **Test strategy (mirrors the custody spec).** Unit (Vitest/RTL) with `supabase.functions.invoke`
  mocked to return canned Graph `value[]` payloads + the `M365ErrorCode` taxonomy; assert both the
  rendered UX and the negative (no token field in the returned object, no invoke on the open path).
  pgTAP for the CHECK + RLS + enum. The deferred e2e (AC-M365DOC-050) is the only cross-stack test;
  it is owner-gated and not CI-runnable.

---

*SPEC-DONE*
