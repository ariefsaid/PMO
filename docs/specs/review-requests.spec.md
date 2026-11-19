# Request activation / request review handoff (budget drafts and work orders)

Issue #980 (map #791). Status: **Draft, 2026-11-15** — awaiting owner sign-off of the three questions at the end of
`docs/plans/2026-11-15-review-requests.md`. Executor on sign-off: Orca worker per `docs/orca-dispatch.md`.
Migration: `NNNN` (number on request).

**Money path: yes (budget activation is a money action; work-order issue freezes a PO value).** No change to who may
activate or issue, and no change to the existing separation-of-duties (SoD) rules. This only adds a durable "please
review this" record and a queue entry. It ships alone, with the three reviewers.

**Job story.** When I have finished a budget draft or a work order that someone else must activate or issue, I want to
ask a reviewer inside the app and see who it is waiting on and since when, so the handoff stops happening by chat or
email and nothing sits unnoticed.

## 1. AS-IS (shipped)

- **Budget activation.** `activate_budget_version` (`supabase/migrations/0579_budget_range_activation.sql:113`) is the
  authority: Admin/Executive/Project Manager/Finance, active member, SoD (no version editor, and not the drafter,
  except a sole operator). The FE mirror is `budgetVersion.transition` in `pmo-portal/src/auth/policy.ts`. The
  org-wide Draft list is `BudgetDraftReview` (`pmo-portal/src/components/finance/BudgetDraftReview.tsx`, DAL
  `listOrgDraftBudgets`, `pmo-portal/src/lib/db/budgets.ts`). There is no way for the author to ask anyone.
- **Work-order issue.** `transition_work_order` (`0337`) enforces the issue SoD (the person who set the value cannot
  issue it; the reviewer must outrank or line-manage). Actor-specific eligibility is
  `work_order_issue_eligibility` (`0394_action_eligibility.sql:99`), used by `WorkOrdersTab.tsx`. No handoff exists.
- **Procurement.** The one real handoff: `Draft→Requested` notifies eligible approvers
  (`0237_workflow_notifications.sql`, `notify_workflow_user`), and `get_procurement_approval_routes` returns the
  routed approvers (`pmo-portal/src/lib/db/approvalRoutes.ts`, `ApprovalRoute`). The approvals inbox
  (`pmo-portal/pages/Approvals.tsx`, `src/lib/selectors/approvals.ts`) lists procurement, timesheet, expense and
  invoice kinds only; the requester does not see who a request waits on.
- **Notifications.** `public.notifications` (`0048`) + `notify_workflow_user` (security definer, never notifies the
  actor, same-org active members only).

## 2. TO-BE

A generic, persisted **review request** attached to a Draft budget version or Draft work order. Reuses the existing
notification helper and the `/approvals` inbox. No separate review service. No "Requested" status is added to
`budget_versions` or `work_orders`: the request is its own row, so nothing is invented without persistence.

### 2.1 Requirements (EARS)

- **FR-RRQ-001** The system shall store a review request with the kind (`budget_version` | `work_order`), the target
  record, the requester, an optional named reviewer, an optional note (max 500 chars), `requested_at`, and a state
  (`Open` | `Withdrawn` | `Resolved`) with `resolved_at`.
- **FR-RRQ-002** When a user who may edit a Draft budget version or Draft work order requests review, the system shall
  create an `Open` request. Budget kind label: "Request activation"; work-order kind label: "Request review".
- **FR-RRQ-003** While a request is `Open` for a record, the system shall refuse a second request for it (at most one
  `Open` per record, enforced by the database).
- **FR-RRQ-004** When a request is created, the system shall notify the eligible reviewers (the named reviewer if one
  was chosen, otherwise the whole eligible pool), never the requester, using `notify_workflow_user`.
- **FR-RRQ-005** The eligible pool shall equal the people the existing authority would let activate/issue: for a
  budget, the `activate_budget_version` population minus every recorded editor and the drafter (unless sole
  operator); for a work order, those for whom `work_order_issue_eligibility` is `allowed`. A named reviewer outside
  the pool shall be refused.
- **FR-RRQ-006** The `/approvals` inbox shall list each `Open` request to an eligible reviewer (named reviewer or pool
  member), as new kinds "Budget awaiting activation" and "Work order awaiting review", linking to the record where the
  existing activate/issue action lives. The inbox shall not add a second decision path: deciding stays on the record.
- **FR-RRQ-007** When the record leaves Draft by activation, issue or cancel, the system shall mark the request
  `Resolved` in the same transaction and notify the requester.
- **FR-RRQ-008** When the requester (or an Admin) withdraws an `Open` request, the system shall mark it `Withdrawn`
  and remove it from reviewers' queues.
- **FR-RRQ-009** The requester shall see "Waiting for {reviewer}" (named reviewer) or "Waiting for {pool label}" and
  the time sent, on the draft budget and the draft work order. After withdrawal or resolution the line disappears.
- **FR-RRQ-010** A procurement in `Requested` shall show the same line to its requester using the routed approvers
  from `get_procurement_approval_routes` and the request time; no new storage.
- **FR-RRQ-011** The system shall enforce tenancy (`org_id` stamped by default, RLS on the new table), read access
  limited to the requester and the eligible reviewers, and writes only through security-definer RPCs.
- **FR-RRQ-012** UI strings shall exist in en and id: Request activation / Ajukan aktivasi, Request review / Ajukan
  peninjauan, Waiting for {reviewer} / Menunggu {reviewer}, plus withdraw and duplicate messages.
- **FR-RRQ-013** If the requester lacks edit rights on the record, or the record is not Draft, the system shall refuse
  the request.

### 2.2 Acceptance criteria (Given/When/Then)

- **AC-RRQ-001** Given a Draft budget the author edited, when they request activation, then one `Open` request exists
  with their id and timestamp.
- **AC-RRQ-002** Given an `Open` request, when the same or another user requests again, then it is refused and the
  existing request is unchanged.
- **AC-RRQ-003** Given a request with no named reviewer, when created, then every eligible pool member has one new
  notification and the requester has none.
- **AC-RRQ-004** Given a named reviewer outside the pool (an editor of the version), when requesting, then it is
  refused with no row and no notification.
- **AC-RRQ-005** Given an eligible reviewer, when they open `/approvals`, then the request appears with kind, project,
  requester and age; an ineligible user's inbox does not show it.
- **AC-RRQ-006** Given the reviewer activates the budget (or issues the work order), then the request is `Resolved`
  and the requester is notified, in one transaction.
- **AC-RRQ-007** Given an `Open` request, when the requester withdraws, then it is `Withdrawn`, the reviewer's inbox
  entry is gone, and a new request can be made.
- **AC-RRQ-008** Given an `Open` request, when the requester views the draft, then they see "Waiting for {reviewer}" and
  the sent time; in Bahasa, "Menunggu {reviewer}".
- **AC-RRQ-009** Given a procurement in `Requested` routed to named approvers, when the requester opens it, then it
  shows "Waiting for {those names}" and the request time.
- **AC-RRQ-010** Given a user in another org, when they select or call the RPCs for this record, then nothing is
  returned and nothing is written.
- **AC-RRQ-011** Given a Draft work order cancelled before review, then its `Open` request becomes `Resolved`.
- **AC-RRQ-012** Given a non-Draft record or a user without edit rights, when requesting, then it is refused.

## 3. Out of scope

Comments or threads on a request; reminders/escalation; email delivery; changing activation/issue authority or SoD;
other record kinds (invoices, expenses keep their own flows); a pool picker beyond "named reviewer or everyone".
