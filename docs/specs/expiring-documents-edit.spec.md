# Add and edit expiring documents — #2542 (map #2516)

Builds on `document-expiry.spec.md` (#2527). That increment stores, warns on and lists expiring documents; this one adds the screens to add, edit and archive them, and the attachment upload it deferred.

**Job story:** When a certificate or permit is renewed or newly issued, the person who keeps the records wants to add or update it on the person's or equipment's record, so the warnings follow the real expiry date.

## Scope and decisions
- **Where.** A "Documents" card on the equipment asset record (`/equipment/assets/:assetId`) and on a new minimal person record (`/equipment/people/:personId`: name, code, the same card). Rows of the expiring list link to the subject record.
- **Fields.** Type (from the org's types for that kind), number, issue date, expiry date, location note, attachment. A medical type shows a status (fit / unfit) and the dates only; number, note and attachment are hidden (and refused by the 0970 constraint).
- **Archive, not delete** (ADR-0018). Renewing = edit the expiry date; the warning sequence restarts (FR-DEX-004).
- **Authority.** Writes already ride RLS and column grants (0970): Admin any document; Project Manager equipment documents only. `can('create'|'edit'|'archive', 'expiryDocument', {record:{kind}})` mirrors that for the UI only.
- **Attachment.** Private bucket `expiry-documents`, 5 MB, pdf/png/jpeg/webp, path `{org}/{kind}/{subject}/{file}/{filename}`. Storage RLS: Admin any kind; PM equipment; a person's manager reads non-medical person files. Medical documents never hold a file.
- **Out of scope.** Creating people and document types (no screen yet); warning-days setting screen.

## Requirements (EARS)
- **FR-DEE-001** When an authorised user adds a document, the system shall create it for that subject with type, number, issue and expiry dates, location note and optional attachment.
- **FR-DEE-002** When an authorised user edits a document, the system shall update those fields; type and subject are not editable.
- **FR-DEE-003** When an authorised user archives a document after confirming, the system shall hide it from the record and the expiry list.
- **FR-DEE-004** While the type is medical, the form shall offer a status and dates only.
- **FR-DEE-005** Where the user's role may not write the subject's documents, the card shall show no add, edit or archive control.
- **FR-DEE-006** The attachment bucket shall let only the roles in FR-DEX-006 write, and shall refuse paths outside the caller's organisation.
- **FR-DEE-007** If the expiry date is before the issue date, the form shall refuse and name the field.

## Acceptance criteria
- **AC-DEE-001** Given an Admin on an equipment record, when they add a document with type, number and expiry date, then it is listed with that expiry. *(Vitest; repository call asserted)*
- **AC-DEE-002** Given an existing document, when the expiry date is changed and saved, then the update carries only the editable columns. *(Vitest)*
- **AC-DEE-003** Given an existing document, when the user confirms archive, then the row is archived and gone from the card. *(Vitest)*
- **AC-DEE-004** Given a medical type is chosen, then number, note and attachment are not offered and a status is. *(Vitest)*
- **AC-DEE-005** Given roles Admin, Project Manager, Finance on person and equipment subjects, then `can()` matches FR-DEX-006. *(Vitest)*
- **AC-DEE-006** Given expiry before issue, then the save is blocked with a field error. *(Vitest)*
- **AC-DEE-007** Given each role and kind, then storage writes and reads match FR-DEE-006, and cross-org paths are refused. *(pgTAP)*
- **AC-DEE-008** Given a Finance user, then inserting or archiving a document is denied by RLS. *(pgTAP)*
