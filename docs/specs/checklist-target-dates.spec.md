# Spec: target dates and overdue notices on the close-out and clearance checklists (#2800)

IDs `FR-CTD-###`, `AC-CTD-###`. Plan: `docs/plans/2026-11-22-checklist-target-dates.md`. Reuses the billing step mechanism
(`docs/specs/billing-stage-targets.spec.md`, migrations 1360, 1363, 1368): a target number of days, a due day, a once-only overdue stamp,
one daily runner. Calendar days in the organisation's zone. Nothing of a customer's process is coded: names and day counts are
organisation data.

**Job story.** When a checklist runs over days (clearing a person for site; closing out a work order), I want each item to carry a target
date and to be told when it is overdue, so a slow step is seen before it holds up the work.

## Verified on the base (4e860a93c)

- Close-out: `closeout_checklist_templates` (1400) are copied onto a work order when it goes Draft to Issued by
  `instantiate_work_order_closeout_items` (1402), each item starting that day. Items have no owner; the creator is `work_orders.issued_by`.
- Clearance: `clearance_items` is one organisation list; `person_clearances` has a row only once a person has done an item. There is no
  per-person checklist created at a point in time and no item owner. The only per-person anchor is the person record
  (`people.created_at`, creator `people.created_by`).
- Billing runner: `notify_overdue_billing_stages()` (1368), cron `billing-stage-overdue` at 01:17 UTC daily (1363).

## Requirements (EARS)

- FR-CTD-001 The close-out template item shall carry an optional target in days (1 to 365); `set_closeout_checklist` shall accept a list
  with or without it.
- FR-CTD-002 When a work order is issued, each copied item shall get `due_on` = the organisation's issue day + target days; no target gives a null due day.
- FR-CTD-003 A clearance item shall carry an optional target in days (1 to 365) and `target_set_at`, stamped by the database when the target
  is set or changed and cleared when the target is removed.
- FR-CTD-004 A person's clearance item is due on the person record's creation day (organisation zone) + target days, only when the person
  was created on or after the item's `target_set_at`; otherwise it has no due day. Existing people are unchanged.
- FR-CTD-005 An item is overdue when it is not done and its due day has passed. Done: close-out `done_on` set; clearance a recorded
  `person_clearances` row (or, for an item tied to a document type, the person's live document with an expiry, as 1612 reads it).
- FR-CTD-006 The existing daily runner shall also scan both kinds of item and notify once in-app: close-out recipient is
  `work_orders.issued_by` when an active member of the same organisation, else the organisation's active Admins; clearance recipient is
  `people.created_by` when an active member of the same organisation, else the Admins. Never another organisation, never twice, never for a done item.
- FR-CTD-007 Billing behaviour of the runner shall be unchanged.
- FR-CTD-008 The clearance scan shall run only for organisations with `clearance_checklist_enabled`. No new switch.
- FR-CTD-009 The work-order close-out section and the person's clearance checklist shall mark an overdue item with the word "Overdue" and
  the due day in the warning colour; the work-orders list shall show the overdue item count per work order; the clearance people list shall
  show the overdue item count per person.
- FR-CTD-010 Light accounts (Foreman, Field user; OD-SCOPE-4) see only their own tasks: they own no close-out or clearance item, cannot
  read these tables, and the new notices table and due-day function refuse them. The notice goes only to the recipients above, in their own organisation.

## Acceptance criteria (Given/When/Then) and owning layer

- AC-CTD-001 Given a template item with target 5, when the work order is issued, then its item's `due_on` = issue day + 5; with no target it is null. (pgTAP)
- AC-CTD-002 Given an item past due and not done, when the runner runs, then `issued_by` is notified once; with no `issued_by` the Admins are; a second run adds nothing. (pgTAP)
- AC-CTD-003 A done item, an item with no due day and another organisation's admin are never notified. (pgTAP)
- AC-CTD-004 Setting or changing a clearance item's target stamps `target_set_at`; removing it clears it. (pgTAP)
- AC-CTD-005 A person created before `target_set_at` has no due day; one created after has creation day + target. (pgTAP)
- AC-CTD-006 Overdue clearance item: runner notifies the person's creator once (notices row), else Admins; not when done, not when the checklist feature is off, not across organisations. (pgTAP)
- AC-CTD-007 `person_clearance_overdue_notices` is readable like `person_clearances`, has no client write and denies light accounts. (pgTAP)
- AC-CTD-008 Billing overdue cases in 1360/1365 run unchanged through the extended runner. (existing pgTAP, unchanged)
- AC-CTD-009 Pure derivations (overdue, count per work order, count per person) are correct. (Vitest)
- AC-CTD-010 The close-out section, work-orders list, clearance checklist and people list show the marker and counts; the template and item forms take a day count. (RTL)
- AC-CTD-011 No e2e journey: every rule is a database rule proven by pgTAP and the surfaces are read-only markers proven by RTL; no new cross-stack write flow.

## Settings and defaults

None. Target days are columns on the organisation's templates and items; empty by default; no switch.
