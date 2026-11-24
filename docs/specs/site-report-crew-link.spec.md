# Spec: Daily site report linked to a crew or a named person (SRC)

**Status:** built on branch `feat/1124d-site` (lane site, item 1, 24 Nov decisions). IDs `FR-SRC-###`, `AC-SRC-###`.
Plan: `docs/plans/2026-11-24-site-evidence-areas.md`. Migration `2130`. Extends `docs/specs/daily-site-report.spec.md`.

**Job story.** When a daily site report is written for a day's work, I want to say which crew did it, or which named person when
no crew applies, so I can find a crew's reports and read them next to its work order.

## 1. Today (checked 2026-11-24)
- A daily site report (`daily_site_reports`, `1040`) names a work order, a date, an author and the work; it names no crew and no
  person. The list filters by project, work order, status and date only (`listReports`).
- A crew (`crews`, `1035`) has a code, a name and an optional field controller (the foreman, a login). A person (`people`) is the
  organisation's roster entry; `people_directory` is the member-readable view of name and code.

## 2. Requirements (EARS)
- **FR-SRC-001** Where a report is created or edited while it is a draft or returned, the system shall accept an optional crew, or an
  optional named person when no crew applies. Never both.
- **FR-SRC-002** The database shall refuse a report that names both a crew and a person (`23514`, `SR_LINK`) and a crew or person of
  another organisation (`23503`, `SR_LINK`).
- **FR-SRC-003** When a save carries no link keys, the stored link shall stay as it is (a queued older client never wipes it); an
  explicit empty value clears it.
- **FR-SRC-004** Existing reports stay valid with no link; no existing organisation sees a change until someone chooses a crew.
- **FR-SRC-005** A correction of a validated report shall carry the link of the report it corrects.
- **FR-SRC-006** The site-report list shall show each report's crew, filter by crew (the choice lives in the address), and the work
  order page shall list its latest site reports with their crew. An organisation with no crews sees no crew filter.
- **FR-SRC-007** When a person who leads a crew (is its field controller) starts a report, the crew shall default to the crew they lead;
  they may pick another crew or none.
- **FR-SRC-008** The report page shall show a "Crew and area" section: a crew choice, a person choice (disabled while a crew is chosen,
  with the reason), read-only when the report is not editable, hidden when read-only and unlinked. English and Bahasa Indonesia.

## 3. Acceptance criteria (owning layer)
- **AC-SRC-001** Given a draft, when a crew (or a person) is chosen on create or edit, it is stored; an explicit empty value clears it. [pgTAP `2130`; unit `SiteReportWho`, `siteReportForm`]
- **AC-SRC-002** Given a crew and a person together, the save is refused. [pgTAP `2130`; unit `siteReportForm`]
- **AC-SRC-003** Given a crew or person of another organisation, the save is refused. [pgTAP `2130`]
- **AC-SRC-004** Given an edit with no link keys, the stored crew stays. [pgTAP `2130`; unit `dailySiteReports.test`]
- **AC-SRC-005** Given a validated report with a crew, its correction names the same crew. [pgTAP `2130`]
- **AC-SRC-006** Given reports with crews, the list shows the crew and filters by it; the work order page lists its reports. [unit `SiteReports.test`, `SiteReportsSection.test`, `dailySiteReports.test`]
- **AC-SRC-007** Given a foreman who leads a crew, a new report starts with that crew; they may change it or clear it. [unit `NewSiteReportDialog.test`]

## 4. Not in scope
Pay or cost by crew from the report (the crew's cost already comes from attendance); a crew history; a person's private details on the report (the directory carries name and code only).
