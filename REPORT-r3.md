# Work order page — round 3 report (#1126)

Work branch `ui/1126-work-order-page`: 7 commits plus 2 merges of `origin/batch/1126-ui`. The project Plan vs actual
owner's rebuild of my Plan vs actual twin (a Plan / Actual / Left or over table on their PvaTable) is kept as theirs.
Screenshots: this branch, `ux-shots/work-order-page/after-r3/` (and `before-r3/` for the cost area and header).

## What changed and why

1. **Header key facts** (shared `RecordHeader`):
   - a name reads whole again and wraps, so "Pembangunan Jaringan Pipa Gas B…" is gone;
   - each fact spans two rows of the header grid (CSS subgrid): every label sits on the first row, bottom-aligned, so the
     labels share one baseline even if one wraps, and every value starts at the top of the second row;
   - this applies on every record page that uses header facts (sales invoice, contact, receipt, quantity change,
     subcontract certificate).
2. **Revenue plan chart**: the x-axis and the tooltip read `23 Nov` through the shared `formatDay` (was `2026-11-23`).
3. **Whole units for read-only money, through the shared `formatTableMoney`** (the formatter the Plan vs actual twin
   uses). It covers every section of the page:
   - the header's order value, Invoices, Billed per month, Costs;
   - Revenue plan, Cost and schedule performance, Daily target and Each day;
   - Sections, Inspections.

   An amount under one unit still shows exactly; inputs and documents keep their decimals. The project page's daily
   target and revenue plan roll-ups show the same figures, and three journeys compare the two screens, so they use the
   same formatter (own commit, 2 lines each).
4. **"Not comparable (other currency)" once per area**:
   - the two margins and the cost index show a dash;
   - one line at the top of the area says why: "Some cost is in another currency: figures that would mix currencies are
     not shown, and that cost is listed apart" (Bahasa: "Sebagian biaya dalam mata uang lain: …");
   - sections that hide figures for the same reason hold one note between them (`useAreaNote`, beside the help registry);
   - the project page's performance figures are unchanged (new option, off by default).

## Measured (1440, Admin, Bahasa, same sample work order)

| | Round 2 | Round 3 |
|---|---|---|
| Decimal read-only amounts ("Rp 740.000.000,00") in the Cost area | 31 | 0 |
| Decimal read-only amounts in every other area | 0 | 0 |
| "Tidak dapat dibandingkan…" sentences in the Cost area | 3 | 0 (one area line instead) |
| Header: longest name shown | cut with "…" | whole (2 lines at 1440, 4 at 1024, 4 at 390) |
| Header: label row of the four facts | one line, one baseline | one row, one baseline (subgrid) |
| Revenue plan x-axis | `2026-11-23` | `23 Nov` |
| ux-proof layout faults 1440 / 390 | 0 / 0 | 1 / 0 (see "Owner to confirm") |
| impeccable findings · axe serious/critical | 0 · 0 | 0 · 0 |

## Journeys and gates (all seen passing on the final code)

- **Journeys** (18 + 16 + 15 + 15 passed, setup included):
  - chromium: JOB-PC4, JOB-PC2, AC-WPVA-016, JOB-PC26, AC-WORP-003, AC-BPM-008, AC-WOS-019, JOB-BQ9, JOB-PC16, JOB-PC28,
    JOB-PC1, JOB-E1, JOB-PU22;
  - serial: JOB-1126, JOB-M2, AC-WDT-014, AC-WRP-013, AC-CSP-016, JOB-H7, AC-LCM-018, AC-NLL-014, AC-IHC-011.
- **Unit tests:**
  - `vitest related` on the round's source files: 55 files / 633 tests passed;
  - RecordHeader and the six record pages that use header facts: 11 files / 183 passed;
  - roll-ups: 10 passed;
  - new `AreaHelp.test.tsx`: one note per reason across sections.
- **Guards, typecheck, ESLint** (`--max-warnings=0` on the 24 files this round touched): all passed.
- **Journey steps updated (goals unchanged):** JOB-1126, JOB-M2, AC-WRP-013, JOB-PC4, JOB-H7 and JOB-PC16 build their
  expected money with the same `formatTableMoney` the page uses (whole units).

## Owner to confirm

1. **The rendered proof's "columns end level" rule (rule 7) now flags the header at 1440.** The project name wraps to two
   lines, so its column ends 48px below the one-line facts. This is your ruling (names whole; labels on one baseline;
   values at the top), and it conflicts with that rule. I did not mark it ignored. Your options:
   - accept it as a deliberate exception: a `data-layout-ignore` on the facts grid, or a layout-baseline entry;
   - or let the facts grid be judged by labels and tops instead of ends.
2. The project page's daily target and revenue plan roll-ups also show whole units now (same figures as the work order).
3. Header names wrap on every record page that uses header facts, not only the work order.

## Needs a data change

None.

## Not done

- The stock owner's "Stock for this work order" table formats its values with its own `formatStockValue`, which shows
  decimals ("US$4,00"). It is their file and their formatter, so I left it for them to move to `formatTableMoney`.
- The word budget (43 / 41 against 31 / 35) is unchanged from rounds 1 and 2.
