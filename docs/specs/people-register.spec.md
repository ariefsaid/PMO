# People register — #2542 follow-up (map #2516)

Builds on `document-expiry.spec.md` (#2527) and `expiring-documents-edit.spec.md` (#2542). The `people` table (0970) is the workforce register: anyone who holds expiring documents, whether or not they use the app. Nothing creates people rows today, so an Admin cannot add a first document for a person. This increment adds the register screen.

**Job story:** When someone joins the workforce, the records keeper wants to add them to the register, so they can record the person's first expiring document and the warnings start.

## Scope and decisions
- **Where.** A "People" section under Administration (`/administration/people`). Each row opens the existing person record (`/equipment/people/:personId`), which already has Add document.
- **Who.** Admin writes (HR maps to Admin). Project Manager, Finance and Executive read the register through the existing 0970 read policy; no one else. The Add, Edit and Archive controls follow `can(action, 'person', ctx)`; RLS and the column grants are the authority (ADR-0016).
- **Fields.** Name (required), person code, optional job title, optional link to an app user profile. The manager column stays as is and is not edited here.
- **Code.** When left blank the database assigns the next `P-NNNN` for the organisation (`P-0001`, `P-0002`, …). The code is editable and unique per organisation among live people (0970 index). Generated numbers never reuse an archived person's number.
- **No auto-creation.** App users do not become people automatically; an Admin links a profile only when it is true.
- **Archive, not delete** (ADR-0018). An archived person leaves the register, the expiry list and the warnings (0971, 0972 already filter it).
- **Migration 1008** adds `people.job_title`, the code generator and the column grants. It is reversible.
- **Out of scope.** Restoring an archived person, bulk import, editing the manager link, the employee roster.

## Requirements (EARS)
- **FR-PPL-001** When an Admin adds a person with a name, the system shall create the person in the Admin's organisation.
- **FR-PPL-002** When the code is blank on insert, the database shall assign the next `P-NNNN` for that organisation, serialised so concurrent inserts never collide, and never reusing an archived code.
- **FR-PPL-003** The code shall be unique per organisation among live people; a duplicate shall be refused and the field named.
- **FR-PPL-004** When an Admin edits a person, the system shall update name, code, job title and linked profile only.
- **FR-PPL-005** When an Admin confirms archive, the system shall soft-archive the person and hide them from the register.
- **FR-PPL-006** Where the user's role may not write people, the screen shall show no add, edit or archive control.
- **FR-PPL-007** If a linked profile already belongs to another live person, the system shall refuse and say so.
- **FR-PPL-008** When a row is chosen, the system shall open that person's record, where documents are added.
- **FR-PPL-009** The register shall never show or accept another organisation's people or profiles.

## Acceptance criteria
- **AC-PPL-001** Given an Admin, when they add a person with a blank code, then the row exists with `P-0001`, and the next gets `P-0002`. *(pgTAP)*
- **AC-PPL-002** Given a code typed by the Admin, then it is kept; a live duplicate is refused (23505); an archived person's code can be reused by typing it. *(pgTAP)*
- **AC-PPL-003** Given Finance, an Engineer, or a Project Manager, then inserting, updating or archiving a person is denied. *(pgTAP)*
- **AC-PPL-004** Given a second organisation with its own people, then an Admin sees none of them, cannot update them, cannot link their profile, and each org numbers from `P-0001` independently. *(pgTAP; second-org probe rows)*
- **AC-PPL-005** Given the Add form, when only a name is entered, then the create call carries the name and no `org_id` and no code. *(Vitest)*
- **AC-PPL-006** Given an existing person, when they are edited, then the update carries only name, code, job title and profile. *(Vitest)*
- **AC-PPL-007** Given a person, when archive is confirmed, then the archive call is made and the row leaves the list. *(Vitest)*
- **AC-PPL-008** Given each role, then `can()` on `person` matches the RLS (Admin writes; view-as is view-only). *(Vitest)*
- **AC-PPL-009** Given a duplicate-code error, then the form names the code field. *(Vitest)*
- **AC-PPL-010** Given an Admin on the register, when they add a person and then add that person's first document, then the document is listed on the person's record. *(Playwright, one journey)*
- **AC-PPL-011** Given Bahasa Indonesia, then the screen has no English-only strings. *(Vitest bahasa test)*
