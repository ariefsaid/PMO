⚠️ DEGRADED: single-context (no sub-agent tool in this session, so impeccable critique's Assessment A and B ran one after the other in one context; A was written before the detector output was read)

# RD-S1 rendered Discover: short money on KPI cards (PR #1257), 2026-10-20

**Build reviewed:** `claude/v024-rd-s1` @ `74e08da1`, Vite on :5191, shared local Supabase (read-only, every browser run under `scripts/with-db-lock.sh`).
**Data:** the design pass §0.1 client-shaped fixture, route-mocked over the seed: IDR org; 6 Ongoing projects worth IDR 160.9 bn; IDR + USD close-outs; 144 of 150 cost categories mapped; no budgets; long Bahasa names; a negative-margin and zero-spend variant. RD-S1 did **not** ship a route-mocked fixture: its e2e uses the USD seed. This harness is the reusable fixture: `docs/ux/shots/2026-10-20-rd-s1/harness/` (`fixture.cjs`, `run.cjs`).
**Matrix:** Executive `/` (Admin), Finance `/` (Finance), PM `/` (PM), Sales `/sales` (Admin, PM), Revenue by project, Management pack `/reports`. Widths 1440 and 390, plus 1024 and 768 in Bahasa. English plus Bahasa on every dashboard. Procurement detail was added because RD-S1 changed it.
**Evidence:** `docs/ux/shots/2026-10-20-rd-s1/` holds a `<route>-<lang>-<width>.png` (full page) and `-fold.png` for each state, plus `crops/`, `edge/`, `mid/` and `procurement/`. The detector JSON is in `harness/detect-json/`.

## Summary (plain)

- **What RD-S1 set out to do works.** No figure clips or crosses its card on any route, at any width, in either language. Measured over 30 renders: 0 geometry violations and no sideways scrolling. Headline money reads at a glance ("IDR 160.9B", "Rp 160,9 M"), and screen readers hear the exact amount once.
- **Merge is blocked by 5 items:**
  - the branch conflicts with `dev` (RD-C1/C2) and must be re-rendered after the rebase;
  - on the phone, a known zero spend is announced as "Not available yet";
  - approval money on procurement was shortened, beyond the owner's "KPI cards" ruling;
  - two unknown figures now show a bare "—" with no visible reason;
  - the geometry gate runs on small USD seed data, so it can't catch the client's bug.
- **Verdict: fix-then-ship.**

## Detector counts (`impeccable detect --json`, per route × viewport)

The detector can't log in, so each authenticated render was saved as a DOM snapshot (scripts stripped, app CSS kept) and scanned over HTTP at the matching viewport. A direct URL scan only reaches `/login`.

| Route | 1440 EN | 390 EN | 1440 ID | 390 ID | Rules (count per scan) |
|---|---:|---:|---:|---:|---|
| Executive | 4 | 4 | 4 | 4 | overused-font, bounce-easing, clipped-overflow-container, gpt-thin-border-wide-shadow (advisory) |
| Finance | 12 | 12 | 12 | 12 | above + **nested-cards 7**, em-dash-overuse (adv) |
| PM | 2 | 2 | 2 | — | overused-font, bounce-easing |
| Sales | 34 | 68 (Admin and PM) | 34 | — | **tiny-text 4 / 57**, **nested-cards 26** (1440), **text-occlusion 8** (390), edge-flush-cards 1 |
| Revenue by project | 3 | 3 | 5 | 5 | nested-cards 1; **all-caps-body 2** (ID only) |
| Management pack | 9 | 5 | 9 | 5 | **clipped-overflow-container 3**, **cramped-padding 2**, nested-cards 2 |

**Verified false positives:**

- `overused-font`: Inter is locked by ADR-0068.
- `bounce-easing`: Tailwind's `--animate-bounce` variable, not used on these screens.
- `clipped-overflow-container` on `div.grid.h-[100dvh]`: the app shell, by design.
- Sales 390 `text-occlusion`: probably the IDs inside the collapsed "Financial and project details" disclosure. In the screenshot nothing visible overlaps.

**Real:**

- `tiny-text` (11 px IDs, RD-045).
- `nested-cards`: the Finance approval/KPI band and the sales board.
- Management pack `cramped-padding` + `clipped-overflow-container`: the Backlog column is cut at 1440 (see B7).
- Bahasa `all-caps-body`: long uppercase table headers.

**None of the real items comes from RD-S1.**

## ui-ux-pro-max lookups used

- `"number formatting abbreviated values"` → abbreviations OK for readability (Low).
- `"text truncation overflow"` → **Compact Label Overflow (High): "expose full text to keyboard pointer and touch users… don't use a hover-only tooltip / title-only recovery"**, and Essential Text Truncation (Critical).
- `"touch target size"` → WCAG 2.2 24 px web minimum; the tile links pass.
- `"color contrast text"` → 4.5:1. The KPI `?` is now full-opacity `muted-foreground` (RD-077 fixed).
- `"screen reader hidden text"` / `"label in name accessible"` → semantic names should match the visible label.
- `"tooltip hover only touch"` → Hover vs Tap (High).

## (a) RD-S1 regressions / defects — block merge

**A0 · Blocker · all dashboards · process.** The branch is 5 commits behind `dev` and **conflicts** in `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx` and `PMDashboard.tsx` (`git merge-tree` against `ddd389c9`, RD-C1/C2).
- *Who:* every reviewer. What I rendered isn't what will merge; the "0 at-risk", "all on track" and English Finance labels seen here are fixed on `dev`.
- *Fix:* rebase, then re-run this harness on Exec, Finance and PM (≈3 min).
- *Test:* none new; re-run AC-RD-GEOM-001 and this matrix after the rebase.

**A1 · Critical · Executive 390 (Admin) · screen reader.** When spend is known but small, the "Total project spend" drill link's name says **"Open spend breakdown · Not available yet spent to date"** while the screen shows **"IDR 0"**. "Small" means zero, or any amount whose short form equals the exact form.
- *Cause:* `MobileExecutiveDashboard.tsx` `spendText = spendFigure.exactValue ?? notAvailable`; `moneyFigure` omits `exactValue` when short === exact.
- *Who:* a screen-reader owner hears "unknown" for a known zero. That is the inverse of Unknowable-Is-Not-Zero, and the name no longer contains the visible value (WCAG 2.5.3).
- *Evidence:* `edge/exec-zero-spend-en-390-fold.png`, `edge/exec-zero-spend-crop.png`, AX snapshot `link "Open spend breakdown · Not available yet spent to date"`.
- *Fix:* `spendText = spendFigure.unavailableReason ?? spendFigure.exactValue ?? spendFigure.value`.
- *Graduating test:* unit/RTL `AC-RD-UNAVAIL-002`. `MobileExecutiveDashboard` with `on_hand_actual_known` 0 and 500: the link's accessible name contains "IDR 0" / "IDR 500" and never "Not available yet". With `null` it contains the reason.

**A2 · Important (owner call) · Procurement detail 1440/390 · scope.** RD-S1 shortened approval money: "PR value **$56.0K**" and the Budget impact panel ("This request $56.0K · Available $5.8M · Project budget $5.8M · After this request $5.7M"), right above **Approve**. It also shortened the selected-quote total and the project-detail PipelineLens stats.
- The ruling (OD-MONEY-FMT) says "short on **KPI cards**". This is a decision panel for approving money.
- *Who:* an approver checks a vendor quote that isn't verifiable at "56.0K". In IDR, "Rp 1,2 M" available vs "Rp 1,2 M" requested hides the margin they are judging.
- *Evidence:* `procurement/proc-decision-1440.png`, `procurement/proc-decision-390.png`.
- *Fix:* revert `ProcurementDetails.tsx`, `DecisionSupportPanel.tsx` (and arguably `PipelineLens.tsx`) to exact zero-fraction-trimmed money, unless the owner explicitly extends the ruling.
- *Graduating test:* RTL `AC-RD-MONEY-002`. DecisionSupportPanel and the PR value tile render the exact amount visibly ("IDR 1,240,000,000"), not a compact unit.

**A3 · Important · Executive 1440/390 EN+ID · unknown not explained.** "Pipeline forecast margin" now shows a bare **"—"**: in the tile with only "probability-weighted" under it, and at 30 px in the card above the stage bars. The reason ("No active budget") is in `title` + sr-only only.
- Before, the screen said why. Now a sighted user on a phone or keyboard can't learn why, which DESIGN.md calls "a bare dash reads as 'we forgot'".
- *Evidence:* `crops/exec-1440-forecast-margin-card.png`, `crops/exec-1440-kpi-band.png`, `exec-admin-en-390.png` (bottom card).
- *Fix:* keep "—" in the figure slot (RD-073 satisfied) and put the reason as the muted caption line. For KPITile, render `unavailableReason` in the `vs` slot when no `vs` is given, or prepend it. For ProjectedMarginBars, restore the caption span with the reason. RD-S2 later replaces both with the readiness notice.
- *Graduating test:* RTL `AC-RD-UNAVAIL-001` (extend): with `unavailableReason`, the figure text is "—" **and** a visible (non-sr-only) element in the same tile contains the reason.

**A4 · Important · gate strength · AC-RD-GEOM-001.** The design pass (§5) made "e2e spec + fixture helper, route-mocked fixture" an RD-S1 deliverable. The spec instead runs on the **USD seed**.
- *Computed:* seed figures like "$7,800,000.00" fit a 190 px tile even with the old exact format, so the gate would likely stay green on the pre-RD-S1 code and doesn't reproduce the client's bleed.
- It also omits `/revenue-by-project` and `/reports`, which RD-S1 changed.
- The figure classes now include `break-words`. A too-long figure would wrap mid-number instead of overflowing, which oracle 1 (`scrollWidth > clientWidth`) can't see.
- *Fix:*
  - port `harness/fixture.cjs` into an e2e helper (route-mock `get_executive_dashboard`, `get_win_rate`, `get_sales_pipeline`, `get_pm_dashboard_projects`, `organizations.default_currency=IDR`);
  - add the two routes;
  - add an oracle: each KPI figure line renders ≤ 1 line per currency (`getBoundingClientRect().height ≤ lineHeight × rows + 1`).
  - **Mutation-check:** temporarily return the exact form from `moneyFigure`; the spec must go red at 1440 on Finance (190 px tiles).
- *Graduating test:* the extended `AC-RD-GEOM-001` itself.

**A5 · Minor · Finance 1440/390 EN+ID.** The short form is applied where it is *longer* and fuzzier than the exact amount: "Outstanding invoices **IDR 30.0K**" / "**Rp 30,0 rb**", while the table row below says "IDR 30,000" / "Rp 30.000". The forced ".0" ("$56.0K", "IDR 30.0K") adds false precision.
- *Evidence:* `finance-en-1440-fold.png`, `crops/finance-id-1440-kpi-band.png`.
- *Fix:* in `moneyFigure`, use the exact form when it is ≤ the short form's length + 2 (or below 1,000,000). Use `minimumFractionDigits: 0`, or keep 1 only when non-zero.
- *Graduating test:* unit `dashboardMoney.test.ts`: `moneyFigure(30000,'IDR')` → value "IDR 30,000", no `exactValue`; `moneyFigure(56000,'USD')` doesn't contain ".0K".

**A6 · Minor · Finance 1440 (negative variant).** The visible short form uses a hyphen ("**-IDR 2.5B**") while its title and sr text use U+2212 ("−IDR 2,500,000,000"). The `vs` line also shows "-IDR 1.2B". One figure, two minus glyphs.
- *Evidence:* `edge/finance-negative-margin-crop.png`.
- *Fix:* normalise the compact output's leading `-` to `−` in `moneyFigure`/`shortMoney`.
- *Graduating test:* unit: `moneyFigure(-2.5e9,'IDR').value` starts with "−".

**A7 · Minor · all KPI tiles · a11y.** The figure container carries `title` (exposed as the AX *description*), and the same exact amount is in the sr-only span. Chrome's AX tree shows `generic desc: "IDR 160,890,500,000"` plus the text node, so screen readers that announce titles read it twice.
- *Fix:* move `title` onto the `aria-hidden` visible span in `FigureContent` (hover still works; AT ignores it).
- *Graduating test:* RTL KPITile: the element carrying `title` is `aria-hidden="true"`.

**A8 · Minor · Executive 1440/390 EN · mixed-currency tile.** The on-hand tile stacks "IDR 373.5B" over "**$3.4M**". RD-S1 dropped the "USD" code, so in an IDR org the second line is a bare dollar sign (Bahasa shows "US$3,4 jt", which is fine).
- *Evidence:* `crops/exec-1440-kpi-band.png`.
- *Fix:* for any currency other than the org's, format with `currencyDisplay: 'code'` ("USD 3.4M").
- *Graduating test:* RTL: in an IDR org, a USD on-hand row renders "USD".

## (b) Pre-existing issues owned by later slices (not RD-S1's to fix)

| id | Sev | Route / width | What the user sees wrong | Evidence | Owner | Graduating test |
|---|---|---|---|---|---|---|
| B1 | P1 | Exec all | A "Pipeline forecast margin" tile **and** card for a value that can't exist without budgets (RD-028) | `crops/exec-1440-kpi-band.png` | RD-S2 | AC-RD-EXEC-001 (one readiness notice; no forecast-margin tile while no budget) |
| B2 | P1 | Exec 1440/390, PM 1440 | "0 at-risk", "all on track", "At risk 0 · budget usage > 90%" with no budgets (RD-006) | `exec-admin-en-390-fold.png`, `pm-en-1440-fold.png` | RD-C1 (on `dev`; verify after A0) | AC-RD-RISK-001 (exists) |
| B3 | P2 | Finance 1440 EN/ID | Margin tile sub-line run-on (RD-013); English labels in Bahasa: "PRs awaiting you", "Total project spend", "Outstanding invoices" (RD-014) | `finance-id-1440-fold.png` | RD-C2 (on `dev`; verify after A0) | AC-RD-FIN-003 |
| B4 | P2 | Finance 1440 | A negative "Margin to date" is not shown in the destructive tone (no `negative` prop); DESIGN.md says negative values turn destructive | `edge/finance-negative-margin-crop.png` | RD-S3 | RTL: margin < 0 → figure has `text-destructive` |
| B5 | P2 | PM 1440 | Margin column "Not available yet" wraps into 3 lines in a 64 px slot (RD-043) | `pm-en-1440-fold.png` | RD-S4 | AC-RD-PM-001 |
| B6 | P1 | Exec 1440 | A full-width approvals tile with a blue Review button; "Nothing left to invoice on issued work orders" for an org without work orders (RD-024, RD-007) | `exec-admin-en-1440.png` | RD-S2 | AC-RD-EXEC-002 |
| B7 | P2 | Mgmt pack 1440; Revenue 1440 | Table money in **monospace** with ".00" (DESIGN.md says money is Inter-tabular; OD-MONEY-FMT says tables trim a zero fraction); the "Projects as at" Backlog column is cut at 1440 (detector cramped-padding/clipped) | `mgmtpack-admin-en-1440.png`, `revenue-admin-en-1440-fold.png` | T-n (these tables aren't in T2–T9; add as T10) | `AC-TBL-GEOM-001` route + RTL: no `font-mono` on money cells; "IDR 45,000,000,000" without ".00" |
| B8 | P2 | Mgmt pack 1440/390 | Position cards print prose in the figure slot ("**Unavailable USD**"), a double currency ("$7,200,000.00 USD"), and tiles label "· IDR" above a value that already says IDR (RD-073 class) | `mgmtpack-admin-en-1440.png` | Not in the slice plan: file a new issue | RTL: unavailable position → "—" + reason; currency named once |
| B9 | P2 | Sales 390/1440 | 11 px mono IDs on every card (detector tiny-text 57 at 390); 26 nested cards (RD-045) | `sales-admin-en-390.png`; detector JSON | RD-S5 / T4 | AC-RD-SALES-001 |
| B10 | P2 | Finance 1440 | The approval tile sits half-width with an empty half; 4 tiles in a 5-column grid (RD-034/035; detector nested-cards 7) | `finance-en-1440-fold.png` | RD-S3 | AC-RD-FIN-004 |

## (c) For the #806 redesign / owner

- **C1 · the exact amount is mouse-only.** The ruling puts it in `title` + sr text. Touch and keyboard sighted users can't reach it: focusing a tile shows no tooltip (verified, `[role=tooltip]` count 0 after focus). ui-ux-pro-max rates title-only recovery High. Proposal: a figure the user can focus or tap that reveals the exact amount (reuse the existing `Tooltip`), or show the exact amount on the drill target.
- **C2 · "M" means two things.** EN "IDR 373.5B" vs ID "Rp 373,5 M" (M = *miliar*); an English reader sees M as million, a 1000× gap for a bilingual team or a shared screenshot. Consider `compactDisplay: 'long'` on KPI cards ("Rp 373,5 miliar" / "IDR 373.5 billion"), or a unit legend.
- **C3 · funnel vs dashboard.** The Sales funnel stage cards look like KPI cards but show exact "IDR 38,200,000,000", while the dashboard shows "IDR 75.2B" for the weighted pipeline. Under the ruling they are exempt, but users will read them as one family. Decide in RD-S5.
- **C4 · structure.** The identical-tile KPI band (hero-metric template, craft-floor ban) and card-in-card nesting persist. This is the RD-S2/S3 restructure plus the #806 visual pass.

## Lens notes

- **A (visual).**
  - Tokens are intact: no new colour, radius or size; figures stay 23/700 tabular.
  - The `?` help icon is now full-opacity `muted-foreground` (RD-077 fixed).
  - Short forms remove the bleed at 1440/1024/768/390 in both languages.
  - Tile heights are still uneven because of the sub-lines (RD-026, RD-S2).
- **B (flow).** The owner can read the book in one glance on a phone. Friction left: A3 (no reason), C1 (exact amount hover-only).
- **C (IA).** No change. Tiles still all link to `/projects?filter=Ongoing`, as before.
- **D (intent).** *Owner, Executive:* "is the book healthy?" Contract, pipeline and spend are now legible. Forecast margin still takes prime space with no answer (Q3; B1). *Approver, procurement:* "is this request within budget?" A2 rounds exactly the figures the decision rests on (Q4).

### Heuristic snapshot (dashboards, RD-S1 build)

| # | Heuristic | /4 | Note |
|---|---|---:|---|
| 1 | Status visibility | 2 | Bare "—" without visible reason (A3); false "on track" (B2, fixed on dev) |
| 2 | Real world | 3 | Locale-correct short forms; "M" ambiguity across languages (C2) |
| 3 | User control | 3 | Drill links intact |
| 4 | Consistency | 2 | Short vs exact across tile/table/funnel by design; sign glyph (A6); "$" vs "IDR" (A8) |
| 5 | Error prevention | 2 | Rounded approval money (A2) |
| 6 | Recognition | 3 | Headline figures are scannable |
| 7 | Flexibility | 2 | Exact amount hover-only (C1) |
| 8 | Minimalism | 2 | Same structure as before (RD-S2 owns it) |
| 9 | Recovery | 2 | Reasons hidden (A3) |
| 10 | Help | 3 | Help icon now meets contrast |
| | **Total** | **24/40** | Acceptable; up from 21 in the source-only pass |

## Run notes

- **Servers:** Vite (PIDs 74488/74521) and the snapshot server (94048) were stopped by exact PID. One headless Chromium was open at a time and closed after each run.
- **DB:** no reset and no writes beyond sign-in sessions.
- **Fixture artifacts to ignore:** the Sales "excl. PPN 0.11%" (my fixture put 0.11 for an 11% rate), and column sums off by IDR 1,000 (rounding).
