# Procurement case-page revamp — design-plan (token-named)

**Date:** 2026-06-19
**Author:** design-architect
**Branch:** `feat/procurement-records`
**Contract (binding):** `docs/design/procurement-redesign/option-h-hybrid.html` + `README.md` — the **owner-approved Hybrid (Option H)**. This plan does NOT re-diverge from it. Owner edits already applied: tabs `Overview · Line items · Documents · Vendor quotes` (default = Overview); Overview = bento (2/3 stats+budget+detail · 1/3 Progression timeline, history folded in); Documents = one chronological case-ledger DataTable; one bar stepper above the tabs; one `RecordActionZone`.
**Replaces:** `pmo-portal/pages/ProcurementDetails.tsx` (the current 7-section accreted stack).
**Reuses (no new molecule):** `Tabs`, `DataTable`, `RecordHeader`, `RecordActionZone`, `LifecycleStepper variant="bar"`, `StatTiles`, `StatusPill`, `GateNotice`, `ListState`, `ConfirmDialog`, the `Field`/`<dl>` grammar — all from `@/src/components/ui`. Archetype matched 1:1: `pages/project-detail/ProjectDetail.tsx` (`/projects/:id/:tab`).

> **Conflict check (the Director's resolution item): NONE.** The hybrid was chosen precisely because it extends nothing — it is the `ProjectDetail` tabbed archetype + the canonical `DataTable` + the canonical bar stepper. Every visual decision below names an existing `DESIGN.md` token or an established on-token class. No `DESIGN.md` edit is required; no new molecule is documented. The one open item is a route shape (`/procurement/:id/:tab` deep-link), called out in §10, not a design-system change.

---

## 1. Component tree (new page) — what each piece is, its file, and what it absorbs

The route shell is renamed conceptually to a **tabbed record shell** mirroring `ProjectDetail`. Components live under `pmo-portal/pages/procurement/` (new files) and `pmo-portal/pages/ProcurementDetails.tsx` (refactored to the shell).

```
ProcurementDetails.tsx                         ← REFACTOR: stacked page → tabbed shell (route owner)
│  useParams<{ procurementId, tab? }>          (NEW :tab param, mirrors ProjectDetail)
│  loading / no-access / error guards          ← KEEP verbatim (ListState — already correct)
│
├─ <BackBar>  (mobile <920px only)             ← KEEP (useIsDesktop single-render)
├─ <RecordHeader>                              ← KEEP: icon + title + StatusPill + Edit action
│     status = StatusPill(pillVariantForStatus) ← KEEP existing helpers
│     actions = Edit (canEditHeader gate)      ← KEEP
├─ <Card><CardPad><LifecycleStepper variant="bar"></CardPad></Card>   ← KEEP (the ONE stepper, §5)
│     steps = lifecycleSteps(p.status, refs)   ← KEEP existing helper
│
├─ <Tabs items=PROC_TABS value=tab onChange=setTab idBase="procurement-detail">  ← REUSE ui/Tabs
│     PROC_TABS = [Overview, Line items, Documents, Vendor quotes]  (counts on 3 non-Overview)
│
├─ <div role=tabpanel id=tabPanelId('procurement-detail', tab) aria-labelledby=tabId(...)>
│   │
│   ├─ tab==='overview'  → <ProcurementOverviewTab>           ← NEW (bento orchestrator)
│   │     ov-grid: minmax(0,2fr) | minmax(0,1fr)
│   │     ├─ ov-main (left 2/3)
│   │     │   ├─ <StatTiles columns={2}>           ← REUSE; the 4 stats, 2×2 (sparse if <3)
│   │     │   ├─ <DecisionSupportPanel>            ← KEEP (Budget signal card; project-gated)
│   │     │   └─ <Card>Detail <dl></Card>          ← NEW small block: the Field <dl> grammar
│   │     └─ ov-side (right 1/3, sticky desktop)
│   │         └─ <ProcurementProgressionTimeline>  ← REFACTOR of ProcurementHistoryTimeline
│   │               (folds in old History tab; newest-first; current-ring on latest;
│   │                each event links to its document)
│   │
│   ├─ tab==='items'     → <LineItemsSection>      ← KEEP (now lives in its own tab, not stacked)
│   │                        editable = canEditItems (Draft only); empty-state taught
│   │
│   ├─ tab==='documents' → <ProcurementLedger>     ← NEW; ABSORBS ProcurementRecordsSection +
│   │                        the old "Document trail" Card + ProcurementDocumentsSection rows
│   │     ├─ filter chips: All · Financial · Has file   (DataTable.Toolbar / seg-style chips)
│   │     ├─ <DataTable rows=ledgerRows columns=LEDGER_COLS>   ← REUSE DataTable (md→card reflow)
│   │     │     Date · Type · System # · External ref · Amount · Status · File
│   │     └─ <LedgerCaptureRow>                    ← NEW; ONE capture affordance, pre-selects
│   │                                                 nextExpectedType(p.status); wraps
│   │                                                 RecordCaptureForm (existing)
│   │
│   └─ tab==='quotes'    → <VendorQuotesTab>        ← REFACTOR of QuotationsSection into a
│                            side-by-side bid-comparison + select-with-rationale
│
├─ <RecordActionZone>  (sticky desktop / static mobile)        ← REUSE; the ONE action zone
│     <Card data-testid="decision-card">
│       GateNotice (blocked/ready)               ← KEEP sodGateMessage + GateNotice
│       notes textarea (approve/reject)          ← KEEP
│       VIInlineCapture (Vendor Invoiced)        ← KEEP
│       action buttons (sortActions)             ← KEEP allowedActions/sortActions/onActionClick
│
├─ <ConfirmDialog>                               ← KEEP (consequential set: Approve/Reject/Cancel/Paid)
└─ mobile-sticky-action bar (<920px, primary only)   ← KEEP
```

### Component → file → replaces/absorbs

| Component | File | New / Refactor | Replaces / absorbs |
|---|---|---|---|
| `ProcurementDetails` (shell) | `pages/ProcurementDetails.tsx` | Refactor | The stacked page; now owns `tab` + the 4 panels |
| `ProcurementOverviewTab` | `pages/procurement/ProcurementOverviewTab.tsx` | **New** | The bento orchestrator (StatTiles + Budget + Detail + Progression) |
| `ProcurementProgressionTimeline` | `pages/procurement/ProcurementHistoryTimeline.tsx` | Refactor | The old "Progression history" / History tab → folded into Overview 1/3 slot, dot+rail visual, doc links + current-ring |
| `ProcurementLedger` | `pages/procurement/ProcurementLedger.tsx` | **New** | **`ProcurementRecordsSection`** (4 per-phase cards) + the inline **"Document trail"** Card in `ProcurementDetails` + **`ProcurementDocumentsSection`** rows → ONE chronological DataTable |
| `LedgerCaptureRow` | `pages/procurement/LedgerCaptureRow.tsx` | **New** | The 4 scattered `RecordCaptureTrigger`s + the GR/VI ghost-link forms in the DecisionCard → ONE "Capture `<next type>`" affordance |
| `VendorQuotesTab` | `pages/procurement/QuotationsSection.tsx` | Refactor | `QuotationsSection` → side-by-side bid comparison + select-with-rationale |
| `LineItemsSection` | `pages/procurement/LineItemsSection.tsx` | Keep | Unchanged; now in its own tab |
| `DecisionSupportPanel` | `pages/procurement/DecisionSupportPanel.tsx` | Keep | Budget-signal card, now in Overview bento |

**Backend / data: reuse as-is, refactor NOTHING.** `getProcurementDetail` (the `ProcurementDetail` bundle incl. `statusEvents`), `buildProcurementHistory`, `useProcurementDetail`/`useProcurementMutations`/`useProcurementCrudMutations`/`useProcurementRecordMutations`, `can()`/`<CanWrite>`/`usePermission`, `transition_procurement` RPC + `allowedActions`/`sortActions`/`sodGateMessage`/`commitTransition` — all unchanged. The revamp is a **presentation re-shell only**.

### The ledger row model (new, derived — no new fetch)
`ProcurementLedger` builds its rows from the **already-loaded** `ProcurementDetail` bundle by unioning the 7 record collections into one chronological array (the same union `buildProcurementHistory` already does, extended with the dual-ID/amount/file/status columns the ledger shows). Pure function `buildLedgerRows(detail): LedgerRow[]` in `src/lib/db/procurementLedger.ts` (NEW, unit-tested), each row:

```
{ id, date, type: RecordType, systemNumber, externalRef, amount|null, status, statusVariant, fileHref|null, financial: boolean }
```
Sort: newest-first (matches the mockup's ledger + timeline). `financial` = type ∈ {PR, Quote, PO, Invoice, Payment} (drives the "Financial" chip). Empty record types contribute **no row** (the de-dup contract).

---

## 2. All states per component (default / loading / empty / error + per-stage variants)

### Shell (`ProcurementDetails`)
| State | Behavior |
|---|---|
| **loading** | `<ListState variant="loading" rows={6}>` + `BackBar` — KEEP verbatim. No tab chrome rendered yet. |
| **no-access** (RLS `PGRST116`) | `<ListState variant="empty" icon="lock" …>` — KEEP verbatim. |
| **error** (transient) | `<ListState variant="error" … onRetry>` — KEEP verbatim. |
| **default** | header + stepper + tabs + active panel + action zone. |

### `ProcurementOverviewTab`
| State | Behavior |
|---|---|
| default | StatTiles (2×2; `StatTiles columns={2}`, sparse auto-fit when <3 tiles e.g. Draft), Budget signal, Detail `<dl>`, Progression timeline. |
| Budget gated | `DecisionSupportPanel` already renders only when `project_id` set; otherwise the Budget card is omitted (no empty card). |
| sparse (Draft) | 1 stat tile ("PR value (estimate)"), Budget = "Not started" neutral pill, Detail shows "Vendor: Not yet selected / Approved by: Pending" muted. |

### `ProcurementProgressionTimeline` (refactor)
| State | Behavior |
|---|---|
| empty | "No history yet — events appear here as the procurement progresses." (`muted-foreground`, `text-[13px]`) — KEEP existing copy. |
| default | semantic `<ol aria-label="Progression history">`; newest-first; **top event = current** (ring dot); each event's doc ref is a `btn-link` to that ledger row / file; actor + UTC-safe timestamp shown as text. |

### `ProcurementLedger` (new)
| State | Behavior |
|---|---|
| default | `DataTable` of `ledgerRows` (≥1 row). Filter chips reflect active filter; capture row below. |
| empty (no records at all) | DataTable `state="empty"` → `ListState empty`, `emptyTitle="No records captured yet"`, `emptySub` teaches "Capture the first record for this case below." The `LedgerCaptureRow` still shows (it is the create affordance). |
| filtered-empty | chip active but no matching rows → DataTable `state="empty"`, `emptyTitle="No <Financial|with-file> records"`, sub "Clear the filter to see all records." |
| loading | the detail bundle is already resolved at shell level, so the ledger itself never loads independently; if a future per-tab fetch is added, `DataTable state="loading"`. |
| capture-disabled (`!canWrite`) | `LedgerCaptureRow` omitted entirely (honest doorway — no dead control). |

### `VendorQuotesTab` (refactor)
| State | Behavior |
|---|---|
| empty | `<ListState variant="empty" icon="quote">` "No vendor quotes yet" + teach "Quotes are captured after the RFQ is sent. Selecting one with rationale advances the case to Ordered." |
| default | side-by-side bid rows (DataTable or comparison grid): Vendor · Amount · Valid until · Lead time · Terms · [Select]. Selected row gets `bg-success/[0.06]` wash + "Selected · best value" `won` pill. |
| can-select (`Vendor Quoted`) | `Select` button per non-selected row → opens rationale capture → `selectQuote` mutation. |
| read-only (past `Quote Selected`) | no Select buttons; the selected row stays marked. |

### `LineItemsSection` (keep)
Empty: "No line items yet" taught empty (added on PR capture). Editable only while `Draft` (`canEditItems`).

### `RecordActionZone` (keep) — per-stage variants in §3 below.

---

## 3. Full lifecycle adaptation — every status (the owner's explicit emphasis)

For each status the table states: **action-zone verb(s) + SoD gate copy** (reuse `allowedActions`/`sodGateMessage` verbatim — the RPC is the authority), the **capture affordance offered** (the `nextExpectedType`), **what's editable**, and the **Overview/tab content**. All verbs/gating are the EXISTING logic in `ProcurementDetails.tsx`; this plan only re-homes where they render (action zone stays; capture moves to the ledger).

`nextExpectedType(status)` (drives `LedgerCaptureRow` pre-select):

| Status | Action-zone verb(s) | SoD gate copy (existing) | Capture pre-select | Editable | Overview / tabs |
|---|---|---|---|---|---|
| **Draft** | `Submit Request` (primary). Blocked if 0 line items → "Add at least one line item before submitting." | Author pre-announce: "Submitting hands this to another approver — you can't approve your own request." | **RFQ** (or PR if none) | **Line items** (requester/PM/Finance/Admin) + header (requester/Admin) | 1 stat tile; Budget "Not started"; timeline = "Draft created". |
| **Requested** | (approver) `Approve` (primary) · `Reject` (destructive→outline at rest); (requester) none | Blocked notice for requester: "A different user holding PM/Finance/Exec must review it — the requester cannot self-approve." | RFQ | none (locked once submitted) | stats; Budget pending; timeline adds "Requested". |
| **Approved** | `Request Vendor Quotes` (primary) · `Generate Purchase Order` (outline, skip path) | none | **RFQ** | none | "Approved by · date" in Detail; timeline "Approved by …". |
| **Rejected** | (requester) `Rework (Back to Draft)` (outline) | — | none | none until reworked → Draft | Rejection-notes Card shown (`destructive` text); timeline "Rejected". |
| **Vendor Quoted** | `Select Quote` (primary) | none | **Quote / RFQ response** | none | **Vendor quotes tab is the focus** (bid comparison, Select buttons live). |
| **Quote Selected** | `Generate Purchase Order` (primary) | none | **PO** | none | "Selected quote" tile bound (selectedQuotation); quotes tab marks selected. |
| **Ordered** | `Confirm Receipt` (primary) | "To advance from PO to GR, the requester or a PM must confirm receipt." (when viewer can't) | **Goods Receipt** | none | PO tile committed; timeline "Ordered". |
| **Received** | `Mark Vendor Invoiced` (primary → opens `VIInlineCapture`) | none | **Vendor Invoice** | none | GR tile "N receipts"; timeline "Goods received". |
| **Vendor Invoiced** | `Mark as Paid` (success) — gated `!isApprover` (SoD-b) | payer≠approver enforced server-side; button hidden when `isApprover`. | **Payment** | none | VI row(s) in ledger; timeline "Vendor invoiced". |
| **Paid** | **terminal** — no verbs. Action zone: "No further lifecycle actions. This case is Paid (terminal)." + optional `Export case PDF` (outline). | — | **none** (capture row hidden) | none | full stepper `done`+`paid`; all tiles bound; timeline complete. |
| **Cancelled** | terminal — no verbs; "No further lifecycle actions are available to you at this stage." | — | none | none | stepper off-track (PR `current`, rest `skipped`); timeline "Cancelled". |

**Cancel** is available across non-terminal stages per `canCancel` (requester at Draft/Requested; PM/Finance/Exec/Admin late) — renders as a destructive (outline-at-rest) verb sorted LAST.

### Edge cases (owner emphasis)
- **PO-less / direct path** (no PR/quote/PO → direct VI + Payment): `LedgerCaptureRow` must **not require a PO**. `nextExpectedType` falls back to the next *legal* capture for the case's actual records, not a fixed chain; the capture form's predecessor-FK selects (`invoice_id` on payment, `[PD-5]`) stay **optional/none-default** (already the case in `RecordCaptureForm`). A case can therefore have a Payment row with no PO row, and the ledger renders exactly the rows that exist.
- **Multiple records per phase** (partial GRs, multiple invoices, progress payments): every record is its OWN ledger row (chronological), all visible, all link to their file. After capturing one GR/invoice/payment, the capture affordance **stays available** for another (it is gated by `canWrite` + stage, not by "already has one"). Partial vs Complete GR shows in the row's Status column (`pill-neutral`/`won`).
- **Impersonation:** all write affordances gate on the **real JWT role** (`useEffectiveRole().realRole`) — KEEP. `can()`/`<CanWrite>` are UX-only; RLS/RPC is the authority. The impersonation banner is unchanged.
- **terminal / rejected:** see Paid/Cancelled/Rejected rows above — action zone shows the terminal/empty message, capture row hidden, ledger read-only.
- **loading / empty / error:** shell-level `ListState` (KEEP); ledger/quotes/items empty states are the taught empties in §2.

---

## 4. Responsive (the app's REAL mechanism — not the mockup's container-query trick)

The mockup uses a `container-type: inline-size` + `@container (max-width: 760px)` trick **for the demo only**. Production uses the app's actual breakpoints:

| Breakpoint | Mechanism | Behavior |
|---|---|---|
| **920px** rail collapse | `useIsDesktop()` (≥920 logic) + `max-[920px]:` / `min-[920px]:` CSS | Rail off-canvas; in-content `BackBar` appears (`hidden max-[920px]:block`); `RecordActionZone` switches sticky→static (built into the component: `min-[920px]:sticky`); mobile-sticky primary-action bar appears (`hidden max-[920px]:flex`). **Single DOM branch per breakpoint** — no dual a11y tree. |
| **768px** DataTable reflow | `useIsDesktop()` inside `DataTable` (reads `(min-width:768px)`) | The ledger DataTable single-renders: `<table>` ≥768, stacked `<dl>` cards <768. **No bespoke table** — the existing `DataTable` md→card reflow. All 7 columns map into the card `<dl>` (none dropped). |
| **Overview bento** | Tailwind `grid` + responsive cols (`lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`, single col below) | Bento collapses to **single column** below the rail-collapse width; **Progression drops below** the stats/budget/detail (not beside). `ov-side` `sticky` is desktop-only (`lg:sticky`, static on mobile). The `<dl>` Detail grid goes 2-col → 1-col. |
| **Tabs** | `ui/Tabs` built-in | Horizontal **scroll-snap strip** (`overflow-x-auto snap-x`, right-edge mask fade, active scrolled into view) — already in the component. |
| **Stepper** | `LifecycleStepper variant="bar"` | Already even-flex; on narrow it `overflow-x-auto` scrolls (min step width) — KEEP existing behavior, verified by `AC-MOBILE-OVERFLOW-001`. |

**No horizontal bleed @360/390** — enforced by the existing `AC-MOBILE-OVERFLOW-001` measuring gate (every route × {390,360}). The ledger card branch + bento single-col must pass it.

---

## 5. Accessibility (WCAG-AA, axe-clean)

| Concern | Spec |
|---|---|
| **Tabs** | `ui/Tabs` already provides `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`, roving `tabIndex` (active=0, others=-1), Arrow-Left/Right nav, `h-11`=44px targets. Panel = `role="tabpanel"` + `aria-labelledby=tabId(...)` (mirror `ProjectDetail`). Tab counts ("Documents 7") read in label, not color-only. |
| **Progression timeline** | semantic `<ol aria-label="Progression history">`, one `<li>` per event; kind ("Transition"/"Record"), label, actor, and `<time dateTime>` all as **text** (not color/dot-only) — KEEP the existing component's a11y contract (NFR-PR-A11Y-002). Current-state ring is decorative (`aria-hidden`); "current" conveyed by being first + its text. |
| **Dual-ID, not color-only** | every ledger row shows System # + External ref as text (mono); Status is a dot+label `StatusPill` (never color-alone, §2 Freed-Blue). Type column is a labeled pill. |
| **Focus** | global `*:focus-visible` ring (2px `ring`, 2px offset) inherited on tabs, chips, ledger row activation buttons, capture button, Select buttons. Tab order: header → stepper → tabs → active panel → action zone (advance verb always in DOM/keyboard order, never below the fold — `RecordActionZone` contract). |
| **44px targets** | tabs `h-11`; filter chips ≥ `.touch-target` on coarse pointer; DataTable card affordances ≥44px (built-in); capture/select buttons `btn` 32px desktop but `.touch-target` floor on coarse pointer. |
| **Tab→panel deep-link** | `/procurement/:id/:tab` deep-linkable + role-invariant default (Overview), mirroring `ProjectDetail` (CW-7). Back = plain navigate to `/procurement`. |
| **axe** | every panel renders into one `role="tabpanel"`; no nested interactive (DataTable row uses first-cell `<button>`, not `role="link"` on `<tr>`); filter chips are `<button aria-pressed>`. axe-core gate (Layer-1) on the rendered page. |

---

## 6. DESIGN.md tokens per element (no arbitrary values beyond the on-token `text-[11/12/13/13.5px]` family the app already uses)

| Element | Tokens / classes |
|---|---|
| Page surface | `secondary/35%` main, white `card`, 1px `border` (§4 Elevation: borders-not-shadows). |
| `RecordHeader` icon tile | `bg = hsl(var(--primary))` (or `hsl(var(--success))` when Paid) — KEEP existing. |
| Status pill | `StatusPill variant={pillVariantForStatus}`; text via `--status-*-text` AA tokens; dot + label (§5 Badges). |
| Bar stepper | `LifecycleStepper variant="bar"`: `jbar` track `secondary`, `done`/`paid`→`success`, `current`→`primary` (exempt from Freed-Blue, §5). |
| Tabs | active underline `primary`, inactive `text-muted-foreground` → `hover:text-foreground`, divider `border-b border-border`, `text-[13.5px]`, `h-11` (§5 Tabs / ui/Tabs). |
| Tab count badge | `secondary` bg + `muted-foreground`, full radius (`rounded-full`), `text-[11px]` (§5 Count badge). |
| StatTiles | `StatTiles` — white card, 16px pad, label `muted-foreground` 12.5px, value 23px/700 `tabular`. |
| Budget signal | `DecisionSupportPanel` (existing); budget pill `won`/`neutral` per healthy/not-started. |
| Detail `<dl>` | `<dt>` overline: `text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground`; `<dd>` `text-[13.5px]`; links `text-primary` (the `Field` grammar). |
| Progression timeline | rail `bg-border`, event dot `bg-success` / `border-success`; **current** dot `bg-background border-primary` + `ring` halo (`shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]`); date overline `text-[11px]` uppercase `muted-foreground`; title `text-[13.5px] font-semibold`; meta `text-[12px] muted-foreground`; doc ref `font-mono btn-link` (mono = §Do "SF Mono only for IDs"). |
| Ledger DataTable | DataTable signature: header 38px overline `text-[11.5px]` uppercase `muted-foreground`, rows 54px, divider `border/70`, hover `accent/60`, money `tabular` (Inter, NOT mono — §Don't "money is Inter-tabular"), System#/External ref `font-mono`. |
| Filter chips | `seg`-style: 28px, `rounded-full`, `border-input`, `text-[12px] font-medium muted-foreground`; active = `bg-primary/10 border-primary/30 text-[--nav-active-text]` (matches mockup; on-token). |
| Capture row | dashed prompt: `border-[1.5px] border-dashed border-primary/35 bg-primary/[0.04] rounded-[calc(var(--radius)-2px)]`, label `text-[13px]`, primary `btn btn-sm` "Capture `<type>`". |
| Vendor-quotes selected row | wash `bg-success/[0.06]`, "Selected · best value" `won` pill, `Select` = `btn-link` / `btn-sm`. |
| Action zone | `RecordActionZone` (sticky desktop `bg-background/95 backdrop-blur`); GateNotice `ready`(green)/`blocked`; primary verb = ONE `primary`, destructive at rest = `outline` (One-Blue / two-solid-fills rule — KEEP). |
| Confirm dialog | `ConfirmDialog` — the only solid `destructive` fill lives inside it (§5). |
| Empty states | `ListState variant="empty"` icon tiles `secondary` bg, `muted-foreground` (§ListState). |

No raw hex. No new radius (4/6/8/10/999 scale only). No second brand color, no new font, no new border value.

---

## 7. Sliced task breakdown (dependency-ordered; each independently buildable + unit-testable by `ui-implementer`)

Each slice maps to **JTBD P1** ("operate the whole case on one page: capture each document with dual-ID + file, and advance, without hunting across screens") plus the folded P2 (bid comparison) / P3 (budget signal adjacent to commit).

### Slice 1 — Tabbed shell + Overview bento
- **Build:** refactor `ProcurementDetails.tsx` to add `:tab` param + `Tabs` (PROC_TABS, default Overview, `setTab` → `navigate('/procurement/:id/:tab', {replace:true})`); add the `/procurement/:procurementId/:tab?` route in `App.tsx`. New `ProcurementOverviewTab` (StatTiles 2×2 + `DecisionSupportPanel` + Detail `<dl>` + Progression slot). Refactor `ProcurementHistoryTimeline` → `ProcurementProgressionTimeline` (newest-first, current-ring, doc links).
- **Keep wired:** header, stepper, loading/no-access/error guards, action zone (unchanged this slice).
- **Unit tests (Vitest/RTL):** default Overview renders 4 tiles + budget + detail + timeline; `:tab` param selects panel; unknown/absent `:tab` → Overview; Arrow-key tab nav + `aria-selected`; timeline empty-state; current-ring on latest event; Tabs `role`/`aria-controls` (extend `Tabs.a11y` pattern); deep-link `/procurement/:id/documents` lands on Documents.
- **JTBD P1/P3:** status-at-a-glance + budget signal on the landing tab.

### Slice 2 — Documents ledger (the case ledger)
- **Build:** `buildLedgerRows(detail)` pure fn (`src/lib/db/procurementLedger.ts`) unioning the 7 collections → chronological rows (dual-ID/amount/status/file/financial). `ProcurementLedger` component: filter chips (All/Financial/Has file) + `DataTable` (LEDGER_COLS) with md→card reflow. ABSORBS `ProcurementRecordsSection` + the inline "Document trail" Card + `ProcurementDocumentsSection` rows.
- **Unit tests:** `buildLedgerRows` — chronological order, empty types omit rows, multiple-per-phase all present, PO-less case (Payment row, no PO row), `financial` flag correctness; component — default table, filtered "Financial"/"Has file" subsets, filtered-empty state, full-empty state, md→card reflow renders all 7 columns, axe-clean.
- **JTBD P1:** every document captured (dual-ID + file) visible once, chronological, one surface.

### Slice 3 — Vendor quotes bid comparison
- **Build:** refactor `QuotationsSection` → `VendorQuotesTab`: side-by-side bid rows (Vendor · Amount · Valid until · Lead time · Terms · Select), selected-row wash + `won` pill, select-with-rationale (reuse `selectQuote` mutation + `selectedQuotation` helper).
- **Unit tests:** empty taught-state; renders N bids sorted; selected row marked; `Select` shown only while `Vendor Quoted` + `canSelect`; rationale capture → mutation called; read-only past Quote Selected.
- **JTBD P2:** bid comparison + select-with-rationale folded in.

### Slice 4 — Per-stage action zone + capture wiring + edge cases
- **Build:** `LedgerCaptureRow` (ONE affordance, `nextExpectedType(status)` pre-select, wraps `RecordCaptureForm`); wire it into `ProcurementLedger`; remove the 4 per-phase `RecordCaptureTrigger`s and the GR/VI ghost-link forms from the DecisionCard (capture now lives in the ledger; GR/VI inline-capture-before-transition stays in the action zone where the transition needs it). Verify `allowedActions`/`sortActions`/`sodGateMessage`/`commitTransition` render unchanged in the re-homed `RecordActionZone`.
- **Edge cases covered here:** PO-less (no required PO), multiple-per-phase (capture stays available), impersonation (real-role gate), terminal/rejected (capture hidden, terminal message).
- **Unit tests:** `nextExpectedType` per status (incl. PO-less fallback); capture row hidden when `!canWrite` / terminal; capture available after one record exists (multiple); each stage's action verbs + SoD gate copy (port the existing `ProcurementDetails` action tests to the new shell); payer≠approver hides Mark-as-Paid; requester self-approve blocked notice.
- **JTBD P1:** capture + advance from one surface, next-type pre-selected.

### Slice 5 — Responsive + a11y + states sweep
- **Build:** verify/finish bento single-col + Progression-below at <920; `ov-side` `lg:sticky`; ledger md→card; tabs scroll-snap; stepper scroll. Wire all empty/loading/error states (§2). Focus order + 44px targets + axe pass.
- **Unit tests:** bento single-render per breakpoint (no dual tree); ledger reflow @<768; no element right-edge > viewport @390/360 (extends `AC-MOBILE-OVERFLOW-001`); axe-clean on each tab; focus stays in keyboard path to the advance verb; reduced-motion respected (timeline/tabs).
- **JTBD P1:** the one-surface operation holds on mobile.

> Slices 2–4 each depend on Slice 1 (the shell + panels). Slice 5 depends on 1–4. Slices 2 and 3 are independent of each other (parallelizable after 1).

---

## 8. What gets DELETED (the accretion removed — net simplification, not addition)

Removed entirely (their function is absorbed by the ledger / bento / single action zone):

1. **`ProcurementRecordsSection`** (4 stacked per-phase `PhaseCard`s, each with its own "No X recorded yet" + capture) → the ONE `ProcurementLedger` DataTable + the ONE `LedgerCaptureRow`.
2. **The inline "Document trail" `<Card>`** in `ProcurementDetails.tsx` (the `DocRow` PR#/VQ#/PO#/GR#/VI# list + per-row `ProcurementFilesSubsection`) → ledger rows' System # / External ref / File columns. (`DocRow` component deleted.)
3. **`ProcurementDocumentsSection`** as a separate stacked register (the procurement_documents metadata list) → folded into the same ledger (its file rows become ledger rows / "Has file" filter). *(Confirm with owner whether procurement_documents metadata is a ledger row or a per-row file attachment; default: file attachment surfaced via the File column + "Has file" chip.)*
4. **The standalone "Progression history" `<Card>`** at the bottom of `ProcurementRecordsSection` → the Overview bento's 1/3 Progression timeline (history folded into Overview; no separate History tab, per owner edit).
5. **The 4 scattered `RecordCaptureTrigger`/`RecordCaptureForm` mounts** + the **GR/VI ghost-link forms in the DecisionCard** → the ONE `LedgerCaptureRow` (GR/VI inline-capture-on-transition stays only where the transition itself needs it).
6. **The 7× "No X recorded yet" empty cards on a Draft** → 1 ledger row + 1 capture affordance + taught Items/Quotes empties. (The de-dup proof point.)

Net: from a single-altitude stack of ~7 full-width sections (+ 4 redundant progression encodings) to **4 tabs + 1 bento + 1 ledger + 1 stepper + 1 action zone** — each piece an existing molecule.

---

## 9. Traceability hooks (for the eng-planner / qa-acceptance handoff)
- Reuse existing `data-testid`s: `record-action-zone`, `decision-card`, `procurement-status-badge`, `procurement-loading`, `procurement-no-access`, `mobile-back-bar`, `mobile-sticky-action`.
- New: `procurement-tabs`, `procurement-ledger`, `ledger-capture-row`, `procurement-progression`, `vendor-quotes`, per-tab panel ids via `tabPanelId('procurement-detail', tab)`.
- The lifecycle/SoD ACs (AC-800..806, AC-IXD-PROC-*) are **unchanged** — re-home only; their owning tests move to the new shell, asserting the same goals (BDD: app conforms to test).

---

## 10. Open questions / items for the Director to resolve

1. **Route shape:** adopt `/procurement/:procurementId/:tab?` (deep-linkable, role-invariant default Overview) to match `ProjectDetail`. This is a **route addition, not a design-system change** — recommend yes (consistency). The current `/procurement/:procurementId` keeps working (defaults to Overview).
2. **`procurement_documents` metadata vs file attachment in the ledger** (delete-item #3): default = surface uploaded files via the ledger File column + "Has file" chip; the separate metadata register is dropped. Confirm this is the intended consolidation (the mockup shows one File column, not a metadata sub-table).
3. **`Export case PDF`** on the terminal (Paid) action zone is shown in the mockup as an outline button. Confirm it's in-scope for this revamp or a later slice (recommend: **stub out of v1** — it's a new capability, not part of the re-shell; the action zone simply shows the terminal message until then).
4. **Default tab = Overview** (owner edit) — confirmed by the contract; note this **overrides** the README's earlier "Records is the landing tab" caveat. No conflict: the owner's later edit wins.

**Design-system conflicts with the app archetype / DESIGN.md: NONE.** The hybrid reuses `Tabs` + `DataTable` + bar stepper + `RecordHeader` + `RecordActionZone` + `StatusPill` + `ListState` exactly as `ProjectDetail` does. No molecule extension, no token addition, no `DESIGN.md` edit.
