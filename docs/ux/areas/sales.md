# Sales pipeline — #806 phase 2 / area 5
Mode: Operate. PA-00 first: [persona × route jobs](sales-inventory.md#pa-00-route-jobs); retain `/sales` as a collection, merge the record job into canonical Projects. [Inventory](sales-inventory.md) records current blocks, EN/ID sources, decisions, captures and test disposition against `d18ba06b`.
Authority: OD-VISUAL-RESET, OD-REDESIGN-SCOPE and amended OD-ROUTE-JTBD in [decisions](../../decisions.md); [UX-STANDARD](../UX-STANDARD.md), [shell frame](shell.md), [PRODUCT](../../../PRODUCT.md). Existing DESIGN.md colours/fonts/radii only; no data/schema deletion. Rendered owner approval remains required.
## PA-00 decisions
Keep search, stage/scope/classification, board/table and export: find the deal needing follow-up, inspect its evidence, then open its project. Admin/Executive/PM can create; Finance reviews; Engineer gets recovery to their dashboard, never a pipeline imitation.
RETIRED: Sales board's empty Won column (its supplied rows are open ∪ lost); won work remains in `/projects` and `/projects/:id`. MERGED: stage navigation into one toolbar filter, repeated card stage into its column heading, and summary/forecast into one optional disclosure. RETIRED: separate Sales record composition; `/sales/:id` remains a replace redirect to `/projects/:id`. Reasons and retained homes: [decision ledger](sales-inventory.md#retire-and-merge-ledger).
## `/sales` — target whole-page composition
PA-01/02: shell return/breadcrumb → h1 Sales Pipeline → scope (selected deal set; active filters) → toolbar → optional summary → collection/state. One content track; no KPI tile row, sidebar or empty companion band (PA-03/04).
C-01 toolbar: Search projects → Open/Lost/Needs attention → Stage (open stages only) → Classification disclosure → Sort → Board/Table (desktop) → Export (secondary) → New project (sole filled primary, eligible roles only; A-01/02). At 390, Search first; scope/stage follow; Classification + Sort share a wrapped row; creation ends toolbar; export lives in named More actions. No phone view switcher.
C-03: visible default “Oldest activity first”; missing activity first with “Activity unavailable”, then ascending last update, project name and stable ID as ties. Apply within each board stage and to table/phone list; offer “Newest activity first”. Preserve working-set sort/filter/view in URL (N-04); never invent a deadline or call last update a customer contact.
C-04/05: table = Project (open link; short/contractual identity and codes) → Customer/end customer → Owner → Stage → Last activity → Value + currency/tax basis → Win % → Weighted. Weighted is optional via named column disclosure, retained in export; decided rows say “Not applicable” for probability/weighted. Actions remain separate from open link; no bulk workflow is introduced.
Board defaults to five open-stage columns; Lost scope shows the terminal Lost/Declined group; Needs attention groups matching open/lost deals. All controls narrow the same records in every presentation; selecting a stage sets Open. Keep stage counts once in headers and distinguish Lost/Declined outcomes; omit repeated stage pills inside grouped cards. Board cards = open identity → customer → owner/activity → exact value/basis + win probability for open deals. Phone is a vertical list with stage text once per ungrouped row (C-06/S-01).
“Pipeline summary” disclosure holds the five-stage figure + one weighted forecast, explicitly “All open projects; before list filters”. Keep stage order, axes/bar form, labels and footprint through list controls, language/theme and refresh; no conversion-rate funnel illusion (S-02). Figure is read-only; stage selection belongs to the toolbar. At 390 the same figure scrolls locally only when expanded, below the first deal list; never replaces the list.
S-03/04/05: exact amounts use each record's currency and basis; mixed-currency aggregates say “Not available”. One abnormal-condition note names affected summary scope and says to inspect individual project amounts; do not add currencies or substitute missing data with zero. Missing owner/activity/probability is named; known empty stages alone show zero. No repeated tooltip-only caveats.
C-02/06 + /onboard: neither open nor lost records = “No projects yet” + brief tracking purpose; the sole New project action remains in toolbar for permitted roles, Finance gets “Ask a project manager to add a project”. Existing records excluded by filters = “No matching projects” + Clear filters. A genuinely empty Lost or attention scope names that scope; do not claim there are no projects. Loading keeps toolbar/row geometry; failures offer Retry; partial lost-data failure keeps open rows with one scoped retry notice, never a false empty archive.
```text
1440 | shell rail | area / account                                    |
     |            | Sales Pipeline / selected scope                   |
     |            | Search | Scope | Stage | Classification | Sort    |
     |            | Board/Table | Export                 [New project]|
     |            | > Pipeline summary                                |
     |            | Leads | Pre-Qual | Quotation | Tender | Negotiation|
     |            | name / customer / owner / activity / amount / %    |
     |            | (Table replaces board within this full track)     |
390  | Menu / Sales / Account                                         |
     | Sales Pipeline / selected scope                                |
     | Search projects                                                |
     | Scope | Stage                                                  |
     | Classification | Sort | More actions                           |
     | [New project]                                                  |
     | linked name / customer / stage / activity / exact value / %     |
     | next deal ...  > Pipeline summary (after list)                  |
```
Phone first screen at 390×844: shell, title, current scope, search/filter controls, permitted creation and first identifiable/openable deal; summary stays collapsed below work. Long ID labels wrap, ≥44px controls; no horizontal board or page pan. Finance's absence of creation brings the first deal up.
## `/sales/:id` — compatibility, then record/win capture
No Sales page, toolbar, chart, loading skeleton or primary action is built for the redirect. Replace to `/projects/:id`; shell highlights Projects. Destination follows [project detail brief](project-detail.md); source Sales return restores filters/sort/scroll, direct entry falls back to Sales for the pipeline return (N-01/02/04).
Canonical win capture remains with the project's evidence, never a board popover. Header/scope → amount/currency/basis once → required contract reference/date with above-field labels → Confirm won + Cancel; Advance/Mark won cease to be filled primaries while capture is open. Keep field values and useful inline error on failure; pending/saved outcome and post-win focus remain (A-01–04/E-01–04). Finance is read-only; stage legality and role rules stay unchanged.
```text
1440 | shell | Back to Sales Pipeline / Projects > linked identity     |
     |       | project h1 + customer / stage                          |
     |       | Record won: amount / currency / basis / consequence     |
     |       | Contract reference [          ]  Contract date [      ] |
     |       | inline errors             [Confirm won]  Cancel        |
390  | shell / Projects                                               |
     | Back to Sales Pipeline                                         |
     | project name / customer / stage                                |
     | Record won / amount / currency / basis                          |
     | Contract reference [          ]                                |
     | Contract date [          ]                                     |
     | error / [Confirm won] / Cancel                                 |
```
Phone first screen after redirect: named return, project identity/stage and decision evidence; opening win capture brings amount and first field into view. Submission follows both fields; no overlay covering evidence. Redirect itself has no screenshot surface; capture destination URL and browser history instead.
## Builder acceptance
Capture the [route × state manifest](sales-inventory.md#capture-manifest) at 1440×900/390×844, EN/ID and light/dark with synthetic records; include every scope/view/stage, summary open/closed, filter/sort/disclosure, loading/empty/no-match/error/partial, permission and transition result. Pair collection → record → return and legacy link → canonical destination.
Verify PA-00–04, N-01–04, A-01–04, E-01–04, C-01–06, S-01–05, L-01/02; one h1, no page overflow, ≥44px phone targets, axe serious/critical = 0, empty rendered detector results and existing tokens. Retain current domain/role/money behavior; update deliberate interaction steps without weakening goal oracles.
Apply [exact test disposition](sales-inventory.md#test-disposition): delete composition-only assertions when recomposing; keep behaviour, role, a11y, money, locale and return proofs. This deliverable edits docs only. Static detector: **0 findings** across `pmo-portal/pages`, `pmo-portal/components`, `pmo-portal/src/components/ui`; this is source evidence, not rendered approval.
