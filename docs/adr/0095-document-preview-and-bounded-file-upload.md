# ADR-0095 — Document preview and bounded file upload inside Microsoft token custody

- **Status:** Proposed. Becomes Accepted with owner sign-off of the build plan, or with the Director's acceptance as ADR-0089 had.
- **Date:** 2026-10-31
- **Related:** [spec](../specs/document-preview.spec.md), [plan](../plans/2026-10-31-document-preview.md), [token custody](0060-microsoft-graph-token-custody.md), [integration architecture](0063-microsoft-365-integration-architecture.md), [record-folder write](0089-m365-record-folder-write-capability.md), [content drift](0071-linked-document-content-drift.md), [read batches](0086-m365-server-generated-read-batches.md).
- **Ratifies:** FR-003, FR-006, NFR-001/002/003 of the spec; owner decisions 2 and 4 on #1447.

## Context

The owner decided that one in-app viewer opens every document PMO links or stores, and that a connected organisation's new uploads go to the record's SharePoint folder. Two Microsoft operations follow, and neither fits an existing custody action:

- **Preview** is a Graph `POST /drives/{drive}/items/{item}/preview`. The browser `graph_proxy` is GET-only by design, so a preview cannot pass through it.
- **File upload** is a Graph content `PUT`. ADR-0089 authorised exactly one write (folder creation) and states that it does not authorise a general upload transport.

Both change the external-mutation surface of the custody function, so the shape needs a decision, not an undocumented extension.

## Decision

1. **Two new, purpose-built custody actions, no generic writer.** `preview_document` and `upload_record_file`, routed by the existing `m365-token-custody` handler. The browser `graph_proxy` stays GET-only and body-less. ADR-0086's internal GET-only batch adapter and ADR-0089's folder-only writer are unchanged.
2. **Typed identity in, never a URL or a Graph path.** Preview takes a record kind, a record UUID and, for a folder child, one child item id. Upload takes a target kind, a target UUID and the file bytes. The server loads the row under the caller's JWT (RLS decides), derives drive and item, builds the single Graph request itself, and runs it through a per-operation exact-match allowlist immediately before the network call (the `graphFolderWrite.ts` pattern, with mutation witnesses).
3. **The caller's own connection only.** Both actions open the authenticated caller's `ms_graph_connections` row, never another user's and never an application identity. A Microsoft refusal is reported as a Microsoft access problem; PMO never retries with a different identity.
4. **Preview adds no consent.** It needs the Files read scope already held by every connection. The response carries only a validated embeddable URL for the active viewer; the URL is not stored, logged, put in an error body, or returned by any other action. No Graph TTL is assumed, and the browser asks again on expiry.
5. **Upload reuses the ADR-0089 write consent and library.** It requires the stored `Sites.Selected` consent, targets only the record's existing folder reference inside the organisation's default library, never creates a folder (a missing folder is a recovery state), uses simple `PUT` content with rename-on-conflict (never replace), and stays under the existing 5 MiB and file-type policy from `fileConstants.ts`. The owner's separate site grant (ADR-0089 decision 1) is the Microsoft-side limit; no new grant or scope is introduced.
6. **PMO persists after confirmed success, through the existing repositories.** The upload action returns the validated reference. The browser stores it with the caller's own RLS-gated write (project register link, or the new purchase attachment source columns). There is no distributed transaction: a confirmed upload stays in SharePoint if the PMO write then fails, and the recovery is the existing link picker. PMO never deletes the Microsoft file to compensate (same stance as ADR-0089).
7. **Private Storage is unchanged and stays for organisations without Microsoft 365.** PDFs and images render natively from a short-lived signed URL. Office files may use Microsoft's public online viewer with that same short-lived signed URL, which deliberately shares the time-limited file URL with Microsoft; the bucket stays private.
8. **One durable source per attachment.** Purchase attachment tables gain additive nullable `source` and Microsoft reference columns beside `file_path`, guarded by a check that exactly one source is set. A Microsoft item id is never encoded into `file_path`.

## Consequences

- The custody function now has two external-write shapes (folder create, file upload) and one POST read (preview). Each has its own allowlist, tests and mutation witness. A future writer must be added the same way.
- Upload of large files is out of scope: the 5 MiB policy keeps it a single bounded request. Raising the limit later means an upload-session design and a new decision.
- Preview quality for Office files depends on Microsoft's embedding and public-viewer behaviour, which no local test can prove. The plan carries a bounded provider-proof task with non-sensitive fixtures.
- Rollback: the actions are removable without touching stored references; the additive migration drops its columns without deleting any uploaded bytes or Microsoft files (a SharePoint-backed purchase attachment loses its link on rollback, so rollback is rehearsed only before first use).
