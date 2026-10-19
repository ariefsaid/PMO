⚠️ DEGRADED: single-context, SOURCE-ONLY (this session had no shell, browser or sub-agent tool, so the app was not rendered, nothing was screenshotted, and `impeccable detect` did not run)

# Real-data design pass — dashboards, project Overview, tables (2026-10-19)

**Mode:** Operate. **Status:** findings, structure proposals, mockups and slice plan. No app change is authorized here.
**Authority:** [DESIGN.md](../../DESIGN.md) for identity and tokens; [PRODUCT.md](../../PRODUCT.md) for principles. Identity is preserved: no new colour, font or radius. Proposed DESIGN.md additions are listed in §6 and need owner sign-off.
**Trigger:** owner feedback from production on the first client's real data: a duplicate "Contract value on hand", 100% win rate despite a lost deal, amounts bleeding past card edges, and a project Overview that is "very scattered, no structure, lots of whitespace with no deliberate intent". The owner also asked for a TABLES section and decided to adopt column resizing.

## 0. Method and its limits — read first

- **What was done.** I read impeccable (SKILL, critique, audit, distill, layout, operate, craft-floor), taste and ui-ux-pro-max. Then I read every component that renders on the four pages, in the source as of `dev` @ `ddf8329b` (worktree `claude/v024-design-pass`). I reasoned each surface against a client-shaped synthetic dataset (§0.1) using the real layout code: grid templates, column counts, fixed widths, font sizes, formatters and the empty/unavailable branches.
- **What was not done.** No render, no screenshot, no `impeccable detect`, no axe. **Every finding is SOURCE-ONLY**, cited by `file:line` instead of a screenshot path. Overflow findings are width arithmetic (character count × font size against the track width), not measured pixels. Each is marked *computed* where that applies.
- **Why this is still decision-grade.** The owner's three symptoms (duplicate label, wrong win rate, bleeding amounts) and the "scattered Overview" all trace to specific branches and grid declarations, cited below. Rendering confirms them; it does not decide them.
- **Required follow-up (gate, not optional).** A `design-reviewer` Discover render with the fixture in §0.1, both widths, Admin and PM, before RD-S1 merges. Every finding there graduates per ADR-0030. RD-S1 ships the reusable fixture and geometry gate that makes this cheap.
- **Taste v1 conflict, resolved by DESIGN.md.** taste v1 bans Inter and pushes bento grids and perpetual motion. DESIGN.md (ADR-0068) locks Inter and calm motion, so only taste's states/a11y/anti-slop items were applied.

### 0.1 Client-shaped synthetic fixture (public repo: invented names and values)

Org currency IDR. Route-mock pattern: `pmo-portal/e2e/AC-S35-008-company-position-geometry.spec.ts` `installReadFixtures`. RPCs to mock: `get_executive_dashboard`, `get_win_rate`, `get_sales_pipeline`, `get_pm_dashboard_projects`, `get_finance_budget_review`, `get_unbilled_work_orders`, `get_project_finances`, `get_projects_money_collection`, `get_projects_delivery`, plus the `erp_*_snapshot` reads.

| Shape | Values used in mockups |
|---|---|
| 6 Ongoing, IDR | contracts 63,400,000,000 · 48,215,000,000 · 21,870,500,000 · 15,300,000,000 · 7,925,000,000 · 4,180,000,000 (Σ 160,890,500,000) |
| 19 Close Out, IDR + USD | 14 IDR Σ 212,640,000,000; 5 USD Σ 3,412,800 |
| 1 Loss Tender with value | IDR 9,750,000,000 |
| Open pipeline | Leads 7 / IDR 38.2 bn @10% · Pre-Qual 4 / 26.5 bn @25% · Quotation 5 / 54.9 bn @40% · Tender 3 / 71.3 bn @60% · Negotiation 0 (weighted Σ 75,185,000,000; gross 190,900,000,000) |
| Spending setup | 144 of 150 cost categories mapped (Actual partial everywhere) |
| Budgets / phases / invoices | **no** active budgets · **no** delivery phases · no invoices on most projects · no work orders |
| Strings | long Bahasa project names (60–95 chars), PO refs like `PO/GLN/2025/0412-REV.03` |

## 1. Findings register — 78 findings (no top-N)

Severity per impeccable: **P0** blocks the task · **P1** material confusion at a core job, or a WCAG AA failure · **P2** friction with a workaround · **P3** polish. "Who / wrong outcome" names the person and the mistake they make.

### 1.0 Counts

| Page | P0 | P1 | P2 | P3 | Total | of which correctness |
|---|---:|---:|---:|---:|---:|---:|
| Executive dashboard | 0 | 12 | 6 | 1 | 19 | 8 (4 owned by `claude/v024-dash-truth`) |
| Finance dashboard | 0 | 3 | 9 | 2 | 14 | 7 |
| PM dashboard | 0 | 0 | 4 | 0 | 4 | 1 |
| Sales pipeline cards | 0 | 0 | 4 | 1 | 5 | 2 |
| Project detail → Overview | 0 | 5 | 13 | 2 | 20 | 4 |
| Tables (app-wide) | 0 | 1 | 8 | 1 | 10 | 0 |
| Cross-cutting | 0 | 1 | 4 | 1 | 6 | 0 |
| **Total** | **0** | **22** | **48** | **8** | **78** | **22 correctness · 56 structure** |

### 1.1 CORRECTNESS — wrong or missing numbers, or claims the data can't support (22)

**Owned by the parallel lane `claude/v024-dash-truth`: referenced here, not duplicated:**

- **RD-001 · P1 · Exec** — Two tiles share the label "Contract value on hand" but show different figures (`on_hand_value` vs `total_contract_value`). `ExecutiveDashboard.tsx:270,333`. *Who:* the owner can't tell which one is the book. *Principle:* consistency (H4).
- **RD-002 · P1 · Exec** — Win rate by value reads 100% although a Loss Tender with value exists. `WinRateCard.tsx:82-86` / `get_win_rate`. *Who:* the owner overrates bid success. *Principle:* show money only when it is right.
- **RD-003 · P1 · Exec** — IDR + USD close-outs collapse the on-hand figures to "Not available yet" instead of showing each currency. `ExecutiveDashboard.tsx:115-116`. *Principle:* unknown is never zero, but known per-currency figures must still show.
- **RD-004 · P1 · Exec** — Pipeline-stage amounts sit in a fixed `w-[68px]` slot and clip. `ProjectedMarginBars.tsx:83`. *Principle:* craft-floor text-overflow.

**Not covered by that lane:**

- **RD-005 · P1 · Exec/Finance** — "Total project spend" labels a **partial** sum (144/150 categories) as a total. `ExecutiveDashboard.tsx:351-352`, `FinanceDashboard.tsx:426-427`, `MobileExecutiveDashboard.tsx:174-177`. *Who:* the owner treats IDR 58 bn as all project cost; 6 categories are missing. *Principle:* DESIGN.md Unknowable-Is-Not-Zero (a partial is a claim).
- **RD-006 · P1 · Exec + PM** — Risk is asserted where it can't be computed. With no active budgets and no dated phases: desktop "0 at-risk" (`ExecutiveDashboard.tsx:321`), mobile "**all on track**" (`MobileExecutiveDashboard.tsx:135-137`), PM "At risk 0 · budget usage > 90%" (`PMDashboard.tsx:86-90`). *Who:* the owner and PM read false reassurance. *Principle:* Unknowable-Is-Not-Zero; Stated-State.
- **RD-007 · P2 · Exec** — "Nothing left to invoice on issued work orders" leads the chart area for an org that doesn't use work orders while billions are un-invoiced. `StillToInvoiceCard.tsx:43`. *Who:* the owner skims it as "nothing to bill". *Principle:* plain language / honest scope.
- **RD-008 · P2 · Exec mobile** — The same figure has a different label on phone ("Contracted revenue", "Total contract value") and desktop. `MobileExecutiveDashboard.tsx:276,293`. *Principle:* CW-7 same terms on both. *Coordinate with RD-001.*
- **RD-009 · P1 · Finance** — The "Outstanding invoices" tile is **vendor** invoices awaiting payment (payables), on a page that also shows customer AR. `FinanceDashboard.tsx:438-443`. *Who:* Finance reads money owed by vendors as money owed to the company. *Principle:* match the real world (H2).
- **RD-010 · P1 · Finance** — The actuals snapshot renders a missing Net as `0`. `AccountingSnapshotsSection.tsx:161` (`r.net ?? 0`). *Principle:* Unknowable-Is-Not-Zero.
- **RD-011 · P2 · Finance** — Actuals rows are per project, but the table has no Project column, so two projects on the same account and fiscal year look like duplicate rows. `AccountingSnapshotsSection.tsx:141-163` (acknowledged at `:255-259`).
- **RD-012 · P2 · Finance** — "Contract value in progress" help says "active and closed-out" but the figure is the Ongoing-only total. `FinanceDashboard.tsx:420-424` vs `ExecutiveDashboard.tsx:326-328`.
- **RD-013 · P2 · Finance** — The margin tile sub-line appends a label with no value ("· Known margin on billed work ·"). `FinanceDashboard.tsx:434-435`.
- **RD-014 · P2 · Finance** — 14+ hard-coded English strings: "PRs awaiting you" `:416`, "Total project spend" `:426`, "Outstanding invoices" `:438`, "vendor-invoiced, awaiting payment" `:440`, Ready-to-pay headers `:79,101,115`, `daysAgoLabel` `:42-44`, empty/error copy `:142-144,402`, snapshot titles/headers `AccountingSnapshotsSection.tsx:79-159,247,265`. *Who:* Bahasa users get English money labels.
- **RD-015 · P3 · Finance** — Aging cells print the currency twice ("IDR 1,234 IDR"). `AccountingSnapshotsSection.tsx:50-52`.
- **RD-016 · P2 · Sales** — The table Stage column prints the raw stored status ("PQ Submitted", "Loss Tender") while the board and funnel say "Pre-Qual"; it isn't translated. `SalesPipeline.tsx:266`.
- **RD-017 · P2 · Sales (latent, conditional)** — Stage totals are formatted in the org currency whatever the deal currency. `SalesPipeline.tsx:192-196`. One USD opportunity would be mislabelled. The client's open pipeline is IDR-only today; needs an RPC check.
- **RD-018 · P1 · Overview** — One figure, two stories on the same page: the header says Actual is "Incomplete — see spending details" (`ProjectDetailHeader.tsx:164-170`), while Project finances prints "Recorded spending IDR …, partial" (`ProjectFinancesSection.tsx:131-137`). *Who:* the owner can't tell whether spending is known.
- **RD-019 · P2 · Overview** — "No budget" (`ProjectFinancesSection.tsx:93`) and "No active budget" (×3 elsewhere) name one state two ways. "No budget" is false when draft versions exist.
- **RD-020 · P2 · Overview** — Mixed precision on one strip: Contract is whole (`ProjectDetailHeader.tsx:221`), contract-after-cost has 2 decimals (`:182`), finances use exact `.00`.
- **RD-021 · P2 · Overview** — The spending-setup link uses raw `text-primary` as text, which DESIGN.md records as sub-AA in dark. `ProjectFinancesSection.tsx:144`. **The #1044 plan's Slice A task 2 snippet repeats this; use `text-primary-text`.**
- **RD-022 · P2 · PM** — One project missing a contract, or a second currency, erases the whole "My contract value" figure. `PMDashboard.tsx:46-47,81`. *Related to RD-003; show per currency.*

### 1.2 STRUCTURE / HIERARCHY (56)

**Executive dashboard (11)**

- **RD-023 · P1** — Six equal KPI tiles in a 1/2/3/4-column grid leave an orphan row (4+2 at ≥1180) and no figure leads. `ExecutiveDashboard.tsx:259-262`. *Principle:* layout squint test; craft-floor bans the identical-card grid.
- **RD-024 · P1** — The approvals tile is outside any grid, so it renders **full width** (~1150 px) holding "0 · nothing waiting" plus a blue **Review** button that leads to an empty inbox. `ExecutiveDashboard.tsx:252-256`, `AwaitingApprovalTile.tsx:98`. *Who:* the owner sees whitespace and a call to action with nothing behind it. *Principle:* One-Blue; clear queue is compact (DESIGN.md §7).
- **RD-025 · P1 · computed** — KPI value overflow. 23 px/700 exact IDR with `.00` ("IDR 160,890,500,000.00", 22 chars ≈ 290 px) in a ~250 px content box (4-column at 1440). The value `div` has no `min-w-0`, and Intl joins symbol and digits with a non-breaking space. `KPITile.tsx:187-194`. *Who:* the owner sees amounts cross card edges (reported). *Principle:* craft-floor text-overflow.
- **RD-026 · P1** — Tile sub-lines carry 3–4 facts: tile 1 has contract-after-Actual, margin label and value, and two coverage sentences. `ExecutiveDashboard.tsx:272-273,353-355`. Tiles reach uneven heights; sub-lines wrap 4–5 times.
- **RD-027 · P1** — Partial-spending coverage is explained **N times**: tile 1, tile 6, every BvA row (`BvACard.tsx:82-88`) and the mobile drill cell (`MobileExecutiveDashboard.tsx:180-181`). *Principle:* distill (say it once).
- **RD-028 · P1** — "Pipeline forecast margin" takes a tile and a card headline even though, with no budgets, it can never be computed. The reason prints at 23 px and 30 px. `ExecutiveDashboard.tsx:128-134,300-311`, `ProjectedMarginBars.tsx:49-51`.
- **RD-029 · P2** — BvA rows each repeat "Active-budget risk: No active budget", and draw no bar while Actual is incomplete. "Spending vs contract" then compares nothing. `BvACard.tsx:71-81`.
- **RD-030 · P2** — Icon-tile tones are decoration, not meaning: red for spend implies danger; a blue tile on a non-action tile breaks One-Blue. `ExecutiveDashboard.tsx:283-351`, `KPITile.tsx:16-21`.
- **RD-031 · P2 (conditional)** — Chart cards use `items-start`, so bottoms are ragged. The "PMO purchasing requests" chart stays near-empty for ERP-native purchasing. `ExecutiveDashboard.tsx:164-187`.
- **RD-032 · P2 · computed** — The mobile "Total project spend" drill cell stacks a value and two 11 px coverage sentences in a ~165 px half-width cell (6+ lines). `MobileExecutiveDashboard.tsx:168-186`.
- **RD-033 · P3** — The subtitle promises metrics the page can't show ("margin on hand, pipeline forecast"). `ExecutiveDashboard.tsx:247`.

**Finance dashboard (7)**

- **RD-034 · P2** — The approvals tile sits alone in a 2-column grid: a half-width tile plus an empty half. `FinanceDashboard.tsx:415-417`.
- **RD-035 · P2** — The KPI grid declares 5 columns for 4 tiles, leaving an empty fifth slot at ≥1180. `FinanceDashboard.tsx:418`.
- **RD-036 · P1** — For this org the page is up to five stacked ~200 px empty blocks: Ready to pay, Budget review ("No active budgets ready for review"), Actuals, AP, AR. `FinanceDashboard.tsx:455-521`, `ListState.tsx:126` (`py-14`). *Who:* Finance scrolls past emptiness to find one figure.
- **RD-037 · P2** — "Ask your administrator to sync accounting data" appears ×3, shown to the Admin who *is* the administrator. `AccountingSnapshotsSection.tsx:249,267,280`.
- **RD-038 · P2** — The aging Party cell repeats snapshot-level metadata (report date, ageing basis, ERP ranges) on every row. `AccountingSnapshotsSection.tsx:94-98`.
- **RD-039 · P2** — The purchasing chart sits alone in a 2-up grid: half width plus an empty half. `FinanceDashboard.tsx:523-541`.
- **RD-040 · P3** — Title jargon: "Budget review — top 5 by variance (portfolio-wide)". `FinanceDashboard.tsx:473`.

**PM dashboard (3)**

- **RD-041 · P2** — The approvals tile sits alone in a 2-column grid. `PMDashboard.tsx:68-70`.
- **RD-042 · P2** — A 4-column KPI band holds 3 tiles, leaving an empty slot at ≥1180. `PMDashboard.tsx:72`.
- **RD-043 · P2 · computed** — The 64 px margin slot (`w-16`) receives "Not available yet" in 13 px bold, which wraps into 3 lines and bleeds. The column has no header; its caption sits in the card head. `PMDashboard.tsx:111,143-147`.

**Sales pipeline cards (3)**

- **RD-044 · P2** — Funnel bars default to primary blue, so five blue bars plus the selected stage compete with "New project". `Funnel.tsx:140`; `SalesPipeline.tsx:185-198` passes no `barColor`. *Principle:* One-Blue.
- **RD-045 · P2** — The project cell spells out "PMO Project Number: …" and "Client Project Code: …" in 11 px mono on every row. `SalesPipeline.tsx:237-244`. *Principle:* recognition before compression.
- **RD-046 · P3** — The same pipeline is exact with `.00` on the dashboard and whole on Sales (`SalesPipeline.tsx:193` vs `ExecutiveDashboard.tsx:115`).

**Project detail → Overview (16)** — Admin, Ongoing, no budget, phases, invoices or work orders.

- **RD-047 · P1** — **The page says "nothing here" about 12 times:** 3 header tiles (RD-048), the phases prompt, Budget utilization, Budget snapshot, empty Procurement summary, "No submitted invoices", "No budget", the drawdown with zero orders, P&L "not available yet", and the empty progress curve. `ProjectDetail.tsx:214-251`, `OverviewTab.tsx:175-484`. *Who:* the owner's "scattered, whitespace with no intent". *Principle:* distill; one main job per screen.
- **RD-048 · P1** — Header strip: 3 of 5 values are prose reasons in 17 px bold ("Incomplete — see spending details", "Unavailable", "No active budget"). "PMO purchase orders: Not tracked in PMO yet" spends a tile on a capability the org doesn't use. `ProjectDetailHeader.tsx:216-286`.
- **RD-049 · P1 · computed** — Header strip bleed between 768 and 1180 px. `md:grid-cols-5` gives ~140–200 px per tile, and a signed exact "+IDR 29,812,225,000.00" (non-breaking, ~210 px at 17 px bold) crosses into the neighbouring tile. `ProjectDetailHeader.tsx:559-563`, `StatTiles.tsx:102-115`.
- **RD-050 · P1** — Row 1 is a `lg:grid-cols-2` grid holding only "Budget utilization" for finance roles: a half-width card saying "No active budget" next to ~560 px of nothing. `OverviewTab.tsx:179-267`.
- **RD-051 · P2** — Row 2 puts two ~200 px empty states side by side ("No purchase requests…" / "No active budget"). `OverviewTab.tsx:279-483`.
- **RD-052 · P2** — "No active budget" is said 4× on one page (Spend tile, Budget utilization, Budget snapshot, "No budget").
- **RD-053 · P2** — The empty phases prompt leads Overview with fake progress bars in `primary/20` (blue decoration standing in for content) plus a primary button. `MilestoneStrip.tsx:461-485`. *Principle:* craft-floor bans decorative chrome; One-Blue.
- **RD-054 · P2** — The progress-curve empty state (~200 px) restates the phases gap. `ProjectSCurve.tsx:87-101`.
- **RD-055 · P2** — P&L puts its period picker above its own title and reads "Statements are not available yet" for every project. `ProjectProfitLossSection.tsx:128-178`.
- **RD-056 · P2** — With zero work orders, the drawdown shows Ceiling (= Contract), 0, 0 and Headroom (= Contract). The contract value prints 3× on the page. `ProjectDrawdown.tsx:133-163`.
- **RD-057 · P2** — Peer sections use five heading treatments (14/700 h2, 16/600 h2, 14/600 h2, 15/600 h3, non-heading CardHead). `MilestoneStrip.tsx:232`, `ProjectDrawdown.tsx:80`, `ProjectFinancesSection.tsx:26`, `ProjectSCurve.tsx:83`, `OverviewTab.tsx:224,282,394`.
- **RD-058 · P2** — Five different section intervals (`mb-6`, `space-y-8`, `gap-6`, `mt-8`, `border-y py-4`), and Project finances is a ruled band while its siblings are bare cards. `ProjectDetail.tsx:217,240,246`, `OverviewTab.tsx:175,179`, `ProjectFinancesSection.tsx:80`. *Principle:* layout rhythm.
- **RD-059 · P2** — Two disclosures overlap: header "More project details" and "Project details and actions" both carry PMO number and client code. `ProjectDetailHeader.tsx:204-212`, `ProjectDetailRail.tsx:69-145`.
- **RD-060 · P3** — Bare `<p role="status">` lines float between a `dl` and an `h3` with no type role. `ProjectFinancesSection.tsx:92-93`.
- **RD-061 · P3** — Over-long label: "Billed-work revenue (net of tax, advances excluded)". `ProjectFinancesSection.tsx:113`.
- **RD-062 · P2** — On phone the money position and remedies sit roughly 4 screens below the empty phases prompt. `ProjectDetail.tsx:214-251`.

**Tables, app-wide (10)**

- **RD-063 · P1** — Partial or unknown state repeats on every row in 10 px text: "Incomplete source coverage", "ERP actual", "As of …", "No active budget". `Projects.tsx:640-653,694-723`. With the client's data, 25 rows each carry 2–3 caveats.
- **RD-064 · P2** — There is no primary-cell contract; every table invents its identity cell. `Projects.tsx:422-470`, `SalesPipeline.tsx:220-249`, `FinanceDashboard.tsx:80-90`.
- **RD-065 · P2** — The status pill is forced to 10 px, `max-w-[68px]`, wrapping. `Projects.tsx:566`. Below the Label token (12 px).
- **RD-066 · P2** — Numeric columns stack prose under the value, right-aligned, so the column edge is ragged. `FinanceDashboard.tsx:350-371`, `Projects.tsx:610-655`.
- **RD-067 · P2** — No group or total row inside the table: `TableFoot` is a `div` outside `<table>` (`DataTable.tsx:887-901`), so totals can't align to their columns. Raw tables each invent a `tfoot`.
- **RD-068 · P2** — 12 hand-rolled tables use 4 header styles, and 6 of them have no phone branch (§4.3).
- **RD-069 · P2** — `whitespace-nowrap` on every body cell (`DataTable.tsx:408`): any consumer that forgets `truncate` forces horizontal scroll, and long Bahasa names are the norm here.
- **RD-070 · P2** — Sales invoices: 10 columns at one weight, 3 of them dates, and no primary identity cell. `SalesInvoices.tsx:673-857`.
- **RD-071 · P3** — Sortable headers show no cue until active. `DataTable.tsx:327-337`.
- **RD-072 · P2** — Money precision differs between tables: whole (Ready to pay, Budget review, Pipeline, Projects), cents (Expense lines, Advance aging, Still to invoice), exact `.00` (tiles).

**Cross-cutting (6)**

- **RD-073 · P1** — Unavailable reasons are rendered *as the figure* (bold 17–30 px) instead of DESIGN.md's rule: "—" with the reason attached (`title` + `sr-only`). `ExecutiveDashboard.tsx:115-116`, `ProjectDetailHeader.tsx:164-170,180-182,276-284`, `ProjectedMarginBars.tsx:50`, `PMDashboard.tsx:146`. *Who:* reasons shout like numbers, so the eye can't find the numbers.
- **RD-074 · P2** — Dashboard IDR always carries `.00` (`dashboardMoney.ts:7` → `format.ts:89-91`): 3 extra characters per billions figure and the main contributor to the bleed.
- **RD-075 · P2** — Six figure sizes (34/30/23/17/15/13) with no named token. `WinRateCard.tsx:130`, `ProjectedMarginBars.tsx:49`, `KPITile.tsx:188`, `StatTiles.tsx:104`, `ProjectDrawdown.tsx:53`, `BvACard.tsx:61`.
- **RD-076 · P2** — `CardHead` is a `div`, so card titles are absent from heading navigation on every dashboard and on Overview. `Card.tsx:53-67`.
- **RD-077 · P2** — The KPI help "?" is 15 px at 55% opacity, ~2.4:1 against the card (below WCAG 1.4.11's 3:1). `KPITile.tsx:120`.
- **RD-078 · P3** — DESIGN.md's YAML omits `--primary-text`, which `index.css:94,176` defines and DESIGN.md's prose relies on (doc drift).

### 1.3 Heuristic snapshot (source-based, all four pages together)

| # | Heuristic | /4 | Deciding observation |
|---|---|---:|---|
| 1 | Visibility of status | 2 | States exist but repeat N times; risk is claimed while unknowable (RD-006) |
| 2 | Match real world | 2 | "Outstanding invoices" means payables; raw stage enums |
| 3 | User control | 3 | Drill links and disclosures exist |
| 4 | Consistency | 2 | Duplicate labels, 5 heading treatments, 3 money precisions |
| 5 | Error prevention | 3 | Partial figures are mostly qualified |
| 6 | Recognition | 2 | Remedies scattered across pages |
| 7 | Flexibility | 2 | No column sizing; no grouping |
| 8 | Aesthetic / minimalist | 1 | ~12 empties on Overview; empty dashboards |
| 9 | Error recovery | 2 | Remedies exist, but buried in sub-lines |
| 10 | Help | 2 | Help tooltips low-contrast; copy implementation-led |
| | **Total** | **21/40** | **Acceptable — structural, not a reskin** |

**Persona red flags.** *Owner-operator (Admin, real data):* opens Executive, sees a duplicate label, 100% win rate, amounts crossing card edges and "all on track" on phone, and can't trust any of it. *PM:* opens a project, scrolls past a fake-bar phases prompt and three "no budget" messages before reaching any figure. *Bahasa Finance user:* Finance dashboard headers and labels are English (RD-014).

## 2. Page structure proposals

**Shared rules (all pages):**

- **One readiness notice per page** replaces every coverage/unavailable sub-line. It is a `details`, open on desktop and closed on phone, listing each gap once with its consequence and remedy. Remedies follow the real role's capability (#1044 logic).
- **The attention band is compact** (≤120 px, DESIGN.md §7). The primary button appears **only when there is work**; zero means a text link.
- **Figures** use the `metric` role (23/700), stepping to 17 when their slot is under 230 px (container query, two fixed steps). Exact amounts; a zero fraction is not printed. An unavailable figure is "—" with the reason attached, never prose in the figure slot.
- **Empty sections don't render** when the readiness notice or checklist already names the gap. "Genuine absence" (Stated-State exception) is used only where the capability is absent.
- **Rhythm** (proposed DESIGN.md roles, §6): 32 between sections, 16 between groups, 8 between items, 4 inline. Section titles use `subheading` (18/600) as real `h2`s.

### 2.1 Executive dashboard — mockups [1440](mockups/2026-10-19-real-data/executive-1440.html) · [390](mockups/2026-10-19-real-data/executive-390.html)

- **One job (Admin/Executive):** what needs me now, and is the book healthy?
- **Order:**
  1. Head with Board pack (outline).
  2. Attention band: approvals count; risk, which reads "can't be checked yet" with its reason.
  3. Readiness notice: spending 144/150 → *Review spending setup*; no budgets → margin and risk unavailable; USD close-outs shown per currency.
  4. **Contract book:** three figures — contract value in delivery (6 projects), recorded spending (*Partial* badge), weighted pipeline of gross. Close-outs on one per-currency line.
  5. Two columns, 7/5: a **Delivery projects** table (contract, spending with one caveat footnote, total row) | **Pipeline by stage** (neutral bars, amount column ≥150 px, weighted total) plus **Win rate** (count, then value per currency).
  6. Disclosure: PMO purchasing, work orders.
- **Delete:** duplicate contract tile (RD-001/dash-truth), *Pipeline forecast margin* tile and card headline (into the notice), *Active projects* tile (count under contract), full-width approvals tile, BvA "No active budget" per row, Still-to-invoice when the org has no work orders.
- **Phone:** same order, one column, project cards, notice collapsed.
- **A11y:** section `h2`s; approvals link name includes the count; figure `aria-describedby` points at the notice item; focus order follows visual order.

### 2.2 Finance dashboard — [1440](mockups/2026-10-19-real-data/finance-1440.html) · [390](mockups/2026-10-19-real-data/finance-390.html)

- **One job (Finance):** what to pay, what to collect, whether the books are in sync.
- **Order:**
  1. Attention band: purchase requests awaiting (primary *Review N* only when N>0); vendor invoices ready to pay.
  2. Readiness notice: last sync time, spending coverage, no budgets → no budget review.
  3. Three figures: **Vendor invoices to pay** (renamed, RD-009), recorded spending (partial), contract value in delivery.
  4. **Ready to pay** table with a total row.
  5. **Customer collections:** ERP AR aging **verbatim**. Buckets and totals are not regrouped or summed (ADR-0048); report date and basis go in the section caption, once.
  6. Disclosure: AP aging, spending by account (with a Project column, RD-011).
- **Delete:** the *Margin to date* tile until invoices exist (into the notice), Budget review while no active budget, the three "ask your administrator" empties, the half-width purchasing chart.

### 2.3 PM dashboard — no separate mockup (same grammar as 2.1)

- **One job (PM):** which of my projects need me?
- **Order:** attention band (approvals + "risk can't be checked yet") → readiness notice → **My projects** table (primary cell, status, contract, spending, delivery %, margin with a real header) → spending-vs-contract only when Actual is complete.
- **Delete:** the separate KPI band (its three facts move to the table caption: "6 projects · IDR … contract"), the 64 px margin slot.

### 2.4 Sales pipeline cards — [1440](mockups/2026-10-19-real-data/sales-pipeline-1440.html) · [390](mockups/2026-10-19-real-data/sales-pipeline-390.html)

- **One job:** where is the pipeline value, and which opportunities move next?
- **Funnel:** neutral bars (`chartTheme.axis`); blue only on the selected stage and "New project". Exact amounts without `.00`. Board titles in the table's Stage column. Each stage shows count, value and weighted value.
- **Phone:** the funnel becomes a stage list that drives one opportunity list (UX-047 direction kept).
- **Guard:** stage totals render "—" with a reason if the stage holds more than one currency (RD-017).

### 2.5 Project detail → Overview — [1440](mockups/2026-10-19-real-data/project-overview-1440.html) · [390](mockups/2026-10-19-real-data/project-overview-390.html)

- **One job (Admin/PM):** is this project OK, and what do I do next?
- **Order:**
  1. Identity header: name (full width, wraps), status, customer · PO, Edit/Archive.
  2. **Money position, three figures:** Contract (tax-basis disclosure) · Invoiced to date with left-to-invoice · Recorded spending with *Partial* badge, coverage and update date. These are existing fields; nothing new is derived.
  3. Tabs.
  4. Overview body, 8/4 grid:
     - **Left (work with data):** Spending by category (known categories only; footnote names the 6 missing, no new total, per #1044 Slice A), then Delivery phases, Procurement, Drawdown and P&L, each **only when it has data**. Comments last.
     - **Right:** "**Complete this project's picture**" checklist (add phases → progress; activate a budget → risk and forecast; finish spending setup → complete spending (role-gated per #1044); raise the first invoice → margin and cash), then **Details** (one disclosure set: PM, dates, codes, accounting project from #1044 Slice B, change status).
- **Delete:** header tiles *PMO purchase orders* (when not tracked), *Contract remaining after cost* and *Spend %* (both return with a budget and complete Actual); Budget utilization card; Budget snapshot card (budget facts move into the money position once a budget exists); empty Procurement summary; empty-phases hero with fake bars; empty S-curve; unavailable P&L block; "No budget" / "No submitted invoices" lines; the duplicate header disclosure; the drawdown when there are zero work orders.
- **Phone:** identity → money (stacked) → tabs → checklist → spending.
- **Partial or unavailable data shown once:** the *Partial* badge on the spending figure plus one checklist row. Nothing else repeats it.

## 3. Owner-sign-off items and open questions

1. **Exact vs compact money on dashboards.** I propose **exact, zero-fraction suppressed, with wider slots**. A prior plan rules out compacting funnel amounts (`docs/plans/2026-09-28-sales-funnel-readability-e64b9e96.md:70`). Compact ("IDR 160.9 bn") would need your explicit yes.
2. **Proposed DESIGN.md additions** (§6): spacing roles, figure roles, readiness notice, attention band, DataTable column types and resize handle, zero-fraction rule, `--primary-text` in the YAML.
3. **Hide-when-empty vs show-empty** for Still-to-invoice, P&L and Drawdown. I propose hiding them when the capability is unused, with the gap named in the checklist or notice. This reverses parts of "every state gets its own string", narrowly: the gap is stated once, not per block.
4. **Column-width persistence** is per user, per device (localStorage, the same precedent as the assistant panel width). Cross-device sync would need a server preference; not proposed now.
5. **Executive role default:** #1044's proposal that Executive stays delivery-facing is assumed.

## 4. TABLES — the DataTable hierarchy contract (T1)

**Decision context.** We adopt `@tanstack/react-table`, inside `DataTable` only (owner decision). Lane `claude/v024-datatable-tanstack` moves the internals and adds column resizing with **no visual change**. This contract is the visual layer that lands on top. **No other new dependency:** virtualization isn't needed at current list sizes (≤ a few hundred rows, server-filtered), and pivot isn't needed.

### 4.1 Column types (every column declares `type`; widths in px; table uses `table-layout: fixed`)

| `type` | Content and hierarchy | Align | Default | Min | Max | Resizable |
|---|---|---|---:|---:|---:|---|
| `primary` | Name 13.5/600 `foreground`, wraps to **2 lines** then clamps (full name in `title`); **one** secondary line 12 px `muted-foreground`, either a second fact (customer) or one ID in mono 12 px. Never 10–11 px. | left | fills remaining (320 if the table overflows) | 240 | 640 | yes |
| `text` | 13.5/400 `foreground` (customer, project, vendor) | left | 180 | 120 | 360 | yes |
| `meta` | 13.5/400 `muted-foreground` (PM, source, scope) | left | 160 | 112 | 320 | yes |
| `money` | `tabular`, 13.5/500; **currency code in the header** ("Contract · IDR") when the column holds one currency, otherwise per cell; zero fraction suppressed; unknowable → "—" with `title` + `sr-only` reason | right | 184 | 152 | 320 | yes |
| `number` / `percent` | `tabular` 13.5/400 | right | 96 | 72 | 160 | yes |
| `status` | `StatusPill` via `statusVariants.ts` — 22 px, 12/600 label, dot; never shrunk, never wrapped | left | 140 | 112 | 220 | yes |
| `date` | `tabular`, `formatDateOnly`, year always present | left | 120 | 104 | 160 | yes |
| `actions` | ⋯ trigger, sticky right (existing AC-TBL-STICKY-001) | — | 40 | 40 | 40 | **no** |
| `select` | checkbox | — | 40 | 40 | 40 | **no** |

**Column budget:** at 1440 the primary column must keep ≥240 px with the ⋯ visible. Merge a related fact into the secondary line before adding a column (DESIGN.md "Column budget").

### 4.2 Header, rows, groups, totals, states

- **Header:** 38 px; Table-Header type (11.5/600/0.03em uppercase, `muted-foreground`); numeric headers right-aligned; truncates with `title`. **Sort cue:** sortable headers show a 12 px up/down icon at `muted-foreground/40` at rest, solid `foreground` with direction when active; `aria-sort` stays.
- **Body:** min 54 px; a 2-line primary grows the row to ~68 px; row hover `accent/60`; selected `primary/7`. One density, no toggle. Drop the blanket `whitespace-nowrap` (RD-069): `primary`/`text` wrap per the rules above; `money`/`date`/`status` stay `nowrap`.
- **Group rows** (`groupBy`): 38 px, `secondary/40`, label 13.5/600 plus muted count, collapsible (`button`, `aria-expanded`). Subtotals in money columns are **one line per currency**, never summed across currencies.
- **Total row:** inside `<tfoot>` (replaces the out-of-table `TableFoot`), 44 px, 1.5 px top `border`, `secondary/40`, 600 tabular, one row per currency.
- **Partial / unknown — once (RD-063/066):** a column `caveat: { reason, remedy }` adds a `*` mark in `warning-foreground` to the header (`aria-describedby` → footnote) and **one footnote** under the table with the remedy link. Row-specific exceptions mark only that row. Cells never stack prose under the figure.
- **Empty:** secondary tables (dashboards, record panels) use a **compact** empty (≤120 px, one line plus optional remedy). Primary list pages keep the full `ListState`, without repeating the header's primary action (One-Blue).
- **Loading:** 5 skeleton rows sized to the column widths. **Error:** existing inline error plus Retry.
- **Phone (<768):** the existing card branch. Primary becomes the card title plus secondary line; group headers stay; footnote once. **No resizing** on cards.

### 4.3 Resize handle (look and behaviour, DESIGN.md tokens)

- **Hit area:** 8 px straddling the header's right edge, full header height (16 px on coarse pointers ≥768 px).
- **Look:**
  - At rest: nothing beyond the existing 1 px header divider.
  - Header hover: 2 px line in `--input`, inset 8 px top and bottom.
  - Handle hover: `--muted-foreground/60`.
  - Focus: the global ring (2 px `--ring`), drawn **inward** (`outline-offset:-2px`, per DESIGN.md's focus-ring-inside-scroller rule).
  - While dragging: line in `--ring`.
  - Cursor `col-resize`; no animation.
- **Semantics:** focusable `role="separator"` (window-splitter pattern) with `aria-orientation="vertical"`, `aria-valuenow`/`min`/`max` in px, `aria-controls` on the header id, and a localized `aria-label` "Resize {column} column". (The assistant panel uses `role="slider"`; aligning both on `separator` is a follow-up note, not part of this lane.)
- **Keyboard:** ←/→ ±16 px (panel precedent); Shift ±64; Home = min; End = max; Enter = reset to default. Double-click also resets. Escape during a pointer drag restores the starting width.
- **Persistence:** **per table, per user, per device.** Key `pmo.table.<tableId>.widths.v1:<userId>`, value `{ [columnKey]: px }`.
  - Read and write wrapped in try/catch (Safari private mode), clamped on read; unknown keys ignored; new columns take their defaults; bump `v1` when the column model changes.
  - `tableId` is required whenever columns are resizable.
  - "Reset column widths" sits in the table toolbar's More menu.
  - Not in the URL.

### 4.4 The 12 hand-rolled tables → TanStack-backed DataTable

| # | File | Today | Disposition |
|---|---|---|---|
| 1 | `pages/ProjectBudget.tsx` (2 tables) | editable line items, token header, no phone branch | migrate (T5); editable cells as `cell` render; after #1044 Slice D |
| 2 | `pages/BudgetProjection.tsx` | own phone reflow (`block sm:table-cell`) | migrate (T5) — reuse card branch; after #1044 Slice D |
| 3 | `pages/admin/BudgetAccountMap.tsx` | token header, own reflow | migrate (T5) |
| 4 | `pages/project-detail/ProjectFinancesSection.tsx` | unstyled `th` with no padding, inside `details` | migrate inside RD-S6 (Spending by category) |
| 5 | `pages/expenses/ExpenseLinesCard.tsx` | sentence-case `py-1` header, `tfoot` total, no phone branch | migrate (T6) with total row |
| 6 | `pages/expenses/AdvanceAgingCard.tsx` | sentence-case header, no phone branch | migrate (T6) |
| 7 | `pages/incoming-payments/ReceiptRecord.tsx` | `px-3 py-2 font-medium` header, no phone branch | migrate (T6) |
| 8 | `pages/procurement/LineItemsSection.tsx` | token header, inline edit rows | migrate (T7) |
| 9 | `pages/procurement/VendorQuotesTab.tsx` | CSS grid with **no table semantics** (comparison + select) | migrate (T7) with a `select` column; table semantics restore AT row/column navigation |
| 10 | `src/components/integrations/IntegrationsView.tsx` | `px-3 py-2` header, no phone branch | migrate (T8) |
| 11 | `src/components/import/ImportWizard.tsx` | `px-2.5 py-1.5` header, English "Row/Status" | migrate (T8) + i18n |
| 12 | `src/components/ui/TimesheetGrid.tsx` (2 tables) | input grid, sticky first column, `tfoot`, own phone branch | migrate **last** (T9) — needs editable cells, a sticky-left column and the in-table total row from T1 |

Excluded on purpose: `pages/project-detail/ProjectGantt.tsx` is a timeline visualization with a `role="grid"` task pane, not a data table.

## 5. Slice plan (PR-sized, ordered)

Every UI slice runs the per-issue loop: ADW `fe_builder`/`fe_reviewer`, the 3 reviewers, a rendered Discover on the §0.1 fixture, and graduation.
**Geometry gate (ADR-0030 Layer 1):** RD-S1 adds `e2e/AC-RD-GEOM-001-figure-containment.spec.ts` (chromium lane, `@e2e-isolation` read-only, route-mocked fixture). At 1440/1024/390 it asserts:

- every `[data-figure]` box lies inside its `[data-figure-container]`;
- `scrollWidth ≤ clientWidth` for each figure;
- the document has no horizontal overflow.

Every later slice **adds its route to this spec's matrix**, so bleeding can't regress.

| # | Slice | Files (main) | Findings | Owning tests | Depends on |
|---|---|---|---|---|---|
| — | `claude/v024-dash-truth` (external) | Exec / WinRate / ProjectedMarginBars | 001–004 | that lane's | — |
| RD-S1 | Figure contract + overflow gate | `KPITile.tsx`, `StatTiles.tsx`, `dashboardMoney.ts`, `ProjectedMarginBars.tsx` headline, e2e spec + fixture helper | 025, 049 (gate), 073, 074, 075, 077 | `AC-RD-GEOM-001` (e2e geometry); `AC-RD-UNAVAIL-001` (RTL: "—" + `title` + sr reason, no prose in figure slot); `AC-RD-MONEY-001` (unit: zero fraction suppressed, non-zero kept exact) | dash-truth merged; owner OK on §3.1/§3.2 |
| RD-C1 | Unknowable dashboard claims | `ExecutiveDashboard.tsx`, `MobileExecutiveDashboard.tsx`, `PMDashboard.tsx`, `AtRiskProjectsLink.tsx` | 005, 006, 008, 022 | `AC-RD-RISK-001` (RTL: no budgets/phases → "can't be checked yet", never "on track"/"0"); `AC-RD-SPEND-001` (label "Recorded spending" + Partial when coverage < total) | dash-truth |
| RD-C2 | Finance truth and language | `FinanceDashboard.tsx`, `AccountingSnapshotsSection.tsx`, EN/ID catalogues | 009–015 | `AC-RD-FIN-001` (null Net → "—"); `AC-RD-FIN-002` (Project column on actuals); `AC-RD-FIN-003` (Bahasa render has no English money labels) | — |
| RD-S2 | Executive restructure | `ExecutiveDashboard.tsx`, `MobileExecutiveDashboard.tsx`, new `ReadinessNotice`, `AttentionBand` in `src/components/dashboard/` | 007, 023, 024, 026–033 | `AC-RD-EXEC-001` (one readiness notice; coverage string count = 1); `AC-RD-EXEC-002` (0 approvals → no primary button); geometry matrix + `/` | RD-S1, RD-C1 |
| RD-S3 | Finance restructure | `FinanceDashboard.tsx`, `AccountingSnapshotsSection.tsx` | 034–040 | `AC-RD-FIN-004` (empty blocks don't render; one sync line); geometry + Finance role | RD-C2, RD-S2 (shared notice/band) |
| RD-S4 | PM dashboard | `PMDashboard.tsx` | 041–043 | `AC-RD-PM-001` (my-projects table, margin column header); geometry + PM | RD-S2 |
| RD-S5 | Sales pipeline cards | `SalesPipeline.tsx`, `Funnel.tsx` | 016, 017, 044–046 | `AC-RD-SALES-001` (neutral bars; board titles in Stage column); `AC-RD-SALES-002` (mixed-currency stage → "—" + reason) | RD-S1 |
| RD-S6 | Project Overview restructure | `ProjectDetail.tsx`, `tabs/OverviewTab.tsx`, `ProjectFinancesSection.tsx`, `MilestoneStrip.tsx` (empty branch), `ProjectSCurve.tsx`, `ProjectProfitLossSection.tsx`, `ProjectDrawdown.tsx`, new `ProjectSetupChecklist.tsx` | 018–021, 047, 050–058, 060–062 | `AC-RD-OVW-001` (Overview with no budget/phases/invoices: one checklist, zero empty `ListState`s, no "No active budget" text); `AC-RD-OVW-002` (checklist rows role-gated, re-binding AC-1044-001); geometry + `/projects/:id` | #1044 Slice A merged; RD-S1 |
| RD-S7 | Project header strip + one Details disclosure | `ProjectDetailHeader.tsx`, `ProjectDetailRail.tsx` | 048, 059 | `AC-RD-HDR-001` (no prose in figure slots; not-tracked capability not rendered); geometry at 1024 | #1044 Slice B; RD-S1 |
| T1 | DataTable hierarchy contract | `DataTable.tsx` (+ `tableWidthPrefs.ts`), `DESIGN.md` §5 Data Table | 064, 065, 067, 069, 071, 072, 076 (CardHead → heading prop) | `AC-TBL-RESIZE-001` (RTL: keyboard ±16/Home/End/Enter; `aria-value*`); `AC-TBL-RESIZE-002` (persistence per tableId×user, clamp, unknown keys ignored); `AC-TBL-GROUP-001` (per-currency subtotals, never summed across); `AC-TBL-CAVEAT-001` (one footnote, header mark); e2e `AC-TBL-GEOM-001` (header/cell boxes within the scroller; ⋯ visible at 1440) | TanStack lane merged |
| T2 | Projects list adopts | `Projects.tsx` | 063, 065, 066 | `AC-RD-TBL-PROJ-001` (25 fixture rows → caveat text count = 1) | T1 |
| T3 | Finance tables adopt | `FinanceDashboard.tsx` Ready-to-pay / Budget review, aging | 066, 038 | extends AC-RD-FIN-004 | T1, RD-S3 |
| T4 | Sales invoices + Pipeline tables adopt | `SalesInvoices.tsx`, `SalesPipeline.tsx` | 070, 045 | `AC-RD-TBL-INV-001` (primary cell number+customer; ≤7 columns visible at 1440) | T1 |
| T5 | Budget tables | `ProjectBudget.tsx`, `BudgetProjection.tsx`, `BudgetAccountMap.tsx` | 068 | existing budget suites + `AC-TBL-GEOM-001` routes | T1, #1044 Slice D |
| T6 | Expenses + receipt | `ExpenseLinesCard.tsx`, `AdvanceAgingCard.tsx`, `ReceiptRecord.tsx` | 068 | existing suites + phone card assertions | T1 |
| T7 | Procurement | `LineItemsSection.tsx`, `VendorQuotesTab.tsx` | 068 | `AC-RD-TBL-QUOTE-001` (quote comparison exposes table semantics + select) | T1 |
| T8 | Admin tools | `IntegrationsView.tsx`, `ImportWizard.tsx` | 068 (+ i18n) | existing suites | T1 |
| T9 | Timesheet grid | `TimesheetGrid.tsx` | 068 | existing `timesheet.mobile.test.tsx` + total row | T1 (editable + sticky-left) |

**Order:** dash-truth → RD-S1 → (RD-C1 ∥ RD-C2 ∥ RD-S5) → RD-S2 → (RD-S3 ∥ RD-S4) → #1044 A/B → RD-S6 → RD-S7. In parallel: TanStack lane → T1 → T2…T9.

### 5.1 Overlap with `docs/plans/2026-10-19-project-detail-user-facing.md` (#1044)

Read from the worktree `PMO-wt-v024-plan-1044-project-internals` working copy. No git in this session, so equality to its `HEAD` isn't verified.

| #1044 slice | Verdict | Why |
|---|---|---|
| **A** Overview spending (tasks 1–5) | **Keep, land before RD-S6.** Task 2's prompt becomes the checklist's "Finish spending setup" row in RD-S6 (AC-1044-001 stays the owning test, re-bound to the row). **Fix task 2:** `text-primary` → `text-primary-text` (RD-021). | Same role/capability logic; RD-S6 only moves it |
| **A** task 6 (rename "Budget utilization" → "Budget summary") | **Drop** | RD-S6 deletes that card when there's no budget and moves budget facts into the money position when there is one |
| **B** accounting project disclosure | **Keep, land before RD-S7** | RD-S7 nests it inside the single Details disclosure |
| **C** unused task connection | **Keep** | Tasks tab; outside these pages |
| **D** budget explanation | **Keep, land before T5** | T5 migrates the same tables; avoids conflicts |
| **E** invoice/procurement wording | **Keep** | Disjoint |
| 25–29 acceptance | **Keep**; RD-S6 updates the AC-1044-014 Overview fixture as a deliberate UX step change (goal oracle unchanged) | — |

## 6. Proposed DESIGN.md additions (owner sign-off; not written to DESIGN.md yet)

1. **Spacing roles** (multiples of `spacing.base` 4px): `section` 32 · `group` 16 · `item` 8 · `inline` 4. Fixes RD-058.
2. **Figure roles:** `metric` 23/700/-0.02em tabular (the existing KPI value), stepping to 17 in containers under 230 px; `figure` 15/600 tabular for inline money. Retire 34/30 on dashboards. Fixes RD-075.
3. **Zero-fraction display rule:** a money figure whose fraction is exactly zero omits it. Exactness unchanged. Fixes RD-074.
4. **Readiness notice** and **attention band** molecules (§2 shared rules).
5. **Data Table:** column types, widths, resize handle, group/total rows, caveat footnote (§4).
6. **YAML:** add `primary-text` (RD-078).

## 7. Mockups

`docs/ux/mockups/2026-10-19-real-data/`: `index.html`, `tokens.css` (DESIGN.md tokens only; `--space-*` marked as proposed), and `executive-`, `finance-`, `sales-pipeline-`, `project-overview-`, `tables-` × `1440`/`390`. They are static sketches for the ~30-second owner shape check. They weren't rendered in this session either.
