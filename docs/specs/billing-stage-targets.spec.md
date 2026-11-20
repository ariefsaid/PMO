# Spec: Billing stages with target days, overdue warning and optional stages (#2592)

**Status:** proposed; owner decisions below need sign-off before build. Map #2516. Target January 2027, the first release after the 15 December go-live. IDs `FR-BSX-###`, `NFR-BSX-###`, `AC-BSX-###`, `OD-BSX-#`. Plan: `docs/plans/2026-11-21-billing-stage-targets.md`. Executor: Orca worker, **Director-dispatched**: this changes the invoice gate (`billing_stages_open`, `complete_billing_stage`), which is the money path (ADR-0019, `docs/money-path-primer.md`). It ships alone. Builds on `docs/specs/billing-stages.spec.md` (#2522, migrations 1021 and 1022); read it first. The terms Billing stage, Stage age and Invoice deadline are used as defined there.

## Job story

When a progress claim is waiting on one of its billing steps, I want each step to carry a target number of days, to show as overdue once it passes the target and to tell the claim's project manager once, and I want a step that does not apply to this claim to be marked not needed with a reason, so that late steps are chased before the client's monthly cut-off and a claim is not held up by a step nobody needs.

## Context and boundary (checked against `origin/dev`, 20 Nov 2026)

- A project holds an ordered stage list: `billing_stage_templates` (position, name, `client_side`) and `billing_stage_template_documents` (checklist, `required`), 1021. A new progress claim copies it onto `claim_billing_stages` and `claim_billing_stage_documents` through `instantiate_claim_billing_stages()`. The list is replaced whole by `set_billing_stage_template`, which `set_project_billing_terms` (1022) calls. Finance and Admin only.
- Stage age already exists as a pure function: `stageAgeDays` in `pmo-portal/src/lib/billingStages.ts` (started to completed, or to today while open).
- The invoice gate is one predicate, `billing_stages_open(p_claim)` = "some stage has `completed_on is null`", used by the trigger `assert_claim_billing_stages_complete()` on both `sales_invoices` and `external_command_outbox` (1021). `complete_billing_stage` refuses an out-of-order completion with the same test.
- The stage screen is `pmo-portal/pages/project-detail/tabs/ClaimBillingStages.tsx`; reads and writes go through `src/lib/db/billingStages.ts`, `src/lib/repositories/billingStages.ts` and `src/hooks/useBillingStages.ts`.
- Notifications: `notify_workflow_user` (0237) writes one `notifications` row per recipient. Since 1025 a client-visible message key is accepted only for a fixed set from `service_role`; every other row is stored as a `literal`. The overdue-job precedent is `escalate_overdue_incidents()` (1028): a `security definer` function on `cron.schedule`, stamps a column once, notifies the project manager with an Admin fallback, writes an audit row. This spec reuses that shape.
- This changes **no amount**. It changes when an invoice may be raised, so it is money-path: the gate stays database-enforced, with a pgTAP proof and a mutation check.
- Out of scope: a business-day calendar, targets on the retention release, per-claim edits of a stage's target (a claim keeps the copy it took).

## Requirements (EARS)

**The list**
- FR-BSX-001 The project's stage list shall let each stage carry an optional **target** of 1 to 365 whole days and an **optional** flag (default not optional). The list stays one whole ordered list replaced by `set_billing_stage_template`, by Finance or an Admin only; both fields travel in that payload.
- FR-BSX-002 When a progress claim is created, the database shall copy each stage's target and optional flag onto the claim's stage, as it already copies name and client-side flag. Editing the project's list shall not change a claim already made.

**Overdue**
- FR-BSX-010 While a stage is current (started, not completed, not skipped) and has a target, the stage shall be **overdue** when its age in days is greater than its target. A stage with no target is never overdue. The age is the existing Stage age, in organisation calendar days (`native_org_today`).
- FR-BSX-011 The claim's stage list shall show an overdue stage as overdue with its age and its target (for example "12 days, target 10"), and the project's claim list shall show that a claim has an overdue stage. A stage waiting on the client (client-side flag) is shown the same way with that label.
- FR-BSX-012 When a stage becomes overdue, a scheduled database job shall notify the claim's project manager once, stamp `overdue_notified_at`, and write an audit row. If the project has no active project manager it shall notify the organisation's active Admins. A re-run shall not notify again.
- FR-BSX-013 The overdue notification shall name the stage, the claim and the days over target, and open the claim.
- FR-BSX-014 A stage that is completed or skipped shall not be reported overdue, and a withdrawn claim's stages shall be ignored by the job.

**Optional stages**
- FR-BSX-020 When Finance or an Admin marks a current, optional stage as not needed with a reason of 3 to 500 characters, the database shall record the skip date (organisation today), the person and the reason, and make the next stage current from that date.
- FR-BSX-021 The database shall refuse to skip a stage that is not optional, is not current (an earlier stage is open), is already completed or skipped, or belongs to a withdrawn claim, or when the reason is blank.
- FR-BSX-022 A skipped stage shall count as complete for the invoice gate: `billing_stages_open` shall be false when every stage is completed or skipped, for the native invoice and the ERP outbox command alike.
- FR-BSX-023 A skipped stage shall count as done for ordering: a later stage may be completed once every earlier stage is completed or skipped, and a later stage's completion date shall not be before the skip date.
- FR-BSX-024 A skipped stage, like a completed one, shall not change: no checklist attachment, completion or second skip. The skip is not undone.
- FR-BSX-025 A required checklist item on a skipped stage shall not block the invoice gate and shall be shown as not needed.

**Access and tenancy**
- FR-BSX-030 No client write grant shall exist on the new columns; they change only through `set_billing_stage_template`, the claim-creation copy, `skip_billing_stage` and the overdue job. Every function re-asserts active membership, role and organisation, and locks the claim row in the order the existing stage functions use.
- FR-BSX-031 Skipping is by Finance or an Admin, not a Project Manager (OD-BSX-3); a Project Manager and an Engineer are refused with `42501`.

## Non-functional requirements
- NFR-BSX-001 The new columns are nullable or defaulted so the migration is additive and existing claims are unchanged (no target, not optional, never overdue).
- NFR-BSX-002 The job scans only open stages of live claims through a partial index, runs at most once a day per stage (one stamp), and holds each claim row `for update skip locked`.
- NFR-BSX-003 English and Bahasa Indonesia strings in the existing stage namespace; `DESIGN.md` tokens; overdue is shown by words as well as colour; usable at phone width.
- NFR-BSX-004 Every function is `security definer` with `set search_path = public`, `revoke all ... from public, anon`, and RLS `(select helper())` wrappers where a policy is touched (none expected).

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-BSX-001 | Given a project list whose second stage has target 10 and is optional, when Finance saves it and a claim is created, then the claim's second stage carries target 10 and optional; a later edit of the list does not change that claim. | pgTAP |
| AC-BSX-002 | Given a Project Manager or Engineer, when they save a list with targets, then it is refused `42501`. | pgTAP |
| AC-BSX-003 | Given a stage started 1 March with target 10, when today is 11 March then it is not overdue; on 12 March it is overdue with age 11; with no target it is never overdue; a completed stage is not. | Unit (`billingStages.test.ts`, pure `stageOverdue`) |
| AC-BSX-004 | Given an overdue current stage and an active project manager, when the job runs, then that manager gets one notification and `overdue_notified_at` is stamped; a second run adds none. | pgTAP |
| AC-BSX-005 | Given a project with no active manager, when the job runs, then the active Admins are notified once each; given another organisation's stage, then none of its users is notified. | pgTAP |
| AC-BSX-006 | Given a stage with no target, a completed or skipped stage, or a withdrawn claim, when the job runs, then nothing is sent. | pgTAP |
| AC-BSX-007 | Given a current optional stage, when Finance skips it with a reason, then the skip date, person and reason are stored and the next stage is current from that date, with an audit row. | pgTAP |
| AC-BSX-008 | Given a stage that is not optional, not current, already skipped or completed, or a blank or 2-character reason, when anyone skips it, then it is refused and nothing changes. | pgTAP |
| AC-BSX-009 | Given a claim whose only open stage is skipped, when Finance raises the native invoice and an ERP outbox command is written, then both succeed; given the same claim with a required, non-optional stage still open, both are refused `billing-stages-incomplete`. Mutation: make `billing_stages_open` ignore `skipped_on`, and the first half must go red; make it count every skipped stage including non-optional ones as done by editing the skip guard, and AC-BSX-008 must go red; restore. | pgTAP |
| AC-BSX-010 | Given stages A (completed), B (optional, skipped), C open, when C is completed on or after the skip date, then it succeeds; before the skip date it is refused; with B still open, C is refused `stage-out-of-order`. | pgTAP |
| AC-BSX-011 | Given a Project Manager, when they skip a stage, then it is refused `42501`; a user of another organisation cannot see or change the stage. | pgTAP |
| AC-BSX-012 | Given a claim with an overdue stage and a skippable optional stage, when the project manager opens the claim, then the overdue stage shows its age and target; Finance skips the optional one with a reason and the stage list shows it as not needed with that reason. | RTL (`ClaimBillingStages.test.tsx`): states, labels, role-gated skip button |
| AC-BSX-013 | Given the journey list with an optional stage, claim created, required stages completed, optional stage skipped, then the invoice is raised and the claim trace shows the skip reason. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Skip a non-optional, non-current, finished or withdrawn stage | `55000`, detail `stage-not-skippable` |
| Blank or over-long reason | `23514`, detail `skip-reason-invalid` |
| Role not Finance or Admin | `42501` |
| Target outside 1 to 365 | `23514`, detail `stage-target-invalid`; list not saved |
| Job fails on one claim | That claim is not stamped and is retried next run; others proceed |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-BSX-1 | Targets count **calendar days** from the day the stage became current (the existing Stage age). | Business days would need a calendar that the organisation does not have yet; with calendar days a stage that waits over a weekend can read overdue one day early. |
| OD-BSX-2 | A claim keeps the target and optional flag it copied; changing the list later changes only new claims. Consistent with 1021. | Retroactive change would move a live claim's overdue state under a team that did not change anything. |
| OD-BSX-3 | **Skipping is Finance or Admin only.** The stage screen lets a Project Manager complete stages but not waive one. | Too wide: a PM can waive a required control step on their own claim and unblock an invoice without finance seeing it. Too narrow: a PM must ask Finance to mark a step not needed; slower, never wrong. |
| OD-BSX-4 | One notification per stage to the project manager, with Admin fallback. No repeat, no escalation to a line manager. | Without the one-time stamp a daily job would notify daily; sending only to Admin would miss the person who can chase the client. |
| OD-BSX-5 | The overdue notice uses the shared literal message form (English text), as the issue-overdue job does. A translated template key (`message_key`, 1025) is a later, separate change. | Bahasa Indonesia users read an English notice until the template is added. |
| OD-BSX-6 | An optional stage can only be skipped when it is current, not ahead of time. | Allowing skip-ahead lets a stage be waived before the earlier ones ran and the reason be stale by the time it matters. |
| OD-BSX-7 | A skipped stage's required documents are not needed and are shown as not needed. | Forcing documents on a waived stage defeats the point of waiving it. |

## Delivery checklist
- [ ] Owner signs OD-BSX-1..7.
- [ ] Glossary: Stage target, Overdue stage, Optional stage, Skipped stage (`docs/glossary.md`).
- [ ] Update `docs/specs/billing-stages.spec.md` FR-BST-011/020 cross-references and the roadmap issue (#1571) when the build ships.
