# Spec: Material requests warn at two usage thresholds of plan (#2686)

**Status:** draft for owner/Director review (phase 1). IDs `FR-MUT-###`, `AC-MUT-###`. Plan: `docs/plans/2026-11-21-material-request-usage-thresholds.md`. Map #2516. Extends `docs/specs/material-requests.spec.md` (FR-MRQ-002 over-plan rule is unchanged). Scope rulings: OD-SCOPE-2 (every number is an organisation setting), OD-SCOPE-6 style (warn, never block).

## Job story

When a work order's material use nears its plan, I want the engineer warned at two points, so over-use is caught before it happens.

## Context and boundary

- **Plan** is `mrq_plan_quantity(work_order, item)` (BoQ material allowance prorated to the work order). **Use** is the same measure the request form already shows for FR-MRQ-002: quantity already used on the work order (`mrq_prior_quantity`: posted stock to the work order plus other live requests) plus the quantity on the request being submitted. Using one measure keeps the warning consistent with the over-plan reason rule and needs no new stock query.
- Evaluated per item, at the moment a request is submitted (the moment use is committed to), and shown while drafting.
- The recipient is the work order's **project manager** (`projects.project_manager_id`), the existing "responsible person" notion for a work order (used by site-report entry and close-out). There is no per-work-order engineer column; see Open questions.
- Notifications reuse `public.notifications` (0048) through the `notify_workflow_user` pattern (0237). No new notification mechanism.
- Warnings never block: nothing here raises an exception or changes request status or approval steps.

## Settings

| Setting | Where | Default | Meaning |
|---|---|---|---|
| First usage threshold (percent of plan) | `material_request_settings.usage_warn_pct_1` | unset (null) | Use at or above this percent of plan raises the first warning. |
| Second usage threshold (percent of plan) | `material_request_settings.usage_warn_pct_2` | unset (null) | Same, for the second warning. When both are set, the second must be greater than the first. |

Each threshold is a number from 1 to 1000 (over 100 means over plan), at most two decimals. Set by an Admin on the existing material-request settings screen, beside the cut-off, English and Bahasa Indonesia.

## Default-off statement

Both thresholds are null for every existing organisation, and the migration adds nothing but nullable columns. With a threshold unset, no warning is computed, no notification is written, no alert row is created and no screen gains an element. Existing tests and screens are untouched until an Admin sets a percentage.

## Requirements (EARS)

- FR-MUT-001 The system shall let an Admin set, change or clear each of the two thresholds for the organisation; the server refuses a value outside 1 to 1000, a second threshold not greater than the first, and any non-Admin caller.
- FR-MUT-002 Where a threshold is set, when use of an item on a work order (as defined above, including the request's own quantity) is at or above that percent of plan, the system shall show a warning on that line, on the draft form and on the request detail, naming the threshold crossed, the percent of plan reached and the plan quantity. Plan 0 counts as 100 percent reached when use is above 0.
- FR-MUT-003 When a request is submitted and an item's use crosses a threshold that has not yet been raised for that work order and item, the system shall write one in-app notification to the work order's project manager and record the crossing; a line that crosses both thresholds at once records and notifies both.
- FR-MUT-004 A crossing shall be raised once per work order, item and threshold: re-saving, resubmitting after a return, replaying the same submit, or another request for the same item shall not notify again.
- FR-MUT-005 The system shall not notify the person who submitted, an inactive member or someone outside the organisation; where the project manager is unset or is the submitter, the crossing is still recorded and no notification is written.
- FR-MUT-006 A threshold warning shall never block save, submit, approval or the transfer; it adds no approval step and does not change over-plan handling (FR-MRQ-002).
- FR-MUT-007 Where both thresholds are unset the system shall behave exactly as before.
- NFR-MUT-001 The crossing record has `org_id` stamped by default, RLS on, no client write path; reads limited to the organisation. Notification and record writes happen inside `mrq_submit`'s transaction, under its existing per-work-order lock.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MUT-001 | Given thresholds 80 and 100 and plan 100, when a request takes use to 85, then the first threshold is recorded and one notification goes to the project manager, none for the second. | pgTAP |
| AC-MUT-002 | Given the first crossing was raised, when a later request takes use to 105, then only the second threshold notifies; a line that jumps from 50 to 105 in one request notifies both. | pgTAP |
| AC-MUT-003 | Given a raised crossing, when the same request is replayed or resubmitted after a return, or another request names the same item, then no new notification and no new record. | pgTAP |
| AC-MUT-004 | Given both thresholds unset, when requests of any size are submitted, then no record and no notification exist (mutation check: ignore the unset test, go red). | pgTAP |
| AC-MUT-005 | Given a crossing, then submit succeeds and the request is `pending` with the same steps as before; nothing is refused. | pgTAP |
| AC-MUT-006 | Given the submitter is the project manager, or the manager is inactive or unset, then the crossing is recorded and no notification is written. | pgTAP |
| AC-MUT-007 | Given a user of another organisation or a non-Admin, when they set thresholds or read the crossing records, then refused or nothing visible. | pgTAP |
| AC-MUT-008 | Given invalid values (0, 1001, second not above first), when an Admin saves, then refused; null clears. | pgTAP + Unit |
| AC-MUT-009 | Given a threshold crossed on a draft line, when the form shows the line, then the warning names the threshold, percent and plan, and Save and Submit stay enabled; with thresholds unset the line is unchanged. | Unit |
| AC-MUT-010 | Given a non-Admin and an Admin on the settings screen, then only the Admin sees the threshold fields; labels exist in English and Bahasa Indonesia. | Unit |
| AC-MUT-011 | Given a rotated threshold (80 changed to 70 after 80 was raised), then a crossing already recorded for 80 is not raised again for 70 on the same item only if its stored percent matches the slot; slot is the key, see Open question 2. | pgTAP |

## Errors
| Condition | Result |
|---|---|
| Threshold out of range or second not above first | Field error; nothing saved |
| Non-Admin sets thresholds | Refused (42501) |
| No project manager on the project | Warning still shows; no notification |

## Open questions
1. "The work order's engineer": none exists as a work-order field. Proposed: the project manager of the work order's project. Alternatives: a new work-order engineer column (new concept, UI and access to design), or every Engineer-role member of the project.
2. Crossing key: proposed once per (work order, item, threshold slot 1 or 2); changing a percentage later does not re-notify for a crossing already recorded in that slot.
3. "Use" taken as prior plus this request, evaluated at submit; not at issue posting. Say if posted issues alone should drive it.
