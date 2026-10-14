# Microsoft 365 integration — Phase 1 (OneDrive / SharePoint Document **Linking**) — spec

> **Revision 2026-10-14 (owner)** — issue #1020 widens linking from project documents to
> procurement cases (including overhead purchases without a project) and budget versions; from files
> to files **or folders**; and from OneDrive-rooted browsing to SharePoint sites → libraries → folders
> → files plus OneDrive. Adds an Admin-managed org default library and prefix-based folder suggestions.
> Reuses the two document registers plus one typed budget-link relation (§3.7); no polymorphic parent.
> Microsoft remains the access authority; audit, no copied bytes and read-only scopes remain binding.
> **M1 is satisfied**, per the [live probe §Closure](../spikes/2026-08-18-m365-use-leg-live-probe.md#closure-2026-10-14--ac-m1-closed-on-the-first-client-tenant).
> The historical 2026-07-29 "connect-only / use-leg blocked" header is **superseded**, not a current gate.
> Feature implementation and owner sign-off remain separate from that runtime proof.
>
> **Blocking owner questions (before the affected controlled-document build):**
> - **OQ-M365DOC-001 — folder lifecycle:** approve the proposed rule in FR-M365DOC-057: project
>   folder links are reference-only Draft entries, not issuable/approvable controlled content. A folder
>   has no single file content tag/version; claiming an approved folder would attest to a changing set
>   of files. Procurement folders and budget evidence are references, not new approval objects. If the
>   owner wants controlled folders, a separate snapshot/manifest design is needed, outside this phase.
> - **OQ-M365DOC-002 — approved-version navigation:** ADR-0071 requires approved/latest file actions.
>   The closure proves a 200 version list, **not** a browser-openable version URL. Confirm Microsoft's
>   supported browser navigation (or approve an explicit unavailable action where none exists) before
>   signing off controlled-file delivery. Do not substitute version-content download, copy bytes, or
>   silently open latest as "approved". The target-table decision below does not depend on this answer.
>
> The supplied owner scope is the requirements input for this amendment; the two questions above are
> the remaining stakeholder decisions, not assumed approvals.
>
> ⚠️ **Cite ADRs by filename, not number** — three ADRs share the number 0059 and two share 0058 (a
> known repo-wide collision, see the M365 gotchas in the backlog).

- **Status:** Draft for Director/owner review — **NOT BUILT**.
- **Controlling ADRs (ACCEPTED, binding):** [ADR-0063](../adr/0063-microsoft-365-integration-architecture.md)
  (integration architecture — Graph data follows the ADR-0055 external-adapter pattern; auth≠authz;
  two-switch entitlement), [ADR-0064](../adr/0064-entra-app-registration-topology.md) (Entra app
  topology), [ADR-0060](../adr/0060-microsoft-graph-token-custody.md) (the token-custody runtime this
  feature consumes). **Related:** ADR-0055/0056 (external adapters + watermarks — the shape a Graph
  *data* feature takes), ADR-0017 (repository seam), ADR-0016 (FE authz UX-only / RLS-as-ceiling),
  ADR-0018 (soft-archive), ADR-0019 (security-definer RPC + destructive deletes), ADR-0010 (test
  pyramid), ADR-0001 (org_id seam), [ADR-0071](../adr/0071-linked-document-content-drift.md)
  (controlled-file drift). **Audit authority:** `supabase/migrations/0076_audit_events.sql`, not
  ADR-0076 (that ADR concerns management-pack recognition).
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
- **Scope (amended; project-only/file-only scope superseded):** attach Microsoft Graph `driveItem`
  **file or folder references** to project documents, procurement cases and budget versions; browse
  SharePoint sites/libraries and personal OneDrive via the caller's own `graph_proxy` connection;
  render/open references, with explicit degradation, parent-domain permissions and audit. It does
  **NOT** copy bytes, preview content in-app, create folders, write to Microsoft or background-sync.
- **Reading rule:** unchanged project-file requirements retain their IDs. Explicit amendments below
  supersede only the stated earlier limitations; new FR/AC IDs start after the former maximum `050`.
  Legacy OneDrive-only create/link labels throughout §3/4 are superseded by "from Microsoft 365";
  direct-open labels retain the actual OneDrive/SharePoint provenance.

---

## 1. Context

The token-custody runtime (PR #333) and the Connect flow (PR #337) are merged: an entitled org's
Admin can connect their Microsoft 365 tenant, the `ms_graph_connections` row holds the encrypted
tokens, and `graph_proxy` will decrypt + call Graph + return data on the caller's behalf — the
browser never holds a token (NFR-M365-101/102). Everything above that line is built.

This spec is the first thing **below** that line: a PMO user picks a OneDrive/SharePoint file **or
folder** and *links* it to a project document, procurement case or budget version. The job story is:
*When I am working on a project, purchase or budget version, I want to attach its Microsoft evidence
where the work is recorded, so colleagues can find the current source without duplicating files.*
The non-negotiable model, straight from vision §3.2, is
**link/reference, not copy**:

- We persist **only reference metadata** — drive/item identity, `webUrl`, name, file/folder kind and
  verification metadata — in the existing project/procurement registers or typed budget-link relation
  (§3.7). **No file bytes** are copied into Supabase Storage.
- **Microsoft remains the permission authority.** Opening a linked document navigates the viewer's
  browser to Microsoft, which enforces the viewer's *own* M365 permissions. PMO never re-authorizes
  M365 access. **Superseded:** "token only at link time"; ADR-0071 also requires metadata/version
  checks for controlled project files. Latest/file/folder URL open still uses no PMO token; the
  approved-version path follows OQ-M365DOC-002.
- A linked project **file** co-exists with uploads and retains the document lifecycle/SoD **with
  ADR-0071 drift detection and version limitations**, not unconditional content parity. **Superseded:**
  the former claim of identical content guarantees. Project folders use FR-M365DOC-057's reference-only
  proposal. Procurement/budget links use their parent-domain permissions (FR-M365DOC-059), not
  document-author checks. No new role model.

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

- **NFR-M365DOC-001 (Link/reference ONLY — vision §3.2 rejection; amended).** The feature shall store
  **only reference metadata** on each target's document/link row, including kind and controlled-file
  baseline/version metadata required by ADR-0071. **Superseded:** four-fields/project-row-only limit.
  It shall **never** copy, import, mirror, or cache Microsoft file bytes into Supabase Storage or any
  PMO table. The
  rejected "Import/copy into Supabase Storage" row of vision §3.2 is binding.
- **NFR-M365DOC-002 (Microsoft is the permission authority).** PMO shall **not** re-authorize or
  re-proxy M365 access when a user *opens* a linked document. The stored `webUrl` is opened by the
  viewer's browser directly against Microsoft; Microsoft enforces the viewer's own M365 permissions.
  **Amendment (ADR-0071):** "token custody only for linking" is superseded for lazy controlled-file
  metadata/version checks. Opening **latest** remains a direct browser URL; approved-version navigation
  is subject to OQ-M365DOC-002, never a bytes-copy fallback.
- **NFR-M365DOC-003 (Token never reaches the browser — inherits NFR-M365-101/102).** All Graph reads
  performed during the browse-and-link flow shall go through the existing `graph_proxy` action
  (server-side decrypt → Graph → return data). The browser shall receive **only the resulting
  site/library/driveItem/version metadata**; no Microsoft access/refresh token, `code_verifier` or `oid`
  shall transit or persist client-side.
- **NFR-M365DOC-004 (org_id + RLS consistency; amended).** The system shall reuse project/procurement
  register RLS for reference columns and add org-scoped, parent-checked RLS for typed budget links and
  default-library settings (§3.7). Writes shall use server-stamped org/actor metadata; no polymorphic
  parent IDs or client-supplied `org_id`. **Superseded:** "no new table/policy/grant" as a feature-wide
  prohibition; least-privilege column grants and typed-relation policies are needed.
- **NFR-M365DOC-005 (Graceful degradation — never a raw error/token/oid).** Every degraded state
  (not-connected, stale, revoked, scope-insufficient, item-deleted, item-renamed/moved, no-access,
  no-SharePoint-licence, Graph-error, network) shall render reviewed human copy. A raw Microsoft error
  string, an `oid`, a tenant id, a driveItem id in an error message or any token shall **never** reach
  the DOM (mirrors the
  `M365ConnectionCard` + `describeM365Error` discipline).
- **NFR-M365DOC-006 (Invariant enforced structurally, not by app discipline).** The "a document is
  EITHER an uploaded file OR a Microsoft link OR neither — never both, never a half-ref" invariant
  shall be enforced by a **CHECK constraint at the Postgres boundary**, not merely by FE/repository
  discipline. A future code path that forgets the rule cannot corrupt the row.
- **NFR-M365DOC-007 (No background sync / watermark reconciliation).** There shall be **no**
  scheduled job, no change-feed, no Graph delta query, and no watermark tracking for linked items.
  **Superseded by ADR-0071:** "only a side-effect of browse". Verification shall be lazy and
  user-triggered: browse may refresh reference metadata; display may re-check stale controlled-file
  metadata after 24h (§3.7). No background process or continuous folder-content scan. (Vision §3.2
  lists in-app browse/preview and background sync as separate, larger items; both are out of scope.)
- **NFR-M365DOC-008 (Audit without secret leakage).** Link and unlink shall emit `audit_events` rows
  with metadata only (`org_id`, `actor_id`, `document_id`, `ms_drive_id`, `ms_item_id` — these are
  runtime reference identifiers, not public-repository examples) — never a token, URL query,
  raw Microsoft error, item name, subject or path. The same rule applies to all target families and
  default-library changes (FR-M365DOC-060); no real identifiers/locations belong in this spec.
- **NFR-M365DOC-009 (Bounded accessible picker).** The picker shall request at most 100 entries per
  page, render only loaded pages and offer explicit load-more; it shall debounce typed search by
  300 ms, cancel/ignore superseded results and show loading feedback within 100 ms of input. The
  prefix-suggestion pass shall make at most three paged search requests before offering manual browse.
  The modal shall support keyboard navigation, labelled file/folder selection, focus return and
  WCAG AA; empty/error states shall not trap focus or block closing.

---

## 3. Functional requirements

### 3.1 Data model — extend `project_documents` with nullable Graph reference columns

> **Amendment:** FR-M365DOC-001/005 remain the project-file baseline. Their project-only design
> rationale is superseded **as the whole-feature model** by §3.7; project rows are still reused.
> All reference rows additionally store `ms_item_kind` (`file`/`folder`, FR-M365DOC-053).

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
    the item still resolves (FR-M365DOC-014). **Superseded:** browse-only; controlled-file checks also
    follow ADR-0071 (FR-M365DOC-063). Renamed from "synced" deliberately — "sync" implies the
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

- **FR-M365DOC-002 (State-driven — the either/or invariant, structurally enforced; amended).** While
  a `project_documents` row exists, the system shall enforce the following states at the Postgres
  boundary. **Superseded:** checks of just `ms_item_id` did not describe all nullable reference fields;
  every non-Microsoft state shall null **all** `ms_*` source/baseline fields (FR-M365DOC-053):
  - `source IS NULL` **AND** `file_path IS NULL` **AND** `ms_item_id IS NULL` — metadata-only;
  - `source = 'upload'` **AND** `file_path IS NOT NULL` **AND** `ms_item_id IS NULL` **AND**
    `ms_drive_id IS NULL` — an uploaded Supabase Storage file;
  - `source = 'onedrive'` **AND** `file_path IS NULL` **AND** `ms_item_id IS NOT NULL` **AND**
    `ms_drive_id IS NOT NULL` **AND** `ms_web_url IS NOT NULL` — a Microsoft link.
  Any other combination (both `file_path` and `ms_item_id` set; `source='onedrive'` without an
  `ms_item_id`; `source='upload'` with an `ms_item_id`; etc.) shall be **rejected** (CHECK violation,
  errcode `23514`) — including by the existing `confirmUpload` path (an upload to a linked row is
  structurally impossible) and by `linkMicrosoftDocument` (FR-M365DOC-011).

- **FR-M365DOC-003 (Ubiquitous — project RLS reuse; amended).** The Graph reference columns shall
  remain governed by existing project-document RLS and parent-org checks. **Superseded:** "no new
  grant"; the migration shall extend only required source/reference column privileges, retaining
  server-only workflow/drift writes and existing role/active-membership restrictions. A client JWT
  shall not be able to write `ms_*` columns outside its org or when its role lacks MASTER_DATA.

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

- **FR-M365DOC-010 (Event-driven — browse via `graph_proxy`; amended).** When a user opens the
  "Link from Microsoft 365" affordance (the former "Link from OneDrive" label is superseded), the FE
  shall enumerate candidate items subject to §3.5 permissions by calling the existing
  `graph_proxy` action on the `m365-token-custody` edge function with `method: 'GET'` and a OneDrive
  path family permitted by the custody runtime's scope gate (e.g. `/me/drive/root/children`,
  `/me/drive/items/{id}/children`, `/drives/{drive-id}/items/{id}/children`,
  `/me/drive/root/search(q='{term}')`). The FE shall receive only item metadata and paging metadata;
  **superseded:** a bare `value[]` result that discards pagination.
  the browser shall never hold a Microsoft token (NFR-M365DOC-003). The FE transport (a new
  `browseOneDrive()` helper alongside `connectClient.ts`'s existing invoke wrappers) shall classify
  every error via the existing `describeM365Error` taxonomy.

- **FR-M365DOC-011 (Event-driven — persist reference only).** When the user selects a driveItem, the
  FE shall persist **only the reference** by calling `repositories.document.linkMicrosoftDocument(
  docId, { drive_id, item_id, web_url, name, item_kind })` — a normal Supabase `UPDATE` of the
  `ms_*` columns +
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
  **Superseded:** a CHECK alone rejects overwriting an existing source. The system shall reject
  already-sourced rows through the atomic existing-source guard (FR-M365DOC-062), retain the CHECK
  for incompatible values and surface refusals via `classifyMutationError`.

- **FR-M365DOC-014 (Where — lazy verification, no background sync; amended).** Where a browse
  returns a drive/item identity already linked in the current parent, the system shall allow an
  authorized server refresh of cached name/URL and verification metadata. Matching shall use **both**
  drive and item IDs. **Superseded:** optional browser timestamp writes and browse as the "only update";
  controlled-file verification follows ADR-0071 (FR-M365DOC-063). Browser name/URL refresh shall not
  write baseline/drift/check timestamps; controlled-file `ms_last_verified_at` shall advance only
  when content is also verified, not merely a successful name lookup. No scheduled reconcile/delta.

- **FR-M365DOC-015 (State-driven — the linker must hold an active connection).** While the
  `graph_proxy` action resolves the **caller's own** `(org_id, user_id)` connection (`ms_graph_connections`
  is `unique(org_id, user_id)`, migration 0106), the browse step shall succeed only when the caller
  has an `active` connection of their own. The FE "Link from OneDrive" affordance shall therefore be
  gated on the viewer's `connection_status` (`status='active'`); a viewer without an active connection
  sees the degradation UX (§3.4) instead of the browser. **Superseded:** the historical Admin-only
  connection limitation; ADR-0063's corrected personal-connection model is member-of-entitled-org,
  with Microsoft tenant consent separate. Parent edit rights still gate linking. This revision does
  not redesign onboarding (#1017) or introduce a shared service-account connection.

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
  connection is required for new linking **and metadata/version verification**, never for list display
  or latest/direct open. **Superseded:** "only to link" in light of ADR-0071.

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
  Where a lazy check has a confirmed safe item-not-found classification, the system may show a
  subdued *"Microsoft could not find this item"* hint and shall not advance verification or auto-unlink.
  **Superseded:** assuming the client receives an item-specific Graph 404; the current opaque envelope
  requires generic fallback (§3.8), not an invented deletion diagnosis.

- **FR-M365DOC-034 (Event-driven — item renamed in OneDrive).** When the Microsoft item is renamed,
  the system shall retain drive/item identity and refresh cached name and `webUrl` on a successful
  metadata read. **Superseded:** unconditional URL stability; cross-drive moves may require explicit
  relinking, and a stale URL shall not be treated as proof that an item was deleted. The row's
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
  ms_last_verified_at=NULL` on the row, reverting it to metadata-only. **Amendment:** the earlier
  explicit field list is superseded by clearing the **entire** source/ref block, including kind and
  controlled-file baseline/version/drift fields; guards/audit follow FR-M365DOC-062/060. Ordinary
  register metadata and workflow history are preserved.

- **FR-M365DOC-042 (Ubiquitous — unlink is non-destructive to the Microsoft file).** Unlinking shall
  make **no** Graph call — in particular **no** `DELETE` to the driveItem. The Microsoft file is
  entirely untouched; only PMO's *reference* to it is dropped. (This is the whole point of the link
  model — say it explicitly.) The feature shall retain read-only
  `Files.Read`/`Files.Read.All`/`Sites.Read.All` consent and issue only Graph GETs (FR-M365DOC-061).
  **Superseded:** personal-OneDrive-only scope description.

- **FR-M365DOC-043 (Ubiquitous — SoD unchanged; EARS clarified).** The system shall retain existing
  approver-≠-author enforcement for controlled project files, whether linked or uploaded, and shall
  not make link/unlink a new segregation-of-duties axis. **Superseded for folder references:** generic
  controlled-document parity; FR-M365DOC-057 is pending owner resolution.

- **FR-M365DOC-044 (Event-driven — delete drops the reference only; EARS clarified).** When an
  Admin deletes a linked document row (`can('delete', 'document')`), the system shall remove only the
  row/reference and shall issue no Microsoft DELETE. Existing 23503 FK-block semantics for referenced
  rows shall remain unchanged. Files and folders remain untouched (FR-M365DOC-042).

### 3.6 Audit (migration `0076_audit_events.sql`)

- **FR-M365DOC-050 (Event-driven — link/unlink audit; amended).** When a project link/unlink commits,
  the system shall emit an `audit_events` row in the same database transaction through a server-side
  mutation trigger/RPC calling internal `log_audit`. **Superseded:** repository/client invocation of
  that helper; the repository initiates the mutation, not a separate audit write. Actions are
  `'project_document.m365_linked'` / `'project_document.m365_unlinked'`,
  with `org_id`, `actor_id`, `entity_id` = document id, and `detail` JSONB carrying `ms_drive_id`,
  `ms_item_id` and `ms_item_kind`. No URL, name, path, token, identity-claim detail or Graph error
  string. Unlink captures the **old** reference before nulling it (FR-M365DOC-060).

### 3.7 Widened targets, item kinds and library picker (2026-10-14)

**Data-model decision (eng-planner review).** Reuse `project_documents` and
`procurement_documents`; add one small **typed** `budget_version_document_links` relation. The latter
has one required `budget_version_id` FK, not a nullable collection of parent IDs. Each target accepts
zero or more reference rows, one driveItem per row. A procurement link belongs to the **case**, not a
quote/order/receipt/invoice record, and so remains discoverable through the whole purchase lifecycle.

| Target | Storage / cardinality | Reason / authorization boundary |
|---|---|---|
| Project document | `project_documents`, one source per document, many documents per project | Existing document register, author-scoped edit and controlled-file revision workflow |
| Procurement case | `procurement_documents`, one reference per entry, many entries per case | Already the case's document register; `link` is already a URL field; parent FK requires no project |
| Budget version | New `budget_version_document_links`, many references per version | Simple FK to the version; budget writer/Draft rules, not project-document author/status rules |
| Org default library | New singleton `org_m365_document_settings`, PK/FK `org_id` | Small shared setting; Admin-managed, members read in-org; not a shared Microsoft connection |

**Rejected alternatives:** (1) one polymorphic `(target_type, target_id)` link table: SQL cannot give
`target_id` a real FK to three parent types, and RLS would need branching joins; it also duplicates the
two registers. (2) budget refs on `project_documents` with optional `budget_version_id`: fewer new
relations but two parent authorities, a same-project validation trigger and document-author/status
semantics on budget evidence. A Finance budget writer would then depend on unrelated document
authorship, or document writers could bypass budget Draft rules. One narrow typed relation is smaller
in **policy/workflow complexity**, not merely table count. No nullable project is invented for overhead
procurements, and no project ID is duplicated on budget-link rows (derive it from the version).

**Deciding artifacts:** migration `0001_init_schema.sql` defines nullable `procurements.project_id`,
required `procurement_documents.procurement_id`, the existing plain `link text`, and required
`budget_versions.project_id`. The migration-tree search for subsequent procurement alterations found
no change making `project_id` mandatory; routing migrations also retain overhead handling. These are
source-schema observations, not a claim about a deployed database. Permission behavior is decided by
`pmo-portal/src/auth/policy.ts` plus call sites in `ProcurementDetails.tsx` / `ProjectBudget.tsx`; the
build must verify effective grants/policies on its migrated local DB, not infer them from policy names.

- **FR-M365DOC-051 (Ubiquitous — procurement reuse, overhead included).** The system shall extend
  `procurement_documents` with `source`, the reference identity/name/kind/linker/time fields from
  FR-M365DOC-001/053, reusing **`link` as the canonical Graph `webUrl`** rather than adding a duplicate
  `ms_web_url`. It shall support multiple file/folder rows per procurement, including when the case's
  `project_id IS NULL`. A new entry shall use `type='Microsoft reference'` (plain existing text),
  default document status Draft and optional ordinary reference/date metadata; it shall not require
  a purchase stage, project document or separate quote/order/invoice attachment. Existing `link`
  values and rows shall be preserved with `source IS NULL` and null `ms_*`; legacy plain URLs remain
  supported and are not automatically reclassified as Graph references.

- **FR-M365DOC-052 (Ubiquitous — typed budget links).** The system shall store budget references in
  `budget_version_document_links` with `id`, server-stamped `org_id`, required
  `budget_version_id references budget_versions(id) on delete cascade`, and complete Graph reference
  metadata (`ms_web_url` plus FR-M365DOC-053 fields). Each row shall be a Microsoft reference only,
  with no upload source or document-status enum. It shall allow zero or more rows per version; reads
  shall follow the in-org active-member parent-version visibility, and mutations shall require the
  existing budget writer role set and **Draft** parent version, enforced server-side. The parent FK
  shall be immutable after insert; cloning a budget shall not silently copy links. Active/Archived
  versions retain visible/openable links; adding/removing evidence does not edit budget amounts,
  activate a version, dispatch ERP work or alter the budget-editor/activation SoD rules.

- **FR-M365DOC-053 (State-driven — file/folder kind and complete references).** While a Microsoft
  reference exists on any target, the system shall require non-empty drive/item identity, HTTPS
  browser URL, item name, `ms_item_kind text` checked as `IN ('file','folder')`, server-stamped linker
  and link time.
  The kind shall be taken from the Graph `file`/`folder` facets, not the extension/name; missing or
  ambiguous facets shall refuse selection. Project/procurement reference columns shall be nullable
  for legacy rows, but CHECKs shall accept only complete refs or all-null refs. Project Microsoft
  refs require `source='onedrive'` and null `file_path`; non-Microsoft project states shall null all
  `ms_*`. Procurement refs require `source='onedrive'` and non-empty `link`; `source IS NULL` permits
  a legacy plain `link` with all `ms_*` null, and `source='upload'` shall be rejected there. Budget
  reference fields are required. `ms_last_verified_at` may be null. Project-only content baseline,
  pinned version and drift fields (FR-M365DOC-063) shall be null for folders/non-Microsoft sources.
  Invalid combinations shall fail at the DB boundary, not just in the picker.

- **FR-M365DOC-054 (Event-driven — SharePoint and OneDrive browse).** When an authorized connected
  user opens the shared Microsoft picker, the system shall offer SharePoint **sites → document
  libraries → folders → files**, plus the user's OneDrive, through GET `graph_proxy`. Site discovery
  shall use `path:'/sites', query:{search:'*'}` (or a typed search term), libraries
  `/sites/{site-id}/drives`, roots `/drives/{drive-id}/root/children`, folder children
  `/drives/{drive-id}/items/{item-id}/children`, and personal `/me/drive` / `/me/drive/root/children` /
  `/me/drive/items/{item-id}/children`. It shall show breadcrumbs and distinguish selecting a folder
  to link from entering that folder to browse; files and folders are selectable. Graph query params
  shall use the proxy's **separate `query` object**, not `?` embedded in `path`. Site browsing requires
  delegated admin-consented `Sites.Read.All`; OneDrive keeps the existing read scopes. Only entries
  returned under the **caller's own** Microsoft identity may be offered; a default is not access.

- **FR-M365DOC-055 (Event-driven — org default document library).** When an Admin with
  `can('manage','integration', ctx)` chooses a SharePoint library using their own active connection,
  the system shall store its site/drive identity and display labels in
  `org_m365_document_settings` as the org's default document library. The row shall contain either
  the complete default tuple or none, with `updated_by`/`updated_at` stamped server-side; clearing
  the setting shall be supported. RLS shall permit only active in-org Admin writes and active in-org
  member reads; no client shall send `org_id`. When opening the picker, it shall open the default
  library before personal OneDrive unless a contextual folder suggestion is selected. With no default
  it shall show the site/OneDrive chooser. **Decision:** per-user remembered last location is optional
  in principle but **not implemented in this phase**; context/default precedence is deterministic.

- **FR-M365DOC-056 (Event-driven — recommended folder conventions and prefix suggestions).** When
  linking from a project or procurement case with a code/request number and a default library, the
  system shall perform a best-effort name search and offer matching folders before opening the
  default root. The recommended layouts are **`Projects/<project code> <name>/`** and
  **`Procurement/<year>/<request number> <subject>/`**, with procurement year taken from case creation
  date in UTC. Search shall use Graph `/drives/{drive-id}/root/search(q='{escaped-term}')`, then filter
  returned **folder** names by case-insensitive code/request-number prefix and the relevant convention
  path within that library. Search is substring-based upstream; a prefix is checked locally, not
  promised by unsupported Graph filtering. Missing code, no accessible match, search refusal or the
  three-page cap shall fall back to the default root with manual browse; a failed search is not proof
  a folder does not exist. Multiple matches shall be offered with breadcrumb context and require an
  explicit choice; no suggestion shall auto-persist a link. A budget-version picker uses the default
  root, with no inferred project suggestion in this phase. The SHOULD recommendation to offer a
  matching folder is thus a bounded best-effort search, not a hard folder-layout prerequisite.

- **FR-M365DOC-057 (Event-driven — folder reference behavior; proposed pending OQ-M365DOC-001).**
  When a user opens a folder reference, the system shall open its stored Graph `webUrl` in Microsoft
  ("Open folder in SharePoint" for a SharePoint library; "Open folder in OneDrive" for personal
  OneDrive), directly in a new tab with `noopener,noreferrer`. It shall render a Folder indicator and
  shall not offer file version/content-drift actions, enumerate descendants on open or claim the
  folder contents are approved. Project folder entries shall remain reference-only Draft entries;
  the server shall reject issuing/approving them with a reviewed explanation. Procurement folders
  shall be case evidence and budget folders version evidence, not controlled-document snapshots.
  **Superseded for folders:** blanket project-file workflow parity in FR-M365DOC-020/043 and §6.

- **FR-M365DOC-058 (State-driven — degradation across all targets and kinds).** While an item is
  moved/renamed, deleted, inaccessible, the caller connection is absent/stale/revoked, consent is
  insufficient or SharePoint licensing is unavailable, the system shall retain the reference and
  direct-open action for both files and folders. Successful metadata reads may refresh name/URL;
  cross-drive identity changes require explicit relinking. It shall use the error table below,
  never infer a 404 from an empty search, auto-unlink or use another user's token. Connection errors
  block browse/checks, not direct open. Microsoft itself handles open-time denial/login/not-found.
  Where upstream failure reasons are unavailable to the client, the system shall show the generic
  safe hint, not invent a licence/deletion diagnosis or expose upstream text.

- **FR-M365DOC-059 (Ubiquitous — parent-domain authorization, no new entity).** The system shall
  gate project linking/unlinking with existing `document.create/edit` and author/Admin context;
  procurement case evidence with existing **`procDoc.create/edit`**; and budget linking/unlinking
  with existing **`budgetLine.edit` plus parent Draft state**, using `can()` on the real JWT role.
  `procDoc` is the shipped procurement-document edit projection (Admin/Executive/PM/Finance), not a
  new permission entity: `procurement.edit` alone includes requesters and its Draft/Rejected header
  call-site rules would prevent case evidence across the purchase lifecycle. The latter shall not
  be transplanted to evidence linking. Likewise `budgetVersion` currently models transition, not
  edit; reuse the budget page's `budgetLine.edit` writer gate, not an invented `budgetVersion.edit`.
  Server RLS/guards shall remain the mutation authority and check active membership, same-org typed
  parent and target lifecycle. UI shall be view-only during impersonation. Readable references may
  be opened without edit rights or a PMO-M365 connection; Microsoft alone enforces file/folder access.

- **FR-M365DOC-060 (Event-driven — transactional audit for every target and setting).** When a
  reference is linked/unlinked or the default library changes, the system shall emit one success
  event in the **same DB transaction** via internal `log_audit`, with actions
  `project_document.m365_linked/unlinked`, `procurement_document.m365_linked/unlinked`,
  `budget_version_document_link.m365_linked/unlinked`, or `m365.default_library_changed`.
  Each reference event shall record server-derived org/actor, link-row `entity_id`, typed parent,
  drive/item identity and kind; unlink shall capture old values. Settings events shall record old/new
  library identity only. No URL, names, paths, query, secret or upstream error shall be audited.
  Rollback/refusal shall emit no success event; audit rows/helper shall remain non-client-writable.

- **FR-M365DOC-061 (Ubiquitous — read-only scopes and no folder creation).** The feature shall issue
  only Graph GET metadata/site/library/item/version/search reads, retaining the existing delegated
  `Files.Read`, `Files.Read.All`, `Sites.Read.All` read scopes. It shall request no write scope and
  shall not create, rename, move, upload, copy or delete Microsoft files/folders. Link/unlink/delete
  are PMO-local reference mutations; no file/version bytes shall be downloaded into or cached by PMO.
  Recommended folders are created/managed in Microsoft by the organization, not this phase.

- **FR-M365DOC-062 (Event-driven — atomic mutations and legacy preservation).** When a caller links
  an existing register row, the system shall atomically verify permitted parent/role/lifecycle and
  that the row has no source, no existing upload/ref and (for procurement) no legacy URL. It shall
  refuse overwriting any existing source (23514, mapped as a source collision); explicitly
  unlink/clear first, then select a new ref.
  New reference creation shall persist all fields in one insert. Unlink shall clear the complete
  source/ref block (and procurement `link`), keeping the register's ordinary metadata/history;
  budget unlink shall remove only the typed link row after capturing its audit metadata. The server
  shall stamp actor/time and preserve parent identity; concurrent competing links shall not silently
  overwrite one another. No financial transition or Microsoft mutation shall be part of these writes.

- **FR-M365DOC-063 (Conditional — controlled project files retain ADR-0071).** While a linked project
  **file** is Issued or above, when its metadata is displayed and verification is older than 24h
  (or has never succeeded), the
  system shall lazily re-check its content tag against the server-recorded Draft→Issued baseline,
  with a pinned Microsoft version ID. It shall use `cTag`, not `eTag`, preserve lifecycle status and
  render clean/drifted/not-verified-as-of states everywhere the document appears. Only the server
  performing the Graph read shall write baseline/drift/verification fields; unavailable content tags
  shall never mean "clean". The proposed project columns are `ms_content_tag_at_issue text`,
  `ms_version_id_at_issue text`, `ms_drift_state text` (clean/drifted/not_verified), plus
  `ms_last_verified_at`; all are nullable until the relevant check/freeze. Draft files cannot drift.
  Files on **every target** shall retain latest/direct-open and metadata version-list behavior;
  only controlled project files have pinned-approved actions. Approved-version navigation
  follows OQ-M365DOC-002, never latest mislabeled as approved. Missing/pruned versions, disabled
  versioning and connection/access errors shall show an explicit unavailable reason. The existing
  new-revision affordance and approver≠author rule remain; folder links and procurement/budget
  evidence do not acquire controlled-file approval claims. **Batching integration decision:** ADR-0071
  calls for Graph `$batch`; the read-only transport adaptation must be planned separately before
  that path is used (outer batch POST is not permission to send nested Graph writes). This feature's
  picker shall not add a Graph write capability to satisfy a performance optimization.

### 3.8 Error handling (applies to every target, file and folder)

| Condition | Reviewed user-facing response / recovery | Reference and open |
|---|---|---|
| No connection | Connect Microsoft 365 first; route to the existing setup flow | Retain; direct open enabled |
| Stale/revoked | Connection expired; reconnect to link or verify | Retain; direct open enabled |
| Missing consent | Additional permissions needed; ask Microsoft admin / reconnect after consent | Retain; direct open enabled |
| Item moved/renamed, read succeeds | Refresh cached name/URL, not PMO title or typed parent | Same drive/item identity; explicit relink for cross-drive move |
| Confirmed item not found | Microsoft could not find this item; retry or explicitly relink/unlink | Never auto-unlink; Microsoft handles URL outcome |
| No Microsoft access | Access depends on your Microsoft permissions; request access in Microsoft | Never suggest PMO can grant it; open remains enabled |
| Confirmed no SharePoint licence | Your Microsoft plan needs SharePoint Online; ask your Microsoft admin | No repeated reconnect loop; stored URLs retained |
| Opaque upstream failure (including unclassified licence/access/not-found) | Microsoft could not load this location. Check access and SharePoint availability with your Microsoft admin, or retry | Do not claim a specific cause; existing links unaffected |
| Default library inaccessible/removed | Default library is unavailable; choose another accessible location; Admin can change default | Do not change org setting automatically |
| Empty library / no prefix match | No items/matching folder found; browse the default root or another location | No folder creation; no reference mutation |
| Network/rate-limit/server failure | Could not load Microsoft items; retry, retaining selection/breadcrumbs | No automatic repeated paging or loss of selection |
| Source collision / competing link | This entry already has a file or link; refresh and clear explicitly before relinking | Keep committed source; no false audit success |
| Invalid metadata/URL/kind or denied DB mutation | Cannot link this item / you cannot change this record; use classified safe copy | No partial row, raw identifier or upstream message |
| Approved version unavailable | Approved version unavailable (reviewed reason); latest is separately labelled | Never silently redirect the approved action to latest |

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
> every other AC is unit (Vitest/RTL, Graph mocked) or pgTAP (DB constraints/RLS), designed to run in
> CI once implemented — **not claimed passing today**. Legacy OneDrive-only affordance names in
> AC-010–042 are **superseded labels**: use "Link from Microsoft 365" / "from Microsoft 365" for the
> shared picker; direct-open labels still reflect file/folder and Microsoft location.

### 4.1 Data model + invariants (pgTAP)

**AC-M365DOC-001 (source enum + columns exist, nullable — pgTAP).**
Given the migrated `project_documents` table,
When its columns are inspected,
Then `source` is a nullable `doc_source` enum (`'upload'|'onedrive'`), `ms_drive_id`/`ms_item_id`/
`ms_web_url`/`ms_item_name` are nullable `text`, `ms_linked_by` is nullable `uuid`, and
`ms_linked_at`/`ms_last_verified_at` are nullable `timestamptz`, with nullable kind and project-file
baseline/version/drift fields from FR-M365DOC-053/063; and every pre-existing row's
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
Then neither changes the row (policy-filtered zero rows or an explicit permission refusal); the
new columns remain under parent-org/role RLS with only required column grants. **Superseded:**
requiring every RLS UPDATE denial to return 42501, and the blanket no-grant-change claim. *(Owns FR-M365DOC-003, FR-M365DOC-004, NFR-M365DOC-004.)*

### 4.2 Repository + linking write (unit — Vitest, Supabase mocked)

**AC-M365DOC-010 (linkMicrosoftDocument persists reference only, no bytes — unit).**
Given a Draft document row with `source IS NULL, file_path IS NULL`,
When `repositories.document.linkMicrosoftDocument(docId, { drive_id, item_id, web_url, name, item_kind })` is
called,
Then it issues exactly one Supabase `UPDATE project_documents` setting `source='onedrive'` and the
`ms_*` columns + `ms_linked_by`/`ms_linked_at`, it issues **no** `storage` upload and **no** edge-
function invoke or separate client audit RPC. **Superseded:** unit mock as proof of audit emission;
AC-M365DOC-061 owns the transactional audit proof. *(Owns FR-M365DOC-011, NFR-M365DOC-001.)*

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
Given a linked document and a viewer whose connection is `active`, `stale`, `revoked`, or absent,
When the Documents surface renders,
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
Given a linked item with a confirmed safe not-found classification, or an opaque failed lazy read,
**superseding** the historical assumption of a client-visible item-specific Graph 404,
When the Documents tab renders,
Then the row is still shown with the confirmed not-found hint or generic safe failure copy as
appropriate,
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

**AC-M365DOC-040 (link gated by can('create'/'edit','document') — unit, RTL; G/W/T clarified).**
Given viewers with differing real JWT roles, authorship and an active connection,
When the project Documents link/create affordances render,
Then only MASTER_DATA roles see create, existing Draft edit requires author-or-Admin, read-only and
non-author non-Admin viewers cannot link on that row, and no new permission entity is consulted.
*(Owns FR-M365DOC-040.)*

**AC-M365DOC-041 (unlink gated by can('edit','document'); nulls `ms_*` — unit).**
Given a linked document and an author (or Admin) viewer,
When `repositories.document.unlinkMicrosoftDocument(docId)` is called,
Then it issues one `UPDATE` nulling `source` + every `ms_*` column (reverting to metadata-only),
and issues **no** `graph_proxy`, separate audit-helper or Supabase Storage call. **Superseded:** unit
proof of actual audit emission; AC-M365DOC-061 owns that DB contract. *(Owns FR-M365DOC-041/042.)*

**AC-M365DOC-042 (Admin delete drops the reference; Microsoft file untouched — unit).**
Given a linked document and an Admin viewer,
When `repositories.document.delete(docId)` is called,
Then the row (and its `ms_*` reference) is deleted, **no** `graph_proxy` `DELETE` is issued, and the
Microsoft driveItem is not touched. *(Owns FR-M365DOC-044, NFR-M365DOC-001.)*

### 4.6 The cross-stack journey (DEFERRED — owner-gated)

**AC-M365DOC-050 (real linking across all targets — e2e, DEFERRED; amended).**
Given an entitled org, a consenting member with their own active read-only Microsoft connection, a
SharePoint default library, and authorized project, overhead procurement and Draft budget version
(with OQ-M365DOC-001/002 resolved for controlled behavior),
When the member links a file to the project, a folder to the **project-less procurement case** and a
file/folder to the budget through the site/library picker, reloads each parent and opens the refs,
Then each ref persists against its typed parent, file/folder open navigates to Microsoft with no
copied bytes, procurement links survive purchase-stage navigation, and a second in-org viewer can
see/open references without a PMO-M365 connection while Microsoft permits/denies according to that
viewer's own access. *(Owns live cross-stack FR-M365DOC-010/011/021/022/023/051/052/054/057.
**Superseded:** project-file-only journey and M1 still-blocked premise. M1 is satisfied; this feature
journey is still owner-gated/live, not CI-runnable or already passed. Record permitted and denied
Microsoft outcomes privately.)*

### 4.7 Widened scope acceptance (new IDs after `050`)

**AC-M365DOC-051 (procurement reuse, overhead and legacy preservation — pgTAP).**
Given migrated registers with plain URLs and same-org cases with and without a project,
When a permitted writer adds multiple file/folder reference rows and legacy rows are inspected,
Then `procurement_id` is the parent, `link` is the canonical URL with no duplicate `ms_web_url`,
overhead needs no project document, stage data is unchanged and legacy URLs retain null Graph
source/refs; cross-org parent refs and inactive/read-only mutations cannot persist changes under
procurement-register RLS. *(Owns FR-M365DOC-051/059, NFR-M365DOC-004.)*

**AC-M365DOC-052 (typed budget relation and parent authorization — pgTAP).**
Given Draft/Active/Archived budget versions in two orgs and active/inactive members,
When link rows are read/mutated with permitted/denied JWTs or wrong-org/absent parents,
Then same-org parent-readable refs can be read, only budget writers mutate Draft refs, denied writes
persist nothing, parent reassignment fails and Active/Archived refs remain readable without a
project-document author requirement. *(Owns FR-M365DOC-052, NFR-M365DOC-004.)*

**AC-M365DOC-053 (complete kind/source contract across targets — pgTAP).**
Given each reference storage relation,
When valid file/folder refs, partial/empty refs, invalid kinds, upload+Graph collisions, orphan `ms_*`,
procurement upload sources and folder content baselines are submitted,
Then valid complete refs and legacy states are accepted, invalid combinations fail at the DB
boundary, and existing uploads/plain URLs are preserved. *(Owns FR-M365DOC-053.)*

**AC-M365DOC-054 (sites → libraries → folders → files plus OneDrive — unit, RTL/transport).**
Given synthetic Graph metadata and a connected caller,
When users choose a site/library, enter a folder, select a file or the folder itself and switch to
OneDrive,
Then GETs use §3.7 paths with separate queries, the shipped scope gate accepts the required read
paths under the current combined consent contract, breadcrumbs/facets are honored, entering a folder
does not link it and no token reaches picker state. The test imports the real scope gate for those
path assertions, including library and shared-drive item paths. *(Owns FR-M365DOC-054.)*

**AC-M365DOC-055 (Admin-only, org-scoped default setting — pgTAP).**
Given two orgs, active Admin/member and inactive actors and a complete default tuple,
When actors read/set/clear defaults or forge org/actor/partial fields,
Then only active in-org Admin writes succeed, active members read only their org's setting, stamps
are server-derived, partial tuples fail and clearing works. *(Owns FR-M365DOC-055's persistence,
NFR-M365DOC-004.)*

**AC-M365DOC-056 (default precedence and unavailable default — unit, RTL).**
Given an org default or none and callers with differing Microsoft access,
When the picker opens or the configured library read fails,
Then it opens the accessible default, otherwise shows safe unavailability and manual site/OneDrive
choice (or the chooser with no default), never borrows the Admin's token or changes the setting, and
no remembered-last-location overrides it. *(Owns FR-M365DOC-055's picker behavior.)*

**AC-M365DOC-057 (prefix convention, suggestions and fallback — unit, RTL).**
Given project/request codes and Graph results with matching/nonmatching folder/file names, differing
paths, zero/multiple matches and an apostrophe in a term,
When the contextual picker performs its bounded name search,
Then it encodes terms and filters folder-name prefixes in `Projects/` or
`Procurement/<UTC creation year>/`, offers contextual matches without auto-linking and falls back to
default root on missing code/no match/failure/page cap; budget opens default root and no Microsoft
folder is created. *(Owns FR-M365DOC-056.)*

**AC-M365DOC-058 (folder open, not file-version/approval UX — unit, RTL).**
Given project/procurement/budget folder refs with valid HTTPS URLs,
When the cell renders and a user opens the folder,
Then Folder/provenance appears, the stored URL opens with `noopener,noreferrer` and no proxy/recursive
read, file-version/drift/approved-content actions are absent and project folders show reference-only
copy without Issue/Approve controls. *(Owns FR-M365DOC-057's UX proposal; pending OQ-M365DOC-001.)*

**AC-M365DOC-059 (both kinds/all parents degradation matrix — unit, RTL).**
Given both kinds on all three parents and every §3.8 condition, including moved/deleted/no-access/
no-licence, opaque upstream failures and stale/revoked connections,
When lists/pickers/check responses render and users directly open existing refs,
Then reviewed safe copy reflects only known facts, no raw upstream details/identifiers render, refs
remain visible/openable without auto-unlink, connection failures affect browse/checks only and no
borrowed token or version-content fallback is used. *(Owns FR-M365DOC-058, NFR-M365DOC-005.)*

**AC-M365DOC-060 (parent permission matrix, no new entity — unit, RTL).**
Given each real role, document authorship, procurement stages including overhead, budget lifecycle
states and impersonation,
When mutation/default controls render,
Then document create/edit, procDoc create/edit, budgetLine edit plus Draft and integration manage
respectively govern them; procurement header-edit restrictions are not transplanted to evidence,
denied/view-only users get no mutations and direct open requires no edit right. *(Owns FR-M365DOC-059.)*

**AC-M365DOC-061 (server audit across targets/settings and rollback — pgTAP).**
Given authorized link/unlink/default writes and transactions rolled back or refused,
When mutations commit or fail,
Then each commit emits exactly one correctly typed event with server actor/org, old unlink identity
and allowlisted metadata, failed writes emit no success event and clients cannot forge events or
invoke internal log_audit. *(Owns FR-M365DOC-050/060, NFR-M365DOC-008.)*

**AC-M365DOC-062 (reference-only reads/persistence and URL/kind checks — unit).**
Given picked files/folders and repository/Graph spies for every parent,
When users create/link/unlink/delete applicable PMO refs or browse/list versions,
Then typed payloads include kind without client org/actor stamps, only PMO metadata is written,
Microsoft calls are GET-only, no Storage/file/version-content transfer, copy, Graph write or
write-scope request occurs, and invalid facets/URL schemes/credentials are refused before
persistence/navigation. *(Owns FR-M365DOC-061, NFR-M365DOC-001/002/003.)*

**AC-M365DOC-063 (atomic source guards and folder lifecycle — pgTAP).**
Given empty/already-sourced project/procurement entries, a legacy URL, differing parent states and
competing source writes,
When linking/unlinking or issuing/approving a project folder is attempted,
Then collisions/denied states cannot replace committed sources, explicit clearing allows a complete
new ref, unlink preserves register metadata and controlled-folder transitions fail under the proposed
reference-only rule. *(Owns FR-M365DOC-062 and FR-M365DOC-057 server rule; pending OQ-M365DOC-001.)*

**AC-M365DOC-064 (controlled-file lazy drift, not folder drift — unit).**
Given Draft/Issued/Approved files with baseline tags, checks on either side of 24h, metadata renames,
changed cTags and failed reads,
When the shipped verifier reads synthetic metadata on user-triggered display/freeze,
Then it records Issue baseline/version server-side, compares cTag not eTag, never reports Draft/folder
drift or failed reads as clean, preserves status and renders drift/not-verified-as-of on document
surfaces without background tasks; revision resolution keeps the inherited approver≠author rule and
link/unlink adds no new SoD decision. *(Owns FR-M365DOC-063 drift; import the shipped verifier, not
copied logic.)*

**AC-M365DOC-065 (file versions/latest and approved-version fallback — unit, RTL).**
Given file refs on every target, a pinned controlled-project-file version and version-list metadata,
absent/pruned versions, disabled versioning and connection/access failures,
When latest/version/approved controls are used,
Then latest opens the direct URL, versions read metadata only and approved uses owner-resolved
Microsoft browser navigation or an explicit unavailable reason, never bytes or latest mislabeled
approved; folders have no version controls. *(Owns FR-M365DOC-063 version UX; OQ-M365DOC-002 pending.)*

**AC-M365DOC-066 (baseline/drift verification fields are server-only — pgTAP).**
Given controlled-file verification fields and client JWTs including Admin,
When clients set baseline/pinned-version/drift/check timestamps,
Then direct writes fail while the authorized server verification transaction can write them, and
ordinary source edits cannot forge a clean signal. *(Owns FR-M365DOC-063 write boundary; browse
name/URL refresh is not content verification.)*

**AC-M365DOC-067 (bounded, responsive, accessible paging/search — unit, RTL).**
Given multi-page/empty results, rapid searches, unsafe next links and fake clocks,
When users load more, type, navigate/close the modal or request prefix suggestions,
Then pages are ≤100 entries with explicit load-more, search debounces 300 ms and ignores stale
results, loading feedback appears within 100 ms, suggestion search stops after three pages, unsafe
next links fail and keyboard labels/focus return plus empty/error/axe-core checks pass. *(Owns
NFR-M365DOC-009 and §7/8 paging contract.)*

**AC-M365DOC-068 (inherited SoD and money workflows unchanged — pgTAP).**
Given a linked project file, its author and another authorized approver, and Draft budgets with their
existing drafter/editor histories,
When document approval is attempted by author/non-author and budget evidence is linked/unlinked,
Then author approval is refused and authorized non-author approval follows the existing lifecycle,
while evidence writes neither change budget amounts/status nor activation eligibility/editor history
or enqueue money commands. *(Owns FR-M365DOC-043 and FR-M365DOC-052/059's inherited SoD boundary.)*

---

## 5. Traceability (AC → owning layer/test, per ADR-0010)

> **Planned tests, not existing/passing evidence.** Each AC owns one AC-leading test at one layer;
> shared files contain separate tests. "Same file" means the preceding named path. `FR-xxx`/`NFR-xxx`
> abbreviate this spec's `FR-M365DOC-xxx`/`NFR-M365DOC-xxx`. **Superseded:** placeholder test numbers,
> abbreviated paths and the historical "Now" verifiable labels.

| AC | Satisfies | Owning layer | Planned owning test (leading AC-id) | Status |
|---|---|---|---|---|
| AC-M365DOC-001 | FR-001/005, NFR-006 | pgTAP | `supabase/tests/m365_doc_linking_schema.test.sql` | Planned |
| AC-M365DOC-002 | FR-002, NFR-006 | pgTAP | same file | Planned |
| AC-M365DOC-003 | FR-003/004, NFR-004 | pgTAP | `supabase/tests/m365_doc_linking_rls.test.sql` | Planned |
| AC-M365DOC-010 | FR-011, NFR-001 | Unit | `pmo-portal/src/lib/repositories/__tests__/document.m365-link.test.ts` | Planned |
| AC-M365DOC-011 | FR-012 | Unit | same file | Planned |
| AC-M365DOC-012 | FR-002/013 | Unit | same file | Planned |
| AC-M365DOC-013 | FR-010, NFR-003 | Unit | `pmo-portal/src/lib/m365/__tests__/graphClient.browse.test.ts` | Planned |
| AC-M365DOC-014 | FR-015 | Unit/RTL | `pmo-portal/pages/project-detail/tabs/__tests__/DocumentsTab.m365-gate.test.tsx` | Planned |
| AC-M365DOC-020 | FR-020 | Unit/RTL | `pmo-portal/pages/project-detail/tabs/__tests__/DocumentsTab.m365-render.test.tsx` | Planned |
| AC-M365DOC-021 | FR-021/022, NFR-002 | Unit/RTL | same file | Planned |
| AC-M365DOC-022 | FR-023 | Unit/RTL | same file | Planned |
| AC-M365DOC-023 | FR-024/030 | Unit/RTL | same file | Planned |
| AC-M365DOC-030 | FR-030, NFR-005 | Unit/RTL | same file | Planned |
| AC-M365DOC-031 | FR-031 | Unit/RTL | `pmo-portal/pages/project-detail/tabs/__tests__/DocumentsTab.m365-degradation.test.tsx` | Planned |
| AC-M365DOC-032 | FR-032 | Unit/RTL | same file | Planned |
| AC-M365DOC-033 | FR-033 | Unit/RTL | same file | Planned |
| AC-M365DOC-034 | FR-035/036, NFR-005 | Unit/RTL | same file | Planned |
| AC-M365DOC-035 | FR-036, NFR-005 | Unit/RTL | same file | Planned |
| AC-M365DOC-040 | FR-040 | Unit/RTL | `pmo-portal/pages/project-detail/tabs/__tests__/DocumentsTab.m365-authz.test.tsx` | Planned |
| AC-M365DOC-041 | FR-041/042 | Unit | `pmo-portal/src/lib/repositories/__tests__/document.m365-unlink.test.ts` | Planned |
| AC-M365DOC-042 | FR-044, NFR-001 | Unit | same file | Planned |
| AC-M365DOC-050 | FR-010/011/021/022/023/051/052/054/057 | Playwright e2e | `pmo-portal/e2e/AC-M365DOC-050-onedrive-link-journey.spec.ts` | DEFERRED: owner-gated live journey, not CI |
| AC-M365DOC-051 | FR-051/059, NFR-004 | pgTAP | `supabase/tests/m365_procurement_links.test.sql` | Planned |
| AC-M365DOC-052 | FR-052/059, NFR-004 | pgTAP | `supabase/tests/m365_budget_links.test.sql` | Planned |
| AC-M365DOC-053 | FR-053, NFR-006 | pgTAP | `supabase/tests/m365_doc_linking_schema.test.sql` | Planned |
| AC-M365DOC-054 | FR-054 | Unit/RTL | `pmo-portal/src/components/m365/MicrosoftDocumentPicker.test.tsx` | Planned |
| AC-M365DOC-055 | FR-055, NFR-004 | pgTAP | `supabase/tests/m365_document_settings.test.sql` | Planned |
| AC-M365DOC-056 | FR-055 | Unit/RTL | `pmo-portal/src/components/m365/MicrosoftDocumentPicker.test.tsx` | Planned |
| AC-M365DOC-057 | FR-056 | Unit/RTL | same file | Planned |
| AC-M365DOC-058 | FR-057 | Unit/RTL | `pmo-portal/src/components/m365/LinkedDocumentCell.test.tsx` | Pending OQ-001 |
| AC-M365DOC-059 | FR-058, NFR-005 | Unit/RTL | same file | Planned |
| AC-M365DOC-060 | FR-059 | Unit/RTL | `pmo-portal/src/components/m365/DocumentLinkPermissions.test.tsx` | Planned |
| AC-M365DOC-061 | FR-050/060, NFR-008 | pgTAP | `supabase/tests/m365_document_link_audit.test.sql` | Planned |
| AC-M365DOC-062 | FR-061, NFR-001/002/003 | Unit | `pmo-portal/src/lib/repositories/__tests__/m365-reference-writes.test.ts` | Planned |
| AC-M365DOC-063 | FR-057/062 | pgTAP | `supabase/tests/m365_document_link_guards.test.sql` | Folder portion pending OQ-001 |
| AC-M365DOC-064 | FR-014/034/063, NFR-007 | Unit | `pmo-portal/src/lib/m365/__tests__/documentVerification.test.tsx` (imports shipped verifier; Graph mocked) | Planned, transport decision in plan |
| AC-M365DOC-065 | FR-063 | Unit/RTL | `pmo-portal/src/components/m365/LinkedDocumentCell.test.tsx` | Approved navigation pending OQ-002 |
| AC-M365DOC-066 | FR-063 | pgTAP | `supabase/tests/m365_document_verification_grants.test.sql` | Planned |
| AC-M365DOC-067 | NFR-009, paging contract | Unit/RTL | `pmo-portal/src/components/m365/MicrosoftDocumentPicker.test.tsx` | Planned |
| AC-M365DOC-068 | FR-043/052/059 | pgTAP | `supabase/tests/m365_document_link_sod.test.sql` | Planned |

**NFR verification schedule (amended, planned).** NFR-001/002/003: unit AC-010/013/021/041/042/062;
NFR-004/006: pgTAP AC-001/002/003/051/052/053/055; NFR-005: DOM tests AC-035/059;
NFR-007: lazy-check AC-064 plus review of implemented scheduling/transport surfaces (a search alone
is not proof); NFR-008: **pgTAP AC-061**, superseding mocked audit emission as authority; NFR-009:
AC-067. Live Microsoft allow/deny remains AC-050, owner-gated. Layer-1 fixtures prove deterministic
behavior, not live consent/library availability/version navigation. No planned feature tests are
represented as executed by this docs amendment.

---

## 6. Non-Goals (explicitly out of scope)

> **Revision scope:** project-only/file-only and OneDrive-only limitations are superseded by §3.7.
> Sites/libraries/folders in the **link picker**, procurement references and budget evidence are now
> in scope. This does not turn the picker into a file viewer or change Microsoft's authority.

- **No copy/import into Supabase Storage.** Bytes are never copied, mirrored, or cached (NFR-M365DOC-001;
  vision §3.2 rejects this explicitly). The `project-documents` Storage bucket (migration 0025) is **not**
  used by this feature.
- **No in-app preview/browse beyond what linking needs.** Vision §3.2 lists "In-app browse/preview via
  Graph" as a separate, larger item (`Effort: L`) that owns the token lifecycle for sustained preview.
  This feature's browse is the picker needed to choose a **file or folder** from sites/libraries or
  OneDrive — not a file viewer; file version lists are metadata only.
- **No write-back or automatic folder creation.** Read-only `Files.Read`/`Files.Read.All`/
  `Sites.Read.All` scopes are unchanged. Folder conventions/suggestions are advisory; PMO shall not
  provision the recommended layout or request `Files.ReadWrite*` (FR-M365DOC-061).
- **No background sync / watermark reconciliation / change feed / Graph delta.** `ms_last_verified_at`
  is updated lazily only (NFR-M365DOC-007).
- **No Teams, Outlook/Calendar, Planner, or Entra-group provisioning.** Those are Phases 2–5 of the vision.
- **No org-level service-account connection.** The runtime is per-`(org_id,user_id)`; Phase-1 linking is
  limited to users holding their own active connection (FR-M365DOC-015). A shared/org-level connection is
  a separate, larger item.
- **No new role/permission entity.** Reuse document, procurement-document and budget edit gates
  exactly as FR-M365DOC-059 describes; do not assign document-author checks to every parent.
- **No money/approval workflow redesign.** Project **file** lifecycle/SoD stays under ADR-0071;
  procurement/budget evidence does not trigger purchase transitions, budget activation or ERP pushes.
  **Superseded for project folders only:** unconditional workflow parity; the reference-only Draft
  proposal is explicitly pending OQ-M365DOC-001.
- **No controlled folder snapshot, automatic link inheritance on budget clone, per-user remembered
  location or per-project library binding in this phase.** One org default and manual override suffice;
  the broader ADR-0063 project-library-binding seam is not removed by this phase's org default.
- **No ADR from this spec.** The link/reference model and "Microsoft is the permission authority" are
  already ratified by vision §3.2 + ADR-0063 (Graph-follows-ADR-0055) + ADR-0055 (external adapters). The
  amended register-reuse/typed-budget-link choice (§3.7) is localized and reversible. ADR-0071 remains
  binding; a different controlled-folder or approved-version policy needs owner resolution, not an
  implicit ruling hidden in this spec.

---

## 7. Dependencies / Owner-gated inputs (must be resolved before the feature works end-to-end)

> **Superseded dependency snapshot:** M1/use-leg awaiting proof, `Sites.Read.All` optional,
> personal-OneDrive-only scope assumptions and the "config-only / no transport review" conclusion.
> Operational credential coordinates from the historical table are intentionally not repeated in this
> public spec; provisioning follows the environment runbook, not copied secret instructions here.

| Dependency | Deciding source | Status as of revision | Remaining action |
|---|---|---|---|
| M1: connected runtime returns Graph data | Live probe §Closure (2026-10-14), issue #598 | **Satisfied**: `/me/drive`, `/me/drive/root/children`, `/sites?search=*`, `/me/drive/items/{id}/versions` all returned 200 | No reconnect proof gate on starting M3; feature acceptance is still separate |
| SharePoint site discovery permission `Sites.Read.All` | Owner scope / M1 closure | **Granted on the first client tenant**; required, not optional, for the widened picker | Each later deployment needs Microsoft admin consent; each browsing member needs their own active connection |
| Read-only OneDrive/library consent | Current custody consent contract and Microsoft | Existing `Files.Read` / `Files.Read.All` / `Sites.Read.All`; no write scope change | Do not interpret admin consent/default library as item access; Microsoft checks caller access |
| Entitled org and member's personal connection | ADR-0063 corrected four-layer split | Runtime prerequisites unchanged; one live use leg proven | Normal onboarding per deployment; #1017 is a separate self-serve setup item, not silently absorbed here |
| Site-library/folder/search path compatibility | `supabase/functions/m365-token-custody/proxy.ts` and `GraphProxyRequest` | M1 proves site discovery, **not every library/search/paging shape** | Targeted compatibility tests for `/sites/{id}/drives`, `/drives/{id}/root/children`, `/drives/{id}/items/{id}/children`, root search and version reads with consented read scopes; no Graph writes |
| Reference/settings migration, grants, audit triggers and budget-parent guards | FR-M365DOC-051/052/053/055/060/062 | **To be built**, after sign-off | Reversible migration at next available number, preserve legacy uploads/plain links; pgTAP proof at migrated head |
| Controlled-folder policy and approved-file-version navigation | OQ-M365DOC-001/002 at top; ADR-0071 | **Blocking for affected controlled-document delivery** | Owner resolves proposed folder rule and version-opening contract; version-list 200 alone does not resolve them |
| Feature security/spec/quality and rendered-discovery reviews | Project review gates | Required for implementation | Review parent tenancy, audit, safe URL navigation, token isolation and retained degradation behavior |

**Transport contract, not a permission shortcut.** The current proxy accepts normalized paths in the
`/me/drive`, `/sites` and `/drives` families; GET does not itself grant access. The inspected gate's
read-scope branch recognizes the `Files.*` grant family, so the already-consented combined read-scope
set is the compatibility baseline. **Do not claim a `Sites.Read.All`-only grant is proven by M1 or
by that gate.** The build must pin the required site/library/item/search reads with the relevant
consent combinations in tests; any isolated-scope transport adaptation is an explicit bounded runtime
compatibility slice. Query strings belong in `query`, and paginated next links must be converted into
validated pinned Graph path/query pairs rather than followed as arbitrary URLs.

Microsoft is the access authority. `SCOPE_INSUFFICIENT` is a proxy consent refusal; the present
`GRAPH_ERROR` envelope is opaque and cannot prove no-access, item-deleted or no-licence on its own.
Reviewed generic fallback in §3.8 is mandatory. Specific copy requires an approved stable classification
from the server, never raw upstream status/messages in the DOM. The license finding in the live probe
remains a product degradation case even though M1 is now closed.

---

## 8. Implementation notes (for the `eng-planner` plan + `implementer`/`ui-implementer`)

> **Superseded implementation sketch:** project-only columns, one OneDrive-only modal, direct client
> audit emission, blanket "no grant/policy changes" and "SharePoint is config-only". The checklist
> below is the amended build input, not authorization to build or deploy in this docs task.

- [ ] **Resolve the two blocking owner questions and get scope sign-off.** Keep files under
  `docs/adr/0071-linked-document-content-drift.md`; do not quietly extend approval claims to folders.
  Pick executor per `docs/factory-workflow.md` before build; split out money/SoD/token-custody work
  for the required routing/reviews instead of widening the ordinary FE slice.
- [ ] **Data slice:** extend `project_documents` per FR-M365DOC-001/002/053/063 and
  `procurement_documents` per FR-M365DOC-051/053 (`link` remains the single canonical URL there).
  Add `budget_version_document_links` and `org_m365_document_settings` with the exact typed-parent,
  same-org, active-membership/Draft/Admin contracts. Backfill project upload sources; leave legacy
  procurement URLs unchanged. Budget refs contain no duplicate project ID. Add CHECKs, server stamps,
  parent immutability/source guards and same-transaction audit triggers calling internal `log_audit`;
  never grant client execution of that helper. Source metadata grants shall not permit writing
  workflow/drift fields. Index budget parent/org and reference `(ms_drive_id, ms_item_id)` lookups;
  retain procurement-parent and project-parent indexes. Write a dependency-ordered reversal (triggers,
  policies/grants, settings/budget relation, new columns/types), leaving legacy file paths/plain URLs
  and existing parents/workflow data intact; regenerate typed DB bindings.
- [ ] **Repository seam (ADR-0017):** extend `DocumentRepository`, `ProcurementRepository` and
  `BudgetRepository` in `pmo-portal/src/lib/repositories/types.ts` and their actual implementations in
  `pmo-portal/src/lib/repositories/index.ts`. Add a shared **reference DTO**, not a polymorphic database
  parent; normalize procurement `link` to DTO `web_url` at the repository boundary. Extend DALs
  `pmo-portal/src/lib/db/documents.ts`, `procurementCrud.ts` and `budgets.ts` with typed link/create/
  list/unlink operations. Add a typed settings repository/DAL seam for the org default. Hooks consume
  repositories, never raw DAL or client `org_id`. Use one atomic guarded write; audit is server-side.
  CHECK/source collision and parent-write denials retain codes through `AppError`/`classifyMutationError`.
- [ ] **Graph transport:** add `pmo-portal/src/lib/m365/graphClient.ts` with typed site/library/item/
  version envelopes and the existing invoke wrapper/error mapping. One shared picker
  (`pmo-portal/src/components/m365/MicrosoftDocumentPicker.tsx`, proposed) supplies explicit folder
  select vs navigate, breadcrumbs, site/OneDrive entry, contextual suggestions and manual override.
  GET-only calls with separate query; encode search literals/segments; validate and split Graph
  next links into pinned path/query; do not forward arbitrary URLs. Debounce/cancel, bounded paging,
  three-page prefix-search cap, reviewed empty/degraded states and keyboard/focus contracts satisfy
  NFR-M365DOC-009. Pin site-library/search/version scope compatibility before shipping (§7).
- [ ] **Parent surfaces:** use the shared picker/reference cell in
  `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx`, the Documents surface of
  `pmo-portal/pages/ProcurementDetails.tsx`, and selected-version evidence in
  `pmo-portal/pages/ProjectBudget.tsx`. Procurement case links are not hidden when no project or when
  the workflow advances. Budget Active/Archived evidence is read/open only under the Draft mutation
  rule. Settings belongs on the existing Administration integration surface, gated by
  `can('manage','integration')`; setting a default never connects another user's Microsoft account.
  Use shared form/modal primitives and `DESIGN.md`; show file/folder kind and provenance consistently.
- [ ] **Connection/direct-open separation:** fetch the caller's connection status to gate new browse
  and metadata checks only; stale/absent/error status never hides committed links. HTTPS URL validation
  shall run at persistence and navigation; reject invalid scheme, embedded credentials and malformed
  URLs with safe copy. Folder/latest open uses `noopener,noreferrer` and no proxy. Never navigate a
  version `/content` response as though it were a approved browser URL. Approved-version behavior is
  decided under OQ-M365DOC-002; metadata-only version lists do not transfer bytes.
- [ ] **Controlled-file drift slice:** implement FR-M365DOC-063 server checks/baseline and unit/pgTAP
  proof (AC-M365DOC-064/065/066), with separate review of the transport/batching contract required by
  ADR-0071. No cron/delta/watermark, no folder-recursive scan and no client-authored clean flag.
- [ ] **Test/review/accept:** author AC-leading tests at the paths in §5; test Graph shapes with
  synthetic metadata only and mocks at the transport boundary, not copied production validators.
  Run the locked local typecheck/changed-import Vitest gate, touched-file ESLint, touched e2e and
  touched pgTAP for DB work per project rules; CI is the full-suite merge gate. Complete spec/quality/
  security review and rendered Discover (graduate findings). Record AC-M365DOC-050 as pending until
  the owner-gated live journey is actually exercised; M1 data proof is not a feature-test pass.
  Live acceptance evidence stays private: no client names, tenant/site names, real IDs, hostnames,
  people, secrets or operational coordinates in tracked docs/tests/commit messages.

---

*SPEC-DONE*
