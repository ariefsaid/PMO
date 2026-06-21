# Procurement case-detail redesign — 3 IA directions (mockups)

**What this is:** static, openable HTML mockups (no build, no backend) that diverge into **3 distinct
information-architecture strategies** for the `/procurement/:id` case-detail page, which has accreted into a
vertically endless, single-altitude stack. Each option honors the app's existing detail-page archetype
(Part 1), obeys the de-duplication principles (Part 2), and renders on the **real DESIGN.md tokens**
(`_tokens.css` mirrors `pmo-portal/index.css` `:root` verbatim — no invented colors/fonts).

**Files**
- `option-a-tabbed.html` — Tabbed detail (Overview · Records · Items · Quotes · History)
- `option-b-phase-spine.html` — Phase-as-spine (the lifecycle stepper is the primary nav)
- `option-c-single-ledger.html` — Single ledger (thin pipeline + one chronological records table + docked bar)
- **`option-h-hybrid.html` — ★ Owner-pick: A's tabbed shell + C's single ledger as the Records tab.** Has a **Paid case ↔ Draft case** scenario toggle (the Draft view is the de-dup proof point).
- `_tokens.css` — DESIGN.md token + component-primitive mirror (shared by all four)

Open any `.html` directly; each has a **Desktop / 390px** viewport toggle in its top bar.
Identity preserved: the look is the existing "Quiet Control Surface" — one blue, neutrals + status,
borders-not-shadows, Inter + tabular-nums, dot+tinted pills, 32px controls, 8px radius spine.

---

## Part 1 — The app's detail-page archetype (the consistency anchor)

Reverse-engineered from `ProjectDetail.tsx` (tabbed, `/projects/:id/:tab`), `CompanyDetail.tsx`,
`IncidentDetail.tsx`, the Sales/opportunity detail (unified into ProjectDetail via ADR-0020/0021),
the current `ProcurementDetails.tsx`, the shell (`RecordActionZone`, `Tabs`, `BackBar`, `RecordHeader`),
and `DESIGN.md` §7 (the Coherence-Wave canonical molecules). The house pattern is:

| Concern | House convention (every record page obeys it) |
|---|---|
| **Header** | ONE `RecordHeader`: `[icon tile] [name] [status pill] … [Edit / by-permission actions]`, actions top-right. Optional `meta` row + `StatTiles` strip below. |
| **Status + lifecycle** | A status **pill** in the header (dot + tint, never color-only). A **single bar stepper** (DESIGN.md §5, the ONE stepper) for staged records — even-flex `jbar` segments, `done`=success / `current`=primary / `paid`=success. The numbered-circle node stepper was **retired**. |
| **Advance / decide action** | ONE `RecordActionZone` — sticky-bottom on desktop (≥920px), a fixed action bar on mobile; **never below the fold**. Advance verbs live here; Edit/Archive live in the header. (`IncidentDetail` shows the canonical "Next action" label + primary verb.) |
| **Child collections** | Project uses **tabs** (Overview/Budget/Procurement/Tasks/Documents). Company/Incident — shorter records — use **stacked cards** with a `CardHead` + in-card actions. So the house has **two registers**: *tabs for a rich multi-collection record, stacked cards for a thin one.* |
| **Tabs grammar** | `<Tabs>`: underlined active tab (primary), `h-11`/44px touch targets, arrow-key nav, `role=tablist/tab`, deep-linkable `/:tab`, horizontal scroll-snap strip on mobile. |
| **Fields** | Read-only `<dl>` definition-list grid (`Field`: overline label + value), **edit-in-modal** (`EntityFormModal`), never inline-editable sprawl. |
| **Loading / error / empty** | `ListState` variants (`loading` skeleton / `error` + Retry / `empty` + icon). Not-found and no-access (RLS `PGRST116`) are calm empty states, never a blank stack. |
| **Wayfinding** | Desktop = top-bar breadcrumb only; mobile (≤920px) = in-content `BackBar`. Single DOM branch per breakpoint (`useIsDesktop`), no dual a11y tree. |
| **Money / IDs** | `tabular-nums` on every figure; **SF Mono only** for system identifiers (PR#/PO#) — money is Inter-tabular. |

**The strongest consistency signal:** the richest record in the app (Project) is **tabbed**, and so is the
RIS reference detail (Documents/Items/Quotations tabs). Procurement is the app's *other* rich,
multi-collection record (7 record types + items + quotes + history). By the archetype it should be **tabbed**
— which is why a tabbed option (A) is the consistency-first recommendation, and why all three options keep
the header / stepper / RecordActionZone / pill grammar identical.

---

## Part 2 — Principles every option enforces (the de-dup contract)

1. **One progression encoding.** The current page encodes "where is this?" four times (stepper + history
   timeline + per-phase record cards + Document trail). Each option picks **one primary**: A = the bar
   stepper (history demoted to a tab); B = the interactive spine *is* the history; C = the thin pipeline +
   the chronological ledger (one and the same).
2. **One identity display.** PR#/PO#/VQ# appear once. In A/C they live in the Records/ledger table (system #
   + external ref columns); the stepper shows only the lead system #. No trail + card + tile triplication.
3. **Collapse/omit empty & inactive phases.** No Draft renders seven "No X recorded yet" cards. A/C collapse
   by construction (only populated record rows exist). B dims + disables future phases and shows only the
   active phase's capture.
4. **Next action above the fold + adjacent.** All three keep the `RecordActionZone` sticky/docked with the
   live verb; the budget signal (P3) sits adjacent to it / above the records.
5. **Minimal vertical, restraint.** The RIS-mock restraint (one clean list/detail, no card-soup) is the
   north star — most directly in C, and structurally in A/B (one altitude becomes panes/phases instead of
   an endless full-width stack).

**Data model is fixed** (not redesigned): a case has 1:N of 7 record types (PR/RFQ/Quotation/PO/GR/Invoice/
Payment), each with system # + external ref (dual-ID) + status/date/amount + files; plus line items, a
budget-impact figure, and a SoD-gated advance action. **JTBD P1** — "operate the whole case on one page:
capture each document (dual-ID + file) and advance, without hunting across screens" — is the acceptance bar;
P2 (bid comparison) and P3 (budget signal adjacent to commit) are folded into each option.

---

## The 3 options

### Option A — Tabbed detail · `option-a-tabbed.html`
**The bet:** procurement is a rich multi-collection record, so it should look and behave like the app's
other rich record (Project) — **tabbed**. Header + stepper stay pinned; the seven record types, items,
quotes, and history split into **Overview · Records · Items · Quotes · History** tabs, killing the stack.

- **One progression encoding:** the bar stepper (pinned). History becomes a *tab*, not a parallel timeline.
- **One identity display:** PR#/PO#/etc. live once, in the **Records** tab's `system # / external ref` columns.
- **Collapse-empty:** the Records tab is a table of *populated* rows only; a Draft shows just the PR row +
  the inline-capture row for the active phase. No empty per-phase cards.
- **Consistency:** reuses `<Tabs>` (same underline/touch/scroll-snap/deep-link), `RecordHeader`,
  `RecordActionZone`, `StatTiles`, the bar stepper, dot+tinted pills — **1:1 with `/projects/:id`.**
- **P1/P2/P3:** P1 capture+advance on the Records tab + sticky action bar; P2 bid-comparison is the Quotes
  tab; P3 budget signal is an Overview card (and could be mirrored adjacent to the action bar).
- **Tradeoffs:** "operate on one page" (P1) becomes "operate on one page with tabs" — capturing a GR while
  reading the quote means a tab switch. Mitigated because each phase's capture lives with its record type.
  Best **consistency** score, slightly weaker on the literal "everything on one surface" wording of P1.

### Option B — Phase-as-spine · `option-b-phase-spine.html`
**The bet:** the lifecycle *is* the information architecture. The bar stepper becomes the **primary nav**:
click a phase → that phase's records + the inline capture form reveal in a single pane below. The spine
doubles as the progression history, so there is no separate timeline.

- **One progression encoding:** the interactive spine — selecting a phase is both navigation *and* the
  "where is this / what happened" view. History is the spine, expanded.
- **One identity display:** each phase pane shows its own records' system # + external ref; the spine shows
  the lead #. No trail/tile/card triplication.
- **Collapse-empty:** structural — future phases render **dimmed + disabled** on a Draft; only the active
  phase's capture form shows. The cleanest "no empty cards" story of the three.
- **Consistency:** the spine is the **same bar-stepper molecule** (DESIGN.md §5), now `role=tablist`; header
  + RecordActionZone + pills unchanged. It bends the stepper from "indicator" to "nav," which is a *new
  interaction* for the molecule (flagged below).
- **P1/P2/P3:** P1 capture is co-located with the selected phase (the most literal P1 fit). P2 = the Source
  phase pane (bid comparison). P3 = a persistent budget bar above the pane.
- **Tradeoffs:** strongest task-locality (capture sits exactly at its phase), but it **introduces a stepper
  interaction the app doesn't have yet** (the stepper is currently a passive indicator). It also hides
  non-selected phases — a reviewer wanting the whole case at a glance must click through. Needs owner
  sign-off on "stepper becomes clickable nav."

### Option C — Single ledger · `option-c-single-ledger.html`
**The bet:** the RIS-minimal lineage. A **thin pipeline header** (compact bars, not a card) + a one-line
financial summary + **one chronological records table** (the whole case as a ledger) + a **docked action
bar**. Maximum restraint, minimum vertical, everything legible at one glance.

- **One progression encoding:** the thin pipeline strip; the ledger's chronological order *is* the history
  (no separate timeline card, no doc-trail).
- **One identity display:** the ledger's `system # / external ref` columns — every ID appears exactly once.
- **Collapse-empty:** by construction — empty record types simply have no row. A Draft = thin pipeline (only
  Request lit) + a single PR row (or an empty-state prompt) + the one live verb docked.
- **Consistency:** reuses the **DataTable** signature (38px header cells, 54px rows, tabular money, mono IDs,
  the md→card reflow) and the dot+tinted pills — the app's most-used molecule. The pipeline strip is a
  compact relative of the bar stepper (a documented variant risk — see below).
- **P1/P2/P3:** P1 capture = "+ Add record" in the docked bar (pre-selects the next expected type); advance
  verb is docked + adjacent. P2 = a Quote row expands to the side-by-side compare. P3 = the budget pill in
  the summary row, adjacent to the docked action.
- **Tradeoffs:** densest + most scannable, closest to the owner's "functional and minimal" reference. But it
  treats the 7 record types as homogeneous rows, so phase-specific richness (e.g. a GR's partial/complete
  detail, a quote's terms) lives behind a row-expand rather than on the surface — and the thin pipeline is a
  *new* compact treatment vs. the canonical bar stepper.

---

## Comparison

| Dimension | A — Tabbed | B — Phase-spine | C — Single ledger |
|---|---|---|---|
| **IA bet** | Rich record → tabs (like Project) | Lifecycle = the nav | One chronological ledger |
| **Primary progression encoding** | Bar stepper (pinned) | Interactive spine | Thin pipeline + ledger order |
| **App-archetype match** | ★★★ (exact Project parity) | ★★ (new stepper interaction) | ★★ (DataTable parity; new pipeline strip) |
| **P1 "operate on one surface"** | ★★ (tab switch to capture) | ★★★ (capture at the phase) | ★★★ (one surface + docked add) |
| **P2 bid comparison** | Quotes tab | Source-phase pane | Quote row → expand |
| **Vertical length / restraint** | Short (paneled) | Short (one pane) | Shortest |
| **Collapse-empty** | Populated rows only | Dimmed/disabled phases | No row = no record |
| **At-a-glance whole case** | ★★ (across tabs) | ★ (click per phase) | ★★★ (all in the ledger) |
| **New interaction risk** | None | Stepper→nav (sign-off) | Pipeline strip variant (sign-off) |
| **Mobile (390px)** | Scroll-snap tab strip | Scrollable spine + pane | DataTable→stacked cards |

**Recommendation for the owner's reaction:** **A** is the safe consistency play (procurement becomes a
first-class tabbed record exactly like Project). **C** is the strongest on the owner's stated "functional and
minimal" taste and on the literal P1 "one page." **B** is the most task-elegant but asks the most of the
design system. The Director can take a hybrid — e.g. **A's tab shell with C's ledger as the Records tab** —
once the owner reacts.

---

## ★ Option H — Hybrid · `option-h-hybrid.html` (owner pick, recommended)

**The bet:** take the **best of both** with **zero new design-system molecules**. A's tabbed shell (the
consistency anchor — exact parity with `/projects/:id/:tab`) wraps C's single chronological ledger as the
**Records** tab. The canonical bar stepper (DESIGN.md §5, *the one stepper*) stays pinned; history becomes a
tab; the per-phase record cards and the old Document trail are **deleted entirely**.

- **Tabs:** `Overview · Records · Items · Quotes · History` — same `<Tabs>` grammar as Project.
- **Records tab = C's ledger:** one date-ordered table (Date · Type · System # · External ref · Amount ·
  Status · File) + filter chips + the one capture affordance (`+ Capture <next record>`) for the active phase.
  Empty record types simply have no row.
- **Progression:** ONE encoding — the canonical bar stepper (not C's thin pipeline variant → **no §5 sign-off**).
- **Identity:** each system # appears once, in the ledger. The header shows the lead # only.
- **Default tab = Records** (the case's status-at-a-glance), not Overview.

### Why it won the review (vs A, B, C standalone)
| Driver | How H satisfies it |
|---|---|
| App-consistency (hard constraint) | ✅ Tabbed, 1:1 with Project — the other rich record |
| Minimal / scan (owner taste) | ✅ Whole case reads as one ledger on the default tab |
| New design-system sign-off needed | ✅ **None** — canonical stepper + DataTable only |

It was the **only** configuration the lens battery scored Strong on all five dimensions with no molecule
exception, and it kills every redundancy that made the current page an endless stack.

### The de-dup proof — Paid ↔ Draft toggle
The three original mockups only ever showed the richest (Paid, 7 records) case — which is where accretion
*hides*. H adds a **scenario toggle** so the contract is provable on the **emptiest** case, which is where
accretion *fails*. A Draft case now renders, against today's 7 stacked empty cards:

| Concern | Today (Draft) | H (Draft) |
|---|---|---|
| Progression shown | stepper + history + 7× empty cards + doc trail (4×) | the bar stepper (only Request lit) — 1× |
| Records | 7 "No X recorded yet" cards | 1 ledger row (the PR) + 1 capture affordance (RFQ) |
| Next action | buried below the fold | sticky action zone: `Submit for approval` (primary) + SoD note |
| Items / Quotes | 2 more empty cards | taught empty-states ("added when you capture the PR"; "after the RFQ is sent") |

### Build-time caveats (flag, don't stub)
- **Mobile rail collapse @920px** and **DataTable→card @768px** are the house's real responsive pattern
  (`useIsDesktop`, single-render). The mockup's 390px toggle is a CSS clamp that **keeps the rail drawn** —
  a known mockup limitation, NOT how the built app behaves. Build the rail collapse for real; the table→card
  reflow itself is verified working at 390px.
- **Default tab:** confirm "Records is the landing tab" (not Overview) before build — it puts the
  status-at-a-glance first, which is the whole point of C's lineage.
- **Capture affordance:** the `+ Capture <next record>` row replaces today's scattered per-phase ghost links.
  Confirm the consolidation (one affordance that pre-selects the next expected type per phase).

### Verdict
**H is the recommended build direction.** On owner OK, the design-architect produces the token-named
design-plan, then the page is rebuilt (deleting the accretion) and the real design-reviewer rendered pass
(ADR-0030 Discover) runs before any PR. **PR to `dev` stays on hold until then.**

---

## a11y + responsive (carried by all four; verify at build)
- **Contrast:** all text/pill pairs use the DESIGN.md darkened-AA pill text tokens (`--status-*-text`) and
  `muted-foreground` at 40% L (clears AA). No status conveyed by color alone — every pill has a label + dot.
- **Focus:** the global `*:focus-visible` ring (2px `ring`, 2px offset) is inherited; tabs/spine carry
  `role=tab(list)` + `aria-selected`; arrow-key nav per the `<Tabs>` contract.
- **Keyboard path:** the advance verb stays in DOM/tab order inside `RecordActionZone` (never below the fold).
- **Responsive:** 920px = rail collapse + in-content BackBar; 768px = DataTable→card reflow (single render).
  390px behavior is shown via each mockup's viewport toggle.

## Open questions / proposed additions for the owner
1. **Stepper-as-nav (Option B)** and **thin-pipeline strip (Option C)** are *new interaction/visual variants*
   of the canonical bar stepper. DESIGN.md §5 says there is exactly ONE stepper appearance app-wide. If B or
   C is chosen, this is a deliberate molecule extension that needs owner + DESIGN.md sign-off.
2. **App-convention inconsistency to resolve:** the house has **two child-collection registers** — Project
   uses *tabs*, Company/Incident use *stacked cards*. Procurement is rich enough for tabs, so matching
   Project (Option A) is defensible, but the Director should confirm "procurement is a tabbed record" rather
   than letting it sit ambiguously between the two registers.
3. **"+ Add record" capture verb** vs. the existing per-phase inline forms (Record GR / Record VI ghost
   links). The mockups consolidate capture into one affordance that pre-selects the next expected type; this
   replaces the scattered ghost-link forms in today's decision card. Confirm the consolidation.
4. **Items + bid-comparison surfacing:** A gives them dedicated tabs; B/C surface them via row-expand. If the
   owner wants items always-visible (not behind a tab/expand), that nudges toward A.
