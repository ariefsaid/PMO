# Work-Order Shared Claim Evidence

**Status:** Implementation
**Decisions:** DD-R1124-17, DD-R1124-18
**Migration:** 2600_work_order_shared_claim_evidence.sql (rollback in migrations/rollback)

A work order may be billed across multiple claims. An Admin identifies the billing steps whose documents count as claim evidence; quality documents filed once on those steps can then serve later claims.

## Requirements

- **FR-WQE-001:** The system shall let an Admin designate a billing-template step or an existing work-order step as a source of claim evidence; unmarked steps default off.
- **FR-WQE-002:** When a work order is issued, the system shall copy each template step's designation onto the work order.
- **FR-WQE-003:** When a work-order checklist is saved as a template, the system shall copy its step designations.
- **FR-WQE-004:** When a claim is created or a time-and-materials claim is signed off, the system shall snapshot issued or approved documents with files from designated steps of that claim's work order into its evidence.
- **FR-WQE-005:** When a document is newly attached to an empty slot or as an additional document on a designated step, the system shall add it to open claims of that work order.
- **FR-WQE-006:** When a document is replaced or superseded, the system shall preserve earlier claim snapshots and use the current eligible document for later claims.
- **FR-WQE-007:** When evidence attachment and claim creation, withdrawal or invoicing run concurrently, the system shall serialize them and preserve the submitted evidence snapshot.
- **FR-WQE-008:** The system shall retain existing claim, document and money permissions.

## Acceptance criteria

- **AC-WQE-001:** Given an Admin designates a work-order quality step and an inspector files its document, when a billing officer creates later claims for that order, then each claim shows the document and is eligible for invoicing without re-upload.
- **AC-WQE-002:** Given an open claim of a work order, when an inspector files a document on a designated step of that order, then the document is attached to that claim.
- **AC-WQE-003:** Given an earlier claim has a document snapshot, when the step document is replaced and a later claim is created, then the earlier claim retains its original revision and the later claim receives the current revision.
- **AC-WQE-004:** Given a step has not been designated, when its document is filed or a claim is created, then its document is not automatically attached; only an Admin may change the designation.
- **AC-WQE-005:** Given a time-and-materials claim for an order with a designated document, when an authorised person confirms its sign-off, then it retains signed evidence and includes the work-order document.
- **AC-WQE-006:** Given a work order has designated and undesignated steps, when documents are filed on both, then only documents from the designated step are automatically reused on that order's claims.
- **AC-WQE-007:** Given an Admin designates a template step, when the template is edited or copied onto a work order or saved from an order, then the designation remains with the intended step.
