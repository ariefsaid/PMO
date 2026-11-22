# Spec: the survey record, the certified quantity and the claim ceiling (survey-cap-record, part C)

Job story: When I raise a claim, I want the surveyed quantity for the work item to be the hard cap on what can be claimed, and the certified quantity normally limited to what has quality documents, so a claim can never exceed what was measured.

Whether the survey is internal or joint with the customer's supervisor is open, so who took part is DATA (a list of participants per record), never a rule. Part A (`claimableHeadroom`, claim-form warning) and part B (`survey_quantity_for_line` seam, `claim_quantity_over_cap` setting, claim-line trigger) are the base. This part fills the seam; it adds no setting and no switch.

## Verified base behaviour (file:line)
- The seam today: `supabase/migrations/1781_claimable_headroom_twin.sql` `survey_quantity_for_line(uuid, uuid)` returns `null::numeric`. It feeds `work_order_line_headroom` (same file), which `enforce_claim_line_cap` (`1782_claim_line_cap_trigger.sql`) reads only while the organisation setting is `block`.
- The form: `pmo-portal/src/lib/progressBilling.ts:108-121` `claimableHeadroom` already accepts `surveyed`; `pages/project-detail/ProgressClaimModal.tsx:82` does not pass it, and `AllocationFacts` (`src/lib/progressBilling.ts:13-20`, parsed at `src/lib/db/progressBilling.ts:196-210` from `get_project_billing`) has no surveyed field. No survey table exists (searched all migrations, pages, src, CLI).
- Who records progress or acceptance today on a work order: `prepare_work_order_acceptance` (`0337:201-247`) requires an Issued work order and `may_record_project_progress(project)` (head: active member, and Admin/Finance/Executive-level value authority, or a pipeline-authority role who is the project's own manager). `confirm_work_order_acceptance` (`0339:9-52`) requires Admin or Finance, refuses the preparer confirming their own record unless they are the organisation's only active member (`confirm_basis = 'sole_operator'`), and requires an Issued or Approved project document with a file. UX mirror: `pmo-portal/src/auth/policy.ts:618-633` (`workOrderAcceptance`). Acceptance rows are immutable once Confirmed or Withdrawn (`0337:175-187`). Documents attach by `project_documents.id` (`1401` `attach_closeout_item_document`: same project, Issued/Approved, has a file).
- Light accounts: restrictive `light_account_deny` policy per table (`1206`), and public security-definer functions call `assert_not_light()` (`2711` sweep).
- The three-reviewer sweeps that new tables join: `0646_rls_initplan`, `2711_light_account_boundary_sweep`, the isolation-probe fragments (`scripts/isolation-probe-denominator.d/`).

## Decisions (what is followed, and why)
- Record and confirm follow the acceptance flow exactly: record = `may_record_project_progress`; confirm = Admin or Finance; recorder is not the confirmer unless the sole active member (basis stored). Said plainly to the owner: the survey is a measurement that caps money, so the same two-person rule as a BAST applies. A one-person organisation is not locked out.
- Quality-ready ("quantity that has quality documents") is a number typed on the record, with its documents attached on the same record; it is not derived from a document count. Its limit is enforced in the database (`quality_ready_quantity <= surveyed_quantity`). A claim past quality-ready is a WARNING only, in the form; no second setting (the hard stop stays the surveyed cap, via part B's setting).
- Correction is a new record that supersedes the confirmed one. History is never edited.

## Requirements (EARS)
- FR-SCR-1: The system shall store a survey record per work order and contract line with: survey date, surveyed quantity, quality-ready quantity, optional note, status `draft` | `confirmed`, who recorded and when, who confirmed and when and on what basis (`standard` | `sole_operator`), `supersedes_id`, `superseded_at`, and `archived_at`. Quantities are non-negative, at most 3 decimals, finite.
- FR-SCR-2: The database shall refuse a record whose quality-ready quantity exceeds its surveyed quantity (check constraint).
- FR-SCR-3: The system shall store the participants of a record as rows: a typed name (required), an optional company, an optional role label, and an optional link to an account. People without an account are typed names. No participant kind or role list is coded.
- FR-SCR-4: The system shall allow attachments to a record by existing project documents (Issued or Approved, with a file, of the work order's project), many per record, through the same rule as the close-out attach.
- FR-SCR-5: When a person who may record project progress records a survey on an Issued work order for a line allocated to it, the system shall create a `draft` record. A draft may be edited and its documents changed by its recorder or an Admin/Finance, and soft-archived (ADR-0018) while a draft.
- FR-SCR-6: When Admin or Finance confirms a draft, the system shall set it `confirmed`. The recorder cannot confirm their own draft unless they are the organisation's only active member. Confirmation of a record that supersedes another marks the superseded one `superseded_at`, in the same transaction.
- FR-SCR-7: A confirmed record is immutable: no update of its figures, date, participants or documents, no delete, no archive. Correction = a new draft with `supersedes_id` naming the confirmed record; at most one open draft per record superseded.
- FR-SCR-8: The certified quantity of a work-order line = the sum of surveyed quantity over its confirmed, not-superseded, not-archived records; null when it has none. The certified quality-ready quantity is the same sum of quality-ready.
- FR-SCR-9: `survey_quantity_for_line(work_order_id, boq_item_id)` shall return the certified quantity (null when none), so the claim headroom's ceiling uses it as `surveyed` for the part B stop and any later reader.
- FR-SCR-10: The claim form shall pass the certified quantity as `surveyed` to `claimableHeadroom`, show surveyed and quality-ready beside the ceiling for the line, and show a warning (never a refusal) when the typed quantity passes quality-ready, with the next step. Where there is no survey, behaviour is exactly part A/B's.
- FR-SCR-11: The work-order page shall list the surveys (date, line, surveyed, quality-ready, participants, documents, status) with record, confirm, correct and discard actions gated by `can()`; the empty state says who records it. EN and ID, 390 px and 1440 px.
- FR-SCR-12: A light account shall be refused every read and write of these tables and functions. Another organisation's records are invisible and unusable. `org_id` is stamped by the database.
- FR-SCR-13: Every refusal a person can meet shall have an English and a Bahasa Indonesia sentence in the refusals catalogue saying what to do next.

## Acceptance criteria (Given/When/Then) and owning layer
- AC-SCR-001 Given an Issued work order and an allocated line, when a permitted person records a survey with 2 participants (one typed, no account), then a draft exists with those participants and org_id of the caller. (pgTAP)
- AC-SCR-002 Given quality-ready above surveyed, when recording or editing, then refused (constraint and RPC message). (pgTAP)
- AC-SCR-003 Given a draft, when another Admin/Finance confirms, then it is confirmed with basis `standard`; when the recorder confirms in a multi-member org, refused; sole member confirms with `sole_operator`. (pgTAP)
- AC-SCR-004 Given a confirmed record, when any role updates, deletes, archives it or changes its participants or documents, then refused. (pgTAP)
- AC-SCR-005 Given a confirmed 10, when a correction of 8 is recorded and confirmed, then the old one is superseded and certified = 8; a second open correction of the same record is refused. (pgTAP)
- AC-SCR-006 Given two confirmed records 4 and 3 on a line, then certified = 7, certified quality-ready = their sum; with none confirmed (drafts, archived, superseded only) it is null. (pgTAP)
- AC-SCR-007 Given a certified 7 and the org on `block`, when a claim line of 8 is created it is refused `CLM_OVER_CAP` with basis surveyed; at 7 it is created; on `warn` it is created. `survey_quantity_for_line` returns 7. (pgTAP)
- AC-SCR-008 Given another organisation, then its records are invisible and its functions refuse (not found). (pgTAP)
- AC-SCR-009 Given a light account, then reads return nothing and every function refuses. (pgTAP)
- AC-SCR-010 Given Viewer/Employee/Procurement roles and a Project Manager of another project, then record and confirm are refused. (pgTAP)
- AC-SCR-011 Document attach: another project's document, a draft-status document and a file-less document are refused; an Issued one with a file is accepted. (pgTAP)
- AC-SCR-012 Given a line with a certified quantity, the claim form shows surveyed and quality-ready beside the line, uses surveyed as the ceiling, warns past quality-ready and past surveyed, and does not block. EN and ID. (RTL)
- AC-SCR-013 The survey list shows rows, hides actions the role lacks with the reason, and the empty state names who records it. EN and ID. (RTL)
- AC-SCR-014 Journey: record a survey, confirm it as another person, open the claim form, type above quality-ready, see the warning. (e2e)
- AC-SCR-015 Every refusal has EN and ID sentences. (`npm run check:guards` refusal gate)

## Settings and defaults
None added. The surveyed ceiling already takes effect for a hard stop only where the organisation chose `block` (part B). On `warn` (default) the surveyed figure sharpens the form warning only.

## Open question for the owner
Should a survey of a line with a confirmed BAST be allowed to exceed the accepted quantity? Built meanwhile: yes (no cross-check); the ceiling takes the surveyed figure as the stronger fact, per the ruling in the job story.

## Not in scope
The BAST flow itself, lump-sum lines (a survey is per unit-rate line; lump-sum is a fraction of one lot), and any change to the work-order value cap.
