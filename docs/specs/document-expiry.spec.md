# Document expiry for people and equipment — #2527 (map #2516)

**Job story:** When a work permit, certificate or equipment certificate is about to lapse, the people who must renew it want a warning with enough lead time, so no one works or operates with an expired document.

## Scope and decisions
- **Person record.** No PMO person table exists (`employee-roster.spec.md` is proposed, unbuilt). This increment adds the smallest one: `people` (code, name, optional profile link, optional manager). The roster increment may adopt or extend it. No payroll, contact or identity data.
- **Documents.** `expiry_documents` belong to a person or an equipment asset (`equipment_assets`, 0447) and have an org-defined type (`document_types`), number, issue and expiry date, a physical location note and an attachment reference.
- **Medical** types hold a status (fit / unfit) and a date only; number, note and attachment are refused by constraint.
- **HR** is the Admin role (no separate HR role exists). Per-type `notify_roles` is the recipient filter; defaults: person → Admin, equipment → Admin + Project Manager. A person's manager is always a recipient.
- **Channels.** In-app notification via `notify_workflow_user` (0237). No email channel exists for notifications today (ADR-0044 §5 leaves a channel seam), so email is out of scope.
- **Attachment upload.** Only the reference column is stored; the storage bucket and upload UI are a follow-up.

## Requirements (EARS)
- **FR-DEX-001** The system shall store person and equipment documents with type, number, issue date, expiry date, location note and attachment reference, scoped to the organisation.
- **FR-DEX-002** While a document type is medical, the system shall store only a status (fit/unfit) and dates, and only Admin and the holders of the medical-documents capability (built-in HR roles, Administrator) may read it, in the app and in the expiry email.
- **FR-DEX-003** When a document is within a configured threshold (default 30, 14, 7 days; 1–5 values per organisation), the daily run shall notify the person's manager, holders of the type's `notify_roles` and, when the type says "also tell the person", the person, once per document, expiry date, threshold and recipient. See `expiry-to-manager.spec.md`.
- **FR-DEX-004** When the run is late, it shall send only the smallest threshold already crossed. Renewing (a new expiry date) restarts the sequence. Expired documents are not warned again.
- **FR-DEX-005** The expiry list shall show every unarchived document expiring within N days (default 30, max 365), including already-expired ones, honouring the caller's read rights.
- **FR-DEX-006** Admin keeps all documents, types, people and the warning days; a Project Manager keeps equipment documents. A manager reads their reports' non-medical documents. A holder of the people-documents capability reads, adds and renews every person's non-medical documents and reads the person list. Server-side RLS and column grants enforce this; `is_medical` is stamped by trigger.

## Acceptance criteria
- **AC-DEX-001** Given a new type with no recipient list, then person types default to Admin and equipment types to Admin + Project Manager. *(pgTAP)*
- **AC-DEX-002** Given a medical type, then a number is refused, `is_medical` is stamped, and no notification discloses fit/unfit. *(pgTAP)*
- **AC-DEX-003** Given documents 30/20/15 days out on a run date, then manager, HR and equipment roles are each notified once and unrelated users never. *(pgTAP)*
- **AC-DEX-004** Given the same run date twice, then nothing more is sent; given a later date crossing 14 and 7 days, only the new crossings are sent, the 7-day one `critical`. *(pgTAP)*
- **AC-DEX-005** Given each role, org and manager relation, then reads and writes match FR-DEX-006. *(pgTAP)*
- **AC-DEX-006** Given a 15-day and a 30-day window, then the list returns only documents inside it. *(pgTAP; page render: Vitest)*
- **AC-DEX-007** Given a client insert of `is_medical`, then it is denied. *(pgTAP)*
- **AC-DEX-008** Given Admin vs PM, then only Admin sets the warning days, stored sorted and unique. *(pgTAP)*
