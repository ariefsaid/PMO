# Spec: Monthly equipment and service plan turned into rental orders (#2700)

**Status:** draft for Director review. IDs `FR-EQP-###`, `NFR-EQP-###`, `AC-EQP-###`, `OQ-EQP-###`. Plan: `docs/plans/2026-11-21-monthly-equipment-service-plan.md`. Map #2516, target 15 December 2026, size M. Rulings that bind this spec: OD-SCOPE-2 (no client process in code; lists and steps are data), OD-SCOPE-12 (monthly equipment and service plan pulled forward), OD-SCOPE-16 (the monthly plan ships on 15 December; resource-conflict detection is Q1 2027). Stacked on #2697 (purchase types, `is_rental`, rental period, `create_procurement_with_items` with a type).

## Job story

When I plan the month's equipment and services, I want the plan to become rental orders, so nothing is ordered twice by hand.

## Context and boundary

- A **plan** is the intention for one project for one calendar month: lines of what is needed on which work order, from which vendor, at what quantity and rate, between which dates. It is not money: it commits nothing and posts nothing.
- **Approving a plan** is an approval rule enforced in the database. It creates the rental purchases in the same transaction. Each created purchase is an ordinary **Draft** purchase of the organisation's rental type; it then takes the normal request, approval and spend-routing path (nothing is auto-approved, no amount or status is carried over). Plan approval never approves spend.
- The rental type is resolved by the `is_rental` flag of the organisation's own list (purchase types, #2697), never by name. `create_procurement_with_items` is called as it is; it is not re-created.
- Existing equipment (assets, usage, availability, rental check) is untouched. A plan line may name an equipment asset for reference; it does not allocate, reserve or check conflicts (Q1 2027).
- The approval step reuses what exists: the organisation's spend approvers (project list, then the senior set, then an Admin; DD-APR-4) or the spend-authority role rank (`holds_spend_approval_authority`, ADR-0070). No new engine.

## Design decisions (justified; the Director may overrule)

| Decision | Choice | Why |
|---|---|---|
| Plan grain | One plan per project per calendar month; unique on (org, project, month). A rejected plan is reopened and resubmitted, not duplicated. | A month's need is read and approved as one; a second plan for the same month would invite the double ordering the job story forbids. |
| Order grain | One rental purchase **per plan line**. | A purchase carries a single rental period and one vendor (OQ-PTR-3), and a line carries its own dates; grouping by vendor would force one period across lines. A per-line id keeps idempotency exact (`procurement_id` unique on the line). |
| Idempotency | The purchase id is derived from the line id; `equipment_plan_lines.procurement_id` is unique; approval is a status transition guarded by a row lock; one transaction creates all orders or none. | A re-approve or retry finds the plan Approved and creates nothing; a failure rolls back every order, so no half-created plan exists. |
| Requester of the created purchases | The approver (the caller of `create_procurement_with_items`, which stamps `auth.uid()`). | Reuses the single creation path unchanged; the existing purchase SoD (requester cannot approve their own purchase) then stops the plan approver approving the spend, which is the safer side. Plan author is recorded on the plan and in each purchase title note. |
| Approval step | Setting `approval_step`: `spend_approvers` (default) or `senior_role`. | Both mechanisms already exist; the client chooses who approves a plan. |
| Work order on the order | The line's work order is stamped on the created purchase's request as cost attribution (ADR-0104) when the line names one. | Cost per work order is the reason the plan is by work order. See OQ-EQP-3. |

## Settings (every one is organisation data)

| Setting | Where | Default |
|---|---|---|
| Monthly plan turned on | `org_equipment_plan_settings.enabled` | off |
| Approval step: `spend_approvers` or `senior_role` | `org_equipment_plan_settings.approval_step` | `spend_approvers` |
| Author may approve own plan | `org_equipment_plan_settings.allow_self_approval` | off |
| Plan categories (name, name in Bahasa Indonesia, order, active): an Admin-managed list | `equipment_plan_categories` rows | none; the client adds its own (no starter rows, since categories are client data) |

## Default-off statement

An existing organisation has no `org_equipment_plan_settings` row and no plan, line or category rows. Its navigation shows no plan entry, `/equipment-plans` redirects away, every plan RPC refuses with "the monthly plan is not turned on", and no existing screen, RPC, policy or test changes. The feature cannot be turned on unless purchase types are on and the organisation has an active type flagged `is_rental`; the refusal names which is missing. Turning purchase types off or retiring the last rental type later makes plan approval refuse with the same clear message (drafting a plan stays allowed).

## Requirements (EARS)

**Settings and categories**
- FR-EQP-001 While the monthly plan is off for an organisation, the system shall refuse every plan, line and category write and show no plan affordance.
- FR-EQP-002 When an Admin turns the plan on, the system shall require purchase types to be on and an active `is_rental` type to exist, and otherwise refuse naming the missing prerequisite. Only an Admin may change the settings or categories (server-enforced).
- FR-EQP-003 The system shall store plan categories as an Admin-managed list (names unique per organisation case-insensitively, 1 to 60 characters, retire not delete once a line uses one); code shall never branch on a category name.
- FR-EQP-004 The system shall store the approval step and the self-approval switch as organisation settings; an Admin changes them and the change is recorded with who and when.

**Drafting a plan**
- FR-EQP-005 When a user who can raise purchases saves a plan for a project and month, the system shall create or update one Draft plan (unique per project and month) with its lines; the month is the first day of a calendar month, the project is in the caller's organisation, and `org_id` is stamped by the server.
- FR-EQP-006 A line shall carry a description (or an equipment asset), a quantity above zero, a rate not below zero, a vendor, a start and end date (end not before start) both inside the plan's month, and optionally a work order of the plan's project (not cancelled) and a category.
- FR-EQP-007 While a plan is not Draft, the system shall refuse changes to its lines or header (server-enforced); a Rejected plan is returned to Draft by its author, keeping its lines.
- FR-EQP-008 The plan screen shall show a month total per currency of the project, per category and per work order, as information only.

**Approving a plan**
- FR-EQP-009 When the author submits a Draft plan that has at least one line, the plan becomes Submitted.
- FR-EQP-010 Where the approval step is `spend_approvers`, the system shall allow approval only by a member of the project's spend approvers, else the organisation's senior set, else an Admin; where it is `senior_role`, only a user whose role holds spend-approval authority. Enforced in the database, on the real JWT role.
- FR-EQP-011 While `allow_self_approval` is off, the system shall refuse approval by the plan's author (server-enforced SoD), for every role including Admin.
- FR-EQP-012 When an approver approves a Submitted plan, the system shall in one transaction create one Draft purchase per line through `create_procurement_with_items`, of the organisation's rental type, with the line's vendor, project, rental period (the line's dates), item (description, quantity, rate), and mark the plan Approved with approver and time. Either every purchase exists or none does.
- FR-EQP-013 Creation shall be idempotent: a second approve, a retry or a concurrent approve of the same plan creates no further purchase and returns the plan; each line links to at most one purchase and a purchase to at most one line (unique, server-enforced).
- FR-EQP-014 A purchase created from a plan shall be an ordinary Draft: no status, approval or amount is copied; it requires the normal request, approval and spend routing.
- FR-EQP-015 When an approver rejects a Submitted plan with a reason, the plan becomes Rejected and nothing is created. A plan whose purchases exist cannot be edited, rejected or deleted.
- FR-EQP-016 The system shall refuse approval when purchase types are off or no active `is_rental` type exists, naming the cause, and shall not change the plan.
- FR-EQP-017 The system shall show on each plan line the purchase created from it, and on such a purchase the plan and month it came from (link both ways).
- FR-EQP-018 Plan and line changes, submission, approval and rejection shall appear in the record history.

## Non-functional requirements
- NFR-EQP-001 `org_id` seam, RLS and FORCE RLS on every new table, `org_id` stamped by the server (default plus trigger), RLS helpers wrapped in `(select ...)`; a user in another organisation sees and changes nothing.
- NFR-EQP-002 No client role holds INSERT, UPDATE or DELETE on the new tables; every write goes through security-definer RPCs (ADR-0019). New definer functions are listed in an anon-executable inventory fragment; new tables in an isolation-denominator fragment.
- NFR-EQP-003 Phone (390 px) and desktop usable, `DESIGN.md` tokens, shared form primitives (`EntityFormModal`, `useEntityForm`, `TextField`, `SelectField`, `Combobox`, `FormGrid`, `FieldError`, `ConfirmDialog`), English and Bahasa Indonesia strings for every label and error.
- NFR-EQP-004 Reversible migrations with rollback files; rollback refused while any plan has created a purchase.
- NFR-EQP-005 Plan reads page by project and month and are indexed on (org, project, month); a plan holds at most 200 lines.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-EQP-001 | Given an organisation with the plan off, when any role calls a plan, line or category RPC, then refused; the plan route and nav entry are absent. | pgTAP / Unit |
| AC-EQP-002 | Given purchase types off, or on with no active rental type, when an Admin turns the plan on, then refused naming the missing prerequisite; with both present it succeeds. | pgTAP |
| AC-EQP-003 | Given a non-Admin, or an Admin of another organisation, when they change settings or categories, then refused (mutation: remove the role refusal, go red). | pgTAP |
| AC-EQP-004 | Given a category name that exists differing only in case, when added, then refused; a used category can be retired, not deleted. | pgTAP |
| AC-EQP-005 | Given a project and month, when a second plan is saved for the same pair, then the same plan is updated, never duplicated; a date that is not the first of a month is refused. | pgTAP |
| AC-EQP-006 | Given a line with a date outside the month, a quantity of zero, a work order of another project or organisation, or a vendor of another organisation, when saved, then refused. | pgTAP |
| AC-EQP-007 | Given a Submitted, Approved or Rejected plan, when its lines or header are changed, then refused; a Rejected plan returns to Draft by its author only. | pgTAP |
| AC-EQP-008 | Given the `spend_approvers` step, when a user outside the project's approver set approves, then refused; the project set, else the senior set, else an Admin, may (mutation: allow any role, go red). Given `senior_role`, a role below spend authority is refused. | pgTAP |
| AC-EQP-009 | Given the author is also an approver and self-approval is off, when they approve, then refused, Admin included; with the switch on it succeeds (mutation: remove the author check, go red). | pgTAP |
| AC-EQP-010 | Given a Submitted plan of N lines, when approved, then exactly N Draft purchases exist, each of the rental type read by flag, with the line's vendor, project, period, item; the plan is Approved; no purchase has status past Draft or any approval copied. | pgTAP |
| AC-EQP-011 | Given an Approved plan, when approved again, or approved twice concurrently, or retried after a dropped response, then still N purchases; each line has one purchase (mutation: remove the status guard and the unique index, go red). | pgTAP |
| AC-EQP-012 | Given one line whose purchase would be refused (retired type, vendor gone), when the plan is approved, then nothing is created and the plan stays Submitted. | pgTAP |
| AC-EQP-013 | Given a rental type renamed to any word, when approved, then orders are created because the flag, not the name, decides. | pgTAP |
| AC-EQP-014 | Given a rejected plan with a reason, then nothing is created; a plan with created purchases cannot be edited or rejected. | pgTAP |
| AC-EQP-015 | Given a user of another organisation, when they read plans or call any RPC, then nothing visible and refused. | pgTAP |
| AC-EQP-016 | Given the plan screen, when the user adds lines on a phone, the month changes, or a server refusal returns, then the form shows the line, totals and the refusal in English or Bahasa Indonesia. | Unit |
| AC-EQP-017 | Given a planner on a phone and an approver, when the plan is drafted, submitted and approved, then the rental purchases appear as Drafts linked both ways and the second approve click creates none. | E2E (one journey) |
| AC-EQP-018 | Given an Admin on the settings screen, when they add, rename, retire a category and change the step and self-approval, then the list updates; a non-Admin does not see it. Strings exist in both languages. | Unit |

## Mutation checks (to be run by the Director on the integration branch; written, not run by the builder)
Each breaks one rule in the database, runs the named pgTAP file, must go red; restoring turns it green.
| ID | Break | File that must go red |
|---|---|---|
| AC-EQP-003 | Remove the `auth_role() is distinct from 'Admin'` refusal from the settings and category RPCs | `supabase/tests/equipment_plan_settings.test.sql` |
| AC-EQP-008 | In `approve_equipment_plan`, make `v_may` true for any member | `supabase/tests/equipment_plan_approval.test.sql` |
| AC-EQP-009 | Delete the `v_plan.created_by = v_uid` refusal | `supabase/tests/equipment_plan_approval.test.sql` |
| AC-EQP-011 | Delete the `status <> 'Submitted'` idempotent return and drop the unique index on `equipment_plan_lines.procurement_id` | `supabase/tests/equipment_plan_orders.test.sql` |
| AC-EQP-013 | Replace the flag lookup with `lower(name) = 'rental'` | `supabase/tests/equipment_plan_orders.test.sql` |

## Errors
| Condition | Result |
|---|---|
| Plan off | Refused: the monthly plan is not turned on |
| Turn-on without prerequisite | Refused: purchase types are off / no rental type exists |
| Bad month, date outside month, zero quantity | Field error on the line |
| Not an approver / own plan | Refused: you cannot approve this plan |
| Approve with no rental type | Refused: a rental purchase type is needed |
| Plan already approved | Returned unchanged (idempotent) |

## Open questions (defaults taken; Director may overrule)
| ID | Default | If wrong, what breaks |
|---|---|---|
| OQ-EQP-1 | One purchase per line. | A client wanting one order per vendor for the month gets several small Drafts per vendor to merge by hand. |
| OQ-EQP-2 | Requester of the created purchases is the plan approver. | A client wanting the planner as requester needs creation to run as the author; it would need a creation path that takes the requester, which #2697 did not add. |
| OQ-EQP-3 | Work order is stamped on the created purchase's request as cost attribution, if `create_procurement_with_items` produces a request row; otherwise carried in the item description until a purchase-level work order exists. Verified in phase 2. | Costs would not split by work order until attributed. |
| OQ-EQP-4 | Plans readable by Admin, Executive, Finance, Project Manager and the author. | A site engineer cannot see the plan of their month until a role set is agreed. |
| OQ-EQP-5 | Plans only, no versioning: a changed plan after approval is a new purchase by hand or the next month. | A mid-month change cannot be re-approved. |

## Delivery checklist
- [ ] Glossary: monthly plan, plan line, plan category, plan approval step.
- [ ] pgTAP and mutation notes, then UI, then one e2e journey.
