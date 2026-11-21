# CLI undo of an imported purchase (#2321)

Job story. When I have imported a valid but wrong purchase from history (wrong project, wrong vendor, a duplicate under another import
key), I want to preview and then take that one import back from the command line, so a corrected row can be imported and nothing else changes.

Context: `pmo purchases import-history` (#1855, spec `cli-purchase-history-import.spec.md`) creates ordinary PMO purchases and records each
under an `import_key`. Editing an applied row is out of scope (the app edits it), and `purchases undo-record-only` covers captured
accounting-system purchases only. This adds the matching undo for imported purchases. Pattern reused from `undo_captured_purchase`:
Admin only, a required reason, a preview that writes nothing, an audit event.

Ruling recorded here (Director, builder-proposed): the undo **hard-deletes** the import's rows rather than archiving them (a departure from
ADR-0018's soft-archive default). Reason: the import wrote only PMO-native rows and sent nothing to an accounting system; archiving would keep the
import key and the purchase's document numbers and spending in place, so a corrected row could not be re-imported; the audit event keeps the
payload and the reason. The delete is a server-enforced, Admin-only destructive path (ADR-0019).

## Requirements (EARS)

- **FR-CLUI-001** The system shall let only an active Admin undo an imported purchase, in preview and in apply (`undo_imported_purchase`); any other caller is refused (42501) before anything is read. A reason and an import key are required.
- **FR-CLUI-002** When the caller does not pass `p_dry_run = false`, the system shall preview: report what would be removed and write nothing. The command previews unless `--confirm` is given.
- **FR-CLUI-003** When an undo is applied, the system shall remove that import's purchase, its items, its order, receipt, invoice and payment, the status events the import derived and the import record, and no other row.
- **FR-CLUI-004** When an undo is applied, the system shall free the import key, so a corrected row under the same key imports as a new purchase.
- **FR-CLUI-005** When an undo is applied, the system shall write an audit event (`procurement.history_import_undo`) holding the reason, the import key, who imported it and the imported row.
- **FR-CLUI-006** If anything outside the import exists against the purchase, the system shall refuse the undo (`has_later_records`, naming what blocks it) and delete nothing. "Outside the import" means: a document count or an invoice status that differs from what the import created; a status event not derived by the import; a row in any other table that references the purchase (read from the catalog, so a table added later refuses by default); a row that references one of the import's own documents (found the same way, including rows that would cascade with it, such as receipt lines and bill matches); a command queued for an accounting system.
- **FR-CLUI-007** The system shall find the import by key within the caller's organization only; an unknown key, or another organization's key, is `import_not_found`.
- **FR-CLUI-008** The undo shall never write to an accounting system (`erp_write: false`).
- **FR-CLUI-009** The command shall exit 2 when the caller is not an Admin or the arguments are incomplete (nothing sent) and exit 1 when the undo is refused.

## Acceptance criteria

- **AC-CLUI-001** Given no import key, or a blank or missing `--reason`, when the command runs, then it exits 2 and sends nothing. (CLI unit)
- **AC-CLUI-002** Given `undo-import <key> --reason <text>`, when run without `--confirm`, then the call carries `p_dry_run: true`; with `--confirm` it carries `false`. (CLI unit)
- **AC-CLUI-003** Given a refusal (`has_later_records`), when the command runs, then it prints the reason and what blocks it and exits 1; given a non-Admin, then it exits 2. (CLI unit)
- **AC-CLUI-004** Given the latest CLI guard migration, then `undo_imported_purchase` is in the active-Admin tier. (unit, reads the migration; role and method stay with the guard's pgTAP)
- **AC-CLUI-005** Given a Finance user, a Project Manager, a disabled Admin or anon, when it calls the undo, then it is refused with 42501; a blank reason or key is refused (22023). (pgTAP)
- **AC-CLUI-006** Given an Admin, when the undo is previewed (or called with no flag), then it reports what would be removed and the purchase, its documents and its import record still exist and no audit event is written. (pgTAP)
- **AC-CLUI-007** Given several imports and a purchase entered by hand, when one import is undone, then only that import's rows are gone; every other import, the same key in another organization and the hand-entered purchase are unchanged. (pgTAP)
- **AC-CLUI-008** Given an undone import, when a corrected row is imported under the same key, then it is created; a second undo of the key, an unknown key and another organization's key are `import_not_found`. (pgTAP)
- **AC-CLUI-009** Given an applied undo, then an audit event holds the reason, the key and the imported row. (pgTAP)
- **AC-CLUI-010** Given an imported purchase with a later payment, receipt or invoice, an added item, a manual status change, or a row in another table that references it, when the undo is previewed or applied, then it is refused `has_later_records` naming the cause, and nothing is deleted or audited. (pgTAP)
- **AC-CLUI-011** Given an import that carried its own payment and nothing after it, then it can be undone. (pgTAP)

Out of scope: editing an imported purchase; undoing a captured purchase (`undo-record-only`); undoing many imports in one call.
