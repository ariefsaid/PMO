# Work-Order Shared Claim Evidence

**Status:** Draft for implementation (`feat/1124f-quality-evidence`)
**Decision:** `DD-R1124-17` (`docs/decisions.md`)
**Migrations:** `2600_work_order_shared_claim_evidence.sql` (rollback: `rollback/2600_work_order_shared_claim_evidence_down.sql`)

## Context
A work order may be billed across multiple progress claims. Quality and acceptance documents filed once against the work order (on its billing steps, `work_order_billing_step_documents`) previously stayed advisory and did not appear in a claim's evidence (`progress_claim_evidence`) or satisfy the claim's invoice evidence gate without manual re-attachment.

## Requirements (EARS)

- **FR-WQE-001 (Org setting):** The system shall provide a per-organisation boolean setting `organizations.work_order_evidence_reuse_enabled` (off for existing organisations, on for new ones), writable only by an Admin through `set_org_work_order_evidence_reuse(boolean)` and audited by `zz_audit_org_setting_change`.
- **FR-WQE-002 (Claim creation reuse):** While `work_order_evidence_reuse_enabled` is `true`, when `create_progress_claim` creates a claim for a work order, the system shall snapshot every current Issued or Approved project document with a file attached to that work order's billing steps into `progress_claim_evidence` for the new claim.
- **FR-WQE-003 (Open claim propagation):** While `work_order_evidence_reuse_enabled` is `true`, when `attach_work_order_step_document` attaches a document to an empty slot or as an additional document on a work order's billing step, the system shall also link that document into `progress_claim_evidence` for any open (un-withdrawn, un-invoiced, no non-failed ERP revenue outbox entry) claim of that work order.
- **FR-WQE-004 (Replacement & revision immutability):** When a document on a work-order billing-step slot is replaced (`p_slot` already holds a document) or a previously attached document is superseded in `project_documents`, the system shall keep earlier claims' `progress_claim_evidence` rows pointing at the document, status and revision they were created or submitted with, and shall not copy `Superseded` documents onto new claims.
- **FR-WQE-005 (Setting off):** While `work_order_evidence_reuse_enabled` is `false`, `create_progress_claim` and `attach_work_order_step_document` shall not automatically populate `progress_claim_evidence`.
- **FR-WQE-006 (No rights or money change):** No role gains or loses any claim, document, or money permission; document category visibility remains enforced on attach and read.

## Acceptance Criteria

- **AC-WQE-001 (Work-order evidence reused on claims):**
  - **Given** a work order with an Issued/Approved quality document filed on its quality billing step by a Quality Inspector and `work_order_evidence_reuse_enabled = true`
  - **When** first and second progress claims are created for that work order
  - **Then** both claims show the quality document in their Evidence list and satisfy the invoice evidence requirement without re-upload or manual re-attachment.
- **AC-WQE-002 (Open claim populated on work-order attach):**
  - **Given** an open (un-invoiced, un-withdrawn) claim on a work order with no evidence yet
  - **When** the Quality Inspector attaches an Issued/Approved document to their work-order billing step
  - **Then** the open claim receives the document in `progress_claim_evidence` and can raise its invoice.
- **AC-WQE-003 (Replacement preserves earlier claims):**
  - **Given** Claim 1 was created/invoiced with document rev A on a work-order step slot
  - **When** rev B replaces rev A on that slot (or rev A is superseded and rev B is attached) and Claim 2 is created
  - **Then** Claim 1 still points only to rev A with its original status/revision, and Claim 2 points to rev B (and not superseded rev A).
- **AC-WQE-004 (Per-organisation setting):**
  - **Given** an Admin switches `work_order_evidence_reuse_enabled` off for their organisation
  - **When** a new claim is created or a work-order step document is attached
  - **Then** `progress_claim_evidence` is not automatically populated, non-Admins and field accounts are refused by `set_org_work_order_evidence_reuse`, and the change is audited.
