# Spec: Billing steps per claim, loaded from a template (#2680)

**Status:** built (phase 2), awaiting the wave run; OD-CBS-1..5 decided by the Director on 21 Nov (see Decisions). Ships for the 15 December 2026 release (OD-SCOPE-1). Map #2516. IDs `FR-CBS-###`, `NFR-CBS-###`, `AC-CBS-###`, `OD-CBS-#`. Plan: `docs/plans/2026-11-21-claim-billing-steps.md`. Executor: Orca worker, **Director-dispatched, ships alone**: it changes who may edit the invoice gate's inputs (ADR-0019, `docs/money-path-primer.md`). Builds on `billing-stages.spec.md` (#2522, 1021/1022) and `billing-stage-targets.spec.md` (#2592, 1360-1363). Terms Billing stage, Stage target, Skipped stage, Overdue stage are used as defined there. In this spec the word **step** means a claim's billing stage; no new table is invented for it.

## Owner ruling applied (OD-SCOPE-6, settled)
One billing record, no task copies. Steps live on the claim (owner role, target date, documents, done mark). A step waiting on a role shows in that person's needs-you list as a pointer and clears itself when the step completes. Ordinary tasks can still be attached to a claim (#2587, unmerged; this ticket neither depends on it nor blocks it: no step row is a task, and no table here references `tasks`). Over-claim stays a warning (untouched). OD-SCOPE-2: step names, owner roles, target days, documents and templates are client data; nothing about any client's process is written in code or seed. Roles come from the existing role set (`user_role`); no role name is coded beyond the two the code already knows (Admin, Finance, Project Manager, which gate editing).

## Job story
When a claim starts, I want its list of steps (owner role, target date, documents, done mark) set from a template and editable for this claim, so each claim has the right checklist.

## Context and boundary (checked on the #2592 tip)
- `claim_billing_stages` already is the per-claim step: name, position, client-side flag, `target_days`, `optional`, started/completed/skipped, checklist in `claim_billing_stage_documents`. It is copied from the project list (`billing_stage_templates`) by `instantiate_claim_billing_stages()`. #2680 extends it; no parallel model.
- `billing_stages_open(claim)` stays the one invoice-gate predicate (open = not completed and not skipped). It is not edited by this ticket; editing the step list changes only which rows it reads.
- #2592 left two seams: `billing_stage_due_on(stage)` and `billing_stage_overdue_recipients(stage)`. This ticket replaces their bodies. The overdue job (`notify_overdue_billing_stages`) tests the due day inline today; it is changed to read the seam, otherwise a step with its own target date would never be noticed.
- The needs-you list is `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts` (`NeedsItem` ids, rendered by `NeedsYouList.tsx`; nav badge by `ApprovalsNavCount`).
- Claims have no page of their own; the claim list is the billing tab, `pmo-portal/pages/project-detail/tabs/BillingTab.tsx`, and the step list is `ClaimBillingStages.tsx`.

## Terms (new)
- **Step owner role** — the role (from the existing role set) responsible for a step. Optional.
- **Step target date** — the date by which the step should be done. Either entered on the claim's step, or, when empty, the step's started day plus its target days (#2592).
- **Step template** — an organisation-level named list of steps (name, owner role, target days, client-side flag, optional flag, documents). Loadable onto a project's list or onto a claim.
- **Waiting step pointer** — a needs-you entry derived from a current step whose owner role is the viewer's role. Not a stored row: it exists while the step is current and goes when it is completed, skipped or removed.

## Requirements (EARS)

**Templates (organisation data)**
- FR-CBS-001 The organisation shall hold any number of named step templates, each an ordered list of at most 20 steps with: name, owner role (optional), target days (1-365, optional), client-side flag, optional flag, and a document checklist (name, required). Only Finance or an Admin shall create, rename, replace or archive a template; every active member of the organisation may read them.
- FR-CBS-002 When Finance or an Admin loads a template onto a project, the database shall replace the project's stage list with a copy of it (owner role included), through the same checks as `set_billing_stage_template`. A claim already made shall not change.
- FR-CBS-003 When Finance, an Admin or a Project Manager (of that project) loads a template onto a claim whose steps are all untouched (none completed or skipped, no invoice), the database shall replace the claim's steps with a copy and make the first current from today. Otherwise it shall refuse (`claim-steps-started`).
- FR-CBS-004 A step template is data, not a rule: an archived template remains readable on nothing it was already copied onto, and cannot be loaded again.

**Steps on the claim**
- FR-CBS-010 A claim's step shall carry an optional owner role and an optional target date, copied from the project's list when the claim is created (the project list gains owner role too, FR-CBS-020).
- FR-CBS-011 Finance or an Admin shall be able to edit a live claim's step list: change a step's name, owner role, target days, target date, client-side or optional flag; add a step after the last completed or skipped step; remove an open step with a reason of 3 to 500 characters; and reorder open steps. A Project Manager of the project shall be able to change owner role and target date only, not add, remove or reorder.
- FR-CBS-012 The database shall refuse any edit to a completed or skipped step, any add or move that would place a step before a completed or skipped one, any edit on a withdrawn claim, and any add, remove or reorder on a claim that has an invoice (native or ERP command). Owner role and target date remain editable on an invoiced claim's open steps: they change no amount and cannot open or close the gate.
- FR-CBS-013 Removing an open step is a waiver of that step for the gate (the claim may become invoiceable). It shall therefore be Finance or Admin only, audited with the reason and the step's name, exactly as a skip is (OD-BSX-3).
- FR-CBS-014 Every edit shall re-assert active membership, role and organisation, and lock the claim row then the step row, in the order the existing stage functions use.

**Project list**
- FR-CBS-020 The project's stage list (`billing_stage_templates`) shall carry an optional owner role per stage, written by `set_billing_stage_template`; the existing payload stays valid without it.

**Due date and overdue**
- FR-CBS-030 `billing_stage_due_on` shall return the step's target date when set, else started day plus target days, else null. The overdue job shall use it.
- FR-CBS-031 `billing_stage_overdue_recipients` shall return, when the step has an owner role, the active members of the organisation who hold that role (for Project Manager, the project's manager only); otherwise the #2592 recipients (project manager, else Admins). When an owner role has no active holder the Admins shall be told.
- FR-CBS-032 The overdue job shall remain once per step (`overdue_notified_at`) and shall also scan steps that have a target date but no target days.

**Needs you**
- FR-CBS-040 The database shall expose the viewer's waiting steps: current steps (started, not completed, not skipped, live claim) whose owner role equals the viewer's role; for a Project Manager only on projects they manage. Each carries project name, step name, due date and whether it is overdue.
- FR-CBS-041 The needs-you list shall show one pointer item for the viewer's waiting steps, with the count, "oldest N days overdue" when any, and a link to the project's billing tab. The item shall disappear when none remain, without any write. A viewer with no matching steps, or an organisation that sets no owner roles, sees no item (NFR-CBS-001).
- FR-CBS-042 The billing tab's claim list shall show a marker on a claim that has an overdue current step (words and colour), with the step name and days over. This closes the claim-list marker deferred from FR-BSX-011.

**Screens**
- FR-CBS-050 The claim's step list shall let Finance and Admin edit, add, remove and reorder steps and load a template, and a Project Manager change owner role and target date, behind `can('edit', 'billingStage')` (UX only; the RPCs are the authority).
- FR-CBS-051 The project's billing terms editor shall let Finance and Admin set owner role per stage and load a template. An organisation template manager shall list, create, edit and archive templates in the billing settings area.

## Non-functional requirements
- NFR-CBS-001 Additive and invisible by default: every new column is nullable or defaulted; an organisation that sets no owner role or template sees no new item, marker or screen element, and every existing pgTAP, RTL and e2e test passes untouched.
- NFR-CBS-002 Owner role is the `user_role` enum, so roles added later (the wider role set) work with no change; no role list is coded in this ticket's FE beyond reading the existing set.
- NFR-CBS-003 New tables: RLS on, `org_id` default and trigger-stamped, policies `(select helper())`; no client write grant (writes through RPCs); isolation-probe fragment added. Every function `security definer`, `set search_path = public`, `revoke ... from public, anon`.
- NFR-CBS-004 English and Bahasa Indonesia strings in the `project` namespace (templates manager in `settings` if one exists there), `DESIGN.md` tokens, words as well as colour, phone and desktop layouts.
- NFR-CBS-005 The waiting-step query is index-backed (partial index on open current steps by `owner_role`) and returns at most 200 rows.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CBS-001 | Given Finance, when they create a template with steps, owner roles, targets and documents, then it is stored and readable by a Project Manager; a Project Manager or Engineer who tries to create, replace or archive is refused `42501`; another organisation sees none. | pgTAP |
| AC-CBS-002 | Given a template, when Finance loads it onto a project, then the project's list equals the template (owner role included) and an existing claim is unchanged; a new claim copies owner role. An archived template is refused. | pgTAP |
| AC-CBS-003 | Given a claim with no completed or skipped step, when a Project Manager loads a template, then its steps are replaced and the first is current today. Given a completed step, an invoice or a withdrawn claim, then it is refused (`claim-steps-started`). | pgTAP |
| AC-CBS-004 | Given a live claim, when Finance adds a step after the current one, renames another, changes owner role and target date and reorders two open steps, then all persist, positions stay unique and ordered, and an audit row is written per edit. | pgTAP |
| AC-CBS-005 | Given a completed or skipped step, when anyone edits it, or adds or moves a step before it, then refused (`stage-not-editable`). | pgTAP |
| AC-CBS-006 | Given a Project Manager of the project, when they change a step's owner role and target date, then it succeeds; when they add, remove or reorder, or edit another project's claim, then refused `42501`; an Engineer is refused. | pgTAP |
| AC-CBS-007 | Given a claim with one open required step, when Finance removes it with a reason, then the gate opens and an invoice succeeds; with no reason or a Project Manager, refused and the gate still closed. Mutation: let a Project Manager remove, or drop the reason check, and this goes red. | pgTAP |
| AC-CBS-008 | Given an invoiced claim, when steps are added, removed or reordered, then refused (`claim-invoiced`); when owner role or target date changes on an open step, then it succeeds and `billing_stages_open` is unchanged. | pgTAP |
| AC-CBS-009 | Given a step with target date 5 March and none-day target, when today is 6 March, then the job notifies once; given target date and target days both set, the date wins. A step with neither is never notified. | pgTAP |
| AC-CBS-010 | Given a step with an owner role, when it is overdue, then the active holders of that role are notified once and the project manager is not (unless that is the role); given no active holder, then the Admins are notified; another organisation's users never are. | pgTAP |
| AC-CBS-011 | Given steps with owner role Finance current in two claims and one completed, when a Finance user asks for their waiting steps, then they get the two current ones; a Project Manager gets only steps owned by Project Manager on projects they manage; completing a step removes it with no other write; another organisation's steps never appear. | pgTAP |
| AC-CBS-012 | Given pure step data, when the waiting-step pointer is derived, then count, oldest overdue days, tone and link are as FR-CBS-041; no pointer when empty or when the call fails (failure shown as unknown, not zero). | Unit (`waitingSteps.test.ts`, `useNeedsYou.waitingSteps.test.tsx`) |
| AC-CBS-013 | Given a claim with an overdue current step, when the billing tab renders, then the claim row shows the marker with step name and days over; a claim without one shows none. | RTL (`BillingTab` / claim row test) |
| AC-CBS-014 | Given Finance on a claim's step list, when they load a template, edit a step, add and remove one with a reason, then the list reflects each; a Project Manager sees only owner role and target date controls. | RTL (`ClaimBillingStagesEdit.test.tsx`) |
| AC-CBS-015 | Given a project with a template loaded, when Finance raises a claim, edits its list, completes steps as the owner roles, and a step owned by their role waits, then the needs-you item appears and clears on completion, and the invoice succeeds. | E2E (one journey) |
| AC-CBS-016 | Given an organisation with no owner roles and no templates, when every existing flow runs, then no marker, item or control is added (existing suites untouched and green). | Existing suites (no new test) |

## Errors
| Condition | Result |
|---|---|
| Edit completed or skipped step, or place a step before one | `55000`, detail `stage-not-editable` |
| Add, remove or reorder on an invoiced claim | `55000`, detail `claim-invoiced` |
| Load template on a started claim | `55000`, detail `claim-steps-started` |
| Template archived or not found | `P0002`, detail `template-not-found` |
| Owner role not a known role | `22P02` (enum cast), mapped by `classifyMutationError` |
| Remove reason invalid | `23514`, detail `step-reason-invalid` |
| Role not allowed | `42501` |

## Decisions (OD-CBS-1..5 decided, Director, 21 Nov 2026: taken as proposed)
| ID | Decision | If wrong, what breaks |
|---|---|---|
| OD-CBS-1 | Editing the step list (add, remove, reorder, rename) is Finance or Admin; a Project Manager sets only owner role and target date. Removing a step is audited with a reason. | Too wide: a PM waives a control step on their own claim by deleting it. Too narrow: a PM must ask Finance to add a step, slower but safe. |
| OD-CBS-2 | A step's owner is a **role**, not a named person; the pointer goes to everyone holding the role (a Project Manager only for their own projects). | If a named assignee is wanted, a second column is added later; nothing here blocks it. |
| OD-CBS-3 | The pointer is derived on read, never stored, so it cannot go stale and clears itself. | A stored pointer would need clearing on every completion path. |
| OD-CBS-4 | The claim keeps its own copy of a template (loading never links); editing a template later changes new claims and projects only. | Linked templates would move live claims under their teams. |
| OD-CBS-5 | An owner role with no active holder notifies the Admins and shows no pointer. | Silent steps nobody is told about. |

## Build notes (#2680)
- Migrations 1365 (columns, deferrable position uniqueness, org template tables, claim copy of owner role), 1366 (template RPCs, `billing_claim_invoiced`, `set_billing_stage_template` reads owner role), 1367 (edit RPCs and two shared helpers), 1368 (the two seams and the overdue job), 1369 (needs-you reads). `billing_stages_open` and both gate triggers are untouched.
- A step's overdue state uses the seam: target date wins over target days (`billing_stage_due_on`). Changing a step's target resets its once-only overdue stamp, so a moved date can warn again once.
- A PM loading a template onto an untouched claim (FR-CBS-003) replaces the claim's steps, which can shorten the list. Templates are written only by Finance or Admin, so a PM chooses among lists Finance already vetted; an empty template is refused for a claim (`template-empty`).
- A claim whose steps carry an attached checklist document is not "untouched" and refuses a template (`claim-steps-started`), so no evidence link is silently dropped.
- The pointer read gives Admin, Executive, Finance and Project Manager results; an Engineer gets none because the stage tables are not readable by an Engineer (1021). A needs-you read that fails adds no item and does not block the list (a deliberate narrowing of "shown as unknown": the list's own error state is not touched, so existing needs-you behaviour is unchanged).
- Screens: the claim's step editor is a collapsible panel in the claim's step list (`ClaimStepsPanel`); templates are managed from the project billing terms editor (`BillingStepTemplatesModal`, opened by "Manage templates"; no new route); the claim list marker is `ClaimOverdueMarker`. All three render nothing outside a data layer, so existing screens and tests are unchanged. The project billing terms editor now keeps and edits each stage's owner role (before this ticket a save would have dropped it).
- Owner roles are the shared role list (`src/auth/coarseRoles.ts`); the wider role set is picked up when that list grows.

## Delivery checklist
- [ ] Glossary: Step owner role, Step target date, Step template, Waiting step pointer (`docs/glossary.md`, EN and ID).
- [ ] Cross-references in `billing-stage-targets.spec.md` (FR-BSX-011 marker, seams) and the roadmap issue (#1571).
