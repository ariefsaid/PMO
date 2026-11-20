# Spec: Import templates for crews and crew members (#2551)

**Status:** built on the import wizard and the shared template and failed-rows downloads of #2530. IDs `FR-CIM-###`, `AC-CIM-###`. Plan: `docs/plans/2026-11-20-crews-import.md`. Map #2516. Parent spec: `docs/specs/field-data-import-templates.spec.md` (FR-IMT-013, AC-IMT-010). Roster and schema: `docs/specs/crews-roster-attendance.spec.md` (#2528).

## Job story

When I set up crews for a new site, I want to download a template for crews and another for the people in them, fill both in and import them, and get back a file of the rows that failed, so that I can fix those offline and re-import without retyping the good rows.

## Boundary

- Two descriptors on the existing `ImportWizard`, not one multi-sheet importer: the wizard reads one sheet per run. Import the crews first, then the members. (Deviation from the parent spec's one-workbook wording, FR-IMT-013; the validation it asks for is kept: members are checked against the crews that exist, and overlapping placements are row errors.)
- No new write path and no migration. Crews are created by `crewRepository.create` (the atomic `create_crew_with_roles`), members by `crewRepository.place`. Both run under the caller's RLS grants; `org_id` is never read from the file or sent by the client.
- Template download and the failed-rows file come from the wizard (FR-IMT-001..008) unchanged.

## Requirements (EARS)

**Crews template** (entity "Crews")
- FR-CIM-001 The crews template shall have the columns Crew code, Name, Crew type (`own`|`vendor`), Vendor, Discipline, Field controller, Standard roles, in that order, with one example row and closed lists for crew type and discipline.
- FR-CIM-002 When a row has no crew code or name, or a code over 20 or name over 120 characters, the importer shall reject the row with an error naming the field.
- FR-CIM-003 When the crew type is blank, the importer shall treat it as `own`; any value other than `own` or `vendor` shall be a row error.
- FR-CIM-004 When the crew type is `vendor`, the importer shall require a Vendor that matches exactly one existing company by name; when it is `own`, a Vendor value shall be a row error.
- FR-CIM-005 When a Discipline or Field controller is given, the importer shall resolve it by name against the organisation's disciplines and users; an unknown or ambiguous name shall be a row error naming the field and value.
- FR-CIM-006 When Standard roles is given as `Name=headcount; Name=headcount`, the importer shall create each role with that headcount in the order written; a malformed entry, a headcount outside 1 to 500, a name over 60 characters or a repeated name (ignoring case) shall be a row error.
- FR-CIM-007 When a crew code appears more than once in the file (ignoring case and spaces), every repeat after the first shall be a row error naming the first row.
- FR-CIM-008 When a live crew with the same code already exists, the importer shall list the row as already there, not as an error, so re-importing the same file creates nothing.

**Crew members template** (entity "Crew members")
- FR-CIM-009 The members template shall have the columns Crew code, Person, Standard role, From, To, in that order, with one example row.
- FR-CIM-010 The importer shall resolve Crew code against the organisation's live crews and Person against the people directory by code, then by name; an unknown or ambiguous value shall be a row error naming the field and value.
- FR-CIM-011 When a Standard role is given, it shall be one of that crew's standard roles by name; otherwise a row error.
- FR-CIM-012 From is required and To optional; both are written year-month-day, and To before From is a row error.
- FR-CIM-013 When two rows in the file place the same person on overlapping dates (an open To runs on), every later overlapping row shall be a row error naming the first row. A person who is already placed on overlapping dates in the database is refused at create (`23P01`) and that row appears in the failed-rows file with the plain-words reason.
- FR-CIM-014 When a placement with the same crew, person and From already exists, the importer shall list the row as already there.

**Access**
- FR-CIM-015 The Import buttons shall appear only to those who may `create` a crew (the crew managers); RLS refuses everyone else.
- FR-CIM-016 Every new string shall exist in English and Bahasa Indonesia, template headers included; headers match by label or alias in either language.

## Acceptance criteria

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CIM-001 | Given the crews and members descriptors, when each template is downloaded and read back, then headers equal the field labels in order and the example row validates. | Unit |
| AC-CIM-002 | Given a crews file with a missing code, an unknown discipline, a vendor crew with no vendor and an own crew with a vendor, when validated, then each row fails naming its field. | Unit |
| AC-CIM-003 | Given a crews file with a repeated code, when validated, then the repeat fails and the first row is valid. | Unit |
| AC-CIM-004 | Given "Welder=2; Fitter=3", when imported, then `crewRepository.create` receives roles Welder 2 and Fitter 3 in order, and no `org_id`. | Unit |
| AC-CIM-005 | Given a malformed, zero-headcount or repeated standard role, when validated, then the row fails. | Unit |
| AC-CIM-006 | Given an existing crew code, when previewed, then the row is "already there" (case-insensitive). | Unit |
| AC-CIM-007 | Given a members file with an unknown crew, an unknown person and a role that is not the crew's, when validated, then each row fails naming its field. | Unit |
| AC-CIM-008 | Given two rows placing one person on overlapping dates, when validated, then the later row fails and the first is valid. | Unit |
| AC-CIM-009 | Given a row the database refuses with `23P01`, when imported, then the result lists it with the overlap sentence and the failed-rows file carries its original cells. | Unit |
| AC-CIM-010 | Given a placement that exists with the same crew, person and From, when previewed, then it is "already there". | Unit |
| AC-CIM-011 | Given a user who cannot manage crews, when the Crews page renders, then no Import button appears; a crew manager sees both. | Unit |
| AC-CIM-012 | Given any imported member row, when created, then `crewRepository.place` is called with the resolved ids and no `org_id`. | Unit |

## Errors
| Condition | Result |
|---|---|
| Unknown, ambiguous or blank required reference | Row error naming the field and value |
| Repeat inside the file | Row error naming the first row |
| Already in the database | "Already there" (separate sheet in the failed-rows file) |
| Overlapping placement in the database | Row fails at create with the overlap sentence |
| Over 500 rows | Existing over-cap refusal |
