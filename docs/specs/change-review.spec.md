# Spec: Change-request review by the project-control manager role (change-review)

**Status:** approved by the Director with one correction (the per-work-order limit is untouched). Item `change-review` of lane gap-billing. Extends `quantity-change-requests.spec.md` (#2578, shipped: migrations 1176-1178). IDs `FR-CHR-###`, `AC-CHR-###`. Plan: `docs/plans/2026-11-22-change-review.md`. Money / approval tier: enforced in the database, pgTAP-proved.

**Job story.** When a change request is raised on a work order, I want the project-control manager role to be able to review it, and at most a set number of open-or-approved change requests per work order (a setting; empty = no limit), so that the right people can review, and a work order cannot collect endless open requests.

## 1. What the code does today (verified on the base, code wins)

- **Approving.** `qcr_assert_approver` (1177 section 1) allows only `auth_role() in ('Admin','Executive','Finance')`, the base access level. `qcr_return` calls the same function. `qcr_approval_state` (1178) repeats the list for the screen; `QCR_APPROVER` in `policy.ts` mirrors it. Separation of duties (author, any editor, submitter) is in the same function.
- **The role.** `project_control_manager` exists in the 28-role catalogue (1200): tier manager, base level **Project Manager**. Base level Project Manager is not in the approver list, so the role **cannot approve or return today** (the claim is true). A Project Manager can raise, edit and record, never approve. `profiles.built_in_role` is only assignable while the organisation's `built_in_roles_enabled` is on (1201, default off), so the role is new but the repo cannot show that no organisation already holds users in it; the route therefore becomes a setting (below).
- **Limit.** Already a setting: `organizations.quantity_change_limit integer`, null or >= 1, Admin-only, audited (1176 section 1); default null = no limit. `qcr_raise` refuses at the limit under the work-order row lock. Its meaning (OD-QCR-4: every request except a draft withdrawn before submission) is settled and is **not changed here**; `qcr_request_count`, `qcr_raise` and the 1127 limit steps stay as they are.
- **Who is told.** `qcr_submit` (1176) notifies every active member whose base level is Admin, Executive or Finance (a hard-coded list) when a request is submitted; `qcr_approve` and `qcr_return` already notify the author of the outcome (1177). The submit list must follow the new setting.
- **Light accounts.** `foreman` and `field_user` are light accounts (1205, `is_light_role_key`); `qcr_approval_state` already starts with `assert_not_light` (rewritten into the database by 1219, so the restated body must keep it).

## 2. Requirements (EARS)

- **FR-CHR-001** The system shall hold, per organisation, a list of built-in role keys that may review (approve or return) a quantity change request in addition to today's approvers, default empty. With the default, who can approve is exactly what it is today.
- **FR-CHR-002** The list shall be editable by Admin only, shall accept only keys of the built-in role catalogue, and shall be audited (before and after).
- **FR-CHR-003** When a user whose built-in role key is in the organisation's list calls approve or return, the system shall treat them as an approver; a user whose key is not in the list, or who has no key, is judged by today's rule.
- **FR-CHR-001a** The setting shall refuse a light-account (field) role key. A light account never reviews, whatever the list says.
- **FR-CHR-001b** The setting shall refuse a role whose base level cannot read change requests (only Admin, Executive, Project Manager and Finance can), and the listed-role branch shall count only while the organisation's built-in roles setting is on.
- **FR-CHR-004** The separation-of-duties rule shall apply unchanged to every approver: the author, any editor and the submitter are refused, with no sole-user exception.
- **FR-CHR-005** The approval-state read (`qcr_approval_state`) and its "an eligible approver exists" flag shall use the same rule, so the screen shows the approve action and the waiting message correctly.
- **FR-CHR-006** When a request is submitted, every active member who may review it under FR-CHR-003 (never the author, an editor or the submitter) shall be told it awaits approval (the notification the bell and inbox read); the person who raised it is told the outcome (already shipped, unchanged).
- **FR-CHR-007** Every refusal introduced or reworded here has a code, an English and a Bahasa Indonesia sentence in the refusals catalogue, saying what to do next.

## 3. Acceptance criteria

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CHR-001 | Given the default setting (empty list) and a Project Control Manager who did not author or edit a pending request, when they approve, then refused 42501 `QCR_NOT_APPROVER`; Admin, Executive and Finance still approve (today's behaviour unchanged). | pgTAP |
| AC-CHR-002 | Given an Admin adds `project_control_manager` to the list, when that user (not author, editor or submitter) approves, then the request is `approved` with their id; when they return with a reason, it is `returned`. | pgTAP |
| AC-CHR-003 | Given the role is listed, when the same user authored, edited or submitted the request, then refused 42501 `QCR_SOD_AUTHOR` and the status is unchanged (mutation target). | pgTAP |
| AC-CHR-004 | Given the role is listed, when a different non-listed role with no key (e.g. Engineer) or a listed-role user of another organisation approves, then refused. | pgTAP |
| AC-CHR-005 | Given a non-Admin writes the list, then nothing changes; given the Admin writes a key not in the catalogue, or a light-account key (`foreman`, `field_user`), then refused; given a valid change, an audit row holds before and after. | pgTAP |
| AC-CHR-011 | Given a listed role and the organisation turns built-in roles off, then its holder is refused approve (`QCR_NOT_APPROVER`) and `qcr_approval_state` says `role`; given an officer key with Engineer base is written to the list, then refused `QCR_APPROVER_ROLE_CANNOT_READ`. | pgTAP |
| AC-CHR-006 | Given the role is listed, when a request is submitted, then a listed-role user who did not touch it is notified; when it is approved, the person who raised it is notified. | pgTAP |
| AC-CHR-007 | Given the listed role, `qcr_approval_state` returns `can_approve` true for a non-author and `eligible_approver_exists` true when only listed-role users exist. | pgTAP |
| AC-CHR-008 | Given the refusal codes raised by the migration, then each has non-empty `en` and `id` sentences (gate `check-refusal-codes`). | vitest + gate |
| AC-CHR-009 | Given a listed-role user opens a request pending approval they did not touch, then the approve and return actions show; given they authored it, the action is absent with the reason shown. | vitest (component) |
| AC-CHR-010 | Given the Admin opens the quantity-change settings, then the reviewer-role list is shown next to the limit; a non-Admin sees the state and no control. | vitest |

## 4. Decisions and open questions

- **D1 (built, default safe).** The extra approvers are a setting (a role-key list), default empty, so an organisation already using today's route sees no change. No role list is hard-coded as customer process.
- **Q1 for the owner.** Should "record sent" and "record decision" (today Admin, Executive, Project Manager, Finance; Project Control Manager already qualifies through its Project Manager base level) follow the same list? Recommended: no change.
- **Q2 for the owner.** Which roles should an organisation list? Built meanwhile: none (empty), the Admin picks any non-field role in the quantity-changes screen.

## 5. Out of scope

Reading rules, the rest of the workflow, the 28-role catalogue and its capabilities table (a new capability row is not needed: the list is a per-organisation setting).
