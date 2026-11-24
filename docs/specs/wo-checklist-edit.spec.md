# Spec: Edit a work order's billing checklist — add a step, save the list as a template

**Status:** built on `feat/1124-billing-checklist-edit` (lane control-billing, item 1, slug `wo-checklist-edit`); database and rendered
proof are recorded in `docs/briefs/decisions-1124/billingchecklist-report.md`. Migrations 2180-2181. IDs `FR-WCE-###`, `AC-WCE-###`, decisions `D1..D4`.
Plan: `docs/plans/2026-11-24-wo-checklist-edit.md`. Extends `billing-steps.spec.md` (FR-WBS-001..011): advisory and not a money path.

## Job story
When a work order needs a billing step its template does not have, I want to add that step to the work order's own checklist and, once the
list is right, save it as a template, so that the next work order starts from the list we actually use.

## 1. Verified on the base
- A work order's list is copied once, at Draft -> Issued, from the organisation's default template (1773) and is a snapshot (FR-WBS-002).
  Nothing edits the list afterwards: the 1772 writers act on one existing step (assign, attach, complete, skip).
- The claim's list is `claim_billing_stages`, edited by 1367 (`add_claim_billing_step`: after a position, never before a finished step; a
  deferrable unique constraint lets it renumber). It gates invoicing through `billing_stages_open`; the work-order list does not.
- Who may act on a step: `lock_wo_billing_step` (1772) — the run right through `actor_may_run_billing_steps` (the one gate of
  `billing_steps_run`, 1771; the 2716 sweep allows no second reader), with the project rule for a Project Manager level person.
- Templates: `save_billing_step_template` (1366; Admin or Finance) writes names, access-level owner roles, target days, optional flag and
  documents; `set_billing_step_template_roles` (1772) writes each step's owner job role and hidden-from list. A work-order checklist can
  contain steps hidden from the caller, so saving it uses the server-side `save_work_order_steps_as_template` copy instead of rebuilding
  it from the visible rows.
- `work_order_billing_steps (work_order_id, position)` is unique and not deferrable: a new step makes room by moving the later steps
  down one at a time, highest first.
- Prior art: `scripts/prior-art.sh add_work_order_step` — decisions, ADRs, migrations, the enforcement layer and issues are silent.

## 2. Requirements (EARS)
- **FR-WCE-001** While the work order is Issued, when a person who may run billing steps adds a step (a name, an optional owner job role
  and a place after the current step), the system shall write it to this work order's own list at that place, move the later steps down,
  stamp the organisation and the project in the database, and leave an audit event. No other work order's list changes.
- **FR-WCE-002** When Finance or an Admin chooses "Save as template" and names it, the system shall save the complete work order's
  current list, in order, as a new template (names, owner job roles, hidden-from roles, target days, optional flags and checklist slots)
  through a server-side copy, so a partially visible list cannot become the template for later work orders.
- **FR-WCE-003** When a person who may not run billing steps calls the add function, the system shall refuse it and write nothing: a field
  account, a reader without the run right, another organisation (not found), and a Project Manager level person on a project they do not manage.
- **FR-WCE-004** The work order checklist and the claim's own steps shall stay separate lists: adding a step writes no claim step, and no
  invoice gate reads the work-order list.
- **FR-WCE-005** A new step shall go after the current step and never before a finished one, so the step people were told about stays
  current. On a list with no current step (none yet, or every step finished) the first open step shall become current from today and its
  people be told, as at issue. A list holds at most 20 steps.
- **FR-WCE-006** For each organisation, the system shall keep checklist editing off by default. While it is off, the add-step and
  save-as-template actions shall be hidden and the database shall refuse both writes. When an Admin turns the setting on in Administration
  › Accounting, a person who runs billing steps may add steps and Finance or an Admin may save a checklist as a template.

## 3. Decisions made in the build (confirm or reverse at review)
- **D1 Placement.** The claim list lets a new step displace the current one (1367 renumbers so the first open step is current). The
  work-order list does not: `started_on` is stored and people are told when a step opens, so a new step goes after the current step
  (`WBS_STEP_CLOSED`), and the page offers only those places.
- **D2 Refusal sentences.** The add has its own codes where the step writers' sentence would mislead ("this step"): `WBS_ORDER_NOT_FOUND`,
  `WBS_STEP_ADD_RIGHT`, `WBS_STEP_ADD_PM`, plus `WBS_STEP_NAME`, `WBS_STEP_ROLE`, `WBS_STEP_DAYS`, `WBS_STEP_SHAPE`, `WBS_STEP_CLOSED`.
  English and Bahasa Indonesia sentences are in the refusals catalogue.
- **D3 Affordances.** With the organisation's checklist-edit setting on, "Add step" shows while the work order is Issued, for a holder of
  the run right (`mayChangeStepList`, the same rule as `mayActOnStep` without a step). "Save as template" shows for Finance or an Admin
  (`can('edit', 'billingStage')`) on any work order that is not a Draft and has a list: a finished work order's list is the one actually
  used. An Admin controls the setting under Administration › Accounting; it starts off. The database remains the authority for writes.
- **D4 Words.** The section's summary line loses its explanatory clause ("This list tracks the chain to the invoice") so the screen's word
  budget stays flat against the two action labels the brief names (screen rule "Words": cut decoration first; the consequence "does not block
  invoicing" stays). If the owner prefers the clause, restore it and raise the budget by five words instead.

## 4. Acceptance (owner layer)
| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-WCE-001 | Given a work order with its default checklist, when a permitted user adds the step "Joint survey sign-off", then it appears on that work order's checklist only and no other work order's checklist changes | pgTAP `supabase/tests/2180_wo_billing_step_add.test.sql` (function); Vitest/RTL `BillingStepsSection.test.tsx` (action) |
| AC-WCE-002 | Given a work order checklist with an added step, when the user saves it as a template named "Remote site", then the template list offers "Remote site" with the same steps in the same order | pgTAP (save, roles, the next work order); Vitest/RTL (the action's payload) |
| AC-WCE-003 | Given a user who may not run the checklist, when they call the add function, then it is refused and nothing is written | pgTAP |
| AC-WCE-004 | Adding to a work order writes no claim step; the invoicing gate does not read the list | pgTAP |
| AC-WCE-005 | A step goes after the current step only; an empty or finished list opens the added step and tells its people; the 20th place is the last | pgTAP (function); Vitest (the places the page offers) |
| AC-WCE-006 | Given an organisation with checklist editing off, when a runner or Finance attempts a checklist write, then the database refuses it and the actions stay hidden; after an Admin turns the setting on, permitted actions are available | pgTAP (setting and write boundary); Vitest (actions) |

No browser journey: each criterion is owned at its lowest sufficient layer.

## 5. Built (files)
Migrations 2180-2181 with rollback: `add_work_order_step` checks the organisation setting and accepts null as a database-resolved append;
`save_work_order_steps_as_template` copies the full checklist; `set_org_work_order_checklist_edit` is Admin-only. The functions are declared in
`supabase/tests/inventory/anon-executable-definers/2180-wo-billing-step-add.txt` and
`scripts/isolation-probe-denominator.d/2180-wo-billing-step-add.json`. App: `src/lib/db/workOrderBillingSteps.ts` and
`database.types.ts`, repository `billingStages`, the checklist switch registry and Administration card, `useStepTemplateMutations()`'s
server-copy path, nullable `addWorkOrderStep`, and `useOrgSwitch('workOrderChecklist')` in
`pages/work-order-detail/BillingStepsSection.tsx`. Pure rules include `mayChangeStepList` and `stepInsertPlaces`.
