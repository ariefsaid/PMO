# Spec: Manpower need, ask for a position and head count, watch it fill from cleared people

**Status:** proposed, simplified by steering (one table of needs, no approval engine). IDs `FR-MPN-###`, `AC-MPN-###`. Plan: `docs/plans/2026-11-22-manpower-request.md`. Scope ruling OD-SCOPE-2 (no client process in code). No on/off setting: on for every organisation.

## Job story
When a site needs people, I want to record the positions and head counts needed by a date, link the people proposed, and see per need how many were asked, how many are filled (linked and cleared for site), how many are in progress and how many are still open, so the people team knows what is left to do.

## Today (verified, base fc42e1a0)
- No manpower, staffing or resource request exists (`scripts/prior-art.sh` on manpower, requisition, resource request, staffing, position, trade: nothing for people; those sources only, not proof elsewhere).
- **Clearance progress exists and is reused, not rebuilt.** Cleared-for-site checklist (#2707): `supabase/migrations/1235_clearance_items.sql:12` (organisation-defined items), `1236_person_clearances.sql:5` (per-person state), and the one place "cleared" is computed, `person_clearance_summary()` (`1237_person_clearance_status.sql:36-52`, security invoker: `person_id, required_count, satisfied_count, cleared`). Spec `docs/specs/cleared-for-site-checklist.spec.md`. The need's progress joins this function; nothing recomputes "cleared". Read access to it is Admin, Project Manager, Finance, Executive (`1236` policies); the spec says HR roles extend it later. Where the caller cannot read clearances, linked people show as in progress, never as filled (stated, not hidden).
- **Position list:** no table of positions or labour classes exists on the base. `labour_cost_classes` (`1250_labour_cost_settings.sql`) are cost classes on a rate (direct/indirect/guard), not positions; the rate's "role" is the access role (`role_key = pr.role`, `1250:98`). The only organisation-kept list of trades is `cost_disciplines` (`0950_cost_disciplines.sql:7`, glossary "Discipline"), already named by `crews.discipline_id` (`1035:20`). A need's position is a discipline. No parallel position-by-rate work has landed on any lane branch yet; if one introduces a different list, the need's one FK `discipline_id` is the single swap point.
- **Authority to write:** `crew_can_manage()` (Admin, Executive, Project Manager; `1035_crews_roster.sql:207`) and the people-register editors (Admin, Project Manager, `1035:58`). HR roles of the built-in role set (`docs/specs/builtin-role-set.spec.md`, hr_manager at Project Manager base, hr_officer at Engineer base) hold the capability `people_documents_view` (`1200`/`1203`, `actor_has_role_capability`). Writers = `crew_can_manage()` or that HR capability. No existing policy is widened and no role list is hard-coded.
- The earlier approval-chain design is dropped (steering): no approver, no segregation-of-duties RPC, no notifications.

## Model
- `manpower_needs`: project (required), position (`discipline_id`), head count (1 to 500), needed-by date, optional work order (same project), optional crew, note, status `open | met | cancelled`, created by and at. Status is set by a writer: open to met to cancelled and back to open; the screen offers "Mark as met" when nothing is open or in progress.
- `manpower_need_people`: need, person (people register), linked by and at. One row per (need, person).
- `manpower_need_progress()` (security invoker function): per visible need `asked`, `linked`, `filled` (linked and `person_clearance_summary().cleared`), `in_progress` (linked, not cleared), `open_count = asked - filled - in_progress`.
- Writes by direct table access under RLS with column grants; org stamped by trigger; reads for every active member.

## Requirements (EARS)
- FR-MPN-001 A writer shall create a need for a live project with a live position of the organisation, a head count of 1 to 500 and a needed-by date; it starts `open`.
- FR-MPN-002 The database shall refuse an archived or foreign project, position, crew or person, and a work order that is not of the need's project.
- FR-MPN-003 A writer shall link a person from the register to an open need and unlink them; the database shall refuse a second link of the same person to one need, an archived person, and more links than the head count (`MPN_FULL`).
- FR-MPN-004 The database shall report per need asked, filled, in progress and open from one function that reuses `person_clearance_summary()`; filled counts only linked people the checklist says are cleared.
- FR-MPN-005 A writer shall change a need's date, head count (never below the people already linked), note and status; a need is never deleted (cancel it).
- FR-MPN-006 Writers are `crew_can_manage()` or a holder of the HR capability; every other active member reads; another organisation sees nothing.
- FR-MPN-007 The Manpower page shall list needs with progress bars, a clear loading, empty (says what is missing and who adds it), error and filled state, disabled controls say why; strings in English and Bahasa Indonesia; 390 px and 1440 px.
- FR-MPN-008 Every refusal shall have an English and Bahasa Indonesia sentence in the refusals catalogue: `MPN_FULL`, `MPN_PERSON`, `MPN_DUPLICATE`, `MPN_PROJECT`, `MPN_POSITION`, `MPN_WORK_ORDER`, `MPN_CREW`, `MPN_HEADCOUNT`, `MPN_CLOSED`.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MPN-001 | Given a Project Manager, when a need is created with position, head count 3, a future date, then it is open with org stamped and creator set; Engineer and Finance cannot create; another organisation sees none. | pgTAP |
| AC-MPN-002 | Given an archived or foreign project, position or crew, or a work order of another project, when created, then each is refused (`MPN_*`). | pgTAP |
| AC-MPN-003 | Given a need of 3, when people are linked, then the fourth is `MPN_FULL`, the same person twice `MPN_DUPLICATE`, an archived or foreign person `MPN_PERSON`; linking to a cancelled or met need is `MPN_CLOSED`. | pgTAP |
| AC-MPN-004 | Given one required checklist item and a need of 3 with 2 linked, one of whom has the item done, then asked 3, filled 1, in progress 1, open 1; once the other is done, filled 2, in progress 0, open 1; once its expiry passes, filled 1 again. | pgTAP (+ mutation check) |
| AC-MPN-005 | Given head count lowered below the people linked, then refused (`MPN_HEADCOUNT`); status can be met, cancelled, reopened by a writer. | pgTAP |
| AC-MPN-006 | Given an HR officer (Engineer base, HR role) and an Admin, then both write; an Executive writes via `crew_can_manage`; a plain Engineer and Finance do not. | pgTAP |
| AC-MPN-007 | Given the unlink of a person, then filled or in progress drops and the person can be linked again. | pgTAP |
| AC-MPN-008 | Given the Manpower page, then loading, empty (names who adds), error with retry and a need card with asked, filled, in progress, open render; controls are absent for a reader and say why. | Unit (RTL) |
| AC-MPN-009 | Given the en and id dictionaries and refusals catalogue, then every new key and code exists in both. | Unit + `check:i18n` |
| AC-MPN-010 | Journey: a manager records a need of two, links two people, one becomes cleared on the checklist, the need shows filled 1, in progress 1, open 0, then both cleared and Mark as met. | E2E (one, `e2e/AC-MPN-010-manpower-need-journey.spec.ts`; written, run by the wave) |

Mutation checks (break the rule, the named test must go red): ignore expiry via a copy of the cleared rule is not possible here because the rule is reused, so instead: count linked as filled regardless of `cleared` (AC-MPN-004); drop the head-count cap (AC-MPN-003); drop the same-project work order check (AC-MPN-002); allow every active member to write (AC-MPN-001/006).

## Settings proposed
None. Everything is organisation data (positions, checklist items).

## Open for the customer (recommended answer)
1. Is the Cost disciplines list the right list of positions? Recommended: yes; the Admin adds missing ones there.
2. Should a person ever count as filled before the checklist says cleared? Recommended: no (steering).
Known limit: until the checklist is read-extended to HR roles, an HR officer sees linked people as in progress.
