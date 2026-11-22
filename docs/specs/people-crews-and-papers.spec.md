# People, crews and their papers (fix/walk-people)

A first-time-person walk of the released build, as an HR manager and as the Administrator, found eleven places where a person
could not do the job or was misled. Each is stated as a requirement and an acceptance criterion. Owning layer in brackets.

## Requirements (EARS) and acceptance criteria

**FR-PCP-001 (mark as left).** When an Admin marks a person as left on a day, the system shall move the person to former staff,
end every crew placement that was running that day the day before, and remove placements not yet started; history stays.
- AC-PPL-LEFT-001..002 (pgTAP `person_mark_left.test.sql`): the function is security definer, keeps the active-member and light-account assertions, anon cannot call it.
- AC-PPL-007 (Vitest `people.test.ts`, `People.test.tsx`): the register offers "Mark as left" with a day that starts as today; the call carries the person and the day.

**FR-PCP-002 (failed invitation).** If an invitation cannot be sent, the system shall say in the reader's language that it was not sent, that nothing was saved, and what to do, and keep what was typed.
- AC-PCP-002 (Vitest `AdminUsers.test.tsx`): a transport failure shows "The invitation was not sent", never "non-2xx".

**FR-PCP-003 (job role while inviting).** Where built-in roles are on, the invite dialog shall ask the job role (searchable, grouped by access level) and derive the access level from it.
- AC-PCP-003 (Vitest `InviteForm.jobRole.test.tsx`, `adminUsers.test.ts`).

**FR-PCP-004 (terminology).** The terminology screen shall offer role names beside the terms, one save per term and per role, and use a renamed term exactly as typed. The Bahasa default for work order shall be one word everywhere.
- AC-PCP-004 (Vitest `AdministrationTerminology.test.tsx`, `AdministrationRoleNames.test.tsx`, `orgTerms.test.ts`).

**FR-PCP-005 (no risky defaults).** A new medical document and a leave request shall start with no status and no person chosen.
- AC-PCP-005 (Vitest `ExpiryDocumentsCard.test.tsx`, `LeaveRequestForm.defaults.test.tsx`).

**FR-PCP-006 (crew role).** The crew roster shall name people whose crew role is not set, say why the figures are short, and offer the action to set it; "crew role" and "access level" shall be two different words.
- AC-PCP-006 (Vitest `WorkOrderRoster.test.tsx`, `CrewList.test.tsx`).

**FR-PCP-007 (one field, flags).** Adding a person to a crew shall use one pick-or-type field. A Foreman or Field user whose login is not linked to a person, or whose person is in no crew, shall be flagged to the Admin with the action that fixes it.
- AC-PCP-007 (Vitest `CrewList.test.tsx`, `UserDirectory.fieldSetup.test.tsx`).

**FR-PCP-008 (clearance from documents).** A checklist item may name a document type; its date and expiry then come from the person's document. Date done starts as today; Remove is not beside Edit.
- AC-CLD-001..005 (pgTAP `clearance_item_document_type.test.sql`); Vitest `PersonClearance.test.tsx`.

**FR-PCP-009 (leave approver and result).** A leave request shall name who decides it, and the requester shall be notified of the result in their language.
- AC-LVR-001..004 (pgTAP `leave_approver_and_result.test.sql`); Vitest `notificationCopy.test.ts`, `LeaveRequestForm.defaults.test.tsx`.

**FR-PCP-010 (scheduled report).** "Send this report every …" shall be reachable on the report, and the Scheduled reports section shall always be shown to the Admin.
- AC-PCP-010 (Vitest `ScheduleThisReport.test.tsx`, `ScheduledReportsSetting.test.tsx`).

**FR-PCP-011 (small ones).** A file that is exactly the template skips column matching; the crew screens remember the last work order; the Administration sections are listed on a phone; "Choose file / No file chosen" and date and time parts read in the app language.
- AC-PCP-011 (Vitest `useImportWizard.test.tsx`, `WorkOrderRoster.test.tsx`, `FormFields.test.tsx`).

## Rules kept
The database stays the authority. Mark as left is Admin-only, as archiving a person always was. Who may read medical documents is unchanged.
