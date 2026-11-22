# People register: former-staff filter — #2703 (map #2516)

Builds on `people-register.spec.md` (#2542 follow-up). That increment added the register and made archiving hide a
person. This one keeps the archive behaviour for everyday lists and adds the view that brings former staff back when
someone needs the history: they stay on record, out of the way by default.

**Job story:** When people leave, I want them kept on record but out of the way, so history stays and lists stay clean.

## Scope and decisions
- **Where.** The People register under Administration (`/administration/people`). No new route and no new table.
- **Former staff is an archived person.** `people.archived_at` already records the departure; this increment reads it
  instead of only hiding it. Nothing is deleted, and no new employment column is introduced.
- **Filter, not a setting.** The ticket allows no client setting. The register opens on **Active**, exactly as today;
  the reader opts into **Former staff** or **All** for that view. The choice lives in the URL so a copied link or a
  refresh reproduces it. Existing organisations therefore see the same default rows and the same warnings as before.
- **Read-only history.** A former-staff row still opens the person record (their documents and history stay). The
  register offers no edit or archive action on a former-staff row: archive is one-way today, and restoring is not part
  of this ticket.
- **Authority unchanged.** Reading archived rows is already allowed by the `people_select` policy to the same roles
  that read the register (Admin, Project Manager, Finance, Executive; a manager their reports; a linked person
  themselves). No migration, policy or grant changes. `can()` remains UX only; RLS stays the authority (ADR-0016).
- **One word per state.** The statuses are **Active** and **Former staff**, used in the filter, the row pill, the
  empty state and the archive confirmation.
- **Languages.** English and Bahasa Indonesia strings ship together.
- **Out of scope.** Restoring a former member of staff, a separate employment-status field, payroll or exit records,
  and any change to the expiry warnings (archived people remain out of those).

## Requirements (EARS)
- **FR-FSF-001** The register shall offer one staff-status view with three values: Active (the default), Former staff
  and All.
- **FR-FSF-002** While Active is chosen, the register shall list only people who have not been archived, unchanged
  from today.
- **FR-FSF-003** When Former staff is chosen, the register shall list only archived people, each named Former staff.
- **FR-FSF-004** When All is chosen, the register shall list active and former people, each row naming its status.
- **FR-FSF-005** The chosen view shall be carried in the URL (`staff=former`, `staff=all`; omitted for Active) so a
  copied link, a Back return or a refresh reproduces the same rows.
- **FR-FSF-006** When a former-staff row is opened, the system shall open that person's record, keeping their history
  readable.
- **FR-FSF-007** The register shall not offer edit or archive on a former-staff row.
- **FR-FSF-008** Where the reader may not write people, the filter shall remain readable and no write action shall
  appear.
- **FR-FSF-009** When the chosen view has no rows, the register shall name that view; it shall offer Add person only
  on an empty Active view to a reader who may create.
- **FR-FSF-010** The register and its confirmation copy shall read in English and Bahasa Indonesia.

## Acceptance criteria
- **AC-FSF-001** Given the register with no view chosen, when it loads, then only rows with no `archived_at` are
  requested. *(Vitest — DAL)*
- **AC-FSF-002** Given the Former staff view, then only archived rows are requested; given All, then archived and
  active rows are requested. *(Vitest — DAL)*
- **AC-FSF-003** Given the register opens, then it asks for the Active view and labels the filter's three choices.
  *(Vitest — page)*
- **AC-FSF-004** Given the reader chooses Former staff, then the register asks for former staff and each row is named
  Former staff. *(Vitest — page)*
- **AC-FSF-005** Given the reader chooses All, then active and former rows are listed, each naming its status.
  *(Vitest — page)*
- **AC-FSF-006** Given a former-staff row, then it links to the person record and offers no edit or archive action.
  *(Vitest — page)*
- **AC-FSF-007** Given the Former staff view with no rows, then the empty state names former staff and offers no Add
  person. *(Vitest — page)*
- **AC-FSF-008** Given the register at a chosen view, then the URL carries that view and a Back return restores it.
  *(Vitest — page, URL)*
- **AC-FSF-009** Given Bahasa Indonesia, then the filter choices, the status pill and the former-staff empty state have
  no English-only strings. *(Vitest — Bahasa page)*
- **AC-FSF-010** Given each role that reads the register, then it can read an archived person of its own organisation
  and no archived person of another organisation; an Engineer who is neither the manager nor the linked profile cannot
  read them. *(pgTAP)*
