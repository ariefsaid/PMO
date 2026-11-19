# Spec: Import templates for rates, stock items, equipment, people and crews (#2530)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-IMT-###`, `NFR-IMT-###`, `AC-IMT-###`. Plan: `docs/plans/2026-11-20-field-data-import-templates.md`. Executor: Orca worker per entity (bounded, no money logic of its own; each descriptor reuses its entity's existing create path and so its validation). Map #2516; blocked by #2520 (rate catalogue), #2528 (crews, people) and #2526 (equipment ownership and rental terms).

## Job story

When I set up a new contract or site, I want to download an Excel template for each kind of master data, fill it in and import it, and get back a file of the rows that failed, so that I can fix them offline and re-import without retyping the good rows.

## Context and boundary (what exists today)

- `ImportWizard` and `ImportDescriptor<Input>` (ADR-0027, `pmo-portal/src/components/import/`, `pmo-portal/src/lib/import/`) already parse `.xlsx`/`.csv`, auto-map headers (labels and aliases), validate every row at preview with zero writes, and create one record per valid row through the entity's existing create repository, capped at `MAX_IMPORT_ROWS` = 500. Results carry `created`, `skipped`, `failed: {index, reason}[]`. Descriptors exist for companies, contacts, projects, procurement, budget lines and contract lines.
- Scope of that search: `pmo-portal/src/lib/import` and `pmo-portal/src/components/import` for "template", "failed rows", "download": no template download and no failed-rows file exists today. `pmo-portal/src/lib/export` already has `toWorkbookBuffer`, `toCsv` and `exportFilename`; this spec reuses them.
- This spec adds (1) a generic **template download** and **failed-rows download** to the wizard, usable by every descriptor, and (2) **five new descriptors**. It adds no new write path: each descriptor's `create` is the owning entity's repository function from #2520, #2526, #2528 or the stock module.

## Requirements (EARS)

**Generic wizard additions**
- FR-IMT-001 Where a descriptor declares a template, the wizard shall offer **Download template** on its first step, producing an `.xlsx` whose first sheet has the descriptor's field labels as headers (in the reader's language) in field order, required fields marked, one example row, and a second "Notes" sheet listing each field's meaning, accepted values and whether required (from `hint` and the validator's own wording).
- FR-IMT-002 A template shall carry a hidden or clearly marked **template version** cell; on upload the wizard shall accept the current version and the immediate previous one, and for any other version show a clear "template out of date, download a new one" message rather than mis-mapping columns.
- FR-IMT-003 Where a field has a closed list (discipline, ownership, unit, status), the template shall give a dropdown (data validation) from that list in the data rows; list values that come from organisation data (vendors, work locations) are listed on the Notes sheet, not embedded when the list exceeds 200 entries.
- FR-IMT-004 When an import finishes with failed or invalid rows, the wizard shall offer **Download failed rows**: an `.xlsx` with the same headers as the template, the original cell text of each failed row, plus two added columns, "Row in your file" and "Reason", and no valid rows. Fixing and re-importing that file shall work without editing headers (the two added columns are ignored by the mapper).
- FR-IMT-005 The failed-rows file shall include rows that failed at preview validation and rows that failed at create; skipped (already existing) rows are listed on a separate sheet "Already there" (OD-IMT-3).
- FR-IMT-006 A cell beginning with `=`, `+`, `-` or `@` in a downloaded file shall be written as text, never as a formula (spreadsheet formula injection), for both the failed-rows and template files.
- FR-IMT-007 Downloads shall be produced in the browser from data the user already holds (the file they uploaded and the validation result); no server upload of the failed rows is needed.
- FR-IMT-008 Template and failed-rows files shall be named by `exportFilename`; labels follow the reader's language, and headers are matched by label or alias in either language (as today).

**Descriptors** (entity, natural key for idempotent re-import, key fields; existing rules in italics are enforced by the create path, not re-implemented)
- FR-IMT-009 **Unit-rate catalogue** (#2520): contract (by code), item code, optional sub-stage, work location variant, unit, rate, currency, effective-from. Natural key: contract + item + sub-stage + location + effective-from. *Rates and currency rules are #2520's.* An existing key with the same values is skipped; a different rate for an existing key is a row error, not an overwrite (OD-IMT-2).
- FR-IMT-010 **Stock items**: item code, name, unit, category, optional reorder level. Natural key: item code. *Unit and uniqueness rules are the stock module's.*
- FR-IMT-011 **Equipment** (0447 plus #2526): asset code, name, default unit, ownership (`owned`|`rented`), and for rented: vendor (matched by existing company name or code), rate, basis (day|month), currency, rental start, optional end. Natural key: asset code.
- FR-IMT-012 **People** (#1516 employee master): employee code, display name, active. No salary, contact, tax, bank or location data in any template. Natural key: employee code.
- FR-IMT-013 **Crews** (#2528): one workbook with sheets Crews (code, name, discipline, field controller, own|vendor, vendor, standard roles with headcounts) and Members (crew code, employee code or vendor worker name, role, from, to). Members are validated against the crews in the same file or existing ones; overlapping placements are row errors.
- FR-IMT-014 Reference fields (contract, vendor, discipline, field controller, work location) shall resolve by the existing `refLookup` helpers; an unknown or ambiguous reference is a row error naming the field and value.
- FR-IMT-015 Each descriptor shall be idempotent: re-importing the same file creates nothing and reports the rows as already there.
- FR-IMT-016 Import entry points shall be gated by `can()` on the entity's create permission and refused by RLS for others; org is never read from the file or client.

## Non-functional requirements
- NFR-IMT-001 Row cap stays `MAX_IMPORT_ROWS`; a file over it is refused with the existing message and the template notes state the cap.
- NFR-IMT-002 Failed-rows and template generation for 500 rows completes without blocking the UI for more than one second on a mid-range phone-class device; no server round trip.
- NFR-IMT-003 Every new string exists in English and Bahasa Indonesia, including template headers and notes.
- NFR-IMT-004 Imported files and their contents are never logged or sent to analytics; only counts (created, skipped, failed) are.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-IMT-001 | Given each of the five descriptors, when its template is downloaded, then headers equal the field labels in order and the Notes sheet lists every field. | Unit (per descriptor) |
| AC-IMT-002 | Given a downloaded template with the example row replaced by valid data, when uploaded, then every row validates and imports (round trip). | Unit + pgTAP/e2e per entity |
| AC-IMT-003 | Given a file of 5 rows with 2 invalid, when imported, then 3 are created and "Download failed rows" yields a file with exactly the 2 original rows, their file row numbers and reasons. | Unit |
| AC-IMT-004 | Given that failed-rows file with the reasons fixed, when re-imported, then the 2 rows import and the added columns are ignored. | Unit |
| AC-IMT-005 | Given a row failing at create (not preview), when finished, then it is in the failed-rows file with the create error. | Unit |
| AC-IMT-006 | Given a cell `=HYPERLINK(...)` in a failed row, when the file is generated, then the cell is stored as text. | Unit |
| AC-IMT-007 | Given a template two versions old, when uploaded, then the wizard shows the out-of-date message and creates nothing. | Unit |
| AC-IMT-008 | Given a rate file where an existing key has a different rate, when imported, then that row fails, the existing rate is unchanged, and an identical re-import skips it. | pgTAP + Unit |
| AC-IMT-009 | Given an equipment file with a rented asset missing its vendor, when imported, then that row fails naming the vendor field. | Unit |
| AC-IMT-010 | Given the crews workbook with a member overlapping another crew's placement, when imported, then the Members row fails and the crew itself imports. | Unit + pgTAP |
| AC-IMT-011 | Given a people file, when its template is inspected, then no salary, contact, tax, bank or location column exists. | Unit |
| AC-IMT-012 | Given the same file imported twice, when run, then the second reports all rows as already there and creates none. | Unit |
| AC-IMT-013 | Given a user without create permission, when they open import, then the entry point is absent and a direct create is refused by RLS. | Unit + pgTAP |
| AC-IMT-014 | Given the unit-rate template, when filled and imported through the real UI, then the rates appear in the catalogue and a failed-rows file downloads for a bad row. | E2E (one journey, rates; others by unit layer) |

## Errors
| Condition | Result |
|---|---|
| Unknown template version | "Template is out of date", download link; nothing imported |
| Unknown or ambiguous reference | Row error naming field and value |
| Different value for an existing natural key | Row error "already exists with a different value" |
| Over 500 rows | Existing over-cap refusal |
| Download blocked by the browser | Message with a retry; the result stays on screen |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-IMT-1 | The five templates ship as descriptors on the existing wizard, no separate importer. | A parallel importer doubles validation rules. |
| OD-IMT-2 | Import creates only; it never updates an existing record. A changed rate must go through the catalogue's own edit. | A silent overwrite restates priced history. |
| OD-IMT-3 | Skipped rows go on a separate sheet, not mixed with failures. | Users re-fix rows that are fine. |
| OQ-IMT-1 | Does the rate catalogue need a bulk "update rates from effective date" import (new rows with a later effective-from cover it) or is create-only enough? Default: later effective-from rows are plain creates. | Annual rate revisions need manual entry. |
| OQ-IMT-2 | People template columns: confirm code, name, active only (no linked login, crew); crew membership comes from the Crews workbook. | Duplicate or conflicting identity data. |
| OQ-IMT-3 | Is the 500-row cap enough for a full rate catalogue (hundreds of items x locations)? Default: keep the cap; split files. | Large catalogues need several imports. |

## Delivery checklist
- [ ] Owner signs OD-IMT-1..3, answers OQ-IMT-1..3; confirm final field lists from #2520, #2526, #2528.
- [ ] Generic template and failed-rows slice first (benefits every descriptor), then five descriptors in separate bounded slices.
- [ ] Glossary: import template, failed-rows file.
