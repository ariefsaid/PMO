# RFI and submittal loops: who holds it, when it is due (RSL)

Issue #1581 (map #1481). Source: the 2026-10-31 competitor review §3b (held privately) and gap 9 of
`docs/roadmap-spines.md:124`. Status: **draft for owner sign-off.** Size M. Executor on sign-off: an
Orca worker (bounded DB + FE slice); it touches the document SoD RPC, so security-auditor depth is on the
RPC change.

**Job story.** When my project has a question out to the client or engineer-of-record, or a submittal
waiting on their approval, I want to see at a glance who holds each one and when the answer is due, so
an unanswered item never silently delays the work and I can chase the right party before it is late.

## Prior art (read before building)

| Existing thing | Where | What this spec does with it |
|---|---|---|
| Project document register `project_documents` (code, category, title, revision, status, author) | `supabase/migrations/0001_init_schema.sql:243-256` | **Reused** as the RFI/submittal record. No new top-level entity. |
| Status enum `Draft, Issued, Approved, Rejected, Closed` + `Superseded` | `0001_init_schema.sql:26`, `0024_document_superseded_enum.sql:5` | **Reused unchanged.** RFI/submittal steps map onto it (§States). |
| `transition_document_status` — sole writer of status; legal map; role gate; approver≠author SoD | current body `supabase/migrations/0342_evidence_binding.sql:62-92` (map 75-78, role gate 86, SoD 92); column lock `0017_doc_sod_delete_audit_hardening.sql:102-105` | **Reused** as the only transition path. Extended to stamp the loop fields (holder, response) in the same transaction. |
| Revision lineage `parent_document_id` + auto-Superseded on a new revision | `0025_document_file_upload.sql:12-16`, `0342_evidence_binding.sql:57-60` | **Reused** for "revise and resubmit": the resubmission is a new revision; the old row goes Superseded. |
| Category list (has `Submittal`, no `RFI`) | `pmo-portal/src/lib/documentCategories.ts:2-10` | `RFI` **added**; the prototype had it (`pmo-portal/types.ts:229`). |
| Document register UI, filter by category/code | `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx:81,140-177` | **Reused**; gains holder + due columns and an "Open loops" filter. |
| DAL / transition call | `pmo-portal/src/lib/db/documents.ts:118-131` (create, free-text `code`), `:227-245` (transition) | **Reused**; create of an RFI/submittal stops sending `code` (server mints it). |
| Reference-number minter (OD-PROC-3, extended by ADR-0033) | `docs/decisions.md:64-72`; `next_procurement_doc_number` `0006_procurement_lifecycle.sql:104-122` | **Reused**: two new prefixes `RFI-` and `SUB-`, same format, same internal-only grant. |
| Workflow hand-off notifications `notify_workflow_user` | `supabase/migrations/0237_workflow_notifications.sql:13-25`; table `0048_agent_automations_notifications.sql:67-79`; DAL `pmo-portal/src/lib/db/notifications.ts` | **Reused** for "it is now with you" and "response received" notices. |
| Person reminder ledger (sender-capped, reuses `notify_workflow_user`) | `supabase/migrations/0442_task_reminders.sql:1-3,115` | Pattern reference for a later manual "chase" (out of scope v1, OQ-4). |
| Document preview (#1474, ADR-0095): one in-app viewer for stored and Microsoft-linked files | `docs/adr/0095-document-preview-and-bounded-file-upload.md`; `supabase/migrations/0409_document_preview_sources.sql` | **Reused as is**: a submittal's file and an RFI's attachments open in the shipped viewer. Nothing new. |

**What is new:** one 1:1 extension table for the loop fields (due date, who it is with, question,
response); the `RFI` category; two minter prefixes; holder stamping inside the existing transition RPC; two
notification triggers; the register's holder/due/overdue display. Nothing else.

## Scope

- RFI and submittal records on a project, numbered by the server, each with a due date and a holder.
- Holder ("ball in court") derived from the status plus the assigned responder, never typed by hand.
- Overdue computed at read time; shown in the register and countable per project.
- In-app notification when an item moves to someone, and when its response is recorded.
- Revise-and-resubmit through the existing revision lineage.

## Non-scope

- External-party log-in or portal; external parties never touch PMO in v1 (OQ-1).
- Email out of PMO; transmittal packaging of several documents (a later transmittal issue).
- Scheduled overdue sweeps or escalation chains (OQ-4); cost/schedule impact fields on an RFI (OQ-6).
- New status enum values or a second state machine.

## Terms

- **Loop item** — a `project_documents` row whose category is `RFI` or `Submittal`.
- **Responder** — who must answer: an internal active member (`responder_id`) **or** an external
  company from `companies` (`responder_company_id`), exactly one.
- **Holder** — who the item is waiting on right now (derived, §States).
- **Due date** — the date the response is owed; a calendar date in the org's time zone.

## States and transitions (reused enum; no new statuses)

| Status | RFI reads as | Submittal reads as | Holder | Due date |
|---|---|---|---|---|
| Draft | Being written | Being prepared | Author | Not running |
| Issued | Asked, awaiting answer | Submitted for review | Responder | Running; overdue when today > due |
| Approved | Answered | Approved (or approved as noted) | Author (to close) | Stopped; `responded_at` stamped |
| Rejected | Returned (unclear / incomplete) | Revise and resubmit | Author (to revise) | Stopped; `responded_at` stamped |
| Closed | Closed | Closed | Nobody | — |
| Superseded | — | Replaced by a newer revision | Nobody | — |

Legal moves are exactly the shipped map (`0342_evidence_binding.sql:75-78`): Draft→Issued;
Issued→Approved|Rejected; Approved→Closed; Rejected→Draft|Closed. A resubmission is a new revision row
(`parent_document_id` set), which starts at Draft with its own due date; issuing it supersedes the parent.

## Functional requirements (EARS)

- **FR-001** The system shall offer `RFI` as a document category alongside the existing `Submittal`.
- **FR-002** When a loop item is created, the system shall mint its `code` server-side as
  `RFI-YYMMDD####` or `SUB-YYMMDD####` through `next_procurement_doc_number` (OD-PROC-3 format), and shall
  ignore any client-supplied code for that item.
- **FR-003** When a loop item is revised, the new revision shall keep the parent's `code` and take the next
  `revision` value, so one number identifies the item across its resubmissions.
- **FR-004** The system shall store for each loop item exactly one responder (internal member or external
  company), a due date, and for an RFI a question text.
- **FR-005** When a loop item moves Draft→Issued, the system shall require a responder and a due date not
  earlier than the issue date, and shall reject the move otherwise (P0001, named field).
- **FR-006** While a loop item is Issued, the system shall show the responder as its holder; in Draft,
  Approved or Rejected it shall show the author; in Closed or Superseded it shall show none.
- **FR-007** While a loop item is Issued and today (org time zone) is after its due date, the system shall
  mark it overdue and show the number of days overdue; it shall never mark an item overdue in any other
  status.
- **FR-008** When a loop item moves Issued→Approved or Issued→Rejected, the system shall record the response
  text (required for an RFI, optional note for a submittal), who recorded it and `responded_at`, in the same
  transaction as the status change.
- **FR-009** Where the responder is internal, the response shall be recorded only by that responder or a
  write-role who is not the author (existing SoD, `0342_evidence_binding.sql:92`).
- **FR-010** Where the responder is external, a write-role (including the author, subject to OQ-2) shall
  record the response received, with the date it was received; the record shall name the external company.
- **FR-011** When a loop item moves to Issued with an internal responder, the system shall notify that
  responder in-app; when its response is recorded, the system shall notify the author — both through
  `notify_workflow_user`, never notifying the actor.
- **FR-012** The project document register shall show holder, due date and overdue state for loop items,
  and offer an "Open loops" filter (Issued items, overdue first, then by due date).
- **FR-013** When the due date of an Issued item is changed, the system shall write the old and new date to
  `audit_events` (table from `0076_audit_events.sql`; this write is new), so a slipped deadline stays visible.
- **FR-014** A loop item's file and attachments shall open in the shipped document viewer (ADR-0095); this
  spec adds no preview path.

## Non-functional requirements

- **NFR-001 Tenancy.** The extension table carries `org_id` stamped by the existing trigger
  (`0074_org_id_stamp_trigger.sql`), a composite FK to `project_documents (id, org_id, project_id)`, and a
  `responder_company_id` / `responder_id` that must belong to the same org (FK or trigger check).
- **NFR-002 RLS.** RLS enabled and forced; select is in-org (as `project_documents_select`,
  `0002_rls.sql:111`); no direct client write to holder, response or `responded_at` columns — those are
  written only by the transition RPC, as `status` is today (`0017_doc_sod_delete_audit_hardening.sql:94-105`).
  pgTAP proves cross-org read and write are denied.
- **NFR-003 Role gating.** Create, edit, issue and record use the same write-roles as the register
  (`0342_evidence_binding.sql:86`) unless OQ-3 widens it; the FE gates every affordance with `can()` on the
  real JWT role; RLS/RPC is the authority.
- **NFR-004 Numbering.** The minter stays internal-only (not granted to `authenticated`,
  `0006_procurement_lifecycle.sql:120-122`); codes are unique per org; concurrent creates never collide.
- **NFR-005 Overdue is derived.** No stored overdue flag and no scheduled job; overdue is computed from
  `due_date`, status and the org time zone at read, so it is never stale.
- **NFR-006 Reversible.** One additive migration with a rollback file; no existing document row changes.
- **NFR-007 UI.** Screen rules (`docs/ux/screen-rules.md`) and DESIGN.md tokens; overdue is shown by text
  and an icon, not colour alone; `scripts/ux-proof.sh` clean on the project Documents route.

## Acceptance criteria (Given / When / Then) and owning layer

| AC | Criterion | Owning layer |
|---|---|---|
| AC-001 | Given a PM on a project, When they create a document with category RFI, Then the saved row's code matches `RFI-YYMMDD####` and any code they typed is ignored. | pgTAP |
| AC-002 | Given an RFI in Draft without a responder or due date, When it is issued, Then the move is refused with P0001 naming the missing field and the status stays Draft. | pgTAP |
| AC-003 | Given a submittal issued to an external company, When the register loads, Then its holder reads as that company and its due date is shown. | Unit (RTL) |
| AC-004 | Given an Issued item whose due date was yesterday (org TZ), When the register loads, Then it shows "1 day overdue"; Given the same item Approved, Then no overdue mark shows. | Unit (holder/overdue derivation) |
| AC-005 | Given an RFI issued to an internal member, When it is issued, Then that member gets one in-app notification and the issuer gets none. | pgTAP |
| AC-006 | Given an Issued RFI with an internal responder, When its author tries to record the answer, Then the RPC refuses with 42501 (SoD) and nothing is stamped. | pgTAP |
| AC-007 | Given an Issued RFI, When the responder records an answer, Then status, answer, recorder and `responded_at` change together and the author is notified. | pgTAP |
| AC-008 | Given a submittal returned Rejected, When the author creates a revision and issues it, Then the revision keeps the code, takes the next revision, and the parent is Superseded. | pgTAP |
| AC-009 | Given a user in another org, When they read or write a loop row by id, Then no row is returned and the write is denied. | pgTAP |
| AC-010 | Given a direct client update of holder/response columns, When it is sent, Then it is denied (column privilege) and only the RPC path changes them. | pgTAP |
| AC-011 | Given a PM, When they raise an RFI to the client, record the client's answer and close it, Then the register's "Open loops" filter no longer lists it and the record shows the answer. | E2E (one curated journey) |
| AC-012 | Given the due date of an Issued item changes, When the audit trail is read, Then the old and new dates are both present. | pgTAP |
| AC-013 | Given a role without write access, When they open the register, Then create/issue/record controls are absent. | Unit (RTL, `can()`) |

## Owner questions (each with a recommended default)

1. **External parties.** Are responders outside the org only recorded (internal user transcribes the
   reply), or do they need their own access later? *Default: recorded only in v1; a portal is a separate issue.*
2. **Author recording an external reply.** May the author record the client's answer to their own RFI
   (the decision is the client's, not theirs)? *Default: yes for external responders only, with the
   received date and company stamped; internal responders keep strict approver≠author.*
3. **Engineers.** Should the Engineer role raise RFIs and answer ones assigned to them? Today only
   Admin/Executive/PM/Finance write documents. *Default: yes, for loop items only; other documents unchanged.*
4. **Reminders.** In-app notice on hand-off and response only, or also a reminder when an item becomes
   overdue (needs a scheduled job) or a manual "chase" like the task reminder? *Default: hand-off + response
   in v1; manual chase next; no scheduled sweep.*
5. **Numbering format.** Org-wide daily-reset `RFI-YYMMDD####` (consistent with every other minted number),
   or per-project sequential `RFI-<project>-001`, which many EPC contracts specify? *Default: the OD-PROC-3
   format; per-project numbering only if a contract requires it.*
6. **Default due period and impact fields.** Should issuing pre-fill a due date (e.g. 7 or 14 days) and
   should an RFI carry cost/schedule-impact flags? *Default: no pre-fill; impact flags deferred.*
7. **"Approved as noted".** Is a distinct approved-with-comments outcome needed for submittals, or is
   Approved plus a response note enough? *Default: Approved plus note (no enum change).*
