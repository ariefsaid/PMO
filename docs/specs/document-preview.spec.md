# Document preview

Status: proposed for owner sign-off; documentation only, not implementation approval.
Date: 2026-10-28. Delivery issue: [#1406](https://github.com/ariefsaid/PMO/issues/1406).
Decision: [#1447](https://github.com/ariefsaid/PMO/issues/1447#issuecomment-6469345149).
Feasibility dependency: [#1446](https://github.com/ariefsaid/PMO/issues/1446).

## Problem and job story

When I review a project, purchase or budget and need to read its supporting document,
I want to open the file beside the record in PMO, so I can inspect the evidence and
return to the same task without switching tabs or losing my place.

Success means that document entry points share one side-panel viewer, including
useful loading, access-denied and unsupported-preview states. Preview is a read
operation; Download and Open in source remain explicit secondary actions.

## Owner decisions — verbatim

The deciding artifact is the owner comment linked above, read with
`gh issue view 1447 --comments` and the issue-comments API.

> **Owner decision (2026-10-28):**
> 1. One reusable document viewer, opened from every place a document is linked or attached (project documents, purchase documents, budget evidence), shown inside PMO in a side panel — no tab switching.
> 2. SharePoint/OneDrive links preview through Microsoft Graph's preview (per #1446; no new permission). When the viewer's Microsoft account can't reach the file: say so plainly and offer 'Open in SharePoint'.
> 3. Types: PDF, images, Word, Excel and PowerPoint.
> 4. Uploaded files: for an organisation connected to Microsoft 365, uploads are stored in the record's SharePoint folder and previewed the same way as (2). Without Microsoft 365: PDFs and images preview in the browser; Office files use Microsoft's public online viewer on a short-lived link where it works; Download is always available.

## Prior art and precedence

Reconnaissance ran `scripts/prior-art.sh document-preview`,
`scripts/prior-art.sh SharePoint` and `scripts/prior-art.sh 'record.folder'`.

- Research: `docs/research/2026-10-28-document-preview.md` at commit
  `39af897f1cb2be7e5da55db7e84a48bccd73e5ab` on
  `origin/ariefsaid/research-document-preview` (the actual remote branch name).
  It establishes on-demand Graph preview, caller-specific access and transient URLs.
  Its earlier upload recommendation is superseded by owner decision 4; audio/video
  research does not expand the five requested type families.
- [ADR-0010](../adr/0010-test-strategy-pyramid.md) owns test-layer selection. Each AC below
  has one canonical owning layer; edge-handler tests count as unit tests.
- ADR-0016/0017/0019 preserve UX permission gates, repository boundaries and server
  enforcement of lifecycle, tenancy and segregation of duties.
- [ADR-0060](../adr/0060-microsoft-graph-token-custody.md) keeps Microsoft token use
  server-side; [ADR-0063](../adr/0063-microsoft-365-integration-architecture.md)
  makes Microsoft the source and access authority for reference-backed files.
- [ADR-0071](../adr/0071-linked-document-content-drift.md) preserves controlled
  document pins, lifecycle, drift and version identity. A latest-file preview must
  not represent itself as the issued/approved bytes.
- [ADR-0089](../adr/0089-m365-record-folder-write-capability.md) governs record-folder
  resolution and a bounded folder-creation capability. Its existing contract does
  not itself authorize a general upload transport. Decision 4 requires an explicit,
  bounded file-upload extension in the implementation design; preview alone needs
  no new Graph permission or preview-specific consent flow per #1446.
- `docs/specs/document-file-upload.spec.md` preserves file constraints, revisions,
  downloads and post-Draft immutability. This spec supersedes only its new-tab
  preview/non-embedded-viewer choice and the destination of new connected-org uploads.
- `docs/specs/m365-onedrive-doc-linking.spec.md` remains authoritative for linking,
  folders, personal connections, document ownership and link audit.

## Scope and source contract

One viewer serves project document rows and their quick view, purchase document
references and phase-file attachments, budget evidence links, and files listed
inside linked record folders. Existing receipt/evidence preview entry points also
reuse the viewer rather than retaining a second viewer. Additional record surfaces
that expose these same document references use the same adapter.

The viewer accepts a typed record/document identity plus a source adapter, not an
arbitrary externally supplied preview URL. Source resolution returns the display
name/type, available secondary actions, and a transient browser-native, Graph or
public-Office-viewer preview result. It does not mutate the business record.

| Source | Preview path | Recovery / secondary actions |
| --- | --- | --- |
| SharePoint / work-or-school OneDrive reference | Server-mediated Graph `driveItem: preview` under the viewer's own connection | Open in SharePoint (or source-appropriate OneDrive label); authorized Download |
| New upload, org connected to M365 | Store in the owning record's SharePoint folder; persist a Microsoft reference; same Graph path | Explicit folder/connection/upload recovery; no silent change of destination |
| Existing private upload, or new upload without M365 | Browser-native PDF/image; public Microsoft online viewer for Office using a short-lived signed link where supported | Download; clear preview-unavailable state |
| Folder reference | Existing folder browse; selecting a child file opens the common viewer | Open folder in source; folders themselves are not files to render |
| Other format / unresolved legacy link | Common panel explains preview unavailable | Authorized Download or validated Open in source when available |

Connection state is evaluated at organization level for upload destination. A missing
personal connection or file permission in a connected organization is a recovery
condition, not an instruction to silently upload to private Storage. Existing uploads
remain readable at their current source; this feature performs no bulk migration.

## Functional requirements (EARS)

| ID | Requirement |
| --- | --- |
| FR-001 | When a user selects a document's primary read/Preview action on an in-scope surface, PMO shall open the common viewer in a side panel while retaining the route, selected record, filters and scroll position. |
| FR-002 | While the panel is open, PMO shall show the document name, source, preview area, Close action and applicable Download/Open in source actions; when the user closes it, PMO shall restore focus to the invoking control when it still exists. |
| FR-003 | When a readable Microsoft file is opened, PMO shall request an embeddable preview through a dedicated server-mediated Graph preview operation using the current viewer's Microsoft connection and existing read consent. |
| FR-004 | When the current viewer's connection cannot read a Microsoft file, PMO shall explain that their Microsoft account cannot access it and offer Open in SharePoint or the corresponding source action, without borrowing another person's connection. |
| FR-005 | When an authenticated, authorized user views a supported PDF, image, Word, Excel or PowerPoint file, PMO shall select the renderer from the source contract; when that source cannot preview the file, PMO shall retain the panel with a clear fallback rather than navigate away. |
| FR-006 | While the organization is connected to M365, when an authorized user uploads a file to a supported business record, PMO shall resolve that record's SharePoint folder, upload there and persist the resulting reference only after confirmed success. |
| FR-007 | When the record folder, required write capability or personal Microsoft connection is unavailable during a connected-org upload, PMO shall present an actionable error and preserve the existing attachment/reference without reporting success or silently writing to a different storage provider. |
| FR-008 | While the organization is not connected to M365, when an authorized user uploads a file, PMO shall retain the existing private-upload flow; when they preview a PDF or image, PMO shall render it inside the panel using an authorized short-lived URL. |
| FR-009 | While a file is in private Storage, when the user previews Word, Excel or PowerPoint content, PMO shall attempt Microsoft's public online viewer with a short-lived signed URL; when unsupported, expired or unsuccessful, PMO shall explain the result and keep Download available. |
| FR-010 | When the user selects Download, PMO shall attempt an authorized download of the original independently of preview availability; when source access denies the download, PMO shall state the reason rather than imply a preview fallback grants access. |
| FR-011 | When a preview URL expires or a preview load fails, PMO shall offer Retry to obtain fresh authorization and a fresh URL; when the user closes or switches documents, PMO shall discard the previous result and ignore late responses for it. |
| FR-012 | While a project document is Issued or later, PMO shall preserve revision identity, status and drift information and label latest-source preview explicitly; when pinned content cannot be previewed, PMO shall preserve the existing approved/issued-version recovery action rather than substitute latest bytes under an approved label. |
| FR-013 | When a read-only user opens a document they can read, PMO shall allow preview and authorized secondary read actions independently of create/edit rights; while impersonating a role, PMO shall preserve view-only behavior. |
| FR-014 | When upload, replace, link, archive or status-transition actions are exposed, PMO shall retain the existing record-scoped `can()`/permission gates and server-enforced lifecycle/SoD rules, including Draft-only controlled-file replacement. |
| FR-015 | When folder child files or receipt/evidence files are opened, PMO shall use the same viewer and preserve their existing parent-specific read authorization; folder browsing and file preview shall remain distinct operations. |

## Non-functional requirements

- **NFR-001 — authorization:** PMO shall authorize the typed parent/document using
  the caller's real JWT and RLS before issuing a preview/download capability or
  external write. `org_id` is server-derived; service execution does not replace
  the caller's record-read/write check. Microsoft independently decides file access.
- **NFR-002 — ephemeral access:** PMO shall keep preview/signed URLs in the active
  viewer's memory only, excluding them from durable rows, query persistence,
  analytics, logs and error bodies. It shall retain the existing 3600-second private
  signed-link upper bound, fetch on demand and not assume a fixed Graph TTL.
  Public Office preview deliberately shares a time-limited file URL with Microsoft;
  the backing bucket remains private and the URL is not a durable public link.
- **NFR-003 — bounded transport:** PMO shall use a purpose-specific preview action
  and bounded record-folder upload action within token custody, preserving the
  existing generic Graph read proxy contract. It shall not accept arbitrary Graph
  methods/destinations or return access/refresh tokens to the browser.
- **NFR-004 — performance:** PMO shall open the panel and its loading state before
  awaiting source I/O, request previews only on explicit open/retry, and perform no
  eager preview request per table row or scheduled preview refresh. One active
  document owns the panel; automatic retry loops are excluded.
- **NFR-005 — accessibility:** PMO shall use DESIGN.md tokens and a named dialog,
  keyboard Close/Escape, predictable focus containment/return, titled embedded
  content, image alternatives and announced loading/error states. Panel controls
  shall remain usable at 320px viewport width without horizontal page scrolling.
- **NFR-006 — compatibility:** PMO shall preserve existing file-size and upload-type
  validation from `src/lib/fileConstants.ts` (currently 5 MiB and its allowlist).
  Preview type support does not silently widen upload acceptance or introduce a
  second file-size policy. Existing legacy Office files receive best-effort preview
  and Download without requiring a new legacy-format upload promise.
- **NFR-007 — persistence:** PMO shall keep one durable source per attachment,
  preserve revision and evidence relationships, and make any schema migration
  additive/reversible without deleting existing uploaded bytes or Microsoft files.
- **NFR-008 — localization:** PMO shall provide English and Indonesian copy for
  controls, loading, access, expiry, unsupported-file and upload recovery states.

## Acceptance criteria and owning layer

AC identifiers below are scoped to this feature. Tests must tag their titles
`document-preview AC-###`; plans must retain this namespace when allocating any
repository-wide journey IDs. Each row has exactly one owning layer.

| ID | Given / When / Then | Owning layer | Requirements |
| --- | --- | --- | --- |
| AC-001 | Given project, purchase, budget, folder-child and receipt/evidence document entry points, when each Preview action is selected, then each invokes the same panel contract without opening a tab and retains the surrounding record state. | Unit (parameterized RTL surface adapters) | FR-001/002/015 |
| AC-002 | Given an authenticated user and a real authorized private project PDF, when they open it from Documents and close the viewer, then the PDF response renders inside PMO and the original route and selected project remain in place. | E2E (one curated real Storage-to-viewer journey) | FR-001/008 |
| AC-003 | Given the caller can read a Microsoft reference and has their own connection, when they request preview, then the shipped handler performs only the dedicated preview operation and returns an ephemeral embeddable result without changing consent or exposing tokens. | Unit (shipped edge handler with mocked Microsoft transport) | FR-003, NFR-002/003 |
| AC-004 | Given Microsoft denies access or the viewer has no usable connection, when Preview is selected, then the panel gives the appropriate plain-language access/connect recovery and a source action, and no alternate user's connection is used. | Unit | FR-004/013 |
| AC-005 | Given private PDF/image and Office fixtures, when each is opened, then PDF/images use native rendering and Office uses the public online viewer with a newly acquired short-lived URL; unsupported or failed preview leaves Download accessible. | Unit (renderer/source matrix) | FR-005/008/009/010 |
| AC-006 | Given an expired/failed preview and a second file selected while its request is pending, when the user retries or switches files, then Retry requests fresh access and the first file's late result cannot appear for the second file. | Unit | FR-011 |
| AC-007 | Given a connected organization, an editable record and its SharePoint folder, when an upload succeeds, then the upload targets that folder and the durable result identifies the Microsoft file used by the same Graph preview adapter. | Unit (shipped upload handler and repository contract) | FR-006 |
| AC-008 | Given a connected organization with an unavailable folder, connection, write capability or failed upload, when upload is attempted, then recovery is shown, the previous attachment is unchanged, and no private-Storage fallback or false success occurs. | Unit | FR-007 |
| AC-009 | Given an organization without M365, when an allowed file is uploaded, then the private-upload flow is selected, existing size/type constraints apply, and Download remains usable regardless of preview support. | Unit | FR-008/010, NFR-006 |
| AC-010 | Given authenticated roles and records in two organizations, when attachment/reference read or new source fields are read/written directly, then existing parent visibility, organization isolation, write-role and controlled-document lifecycle contracts hold for both storage-backed and Microsoft-backed attachments. | pgTAP (typed source persistence and RLS contract) | FR-013/014, NFR-001/007 |
| AC-011 | Given a read-only user or impersonated role viewing a readable document, when the panel opens, then read actions work and mutation affordances remain gated by the real-role/record permission policy. | Unit | FR-013/014 |
| AC-012 | Given an issued/approved document with a pin and drift state, when latest content is previewed or pinned content is unavailable, then the version/source labels are accurate, the historical action is retained, and no status, approval or financial/evidence value changes. | Unit | FR-012 |
| AC-013 | Given the panel in loading, ready, denied and unsupported states in either language, when keyboard users open, traverse and close it at desktop and narrow viewport sizes, then controls are reachable, content is named, focus returns and the rendered panel has no axe violations. | Unit (RTL, axe and responsive component fixtures) | FR-002, NFR-005/008 |
| AC-014 | Given an unauthorized or unreadable typed record identity, when the preview/upload handler is invoked directly, then it returns a sanitized refusal before any Microsoft or signed-link operation, irrespective of client UI state. | Unit (shipped handler boundary; mutation-check authorization branch) | NFR-001/003 |

Provider-internal Office rendering is not a deterministic local-test oracle. The
build plan must retain a bounded provider proof with non-sensitive fixtures for
Graph embedding and public-Office fetch compatibility; it must not claim an iframe
`load` event proves Office content rendered. No such live proof is performed by
this docs-only task.

## Affected artifacts (existing code inspected)

Paths are relative to the repository root; proposed new files are labeled explicitly.

| Surface | Exact artifacts / responsibility |
| --- | --- |
| Shared viewer | New `pmo-portal/src/components/documents/DocumentViewer.tsx` and source adapter tests; reuse `pmo-portal/src/components/ui/Drawer.tsx` overlay behavior; consolidate `pmo-portal/src/components/ui/ReceiptPreview.tsx` rather than add a parallel viewer |
| Project files | `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx`, `pmo-portal/src/components/FileCell.tsx`, `pmo-portal/src/hooks/useFileUpload.ts`, `pmo-portal/src/hooks/useDocuments.ts`, `pmo-portal/src/lib/db/documents.ts` |
| Microsoft references | `pmo-portal/src/components/m365/LinkedDocumentCell.tsx`, `LinkedFolderFiles.tsx`, `LinkedDocumentVersions.tsx`, `BudgetDocumentLinks.tsx` in that directory; `pmo-portal/src/lib/m365/reference.ts`, `graphClient.ts`, `recordFolders.ts` |
| Purchases | `pmo-portal/pages/procurement/ProcurementMicrosoftReferences.tsx`, `ProcurementFilesSubsection.tsx`, `LedgerFileCell.tsx`; `pmo-portal/src/hooks/useProcurementFiles.ts`; `pmo-portal/src/lib/db/procurementFiles.ts` |
| Other existing evidence viewer callers | `pmo-portal/pages/expenses/ExpenseReceiptsCard.tsx`, `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx`; retain their parent-authorized URL accessors |
| Budget links | `pmo-portal/src/hooks/useBudgetDocumentLinks.ts`, `pmo-portal/src/lib/db/budgets.ts`; reads remain valid on Active/Archived versions, mutations remain Draft-gated |
| Repository/policy seams | `pmo-portal/src/lib/repositories/index.ts`, `types.ts`; `pmo-portal/src/auth/policy.ts`; `pmo-portal/src/components/m365/DocumentLinkPermissions.tsx` |
| Server | `supabase/functions/m365-token-custody/index.ts`, `types.ts`, `graphRead.ts`, `microsoftTransport.ts`, `recordFolderParents.ts`, `recordFolders.ts`; new dedicated preview/upload modules and tests to be named in the build plan |
| Types/copy | `pmo-portal/src/lib/supabase/database.types.ts`, `pmo-portal/src/lib/fileConstants.ts`; `pmo-portal/public/locales/en/common.json`, `id/common.json` and source-specific namespaces as needed |
| Existing canonical regression anchors | `pmo-portal/src/lib/db/documents.storage.test.ts`, `pmo-portal/src/hooks/useFileUpload.test.ts`, `pmo-portal/src/components/m365/LinkedDocumentCell.test.tsx`, `BudgetDocumentLinks.test.tsx`, `LinkedFolderFiles.test.tsx`; `supabase/tests/0310_document_storage_read_alignment.test.sql`, `m365_doc_linking_rls.test.sql`, `m365_budget_links.test.sql`, `0349_procurement_evidence_files.test.sql` |

### Tables and migration needs

Preview URL generation itself needs no durable preview-URL table or column.
`project_documents`, `procurement_documents` and `budget_version_document_links`
already model Microsoft references; retain their source invariants and typed parents.
Project documents continue to use the Microsoft-reference source after a connected-org
upload; this does not also populate their private `file_path`.

Purchase uploads currently pass through typed attachment tables:
`purchase_request_files`, `rfq_files`, `procurement_quotation_files`,
`procurement_receipt_files`, `procurement_invoice_files`, `purchase_order_files`,
`payment_files`. Supporting new SharePoint-backed uploads there requires an additive,
reversible source/reference representation and corresponding read/write constraints,
RLS/grants, generated types and pgTAP proofs. The plan must choose one representation
consistently rather than encode a Microsoft item in `file_path`. Keep private
`storage.objects` references intact for existing uploads.

No budget amount/status schema change, new budget-upload widget, approval transition
or ERP write is implied. Existing receipt attachments reuse the viewer through their
current source adapters; any expansion of SharePoint upload routing to additional
record kinds must first specify their owning folder rather than invent a destination.

### Authorization and role gates

Preview follows the parent/source read contract, not `can('edit', ...)`. Retain
project `can('create'/'edit', 'document', record context)` and Draft-only replacement;
Microsoft link permissions remain in `useDocumentLinkPermissions`. Purchase writes
retain `procDoc`/`procFile` and phase-specific restrictions; budget link writes retain
`can('edit', 'budgetLine')` plus Draft status. Existing RLS/RPC checks and
approver-versus-author rules remain the enforcement authority (ADR-0016/0019).
The build must prove any new source columns preserve these same contracts; this
spec makes no claim about live database grants or production state.

## Failure behavior

| Condition | User-visible outcome |
| --- | --- |
| Preview loading | Named panel with loading status; Close and appropriate secondary actions remain usable |
| PMO access/session unavailable | Sanitized access/sign-in recovery; no source request for an unreadable record |
| Microsoft account cannot access file | Plain account-access explanation and Open in SharePoint/source; no promise that reconnect grants file access |
| Expired link / service failure | Preview unavailable, Retry for fresh access, Download/Open in source still available subject to authorization |
| Unsupported format or public Office viewer cannot fetch file | Explain preview unavailable and offer Download; do not loop or make the bucket public |
| Connected upload cannot resolve/write folder | Actionable connection/folder/access recovery, no success, previous attachment preserved |
| File has no backing content | Explain that no file is attached; no fabricated preview or dead Download |

## Out of scope

- Editing/annotating files in PMO, OCR, conversion servers, full-text indexing,
  scheduled sync, preview prefetch and offline caching.
- Expanding Microsoft preview permissions, using another person's credentials,
  arbitrary Graph writes, or running tenant grants as part of viewer rollout.
- Bulk movement of existing uploads, automatic external-file deletion, changes to
  lifecycle/SoD, budget figures, procurement status or ERP authority.
- New upload widgets for surfaces that currently only link documents; new file
  categories, higher upload limits, audio/video/CAD rendering or guaranteed preview
  of every Microsoft-protected format.
- Conversation input uploads and model ingestion are a separate attachment
  lifecycle; this feature does not move those transient inputs into record folders.

## Implementation handoff checklist

- [ ] Obtain owner spec sign-off; design the side panel and complete source adapters.
- [ ] Define the bounded Graph preview and record-folder upload operations, preserving
  ADR-0060/0089 boundaries and verifying existing write capability before implementation.
- [ ] Specify the reversible purchase-attachment source migration and AC-010 pgTAP proof.
- [ ] Implement the common viewer and wire every scoped entry point, preserving
  parent permissions, legacy uploads and controlled-version semantics.
- [ ] Add AC-tagged tests at the owning layers above and the curated real-file journey;
  verify provider embedding with non-sensitive fixtures and reliable fallback behavior.
- [ ] Apply the repository's local targeted gates, rendered proof and CI gates to
  the eventual code changes; no implementation checks are claimed by this spec.

## Open questions

No further product question is required for the three decided record surfaces.
The implementation design must settle the upload transport, source-schema shape,
folder recovery and embedding compatibility without weakening the decisions above.
If a new record kind needs SharePoint upload routing, its folder ownership is an
additional scope decision, not permission to silently fall back to private Storage.
