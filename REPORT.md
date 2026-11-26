# Work order page (`/work-orders/:id`) — screen-owner report, round 1126

Work branch: `ui/1126-work-order-page` (10 commits on `origin/batch/1126-ui`, merged with it, nothing to merge).
Screenshots: this branch, `ux-shots/work-order-page/`.

## 1. Purpose and structure (settled before layout)

**Who and the one question.** A Project Manager, site supervisor or finance person opening one work order asks:
*where does it stand, and what waits on me?* The header answers state (status, complete %, order value);
each area below answers ONE follow-up question, ordered by how often it is asked.

```
┌ WO-2026-1047  [Issued]                                              [primary] [⋯] ┐
│ title · Client PO                                                                 │
│ Project ─ Client ─ Order value ─ Complete 0%                                      │
└───────────────────────────────────────────────────────────────────────────────────┘
 (Draft: checks before issue) (waiting line · cancel reason · today's safety · supply risk)
 Site and scope │ Cost and plan │ Billing │ Materials │ Inspections and close-out │ Documents and safety │ Issues and tasks 2
 ── one area at a time, kept in the address (#wo-billing); phone: one area picker ──
 Site and scope:  how far has it got?     Scope table · Sections · Crews today · Site reports · Site location
 Cost and plan:   costing what we planned? Plan vs actual (table) · Costs (table) · Revenue plan · Performance · Daily target
 Billing:         what was billed?          Invoices · Acceptances (confirm) · Billed per month · Billing steps · Surveys · Quantity changes
```

## 2. What changed and why

1. **One area at a time.** 23 panels in one 7,466px column under a jump bar became tabs (the project page's own tab bar
   and phone picker, so the frame matches). Old `#wo-<group>` links still land; `#wo-inspections` / `#wo-closeout` land
   on the merged area. "Issues and tasks" carries the open count before it is opened.
2. **Order by question.** Billing moved before Materials; Plan vs actual moved above Costs (the question first, the
   records behind it after).
3. **Scope is a table**: contract line · accepted of allocated · complete %, figures on one right edge (was a list of
   run-on strings whose edges moved with their length).
4. **Costs is a table**: record · date · quantity · amount; source and discipline totals on the amount column (was
   "20 Nov · 9 hours · $11,250,000" strung after the name).
5. **Plan vs actual is a table**: Plan and Actual for direct and shared cost, left/over stacked under the actual;
   revenue and both margins as three figures (was an 8-cell grid where plan and actual of one cost sat in different columns).
6. **Billing and acceptances (3 questions in 1 block) is 3 panels**: Invoices, Acceptances, Billed per month.
7. **Complete %** moved from the scope heading into the header's key facts, beside the order value it weighs against.
8. **Phone**: the tables stack (name over labelled figures); codes no longer break mid-code; nothing scrolls sideways
   at 390 with long rupiah in Bahasa.
9. **Bug found by the change**: the pickup dialog left "Received at" empty when the keeper's one location loaded after
   it opened; it now derives the default (unit test added).
10. **Less than found**: the jump bar (`PageIndex.tsx` + its test) is deleted; 4 now-unused i18n keys removed per language.

## 3. Measured edges, before → after (1440×900, admin, same sample work order)

| Edge | Before | After |
|---|---|---|
| Page height | 7,466 px (all 23 panels) | 1,419 px Site and scope · 2,706 px Cost and plan |
| Panels to scroll through | 23 | 4–6 per area |
| Panel heading left x | 273 | 273 |
| Scope: quantity right edge | 1327 / 1344 / 1336 (ragged, glued to the %) | 1311 on every row |
| Scope: % right edge | 1391 | 1391 |
| Costs: date right edge | 1238 / 1235 | 1048 / 1048 |
| Costs: hours right edge | 1301 / 1309 | 1211 / 1211 |
| Costs: amount right edge | 1391 | 1391 |
| Plan vs actual: plan cells (direct / shared) right x | 630 / 1391 (different columns) | 949 / 949 |
| Plan vs actual: actual cells (direct / shared) right x | 1010 / 630 | 1391 / 1391 |
| ux-proof layout faults, 1440 / 390 | 13 / 12 | 2 / 0 (both in shared components, see §8) |
| impeccable detector findings | 6 | 0 |
| axe serious/critical | 0 | 0 |
| Chrome words (ux-proof), 1440 / 390 | 54 / 55 | 43 / 41 |
| Smallest text, inputs <16, targets <44, overflow at 390 | 14 · 0 · 0 · none | 14 · 0 · 0 · none |

## 4. Screenshots (`ux-shots/work-order-page/`)

- `before/` — old page, `<login>-<en|id>-<1440|1024|390>-{viewport,full}.png` for admin (en, id), pm (en), finance (id), engineer (en).
- `after/` — same logins and widths; `-full.png` is Site and scope, `-tab-<area>.png` each other area.
- `before-draft/`, `after-draft/` — a Draft with nothing on it yet (the new/empty state), 1440 and 390.
- `ux-proof/` — the proof's own captures, light and dark theme, 1440 and 390.
- Loading and error states are proven by unit tests (each panel's own error with retry), not captured.

Sample data (local only): one IDR project and two work orders with long Indonesian names and amounts, created with
service-role inserts in a throwaway local fixture (the seed has no work orders); removed after the captures.

## 5. Skill lines applied

- **restructure**: "Freeze the feature floor before any edit; simplification cannot silently remove a figure,
  capability or safeguard." → the floor table in §9; every figure kept a named home. "Compose 390 separately around the
  phone job" → stacked tables, area picker.
- **taste (app-screens)**: "Numeric headers are right-aligned and flush with their values" and "One right edge per row
  or card" → scope, costs and plan-vs-actual tables. "Two measures stack in one cell rather than taking two columns" →
  left/over under the actual; date and quantity under the record on a phone.
- **impeccable (craft-floor)**: "Spacing: tight groups, generous separation, more space above a heading than below it"
  → section summaries moved off heading sublines (heading 12px above content). `impeccable detect`: 6 → 0.
- **screen-rules**: "Tables: full amount, right-aligned, tabular"; "A component that answers several questions is
  several components" (brief) → Billing split in three.
- **ui-ux-pro-max**: not loaded — the vendor script stopped at an upstream gstack change before it; impeccable, taste and
  stageshow were vendored by hand from the script's own lines.

## 6. Journeys and gates (all seen passing on the final code unless noted)

- Unit: `npx vitest related --run` on the 8 changed source files — 23 files, 299 tests passed; page + section files 35
  files / 303 tests passed. New tests: area switch keeps the address; old `#wo-closeout` lands on the merged area; open
  count on the tab; header Complete %; pickup default location.
- Journeys (E2E_WORKERS=1): all 41 chromium journeys that open the page and all 19 serial ones passed (60 specs, in
  batches; affected-e2e lists 460 because the shared locale files changed — the rest is left to CI).
- `npm run check:guards` passed · `npm run typecheck` passed · `eslint --max-warnings=0` on 69 touched files passed.
- `scripts/ux-proof.sh /work-orders/<id>`: exits 1 — word budget (43 vs 31 at 1440; the budget was set on a sparser
  record; same record before was 54) and 2 shared-component layout fingerprints (§8).

Journey steps updated (goal and oracle unchanged in every one): 59 specs gained the step
`openWorkOrderArea(page, '<area>')` (new `e2e/support/workOrderArea.ts`), where they work in an area other than
Site and scope. Specific edits: AC-WBS-012, AC-WML-007, JOB-PC26 (clicked the removed jump-bar links); JOB-E1 (read the
cost line as one run-on string; now reads the crane's row for its date and hours); JOB-PC2, JOB-PC9, JOB-PC14, JOB-PC12
(area opened at the step that works in it).

## 7. Owner to confirm

1. **Tabs instead of one long page.** Browser find-in-page and print now cover the open area only; the address keeps
   the area for Back and sharing. (before: `before/admin-en-1440-full.png`, after: `after/admin-en-1440-full.png`)
2. **Inspections and Close-out are one area**, "Inspections and close-out" ("Inspeksi dan penutupan").
3. **Area order**: Billing now before Materials.
4. **"Overall N% complete" became "Complete N%" in the header** (removed from under the scope heading).
5. **"Billing and acceptances" is now three panels**: Invoices, Acceptances, Billed per month; the "Counts submitted
   invoices only…" basis line moved under the months.
6. **Plan vs actual sits above Costs**, as a Plan/Actual table; "No plan" no longer repeats under a shared cost that has
   no plan (it stays in the Plan column).
7. The jump bar is gone (its job is done by the tabs).

## 8. Needs a data change

None. Two things outside this screen's files that the owner of those areas could take:
- The claim page's "Open the work order's billing steps" link opens `/work-orders/:id` (Site and scope); adding
  `#wo-billing` would land on the steps. Its journey asserts the bare href, so it was left.
- Shared components: `RecordHeader` key-facts columns end uneven when the project name wraps (ux-proof
  `columnsLevel`), and the `RecordSection` header row leaves a 9px pad under a wrapped action (stageshow). Both show on
  other record pages; left for the shared-component owner.

## 9. Feature floor (every panel's home after)

| Panel / figure before | Home after |
|---|---|
| Header: number, status, title, client PO, project, client, order value, primary action, menu | Header (unchanged) + Complete % |
| Waiting line, cancel reason, today's safety, supply warning, Draft checks | Above the areas (unchanged) |
| Checkpoint flag, checkpoints, site location, scope & progress, sections, crews today, site reports | Site and scope |
| Costs, plan vs actual (+ labour by class, idle cost, disciplines), revenue plan, cost & schedule performance, daily target | Cost and plan |
| Billing figures, billed per month, acceptances + Confirm BAST, billing steps, surveys, quantity changes | Billing |
| Stock for this work order, consumables, client material | Materials |
| Third-party inspections, close-out checklist, material completion link, still missing | Inspections and close-out |
| Documents, daily safety records | Documents and safety |
| Issues, responsible person, open tasks | Issues and tasks |

## 10. Not done this round

- Daily target lists every working day as a row of zeros under an empty chart; a journey reads a day row, so it stays.
- Cost and schedule performance and Surveys still explain themselves in sentences.
- Billing steps and Close-out still put their document pickers and Mark done controls inline under every row; a row
  action opening a drawer would be the next move (touches 6 journeys).
- A single "waits on you" block above the areas (BAST to confirm, current billing step, overdue close-out item, open
  tasks) needs reads that live inside the sections today; not composed.
- Revenue plan's "As of 2026-11-26" is an ISO date (screen rule says `26 Nov`).
- Materials area not reworked.
