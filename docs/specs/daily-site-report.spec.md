# Spec: Daily site report (#1522)

**Status:** proposed; owner decisions below require sign-off before implementation. Route #1481; binding content ruling #1491 and offline ruling #1501. Blocked by #1512, #1516, #1519 and #1520. This is one screen in PMO, not a separate app or prototype. Plan: `docs/plans/2026-11-02-daily-site-report.md`.

## Job story

When I am recording a day's work at a site with unreliable connectivity, I want to capture the work, resources and photos against the project and work item on my phone, so that the team can find a reliable record after connectivity returns and correct any rejected entry.

## Context and boundary

The report is a field record and navigation to operational sources, not an approval, invoice, stock posting or assessment. #1491 specifies installed volume, crew hours, equipment usage, material issues, activities and photos, project and BoQ attribution. #1501 permits new field records and photos offline; shared edits, approvals and money remain online; the server revalidates on sync and failures stay in device-local Needs fixing with reasons. #1487 requires project and BoQ for material issues; #1488 attributes people through assignment and timesheets, and #1498 attributes equipment through usage. #902 requires registered module/actions and scoped authorization.

Existing `progress_assessment_quantities` (0250) stores **cumulative** month-end quantities, while a daily installed quantity is a **delta**; direct overwrite would distort progress. `timesheet_entries` belongs to a person's weekly sheet; `equipment_usage_entries` is a per-asset draft with its own transition; `stock_documents` has its own issue/posting rules. None is replaced by a report copy. #1516, #1512, #1519 and #1520 own their final contracts. Reconcile these at integration before any build; no speculative bypass of their authorization or transitions.

## Scope and requirements (EARS)

- FR-DSR-001 The system shall let an authorized field user create a report for one project, work date and BoQ work item in the PMO phone screen, with activities and zero or more installed-volume, crew-hour, equipment-usage, material-issue and photo entries.
- FR-DSR-002 When an entry is captured, the system shall retain its project and work-item attribution, date, quantity and unit where applicable, and its relevant source identity (person, asset, item/warehouse or photo). A work item shall belong to the report project and organization. New timesheet entries may sync only when the owning workflow permits the write; editing an existing shared sheet remains online.
- FR-DSR-003 When a report is saved offline, the system shall use #1520's device queue for new records and photos, preserve them across restart, and show pending, synced or Needs fixing state. It shall not queue shared-record edits, approvals, money operations or stock posting.
- FR-DSR-004 When connectivity returns, the system shall revalidate current identity, permissions, project, work item, assignments and each applicable source rule on the server. A rejected unit shall remain locally actionable with a reason; no record or photo shall be silently discarded or overwritten.
- FR-DSR-005 When a retry or lost response repeats a submission, the system shall use a stable client-generated request identity to return the prior result and shall not duplicate the report, source or attachment. A changed payload requires a new correction attempt under #1520's protocol.
- FR-DSR-006 When a user captures crew, equipment or materials, the system shall use the owning source's supported create interface and validation, preserve source references and statuses, and never imply approval, posting or billing. Attribution to crew uses #1516 assignments; no fabricated timesheet or impersonated worker is permitted.
- FR-DSR-007 When daily installed volume is recorded, the system shall retain the dated delta and unit; it shall not write the cumulative monthly assessment automatically. An authorized user may use it as evidence when recording the existing assessment online.
- FR-DSR-008 When a photo is captured, the system shall associate it with the report through the shared attachment mechanism and #1520 queue; its upload and link status shall be visible. A failed upload remains recoverable with its reason.
- FR-DSR-009 When a user opens a report, the system shall show the date, project, work item, activities, captured entries, source links/status and photo states subject to the underlying source permissions. It shall show unavailable sources as unavailable rather than disclose their details.
- FR-DSR-010 The system shall register report view/create actions with the role matrix (#902), enforce active organization and project scope server-side, and gate affordances with `can()`; source permissions and separation of duties remain authoritative. No client may select another organization as authority.
- FR-DSR-011 When a user corrects a rejected queued item, the system shall retain its input until an explicit discard, then revalidate it on retry. The report shall not offer offline edits to an already shared server record.
- FR-DSR-012 When listing reports, the system shall filter by project and date, order newest first with a stable tie-breaker and use bounded pagination. Archive follows ADR-0018 and existing source lifecycle; archiving a report shall not delete or reverse operational records.

## Non-functional requirements

- NFR-DSR-001 The screen shall work at 320 CSS pixels, support keyboard and accessible labels/status announcements, and use shared primitives and DESIGN.md tokens; English and Indonesian copy shall be complete.
- NFR-DSR-002 Database records shall have the `org_id` seam, RLS and indexed project/date access; authorization is enforced server-side. Photos follow the existing private attachment access rules.
- NFR-DSR-003 Saving a local draft shall provide a visible result without network access; storage exhaustion and unavailable cached project/work-item choices shall be explained without falsely claiming a save. No uncached choice is guessed.
- NFR-DSR-004 All dates are project-local calendar dates; quantities are finite, nonnegative and validated by the source's unit and bounds. No rate, cost or payroll data is required in the report.

## Acceptance criteria

- AC-DSR-001 **Given** a field user offline with cached choices, **when** they capture a report and photo and reconnect, **then** the linked report and photo are available or each remains in Needs fixing with a reason.
- AC-DSR-002 **Given** a report for project A, **when** a work item from project B is submitted, **then** the server rejects it without creating a report.
- AC-DSR-003 **Given** a queued request already accepted but its response lost, **when** it is retried, **then** the same result is returned and no duplicate is created.
- AC-DSR-004 **Given** an assignment or permission changed while offline, **when** the item syncs, **then** the server refuses the invalid item and the device retains its input and reason.
- AC-DSR-005 **Given** a report with source entries, **when** they are saved, **then** their owning workflows retain their own statuses and no approval, stock post or billing occurs.
- AC-DSR-006 **Given** two daily installed quantities, **when** recorded, **then** both dated deltas remain available and the monthly cumulative assessment is unchanged.
- AC-DSR-007 **Given** a photo upload fails, **when** the user opens the report, **then** the photo remains recoverable with its failure reason and can be retried.
- AC-DSR-008 **Given** a user outside the report's organization or project scope, **when** they read or create it, **then** access is refused and source details are not exposed.
- AC-DSR-009 **Given** an offline user with no cached work-item choices or insufficient device storage, **when** they try to save, **then** the screen explains the condition and does not claim success.
- AC-DSR-010 **Given** reports on several dates and a linked source, **when** a user filters and pages by project/date, **then** only matching reports appear in stable order and an inaccessible source shows unavailable.
- AC-DSR-011 **Given** a locally rejected item, **when** its author corrects and retries it, **then** the corrected input is revalidated and no accepted source is duplicated.
- AC-DSR-012 **Given** a report linked to operational sources, **when** an authorized user archives it, **then** its sources remain unchanged and accessible under their own policies.

## Errors

| Condition | User-visible result |
|---|---|
| Changed assignment, archived item, invalid quantity or revoked access | Needs fixing with server reason; retain input; retry after correction |
| Network loss or upload interruption | Pending/retry; retain local photo and request identity |
| Storage full or cached choice unavailable | Explain failure; do not report a successful local save |
| Source unavailable to viewer | Show unavailable without source details |
| Duplicate request with different payload | Refuse identity reuse; retain correction for a new attempt |

## Owner decisions (recommended defaults, not rulings)

1. **OD-DSR-1 — crew hours:** default: capture only an individual's own timesheet entries where #1516 assignment and timesheet rules permit; other crew members enter their own hours until an authorized delegation contract exists. Otherwise a foreman may incorrectly create hours in another person's approved week or under another identity.
2. **OD-DSR-2 — source failure granularity:** default: independent report and source/photo queue items with explicit per-item status and stable links; a rejected item does not hide accepted siblings. All-or-nothing can strand useful activity evidence behind one invalid stock item; partial success without statuses would mislead users into believing everything posted.
3. **OD-DSR-3 — installed volume:** default: dated deltas remain report evidence; monthly cumulative assessment is entered separately online. Automatically adding deltas can double count revisions or overwrite another manager's cumulative assessment.
4. **OD-DSR-4 — stock and equipment:** default: create only source drafts through existing source interfaces, no submit, post or approve from this report; any source requiring a shared edit waits online. Automatic posting could change inventory or valuation before the responsible keeper checks it.
5. **OD-DSR-5 — report audience:** default: report author and users with project-scoped report view; each source remains independently authorized. Broad project access could expose another person's operational details; overly narrow access prevents the site team finding reports.
6. **OD-DSR-6 — attachments and retention:** default: use #1520's supported private photo queue and existing project attachment retention; no new retention policy. Deleting local media before server link confirmation could lose the only copy.

## Delivery checklist

- [ ] Resolve owner decisions and reconcile #1512/#1516/#1519/#1520 contracts, including delegated crew entry and photo queue; update this spec and plan before build.
- [ ] Implement report persistence, tenancy, idempotency and source references using reversible migrations 0530–0532 only.
- [ ] Integrate source drafts, offline queue and phone screen; test failure, recovery and permissions at their owning layers.
- [ ] Complete targeted gates, rendered review and one real offline-to-sync journey; ship money/SoD/auth slices alone.
