# Spec: Medical release before rostering again

**Status:** proposed (phase A). IDs `FR-MR-###`, `AC-MR-###`. Plan: `docs/plans/2026-11-22-medical-release.md`. Map: People, crews and time. Scope: OD-SCOPE-12 (leave and sick requests, pulled forward). Executor: Orca worker; approval and the rostering block are enforced in the database (ADR-0019).
**Relates to:** `leave-requests.spec.md`, `crews-roster-attendance.spec.md`, `builtin-role-set.spec.md` (medical documents held by HR Manager, HR Officer, Administrator only; `docs/decisions.md`).

## Job story
When a worker returns after sickness or injury, I want their direct manager to approve the medical release before they can be rostered again, so that nobody is put back on site unreleased; and the worker is told after the decision.

## Today (verified, base land/fix-1122 at fc42e1a0)
- Leave and sick requests exist: `supabase/migrations/1240_leave_requests.sql` (tables `leave_types`, `leave_requests`; `leave_authority` at 1240 §4), `1241_leave_rpcs.sql` (`leave_request_submit`, `leave_request_decide` at :55, `leave_request_cancel`, `leave_on_date` at :156). Whole feature off until `organizations.leave_requests_enabled` (1240 §1, default false). Leave types are organisation data with no "sick" flag and no release step.
- Nothing blocks rostering today. Approved leave is only a roster marker (`leave_on_date`, 1241:156); `leave-requests.spec.md` FR-LV-010 says it never blocks. Placements are `crew_members` and `crew_loans` (`1035_crews_roster.sql:76`, `1245_crew_loans.sql:10`); their only write guards are `guard_crew_refs` (1035:125, crew_members branch :160) and the crew-loan guard (1245), neither of which looks at leave or health.
- "Direct manager" has two columns: `profiles.manager_id` (0007; used by `leave_authority`, 1240 §4, for a person with a login) and `people.manager_id` (0970:11, `people` register incl. workers without a login; used by the expiry-document read policy). `leave_authority` reads only the first.
- Medical content: `expiry_documents.is_medical` + `medical_status` fit/unfit and dates only (0970:61-72). A manager reads only non-medical documents of their reports (policy `expiry_documents_select`, 0970:139). Medical rows are Admin-only on the base.
- Role rule: branch `feat/role-capabilities-one-gate` is NOT merged into `land/fix-1122` (9 commits ahead incl. temporary "mut" commits). It adds `may_see_medical_documents(profile)` / `actor_may_see_medical_documents()` (migration 1535) = Admin level or capability `medical_documents_view` (HR Manager, HR Officer, Administrator). Its migrations are 1530-1540; this item uses 1750-1759, so they do not collide.
- Item text vs code: the base has no notion of a "release", and no per-type way to say a leave type needs one. Both are new.

## Boundary (do not widen)
- A release is a decision (Pending / Approved / Rejected) with decider, time and a short note. It holds NO medical content: no diagnosis, no fit/unfit, no document. Note text guidance says so.
- What the direct manager sees: "release pending / approved / rejected" for their reports. Medical documents stay behind the role rule only. This item adds no read of `expiry_documents` for anyone and does not call or restate the capability gate.
- Compatibility with the role branch: nothing here reads `medical_documents_view`. When that branch merges, a viewer who also holds the capability sees the medical document on the person record as today; the release surface is unchanged. Join cost: none (disjoint migration range and files; only `docs/glossary.md` may textually collide).

## Requirements (EARS)
- FR-MR-001 The system shall let an organisation mark a leave type as "needs a release" (data on the type, default off; PMO ships no type names).
- FR-MR-002 When a request of such a type is approved, the system shall create exactly one release for that request, `Pending`, in the same transaction.
- FR-MR-003 While a person has a release that is not `Approved` and the placement would cover any day after that leave's last day, the database shall refuse a new or changed `crew_members` placement and a new or changed `crew_loans` host placement for that person (code `MR_BLOCKED`). Existing placements and attendance are untouched.
- FR-MR-004 The system shall let only the person's direct manager (`people.manager_id`; if empty, the manager of the linked profile, `profiles.manager_id`) decide the release; where there is no direct manager, the holder of the organisation's leave approver role (Admin while empty) decides.
- FR-MR-005 The system shall refuse a decision by the person, by whoever entered the leave request, or by anyone not named in FR-MR-004, whatever their role including Admin (SoD).
- FR-MR-006 A rejection shall require a note; only `Pending` can be decided; an approval frees rostering for that leave only.
- FR-MR-007 When a release is decided, the system shall notify the worker (where they have a login) with the outcome and next step; a worker without a login is shown the state to the office user who rosters them.
- FR-MR-008 The system shall expose release state to people who roster only as a state word (pending / approved / rejected) via a definer function, never the note or any document; the release table is readable by the person, their direct manager and the approver role only.
- FR-MR-009 A person who tries to roster a blocked worker shall be told in English and Bahasa Indonesia what to do next (ask the direct manager to approve the release), through the refusals catalogue.
- FR-MR-010 The release shall appear on the shared waiting/needs-you list for the person who must act (the direct manager).
- FR-MR-011 Screens work at 390 px and 1440 px, use shared primitives and `DESIGN.md` tokens, English and Bahasa Indonesia; a disabled roster control says why; empty lists say what is missing and who adds it.
- FR-MR-012 Org scoped (RLS), `org_id` stamped by trigger, writes only through the RPC.

## Setting and the behaviour-change rule
Blocking rostering changes behaviour for organisations already rostering returning workers. No on/off switch is added; instead the change is carried by FR-MR-001: the flag `leave_types.requires_release` defaults false, so no existing organisation, type or request changes until an admin marks a type. That meets "default keeps today's behaviour". The leave feature itself stays behind its existing `leave_requests_enabled` (FR-LV-014). Recommendation: per-type flag, no org-level setting. Open question filed (below).

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MR-001 | Given a type not marked, when its request is approved, then no release exists and rostering is as today. | pgTAP |
| AC-MR-002 | Given a type marked, when its request is approved, then one `Pending` release exists (not twice on re-decide). | pgTAP |
| AC-MR-003 | Given a pending release, when anyone (office, PM, Admin) inserts or moves a placement or loan reaching past the leave end, then refused `MR_BLOCKED`; a placement ending on or before the leave end, and one for another person, is allowed. | pgTAP + mutation check (drop the guard; must go red) |
| AC-MR-004 | Given the direct manager (either manager column), when they approve, then status `Approved` with decider and time and rostering is allowed. | pgTAP |
| AC-MR-005 | Given the worker, the enterer, an unrelated Admin with a direct manager set, or a peer, when they decide, then refused; Admin with no direct manager may decide unless they are the person/enterer. | pgTAP + mutation check |
| AC-MR-006 | Given a rejection with no note, refused; with a note, `Rejected` and rostering stays blocked; a decided release cannot be decided again. | pgTAP |
| AC-MR-007 | Given a decision, then the worker with a login has a notification with the outcome; none for a worker without a login. | pgTAP |
| AC-MR-008 | Given the direct manager and a roster user without the role rule, when they read, then they get a state word only; neither can read the person's medical rows; a stranger in another org reads nothing. | pgTAP |
| AC-MR-009 | Given a blocked placement attempt, when refused, then the roster screen shows the catalogue sentence (EN and ID) and the next step. | Unit (refusals) |
| AC-MR-010 | Given a pending release, the direct manager sees it on the waiting list and can approve or reject with a note; a non-manager sees no buttons and the reason. | Unit + one e2e journey |

Mutation plan: (1) make the guard return early -> AC-MR-003 red; (2) set the authority check to true -> AC-MR-005 red; (3) let `leave_request_decide` skip the release insert -> AC-MR-002 red.

## Open questions (customer; recommended answer first)
1. Does a rejected release hold rostering until a new decision, with an Admin override? Recommend: it holds; the manager can decide again (rejected -> approved is allowed once, audited) and there is no override.
2. May the manager release before the leave end date? Recommend: yes, from the day the leave is approved.
3. Should an organisation that wants every sick return gated mark all sick types, or be given a PMO-shipped "sick" type? Recommend: the admin marks the types (PMO ships no type names).
