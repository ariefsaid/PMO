# Timesheet Review — Work Order Attribution per Line

## Overview

The people team reviews approved and submitted timesheets in read-only mode on `/timesheets/review`. Each timesheet entry already records its `work_order_id`, and active organisation members (including the HR Officer job role) already hold read access to `public.work_orders`. Today the review screen groups entries only by project and hides the work order attribution. This spec restores per-line work order visibility on desktop and phone layouts without changing any role rights, approval rules, or timesheet editing behaviour.

## Functional Requirements (EARS)

- **FR-TRW-001**: When the read-only timesheet review renders an employee's timesheet entries, the system shall group lines by project and work order (`project_id` + `work_order_id`) so hours attributed to distinct work orders under the same project appear on separate lines.
- **FR-TRW-002**: When a review line is attributed to a work order, the system shall display the work order label (`wo_number · title`, or whichever parts are present) under the project name in both the desktop table and the mobile card layout.
- **FR-TRW-003**: While the signed-in user is in the people-team read-only review (e.g. HR Officer without timesheet approval rights), the system shall keep the screen read-only and shall not display Approve or Return actions or alter any database read/write policy.

## Acceptance Criteria

### AC-TRW-001 — Separate lines and work-order labels in read-only review
- **Given** a signed-in HR Officer opens `/timesheets/review` where an employee has approved timesheet entries attributed to two different work orders under the same project
- **When** the HR Officer expands that employee's timesheet
- **Then** the review grid shows a separate line for each work order with its work order number and title visible, and each line's daily and weekly totals reflect only its own hours.

### AC-TRW-002 — Mobile read-only stack shows work order attribution
- **Given** a read-only timesheet grid rendered on a mobile viewport (390px)
- **When** a line carries a `workOrderLabel`
- **Then** the mobile card displays that work order label beneath the project name/code.

### AC-TRW-003 — Read-only posture and employee self-editor unchanged
- **Given** an HR Officer viewing `/timesheets/review`
- **When** the page renders
- **Then** no Approve or Return controls are shown; and on `/timesheets` (employee self-entry), project-level editing rows continue to group by `project_id` unchanged.
