# Spec: Work-order close-out checklist (#2593)

**Status:** proposed; owner decisions below need sign-off before build. Map #2516. Target February to March 2027, after the 15 December go-live. IDs `FR-WCO-###`, `NFR-WCO-###`, `AC-WCO-###`, `OD-WCO-#`. Plan: `docs/plans/2026-11-21-work-order-closeout-checklist.md`. Executor: Orca worker, **Director-dispatched**: it adds a precondition to closing a work order, which fixes the closing value and the money path (`docs/money-path-primer.md`, ADR-0019). It ships alone. It adds no amount and changes no separation-of-duties rule.

## Job story

When a work order's work is finished, I want an ordered close-out checklist set by my organisation (acceptance letters, completion certificates, close-out documents), each item backed by an attached document, so that the work order closes only when every required item is done and the record shows who closed it.

## Context and boundary (checked against `origin/dev`, 20 Nov 2026)

- A work order moves `Draft` to `Issued` to `Closed` or `Cancelled` through `transition_work_order(p_id, p_to, p_over_commit_ack)` (0193, redefined 0337). Roles allowed: Admin, Executive, Project Manager, Finance. It stamps `work_orders.closed_at`; there is **no** `closed_by` column today.
- There are **two** ways a work order becomes `Closed`, and the gate must cover both: (1) `transition_work_order(..., 'Closed')`, which 0337 refuses outright for a work order that has contract lines ("close it by confirming its final BAST"); (2) `confirm_work_order_acceptance` (0337), which for a final acceptance sets `closing_value`, `closing_acceptance_id`, `status = 'Closed'`, `closed_at` in one update guarded by `pmo.confirming_work_order_acceptance`. A single `before update` trigger on `work_orders` that fires when `status` becomes `Closed` covers both with one predicate, the same approach the invoice gate uses on `sales_invoices` and `external_command_outbox` (1021, `assert_claim_billing_stages_complete`).
- The billing-stage mechanism to reuse (1021, `docs/specs/billing-stages.spec.md`): an ordered list on the project copied onto each claim at creation; each item has a document checklist; a document is attached only if it is a `project_documents` row of the project with status Issued or Approved and a file; items complete in order; stage age is days current (`stageAgeDays`, `pmo-portal/src/lib/billingStages.ts`). The final acceptance already uses the same document rule (0337 `confirm_work_order_acceptance`).
- The checklist template is **organisation-wide** (the issue says "set by the organisation"), not per contract. A project-level override is a later extension (OD-WCO-2).
- The work-order record page sections live in `pmo-portal/pages/work-order-detail/` (`ScopeSection`, `BillingSection`, `DocumentsSection`, `CostSection`, `PlanVsActualSection`); the route is `/work-orders/:id` (`docs/specs/work-order-record-page.spec.md`).
- Out of scope: reopening a closed work order, a checklist on Draft or Cancelled work orders, per-item approvers, e-signatures, auto-generating documents.

## Requirements (EARS)

**The organisation's list**
- FR-WCO-001 Admin shall be able to define the organisation's close-out checklist as one whole ordered list of 0 to 20 items, each with a name (1 to 120 characters) and a **required** flag (default required). The list is replaced whole through one function, as `set_billing_stage_template` does. Every item, when done, needs an attached document; the flag decides whether the item must be done before close.
- FR-WCO-002 When a work order is issued (`Draft` to `Issued`), the database shall copy the organisation's current list onto the work order as its checklist. Editing the organisation's list later shall not change a work order already issued. A work order that was already `Issued` when this ships has no checklist and closes as today (OD-WCO-3).

**Recording items**
- FR-WCO-010 When Finance, an Admin or the project's manager attaches a document to an item, the database shall accept only a `project_documents` row of the work order's project whose status is Issued or Approved and that has a file, and shall refuse any other.
- FR-WCO-011 When an item is marked done, the database shall require an attached document, a done date that is not in the future (organisation today) and not before the previous item's done date, and that every earlier item is done (ordered, OD-WCO-4). It shall record who marked it and when.
- FR-WCO-012 While an item is done, or its work order is not `Issued`, the item and its document shall not change.
- FR-WCO-013 Each item shall show its **age** in days: from the day it became current (the work order's issue date for the first item, otherwise the previous item's done date) to its done date, or to today while open.

**Closing**
- FR-WCO-020 While a work order's checklist has a required item not done, the database shall refuse to close it, by either route, with detail `closeout-incomplete`, naming how many required items are open.
- FR-WCO-021 When a work order becomes `Closed`, the database shall record the person who closed it in a new `closed_by` column, set by the server from the caller and never from the client, and shall keep `closed_at`.
- FR-WCO-022 A work order whose organisation list was empty when it was issued, or whose checklist has every required item done, shall close exactly as it does today; no other close rule shall change, including the final acceptance's closing-value rules and the contract-lines refusal of the transition route.
- FR-WCO-023 An optional (not required) item left open shall not block closing and shall show as "not done" on the record.

**Access and tenancy**
- FR-WCO-030 No client write grant shall exist on the new tables. Every function is `security definer`, re-asserts active membership, role and organisation, locks the work-order row `for update` in the order `transition_work_order` and `confirm_work_order_acceptance` use, and writes an audit event.
- FR-WCO-031 Only Admin shall replace the organisation's list. Finance, Admin and the work order's project manager may attach documents and mark items done; Engineers and Viewers shall be refused (`42501`).
- FR-WCO-032 Reads shall be limited to active members of the work order's organisation; another organisation's list and items are never returned.

## Non-functional requirements
- NFR-WCO-001 Additive migration; existing work orders and the closing paths behave as today when no checklist exists.
- NFR-WCO-002 New tables carry `org_id` stamped by the server, RLS on, `(select helper())` wrappers on every caller-context helper (`supabase/tests/0646_rls_initplan.test.sql`).
- NFR-WCO-003 English and Bahasa Indonesia strings in a new namespace; `DESIGN.md` tokens; usable at phone width; a done item names its document, date and person.
- NFR-WCO-004 A close refused for an open checklist shows the shared error state with the count, never a generic failure.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WCO-001 | Given Admin saves a list of three items (one optional), when a Draft work order is issued, then it has those three items in order, none done; a later edit of the list does not change it. | pgTAP |
| AC-WCO-002 | Given a Finance user, Project Manager or Engineer, when they replace the organisation's list, then only Admin succeeds; the rest are refused `42501`. | pgTAP |
| AC-WCO-003 | Given an item with no document, when someone marks it done, then it is refused; with an Issued or Approved document of the same project it succeeds; a Draft document, one with no file, or another project's is refused. | pgTAP |
| AC-WCO-004 | Given items A, B, C, when B is marked done before A, then it is refused (`item-out-of-order`); a future date, or a date before A's, is refused; a done item cannot be marked again. | pgTAP |
| AC-WCO-005 | Given a work order with no contract lines and a required item open, when a Project Manager closes it by `transition_work_order`, then it is refused `closeout-incomplete`; with every required item done it closes and `closed_by` is the caller. | pgTAP |
| AC-WCO-006 | Given a work order with contract lines, a confirmed-ready final acceptance and a required item open, when the acceptance is confirmed, then it is refused `closeout-incomplete`, the acceptance stays unconfirmed and no closing value is stamped; with the checklist complete the same confirmation closes it, stamps the closing value and `closed_by`. Mutation: remove the trigger and both closing halves must go red. | pgTAP |
| AC-WCO-007 | Given an optional item left open and every required item done, when the work order is closed, then it closes. Given an organisation with an empty list, a work order closes as before. | pgTAP |
| AC-WCO-008 | Given an item's age, when the work order was issued on 1 March and today is 11 March, then the first item's age is 10; if done on 5 March, 4; the second item starts on 5 March. | Unit (`pmo-portal/src/lib/closeoutChecklist.test.ts`) |
| AC-WCO-009 | Given a user of another organisation, when they read or write the list or any item, then nothing is returned or changed. | pgTAP |
| AC-WCO-010 | Given a work order that was already `Issued` before the migration, when it is closed, then it closes under the old rules. | pgTAP |
| AC-WCO-011 | Given the record page of an Issued work order with a checklist, when Finance attaches a document and marks the first item done, then the item shows done with document, date and person, the next item is current, and the Close action reports how many required items remain. | RTL (`CloseoutSection.test.tsx`) |
| AC-WCO-012 | Given the journey issue work order, complete every item with documents, close it, then the record shows Closed with the closing person. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Close with a required item open | `55000`, detail `closeout-incomplete`, count in the message |
| Mark done out of order | `55000`, detail `item-out-of-order` |
| Item has no attached document | `55000`, detail `item-document-missing` |
| Document not Issued or Approved, no file, or another project's | `23514`, detail `item-document-invalid` |
| Future or earlier-than-previous date | `22023`, detail `item-date-invalid` |
| Role not allowed | `42501` |
| Work order not Issued | `55000`, detail `work-order-not-issued` |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-WCO-1 | One **organisation-wide** list, copied onto each work order when issued. | One list for every contract may not fit a contract that needs a different certificate; the team must mark it optional or hold the document elsewhere. A per-contract list adds setup per contract. |
| OD-WCO-2 | A project-level override of the list is deferred. | Contract-specific close-out documents cannot be enforced until the override ships. |
| OD-WCO-3 | Work orders already `Issued` at release have **no checklist** and close as today; the list applies to work orders issued after it ships. | Backfilling would block closing work orders already in flight whose documents were collected another way. Not backfilling leaves them unguarded until they close. |
| OD-WCO-4 | Items complete **in order**, like billing stages. | Strict order forces someone to wait on an earlier document before recording a later one that arrived first. Any order is a small change (drop the order check) at the cost of the age rule. |
| OD-WCO-5 | The checklist must be complete **before** the final acceptance is confirmed, because confirming it closes the work order and stamps the closing value irreversibly. | Allowing the acceptance first would have to leave the work order `Issued` after its closing value is fixed, a state that does not exist today. |
| OD-WCO-6 | Attach and mark done: Finance, Admin and the project's manager. List: Admin only. Closing keeps the roles `transition_work_order` allows. | Too narrow: field staff cannot record what they collected. Too wide: anyone can mark a document as the certificate. |
| OD-WCO-7 | The checklist records who marked each item and who closed the work order; it adds no second approver. | A second approver is separation of duties; if the owner wants one, it is a server-enforced rule (ADR-0019) and a separate decision. |

## Delivery checklist
- [ ] Owner signs OD-WCO-1..7.
- [ ] Owner sketch-glance of the record page section before build.
- [ ] Glossary: Close-out checklist, Close-out item (`docs/glossary.md`).
- [ ] After release: `improve-codebase-architecture` on the changed areas.
