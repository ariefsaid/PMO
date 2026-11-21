# Spec: Vendor response time on an equipment breakdown (#2702)

**Status:** approved by the Director; built (2026-11-21). IDs `FR-EVR-###`, `AC-EVR-###`. Plan: `docs/plans/2026-11-21-equipment-vendor-response.md`. Size S. Map #2516. Extends `docs/specs/equipment-availability.spec.md` (#2526, migrations 1032-1034); does not change its status, escalation or rental-check rules.

## Job story

When a rented machine breaks, I want to see how long the vendor took to respond, so I can hold them to it.

## Context

- A **breakdown** is the existing derived *downtime period* of an asset: it starts on the first down status (`broken`, `at_vendor`, `waiting_parts`) after a non-down one and ends on the next `ready`/`standby` (1033 `equipment_downtime_days`). Periods are derived, never stored; a breakdown is identified by `(asset_id, period_start)`.
- The **vendor** of a rented asset is the company on the `equipment_rental_terms` row in effect on the period's start date (1032). An owned asset, or a rented asset with no term covering that date, has no vendor: its breakdowns are listed but cannot take a vendor response.
- **Reported time** is when the breakdown was reported. The status table holds only a date, so the record carries an explicit `reported_at`; when the user gives none it is the start of the period's first day in the organisation time zone.
- Settings: none. An organisation that never records a response sees no change, except the one new action on a rented asset's breakdown.

## Definitions

- **Response time** of a breakdown = `responded_at - reported_at`, in whole minutes (a breakdown with no response yet is **awaiting**, never counted as zero).
- **Median** of a vendor's response times (pure function `vendorResponseSummary`): sort the response times in minutes ascending; with an odd count the middle one; with an even count the mean of the two middle ones, rounded half up to a whole minute. **Average** = sum / count, rounded half up to a whole minute. Awaiting breakdowns are excluded from both and counted separately. No responses: median and average are absent, not 0.
- The summary also gives per vendor: breakdowns in the period, responded count, awaiting count, slowest response.

## Requirements (EARS)

- FR-EVR-001 The system shall let an authorized user record, for a breakdown of a rented asset, the time the vendor responded, with an optional reported time (default per Context) and an optional note of up to 500 characters.
- FR-EVR-002 When a response is recorded, the system shall stamp the recording user and the recording time on the server; the client shall not supply either.
- FR-EVR-003 If the response time precedes the reported time, or lies in the future, or the reported time precedes the start of the breakdown's first day, then the system shall reject the record.
- FR-EVR-004 The system shall let an authorized user correct or remove a recorded response; a correction restamps the user and time.
- FR-EVR-005 The system shall stamp the vendor on the record from the rental term in effect on the period start, and shall reject a record for a breakdown with no such term.
- FR-EVR-006 The system shall show, per breakdown, the response time (or "awaiting"), the reported and responded times, and the vendor.
- FR-EVR-007 The system shall show a per-vendor summary for a chosen period (by breakdown start date): breakdowns, responded, awaiting, median, average, slowest.
- FR-EVR-008 Recording and removal shall be limited in the database to the roles that may set equipment status (Admin, Project Manager, Engineer); reads to Admin, Project Manager, Finance, Executive and the recording roles; every row carries `org_id` stamped by default, with RLS, and no client write grant.
- FR-EVR-009 The new UI shall be new component files with only mount lines in existing pages, render nothing while there is no data or no provider, and use English and Bahasa Indonesia strings and `DESIGN.md` tokens.

## Acceptance criteria

- AC-EVR-001 Given a rented asset with an open breakdown, when a Project Manager records a response after the reported time, then the row exists with that vendor, `recorded_by` = caller and `recorded_at` set by the server. (pgTAP)
- AC-EVR-002 Given a caller passing a forged recorder or recording time, then the stored values are the server's, not the supplied ones. (pgTAP)
- AC-EVR-003 Given a response time before the reported time, or in the future, then the call fails with 22023 and no row is written. (pgTAP)
- AC-EVR-004 Given a reported time before the breakdown's first day, then the call fails with 22023. (pgTAP)
- AC-EVR-005 Given an owned asset, or a rented asset with no term on the period start, then the call fails with 22023. (pgTAP)
- AC-EVR-006 Given a Finance or Executive caller, then record and remove fail with 42501, and a direct insert/update/delete on the table is refused. (pgTAP)
- AC-EVR-007 Given a caller in another organisation, then it can neither read nor record on this org's breakdowns. (pgTAP)
- AC-EVR-008 Given three breakdowns of one vendor with responses of 30, 90 and 600 minutes and one awaiting, then the summary reads responded 3, awaiting 1, median 90, average 240, slowest 600. (pgTAP at the read, mirrored by the unit test)
- AC-EVR-009 Given an even count (30 and 91 minutes), then median is 61 (mean 60.5 rounded half up); given zero responses, median and average are absent. (unit)
- AC-EVR-010 Given a corrected response, then the row keeps one record per breakdown and restamps the recorder and time; given a removal, the breakdown is awaiting again. (pgTAP)
- AC-EVR-011 Given an organisation with no recorded responses, then the new component renders its action only on a rented asset's breakdown and the existing availability and asset screens render unchanged. (unit)

## Non-functional
- NFR-EVR-001 Reads are bounded: at most 200 assets and 400 days per call, as `equipment_metrics`.
- NFR-EVR-002 The pure function is exact integer arithmetic (integer minutes) and is the oracle the SQL read must agree with.

## Owner questions
None blocking. Choices taken (to list in the report): who records = the status-setting roles (vendor chasing is field and manager work, not money); a breakdown is the derived downtime period (no new breakdown table); reported time defaults to the start of the first day and may be entered.
