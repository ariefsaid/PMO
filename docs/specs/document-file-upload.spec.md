# Spec: Document file upload — issue #1

End-to-end file storage on the project Documents tab: private org-scoped bucket, upload/replace
on Draft rows, download/preview for all org roles, revision lineage with auto-Superseded, and a
single bumpable 5 MB / type-allowlist knob enforced both client-side and server-side.

All business decisions are locked in **OD-DOC-1..5** (`docs/decisions.md`). This spec encodes
them into EARS requirements, acceptance criteria, and implementation constraints. No new
owner decisions are introduced.

- **Grounds:** OD-DOC-1..5; glossary (Document / Revision / Superseded);
  design-plan + approved mockup `docs/design-mockups/document-file-upload/`;
  ADR-0010 (test pyramid); ADR-0012 (transition-RPC pattern);
  ADR-0016 (`can()` FE gating); ADR-0017 (repository seam);
  ADR-0019 (server-enforced SoD).
- **Schema — new:** `Superseded` value added to `doc_status` enum; `parent_document_id`
  nullable self-FK on `project_documents`; storage bucket + RLS policies on `storage.objects`.
- **Schema — altered:** `transition_document_status` RPC gains Superseded-aware logic
  (auto-transition parent on child Approval).
- **Config — altered:** `supabase/config.toml` `[storage] enabled = true` + bucket definition.

---

## AS-IS (what exists today)

- `project_documents` table with columns: `id`, `org_id`, `project_id`, `code`, `category`,
  `title`, `revision`, `status` (`doc_status` enum: Draft / Issued / Approved / Rejected /
  Closed), `doc_date`, `author_id`, `file_path` (exists but never written), `created_at`.
- `transition_document_status(uuid, doc_status)` — security-definer RPC (migration 0017) is the
  sole writer of `project_documents.status`. Enforces org, role gate (Admin / Exec / PM /
  Finance), legal status map (`Draft→Issued→Approved|Rejected→Closed`; `Rejected→Draft|Closed`),
  and approver≠author SoD. Column privilege: direct UPDATE on `status` column is revoked.
- Repository seam: `DocumentRepository` (`repositories/index.ts`) exposes `list / get / create /
  update / transition / delete`. DAL lives in `src/lib/db/documents.ts`.
- DocumentsTab.tsx: metadata-only CRUD register with status-workflow SoD. No file upload UI.
  `STATUS_PILL` map covers Draft / Issued / Approved / Rejected / Closed (no Superseded).
  Subtitle reads "file attachments arrive with Storage" (placeholder copy).
- `supabase/config.toml`: `[storage] enabled = false`. No buckets configured. No storage
  migrations exist.
- RLS on `project_documents`: `project_documents_select` (org-scoped read for authenticated);
  `project_documents_write` (org + 4-role write for metadata columns); column-grant UPDATE
  excludes `status`; `project_documents_delete_admin_only` (restrictive).

---

## Scope

### IN

1. **Storage infrastructure** — re-enable `[storage]` in local config; one private bucket
   (`project-documents`); org-pathed object keys (`{org_id}/{project_id}/{doc_id}/{filename}`);
   `storage.objects` RLS policies (org-scoped read for authenticated org members; write gated to
   document-edit-rights holders on Draft rows); signed-URL read path (no public bucket); prod
   bucket creation via migration/script (never hand-edited console).
2. **Upload / replace** — on Draft documents ONLY (OD-DOC-2); who may upload = whoever may edit
   the row today (author while Draft, PM, Admin); progress bar with percentage; cancel button;
   failure recovery (error message + "Remove" action per mockup §2.4/2.5).
3. **File constraints** (OD-DOC-5) — 5 MB cap + allowlist
   (`.pdf .png .jpg .jpeg .webp .docx .xlsx .pptx .dwg .dxf .csv .txt`), enforced server-side
   (bucket limit + mime) AND client-side (`accept` attr + pre-upload validation); single
   bumpable knob (one shared constant + bucket setting).
4. **Download / preview** — for ANY org role on any row with a file (OD-DOC-4); preview = new
   tab for pdf/images, else download. Preview icon shown only for previewable types
   (pdf, png, jpg, webp).
5. **Revision lineage** (OD-DOC-3) — "New revision" action: visible primary affordance on
   Issued / Approved rows only; creates new Draft row copying code / title / category with
   bumped revision mark + `parent_document_id` link; file NOT carried over.
6. **Superseded status** — new terminal `doc_status` value; set AUTOMATICALLY server-side when a
   successor revision is Approved (inside `transition_document_status` RPC — never client-side);
   Superseded rows read-only but downloadable; no "New revision" button on Rejected / Superseded
   / Closed.
7. **File immutability post-Draft** — server-enforced (storage write policy denies upload when
   document status ≠ Draft), not just hidden buttons (ADR-0019 ethos).
8. **Register UI changes** per approved mockup — File column, Superseded status pill, lineage
   links (parent ↔ child) with microcopy, "New revision" button + modal, mobile card variant,
   a11y (aria-labels per design-plan §4), subtitle update.
9. **Error states** — upload failure, oversize file, disallowed type, storage unavailable.
10. **Empty / loading states** — conventional `ListState` (already in the app).

### OUT (explicit non-goals)

- **Procurement attachments** — issue #2 (quotation files, GR/VI). Will reuse the shared upload
  component.
- **Site photos** — field-reporting track (different domain concept, not a register entry).
- **Per-category access control** — deferred to Admin-settings / RBAC-config-engine track
  (OD-DOC-4 seam).
- **Zip / executables** — explicitly excluded until a real user asks (OD-DOC-5).
- **Drag-and-drop upload** — not in the approved mockup; upload via file-picker only.
- **In-app file viewer** — MVP preview is browser-native (new tab); no embedded viewer.
- **Full lineage tree** — two levels of adjacency (parent ↔ child) per mockup; no tree UI.
- **Bulk upload** — one file per document row (OD-DOC-2); no multi-file upload.

---

## Functional Requirements

### Storage infrastructure

**FR-DOC-010** — The system shall provide exactly one private Supabase Storage bucket named
`project-documents`, not public, with a file-size limit of 5 MB and a MIME-type allowlist matching
the OD-DOC-5 type list.

> *Trace: OD-DOC-1 (one bucket), OD-DOC-5 (cap + allowlist).*

**FR-DOC-011** — The system shall store uploaded files under the key pattern
`{org_id}/{project_id}/{document_id}/{original_filename}`, where `org_id` and `project_id` are
derived server-side from the document row (never client-supplied).

**FR-DOC-012** — The system shall deny public/unauthenticated access to all objects in the
`project-documents` bucket. Authenticated reads shall be scoped to the user's own org via
`storage.objects` RLS policies.

**FR-DOC-013** — The system shall issue time-limited signed URLs for file downloads and previews.
Signed URLs shall expire after 60 minutes (one configurable constant, `SIGNED_URL_EXPIRYSeconds`).

**FR-DOC-014** — The system shall create the `project-documents` bucket in production via a
Supabase migration or idempotent setup script, never by hand-editing the Supabase console.

> *Trace: OD-DOC-1.*

**FR-DOC-015** — The `[storage]` block in `supabase/config.toml` shall be re-enabled
(`enabled = true`) for local development, with a local bucket definition matching the production
bucket name and constraints.

### Upload / replace (Draft only)

**FR-DOC-020** — Where a `project_documents` row is in `Draft` status and the actor holds write
access to that row, the system shall allow the actor to upload exactly one file.

> *Trace: OD-DOC-2 (Draft-only), ADR-0019 (server-enforced).*

**FR-DOC-021** — Where a `project_documents` row is in `Draft` status and already has a file,
the system shall allow the actor to replace the file (delete old, upload new) in a single atomic
operation.

**FR-DOC-022** — The system shall reject file upload or replacement on any row whose status is
not `Draft`. This rejection shall be enforced server-side (storage write RLS / policy), not solely
by client-side UI hiding.

> *Trace: OD-DOC-2, ADR-0019.*

**FR-DOC-023** — When a file upload is in progress, the system shall display a progress bar
showing the upload percentage and a cancel affordance. Cancelling shall abort the upload and
leave the document in its prior file state (no file or previous file).

**FR-DOC-024** — When a file upload fails (network error, server error, or storage unavailable),
the system shall display an error message in the File column and a "Remove" affordance that
returns the row to the no-file state.

**FR-DOC-025** — After a successful upload, the system shall write the storage object path to
`project_documents.file_path` on the document row.

### File constraints

**FR-DOC-030** — The system shall reject any file exceeding the maximum allowed size. The
maximum size shall be defined by a single shared constant (`MAX_FILE_SIZE_BYTES`) consumed by
both the client-side pre-upload check and the server-side bucket limit. Changing this constant
(and the bucket setting) shall change the cap everywhere.

> *Trace: OD-DOC-5 (5 MB cap, bumpable knob).*

**FR-DOC-031** — The system shall reject any file whose extension is not in the allowlist:
`.pdf .png .jpg .jpeg .webp .docx .xlsx .pptx .dwg .dxf .csv .txt`. The allowlist shall be
defined by a single shared constant (`ALLOWED_FILE_TYPES`) consumed by both the client-side
`<input accept="…">` attribute and a pre-upload client-side check.

> *Trace: OD-DOC-5.*

**FR-DOC-032** — The server shall enforce the file-size limit and MIME-type restriction via the
bucket configuration (`file_size_limit`, `allowed_mime_types`), independently of client-side
checks. A file that passes client-side validation but exceeds the server constraint shall be
rejected with a classified error surfaced to the user.

**FR-DOC-033** — The system shall reject `.zip` files and executable files (`.exe .bat .sh .cmd
.dll .msi .app`) regardless of future allowlist changes.

### Download / preview

**FR-DOC-040** — Where a `project_documents` row has a non-null `file_path`, the system shall
provide a download affordance to any authenticated user who can read the document row (org-scoped,
all roles).

> *Trace: OD-DOC-4 (file read access = register row access).*

**FR-DOC-041** — When the user activates the download affordance, the system shall generate a
signed URL and trigger a browser download of the file.

**FR-DOC-042** — When the file type is previewable (pdf, png, jpg, jpeg, webp), the system shall
display a preview affordance. Activating it shall open the file in a new browser tab via signed
URL (`target="_blank"`). For non-previewable types, no preview affordance shall appear.

### Revision lineage

**FR-DOC-050** — The system shall provide a "New revision" action on `project_documents` rows
with status `Issued` or `Approved`. The action shall be a visible first-class button in the row
(not inside an overflow menu).

> *Trace: OD-DOC-3 (explicit action, not buried).*

**FR-DOC-051** — When the "New revision" action is invoked, the system shall open a modal
pre-filled with the parent document's title, code, category, and an auto-bumped revision mark
(letter increment A→B, digit increment 3→4; editable). The modal shall NOT pre-fill or carry
over the parent's file. The document date field shall be blank.

> *Trace: OD-DOC-3 (file NOT carried over).*

**FR-DOC-052** — When the new revision is created, the system shall insert a new
`project_documents` row with status `Draft`, copying `project_id`, `org_id`, `code`, `category`,
and `title` from the parent, storing the parent's `id` in a new `parent_document_id` column on
the child row. The `author_id` shall be the current user.

**FR-DOC-053** — The "New revision" action shall NOT appear on rows with status `Draft`,
`Rejected`, `Superseded`, or `Closed`.

### Superseded status

**FR-DOC-060** — The `doc_status` enum shall include a new value `Superseded`. It is a terminal
status: once set, no further transitions are legal.

**FR-DOC-061** — When a document with a non-null `parent_document_id` is transitioned to
`Approved`, the system shall automatically set the parent document's status to `Superseded` as
part of the same RPC transaction. This transition is server-side only; the client shall never
directly request a `Superseded` transition.

> *Trace: OD-DOC-3 (auto-Superseded through the link, never code/title matching).*

**FR-DOC-062** — A `Superseded` document row shall be read-only (no metadata edit, no status
transition, no file upload/replace) but its file shall remain downloadable (FR-DOC-040).

**FR-DOC-063** — The system shall NOT present a "New revision" button on `Superseded` rows.
The lineage link (→ successor) guides the user to the active revision.

### File immutability post-Draft

**FR-DOC-070** — The system shall enforce at the storage-policy level that no file upload,
replacement, or deletion may occur on a document whose status is not `Draft`. A client that
bypasses the UI and calls the storage API directly against a non-Draft document's path shall be
denied by the server.

> *Trace: OD-DOC-2, ADR-0019 (server-enforced, not just hidden buttons).*

### Register UI

**FR-DOC-080** — The DocumentsTab table shall include a new "File" column (positioned between
"Code" and "Category") showing: for Draft rows without a file, an "Upload" link; for Draft rows
with a file, the filename (truncated 20ch) + "Replace" link; for non-Draft rows with a file, the
filename + download icon + preview icon (if previewable); for non-Draft rows without a file, an
em-dash. The File column shall be hidden below the `md` (768px) breakpoint.

> *Trace: approved mockup §1.1, §1.2.*

**FR-DOC-081** — The DocumentsTab shall render a `Superseded` status pill with neutral visual
treatment (grey dot + grey pill background + "Superseded" label), matching the existing `neutral`
/ `draft` StatusVariant tokens.

**FR-DOC-082** — Where a document row has a `parent_document_id`, the Document cell shall show
a lineage link "← Rev {parent.revision}" below the title. Where a document row is the parent of
a Superseded child (i.e. is itself Superseded), the Document cell shall show "→ Rev
{child.revision}" below the title. Lineage links shall navigate to (or highlight) the linked row.

**FR-DOC-083** — The "New revision" button shall appear as a `button-outline` in the rightmost
column of Issued / Approved rows (desktop table), and as a full-width `button-outline` at the
card footer in the mobile card variant.

**FR-DOC-084** — The "New Revision Modal" shall use the existing `EntityFormModal` pattern with
fields: Title (pre-filled, editable, required), Code (pre-filled, editable), Category (pre-filled,
editable, required), Revision (auto-bumped, editable), Document date (blank, editable). The modal
subtitle shall read: "Create the next revision of this document. The file can be uploaded once the
revision is created."

**FR-DOC-085** — The tab subtitle shall be updated from the Storage-deferral placeholder to:
"Drawings, specifications, and transmittals for this project. Upload files on Draft rows."

**FR-DOC-086** — The mobile card variant (below 768px) shall render file affordances in the
card's status row (Upload / Replace / Download / Preview per row state), with all interactive
elements meeting the ≥44px touch-target requirement.

### Error states

**FR-DOC-090** — When a file exceeds the size limit, the system shall display the error message
"File exceeds {MAX_FILE_SIZE_MB} limit" in `{colors.destructive}` with a "Remove" affordance.

**FR-DOC-091** — When a file's type is not allowed, the system shall display the error message
"File type not allowed (.{extension})" in `{colors.destructive}` with a "Remove" affordance.

**FR-DOC-092** — When a file upload fails due to a network or server error, the system shall
display the error message "Upload failed — try again" with a "Remove" affordance.

---

## Non-Functional Requirements

**NFR-DOC-001** — The maximum file size shall be controlled by a single shared constant
`MAX_FILE_SIZE_BYTES` (default 5 MB = 5,242,880 bytes) defined in exactly one place in the
codebase and mirrored in the bucket's `file_size_limit`. Changing the constant and bucket setting
shall change the cap everywhere with no other code changes.

> *Trace: OD-DOC-5 (single bumpable knob).*

**NFR-DOC-002** — The file type allowlist shall be controlled by a single shared constant
`ALLOWED_FILE_TYPES` (array of extensions) and mirrored in the bucket's `allowed_mime_types`.
Adding or removing a type requires changing the constant and bucket setting only.

**NFR-DOC-003** — Signed URLs for file download/preview shall expire after 60 minutes
(`SIGNED_URL_EXPIRY_SECONDS = 3600`). The expiry duration shall be a named constant.

**NFR-DOC-004** — File upload, download, and signed-URL generation shall complete within 10
seconds for files at the 5 MB cap on a standard broadband connection.

**NFR-DOC-005** — The `Superseded` auto-transition (parent → Superseded on child Approval)
shall be atomic within the `transition_document_status` RPC transaction. At no point shall a
parent be Approved and its child also be Approved simultaneously.

**NFR-DOC-006** — Storage RLS policies shall be proven by pgTAP tests (matching the ADR-0019
discipline): an out-of-org user shall receive zero rows; a non-Draft document's storage path
shall reject writes from any role.

**NFR-DOC-007** — All new UI elements shall meet WCAG 2.1 AA: focus-visible rings on all
interactive elements, aria-labels per design-plan §4, `role="progressbar"` with
`aria-valuenow/min/max` on progress bars, `role="alert"` on error messages, ≥4.5:1 contrast
ratios.

---

## Acceptance Criteria

### Storage infrastructure

**AC-DOC-010** — Re-enable storage and create bucket
```
Given the Supabase local config has [storage] enabled = true
  And a migration creates the "project-documents" bucket (private, 5 MB limit, MIME allowlist)
When an authenticated user in org X uploads a file to a Draft document in org X
Then the file is stored under the key "{orgX}/{projectA}/{doc1}/file.pdf"
  And the document row's file_path is updated to that key
  And an authenticated user in org Y cannot read or write that object
```
*Owning layer: pgTAP (RLS) + e2e (upload flow)*

**AC-DOC-011** — Signed URL expiry
```
Given a document row has a file
When a signed URL is generated for download
Then the URL expires after 60 minutes
  And accessing the URL after expiry returns HTTP 403
```
*Owning layer: unit (constant) + e2e (download)*

### Upload / replace

**AC-DOC-020** — Upload on Draft
```
Given a document row in status Draft
  And the current user holds write access to that row
When the user selects a valid file (≤5 MB, allowed type) via the file picker
Then a progress bar is displayed during upload
  And on completion the file name appears in the File column
  And file_path on the document row is non-null
```
*Owning layer: e2e*

**AC-DOC-021** — Replace on Draft
```
Given a Draft document row that already has a file
When the user selects a new valid file via "Replace"
Then the old file is deleted from storage
  And the new file is stored under the same document path
  And the File column shows the new filename
```
*Owning layer: e2e*

**AC-DOC-022** — Upload rejected on non-Draft (server-enforced)
```
Given a document row in status Issued
When any user (including Admin) attempts to upload a file to that document's storage path
  via the storage API (bypassing the UI)
Then the upload is denied by the storage write policy
```
*Owning layer: pgTAP*

**AC-DOC-023** — Cancel upload
```
Given a file upload is in progress on a Draft row
When the user clicks the cancel (✕) button
Then the upload is aborted
  And the row returns to its prior file state (no file or previous file)
```
*Owning layer: unit (component state)*

**AC-DOC-024** — Upload failure recovery
```
Given a file upload fails (network error or server error)
When the error is received
Then the File column shows "Upload failed — try again" in destructive color
  And a "Remove" link is visible
  And clicking "Remove" returns the row to the no-file state
```
*Owning layer: unit (component state)*

### File constraints

**AC-DOC-030** — Oversize file rejected (client + server)
```
Given a user selects a file of 6 MB for upload
When the client-side pre-upload validation runs
Then the upload does not start
  And the error message "File exceeds 5 MB limit" is displayed
```
```
Given a file of 6 MB bypasses client validation and reaches the server
When the storage bucket receives it
Then the upload is rejected by the bucket's file_size_limit
```
*Owning layer: unit (client validation) + pgTAP (server enforcement)*

**AC-DOC-031** — Disallowed type rejected
```
Given a user selects a .zip file for upload
When the client-side pre-upload validation runs
Then the upload does not start
  And the error message "File type not allowed (.zip)" is displayed
```
*Owning layer: unit*

**AC-DOC-032** — Allowed types accepted
```
Given a user selects a file with extension .pdf, .png, .jpg, .jpeg, .webp, .docx, .xlsx,
  .pptx, .dwg, .dxf, .csv, or .txt
When the file is within the size limit
Then the upload proceeds and completes successfully
```
*Owning layer: e2e (at least one type) + unit (allowlist constant)*

### Download / preview

**AC-DOC-040** — Download file
```
Given a document row has a non-null file_path
  And the current user can read the document row (any org role)
When the user clicks the download icon
Then the browser initiates a file download via signed URL
```
*Owning layer: e2e*

**AC-DOC-041** — Preview file (previewable type)
```
Given a document row has a file of type .pdf, .png, .jpg, .jpeg, or .webp
When the user clicks the preview icon
Then the file opens in a new browser tab via signed URL
```
*Owning layer: e2e*

**AC-DOC-042** — Preview icon hidden for non-previewable types
```
Given a document row has a file of type .docx, .xlsx, .pptx, .dwg, .dxf, .csv, or .txt
Then no preview icon is displayed in the File column
  And only the download icon is shown
```
*Owning layer: unit (component rendering)*

### Revision lineage

**AC-DOC-050** — "New revision" button visibility
```
Given a document row with status Issued or Approved
Then the "New revision" button is visible in the row (not inside an overflow menu)
```
```
Given a document row with status Draft, Rejected, Superseded, or Closed
Then no "New revision" button is visible
```
*Owning layer: unit (component rendering)*

**AC-DOC-051** — New revision creation
```
Given a document row "Foundation GA, Rev A, Approved" with code DWG-001, category Drawing
When the user clicks "New revision" and confirms the modal (title pre-filled, revision "B")
Then a new Draft row is created with:
    title = "Foundation GA"
    code = "DWG-001"
    category = "Drawing"
    revision = "B"
    status = "Draft"
    parent_document_id = {original row's id}
    file_path = null
    author_id = current user
  And the new row appears in the register
```
*Owning layer: e2e*

**AC-DOC-052** — Revision auto-bump
```
Given a parent document with revision "A"
When the "New revision" modal opens
Then the revision field defaults to "B"
```
```
Given a parent document with revision "3"
When the "New revision" modal opens
Then the revision field defaults to "4"
```
*Owning layer: unit*

### Superseded status

**AC-DOC-060** — Auto-Superseded on child Approval
```
Given document Rev A (Approved) is the parent of document Rev B (Issued)
When Rev B is transitioned to Approved via transition_document_status
Then Rev A's status is automatically set to Superseded in the same transaction
  And Rev A's status pill shows "Superseded" with neutral grey treatment
```
*Owning layer: pgTAP (RPC transaction) + e2e (visual)*

**AC-DOC-061** — Superseded is terminal
```
Given a document with status Superseded
When any user attempts any status transition on it
Then the transition is rejected (no legal path from Superseded)
```
*Owning layer: pgTAP*

**AC-DOC-062** — Superseded file downloadable, no write
```
Given a Superseded document with a file
When any org user views the row
Then the file is downloadable
  And no upload, replace, edit, or status-transition affordance is visible
```
*Owning layer: e2e*

### File immutability

**AC-DOC-070** — Storage write policy enforces Draft-only
```
Given a document row with status Issued and file_path = "org/proj/doc/file.pdf"
When a write-role user attempts to upload a new file to that path via the storage API
Then the write is denied by the storage RLS policy
```
*Owning layer: pgTAP*

### Register UI

**AC-DOC-080** — File column rendering per state
```
Given the DocumentsTab is rendered with documents in various states
Then the File column renders correctly for each state:
  - Draft, no file → "Upload" link
  - Draft, has file → filename + "Replace" link
  - Draft, uploading → progress bar + cancel button
  - Draft, error → error message + "Remove" link
  - Issued/Approved, has file → filename + download + preview icons
  - Issued/Approved, no file → em-dash
  - Rejected → same as Issued (read-only)
  - Closed → same as Issued (read-only)
  - Superseded, has file → filename + download + preview icons (read-only)
```
*Owning layer: unit (component rendering per state)*

**AC-DOC-081** — Superseded status pill
```
Given a document row with status Superseded
Then a status pill is rendered with grey dot, grey background, and text "Superseded"
  And the aria-label reads "Status: Superseded"
```
*Owning layer: unit*

**AC-DOC-082** — Lineage links
```
Given document Rev B has parent_document_id pointing to Rev A
Then Rev B's row shows "← Rev A" below the title
  And Rev A (if Superseded by Rev B) shows "→ Rev B" below the title
  And clicking a lineage link navigates to / highlights the linked row
```
*Owning layer: unit (rendering) + e2e (navigation)*

**AC-DOC-083** — Mobile card variant
```
Given the viewport is below 768px
Then documents are rendered as stacked cards
  And file affordances (Upload/Replace/Download/Preview) appear in the card status row
  And all interactive elements have a minimum touch target of 44px
  And Issued/Approved cards show a full-width "New revision" button at the card footer
```
*Owning layer: unit (responsive rendering)*

**AC-DOC-084** — New Revision Modal
```
Given the user clicks "New revision" on an Approved document
Then a modal opens with:
    Title field pre-filled with parent's title (editable, required)
    Code field pre-filled with parent's code (editable)
    Category dropdown pre-filled with parent's category (editable, required)
    Revision field pre-filled with auto-bumped value (editable)
    Document date field blank (editable)
    Subtitle: "Create the next revision of this document. The file can be uploaded once the revision is created."
    Cancel (outline) and Create revision (primary) buttons
  And Create revision is disabled until Title is non-empty
```
*Owning layer: unit (modal rendering) + e2e (create flow)*

**AC-DOC-085** — Tab subtitle updated
```
Given the DocumentsTab is rendered
Then the subtitle reads "Drawings, specifications, and transmittals for this project. Upload files on Draft rows."
```
*Owning layer: unit*

### Error states

**AC-DOC-090** — Oversize error display
```
Given a user selects a file exceeding 5 MB
Then the error "File exceeds 5 MB limit" is displayed in destructive color
  And a "Remove" link returns the row to the no-file state
```
*Owning layer: unit*

**AC-DOC-091** — Disallowed type error display
```
Given a user selects a .zip file
Then the error "File type not allowed (.zip)" is displayed in destructive color
  And a "Remove" link returns the row to the no-file state
```
*Owning layer: unit*

**AC-DOC-092** — Storage unavailable error
```
Given the storage service is unavailable
When a file upload is attempted
Then the error "Upload failed — try again" is displayed
  And a "Remove" link returns the row to the no-file state
```
*Owning layer: unit (error state rendering)*

---

## Error Handling Table

| Condition | Source | User message | Recovery |
|---|---|---|---|
| File exceeds size limit | Client pre-check | "File exceeds {N} MB limit" | "Remove" → no-file state |
| File exceeds size limit | Server (bucket limit) | "File exceeds {N} MB limit" | "Remove" → no-file state |
| File type not allowed | Client pre-check | "File type not allowed (.{ext})" | "Remove" → no-file state |
| File type not allowed | Server (bucket MIME) | "File type not allowed" | "Remove" → no-file state |
| Upload network/server failure | Storage API | "Upload failed — try again" | "Remove" → no-file state |
| Storage service unavailable | Storage API | "Upload failed — try again" | "Remove" → no-file state |
| Signed URL generation fails | Storage API | "Couldn't generate download link" | Toast with retry |
| Upload on non-Draft row (server) | Storage RLS | Silent denial (0-row) | N/A (should not reach UI) |
| Parent Superseded transition fails | RPC | Classified toast | Transition rolled back |

---

## Implementation TODO Checklist

### Migration / DB
- [ ] Add `Superseded` to `doc_status` enum.
- [ ] Add `parent_document_id uuid references project_documents(id) on delete set null` to
      `project_documents`.
- [ ] Update `transition_document_status` RPC: extend the legal map to include Superseded
      (empty outbound array — terminal); add auto-transition logic: when `p_to = 'Approved'`
      and the target row has a non-null `parent_document_id`, set the parent's status to
      `Superseded` in the same transaction (row-lock parent `for update`).
- [ ] Add index on `project_documents(parent_document_id)` for lineage lookups.
- [ ] Create `project-documents` bucket via migration (INSERT into `storage.buckets`).
- [ ] Add storage RLS policies on `storage.objects`:
  - **Read:** org-scoped select — object key starts with `{auth_org_id()}/` and user is
    authenticated.
  - **Write (upload/replace/delete):** org-scoped AND the object key's document-id segment
    references a `project_documents` row in `Draft` status AND the actor holds write access
    (matching `project_documents_write` role gate).
- [ ] Grant `project_documents` UPDATE on `file_path` column in the column-level grant
      (currently included in the 0017 explicit-grant list — verify it's present).

### Backend / DAL
- [ ] Add storage upload function (via Supabase Storage API): upload file to
      `{org_id}/{project_id}/{doc_id}/{filename}`, update `file_path`.
- [ ] Add storage replace function: delete old object, upload new, update `file_path`.
- [ ] Add signed-URL generation function (read path).
- [ ] Add `createRevision(parentId, input, authorId)` to document DAL — inserts new row with
      `parent_document_id`, returns the new row.
- [ ] Add `getChildDocument(parentId)` lookup for lineage display.
- [ ] Wire new DAL functions into the `DocumentRepository` interface + Supabase implementation.
- [ ] Define shared constants: `MAX_FILE_SIZE_BYTES`, `ALLOWED_FILE_TYPES`,
      `SIGNED_URL_EXPIRY_SECONDS`, `PREVIEWABLE_TYPES`.

### Hooks / State
- [ ] Add `useFileUpload(projectId)` hook: upload/replace mutations with progress tracking,
      cancel support, error classification.
- [ ] Add `useRevision(projectId)` hook: `createRevision` mutation.
- [ ] Update `useDocuments` / `useDocumentMutations` to include `file_path`, `parent_document_id`
      in the typed row.

### UI Components
- [ ] Add `StatusVariant = 'superseded'` to `StatusPill` (neutral grey treatment).
- [ ] Build `FileCell` component — renders file state per row (upload/replace/progress/error/
      download/preview) matching design-plan §1.2.
- [ ] Build `NewRevisionModal` component (extends `EntityFormModal`).
- [ ] Update `DocumentsTab`:
  - Add File column to DataTable.
  - Add "New revision" button column (Issued/Approved rows).
  - Add lineage links in Document cell.
  - Update subtitle (FR-DOC-085).
  - Wire upload/replace/download/preview via `useFileUpload`.
  - Wire revision creation via `useRevision`.
  - Remove Storage-deferral placeholder subtitle.
- [ ] Update mobile card variant with file affordances and "New revision" card footer.
- [ ] Add a11y attributes per design-plan §4 (aria-labels, progressbar role, alert role).

### Config
- [ ] `supabase/config.toml`: set `[storage] enabled = true`, add local bucket definition for
      `project-documents` with matching size limit and MIME allowlist.

### Tests
- [ ] pgTAP: storage read RLS (org-scoped, cross-org denied).
- [ ] pgTAP: storage write RLS (Draft-only enforced, non-Draft denied).
- [ ] pgTAP: `transition_document_status` auto-Superseded on child Approval.
- [ ] pgTAP: Superseded is terminal (no outbound transitions).
- [ ] pgTAP: revision creation stores `parent_document_id` correctly.
- [ ] Unit: `FileCell` renders all states per FR-DOC-080.
- [ ] Unit: `NewRevisionModal` pre-fills + auto-bumps revision.
- [ ] Unit: client-side file validation (size + type).
- [ ] Unit: shared constants (`MAX_FILE_SIZE_BYTES`, `ALLOWED_FILE_TYPES`).
- [ ] Unit: signed URL generation uses correct expiry constant.
- [ ] E2E: upload file to Draft → download → verify content.
- [ ] E2E: replace file on Draft → new file downloadable.
- [ ] E2E: "New revision" from Approved → Draft row created with lineage.
- [ ] E2E: Approve revision → parent auto-Superseded.
- [ ] E2E: oversize file shows error; disallowed type shows error.
- [ ] E2E: upload on non-Draft row has no affordance (and server rejects direct API call).
