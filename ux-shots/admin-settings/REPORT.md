# Administration and settings — screen-owner report (#1126)

Branch `ui/1126-admin-settings` at `f38de22bf` (merged with `origin/batch/1126-ui`). Screenshots on `shots/1126-admin-settings` under `ux-shots/admin-settings/`. No pull request opened.

## Purpose and structure (settled before layout)

**Who and the one question.** An Admin sets the organisation up once and comes back rarely. On each visit they ask one thing: *where is the setting that does X, and is it on?* So the shell sorts sections by the job they serve, and each long setup page sorts its settings into job groups you can jump to.

```
Administration (side list, ≥768px; one picker on a phone)    Accounting setup
  People and access   Users · People · Document types ·      ┌ Tax and fiscal year ───────────────┐
                      Clearance                              │ Default tax · Fiscal year ·        │
  Setup               Modules · Accounting setup ▸           │ Withholding · Supplier tax · DP    │
                        Tax and fiscal year                  ├ Approvals and checks ──────────────┤
                        Approvals and checks                 │ Spend approvers · Purchase rules · │
                        Purchase orders                      │ 3-way match · Claims over cap ·    │
                        Costs and account mapping            │ Work-order checklist               │
                      Project setup ▸ (4 groups) ·           ├ Purchase orders ───────────────────┤
                      Terminology · Document categories ·    │ Who can order · Printing ·         │
                      Exchange rates · Cost attribution      │ Payment channels · Line planning · │
  Connections         Organization integrations              │ Needed-by date                     │
  Plan                Your plan · Credits                    ├ Costs and account mapping ─────────┤
  All settings                                               │ Stock costing · Budget map · Exp.  │
                                                             └────────────────────────────────────┘
```

Project setup groups: **Numbering and project lists** (number pattern, classification, cost disciplines) · **Daily site reports** (report lists, who validates, QS revenue switch, checkpoints, safety lists, non-working dates, attendance target, performance limits) · **Work orders** (areas/groups, standard checks, close-out checklist, revenue plan, monthly capacity) · **Issues** (issue types, closing-time report).

One pattern each: a **switch row** (switch, name, what turning it on changes) for every on/off that saves as it flips; a **table/list row** for every editable list (rename list for terms and role names, a row per category for document categories); a **role choice** (chosen roles as tags, *Choose roles* opens the checklist) wherever a setting names built-in roles.

## Per screen: purpose, what changed and why

| Screen | Purpose (first thing) | What changed and why |
|---|---|---|
| Shell (all sections) | Find the section by its job | 17-tab strip that wrapped to 2–3 rows → one side list grouped *People and access / Setup / Connections / Plan*, open section lists its setting groups. Breadcrumb said "Users" on Modules, Document types, Document categories, Clearance, All settings → now names the open section (real defect). |
| Accounting setup | Find a money/purchasing rule and see its state | ~20 stacked blocks → 4 job panels. Claims-over-cap was a button that flipped a mode; needed-by rule a checkbox that saved instantly → both the shared switch row. Stock costing checkbox had **no visible label** → "Count stock issues as cost". PO printing had cards-in-a-card with 12px italic text → flat lists at 14px. Row buttons in payment channels/line planning now match the other lists. Budget account map table no longer scrolls sideways (column widened to 896px). |
| Project setup | Same, for project/site/work-order lists | 18 stacked blocks → 4 job panels. Revenue plan working days were **seven unlabelled checkboxes** → each names its day. Classification got its heading. Validate-daily-reports' 28-role checkbox grid → role choice. Divider widths and list headings made consistent. |
| People | Add/find a person; then settings | The 2×28-role "Time records" grids sat above the register → register first; settings below in one panel, grids → role choice. |
| Terminology › Terms / Role names | Rename a term in both languages | A card per term, ~23,800px tall at 1440 → one table: row per term, line per language, Singular · Plural columns, Save · Reset at row end; defaults shown under a renamed term. Role names: same list, one field per language. |
| Document categories | Who can see each category | A card per category repeating "Who can see documents in this category" → one table: Category · Executive · PM · Finance · Engineer · Admin · Hidden from · Save; Rename/Archive/Move in the row menu. |
| Users, Modules, Integrations, Document types, All settings, Clearance, Credits, Plan, Exchange rates, Cost attribution | — | Gain the shared frame and correct breadcrumb only; their bodies were already a table/list or are owned by other routes. Not recomposed this round. |

## Measured, before → after (admin login, same probe, base files checked out for BEFORE)

| Route @ width | Pane height px | Section-nav rows | Unlabelled checkboxes | Right-most button x | Heading left edges | Panel/section gaps flagged by ux-proof |
|---|---|---|---|---|---|---|
| accounting @1440 | 6458 → 6196 | 2 wrapped tab rows → side list | 1 → 0 | 1416 → 1367 (inside the 896px column) | 2 → 2 | (all routes) 55 → 17 |
| projects @1440 | 5692 → 5336 | 2 → side list | **7 → 0** | 1416 → 1367 | 4 → 5 (two-column list headings) | |
| people @1440 | 1741 → 1388 | 2 → side list | 0 → 0 | 1416 → 1416 | 1 → 2 | |
| terminology @1440 | **23,762 → 4,465** | 2 → side list | 0 → 0 | 411 → 1399 (row-end actions) | 1 → 1 | |
| document-categories @1440 | **4,208 → 1,429** | 2 → side list | 0 → 0 | 816 → 1399 | 1 → 1 | |
| projects @390 | 8165 → 7426 | picker | 7 → 0 | 374 → 357 | 1 → 2 | |
| people @390 | 3541 → 1318 | picker | 0 → 0 | 374 → 365 | 1 → 2 | |
| terminology @390 | 22,426 → 12,220 | picker | 0 → 0 | 179 → 179 | 1 → 1 | |
| document-categories @390 | 5695 → 4422 | picker | 0 → 0 | 348 → 348 | 1 → 1 | |

ux-proof (Executive login, its default), before → after: accounting text <14px **6% → 0%** (min 12 → 14px); layout fingerprints not in baseline accounting 17 → 7, projects 11 → 1, people 1 → 1, terminology 0 → 1, document-categories 0 → 0; axe serious/critical 0 → 0. Impeccable findings rose (accounting 4 → 16, projects 0 → 8): **all but one are "repeated-container-text"** — the read-only line "Only an Admin can change this." now appears 3–5 times inside one group panel for a read-only viewer (it was the same count before, in separate blocks); the rest are "nested cards": the shared DataTable's own border inside the posting panel, and the closing-time report's `panel-card`. The proof still exits 1 on every admin route for "missing shrink-only target baseline" (no admin route has one; true before and after) and on the remaining fingerprints above.

## Screenshots (branch `shots/1126-admin-settings`)

- `ux-shots/admin-settings/before/` and `after/`: `<section>-<en|id>-<login>-<width>.png` (first viewport) and `…-full.png` (whole pane), for accounting, projects, people, users, modules, integrations, terminology, document-categories, all-settings (+ document-types after) at 1440×900, 1024×768, 390×844 in English, and 1440 + 390 in Bahasa Indonesia; `after/*-exec-*` = read-only Executive view of accounting and projects.
- States: `after/state-people-roles-open-{1440,390}.png` (role choice open), `after/state-doccat-row-menu-{1440,390}.png` (row menu), `after/state-terminology-role-names-{1440,390}.png`; error state (chart of accounts unavailable, no ERP locally) is visible in every accounting shot.

## Skill lines applied

- **restructure** — "A calm screen is information-rich: reduce reading and competing marks while preserving useful facts and actions." → no block, field or action removed; role grids folded behind *Choose roles* with the choice still shown. "Freeze the feature floor before any edit" → every anchor id the catalogue and links use (`#spend-approvers`, `#work-order-checklist`, `#budget-account-map`, …) kept; `#…-heading` routes still land.
- **taste (app-screens)** — "Tables are rules and alignment. No zebra striping, no header bands" → terminology, role names and document categories are rule-separated rows under one quiet header row. "Navigation recedes. The active item is a neutral grey pill" → the side list's open section is a grey pill. "Surfaces are flat … separation is a 1px line" → one hairline between settings, no inner cards in PO printing.
- **impeccable** — "Refinement preserves; redesign replaces … keeps product truth, content, function, native affordances" → copy kept word for word except three shortened column labels and "Tick job roles" → "Choose job roles" (EN and ID) to match the new control; detector used through ux-proof; its nested-cards finding on PO printing is gone.
- **screen-rules** (wins over taste where they differ) — "a heading sits 12 to 16px above its content", "sibling sections … 32px" → settings panel spacing; "Navigation icons are unique" n/a; "One name, one look" → one switch row, one list-row button look.

## Journeys and gates (all seen passing on `f38de22bf`, the merged tree)

- `npm run check:guards` ✔ · `npm run typecheck` ✔ · `npx eslint --max-warnings=0` on all 31 touched .ts/.tsx ✔ · `npx vitest related --run <changed sources>` **194 files / 2,267 tests passed**.
- Journeys (the 41 specs that open these screens, of 460 `affected-e2e` lists because the shell and shared admin components are touched; brief cap 40): chromium lane 64 passed / 1 skipped (pre-existing allowlisted skip); serial lane 69 passed. Earlier run: AC-PCH-001 timed out once on the procurement record's Save channel (section re-rendered and reset the choice — not a component I changed), passed on both re-runs.
- `scripts/ux-proof.sh` on accounting, projects, people, terminology, document-categories: exit 1 — see the measured section (missing target baselines on all admin routes, before and after; remaining fingerprints listed).
- Tests changed (steps that named the old look; goals unchanged): `AdministrationShell.test` nav order now by job group; `OrgAttendanceTimeRoles.test` / `DailyReportValidateRoles.test` open *Choose roles* first, read-only asserts the chosen role and no checklist; `AdministrationDocumentCategories.test` opens the row menu for Archive / system-category checks; `OrgClaimOverCap.test` / `OrgOrderNeededBy.test` use the switch. No e2e spec changed.

## Owner to confirm

1. **Tab strip → side list** on every Administration section, grouped *People and access / Setup / Connections / Plan*; *Organization integrations* now sits under Connections and comes after Setup (crops: `before/accounting-en-admin-1440.png` vs `after/accounting-en-admin-1440.png`).
2. **Group names** I chose: Tax and fiscal year · Approvals and checks · Purchase orders · Costs and account mapping · Numbering and project lists · Daily site reports · Work orders · Issues; People's lower panel is titled *Settings*.
3. **Claims over the claimable quantity** is now a switch "Refuse claims over …" (off = warn only); the words "Warn only / Refuse" no longer print as a separate status line.
4. **Role grids folded**: Time records (2 lists) and Validate daily site reports show chosen roles as tags; the full checklist opens with *Choose roles*.
5. **Document categories**: Rename, Archive/Restore, Move up/down moved into the row's ⋯ menu; the Save button reads *Save* (its accessible name is still "Save who can see it").
6. **Breadcrumb** now names Modules, Document types, Document categories, Clearance, All settings instead of "Users".
7. **Words**: People's first viewport gained 8 words (Settings, Choose roles ×2, No role chosen) and Document categories 3 (column header labels) while removing two 28-checkbox grids and repeated per-card legends; terminology dropped 12, accounting's first viewport dropped ~100 (ux-proof word column, Executive login).

## Needs a data change

None. Everything was done with the same reads, writes, permissions and anchors.

## What I did not get to

- **One view per group.** Taste's settings rule says a long page with anchor links scores worse than one view per area; Accounting and Project setup still scroll all four groups on one page (the side list jumps to them). Splitting them into their own routes needs only routing, but changes many bookmarked `#anchor` links; left for the owner's call.
- **One save model per panel**: some settings save as they flip (switch rows), others keep their own Save button (tax, withholding, tolerances, lists). Not unified.
- **Read-only line repeated** per setting for an Executive viewer (impeccable "repeated-container-text"): should be one line per panel; each block renders its own today.
- Remaining ux-proof fingerprints: list row internals (line planning, PO signature blocks: 26px heading→first row), budget→expense map 48px gap, issue closing-time report's inner card, People empty-state 61px gap; no shrink-only target baseline seeded for admin routes.
- Long rupiah amounts at 390: the local seed organisation reports in USD, and I did not create rupiah tiers/limits through the app; amounts shown are the seed's ($25,000 site cash limit).
- Not recomposed this round: Users, Modules, Organization integrations, Clearance, Cost attribution, Exchange rates, Credits, Your plan, All settings bodies (frame and breadcrumb only).
- Dark theme and 1920 width not captured; Bahasa shots at 1440 and 390 only.
- Local DB contains document categories "Commercial approval <timestamp>" left by the AC-DCV-022 journey runs (local only).
