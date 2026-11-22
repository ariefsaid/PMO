# Spec: Change-request review by the project-control manager role, and the request limit's meaning (change-review)

**Status:** proposed, awaiting Director approval. Item `change-review` of lane gap-billing. Extends `quantity-change-requests.spec.md` (#2578, shipped: migrations 1176-1178). IDs `FR-CHR-###`, `AC-CHR-###`. Plan: `docs/plans/2026-11-22-change-review.md`. Money / approval tier: enforced in the database, pgTAP-proved.

**Job story.** When a change request is raised on a work order, I want the project-control manager role to be able to review it, and at most a set number of open-or-approved change requests per work order (a setting; empty = no limit), so that the right people can review, and a work order cannot collect endless open requests.

## 1. What the code does today (verified on the base, code wins)

- **Approving.** `qcr_assert_approver` (1177 section 1) allows only `auth_role() in ('Admin','Executive','Finance')`, the base access level. `qcr_return` calls the same function. `qcr_approval_state` (1178) repeats the list for the screen; `QCR_APPROVER` in `policy.ts` mirrors it. Separation of duties (author, any editor, submitter) is in the same function.
- **The role.** `project_control_manager` exists in the 28-role catalogue (1200): tier manager, base level **Project Manager**. Base level Project Manager is not in the approver list, so the role **cannot approve or return today** (the claim is true). A Project Manager can raise, edit and record, never approve. `profiles.built_in_role` is only assignable while the organisation's `built_in_roles_enabled` is on (1201, default off), so the role is new but the repo cannot show that no organisation already holds users in it; the route therefore becomes a setting (below).
- **Limit.** `organizations.quantity_change_limit integer`, null or >= 1, Admin-only, audited (1176 section 1); default null = no limit. `qcr_raise` refuses when `qcr_request_count(work_order) >= limit`, under the work-order row lock. **Meaning today:** per work order, counts **every request ever raised except a draft withdrawn before its first submission** (so declined, accepted, withdrawn-after-submission and returned all count). That is not "open-or-approved".

## 2. Requirements (EARS)

- **FR-CHR-001** The system shall hold, per organisation, a list of built-in role keys that may review (approve or return) a quantity change request in addition to today's approvers, default empty. With the default, who can approve is exactly what it is today.
- **FR-CHR-002** The list shall be editable by Admin only, shall accept only keys of the built-in role catalogue, and shall be audited (before and after).
- **FR-CHR-003** When a user whose built-in role key is in the organisation's list calls approve or return, the system shall treat them as an approver; a user whose key is not in the list, or who has no key, is judged by today's rule.
- **FR-CHR-004** The separation-of-duties rule shall apply unchanged to every approver: the author, any editor and the submitter are refused, with no sole-user exception.
- **FR-CHR-005** The approval-state read (`qcr_approval_state`) and its "an eligible approver exists" flag shall use the same rule, so the screen shows the approve action and the waiting message correctly.
- **FR-CHR-006** The limit shall count, per work order, the requests that are open (draft, pending approval, returned, sent to the client) or approved (approved internally, accepted by the client). A declined request and a withdrawn request do not count. Empty limit = no limit. Default stays empty.
- **FR-CHR-007** Every refusal introduced or reworded here has a code, an English and a Bahasa Indonesia sentence in the refusals catalogue, saying what to do next.

## 3. Acceptance criteria

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CHR-001 | Given the default setting (empty list) and a Project Control Manager who did not author or edit a pending request, when they approve, then refused 42501 `QCR_NOT_APPROVER`; Admin, Executive and Finance still approve (today's behaviour unchanged). | pgTAP |
| AC-CHR-002 | Given an Admin adds `project_control_manager` to the list, when that user (not author, editor or submitter) approves, then the request is `approved` with their id; when they return with a reason, it is `returned`. | pgTAP |
| AC-CHR-003 | Given the role is listed, when the same user authored, edited or submitted the request, then refused 42501 `QCR_SOD_AUTHOR` and the status is unchanged (mutation target). | pgTAP |
| AC-CHR-004 | Given the role is listed, when a different non-listed role with no key (e.g. Engineer) or a listed-role user of another organisation approves, then refused. | pgTAP |
| AC-CHR-005 | Given a non-Admin writes the list, then nothing changes; given the Admin writes a key not in the catalogue, then refused; given a valid change, an audit row holds before and after. | pgTAP |
| AC-CHR-006 | Given a limit of 2 and one open, one approved, one declined, one withdrawn request, when a third counting request is raised, then it is refused `QCR_LIMIT_REACHED` naming count (2) and limit (2); when one of the two is declined or withdrawn, a new one is accepted; with an empty limit any number is accepted. | pgTAP |
| AC-CHR-007 | Given the listed role, `qcr_approval_state` returns `can_approve` true for a non-author and `eligible_approver_exists` true when only listed-role users exist. | pgTAP |
| AC-CHR-008 | Given the refusal codes raised by the migration, then each has non-empty `en` and `id` sentences (gate `check-refusal-codes`) and `parseRefusal` fills the count and limit figures. | vitest + gate |
| AC-CHR-009 | Given a listed-role user opens a request pending approval they did not touch, then the approve and return actions show; given they authored it, the action is absent with the reason shown. | vitest (component) |
| AC-CHR-010 | Given the Admin opens the quantity-change settings, then the reviewer-role list is shown next to the limit; a non-Admin sees the state and no control. | vitest |

## 4. Decisions and open questions

- **D1 (built, default safe).** The extra approvers are a setting (a role-key list), default empty, so an organisation already using today's route sees no change. No role list is hard-coded as customer process.
- **D2.** The limit's meaning changes from "all but pre-submission-withdrawn drafts" to "open or approved" (FR-CHR-006). This only loosens a limit already set (a declined or withdrawn request frees its slot). The default (empty) and every organisation without a limit behave identically. It reverses the count rule of OD-QCR-4; the existing pgTAP steps that assert the old count are updated, goal intact (named in the plan).
- **Q1 for the owner.** Should a declined request free its limit slot? Recommended: yes (it is no longer open or approved), as built meanwhile. Alternative: keep counting declined ones (stricter, the shipped meaning).
- **Q2 for the owner.** Should the same list also cover "record sent" and "record decision" (today Admin, Executive, Project Manager, Finance; Project Control Manager already qualifies through its Project Manager base level)? Recommended: no change.

## 5. Out of scope

Reading rules, the rest of the workflow, the 28-role catalogue and its capabilities table (a new capability row is not needed: the list is a per-organisation setting).
