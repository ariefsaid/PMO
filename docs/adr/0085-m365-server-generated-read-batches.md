# ADR-0085 — Server-generated Microsoft document read batches

- **Status:** Proposed for Director implementation review; required before the batch adapter is exposed.
- **Date:** 2026-10-14
- **Scope:** Issue #1020's user-triggered controlled-file verification transport, not a general Graph batch API.
- **Related:** [Linked-document drift](0071-linked-document-content-drift.md), [Graph token custody](0060-microsoft-graph-token-custody.md), [Integration architecture](0063-microsoft-365-integration-architecture.md), [signed specification](../specs/m365-onedrive-doc-linking.spec.md), [implementation plan](../plans/2026-10-14-m365-doc-linking.md).

## Context

The signed specification requires read-only linking and lazy controlled-file checks. The drift decision requires Graph batches of at most twenty reads. Graph's batch envelope uses POST even when every enclosed operation is GET. Treating an outer POST as ordinary write-scope consent would conflate transport with authority; exposing arbitrary caller-authored batches would unnecessarily enlarge the feature's API.

## Decision

Implement a separate internal read-batch adapter inside the existing custody runtime. The browser supplies only typed PMO document IDs to `check_documents`; the server loads caller-readable references, claims stale checks and builds the batch. Every enclosed request is a relative, normalized item-metadata GET with an explicit metadata projection. The adapter accepts at most twenty entries, assigns its own request IDs, rejects bodies, custom headers, dependencies and non-metadata routes, and applies the existing read scope gate independently to every entry. Only the fixed Graph batch endpoint receives the envelope POST. No caller-authored batch endpoint, nested write, content endpoint, download URL or additional consent scope is introduced.

Use the caller's own connection through the same connection-resolution, refresh and custody path as ordinary `graph_proxy` GETs. Return only allowlisted metadata or stable opaque failure codes. Each subresponse is handled independently; one refused item cannot erase successful sibling results. Do not automatically retry rate limits or retry an entire batch.

Claim stale project-file checks with a server-only, expiring generation token on the document row. Commit a result only when the claim, drive/item identity and frozen baseline still match. Recheck actor membership and org at the commit boundary. A sixty-second lease coordinates concurrent displays without holding a database transaction across a network call. Claims are implementation metadata, not evidence that a check succeeded. Failure leaves the last successful verification time untouched and reports an unverified result; lease expiry permits a later user-triggered retry.

Freeze on Issue is a separate server-mediated metadata/version read followed by one guarded database transaction. It is not a browser-authored baseline and does not wait for a stale-check lease.

## Consequences

- Preserves the read-only feature contract while meeting the drift decision's batching requirement.
- Keeps credentials and Graph request construction inside the existing custody runtime; no new credential owner or connection model.
- Bounds work and avoids per-row browser invokes; additional displayed pages are checked only when displayed.
- Requires independent transport, tenancy, lease-fencing and served-handler tests, including mutation checks, before UI use.
- A slow response may lose its lease and be discarded. That is safer than publishing stale verification; the user can retry.
- No scheduling, watermark, change feed or folder-descendant scan is added. The adapter is reversible with the feature migration and router additions.
