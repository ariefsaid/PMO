# Spec: everyone is told what waits for them (fix-waiting)

**Status:** built from a first-time-person walk of the released build (v0.44.0), per role, on a phone, in Bahasa Indonesia. IDs `FR-WAIT-###`, `AC-WAIT-###`; jobs `JOB-WAIT-1..5`. Plan `docs/plans/2026-11-20-waiting-list.md`. Migrations 1560 (the waiting read) and 1561 (the requester is told).

## Job stories
1. When something needs my decision, I want to find it on my home, in my menu with a count, and in the approvals inbox, as the same list, so nothing waits unseen.
2. When I work in Finance, I want the Finance page and the home to show the same waiting list.
3. When I made a request, I want to see who it waits for and at which step.
4. When my request is returned or refused, I want to be told with the reason, in my language.
5. When I open a returned request again, I want what I typed and the reason it came back.

## Requirements (EARS)
- FR-WAIT-001 The system shall have ONE list of what a login can decide now. The home list, the Approvals badge, the Finance page and the Approvals inbox shall read it; its headline count shall equal its length; while any kind is unread or failed it shall show no count.
- FR-WAIT-002 The list shall cover every kind of decision a login can make: purchase approval, timesheet, expense claim, customer invoice, material-request step at each step, leave, site cash, daily report validation, work order issue, delivery record confirmation (a purchase received; a transfer received), client acceptance (BAST) confirmation, quantity change, subcontract certificate, equipment plan.
- FR-WAIT-003 A kind shall be ONE registered entry; a kind with no registry entry, no read or no inbox row shall fail a test.
- FR-WAIT-004 Where a kind had no per-person read, the database shall list it (`my_waiting_decisions`), with the same predicate as the function that finally decides it. A material-request step counts whatever the organisation's notification setting says; the setting governs only whether a notification is also written.
- FR-WAIT-005 Anyone who can decide anything shall have the Approvals entry, with or without something waiting (`my_decision_standing`).
- FR-WAIT-006 A waiting record shall name who it waits for, in the reader's language: "Waiting for <name>, <role> (step n of m)" from the route the database computed.
- FR-WAIT-007 When a material request, a daily report, a subcontract certificate or an equipment plan is returned or refused, the requester shall get a notification with the reason; approvals shall say what was approved. Titles the database writes shall be shown in the reader's language.
- FR-WAIT-008 A returned material request shall open with the reason it came back and the over-plan reason typed before.

## Acceptance criteria (owning layer)
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WAIT-001..019 | `my_waiting_decisions` and `my_decision_standing` per role, SoD, project scope, other organisation, state changes, closed kind list | pgTAP `1560_waiting_decisions.test.sql` |
| AC-NTF-001..018 | requester notified with reason and label; decider not notified | pgTAP `1561_requester_notified.test.sql` |
| AC-WAIT-020..024 | the badge is the shared list's count; never partial; retained across refresh | Unit `ApprovalsNavCount.test.tsx` |
| AC-WAIT-031..035 | the waiting sentence in English and Bahasa Indonesia | Unit `waitingFor.test.ts` |
| AC-WAIT-040..042 | the registry is the enumerated list; every kind draws a home row | Unit `waitingKinds.test.ts` |
| AC-WAIT-050..055 | one list, oldest first, count = length, pending/failed withhold the count, setting-independent | Unit `useWaitingForYou.test.tsx` |
| AC-WAIT-060 | every database title has English and Bahasa text | Unit `notificationCopy.test.ts` |
| AC-WAIT-056 | a client acceptance (BAST) waiting on an Admin/Finance viewer joins the one list and its count, links to its work order, and leaves it on confirmation; a role that cannot confirm issues no read | Unit `useWaitingForYou.test.tsx`, `approvalItem.test.ts`, `waitingKinds.test.ts`, `Approvals.waitingKinds.test.tsx`; pgTAP `1570_bast_confirm_owner.test.sql`; e2e `JOB-PM-7` |
| JOB-WAIT-1 | the step approver finds the request on home, menu with count, inbox | E2E `serial/JOB-WAIT-1-…` |
| JOB-WAIT-2 | Finance: home, Finance page and inbox show the same list and number | E2E `serial/JOB-WAIT-2-…` |
| JOB-WAIT-3/4/5 | the requester sees who it waits for; a return notifies with the reason; editing keeps what was typed | E2E `serial/JOB-WAIT-3-4-5-…` |

## Decisions and open questions
- Client acceptance (BAST) confirmation is its own waiting kind with its own caller-filtered database read (`acceptances_awaiting_my_confirmation`, migration 1570), never the `delivery_record` kind (that is the purchase receipt) and never `my_waiting_decisions`. The read lists who MAY confirm (Draft on an Issued order, Admin/Finance, the author excluded unless the only active member); eligibility is not a promise the write succeeds — the document/line prerequisites and the separation-of-duties refusal stay in `confirm_work_order_acceptance`. The read carries no row cap and the client pages it, so a waiting count is never a truncated one.
- The material-request approver-inbox setting no longer hides a waiting step from the list, badge or inbox (it still governs notifications). This is a change from `material-request-approver-inbox.spec.md` (AC-MRI-013/014), made on the owner's brief: a step the database says is yours is yours.
- `work_order_issue` lists Draft orders that carry a value someone else set and that the viewer may issue; it does not list orders the viewer priced themselves.
- `transfer_receipt` is narrower than the receive gate on purpose (a senior role may receive any transfer; only transfers addressed to the viewer or kept by them are "waiting for" them).
- Not yet in the list (no per-person read or no waiting state): work-order candidates awaiting accept or reject, billing steps (already on the home, by role), and leave for someone who is not a login.
