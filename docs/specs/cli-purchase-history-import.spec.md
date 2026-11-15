# CLI import of PMO-native purchase history (#1855)

Job story. When an organization with no accounting system has years of purchases that exist only in files, I want to preview and
then import them from the command line, so the project's spend and open payables are true from day one without typing each purchase.

Rulings (owner via Director, 2026-11-15): an imported purchase lands at its furthest step with its documents, counts toward actual
spend, and an unpaid one stays payable by a real approver. It mirrors the accounting-system capture: requester is the importing Admin,
no approver and no approved amount are invented, and a mandatory note records who approved it outside PMO. A row whose project or
vendor does not exist is refused, never created. ADR-0093 (status = furthest document) and ADR-0098 (record, do not re-buy) apply.

## Requirements (EARS)

- **FR-CLIPH-001** The system shall let only an active Admin run the import, in preview and in apply (migration 0890, `import_purchase_history`); any other caller is refused before any row is read.
- **FR-CLIPH-002** When the caller previews, the system shall run every check of the real run, write nothing, and report each row as `create`, `skip` or `refused` with a reason.
- **FR-CLIPH-003** When a row names a project or vendor that is not in the caller's organization (a vendor must be a vendor, not archived), the system shall refuse that row and shall not create the company or project.
- **FR-CLIPH-004** The system shall require, on every row, a note saying who approved the purchase outside PMO; it shall store it in the audit trail and shall set the requester to the importing Admin, leaving approver and approved amount empty.
- **FR-CLIPH-005** The system shall record the row's order, receipt, vendor invoice and payment as ordinary PMO documents through the app's own gates and status derivation, so the purchase takes its furthest document's step; a row with no document is refused.
- **FR-CLIPH-006** When the same `import_key` is sent again with the same row, the system shall skip it; with a changed row, refuse it (`import_key_payload_changed`).
- **FR-CLIPH-007** The system shall never write to an accounting system (every result carries `erp_write: false`).
- **FR-CLIPH-010** Where an accounting system owns the organization's purchasing, the system shall refuse the whole import, preview included (`procurement_externally_owned`); such an organization brings its history in through capture.
- **FR-CLIPH-011** A payment shall come with its invoice: a row with a payment and no invoice is refused (`payment_needs_invoice`).
- **FR-CLIPH-012** While the organization requires approval before payment, a row with a payment shall be refused in preview and apply with the reason `approval_before_payment_on` and a plain message; the payment gate is never bypassed.
- **FR-CLIPH-008** When the organization requires approval before payment, the system shall warn on each unpaid row that it will not be payable (`not_payable:<reason>`) and count them; the row is still imported.
- **FR-CLIPH-009** The command shall check the file's shape and duplicate keys before sending anything, send at most 200 rows per call, and on a transport failure stop and name the keys not saved.

## Acceptance criteria

- **AC-CLIPH-001** Given a Finance or Project Manager session, when it calls the import in preview or apply, then it is refused with 42501 and nothing is written. (pgTAP; CLI exit 2, unit)
- **AC-CLIPH-002** Given an Admin, when the file is previewed, then results list create/skip/refused per row and no purchase or import record exists afterwards.
- **AC-CLIPH-003** Given rows with an unknown vendor, a customer as vendor, another organization's project, a payment that is not its invoice's total, or with no invoice, or no documents, when previewed, then each is `refused` with its reason.
- **AC-CLIPH-004** Given an applied row, then the requester is the Admin, approver and approved amount are empty, and the audit event carries the note; a row without the note is refused.
- **AC-CLIPH-005** Given an invoice-only row, then the purchase is Vendor Invoiced; given a row with a payment equal to the invoice, then it is Paid and the invoice is Paid; a row is settled or open, so a payment that is not the invoice total is refused.
- **AC-CLIPH-006** No import queues anything for an accounting system.
- **AC-CLIPH-007** Given the same file applied twice, then the second run reports every row `skip` and creates nothing; a changed row under the same key is refused.
- **AC-CLIPH-008** Given an applied unpaid row and approval-before-payment off, then a Finance user can pay it through the app's transition; given the setting on, the preview warns `not_payable:gate_approval_before_payment`.
- **AC-CLIPH-010** Given an organization whose purchasing an accounting system owns, then preview and apply are refused with 42501 and nothing is created; given another organization's vendor, it is refused; the same `import_key` in two organizations creates one purchase in each.
- **AC-CLIPH-011** Given a row with a payment and no invoice, then it is refused with a plain message.
- **AC-CLIPH-012** Given approval before payment on and a paid row, then preview and apply refuse it with `approval_before_payment_on` and the message "approval before payment is on: record an approved amount or turn it off for the import".
- **AC-CLIPH-009** Given a malformed file (missing note, bad UUID, no document, duplicate key, unknown field), then the command exits 2 and sends nothing. Server-side malformed values (bad id, date, number, lines) are refused per row with `invalid_value`, `invalid_date` or `invalid_shape`.

Out of scope: approvals history, multi-currency conversion, editing an imported purchase (use the app), the CLI guard-list entry (a later guard-list migration).
