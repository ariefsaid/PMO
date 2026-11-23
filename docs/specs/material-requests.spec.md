# Spec: Material requests against a work order (#2524)

**Status:** accepted (Director rulings 2026-11-20). IDs `FR-MRQ-###`, `NFR-MRQ-###`, `AC-MRQ-###`. Plan: `docs/plans/2026-11-20-material-requests.md`. Executor: Director-dispatched (approval order, stand-in and stock transfer are SoD and stock paths; ships alone). Map #2516; blocked by #2517 (work order on every cost line) and #2523 (read for its stock-to-work-order contract before build).

## Job story

When a site needs material for a work order, I want to request items and quantities with a needed-by date and have the right people approve in order, so that stock moves to the work order on a delivery document and nobody has to chase approvals by message.

## Context and boundary

- Stock documents already exist (`stock_documents`, 0413: kinds receive/transfer/issue, Draft/Posted/Cancelled, `project_id`, `client_request_id`) with a posting engine. An approved request **creates a transfer draft** to the work order's destination; posting stays with the stock keeper through the existing engine (OD-MRQ-5). Money and valuation are never computed here.
- "Plan" quantity = the work order's planned material need (budget/BoQ material line from #2517/#2523). Name of that source is reconciled at build (OQ-MRQ-1).
- Approvals use the repo's server-enforced SoD pattern (ADR-0019), not a hidden button.

## Requirements (EARS)

**Request**
- FR-MRQ-001 The system shall let an authorized user create a request for one work order with one or more lines (stock item, quantity, unit) and a needed-by date.
- FR-MRQ-002 Each line shall show planned quantity, quantity already requested/transferred, and the new total. When the new total exceeds plan, the line shall require a reason (1 to 500 characters); the server rejects an over-plan line without one. In the material-request server slice, prior quantity is the quantity on pending, approved and fulfilled material requests. Once site stock (#2523) lands, prior quantity shall be posted stock movements on the work order plus pending or approved requests not yet fulfilled; fulfilled requests are represented by their movements and shall not be counted again.
- FR-MRQ-003 The request shall hold a status: `draft`, `pending`, `approved`, `rejected`, `cancelled`, `fulfilled`. Items, quantities and the needed-by date are editable only in `draft` or after a return (FR-MRQ-012).
- FR-MRQ-004 Create and submit shall be idempotent on a client-generated `client_request_id`.

**Approval chain**
- FR-MRQ-005 The system shall let an Admin define, per organisation, an **ordered approval chain** of steps, each naming a role (an access level, or a built-in role per `roles-that-decide.spec.md` FR-RTD-004) and a purpose label (e.g. engineer: plan vs requested; construction: billable change; material coordinator: stock). A step may be marked "only when over plan" (OD-MRQ-2).
- FR-MRQ-006 When a request is submitted, the system shall snapshot the applicable steps onto it; later chain edits do not change in-flight requests.
- FR-MRQ-007 The system shall present a step to users who hold its role and have access to the work order's project; steps are taken **in order**; step n+1 opens only after step n is approved.
- FR-MRQ-008 Each step decision shall be `approve` or `return`/`reject` with a reason for the latter; the decider's identity and time are stored. A user shall not decide a step on a request they created, and shall not decide two different steps of the same request across its rounds (server-enforced SoD). After a return, the same person may decide the same step again; a step is the same only when its position, role and label all match the earlier snapshot. A renamed, reordered or otherwise changed step counts as different, so the restriction errs strict after chain edits.
- FR-MRQ-009 A user may name a **stand-in** for a date range; the stand-in must be an active same-organisation user and may act on steps of the delegator's role in that range. A stand-in is not recorded as the delegator; both identities are stored. A stand-in cannot be the request's author and chains of stand-ins are not followed (one hop).
- FR-MRQ-010 A step's decider may be a stand-in only if the delegation was active at decision time, checked server-side.
- FR-MRQ-011 When the final step is approved, the system shall mark the request `approved` and record the decision; the final approver need not keep any warehouse. Choosing the source warehouse and creating the stock transfer draft (the request's lines, the work order via #2517, a link to the request; the delivery document is that transfer's printable document) is the stock keeper's step, limited to a keeper of that location (or an Admin). A final approver who does keep a warehouse may name it at approval, and the draft is then created in the same transaction; if that creation fails the request stays at the last step and the error is shown.
- FR-MRQ-012 When a step returns a request, it goes to `draft` for the author to amend and resubmit, restarting at step 1 (OD-MRQ-3); a rejection is final.
- FR-MRQ-013 When the linked transfer is posted, the request shall become `fulfilled`; a cancelled draft transfer returns the request to `approved` with a flag "transfer cancelled".

**Cut-off**
- FR-MRQ-014 Where the organisation sets a **daily cut-off time** (time of day in project-local time, optional), a request needed-by the next calendar day shall be accepted only when submitted before the cut-off; otherwise it shall be refused with the earliest accepted date. A request for later dates is unaffected. With no cut-off set, nothing is refused.
- FR-MRQ-015 Cut-off is evaluated server-side at submission using server time and the project's time zone; the client display is advisory.

**Pinned approver (#2598, option 3: role by default, person optional)**
- FR-MRQ-022 Where an Admin or the project's manager pins a chain step to a named person on a project, the system shall let only that person, or their in-window stand-in, decide that step on requests for work orders of that project. A step with no pin stays role-level.
- FR-MRQ-023 The pinned person shall be an active member of the organisation who holds the step's role (a project is visible to every active member, so nothing further is checked). The server refuses any other approver, a position the chain does not have, and a caller who is neither an Admin nor the project's manager.
- FR-MRQ-024 The pin is read at decision time and applies only while the chain step at that position still has the pinned role; every other rule (order, not the author, not two steps of one request, stand-in window) still holds. A stand-in acts only for the pinned person.
- FR-MRQ-025 The queue "waiting for me" shall list a pinned step only for the pinned person and their stand-ins. The pin is set per project on the project screen, in English and Bahasa Indonesia.
- FR-MRQ-026 While a pinned person is not an active member or no longer holds the pinned role, the pin shall not bind its step: the step follows its role rule (and stand-ins for role holders) and appears in those holders' queues, and the project's setting screen flags the pin as needing attention until an Admin or the project's manager re-points or clears it. The pin row is kept.

**Request date defaults and cut-off visibility (#2571)**
- FR-MRQ-020 When a new request form opens, the system shall default the needed-by date to the day after today in the organisation's calendar (the organisation time zone), and the earliest pickable date shall be today in that calendar, never the browser's or UTC's date.
- FR-MRQ-021 The daily cut-off control shall be shown only to roles allowed to change it (the Admin role, matching the database rule); other roles shall not see it.

**Access, lists, audit**
- FR-MRQ-016 Actions (create, submit, approve-step, manage chain, manage stand-in, view) shall be registered in the role matrix (#902); `can()` gates UI; RLS/RPC enforce. A field controller may create and submit for work orders in their scope.
- FR-MRQ-017 A queue "waiting for me" shall list pending requests where the current user (or someone they stand in for) is the open step's approver, oldest first.
- FR-MRQ-018 Each transition shall be written to record history with actor, time and reason.
- FR-MRQ-019 Lists filter by work order, status, needed-by range; stable order; bounded pagination.

## Non-functional requirements
- NFR-MRQ-001 `org_id` seam, RLS on every new table, `org_id` never from the client; indexes on (work_order_id, status) and (open step role).
- NFR-MRQ-002 Phone-usable at 320px, keyboard accessible, `DESIGN.md` tokens, English and Bahasa Indonesia.
- NFR-MRQ-003 Quantities are exact decimals, positive, bounded by the item's unit rules.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MRQ-001 | Given a line whose total exceeds plan, when submitted without a reason, then refused; with a reason it is accepted. | pgTAP + Unit |
| AC-MRQ-002 | Given a three-step chain, when step 2's approver acts before step 1, then refused; after step 1 it is allowed. | pgTAP |
| AC-MRQ-003 | Given a request, when its author approves a step, then refused (mutation check: disable the rule, test goes red). | pgTAP |
| AC-MRQ-004 | Given one user holding two step roles, when they approve step 1 then step 2 of the same request, then step 2 is refused. | pgTAP |
| AC-MRQ-005 | Given an approver away with a stand-in named for today, when the stand-in approves, then it is accepted and both identities are stored; outside the range it is refused. | pgTAP |
| AC-MRQ-006 | Given a stand-in who is also the request author, when they approve, then refused. | pgTAP |
| AC-MRQ-007 | Given the final approval, when it completes, then exactly one transfer draft exists with the request's lines linked to the work order and the request is `approved`; nothing is posted. | pgTAP |
| AC-MRQ-008 | Given a failed transfer creation, when the final step is approved, then the request is not `approved` and no partial transfer exists. | pgTAP |
| AC-MRQ-009 | Given a cut-off of 12:00, when a next-day request is submitted at 11:59 and 12:01 project time, then the first is accepted and the second refused with the earliest date; a request for two days ahead at 12:01 is accepted. | pgTAP |
| AC-MRQ-010 | Given a step returns a request, when the author amends and resubmits, then it restarts at step 1 with a fresh snapshot of the chain. | pgTAP + Unit |
| AC-MRQ-011 | Given an in-flight request, when the chain is edited, then the in-flight request keeps its snapshot. | pgTAP |
| AC-MRQ-012 | Given the transfer is posted, when viewed, then the request shows `fulfilled`. | pgTAP |
| AC-MRQ-013 | Given pending requests across roles, when an approver opens "waiting for me", then only their open steps (and those they stand in for) appear. | Unit + pgTAP |
| AC-MRQ-014 | Given a user in another organisation, when they read or act, then refused. | pgTAP |
| AC-MRQ-015 | Given a field controller on a phone, when they raise an over-plan request and three approvers act in order, then a transfer draft with its delivery document is reachable from the request. | E2E (one journey) |
| AC-MRQ-016 | Given a project, when its manager or an Admin pins step 3 to a Finance person, then it is stored; when anyone else tries, then refused. | pgTAP + Unit |
| AC-MRQ-017 | Given a pin to someone without the step's role, a deactivated member, another organisation's user, or a position the chain lacks, then refused. | pgTAP + Unit |
| AC-MRQ-018 | Given a pinned step, when another holder of the role decides it, then refused and absent from their queue; the pinned person and their stand-in may (both identities stored); a stand-in for someone else may not (mutation check: ignore the pin, test goes red). | pgTAP |
| AC-MRQ-019 | Given a user in another organisation, when they pin or read pins, then refused and nothing visible. | pgTAP |
| AC-MRQ-020 | Given a non-Admin and an Admin, when each opens the approval settings, then only the Admin sees the cut-off control and its save button. | Unit |
| AC-MRQ-021 | Given 23:30 UTC on the 20th and an organisation in UTC+7, when a new request opens, then needed-by defaults to the 22nd (and to the 21st for a UTC-8 organisation), and the saved draft carries that date. | Unit |
| AC-MRQ-022 | Given a pin is cleared, when the step opens, then any holder of the role may decide it again. | pgTAP + Unit |
| AC-MRQ-023 | Given a pinned step whose person is deactivated or lost the step role, when a role holder (or a stand-in for one) looks at their queue and decides, then the step is theirs (mutation check: drop the liveness test, go red). | pgTAP |
| AC-MRQ-024 | Given such a stuck pin, then the row is kept, the setting screen shows it as needing attention, and re-pointing it to a live person binds again. | pgTAP + Unit |
| AC-MRQ-030 | Given a final approver who keeps no warehouse, when they approve without naming one, then the request is `approved`, has no transfer yet, and waits on a keeper. | pgTAP |
| AC-MRQ-031 | Given an approved request without a transfer, when a person who does not keep the warehouse tries to send from it (an approver included, or by naming it at approval), then they are refused; the keeper of that warehouse makes the transfer (mutation check: drop the keeper test, go red). | pgTAP |
| AC-MRQ-032 | Given the requester, when they try to approve or send stock for their own request, then both are refused. | pgTAP |
| AC-MRQ-033 | Given a final approver who keeps a warehouse, when they name it at approval, then the transfer draft is made at once. | pgTAP |

## Errors
| Condition | Result |
|---|---|
| Over plan, no reason | Field error on the line |
| After cut-off for next day | Refusal naming the cut-off and earliest date |
| Approve out of order / by author / twice | Refused with reason |
| Decide a pinned step as another holder of the role | Refused: pinned to another approver on this project |
| Transfer creation fails | Request stays pending at last step; error shown; retry |
| No user holds the open step's role | Queue shows "no approver"; Admin can reassign role holders, not approve |

## Owner decisions (accepted 2026-11-20)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-MRQ-1 | Chain is organisation-wide, ordered; per-project override is out of scope. | Different projects needing different chains cannot be modelled. |
| OD-MRQ-2 | A step may be "only when over plan"; default chain: engineer (over-plan only), construction (always), material coordinator (always). | Always-on engineer step slows every request; never-on skips the plan check. |
| OD-MRQ-3 | A return restarts at step 1. | Resuming at the returning step lets an earlier approver's view go stale after edits. |
| OD-MRQ-4 | Stand-in: one hop, date-ranged, set by the delegator or an Admin. | Open-ended or chained delegation lets approval drift to unreviewed people. |
| OD-MRQ-5 | Approved request creates a transfer **draft**; the keeper posts. | Auto-post changes stock and valuation unchecked. |
| OD-MRQ-6 | Cut-off applies to next-day needed-by only, one time for the organisation. | Per-project or per-category cut-offs are not covered. |
| OQ-MRQ-1 | **Answered:** plan = the work order's allocated contract (BoQ) material quantity. | Over-plan test compares to the wrong number. |
| OQ-MRQ-2 | **Accepted:** coordinator picks the source warehouse at the stock step. | Wrong source warehouse on the delivery document. |

**Build check (OQ-MRQ-1 vs migrations 1000-1001):** `mrq_plan_quantity` takes the BoQ material allowance per BoQ line, prorated by the work order's share of that BoQ line's quantity, not the raw BoQ quantity. No allowance means plan 0, so any request is over plan. Matches the answer in spirit (allocated share of the contract quantity); the spec does not yet say the proration or the zero-plan rule.

## Delivery checklist
- [x] Owner signs OD-MRQ-1..6; answer OQ-MRQ-1..2; read #2523.
- [ ] Server slice with pgTAP and mutation checks ships alone; UI slice follows.
- [ ] Glossary: material request, approval chain, stand-in, cut-off.
