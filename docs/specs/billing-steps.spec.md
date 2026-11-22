# Spec: A work order's billing checklist from the day it is issued

**Status:** draft for approval (phase 2). Lane gap-billing, slug `billing-steps`. Money- and access-adjacent: it moves where the
invoice gate's inputs are created and who may read and act on them, so it ships alone (ADR-0019, `docs/money-path-primer.md`).
IDs `FR-WBS-###`, `NFR-WBS-###`, `AC-WBS-###`, `OD-WBS-#`. Plan: `docs/plans/2026-11-22-billing-steps.md`. Migrations 1770-1779.
Builds on `claim-billing-steps.spec.md` (#2680), `billing-stage-targets.spec.md` (#2592), `billing-stages.spec.md` (#2522),
`billing-board.spec.md` (#2681), `builtin-role-set.spec.md` (#2709), `email-notifications.spec.md`. Terms there keep their meaning.

## Job story
When a work order is opened, I want a billing checklist for it created from the organisation's template at once (not when a claim
is raised), each step with a named person, a target number of days, attachments and a status, so the whole chain from field survey
to invoice is seen in one view and nobody has to chase by chat. Each person sees the steps waiting for them (shared waiting list) and
is told when their step opens. Roles the organisation names can act on their own steps (for example survey staff on survey steps).
One visibility rule must be possible: a role the organisation names (for example the quality team) does not see the
certified-quantity step's status.

## 1. What the code does today (verified on `origin/land/fix-1122` @ fc42e1a0; the code wins)

| Claim in the ask | Verdict | Evidence |
|---|---|---|
| Steps exist only once a claim exists | **True** | Steps are copied by the AFTER INSERT trigger on `progress_claims` (`instantiate_claim_billing_stages`, trigger 1021:199, head body 1365:81-99). `claim_billing_stages.claim_id` is `not null` (1021:45). No work-order trigger touches billing steps; the only issue-time copy is the close-out list (1402:5-18). |
| Survey staff cannot act | **True** | Every step writer goes through `lock_billing_stage_claim`, which refuses any base level but Admin, Finance, Project Manager (1361:105-107); the edit RPCs use the same three (1367:20-22). Survey staff (`quantity_surveyor`) sit at base level Engineer (`builtin-role-set.spec.md` row 9). They cannot even read steps: restrictive policy `*_engineer_read_scope` admits Admin, Executive, Project Manager, Finance only (1021:90-91; same on the template tables 1365:72-74). |
| Quality and survey staff share one access level | **Partly** | `quality_inspector` and `quantity_surveyor` are both Engineer base (rows 21, 9), so no rule can tell them apart; `quality_manager` is Project Manager base (row 20) and reads every step today. The step owner is `owner_role public.user_role` (1365:8-10, enum `user_role`): it can name only the five base levels, never a built-in role. |
| (implied) a named person per step | **Absent** | OD-CBS-2 chose a role, not a person (`claim-billing-steps.spec.md` Decisions). No assignee column exists. |
| (implied) told when a step opens | **Absent** | The only billing-step notice is the overdue job (1368:44-80, recipients 1460:35-56). The email event `billing_step` exists with no producer (`email-notifications.spec.md` §Events). |
| (implied) waiting list for any role | **Partly** | `my_waiting_billing_steps` (1369:9-29, guarded by 1480) returns nothing for any base level outside the four readers and matches only `owner_role = auth_role()`. The shared waiting list is the needs-you list (`useNeedsYou.ts`, item `billing-steps-waiting`); it skips Engineers in the FE too (`useNeedsYou.ts:213`, `:373`). |
| (implied) hide a step's status from a role | **Absent** | No per-step visibility exists; the board is an invoker read over the step table (1370), so any reader sees every step. |

Other facts the design depends on:
- A work order is opened at `Draft -> Issued` (`transition_work_order`, 0337:590-591); that is when the close-out list is copied (1402).
- A work order can carry many progress claims over time (`progress_claims.work_order_id`, 0250:263, index 0250:289), and a claim may have
  no work order (project-level claim). Down payments never have steps (1365:84).
- The invoice gate is `billing_stages_open(claim)` (1361:172-175), read by two BEFORE INSERT triggers (1021:361-364). It keys on
  `claim_billing_stages.claim_id`. Writers lock the claim row, then the step row (1361:111-115); the gate takes the claim row FOR SHARE.
- Light accounts (Foreman, Field user) are denied every billing table (1462) and every billing definer (1480).
- `notify_workflow_user(..., p_email_event)` (1224:8-11) never notifies the acting user and checks active membership.

## 2. Design (one model; no second path)

The **billing checklist** becomes the one billing record. A new parent row `billing_checklists` owns the existing step rows
(`claim_billing_stages` stay THE steps; they gain `checklist_id`). A checklist belongs to a work order from the day it is issued and is
taken over by the claim raised later: the same rows gain the claim's id; nothing is copied. A checklist has at most one claim and a
claim at most one checklist. The invoice gate is untouched: it still reads the steps by `claim_id`, which the takeover sets.

```
work order issued ──► billing_checklists(work_order_id, claim_id NULL) + its steps (step 1 current from today)
claim raised on it ─► same checklist: claim_id := claim; steps.claim_id := claim; documents become claim evidence
claim withdrawn ────► claim_id cleared again: the checklist goes back to the work order for the next claim (OD-WBS-2)
no open checklist ──► (claim without work order, work order issued before this ships, second round) a checklist is made at claim time, as today
```

## 3. Reconciling with OD-SCOPE-6 ("billing: one record, steps on the claim")
Kept: **one billing record, no task copies** (no step is a task; steps are never copied from a work order to a claim; the board stays a
view). Changed: **where the record starts.** The checklist is created on the work order when it is issued and the claim takes it over when
raised; from then on the steps are on the claim exactly as OD-SCOPE-6 says and the invoice gate reads them by claim as today. Before a claim
exists the steps are on the work order, because the ask needs the field survey tracked before any claim can exist. Claims with no work
order, and work orders issued before this ships, keep today's copy-at-claim. **Owner question:** confirm OD-SCOPE-6's "steps on the claim"
may read "steps on the work order's billing checklist, which the claim takes over".

## Terms (new; `docs/glossary.md` EN and ID)
- **Billing checklist** — the one billing record of a work order's billing round: its ordered steps, then the claim that takes it over.
- **Billing round** — one checklist; a work order billed more than once has one round per claim.
- **Step assignee** — the named member responsible for a step. Optional.
- **Step owner (role)** — a built-in role key (or, as today, a base level) responsible for a step.
- **Step actor roles** — the built-in roles an organisation names as allowed to act on steps they own.
- **Hidden step** — a step whose status, dates, notes and documents a named role does not see.

## 4. Requirements (EARS)

**Checklist lifecycle**
- FR-WBS-001 When a work order moves from Draft to Issued, the database shall create one billing checklist for it from the source list
  (FR-WBS-003) and make its first step current from that day. Where the source list is empty, no checklist is created.
- FR-WBS-002 When a progress claim is inserted on a work order that has a checklist with no claim and not cancelled, the database shall
  attach that checklist to the claim (set `claim_id` on the checklist and its steps) in the same statement and copy every document already
  attached to its steps into the claim's evidence. Otherwise it shall create a checklist for the claim from the source list, as today.
  A claim shall never receive two checklists, and no step shall be copied from an existing checklist.
- FR-WBS-003 The source list shall be the project's stage list when it has stages, else the organisation's default step template when one
  is set, else nothing. Only Finance or an Admin sets or clears the default template.
- FR-WBS-004 When a claim that took over a work-order checklist is withdrawn, the database shall clear the claim from the checklist and its
  steps, so the next claim on the work order takes it over (OD-WBS-2). Completed steps and attached documents stay.
- FR-WBS-005 Finance, an Admin, or the project's manager shall be able to start a billing round on an issued work order that has no
  checklist without a claim (a work order issued before this shipped, or the next round after a claim). The database shall refuse when one
  exists (`BCL_ROUND_OPEN`) or the work order is Draft or Cancelled (`BCL_WO_NOT_OPEN`).
- FR-WBS-006 A checklist on a cancelled work order with no claim shall not appear in any waiting list, board or notice.

**Steps (existing fields kept; new fields)**
- FR-WBS-010 A step shall carry, besides today's fields, an optional assignee (an active, non-light member of the organisation), an
  optional owner role key (a built-in role, not a light one), and a list of built-in role keys its status is hidden from. The project's
  stage list and organisation templates carry owner role key and hidden list; the assignee is set on the checklist's steps only.
- FR-WBS-011 Today's edit rights stay: Finance or an Admin change the list; the project's manager changes owner, target date and now the
  assignee. The hidden list is Finance or Admin only. Every step edit RPC shall work on a checklist with or without a claim.
- FR-WBS-012 The database shall refuse an assignee, or an owner role key, that the step's hidden list covers (`BCL_OWNER_HIDDEN`), an
  assignee who is not an active member of the organisation or is a light account (`BCL_ASSIGNEE_INVALID`), and a light role key as owner or
  actor role (`BCL_ROLE_INVALID`).

**Who acts and who reads**
- FR-WBS-020 The organisation setting **step actor roles** (built-in role keys, default empty) shall be written only by an Admin or Finance.
- FR-WBS-021 A member may complete a step, attach its documents and note it when: their base level is Admin, Finance or Project Manager (as
  today); or they are the step's assignee; or their built-in role is in the step actor roles and equals the step's owner role key and the step
  has no assignee. Skip, remove, reorder, add and template load stay Finance or Admin. All other checks of today (order, documents, dates,
  client reference, withdrawn, invoiced) are unchanged.
- FR-WBS-022 A member shall read a checklist's steps and step documents when their base level is one of today's four readers, or their
  built-in role is in the step actor roles, or they are the assignee of a step of that checklist. Light accounts read none (1462 stays).
- FR-WBS-023 While a member's built-in role is in a step's hidden list, the database shall not return that step's row or its documents to
  them through any table read, and every definer read (waiting list, claim markers, board, checklist view) shall leave it out or show only
  its name and position with no status. The member shall not be able to act on it (it reads as not found). Members with no built-in role are
  never hidden from.

**Waiting list and notices**
- FR-WBS-030 A step's **holders** are its assignee when set; else the active holders of its owner role key; else, as today, the holders of
  its owner base level (Project Manager: the project's manager only). Only holders who may read the step (FR-WBS-022/023) count.
- FR-WBS-031 The waiting list read shall return the current steps the viewer holds, on live checklists (claim not withdrawn; work order not
  cancelled), with project, work order, claim (or none yet), step name, due date and days over; at most 200 rows.
- FR-WBS-032 The needs-you list shall show the waiting-steps item for every role, including Engineer-level actors; a viewer with no rows
  sees nothing (unchanged derivation, `summariseWaitingSteps`).
- FR-WBS-033 When a step becomes current (its started day is set), the database shall notify each holder once, in-app, with email event
  `billing_step` (sent only where the organisation switched that event on). Not the acting member. No Admin fallback for this notice.
- FR-WBS-034 The overdue notice keeps its rules (once per step; target date wins) and its recipients become the holders (FR-WBS-030), with
  today's Admin fallback when there are none. It shall also cover current steps of a checklist that has no claim yet.

**Screens**
- FR-WBS-040 The work order's drawer shall show its current billing checklist (pending or the latest claim's) with every step, its status,
  assignee, owner, target, documents, and the "start billing round" action where FR-WBS-005 allows; a step hidden from the viewer shows its
  name with "Status not shown to your role".
- FR-WBS-041 The step editor (`ClaimStepsPanel`) gains assignee (member combobox), owner role key (built-in roles, shown only where built-in
  roles are on) and hidden-from roles (Finance/Admin). A disabled control says why.
- FR-WBS-042 The billing board shows a card per live checklist: claims as today, plus work orders whose checklist has no claim yet,
  labelled "No claim yet".
- FR-WBS-043 The billing settings (the templates manager) gain "Default template" and "Roles that may act on their own steps".

## 5. Settings and defaults (each default keeps today's behaviour for an organisation already using billing steps)
| Setting / data | Where | Default | Today's behaviour kept |
|---|---|---|---|
| Step actor roles | `org_billing_step_settings.actor_role_keys text[]` | empty | only Admin, Finance, Project Manager act; four roles read |
| Default step template | `billing_step_templates.is_default` (one per org) | none | source is the project list only |
| Step assignee | `claim_billing_stages.assignee_id` | null | owner role rule |
| Step owner role key | `owner_role_key` on steps, project list, template steps | null | `owner_role` base-level rule |
| Hidden from | `status_hidden_from text[]` on the same three | empty | every reader sees every step |

Not a setting (deliberately on for everyone, as the ask requires): the checklist is created at issue instead of at claim time for work
orders issued after this ships, so step 1's target days count from the issue day; the step-opened notice goes to holders (email still off
until the organisation turns on `billing_step`).

## 6. Non-functional
- NFR-WBS-001 `billing_stages_open` and the two gate triggers are not edited. Existing claims keep working: a data step gives every existing
  claim with steps one checklist (`claim_id` and `work_order_id` from the claim) and stamps its steps; rollback reverses it (pending
  checklists with no claim are dropped by the rollback, stated in its header).
- NFR-WBS-002 Lock order everywhere: claim row (when attached), then checklist row, then step row. A writer on a checklist without a claim
  re-reads `claim_id` after locking it; if a claim attached meanwhile it raises `40001` (retry) rather than lock out of order.
- NFR-WBS-003 New tables: RLS on and forced, `org_id` stamped from the parent row by trigger (never from the client), policies with
  `(select helper())`, no client write grant; functions `security definer`, `set search_path = public`, revoked from public and anon, each
  guarded by `assert_not_light()`; isolation-probe fragment added.
- NFR-WBS-004 Refusals use the `BCL_` family with English and Bahasa Indonesia sentences in `refusals.json`; FE strings en/id; DESIGN.md
  tokens; phone 390px and desktop 1440px.
- NFR-WBS-005 The holder and hidden tests are index-backed (partial indexes on open current steps by `assignee_id`, `owner_role_key`).

## 7. Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WBS-001 | Given a project with a 3-step list, when a work order goes Draft to Issued, then one checklist with 3 steps exists, step 1 current from today, no claim; issuing a second work order makes a second checklist; an empty list makes none. | pgTAP |
| AC-WBS-002 | Given that checklist with step 1 completed and a document attached, when a progress claim is raised on the work order, then the same step ids now carry the claim id, no new step row exists, the document is in the claim's evidence, and `billing_stages_open(claim)` is true until steps 2-3 complete, then false and an invoice succeeds. | pgTAP |
| AC-WBS-003 | Given a work order whose checklist already has a claim, when a second claim is raised, then it gets its own checklist from the source list (today's copy); given a claim with no work order, then the same; down payments get none. | pgTAP |
| AC-WBS-004 | Given an existing claim with steps from before the migration, then it has exactly one checklist, every step carries it, and complete, skip, edit and invoice behave as before (the existing 1360/1365 suites stay green with only the renamed entry points changed). | pgTAP |
| AC-WBS-005 | Given an attached work-order checklist, when the claim is withdrawn, then the checklist has no claim, completed steps stay, and the next claim takes it over. | pgTAP |
| AC-WBS-006 | Given no project list and an organisation default template, when a work order is issued, then the checklist copies the template; a non-Finance/Admin cannot set the default (42501). | pgTAP |
| AC-WBS-007 | Given an issued work order with no open round, when its project manager starts a round, then a checklist exists; a second start is refused `BCL_ROUND_OPEN`; on a Draft or Cancelled work order `BCL_WO_NOT_OPEN`; an Engineer is refused 42501. | pgTAP |
| AC-WBS-008 | Given actor roles empty and a survey-staff member owner of step 1, when they complete it, then refused 42501 and they read no step (today). Given an Admin adds that role to the actor roles, then they read the checklist and complete step 1; they cannot complete a step owned by another key, nor skip or remove. Mutation: drop the owner-key match and this goes red. | pgTAP |
| AC-WBS-009 | Given a step assigned to an Engineer-level member, when they attach its document and complete it, then it succeeds; another Engineer is refused; a light account cannot be assigned (`BCL_ASSIGNEE_INVALID`). | pgTAP |
| AC-WBS-010 | Given step 3 hidden from the quality role, when a quality manager (Project Manager base) reads steps, documents, the board, the waiting list and the claim markers, then step 3's row and documents are absent and the checklist view shows its name only; calling complete on it reads not found; a Finance user still sees it. Mutation: drop the restrictive policy's hidden test and this goes red. | pgTAP |
| AC-WBS-011 | Given an owner key or assignee that the hidden list covers, then refused `BCL_OWNER_HIDDEN`. | pgTAP |
| AC-WBS-012 | Given step 2 owned by a key with two active holders, when step 1 completes, then each holder gets one in-app notice with email event `billing_step` and the completer none; with the event on, one email outbox row per holder; with an assignee, only the assignee. | pgTAP |
| AC-WBS-013 | Given a current step of a checklist with no claim past its target, when the overdue job runs, then its holders are notified once; with no holders the Admins. | pgTAP |
| AC-WBS-014 | Given steps current on pending and attached checklists, when a holder reads the waiting list, then both are returned with claim null for the pending one; a cancelled work order's and a withdrawn claim's are not; another organisation's never. | pgTAP |
| AC-WBS-015 | Given waiting rows for an Engineer-level viewer, then the needs-you item appears for that role; no rows, no item. | Unit (`useNeedsYou.waitingSteps.test.ts`) |
| AC-WBS-016 | Given a work order drawer with a pending checklist, then steps, statuses, assignee and documents render; a hidden step shows its name and "Status not shown to your role"; "Start billing round" shows only when allowed and otherwise says why. | RTL (`WorkOrderBillingChecklist.test.tsx`) |
| AC-WBS-017 | Given the step editor, when Finance sets assignee, owner key and hidden roles, then the RPC receives them; a project manager sees assignee and owner controls but not hidden roles. | RTL (`ClaimStepsPanel.assignee.test.tsx`) |
| AC-WBS-018 | Given the billing settings, when an Admin picks a default template and actor roles, then they save; a Project Manager sees them read-only. | RTL (`BillingStepTemplatesModal.settings.test.tsx`) |
| AC-WBS-019 | Given a board with one pending checklist and one claim, then two cards, the pending one labelled "No claim yet". | RTL (`BillingBoard.test.tsx` new case) |
| AC-WBS-020 | Given a project list with a survey step owned by survey staff (actor role on), when a work order is issued, the surveyor sees the step in needs-you, attaches the survey document and completes it, then a claim is raised and shows the same completed step, the remaining steps complete and the invoice succeeds. | E2E (one journey, serial lane) |

## 8. Errors
| Condition | Result |
|---|---|
| Round already open on the work order | `BCL_ROUND_OPEN: ...` (55000) |
| Work order Draft or Cancelled | `BCL_WO_NOT_OPEN: ...` (55000) |
| Assignee not an active non-light member | `BCL_ASSIGNEE_INVALID: ...` (23514) |
| Light role key as owner or actor role, or unknown key | `BCL_ROLE_INVALID: ...` (23514) |
| Owner key or assignee covered by the hidden list | `BCL_OWNER_HIDDEN: ...` (23514) |
| A claim attached during an edit of a pending checklist | `40001`, retry (classified as "try again") |
| Today's codes (`stage-not-editable`, `claim-invoiced`, `claim-steps-started`, ...) | unchanged |

## 9. Decisions to confirm (OD-WBS; built with the recommended answer)
| ID | Question | Built meanwhile (recommended) | If wrong, what breaks |
|---|---|---|---|
| OD-WBS-1 | A work order billed more than once: start the next round automatically when a claim takes the checklist over? | No. A later claim copies at claim time (today); anyone allowed can "start billing round" early. | Automatic: every single-bill work order gets a dangling round whose first step sits in someone's waiting list forever. |
| OD-WBS-2 | A withdrawn claim gives its checklist back to the work order? | Yes, when the checklist came from the work order. | No: a re-raised claim gets a fresh copy and the survey already done is re-entered (a duplicate). |
| OD-WBS-3 | May the named assignee act on their step whatever their role? | Yes: naming the person is the organisation's explicit choice. | No: a named person who cannot tick their own step; the chase-by-chat stays. |
| OD-WBS-4 | Hidden status, what it cannot hide: steps run in order, so a later step opening shows the hidden step is done; documents attached to the hidden step become claim evidence, readable by those who read the claim's evidence. | Built as stated; the spec and settings card say it. An organisation that needs it unknowable also hides the later steps. | If the owner needs the hidden step unknowable, its documents must not become claim evidence (an evidence/invoice change, owner call). |
| OD-WBS-5 | Work orders already Issued when this ships get a checklist? | No backfill (as OD-WCO-3); "start billing round" creates one; their claims copy as today. | Backfill: hundreds of rounds opening at once in waiting lists, targets already "overdue". |
| OD-WBS-6 | OD-SCOPE-6 wording (section 3). | Steps start on the work order's checklist; the claim takes it over. | If "steps on the claim" is literal, the ask's "created at once, not when a claim is raised" cannot be met. |

## 10. Seam for the survey-cap item (next)
The survey cap (a claim capped by the jointly surveyed quantity) should hang off the checklist, not the claim: the checklist exists on the
work order before any claim. Seam: `billing_checklist_open_for_work_order(p_work_order) returns uuid` (the checklist a new claim would take
over) and the attach point in `instantiate_claim_billing_stages`. Surveyed quantities can be stored per checklist and work-order line
(`billing_checklist_id` FK), and the cap checked by a BEFORE INSERT trigger on `progress_claims` that reads that function; no step name is
coded (the step that records the quantity is customer data, e.g. a step flag).

## 11. Existing tests whose steps change (goal kept)
- `supabase/tests/1365_claim_billing_steps.test.sql`: `add_claim_billing_step(p_claim,...)` and `load_billing_step_template_onto_claim(p_claim,...)`
  become `add_billing_step(p_checklist,...)` and `load_billing_step_template_onto_checklist(p_checklist,...)`; the test resolves the claim's
  checklist first. Assertions unchanged.
- `supabase/tests/1370_billing_board.test.sql`: the board row gains `checklist_id`; claim cards unchanged.
- `pmo-portal/src/lib/db/billingSteps.test.ts`, `ClaimStepsPanel` tests: the RPC names above.
- `useNeedsYou.waitingSteps.test.ts`: the Engineer exclusion is deliberately removed (FR-WBS-032).
