# Handover proof scope and timing (stock settings)

Lane 1124d, decision 1. Not a new proof mechanism: it widens which movements carry the existing handover proof and reuses the existing timing setting.
IDs: `FR-HSC-###`, `AC-HSC-###`. Builds on `docs/specs/stock-two-step-transfer.spec.md` (1305 to 1309) and `docs/specs/stock-movements-awaiting-proof.spec.md`.

**Job story.** When goods leave the store for a project or work order, I want the organisation to be able to require a signed handover document, before posting or following later, so that the storekeeper is never left holding stock that left without proof.

## As is
- `organizations.stock_proof_timing` (`before_posting` default | `may_follow`) already decides when proof is demanded for a one-step transfer of a paper-rule item, and the "proof still owed" card on the stock home already lists the outstanding movements for the storekeeper and stock manager.
- Proof is a signed document attached to the stock document (`stock_document_files`, whoever may attach: author, keeper of the location, Admin).
- Issues to a project (kind `issue`, optionally linked to a work order) never need proof.

## Requirements (EARS)
- FR-HSC-001 The organisation shall hold one setting, the handover scope: `transfers` (default, today) or `transfers_and_issues`. Only an Admin changes it, through `set_stock_handover_scope`, audited.
- FR-HSC-002 While the scope is `transfers`, the system shall behave exactly as before for every movement.
- FR-HSC-003 While the scope is `transfers_and_issues` and the proof timing is `before_posting`, when an issue to a project or work order is posted without a live attached document, the system shall refuse the post (`STK_PAPER_REQUIRED`).
- FR-HSC-004 While the scope is `transfers_and_issues` and the proof timing is `may_follow`, the system shall post the issue and list it, once posted, in the movement proof status read as `outstanding` (missing: paper) until a live document is attached, and as `complete` after.
- FR-HSC-005 The "proof still owed" card shall list those issues (from the project's name to the location) for the people it already serves; no card appears while the timing is `before_posting`.
- FR-HSC-006 The two choices (which movements, and when) shall sit together in Administration, Stock settings, in English and Bahasa Indonesia.

## Default-off
`stock_handover_scope` defaults to `transfers`, so every existing organisation behaves as today. The timing setting is unchanged and shared.

## Acceptance criteria (owning layer)
- AC-HSC-001 pgTAP `2100`: a new organisation is `transfers`; an issue posts with no document; nothing is listed.
- AC-HSC-002 pgTAP `2100`: only an Admin sets the scope; an unknown value is refused; the change is audited.
- AC-HSC-003 pgTAP `2100`: scope `transfers_and_issues`, timing `before_posting`: the issue is refused without a document and posts with one.
- AC-HSC-004 pgTAP `2100`: timing `may_follow`: the issue posts and reads `outstanding/paper`, naming its project.
- AC-HSC-005 pgTAP `2100`: attaching the document later reads `complete`.
- AC-HSC-006 pgTAP `2100`: a transfer of an item with no proof rule still posts.
- AC-HSC-007 pgTAP `2100`: another organisation sees none of these; with the scope back to `transfers` issues are not listed.
- AC-HSC-008 unit `src/lib/db/stockTransfers.test.ts`: the scope is read (default `transfers`) and written through the RPC.
- AC-HSC-009 unit `src/components/stock/TransferModeSettings.test.tsx`: the scope control defaults to transfers and writes the extension.

## Mutation checks (written here, run by the orchestrator)
`mut:scope_issue` (drop the scope condition: AC-HSC-001 goes red), `mut:issue_timing` (drop the timing condition: AC-HSC-004 goes red), `mut:scope_admin` (drop the Admin check: AC-HSC-002 goes red).
