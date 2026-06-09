# Wave 5 · Cluster 3 — Project/record detail legibility (design-plan)

**Author:** design-architect · **Date:** 2026-06-10 · **Branch target:** new branch off `main`
**Scope:** IxD/naturalness, **desktop-first** (mobile = Wave 4; note breakpoints, do not optimize 375px).
**Surfaces:** the unified `/projects/:id` detail (header + Overview + PipelineLens banner) and the procurement detail (`/procurement/:id`).
**Authority model:** every visual decision below names a `DESIGN.md` token. FE-only. Gating reads the **real JWT role** (`useEffectiveRole().realRole` / `usePermission`); RLS/RPC stays the enforcement authority. **Never show LESS than RLS forbids — only reprioritize.**

Findings addressed: **D15** (finance chrome for the wrong audience), **D9** (illegible PR/PO/VQ/GR/VI lifecycle), **D17** (GR/VI affordances too loud), **N10** (stranded after a deal transition).

---

## 0. OWNER-DECISION flags (take these to the owner before build)

These three gate the build. Recommendations are given; the owner confirms or overrides.

### OD-flag A — D15: how far to demote finance chrome for non-finance roles
The unified `/projects/:id` (`ProjectDetailHeader`) leads with a 5-tile finance strip (Contract / Committed / Actual / On-hand margin / Spend %) plus the contract-value SoD row. For an **Engineer** (read-mostly, no finance authority, there for Tasks) this is the first thing on the page and pure noise. Three options:

| Option | What it does | Trade-off |
|---|---|---|
| **(a) Hide** | Drop the StatTiles strip + SoD row entirely for non-finance roles | Cleanest lead, but hides data RLS *permits* the Engineer to read (the figures are visible on Budget tab) → reads as "missing", not "demoted" |
| **(b) Move-below** ✅ RECOMMEND | Keep the strip but render it **below** the tabs / inside Overview, not in the header. Header for non-finance leads with name + status + the *delivery* facts (PM, dates, code). Tabs default to **Tasks** for Engineer. | Data stays reachable + labelled; the page leads with what the Engineer does; reversible; smallest semantic risk |
| **(c) Collapse** | Keep the strip in place but collapsed behind a "Show financials" disclosure (default-closed for non-finance) | One extra click for data they're allowed to see; disclosure adds chrome of its own |

**Recommendation: (b) move-below + Engineer default-tab = Tasks.** It satisfies "lead with what the role does" without ever hiding RLS-permitted data, and it is the least destructive to the existing header markup (the tiles component is reused, just relocated for one role-class). PM/Exec/Finance keep the finance-forward header exactly as today. **Decision needed:** confirm (b), or pick (a)/(c).

### OD-flag B — N10: post-transition wayfinding pattern (inline affordance vs auto-navigate)
After Advance / Mark-won / Mark-lost in `PipelineLens`, the user stays on the same record with a toast and no "what next." OD-UX-1 already made the routine Advance single-click + toast (correct — keep). OD-W3-4 locked **"the detail page stays the single place to advance a deal"** (no board DnD). So N10 is purely *wayfinding after the toast*, not a flow change.

| Option | What it does | Trade-off |
|---|---|---|
| **Auto-navigate** | After a transition, route the user away (back to pipeline / to next deal) | Violates OD-W3-4's "open-detail-to-advance" spirit — a PM advancing through stages wants to STAY and keep working the same deal; auto-nav yanks them off |
| **Inline affordance** ✅ RECOMMEND | Keep the user on the record; surface a quiet **"Back to Sales Pipeline"** link in the PipelineLens "Next actions" card, made more prominent for **terminal** transitions (Won/Lost), where there genuinely is no next action on this lens | Respects OD-W3-4; the link is wayfinding, not a redirect; zero risk to the advance flow |

**Recommendation: inline affordance.** A persistent quiet "Back to Sales Pipeline" link in the Next-actions card, and on a **terminal** stage (Won → now a delivery project; Lost) the card's empty-state copy gains a clear next step ("This deal is won — it's now an active project. Plan its budget and tasks in the tabs below." / "Back to Sales Pipeline"). The toast stays as the immediate feedback (OD-UX-1). **Decision needed:** confirm inline-affordance, or owner wants auto-navigate on terminal only.

### OD-flag C — D9: Tooltip-per-node vs a persistent legend
The procurement stepper shows nodes labelled PR / VQ / PO / GR / VI / Paid (`lifecycleSteps`). The acronyms are cryptic to non-power-users.

| Option | What it does | Trade-off |
|---|---|---|
| **Tooltip-per-node** | Hover/focus each node → "Goods Receipt", etc. | Discoverable only on hover; mobile/touch can't hover (Wave 4 concern); a11y needs the label reachable another way |
| **Persistent legend** | A one-line legend strip under the stepper spelling every acronym | Always visible, zero discovery cost, touch-safe; small vertical cost |
| **Both** ✅ RECOMMEND | Node labels show the **full word** at the node where space allows; the mono acronym stays as the `ref` line; **plus** an `aria-label`/`title` on each node carries the full name for SR + hover | Self-explanatory at a glance AND machine-readable; no reliance on hover alone |

**Recommendation: full-word node labels + accessible name on each node (no separate legend block).** The stepper already renders a `label` per node and a mono `ref`; change the label source so the node reads **"Goods Receipt"** (full) with the mono **"GR-0042"** as its ref, and add a `title`/`aria-label` carrying the full name. This makes the lifecycle self-explanatory without adding a legend strip the eye has to cross-reference. **Decision needed:** confirm full-word-labels approach, or owner prefers a persistent legend strip (keeps short acronym labels + a legend row).

---

## 1. Per-surface design

### 1a. Role-adaptive project header / Overview (D15)

**Current:** `ProjectDetailHeader` renders, for the *delivery* lens, `<StatTiles columns={5}>` (Contract / Committed / Actual / On-hand margin / Spend %) + the contract-value SoD row, directly under `PageHeader`. This is identical for every role.

**Change (recommended option b):** introduce a single FE predicate `hasFinanceView = MONEY_AUTHORITY.includes(realRole)` — i.e. **Admin · Executive · Finance** — plus **Project Manager** (the PM owns the delivery P&L and must see margin). Call this set **finance-forward roles = Admin · Exec · Finance · PM**. The complement (**Engineer**, and any future non-finance role) is **delivery-forward**.

- **Finance-forward roles:** header is **unchanged** — finance StatTiles strip + SoD row stay in the header, exactly as shipped. Default tab stays Overview.
- **Delivery-forward roles (Engineer):**
  - The header `PageHeader` keeps name + StatusPill + the **delivery meta** (customer, code, PO ref, PM, dates) — these are the facts an Engineer orients on.
  - The finance StatTiles strip + the contract-value SoD row are **removed from the header** and **relocated into the Overview tab** under a labelled, clearly-secondary "Financial summary" card (so the data RLS permits stays reachable and labelled — never deleted).
  - The project detail **defaults to the Tasks tab** for an Engineer (the page leads with what they do). Other tabs remain one click away; deep-links to a specific tab still win.

A small `<aside aria-label="Financial summary">` wrapper in Overview holds the relocated strip for delivery-forward roles, so it reads as a secondary block, not the page lead.

**Role × prominence table (D15):**

| Surface element | Admin | Executive | Finance | Project Manager | Engineer |
|---|---|---|---|---|---|
| Header finance StatTiles (Contract/Committed/Actual/Margin/Spend) | Header, prominent | Header, prominent | Header, prominent | Header, prominent | **Moved to Overview "Financial summary" card (secondary)** |
| Contract-value SoD row | Header (editable per SoD) | Header (editable) | Header (editable) | Header (read-only lock pre-/post-win per ADR-0019) | **Moved to Overview card, read-only lock** |
| Default landing tab | Overview | Overview | Overview | Overview | **Tasks** |
| Header leads with | name + status + finance | name + status + finance | name + status + finance | name + status + finance | **name + status + delivery meta (PM, dates, code)** |
| Budget tab figures | full | full | full | full | full (RLS-permitted; unchanged) |
| PipelineLens deal figures (pre-win) | full | full | full | full | full (read-only note, unchanged from Wave-2) |

> Note: PM is intentionally **finance-forward** — the PM is the delivery-budget owner; demoting margin for the PM would hide the number they manage. Only roles with *no* delivery/finance authority (Engineer today) are delivery-forward. This keeps the rule "lead with what THAT role does" honest.

**States:**
- *Default (delivery, finance-forward):* header strip renders as today.
- *Delivery-forward (Engineer):* header has no finance strip; Overview shows a "Financial summary" card.
- *Pre-win (pipeline/lost):* the finance strip is already suppressed for **all** roles (Model B — no contract yet); the PipelineLens banner owns the deal figures. D15 change applies only to the delivery lens, so pre-win is unaffected.
- *Loading / error / not-found:* unchanged (handled in `ProjectDetail` shell).
- *Empty:* an Engineer on a project with no tasks lands on Tasks → the Tasks tab's existing empty state carries.

### 1b. Lifecycle legend / hover treatment (D9)

**Procurement stepper** (`ProcurementDetails` → `LifecycleStepper variant="node"`, fed by `lifecycleSteps`):
- Change the node **label** to the **full stage name**: Purchase Request, Vendor Quote, Purchase Order, Goods Receipt, Vendor Invoice, Paid. The mono doc reference (PR-0042, GR-0042, …) stays on the existing `ref` line under the node.
- Add an **accessible name + tooltip** to each node: `LifecycleStepper` node gets a `title={fullName}` and the existing `aria-label` already reads `"${label}: ${state}"` — with the full-word label this now reads "Goods Receipt: current" to a screen reader, which is the win. A `Tooltip` wrapper (the DESIGN.md dark-surface tooltip) on hover/focus is **additive**, not the only source of the meaning (full-word label is always visible).
- **Deal-stage journey** (`PipelineLens` → `dealJourneySteps`): audit for cryptic labels. The deal stages (Leads, PQ Submitted, Quotation Submitted, Tender Submitted, Negotiation, Won/Lost) are mostly words already; **"PQ"** is the one acronym → expand the node label to **"Pre-Qualification"** (keep "PQ" only if it must stay short, with a `title`). Lower-risk than procurement; bundle in the same PR.

**Tooltip a11y:** the tooltip is keyboard-reachable (focus the node → tooltip shows) and is never the **only** carrier of the label (full word is in the visible label). The stepper is `role="list"` / `role="listitem"` already; keep it.

### 1c. GR/VI affordance demotion (D17)

**Current:** at the `Ordered`/`Received` stage the "Create Goods Receipt" button and at `Vendor Invoiced` the "Create Vendor Invoice" button render as `variant="primary"` (solid blue) inside their own `Card`, below the DecisionCard. With the stage's real primary CTA (Confirm Receipt / Mark as Paid) also blue in the DecisionCard, **two blues compete** — a One-Blue-Rule violation and exactly the D17 finding.

**Change:** demote the GR/VI **create triggers** to a **quiet secondary** so the stage's true primary stands alone.
- The collapsed trigger ("Create Goods Receipt" / "Create Vendor Invoice") becomes a **ghost/link-style button** (`variant="ghost"` with `text-primary` link treatment, or a plain text-button) sitting **inside the DecisionCard, below the action row** — co-located with the decision, not in a separate competing card. It reads as "and, if needed, record the receipt", subordinate to the stage primary.
- Once expanded, the **form's submit** stays a clear affordance but uses **`variant="primary"`** only while the form is open (the form IS the focused task at that point, and the stage primary is not competing inside the open form) — OR keep `success` consistent with the inline-VI capture's "Confirm & Mark Invoiced". Recommend: open-form submit = `primary` (the One-Blue is now the submit, the only action in the open form), cancel = `ghost`.
- Do **not** regress the PR-1 DecisionCard hierarchy already shipped (evidence-zone above, decision-zone below, primary → outline → destructive ordering). The GR/VI trigger slots **below** the action row, inside the DecisionCard's `CardPad`, as a quiet tertiary line. The separate GR/VI `Card`s are removed; their forms render inline in the DecisionCard (mirrors the existing inline VI-capture pattern).

**Net effect per stage — exactly one blue at rest:**
- *Ordered/Received:* primary = "Confirm Receipt" (blue). "Record goods receipt" = quiet link below it.
- *Vendor Invoiced (recovery):* primary path is already the inline VI-capture; the recovery "Create Vendor Invoice" after-form becomes the quiet link.

**States:** collapsed (quiet link) / expanded (inline form, submit = the only blue) / busy (loading on submit) / error (existing inline `role="alert"` + classified toast) / stage-passed (link disappears, per existing `canShowGRForm`/`canShowVIForm` gating — unchanged).

### 1d. Post-transition wayfinding (N10)

**In `PipelineLens` "Next actions" card:**
- Add a persistent quiet **"Back to Sales Pipeline"** text-link (link-style, `text-primary`, `hover:underline`) at the **foot** of the Next-actions card — always present on the pipeline lens, so after any Advance the user has an obvious exit without it competing with the Advance primary.
- On a **terminal** transition the card's body already shows a GateNotice ("terminal stage / no further actions"). Enrich that copy with the concrete next step:
  - **Won →** the record is now a delivery project; the PipelineLens banner disappears on the next render (status leaves the pipeline group) and the delivery tabs take over. Because the banner unmounts, the wayfinding for Won must live in the **toast + a brief success affordance**: after a successful Mark-won, show the toast ("Deal won — now an active project") and let the page re-render into the delivery layout (header finance strip + tabs appear). No stranded state — the page visibly becomes the project. Recommend the toast copy name the transition outcome so the user understands the page changed *because* they won it.
  - **Lost →** the banner stays (lost is still a pre-win-group lens). The Next-actions GateNotice copy becomes: "This deal is marked lost. It has left the active pipeline." + the "Back to Sales Pipeline" link rendered more prominently (it is now the only meaningful action).
- **Focus management:** after a transition that keeps the user on the page (Advance, Lost), move focus to the updated Next-actions card heading (or the success region) so a keyboard/SR user is told what changed; after Won (page becomes delivery), focus moves to the project header `h1`. This pairs with the toast (toast is `aria-live`, focus is the deliberate landmark).

---

## 2. All states + WCAG-AA a11y

**States covered per surface:** default, role-variant (finance-forward vs delivery-forward), pre-win/terminal, loading, error, empty, busy (in-flight transition/create), success (toast + focus), stage-passed (affordance gone). Responsive: desktop-first; the StatTiles relocation and inline GR/VI forms use the existing `lg:` breakpoints; **note** for Wave 4 that the relocated "Financial summary" card and the full-word stepper labels will need the 920px rail-collapse + horizontal-scroll stepper (`overflow-x-auto` already present) re-checked at 375px — not optimized now.

**A11y (WCAG-AA):**
- **Tooltip keyboard-accessible + not the only affordance (D9):** full-word labels are always visible; tooltip/`title` is additive; node `aria-label` carries "FullName: state". Focus reaches each node (it is in a `role="list"`).
- **Demoted-but-present finance data reachable + labelled (D15):** the relocated "Financial summary" card has a visible heading and `<aside aria-label="Financial summary">`; every figure keeps its `tabular` class and label. Nothing RLS permits is removed.
- **Legend not color-only:** stepper state is conveyed by the check glyph (done/paid) and number (upcoming/current) + label, not color alone (already true in `LifecycleStepper`); keep.
- **Post-transition affordance focus-managed (N10):** explicit focus move after each transition (card heading for Advance/Lost, page `h1` for Won); toast is `aria-live`. The "Back to Sales Pipeline" link has standalone text (passes link-text rule).
- **Contrast:** all text uses existing AA-cleared tokens (`muted-foreground` darkened to L40, `text-primary` link on white ≥4.5:1, status pill darkened-text variants). No new low-contrast pairing introduced.
- **Focus ring:** every new link/button inherits the global `:focus-visible` ring (`2px ring`, 2px offset).

---

## 3. Exact DESIGN.md tokens per piece

| Piece | Tokens (DESIGN.md names) |
|---|---|
| Header / relocated finance strip | `card` bg, `border` 1px, `rounded.md`, `spacing.4` pad; KPI/StatTile pattern (label `muted-foreground` 12.5px, value 23px/700 `tabular`); negative margin → `destructive` |
| "Financial summary" aside (Engineer Overview) | `card`, `border`, `rounded.md`, heading = **Heading** type token; `<aside>` landmark |
| Contract-value SoD lock | `secondary` bg pill + `muted-foreground` text + `lock` icon (existing read-only treatment) |
| Stepper full-word labels | `LifecycleStepper variant="node"`: label = **label**/Overline-ish 11.5px/600; node states use `primary` (current), `success` (done/paid), `secondary`/`border` (upcoming/skipped); ref line = **mono** 10px `muted-foreground` |
| Stepper tooltip | Tooltip overlay token: dark surface `hsl(240 10% 8%)`, near-white text, `rounded` 7px, overlay shadow `0 8px 24px /0.4`, max 280px |
| GR/VI demoted trigger | `button-ghost` (transparent, `foreground`/`text-primary` link), `accent` hover wash; **no** solid fill at rest |
| GR/VI open-form submit | `button-primary` (the only blue while form open); cancel = `button-ghost` |
| GR/VI inline form fields | `input` token (32px, `input` border, `rounded.md`, `background`), label = **label** type, `:focus-visible` ring |
| "Ready to advance" / terminal notices | existing `GateNotice` (ready/blocked variants) — `success`/`destructive` tints, AA darkened text |
| "Back to Sales Pipeline" link | `text-primary` link, `hover:underline`, `:focus-visible` ring — One-Blue compliant (link-in-context is a sanctioned blue use) |
| Won/Lost/Advance toast | `popover` bg + 3px left accent stripe (`primary` / `success`), overlay shadow, `aria-live` |

**New-token check:** **none required.** Every piece reuses shipped tokens (the One-Blue link, ghost button, tooltip overlay, StatTile, GateNotice all exist). The contract-value lock pill, the stepper, and the tooltip are all in DESIGN.md §5. **No DESIGN.md edit needed.** (Flag: if the owner picks D9 option = persistent legend strip, that legend row would reuse `muted-foreground` + `mono` — still no new token.)

---

## 4. PR breakdown (recommended split — 2 PRs)

**PR-1 — Procurement detail legibility (D9 + D17), `ProcurementDetails.tsx` + `LifecycleStepper`/`lifecycleSteps` only.**
- D9: full-word stepper labels + `title`/`aria-label` on each node (procurement stepper; same change applied to `dealJourneySteps` PQ→Pre-Qualification can ride here or in PR-2 — recommend PR-2 since it touches the pipeline file).
- D17: demote GR/VI create triggers to quiet links inside the DecisionCard; remove the two competing `Card`s; submit-in-open-form = the only blue.
- Smaller, self-contained, no role logic, lowest risk → ship first. Touched e2e: the procure-to-pay journey (AC-816) and any stepper/decision-card unit tests.

**PR-2 — Project detail role-adaptive header + post-transition wayfinding (D15 + N10), `ProjectDetailHeader.tsx` + `ProjectDetail.tsx` + `PipelineLens.tsx` + `OverviewTab.tsx`.**
- D15: `hasFinanceView` predicate; relocate finance strip + SoD row to Overview "Financial summary" card for delivery-forward roles; Engineer default tab = Tasks. **The meatiest slice** (changes the page's lead for a whole role-class).
- N10: persistent "Back to Sales Pipeline" link in Next-actions; terminal-stage copy; focus management on transition.
- D9-pipeline: PQ → Pre-Qualification label (rides here since it touches `PipelineLens`/`dealJourneySteps`).
- Touched e2e: the role-shaped detail journeys + the win/advance pipeline journey; `ProjectDetailHeader`/`PipelineLens`/`ProjectDetail` unit + RBAC tests.

> Both PRs follow the gated cadence (implementer → verify → code-quality-reviewer → run touched e2e LOCALLY pre-push → PR → CI → merge). PR-1 can merge independently; PR-2 depends on owner sign-off of OD-flags A & B.

---

## 5. Which surfaces warrant a mockup vs review-post-build

- **D15 role-adaptive header (PR-2) — RECOMMEND A MOCKUP.** It changes the page's lead for an entire role-class (Engineer sees a structurally different page). A rendered mockup of the Engineer view (header without finance strip, Tasks-first, Overview "Financial summary" card) vs the PM view (unchanged) lets the owner sign off the "demote, don't delete" feel *before* build — exactly the lesson from the unified-detail-page override (a sound-on-paper demotion can read wrong once rendered). Mockup the two header variants side by side.
- **D17 GR/VI demotion — review-post-build.** Small, well-bounded hierarchy tweak against the shipped DecisionCard; the design-review rendered pass catches any One-Blue regression.
- **D9 stepper labels — review-post-build.** Pure label/affordance change; verify in the rendered design-review (full words fit the node width; tooltip fires on focus).
- **N10 wayfinding — review-post-build.** Quiet link + copy + focus; verify in the rendered pass.

---

## Traceability / acceptance anchors (for the eng-planner plan)
- D15 → AC: an Engineer's `/projects/:id` leads with Tasks, header carries no finance StatTiles, and the figures are reachable + labelled in Overview "Financial summary"; a PM/Exec/Finance header is unchanged. (Owning layer: Vitest/RTL render-by-role.)
- D9 → AC: each procurement stepper node exposes its full stage name as visible label + accessible name. (Vitest/RTL.)
- D17 → AC: at Ordered/Vendor-Invoiced exactly one solid-blue action renders at rest in the DecisionCard; GR/VI create is a quiet link. (Vitest/RTL.)
- N10 → AC: after Advance the user stays on the record with a "Back to Sales Pipeline" affordance present and focus moved to the updated card; after Mark-won the page becomes the delivery layout with focus on the header. (Vitest/RTL for the FE wayfinding; the existing win/advance e2e remains the cross-stack proof.)
