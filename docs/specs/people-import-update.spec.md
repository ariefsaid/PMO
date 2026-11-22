# Spec: People import matches on person code, updates existing, previews changes (people-import-update)

**Status:** Phase A (verify + spec). IDs `FR-PIU-###`, `AC-PIU-###`. Plan: `docs/plans/2026-11-22-people-import-update.md`. Parent: `docs/specs/field-data-import-templates.spec.md` (FR-IMT-012, FR-IMT-015, OD-IMT-2), `docs/specs/people-register.spec.md`.

## Job story

When I upload today's export of the workforce list, I want existing people matched by their code and updated, new ones added, and a preview of what will change before I confirm, so that I can run the sync myself, every day, without retyping or creating duplicates.

## Today (verified, base land/fix-1122 fc42e1a0)

- An import exists: Administration > People has an Import button (`pmo-portal/pages/admin/People.tsx:103,156`) on the shared wizard (`pmo-portal/src/components/import/ImportWizard.tsx`, `useImportWizard.ts`), descriptor `makePeopleImportDescriptor` (`pmo-portal/src/lib/import/employeeDescriptor.ts:14-35`).
- It matches on a person code, but only to skip: `existingKeys: keyedAlready(existingCodes,'code',...)` (`employeeDescriptor.ts:28`, `importShared.ts:22-31`) lowercases and trims the code and flags a match as "already there". The codes come from `repositories.people.list()` (live people only, `db/people.ts:37-43`).
- It never updates: the only write is `create: repositories.people.create` (`employeeDescriptor.ts:34`); the wizard commit loop calls `descriptor.create` per valid row and counts `created` / `skipped` (`useImportWizard.ts:196-237`). A changed name for an existing code is dropped, silently as "already there".
- It previews, but not changes: the preview shows Valid / Skipped per row and counts "n valid, n invalid, n already there" (`ImportWizard.tsx:457-458,552`). Zero writes until the confirm button.
- Fields read from the file: code and name only (`employeeDescriptor.ts:6-7,29-33`). `job_title` is an editable register field (`PersonInput`, `db/people.ts:23-28`) but is not importable.
- Update path exists: `updatePerson(id, {name, code, job_title, profile_id})` writes all four columns (`db/people.ts:54-59`); it would overwrite `job_title` and `profile_id` with whatever is passed, so the import must not reuse it as is.
- Who may write (RLS, `supabase/migrations/1035_crews_roster.sql:57-66`, last restatement of `people_update`/`people_insert`): Admin and Project Manager, active member, own org. Column grants allow update of code, name, profile_id, manager_id, archived_at (0970:153) and job_title (1035:66). The screen gate is stricter: `can('create','person')` is Admin only (`src/auth/policy.ts:343`). Unique among live people: `people_code_live` (0970:25). (Policy bodies read from migrations; the sandbox DB was not running, so `pg_policies` at head is to be confirmed in the wave run.)
- Precedent for update-on-import with preview: none in the wizard (rate catalogue updates inside its `create`, `rateCatalogueDescriptor.ts:127`, with no preview of the change; the field-data spec says a different value for an existing key is a row error, OD-IMT-2, FR-IMT-009). People is a different case: the job story asks for update.

Verdict: the ask is NOT answered today (match yes, update no, change preview no). No migration is needed: RLS and grants already allow Admin/Project Manager to update name and job title.

## Requirements (EARS)

- FR-PIU-001 When the file's person code (trimmed, case-insensitive) equals the code of a live person, the importer shall treat the row as an update of that person; otherwise as a new person.
- FR-PIU-002 The people template shall have Employee code, Display name, and optional Job title and Manager email columns (template version 2; version 1 files are still accepted). No salary, contact, tax, bank, location or login-link data is read.
- FR-PIU-013 (manager key, steering 2026-11-22) The manager is named by the manager's sign-in email, the one unique, human-known key on a profile that every active member can already read (the register's manager link is an app user, who need not be a person in the register, so a person code would not always exist). The match is case- and space-insensitive and only active users match. An unknown or disabled email is a row error naming "Manager email". A blank cell leaves the stored manager; a manager is set or changed, never cleared. `people.manager_id` is already writable (insert and update grants, 0970).
- FR-PIU-003 (blank rule) When a cell for an update row is blank, or the column is not in the file, the importer shall leave the stored value unchanged. It shall never clear a field. A person absent from the file is never changed, archived or deleted. Display name is required on every row, so it is never blank.
- FR-PIU-004 When the file value equals the stored value (trimmed), the row shall be "No change" and shall write nothing.
- FR-PIU-005 The preview shall list every row as New, Will update (naming each field with stored value and new value), No change, or Invalid (with the reason), with counts of each, and shall perform zero writes. The confirm button states what it will do ("Add 3 and update 12"), and is disabled with a reason when nothing would change.
- FR-PIU-006 When the code matches only a former (archived) person, the row shall be New. The importer shall not reactivate or edit former staff. (Codes are unique among live people only, so this does not collide.)
- FR-PIU-007 When a code appears twice in the file (ignoring case and spaces), each repeat after the first shall be a row error naming the first row.
- FR-PIU-008 When the confirm runs, each update shall go through a people repository `update` that writes only the changed importable fields (`name`, `job_title`), never `code`, `profile_id` or `manager_id`; a row the caller's RLS refuses (or that no longer exists) is reported as failed with a sentence saying who can change people, and the rest continue (per-row best effort, as the wizard does).
- FR-PIU-009 Re-importing the same file immediately shall report every row as No change and write nothing (idempotent, FR-IMT-015).
- FR-PIU-010 If the existing-people read fails, the wizard shall refuse to confirm (an update preview cannot be shown) with a retry, rather than guess; this differs from today's insert-only behaviour, where a failed read never blocks.
- FR-PIU-011 The result step reports added, updated, no change, and failed counts, and the failed-rows file (existing) lists failures.
- FR-PIU-012 The Import button stays gated by `can()` (Admin today) and RLS; org is never read from the file or client. All new strings in English and Bahasa Indonesia, including refusal sentences in `src/lib/refusals.ts`. Layout works at 390px and 1440px; status is conveyed by text, not colour alone.

## Person document import (steering 2026-11-22)

One downloadable template, ONE sheet: **Person code, Document type, Number, Issue date, Expiry date** (document name in the wizard: "Import documents", beside "Import people" on the People screen).

- FR-PDI-001 A row names a live person by person code and an active person document type by name; an unknown person or type is a row error naming the field. Dates are year-month-day; expiry is required; an issue date after the expiry date is a row error.
- FR-PDI-002 (match) When the person has a live (not archived) document of that type, the row updates it: the one expiring last when there are several. Otherwise the row adds a document. A person code and type repeated in the file is a row error naming the first row.
- FR-PDI-003 (blank rule) A blank number or issue date leaves the stored value. The note, attached file and archived state are never touched; nothing is archived or deleted.
- FR-PDI-004 The preview shows New, Will update (each changed field, old to new), No change and Invalid, with counts, and writes nothing; the confirm states "Add n and update m" (same wizard, same machinery as people).
- FR-PDI-005 (who may write, one rule) The Import documents button and every write use the rule the person page's Add document already uses: `can('create','expiryDocument',{record:{kind:'person',medical:false}})`, which on the merged role-capabilities branch (origin/feat/role-capabilities-one-gate, commit ebaf4808, merged into this branch) is Admin or a holder of the people-documents capability. No second rule is added. The database is the authority: `expiry_documents` insert/update policies (migration 1536 of that branch) refuse any other caller per row, and the row fails with the refusal's sentence.
- FR-PDI-006 (medical) A document type that is medical is never imported, by anyone: its rows are errors telling the person to record it on the person page. A medical document carries a status the sheet has no column for, and writing it stays under the branch's medical rule (Admin only, `actor_may_see_medical_documents` to read).
- FR-PDI-007 The template, its example row, hints, statuses and every message exist in English and Bahasa Indonesia. User docs line: the template and its rules are described in this spec and in the glossary entry **People import**.

## Acceptance criteria (Given / When / Then)

- AC-PIU-001 Given a live person P-0001 "Ana" and a file row P-0001 "Ana Putri", when previewed, then the row shows Will update with "Display name: Ana to Ana Putri" and nothing is written. (unit: descriptor plan + wizard preview)
- AC-PIU-002 Given the same row confirmed, then the person's name is "Ana Putri", `code`/`profile_id` untouched, and the result says 1 updated. (unit: wizard commit with fake repo; e2e journey)
- AC-PIU-003 Given a new code, when confirmed, then a person is created with that code. (unit; e2e)
- AC-PIU-004 Given a row whose job title cell is blank for a person who has a job title, when confirmed, then the job title is unchanged. Same when the column is absent. (unit on repository/DAL payload: blank is omitted)
- AC-PIU-005 Given a row equal to the stored values, then it is No change, counts show it, and no update call is made; re-importing the same file twice leaves everything No change. (unit; e2e)
- AC-PIU-006 Given a code matching only an archived person, then the row is New and the archived person is unchanged. (unit; code-uniqueness is already proven by pgTAP of 0970)
- AC-PIU-007 Given a repeated code in the file, then the second row is an error naming the first. (unit)
- AC-PIU-008 Given a person on the register who is not in the file, then they are unchanged after confirm. (e2e)
- AC-PIU-009 Given a Project Manager or other role the DB refuses to let update, when an update row is confirmed, then the row fails with the refusal sentence (EN and ID) and other rows proceed. (unit with a refusing fake; pgTAP: Admin and Project Manager may update `people.name`/`job_title`, Finance/Executive/Member may not, no other role may — written as a proof of existing RLS, no migration)
- AC-PIU-010 Given the existing-people read fails, then the preview shows an error with Retry and the confirm is disabled. (unit)
- AC-PIU-011 Given the Bahasa Indonesia language, then the status words, field-change lines, button and refusal are in Bahasa Indonesia. (unit locale test)
- AC-PIU-012 Regression: companies, contacts, equipment, crews and other descriptors that use `existingKeys` behave exactly as before (their existing tests stay green unchanged).

- AC-PIU-013 Given a manager email of an active user, then the person's manager is set; an unknown or disabled email is a row error; blank leaves the stored manager; a changed manager previews as stored email to new email. (unit)
- AC-PDI-001 Template columns and the example validates. (unit)
- AC-PDI-002 Unknown person or type, a bad date, issue after expiry: row errors naming the field. (unit)
- AC-PDI-003 A medical type is refused for every role. (unit)
- AC-PDI-004 A repeated person and type in the file is an error naming the first row. (unit)
- AC-PDI-005/006 A live document of the type is updated (the latest-expiring one); none means add; the preview names old to new. (unit; e2e)
- AC-PDI-007 Blank number and issue date never clear; note, file and status untouched. (unit)
- AC-PDI-008 Identical values are No change and write nothing. (unit)
- AC-PDI-009 A new document is created with the person, type and dates only. (unit)
- AC-PDI-010 The button shows exactly when the person-documents rule allows creating a non-medical person document. (unit gate test; pgTAP of the branch, 2718, owns the database side)

## Boundary and design

- Extend the shared wizard, not a people-only screen: `ImportDescriptor` gains an OPTIONAL `matchExisting` block (`load(): Promise<Map<key, record>>`, `keyOf`, `diff(record, cells) -> field changes[]`, `update(record, cells)`, plus the wording). A descriptor without it behaves as today. `RowValidation` gains `action: 'new'|'update'|'same'` and `changes`. The wizard's commit loop calls `update` for update rows. Only the people descriptor opts in.
- People repository gains `updateImported(id, {name?, job_title?})` over a new DAL fn that sends only the given keys, with the existing `assertWriteLanded` guard.
- Mutation check plan: (1) make the blank-cell rule write `null` -> AC-PIU-004 must go red; (2) make `diff` always report changes -> AC-PIU-005/009 red; (3) make the DAL send `code`/`profile_id` -> the payload test goes red; (4) widen the pgTAP role list -> the role proof goes red.
- Glossary: add **People import** (match by person code, update changed fields, never clear, never archive) to `docs/glossary.md`.

## Settings

None. The behaviour is on for every organisation. Old behaviour (already there = skipped) changes to update; this alters no money figure, approval route or visibility, so no setting is needed.

## Open questions for the customer

0. (Resolved by steering, 2026-11-22.) Scope now includes the manager column and the document import above.
1. Should a person who has left (absent from the file, or flagged inactive) be archived by the import? Recommended: no. Out of scope; leaving staff are archived on the register (they stay visible in Former staff). Revisit as its own item with an explicit "Active" column.
2. Which columns are in the daily export beyond code, name and job title (department, manager, site)? Recommended: keep to the three; anything else needs a register field first and is a separate item.
3. Should project managers be allowed to run it? Today the button is Admin-only although RLS also lets Project Manager write. Recommended: keep Admin-only (owner ruling on the register stands).
