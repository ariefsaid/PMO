# Work order page — round 2 report (#1126)

Work branch `ui/1126-work-order-page`: `origin/batch/1126-ui` and `origin/feat/1126-per-day-cost` merged in, 11 commits and 2 merges
this round. Screenshots: this branch, `ux-shots/work-order-page/after-r2*/`, `before-daily/`, `after-daily/`.

## Purpose and structure (unchanged from round 1; what this round added)

One work order: where does it stand, and what waits on me? The header gives its state; each area answers one question.
This round gave the page ONE help control (the `?` at the end of the area tabs). Each section registers its definitions
there while it is shown, and the help lists the open area's definitions. The sections keep figures, marks and the
statements a person acts on.

```
 Site and scope │ Cost and plan │ Billing │ Materials │ Inspections and close-out │ Documents and safety │ Issues and tasks 2   (?)
 Cost and plan:  Plan vs actual · Costs · Revenue plan · Cost and schedule performance · Daily target · Each day
 Billing:        Invoices · Acceptances · Billed per month · Billing steps [row → Update → right drawer] · Surveys · Quantity changes
 Inspections and close-out: Inspections · Close-out checklist [row → Update → right drawer] · Material completion · Still missing
 Materials:      Stock for this work order (framed) · Consumables · Client material
```

## Daily target: two questions, two blocks (with the per-day cost feature merged)

```
┌ Daily target                                   ‹ Nov 2026 › ┐   (a) are we on target this month?
│ Target to date · Actual to date · Gap to date · Projection   │
│ Month target …: the projection is … behind target.           │
│ [target vs actual per day, chart]                            │
└──────────────────────────────────────────────────────────────┘
┌ Each day                                                     ┐   (b) did each day pay for itself?
│ Day │ Target │ Actual │ Gap │ Labour│Equip│Material│Other │ Cost │ Revenue less cost │
│ only days with something on them; phone: one card per day    │
│ 15 days with nothing on them · 2 days have cost in another currency… · Not dated to a day: … │
└──────────────────────────────────────────────────────────────┘
```

- **Kept from the feature branch, all of it:**
  - per-day cost comes from the cost list's own lines and amounts, so the days plus "Not dated to a day" sum to the list;
  - an unreadable cell is an em dash, never 0;
  - cost columns hide when nothing in them is readable;
  - its pgTAP file passes (6 tests) and all its unit tests pass.
- **Which days get a row:** a target, revenue, a report waiting, a listed closure, or cost this reader can read. Other days
  are counted ("15 days with nothing on them"). Days whose only cost can't be read here (another currency or restricted)
  are counted apart, not drawn as dash rows.
- **Empty month** (no target, no actual, no cost): one line and the Enter plan action, only for a reader who may plan.
- **Moved to the help:** the projection's explanation.
- **Day labels:** read `26 Nov`. The before version used the browser's `Nov 26, 2026`.
- **Journeys:** both blocks sit inside the `wo-page-daily-target` container, so JOB-1126, JOB-M2 and AC-WDT-014 read the
  same day rows and figures. All three pass.

| Daily target block, same record (5 targeted days, 1 supplier bill, 2 days of cost in another currency) | Before (feature branch) | After |
|---|---|---|
| Day rows at 1440 | 21 (every working day; 16 were rows of dashes or zeros) | 5, plus one counting line |
| Block height at 1440 / 390 | 1,074 px / 1,910 px | 768 px / 1,497 px (two blocks) |
| Last column's figures vs its header (right edge) | — (one combined table) | flush to the table edge (was 16 px short in my first render; fixed) |
| Explanatory sentences inside the block | 1 | 0 (in the help) |

Before: `before-daily/daily-{en,id}-{1440,390}.png`. After: `after-daily/daily-{en,id}-{1440,390}.png`.

## What else changed and why

1. **Cost and schedule performance**:
   - the indices are key figures (30 px) with their reading;
   - "As of 26 Nov 2026" heads the panel;
   - the definitions of earned, planned and actual, and the range, are in the help;
   - the project page's copy of these figures is unchanged (new `showBand` option, on by default).
2. **Revenue plan**: "As of 26 Nov 2026" (was `2026-11-26`). "Actual is validated daily revenue" moved to the help.
3. **Surveys**:
   - the empty state is "No surveys recorded yet." beside Record a survey;
   - what a survey is, and who records and confirms it, moved to the help;
   - the record dialog still says how to enter a survey.
4. **Hours in Bahasa**: new shared `formatQuantityUnit` writes "9 jam" / "7,5 jam" / "3 hari" in Bahasa and "1 day" /
   "9 hours" in English. Cost lines use it.
5. **One name per record**: a cost record whose name is its code reads once ("CR-1", not "CR-1 · CR-1").
6. **Materials**:
   - the stock owner's table sits in a section frame like its siblings, flush to the panel edge;
   - its messages and transfer link sit on the inset;
   - phone cards come from the stock owner's table.
7. **Billing steps and Close-out** rows are for scanning:
   - each row shows number, name, owner, person, dates, lateness, status and documents;
   - **Update** opens a right drawer with the document pickers and Attach, owner or person, Done on, Mark done and Skip,
     under the same names as before;
   - Mark done or Skip closes the drawer, and a refusal shows inside it.
8. **The claim's "Open the work order's billing steps"** now opens `/work-orders/:id#wo-billing`.
9. **Shared components**:
   - `RecordHeader`: a key fact keeps to one line (two on a phone), with the full value as its title, so long names no
     longer end a line short of their neighbours;
   - `RecordSection`: heading and actions share one baseline, without the 4 px overhang that left 9 px under a wrapped
     action;
   - checked on the work order, sales invoice and contact record pages at 1440 and 390.

| Measured (1440, Admin, same record as round 1 where comparable) | Round 1 | Round 2 |
|---|---|---|
| ux-proof layout faults 1440 / 390 | 2 / 0 | 0 / 0 |
| impeccable findings · axe serious/critical | 0 · 0 | 0 · 0 |
| Billing area height | 2,265 px | 1,781 px |
| Inspections and close-out area height | 1,520 px | 1,320 px |
| Header key facts: bottom edges in one row | uneven (project name wrapped to 2 lines) | level |
| Chrome words 1440 / 390 (budget 31 / 35) | 43 / 41 | 43 / 41 |

## Screenshots (`ux-shots/work-order-page/`)

- `after-r2/`: Admin (en, id), PM (en), Finance (id) and Engineer (en) at 1440, 1024 and 390, every area
  (`-tab-<area>.png`).
- `after-r2-states/`: the help popover, a billing-step drawer and a close-out drawer, open, at 1440 and 390 (Admin en,
  PM id).
- `after-r2-stock/`: the Materials area with real stock on a journey's work order (Bahasa, 1440 and 390).
- `before-daily/`, `after-daily/`: the Daily target block, en and id, 1440 and 390.

## Skill lines applied

- **restructure:** "A component that answers several questions is several components" (brief) → Daily target split in
  two. "Freeze the feature floor": every per-day figure still has a home (target, revenue and gap per day stay in Each
  day; quiet days and unreadable-cost days are counted).
- **screen rules:**
  - "At most ONE help control per screen" → one `?` for the page;
  - "Empty state: one line … plus the one control that fixes it";
  - "Unknown is never 0: hide the column and report the reason in one line";
  - "Dates: `10 Nov`".
- **taste:** "One right edge per row or card" → the Each day columns end on the table edge. "A missing value is a grey
  dash".
- **impeccable:** "States: … empty" → the empty month and survey states. Detector: 0 findings.

## Journeys and gates (all seen passing on the final code)

- **Journeys:** the per-day cost and daily target journeys, all 12 drawer journeys, the claim-link journey, the Materials
  journeys, and the cost, survey and revenue-plan journeys this round touched. Every batch passed, 13–19 tests per batch
  including setup. Specs:
  - JOB-1126, JOB-M2, AC-WDT-014;
  - AC-WBS-012, AC-WML-007, JOB-T3, JOB-BQ15, AC-WQE-001, JOB-BQ10, AC-SITE-BQ10, JOB-PC13, AC-WCO-012, AC-SITE-012,
    AC-WCO-040, JOB-PC13b, JOB-BQ4;
  - AC-SSW-001, JOB-W1, JOB-W5;
  - JOB-PC26, JOB-PC4, JOB-PC1, JOB-PC2, JOB-PC9, JOB-E1, AC-SCR-014, AC-WPVA-016, JOB-PC28, JOB-PC16, JOB-E6, JOB-PU22,
    AC-WORP-003, JOB-PC6, AC-WRP-013, AC-CSP-016, AC-IHC-011, JOB-H7, AC-LCM-018, JOB-FN4.
- **Unit tests:**
  - `vitest related` on the work-order and stock sources: 221 files / 2,869 tests passed;
  - the formatter and per-day cost tests: 14 passed;
  - RecordHeader, RecordSection and the six record pages that use header facts: 12 files / 190 tests passed;
  - `vitest related` over `format.ts` and the shared record components pulls in most of the app and was too slow to
    run locally (timed out); CI's full run covers it.
- **pgTAP:** `1126_work_order_cost_by_day.test.sql`: 6 passed.
- **Guards, typecheck, ESLint** (`--max-warnings=0` on 68 touched files): all passed.
- **`scripts/ux-proof.sh`:** exits 1 on the word budget only (unchanged from round 1). No layout fingerprints remain.
- **Journey steps updated (goals unchanged):**
  - 12 billing-step and close-out journeys open the row's drawer (`openRowUpdate`) and read the drawer while it is open;
  - AC-SITE-BQ10 expects `#wo-billing`;
  - AC-SCR-014 reads the survey empty state's own line;
  - JOB-PC9 reads "1 day" (was "1 days");
  - JOB-W5 reads the on-site cell as "20 <unit>". This was already broken on the batch branch by the stock table's units,
    not by this round;
  - JOB-1126 opens the cost area.

## Owner to confirm

1. The page's explanations (performance basis and range, revenue-plan basis, projection note, what a survey is and who
   confirms it) now sit behind one `?` at the end of the area tabs, not in the panels.
2. Daily target is two panels, "Daily target" and "Each day". Days with nothing on them are counted, not listed.
3. Billing steps and close-out items change in a right drawer opened by **Update** on the row.
4. A long name in a record header's key facts is cut to one line (two on a phone) with the full name on hover. This shared
   change also applies on the sales invoice, contact and other record pages.
5. "Billing and acceptances" no longer exists (round 1); "Surveys" lost its explanatory paragraph to the help.

## Needs a data change

None.

## Not done

- A "waits on you" block: out of scope, as briefed.
- The stock table's column headers are cut in Bahasa at 1440 ("Dipindah ke te…", "Dikeluark…"). That table belongs to
  the stock owner, so I left it for them.
- The word budget for this route (31 / 35) was set on a sparser record. On this rich record the page stays at 43 / 41,
  down from 54 / 55 before round 1.
