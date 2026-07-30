# ADR-0071 — Linked Microsoft 365 documents: content drift is detected, not prevented

- **Status:** Accepted (owner grill 2026-07-29)
- **Date:** 2026-07-29
- **Deciders:** Owner, Director
- **Related:** [ADR-0063](0063-microsoft-365-integration-architecture.md) (M365 integration
  architecture — Graph data follows the ADR-0055 adapter pattern), [ADR-0060](0060-microsoft-graph-token-custody.md)
  (the token-custody runtime this consumes), ADR-0018 (soft-archive), ADR-0019 (server-enforced SoD),
  ADR-0010 (test pyramid). **Spec:** [`docs/specs/m365-onedrive-doc-linking.spec.md`](../specs/m365-onedrive-doc-linking.spec.md).
  **Glossary:** `Document`, `Content drift`, `Revision`, `Superseded`, `Graph connection`.
- **Scope:** what it means for a PMO *controlled document* to be backed by a file PMO does not own.
  NOT the browse/link UX, NOT the token runtime, NOT which Graph scopes are requested.

## Context

PMO's document register is a **controlled** register. The rule, decided 2026-06-12 and binding in the
glossary: a document carries one source, and *once issued, content changes require a new revision*.
"Approved Rev A" is a statement about one exact set of bytes. Revision lineage and Superseded status
exist to make that statement durable and auditable.

M365 document linking (vision §3.2) stores only a **reference** to an item in the client's SharePoint
library or OneDrive — `driveId`, `itemId`, `webUrl`, `name`. Never the bytes. This is deliberate and
was chosen over copy-into-Storage precisely so Microsoft remains the source of truth and the permission
authority.

**These two commitments collide, and the spec did not notice.** Its §1 asserts a linked document
"flows the same Draft→Issued→Approved status workflow" as an uploaded one. It cannot. Three of its own
NFRs close every escape: never copy bytes (NFR-001), Microsoft is the permission authority (NFR-002),
no background sync (NFR-007). PMO therefore holds nothing to compare against and never looks. Concretely:

1. A PM links `Contract-Acme.docx` from a SharePoint library.
2. The document is Issued, then **Approved**. An approver signs off.
3. Anyone with library edit rights changes the payment terms. Ordinary editing; nothing improper.
4. PMO still shows **Approved**, same pointer, same everything. Nothing in PMO changed, because
   nothing about the file *is* in PMO.

The approval now attests to content that no longer exists, with no Rev B and no signal. For the target
customer — contract and project organisations, with approved drawings and signed contracts — that is a
compliance defect, not a rough edge. The spec tracks the item's *name* drifting but not its content.

Under link-not-copy this **cannot be prevented**: PMO does not own the bytes and has no veto over an
edit made in SharePoint. The only real question is what PMO does about it.

## Decision

**1. Detect drift; never claim to prevent it.** PMO records the item's *content* identity when the
document's content freezes, and compares on later reads. Use Graph's **content tag (`cTag`)**, not
`eTag` — `eTag` also moves on metadata changes, so a rename would falsely report content drift.

**2. The freeze point is Draft→Issued.** That is where the 2026-06-12 rule says content freezes;
Approved inherits the same baseline rather than taking a second one. **A Draft cannot drift** — its
content is permitted to change — so drift is a concept only for Issued and above. This removes most
potential badge noise by construction.

**3. A drifted document keeps its status.** An approval is a true historical statement about the
content that was approved; it does not become false because the source moved on. Drift is orthogonal
metadata, not a lifecycle state — adding a "Drifted" status would pollute an enum shared with uploaded
documents, which can never drift.

**4. Drift state is persisted, and visible everywhere the document appears — not just on its own page.**
An unbadged row in a table would otherwise mean "never checked" while reading as "no drift"; those two
must never render identically. Therefore the surface distinguishes **three** states, not two:
`clean` · `drifted` · **`not verified since <time>`**. A revoked or unhealthy connection shows the
last known state with its as-of time, and never a false all-clear.

**5. Re-check is lazy, user-triggered, and throttled by staleness — never a background job.** A linked
document is re-checked when it is displayed and its `ms_last_verified_at` is older than 24h. This keeps
NFR-007 (no scheduled job, no change-feed, no delta query) intact: a table nobody opens is never
checked, and ten users opening the same table costs one check per document, not ten. Checks batch via
Graph `$batch` (20 items per request).

**6. The drift flag is written server-side only**, by the edge function that performed the Graph read —
never by the browser. A client-writable flag would let a user mark a drifted approved contract as clean,
which is forging an audit signal. This follows the existing service-role-write-via-SD-RPC pattern
(ADR-0019); `can()` remains UX-only and RLS remains the ceiling (ADR-0016).

**7. Resolving drift is an explicit user act that re-enters the existing revision flow.** The drift
badge carries the affordance *"make new version from latest file update"*, which re-reads the item,
creates a new revision from its current content with a fresh baseline, and walks the normal
Draft→Issued→Approved lifecycle. The predecessor becomes Superseded when the new revision is Approved.
This satisfies the glossary's Revision rule literally — *"a revision is always created from its
predecessor; that explicit act is what links the lineage"* — the drift prompt **is** that explicit act.
No new permissions and no new role model: `can('create', 'document')` governs it and SoD
(approver ≠ author) applies to the new revision unchanged.

**8. The approved content stays reachable — pin the Microsoft version id at the freeze point.** A
drifted document offers **two** actions, both opening in a new tab: *open the approved version* and
*open the latest version*. Without the pin, clicking "Rev A, Approved" would show today's content and
the audit trail would be decorative. SharePoint document libraries have versioning on by default, which
is what makes this reliable enough to depend on.

**9. The two links are not equally robust, and the UI must say so.** "Open latest" is the stored
`webUrl` — a plain browser URL that works even when the connection is revoked. "Open approved version"
may require a token-mediated read, and can be genuinely unavailable (library versioning disabled, the
version pruned, the item moved or deleted, the connection down). It must degrade to a stated reason,
never a dead link. **⚠ Open — verify on the first live `graph_proxy` call:** whether Graph exposes a
stable browser-openable URL per version, or only version *content*. If only content, that path is
token-mediated and therefore the fragile one of the two. This is on the proof-call checklist
(M365 entry, `docs/backlog.md`) and must be answered before the data model is fixed.

## Alternatives rejected

- **Fence linked documents out of the controlled lifecycle** — they could be attached for reference but
  never Issued or Approved, leaving the 2026-06-12 rule untouched. Rejected: a Teams-native client
  cannot then run their document register on SharePoint, which is much of why they want the integration.
- **Accept it silently** — let linked documents flow the full lifecycle and simply note that content
  control transfers to Microsoft. Cheapest by far. Rejected: it leaves an approved contract able to
  change with nothing in PMO indicating that it did.
- **Amend the 2026-06-12 immutability rule itself** so content control is a property of the source
  rather than of the register. Rejected: the blast radius reaches uploaded documents, which have no
  such problem.
- **Copy bytes into Supabase Storage at approval** — would make the freeze real rather than detected.
  Rejected by vision §3.2 and NFR-M365DOC-001: it duplicates the client's source of truth, which is the
  thing the link model exists to avoid.

## Consequences

- **Positive:** the 2026-06-12 rule survives contact with an external source of truth — PMO learns of a
  content change late rather than gating it, but still *requires* a new revision to restore an approved
  state. Divergence is made self-evident rather than prevented, which is the same instinct already in
  the Milestone model (calculated vs input percent shown side by side). Drift becomes the entry point to
  a workflow that already exists, not a new subsystem.
- **Cost / negative:** a content tag, a version id, and a drift state are added to `project_documents`;
  a displayed table can now trigger Graph reads and a server-side write; and the audit guarantee is
  best-effort by construction — dependent on Microsoft's version retention, which PMO does not control.
- **Risk if skipped:** an Approved document silently misrepresenting its own content, with no signal
  anywhere in PMO — the failure mode that is worst precisely where this product is aimed.

## Notes

The defect this ADR addresses was not found by tests. It was found by reading the spec against the
glossary: the spec claimed lifecycle parity that its own NFRs made impossible. Same class as the
M365 HIGH-A1 finding — *a green suite proves the model it mocks, not the boundary where it breaks.*
