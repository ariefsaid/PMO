# Return and rejection reasons — issue 2185

**Job story.** When my timesheet, expense claim, cash-float top-up or equipment usage is returned or rejected, I want to read the approver's reason on that record, so I can correct it without asking them.

## Current behavior at origin/dev

The migration references below are the latest forward definitions found by searching `supabase/migrations/*.sql`; policy references are migration-source evidence, not a live `pg_policies` inspection. The table SELECT grants and row policies both matter. This is a plan, not evidence that a cloud database has these definitions.

| Record | Transition and states | Who decides today | Reason accepted / stored | Submitter read and gap |
|---|---|---|---|---|
| Timesheet week | `transition_timesheet` (`0534_feature_enforcement.sql:1939`), Submitted → Rejected | Assigned manager, Admin, or Admin/Executive fallback if no manager; owner excluded | `p_notes` optional; unused, not stored | Owner reads `timesheets` under `timesheets_select` (`0646_rls_caller_initplans.sql:2997`); no reason. The dev queue sends no notes (`pages/timesheets/ApprovalsQueue.tsx:100`). |
| Expense claim (including advance) | `transition_expense_claim` (`0423_imprest_cash.sql:125`), Submitted → Rejected | Spend approval route or Admin; claimant and applicable float custodian/plan approver excluded | Optional `p_notes` stored in `expense_claims.rejection_notes`; no rejection actor/time stamps | Claimant reads `expense_claims_select` (`0696_rls_row_policies_once_per_query.sql:102`); UI shows existing note, but reason optional and actor/time absent. |
| Cash-float top-up (funding or replenishment) | `transition_imprest_replenishment` (`0534_feature_enforcement.sql:1305`), Requested → Rejected; Rejected terminal | Finance or Admin, excluding requester and float custodian | Optional `p_notes` stored in `imprest_replenishments.decided_notes`; no rejection actor/time stamps | Existing `imprest_replenishments_select` (`0646_rls_caller_initplans.sql:1725`) requires a visible float; no reason display on record. |
| Equipment usage | `transition_equipment_usage` (`0447_equipment_usage.sql:255`) delegates to `equipment_usage_transition_core` (`0680_tm_equipment.sql:618`), Submitted → Rejected | `equipment_can_approve` eligible approver, excluding author | Optional `p_notes` stored in `equipment_usage_entries.decision_notes`; `approver_id` recorded but `approved_at` null on rejection | Author reads `equipment_usage_entries_select` (`0696_rls_row_policies_once_per_query.sql:78`); no rejection time, and reason not shown on own row. |
| Budget version, reference only | `return_budget_version` (`0792_budget_return_to_pm.sql:29`), waiting Draft → returned Draft | Active Admin, Executive, Project Manager or Finance with drafter/editor restrictions | Required `reason`, stored as `budget_versions.return_reason`, `returned_by`, `returned_at` | `budget_versions_select` (`0002_rls.sql:67`, later policy rewrites apply); returned banner exists; `resubmit_budget_version` clears stamps. No change in scope. |
| Procurement, reference only | `transition_procurement` (`0766_capture_then_request_one_pr.sql:3`), Requested → Rejected | Approval routing / applicable privileged fallback, requester excluded | `p_notes` → `procurements.rejection_notes` and `procurement_status_events.notes`; trigger `0562_procurement_rejection_comment.sql:3` requires a nonblank comment | `procurements_select` (`0002_rls.sql:122`, later policy rewrites apply) and status-event read; existing record UI shows history. No change in scope. |

## Requirements

- **FR-RSN-001.** When an authorized caller rejects a Submitted timesheet, Submitted expense claim, Requested top-up or Submitted equipment entry, the server shall refuse null, empty, whitespace-only or more than 1000-character trimmed reasons; it shall store the trimmed reason atomically with the decision.
- **FR-RSN-002.** When one of those decisions succeeds, the server shall store its actor and decision timestamp on the same record. For legacy decisions, absent stamps shall remain unknown rather than be invented.
- **FR-RSN-003.** While a submitter can read a record under its existing row policy and privileges, the system shall make its decision reason, actor and time readable on that same record, without broadening row visibility or who may decide. An unavailable actor name shall have a neutral fallback.
- **FR-RSN-004.** While a rejected timesheet, claim or equipment entry is being corrected, the system shall retain its last rejection details through Rejected → Draft; when it is resubmitted Draft → Submitted, it shall clear them together. This follows the budget resubmit pattern while keeping the reason visible during correction.
- **FR-RSN-005.** While a top-up is Rejected, the system shall retain its decision details: that transition is terminal, and a replacement request is a separate record. Budget and procurement remain unchanged.
- **FR-RSN-006.** When a submitter opens a rejected record or revises it, the interface shall show the reason and actor near the top, with a graceful unknown value for legacy data; the top-up list shall expose the decision on the specific rejected request.
- **FR-RSN-007.** When a new decision is made, existing authorization, legal transitions, transaction boundaries and non-rejection behavior shall remain unchanged. Existing optional notes on approvals remain optional.

## Acceptance criteria and owning layer

- **AC-RSN-001 (pgTAP).** Given each authorized decision maker and a pending record, when they reject with null, empty, spaces, tabs/newlines, or >1000 characters, then the server refuses without changing status or stamps; when given a valid reason, then it stores the trimmed text, authenticated actor and timestamp atomically.
- **AC-RSN-002 (pgTAP).** Given an owner and a rejected timesheet, expense claim or equipment entry, when they reopen it for correction, then the reason and actor remain readable; when they resubmit, then all rejection fields clear. Given a rejected top-up, when a replacement request is created, then the original decision stays readable.
- **AC-RSN-003 (pgTAP).** Given an existing submitter and an unrelated or other-organization user, when each reads the record, then the submitter sees the decision and the others receive no additional row access. Given an ineligible decider or the author, when they try to reject with a reason, then existing authorization still refuses.
- **AC-RSN-004 (Vitest).** Given returned rows containing reason, actor and timestamp, when each repository maps the row, then it preserves those fields and forwards the reject reason as `p_notes`; missing legacy actor/time maps to null.
- **AC-RSN-005 (Vitest/RTL).** Given each submitter's rejected record and an accessible actor name, when the record is opened, then the reason and actor are visible at its top; given legacy missing details, then the screen remains usable and indicates unavailable details.
- **AC-RSN-006 (Vitest/RTL).** Given an approver using the dev timesheet queue, expense decision or top-up dialog, when they reject, then a reason is requested and sent; an empty reason cannot be confirmed. Equipment's existing reason dialog continues to work.

## Director decisions

1. **Slice A compatibility:** dev's timesheet queue sends no notes, so enforcing FR-RSN-001 in a server-only Slice A would make its return action fail. Recommend include the minimal reason-input/validation changes for dev approver dialogs in Slice A, then reserve submitter display for Slice B. This is a necessary deviation from the requested server-only file scope; do not ship A unchanged.
2. **Legacy rows:** recommend display “Reason unavailable” / “Person unavailable” for preexisting incomplete decisions, with no guessed attribution and no backfill. Use constraints that permit existing legacy rows while enforcing new decisions in the RPC.
3. **Length:** recommend the budget's 1000-character maximum and whitespace-only rejection for all four types. Budget's existing `btrim` alone does not cover tabs/newlines; use a whitespace-aware test.
