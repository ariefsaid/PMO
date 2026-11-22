# Spec: Manpower need, ask for a position and head count, watch it fill from cleared people

**Status:** built. IDs `FR-MPN-###`, `AC-MPN-###`. Plan: `docs/plans/2026-11-22-manpower-request.md`. Scope ruling OD-SCOPE-2 (no client process in code). No on/off setting: on for every organisation. There is no approval step: a need is recorded by those who may write needs and takes effect at once.

## Job story
When a site needs people, I want to record the positions and head counts needed by a date, link the people proposed, and see per need how many were asked, how many are filled (linked and cleared for site), how many are in progress and how many are still open, so the people team knows what is left to do, and so the person who recorded the need hears when it is met or cancelled.

## Today (verified, base fc42e1a0)
- No manpower, staffing or resource request exists (`scripts/prior-art.sh` on manpower, requisition, resource request, staffing, position, trade: nothing for people; those sources only, not proof elsewhere).
- **Clearance progress is reused, not rebuilt.** Cleared-for-site checklist (#2707): `supabase/migrations/1235_clearance_items.sql:12` (organisation-defined items), `1236_person_clearances.sql:5` (per-person state), and the one place "cleared" is computed, `person_clearance_summary()` (`1237_person_clearance_status.sql:36-52`, `person_id, required_count, satisfied_count, cleared`). A need's progress joins that function. The 1236 clearance policies (read: Admin, Project Manager, Finance, Executive) are unchanged.
- **Position list:** no table of positions or labour classes exists on the base. `labour_cost_classes` (`1250_labour_cost_settings.sql`) are cost classes on a rate, not positions. The organisation's list of trades is `cost_disciplines` (`0950_cost_disciplines.sql:7`, glossary "Discipline"), already named by `crews.discipline_id` (`1035:20`). A need's position is a discipline, through the one column `discipline_id`.
- **Authority to write:** `crew_can_manage()` (Admin, Executive, Project Manager; `1035_crews_roster.sql:207`) or a person whose built-in role holds the HR capability `people_documents_view` (`1200`/`1203`, read through `actor_has_role_capability`), which covers the HR manager (Project Manager base) and HR officer (Engineer base). Combined in `manpower_can_manage()`; no existing policy is widened and no role list is hard-coded.
- **Telling people:** the shared needs-you list takes derived-on-read pointers: `my_waiting_billing_steps` -> `summariseWaitingSteps` (`pmo-portal/src/lib/waitingSteps.ts`) -> `waitingBillingSteps` in `buildNeedsItems` (`pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts`). The manpower pointer follows that shape. An outcome notice uses `notify_workflow_user` (`0237_workflow_notifications.sql:13`), which never notifies the acting user.

## Model
- `manpower_needs`: project (required), position (`discipline_id`), head count (1 to 500), needed-by date, optional work order (same project), optional crew, note, status `open | met | cancelled`, creator. A writer changes status: open to met or cancelled and back to open. The screen offers "Mark as met" when nothing is open or in progress.
- `manpower_need_people`: need, person (people register), linked by and at; one row per (need, person).
- `manpower_need_progress()` (security definer, counts only): per need `asked`, `linked`, `filled` (linked and `person_clearance_summary().cleared`), `in_progress` (linked, not cleared), `open_count = asked - linked`. Scoped to callers who can read the need (same organisation, active member: the predicate of `manpower_needs_select`); returns no per-person clearance detail.
- `my_manpower_to_fill()` (security definer): open needs whose `open_count > 0`, for holders of `manpower_can_manage()` only.
- Writes go straight to the tables under RLS and column grants; org stamped by trigger; reads for every active member.

## Requirements (EARS)
- FR-MPN-001 A writer shall create a need for a live project with a live position of the organisation, a head count of 1 to 500 and a needed-by date; it starts `open`.
- FR-MPN-002 The database shall refuse an archived or foreign project, position, crew or person, and a work order that is not of the need's project.
- FR-MPN-003 A writer shall link a person from the register to an open need and unlink them; the database shall refuse a second link of the same person to one need (`MPN_DUPLICATE`), an archived or foreign person (`MPN_PERSON`), more links than the head count (`MPN_FULL`) and a link to a met or cancelled need (`MPN_CLOSED`).
- FR-MPN-004 The database shall report per need asked, linked, filled, in progress and open from one function that reuses `person_clearance_summary()`; filled counts only linked people the checklist says are cleared. The function returns counts only and answers anyone who can read the need, so the people team sees progress without reading any person's checklist; another organisation and a disabled member get no row.
- FR-MPN-005 A writer shall change a need's date, head count (never below the people already linked, `MPN_HEADCOUNT`), note and status; a need is never deleted (cancel it).
- FR-MPN-006 Writers are `manpower_can_manage()` holders; every other active member reads; another organisation sees nothing.
- FR-MPN-007 The Manpower tab of the Crews page shall list needs with progress bars and a clear loading, empty (says what is missing and who adds it), error and filled state; a disabled control says why; strings in English and Bahasa Indonesia; 390 px and 1440 px.
- FR-MPN-008 Every refusal shall have an English and Bahasa Indonesia sentence in the refusals catalogue: `MPN_PROJECT`, `MPN_POSITION`, `MPN_WORK_ORDER`, `MPN_CREW`, `MPN_HEADCOUNT`, `MPN_CLOSED`, `MPN_PERSON`, `MPN_DUPLICATE`, `MPN_FULL`.
- FR-MPN-009 While a need is open with places still to link, every `manpower_can_manage()` holder shall see one pointer in the shared needs-you list (count of such needs, open places in total, earliest needed-by date) linking to the Manpower tab. It is derived on read from `my_manpower_to_fill()`: a need that is met, cancelled or fully linked is absent from the next read, and a person who may not write needs gets no row. English and Bahasa Indonesia strings.
- FR-MPN-010 When a need is marked met or cancelled, its creator shall receive one in-app notice; an update that does not change the status adds none, and the creator is not told about their own action.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MPN-001 | Given a Project Manager, when a need is created with position, head count 3 and a future date, then it is open with org stamped and creator set; an Engineer without an HR role and Finance cannot create; another organisation sees none. | pgTAP |
| AC-MPN-002 | Given an archived or foreign project, position or crew, a work order of another project or a head count over 500, when created, then each is refused. | pgTAP |
| AC-MPN-003 | Given a need of 3, when people are linked, then the fourth is `MPN_FULL`, the same person twice `MPN_DUPLICATE`, an archived or foreign person `MPN_PERSON`, and a met need `MPN_CLOSED`. | pgTAP |
| AC-MPN-004 | Given one required checklist item and a need of 3 with 3 linked, then filled 0, in progress 3; once one person is cleared, filled 1, in progress 2, and an HR officer (Engineer base, HR role) sees the same counts; once that clearance expires, filled 0 again; a disabled member and another organisation get no row. | pgTAP (+ mutation check) |
| AC-MPN-005 | Given head count lowered below the people linked, then refused; raising it works; status can be met, cancelled, reopened; a need cannot be deleted. | pgTAP |
| AC-MPN-006 | Given an Admin, an Executive and an HR officer, then each writes; a plain Engineer and Finance do not. | pgTAP |
| AC-MPN-007 | Given the unlink of a person, then open rises by one and the person can be linked again. | pgTAP |
| AC-MPN-008 | Given the Manpower tab, then loading, empty (names who adds), error with retry and a need card with asked, filled, in progress, open render; controls are absent for a reader; Mark as met is disabled with its reason while places are open; the form offers only the chosen project's work orders and sends no org_id. | Unit (RTL) |
| AC-MPN-009 | Given the en and id dictionaries and refusals catalogue, then every new key and code exists in both. | `check:i18n` |
| AC-MPN-010 | Given a need created by a Project Manager, when another person cancels it, then the creator has one notice; when the creator marks a need met themselves, no notice; a later edit adds none. | pgTAP |
| AC-MPN-011 | Given open needs with places to fill, then `my_manpower_to_fill()` lists them for a writer and an HR officer and returns nothing to an Engineer without an HR role or to Finance; a met or cancelled need leaves the list; the needs-you pointer shows the count, open places and earliest date for any role and is absent without rows. | pgTAP + Unit (`buildNeedsItems`, `summariseManpowerToFill`) |
| AC-MPN-012 | Journey: a manager records a need of two, links two people, one becomes cleared on the checklist, the card shows filled 1, in progress 1, open 0; with both cleared it is marked met. | E2E (`e2e/AC-MPN-010-manpower-need-journey.spec.ts`; file name keeps its first numbering) |

Mutation checks (break the rule, the named test must go red; markers `mut:` in the migrations): count linked as filled regardless of `cleared` (AC-MPN-004); drop the read predicate of `manpower_need_progress` (AC-MPN-004 no-row assertions); drop the head-count cap (AC-MPN-003); drop the same-project work order check (AC-MPN-002); allow every active member to write (AC-MPN-001/006); drop `manpower_can_manage()` or the status filter in `my_manpower_to_fill` (AC-MPN-011); remove the status-change guard of the notice trigger (AC-MPN-010).

## Settings
None. Positions and checklist items are organisation data.

## Known limits
- The outcome notice is plain English, like every 0237 workflow notice (templated, translated notice text is a follow-up).
- The checklist decides "cleared"; where the organisation has no required checklist item nobody counts as filled and every linked person is in progress.
