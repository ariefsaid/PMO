# Billing can start: confirm the delivery record, and six walk fixes

**Status:** built on branch `fix/walk-billing`. Source: a first-time-person walk of the released build, Bahasa Indonesia, phone first. IDs `FR-BCS-###`, `AC-BCS-###`. Plan: `docs/plans/2026-11-22-billing-can-start.md`. Money path: ships alone.

## Requirements
- FR-BCS-001 The system shall state who confirms a delivery record (BAST): Finance or an Admin. Every place that says a record waits shall name that owner, not "someone else".
- FR-BCS-002 While a delivery record is Draft on an issued work order, the work-order page and the project's work-order card shall show a visible Confirm control to a role that may confirm it, and the Draft chip shall read who it waits on.
- FR-BCS-003 The database shall expose the Draft records waiting for the caller to confirm (`acceptances_awaiting_my_confirmation()`), as data for a later waiting-list lane. It lists nothing to a role that may not confirm, and omits the caller's own records unless they are the only active member.
- FR-BCS-004 Every organisation shall have a default document category "Delivery record" for the signed file.
- FR-BCS-005 When a delivery record is confirmed and the viewer may bill, the work-order card shall offer one visible action to start a claim.
- FR-BCS-006 The database shall keep today's rule: Admin or Finance confirm; the preparer cannot confirm their own record unless they are the only active member; the Project Manager of the project, Finance, Executive or Admin may prepare and mark it final.
- FR-BCS-010 The progress-month field shall default to a valid month and be a month picker.
- FR-BCS-020 Each contract figure shall carry its meaning in its label (sum of contract lines; ordered on customer orders; signed contract value for the ceiling). The billable figure shall be zero while the only customer order is a draft.
- FR-BCS-030 Choosing a catalogue rate shall fill the line's code, description and unit; the item label shall say "ERP item" only when an accounting system is connected; a catalogue item that already has a line shall offer that line first.
- FR-BCS-040 The claims board shall be one tap from the Finance page and from home, and its empty state shall say how a claim gets steps.

## Acceptance criteria
| AC | Given / When / Then | Layer |
|---|---|---|
| AC-BCS-001 | Given a Draft record, when Finance opens the work-order page, then the chip names Finance or an Admin and a Confirm control is shown; a role that may not confirm sees no control. | Unit (`BillingSection.confirm.test.tsx`, `WorkOrderAcceptances.test.tsx`) |
| AC-BCS-002 | Given a Draft authored by a PM, when a different Finance user confirms, then it confirms; the PM and an Executive are refused; the author is refused. | pgTAP (`1570_bast_confirm_owner.test.sql`, `0337_work_order_acceptances.test.sql`) |
| AC-BCS-003 | Given waiting records, when Finance (not the author) asks, then they are listed; a PM and an Executive get none; the author does not see their own. | pgTAP (`1570_bast_confirm_owner.test.sql`) |
| AC-BCS-004 | Given any organisation, then the "Delivery record" category exists and is offered by default. | pgTAP (`1090`), Unit (`documentCategories.test.ts`) |
| AC-BCS-010 | Given the work-order tab passes `YYYY-MM-01`, then the field shows that month and saves. | Unit (`ProgressAssessmentModal.test.tsx`) |
| AC-BCS-020 | Given a draft-only order with value, then billable reads zero; labels carry their meaning. | Unit (`ContractCascade.orderless.test.tsx`) |
| AC-BCS-030 | Given a catalogue pick, then code, description and unit are filled; the label follows the connection; an existing line is offered. | Unit (`BoqItemFormModal.test.tsx`, `BoqCatalogueForm.test.tsx`) |
| AC-BCS-040 | Given Finance, then the Finance page and home link to the board. | Unit (`FinanceHub.test.tsx`), E2E (`JOB-PM-7-confirm-delivery-record.spec.ts`) |
