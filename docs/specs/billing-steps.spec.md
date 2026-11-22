# Spec: A work order's billing step list from the day it is issued

**Status:** draft for approval (phase 2). Lane gap-billing, slug `billing-steps` (branch `feat/gap-billing-wo-steps`). Migrations 1770-1779.
IDs `FR-WBS-###`, `AC-WBS-###`, `OD-WBS-#`. Plan: `docs/plans/2026-11-22-billing-steps.md`. Advisory and not a money path: it never gates
invoicing. Builds on `claim-billing-steps.spec.md` (#2680), `billing-board.spec.md`, `builtin-role-set.spec.md` (one capability gate).
Supersedes the reversal design drafted on `feat/gap-billing-billing-steps`; only its verify findings are reused.

## Job story
When a work order is opened, I want a billing checklist for it created from the organisation's template at once, each step with an owner
role, a named person, a target number of days, attachments and a status, so the whole chain from field survey to invoice is seen in one
view and nobody chases by chat. Each person sees the steps waiting for them and is told when their step opens. Roles the organisation
names can act on their own steps. A role the organisation names does not see a step the organisation hides from it.

## 1. Verified on the base (`land/fix-1122` + role-capabilities gate `ebaf4808`)
- A work order is created Draft and reaches Issued only through `transition_work_order` (0193:328, 0337:590); the close-out list is copied by
  an AFTER UPDATE OF status trigger `when old='Draft' and new='Issued'` (1402:11-19). Same hook used here.
- Claim steps are `claim_billing_stages` (1021, `claim_id not null`), copied from the PROJECT list `billing_stage_templates` when a
  progress claim is inserted (1365:81-99). The organisation template (`billing_step_templates/_steps/_documents`, 1365:34-60) is only
  COPIED onto a project or claim by RPC (1366); no default pointer exists anywhere (grep of all migrations).
- The template step owner is `owner_role public.user_role` (the five access levels), not a built-in role key (1365:8, 1365:52).
- The invoice gate is `billing_stages_open(claim)` over `claim_billing_stages` only (1021, 1361:172). Untouched.
- Claim steps read/write: restrictive read scope Admin, Executive, Project Manager, Finance (1021:90; 1365:72); writers
  Admin/Finance/PM-of-project (1367:20). `quantity_surveyor`/`quality_inspector` are base Engineer: cannot read them today.
- Close-out pattern: org template + per-work-order snapshot, definer-only writes with the work-order row locked, document attach
  limited to the work order's project documents in status Issued/Approved, audit event per write (1400-1402, 1418).
- Email: event key `billing_step` is allowed in `email_event_settings` (1220:8) and has a template (`email-notify/templates.ts:6`) but no
  producer; `notify_workflow_user(..., p_email_event)` (1221) writes the in-app notice and the outbox trigger honours the per-org switch.
- Shared waiting list = needs-you (`useNeedsYou.ts`, fact `waitingBillingSteps` from `my_waiting_billing_steps`, 1369:9); derived on
  read, nothing stored, clears when the step completes.
- Capability gate: `built_in_role_capabilities` (CHECK list) read only through `role_has_capability`/`actor_has_role_capability`; sweep
  `supabase/tests/2716` requires exactly one gate function per capability (literal in the body) and a catalogue string (AC-RCG-005);
  mirrors: `builtInRoles.ts`, `builtInRoles.test.ts`, 1200 test, `2709-builtin-roles.*` fixtures, `builtin-role-set.spec.md` FR-007.
  A person with no built-in role holds no capability (`role_has_capability` null -> false).
- The light-account sweep `2711` fails any new public definer without `assert_not_light()` and any new org table without the restrictive
  light deny policy; both are done here.

## 2. Requirements (EARS)
- **FR-WBS-001** When a work order moves Draft -> Issued and the organisation has a default billing step template with steps, the system
  shall copy its steps and checklist documents onto the work order (new tables), the first step current from the issue day. With no
  default or an empty template, no list is made and the work-order page tells an Admin or Finance person to set the default.
- **FR-WBS-002** The copy is a snapshot: later template edits do not change an issued work order. Work orders issued before this ships get no list.
- **FR-WBS-003** Each step has: name, owner role (a built-in role key, not a light role), optional named person (active, non-light member
  of the organisation), target days (due = start + target days; same due seam as claim steps), optional flag, hidden-from roles (role keys),
  checklist documents, and a status derived from dates: open (not started), current, done, skipped (optional steps only).
- **FR-WBS-004** Where an organisation sets "hidden from" role keys on a template step, a person holding one of those roles shall not read that step
  or its documents, in the work-order list, the waiting list, the board and the claim view. Hidden wins over every right below; the named person is exempt.
- **FR-WBS-005** Rights: new capabilities `billing_steps_view` ("see billing steps") and `billing_steps_run` ("run billing steps"), each read by
  one gate function through `actor_has_role_capability`. Reading needs view (or being the step's owner-role holder or named person); acting
  needs run, or being the owner-role holder of that step, or its named person; plus the PM-of-project scope for base-level Project Manager as for claim steps.
  A person with no built-in role falls back to today's claim-step readers (Admin, Executive, Project Manager, Finance) so unmigrated organisations keep working.
  Light accounts (Foreman, Field user) hold neither and are refused by the database.
- **FR-WBS-006** Acting (attach a project document, complete with a done date, skip an optional step, name or change the person) is by
  definer functions that lock the work order row, re-assert membership and org, refuse when the work order is not Issued, complete in order
  across non-optional steps, require required documents, never a future date; each leaves an audit event. Completing starts the next step and
  notifies its owner.
- **FR-WBS-007** When a step becomes current (issue, or the previous step done/skipped) the system shall notify its named person, else every
  active holder of its owner role (the project's own manager for the Project Manager level), in-app, and queue an email through
  `notify_workflow_user(..., 'billing_step')`, which the existing per-organisation switch gates. The acting person is not told.
- **FR-WBS-008** The shared waiting list (needs-you) shows one derived item "billing steps waiting for you" for current steps that are
  mine (named person, else my owner role), cleared when the step completes; read by `my_waiting_work_order_steps`.
- **FR-WBS-009** The work-order page shows one list: step, person, target and due, documents, status. The billing board shows the same rows
  grouped by work order beside its claim columns. A claim raised on a work order shows a link to that work order's list. Nothing is copied
  to the claim; claim steps and `billing_stages_open` are unchanged.
- **FR-WBS-010** Setting the default template, editing owner role key and hidden-from roles on a template step are Admin/Finance (settings),
  with English and Bahasa Indonesia refusals; a disabled control says why.
- **FR-WBS-011** Nothing of one customer's process is in code: step names, days, roles and hidden-from lists are template data.

## 3. Rights and default grants (catalogue data, migration 1770; the SQL and `builtInRoles.ts` change together)
- `billing_steps_view`: the 14 roles whose base level reads claim steps today (executive, administrator, project_manager, deputy_project_manager,
  project_control_manager, construction_manager, procurement_manager, finance_manager, quality_manager, safety_manager, equipment_manager,
  hr_manager, finance_officer, billing_officer) plus the survey/field-chain officers quantity_surveyor, project_administrator, site_supervisor.
- `billing_steps_run`: administrator, finance_manager, finance_officer, billing_officer, project_manager, deputy_project_manager,
  project_control_manager, quantity_surveyor, project_administrator. Owner-role holders and the named person can always run their own step.
- Never held: foreman, field_user (tier field). Quality roles hold view but the quality-hiding rule is per step data (FR-WBS-004), not a global grant.

## 4. Data and settings
New: `work_order_billing_steps`, `work_order_billing_step_documents` (org_id default/trigger stamped, RLS, restrictive light deny, definer-only
writes, isolation probe); `org_billing_step_settings(org_id pk, default_template_id)` (Admin/Finance set; default none). Added columns on
`billing_step_template_steps`: `owner_role_key text references built_in_roles(key)`, `hidden_from_role_keys text[]` (both nullable; claim copies ignore them).

## 5. Acceptance (owner layer)
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WBS-001 | default template with 3 steps; Draft -> Issued: 3 steps, first current, others open | pgTAP |
| AC-WBS-002 | no default or empty template: no rows, no error; page names who sets it | pgTAP + vitest |
| AC-WBS-003 | template edited after issue: the issued list is unchanged | pgTAP |
| AC-WBS-004 | role in a step's hidden list reads zero rows of it and its documents (list, board, waiting, claim view); named person still reads | pgTAP |
| AC-WBS-005 | holder of run completes own step; holder without run and not the owner is refused (42501); light account refused on every function and table | pgTAP |
| AC-WBS-006 | every refusal has an English and a Bahasa sentence | vitest |
| AC-WBS-007 | complete in order, required documents, future date, not-Issued refusals | pgTAP |
| AC-WBS-008 | opening a step notifies the person (in-app) and queues one email only when the `billing_step` switch is on; actor not told | pgTAP |
| AC-WBS-009 | waiting list shows my current step and drops it when done | pgTAP + vitest |
| AC-WBS-010 | claim raised later: invoicing gate and claim steps exactly as before; step list not copied | pgTAP (existing 1365 suite stays green) |
| AC-WBS-011 | catalogue gains the two capabilities, each with one gate; 2716 and builtInRoles parity pass | pgTAP + vitest |
| AC-WBS-012 | work-order page and board show the rows; empty state; 390 and 1440 px | vitest + e2e journey |

## Open questions (for the orchestrator)
OD-WBS-1 default template: org pointer, none -> no list (as briefed). OD-WBS-2 owner role key vs the template's access-level owner: new
nullable key column (recommended). OD-WBS-3 "quality role does not see" as a per-step hidden-from list, not a global grant (recommended,
the catalogue cannot differ per organisation). OD-WBS-4 default grants above. OD-WBS-5 unmigrated people (no role key) fall back to claim-step readers.
