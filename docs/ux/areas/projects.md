# Projects list + creation — #806, phase 2 / area 2
Mode: Operate; apply [Impeccable lane map](../impeccable-map.md). Builder proposal under [OD-VISUAL-RESET / OD-REDESIGN-SCOPE](../../decisions.md) and [UX-STANDARD](../UX-STANDARD.md); adopt [shell frame](shell.md). Keep ADR-0068 colours, fonts, radii, every feature and route; rendered owner approval decides composition.
Current render-order blocks, role gates, EN/ID sources, source critique, skill evidence and exact test disposition: [inventory](projects-inventory.md), baseline `123d2ec9`. This is docs only; no rendered pass is claimed.
## Jobs and first-screen answers — PA-01
| Role | `/projects` job | `/projects/new` job |
|---|---|---|
| PM | Find delivery work needing attention. | Record a project's business context once. |
| Admin | Find and maintain the right project. | Establish a project with its owner and identifiers. |
| Executive | Find projects requiring portfolio judgment. | Originate a project for follow-through. |
| Finance | Find a project's trustworthy spending context. | Return to Projects from the unavailable capture route. |
| Engineer | Find projects containing assigned work. | Return to assigned projects from the unavailable capture route. |
List asks “Which project in this scope needs my attention, and how do I open it?”; capture asks “Which project am I recording, for whom, and what must I supply before creating it?” Keep role and write gates; Engineer defaults to task-assigned My Projects, others All.
## `/projects` — collection composition
Order: shell top bar → content breadcrumb → one Projects h1 → scope line (on-hand/internal, current subset and result count) → toolbar → one abnormal-data note if needed → selected view. Replace the permanent Pipeline disclaimer with a quiet Pipeline link in scope; no KPI tiles or duplicate count bands (PA-02–04).
Toolbar: search → status scope + Filters → visible sort → view → More actions → one filled New project for permitted roles (C-01, A-01/02). At 1440 wrap by group without CSS/DOM reordering; secondary controls never displace results. Keep all four view values and existing URLs; a view chooser is not section tabs (N-03/04).
Use a collection-local frame or opt-in toolbar-primary slot in ListPage; render the same toolbar shell in loading/error/empty, without the second empty-state creation button. Shared defaults on other collections stay unchanged. Extend project-only card composition/optional context slots for end customer and expected end; preserve shared Sales behavior.
Filters holds customer, end customer, PM (except Engineer) plus service line, sector, award type, bidding entity, location; one applied-filter summary with individual remove and Clear filters replaces separate classification/customer summaries; classification-only reset stays inside Filters. Keep option retry, debounce cancellation, unavailable selections and focus return.
More actions retains Export of the filtered set, Import projects and Import budgets with existing permissions; keep wizard mounted while open. Name links open canonical `/projects/:id`; customer links, edit modal, archive confirmation and return URL/scroll remain (C-05, N-02/04).
Default sort label: “Budget risk first, then expected end”; confirmed risk first, dated expected end ascending within each risk group, undated last, name then ID ties. Offer expected-end and name sorts; persist sort in URL, retain role-default subset on clear (C-03). This is a target addition; current sort is risk-first only.
Table columns: Project (display name, customer/end customer and references) → PM (readable name) → Status / expected end → Delivery → Contract with tax basis → Actual → Budget used → permitted row actions. Customer context stays beside identity, decision date precedes amounts; retain resize and export identities/currency (C-04/05).
Cards: identity + customer/end customer → status / expected end → delivery → grouped Contract / Active budget / Actual / Budget used → PM + quiet Edit. References stay behind named disclosure; remove repeated initial tiles and empty footer bands, not identity data (PA-03/04). Each amount appears once; full currency amounts remain readable (S-05).
Board: retain five lifecycle columns and counts, read-only opening, keyboard/stage navigation; within each column use active sort. Header owns lifecycle status: remove repeated per-card status pill; card keeps identity/customer/references, expected end, contract + tax basis and PM. No drag transition is introduced (PA-04).
Calendar: month title + Previous/Next/Today → month grid at desktop / chronological dated agenda on phone → local no-events explanation. Preserve starts, ends, phase targets and their canonical record links; label event kind in EN/ID. Month URL and return context remain; no duplicate month heading.
Empty portfolio: explain projects appear when created or won; retain the toolbar's sole New project, with permission-aware guidance for readers. No match: preserve controls + Clear filters; Board/Calendar use the same no-match state before view rendering. Known no-risk: “No confirmed budget-risk signals”; unassessed data is not assurance. Calendar with matching projects but no dates this month keeps month navigation (C-02).
Loading keeps frame/headers and selected-view geometry; list failure has Retry, option failure stays in Filters, delivery/money failures preserve other evidence. Spell out Unavailable, No phases yet, No active budget and known zero distinctly; never manufacture zero bars or risk from unknown/partial/restricted/mismatched-currency data (C-06, S-03).
One abnormal-data note above the selected view names affected scope, reason and useful retry/review action; no repeated coverage/freshness prose on rows/cards. Per-value unavailable labels remain. No new chart; delivery/budget bars keep form under filters/sort; any later controlled figure must keep plot/axes/legend/footprint across its own controls (S-01–04).
```text
1440 | shell top bar: Projects / search / notifications / account           |
     | breadcrumb | Projects h1 | scope + count + Pipeline                 |
     | Search | scope/Filters | Sort | View | More | [New project]          |
     | one abnormal note; TABLE rows / CARDS / BOARD columns / MONTH grid  |
390  | shell bar | breadcrumb | Projects h1 | scope                        |
     | Search | scope + Filters | Sort + View + More | [New project]       |
     | note if needed; first project row / board stage / dated agenda      |
```
## `/projects/new` — capture composition
Shell top bar → Back to Projects/breadcrumb → one New project h1 → origin scope and concise creation consequence → Identity/customer group → Ownership/schedule group → Estimate/tax group → optional Classification disclosure → Cancel + sole filled Create project after evidence (PA-02, A-01–04, E-01–04).
Identity groups project name, client, proposed editable PMO number, short name, client code, end customer and origination stage (Leads/Internal only). Put required name/client/number first; explain a Lead opens in Pipeline. Ownership groups PM + expected start/end. Merge tax rate/DPP/basis/amount with estimate; reveal required tax fields when value requires them, never behind optional disclosure.
Origin scope describes the validated initiating Projects subset/view; an unambiguous selected client seeds the editable client field. Direct entry says workspace scope and selected origination stage, with no invented source/customer; keep the named Projects return fallback. List-return state survives successful record replacement (N-02/04, E-01).
Classification is a named disclosure with a summary of entered values; keep all five fields and retained values on collapse. Remove duplicate “Create a project” subtitle; use that scope line for origin/stage consequence. Keep full-width content track, compact field groups, no empty side panel or separate summary of entered facts (PA-03/04).
Required/optional labels, currency/date meaning, proposal loading/error/duplicate, numeric/tax errors, linked error summary and adjacent disabled reason remain visible; expand a disclosure containing an error. Preserve values, pending state, one successful write, record URL replacement, ERP-pending outcome and dirty Stay/Leave guard (E-02/04, S-03).
```text
1440 | shell top bar | Back to Projects | New project h1 | origin scope    |
     | Identity/customer [name | client] [PMO number | stage] [other IDs] |
     | Ownership/schedule [PM | start | end] | Estimate + conditional tax  |
     | > Classification | Cancel [Create project]                         |
390  | shell bar | Back to Projects | New project h1 | origin scope       |
     | Project name | Client | PMO number + proposal state | Stage        |
     | other identity; PM/dates; estimate/tax; > Classification           |
     | Cancel [Create project] (after fields, safe-area clearance)        |
```
## Phone and builder acceptance
At 390×844 list first screen shows scope, search/narrowing, sort/view/action access and first result; controls and chips wrap in C-01 order, never clip page. Table/Cards become single-column project rows retaining identity, status/date, key amount + open action; other evidence uses named row disclosure. Board keeps contained stage scrolling/jump controls; Calendar becomes dated rows. Capture first screen shows required identity and proposal state; fields stack, long names/ID labels wrap; submission never overlays last field or keyboard.
- [ ] Static baseline: `.claude/skills/impeccable/scripts/impeccable detect pmo-portal/pages pmo-portal/components pmo-portal/src/components/ui --json` → `[]`, **0 findings, 0 advisories**, exit 0; this does not prove rendered compliance.
- [ ] Screenshot the [compact route × state manifest](projects-inventory.md#screenshot-manifest): all four views, scope/role differences, empty/no-match/unknown/loading/error, capture/disclosures/validation/pending/leave/success pairs at 1440/390, EN/ID and light/dark; use synthetic data only.
- [ ] Verify PA-01–04, N-01–04, A-01–04, E-01–04, C-01–06, S-01–05, L-01/02; one h1, unchanged tokens, no page overflow, phone targets ≥44×44, axe serious/critical = 0 and empty Impeccable rendered findings; owner reviews rendered evidence.
- [ ] Follow [test disposition](projects-inventory.md#test-disposition): delete only named look assertions on recomposition; keep behaviour, a11y, role, money, locale, return, imports, month and resize proofs. This docs task deletes no tests.
