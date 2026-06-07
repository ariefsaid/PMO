# Design-plan: Confirmation-on-mutations + action hierarchy

- **Date:** 2026-06-07
- **Workstream:** Confirmation-on-mutations + action hierarchy (owner directive + audit I4)
- **Author:** design-architect (impeccable `shape` + ui-ux-pro-max `plan` + taste fold)
- **Charter:** `docs/product-expectations.md` Part C "Design/UI". `DESIGN.md` is the design-system source of truth. Per-UI flow = design-plan -> implement -> /design-review.
- **Audit authority:** `docs/reviews/2026-06-07-ui-slop-audit.md` (owner directive line 41 + finding **I4** line 18).
- **Identity:** RIS "Quiet Control Surface" tokens ONLY. No new aesthetic, no AI-slop, no new palette/font.

> **Owner rule of thumb (binding):** NOTHING writes to the DB on a single click. Every data-mutating action gets a confirmation/approval step. Irreversible/destructive actions (Mark lost, Reject, Cancel, Delete draft) get a **mandatory** confirm; forward steps get a **lightweight** confirm.

---

## 1. Summary

Introduce one reusable **`ConfirmDialog`** primitive (DESIGN.md-tokened) and wire it to **every** DB-mutating call-site in the app so no mutation fires on a single click. After each mutation resolves, show a success/error toast via the existing `useToast`. Also fix audit **I4**: invert the OpportunityDetail "Next actions" hierarchy so the primary path (Advance) is the primary blue and Mark won/lost are quiet outline + status-dot, with the destructive solid fill appearing ONLY inside the confirm.

This is **conflict-safe LAST** among code-changers: it touches procurement, project, budget, and timesheet surfaces. See [crossDeps](#9-cross-workstream-dependencies-build-sequencing).

---

## 2. Primary user action

Trigger a state-changing action (transition / create / submit / approve), **review what is about to change in a confirm step**, then commit it deliberately, and get unambiguous success/error feedback.

---

## 3. Design direction

- **Color strategy:** Restrained (product floor per impeccable product register). The dialog is a white `card`/`popover` surface; the One-Blue does the primary-confirm work; the `destructive` solid fill appears ONLY on the destructive confirm button inside the dialog.
- **Scene sentence:** An operator at a desk (and sometimes a phone) deliberately committing a budget/procurement/pipeline change in a calm, dense control surface, pausing once to confirm before the DB is touched. -> light scheme (DESIGN.md is light-only; no dark block exists).
- **Anchor references (product-register, named not adjectives):** Linear's command-confirm dialogs, Stripe Dashboard destructive-action modals, Radix `AlertDialog` semantics. We replicate their *discipline* (focus-trap, Esc, one primary CTA, destructive emphasis), not their skin.

### 3.1 Modal-as-first-thought guardrail (resolves the product-register tension)

impeccable's product register bans "modal as first thought." We reconcile with the owner rule via **two confirm severities**, so a modal is used only where it earns its weight:

| Severity | When | Surface | Scrim |
|---|---|---|---|
| **Lightweight (`popover`)** | Forward / non-destructive steps (Advance, Submit Request, Approve, Submit timesheet, Create version/GR/VI/quotation, Activate, Clone) | Anchored popover from the trigger button (reuses the existing `#rowmenu` overlay vocabulary in DESIGN.md "Overlays") | none |
| **Destructive (`modal`)** | Irreversible / destructive (Mark lost, Reject, Cancel request, Delete draft, Archive, Return/reject timesheet) | Centered modal dialog with scrim | yes, `40-60%` per ui-ux-pro-max `modal-motion` |

Existing inline progressive panels that ALREADY satisfy the rule are **preserved, not modalized**: the OpportunityDetail "Record the won deal" SoD capture panel and `ProjectStatusControl`'s win form. The Confirm button *inside* those panels is the confirm step. (Do not double-confirm.)

---

## 4. Scope

- **Fidelity:** production-ready, shipped-quality component + wiring.
- **Breadth:** one new primitive + every mutation call-site across 6 page/component files.
- **Interactivity:** shipped component (focus-trap, Esc, keyboard, toast).
- **Time intent:** polish-until-it-ships.

---

## 5. The `ConfirmDialog` primitive

### 5.1 File + export surface

- **New file:** `pmo-portal/src/components/ui/ConfirmDialog.tsx`
- **New test:** `pmo-portal/src/components/ui/__tests__/ConfirmDialog.test.tsx`
- **Barrel:** add to `pmo-portal/src/components/ui/index.ts` (after the `Toast` export, line ~26).

### 5.2 API

```ts
export type ConfirmTone = 'default' | 'destructive';
export type ConfirmSurface = 'modal' | 'popover';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;                 // verb + object, e.g. "Mark deal as lost"
  description: React.ReactNode;   // what will change, in plain language
  confirmLabel: string;           // verb + object, e.g. "Mark lost"
  cancelLabel?: string;           // default "Cancel"
  tone?: ConfirmTone;             // 'destructive' -> red confirm + modal+scrim; default -> primary confirm
  surface?: ConfirmSurface;       // derived: destructive => 'modal', default => 'popover' (overridable)
  loading?: boolean;              // confirm in-flight: spinner + disabled (reuses Button loading)
  onConfirm: () => void;
  onCancel: () => void;
  /** popover only: ref of the trigger to anchor against; ignored for modal. */
  anchorRef?: React.RefObject<HTMLElement>;
}
```

### 5.3 Token mapping (NO raw hex/px in decisions; every value names a DESIGN.md token)

| Piece | DESIGN.md token | Notes |
|---|---|---|
| Dialog surface bg | `colors.popover` (white) | matches `#rowmenu` / toast surface |
| Dialog surface text | `colors.popover-foreground` | near-black |
| Dialog border | `colors.border` (1px, the Single-Border Rule) | Flat-By-Default: border, not shadow, at rest |
| Dialog radius | `rounded.md` (8px) | the radius spine |
| Dialog shadow | DESIGN.md Elevation "Overlay" (`0 10px 30px hsl(240 10% 8% / 0.16), 0 2px 6px hsl(240 10% 8% / 0.08)`) | true overlay -> earns a shadow |
| Modal scrim | `colors.foreground` at low alpha (`bg-foreground/40`-`/50`) | desaturated near-black, NOT `rgba(0,0,0,...)` (No-Pure-Black-Shadow Rule) |
| Title type | `typography.subheading` (600, 18px) | one heading per dialog |
| Description type | `typography.body` (400, 14px, lh 1.45) | capped at ~65ch (`max-w-[60ch]`) |
| Confirm (default tone) | component `button-primary` | One-Blue primary action |
| Confirm (destructive tone) | component `button-destructive` | the ONLY solid status fill (Tinted-Status Rule); appears only here |
| Cancel | component `button-outline` | quiet, secondary |
| Padding | `spacing.4` (16px) modal, `spacing.3` (12px) popover | card padding standard / compact |
| Focus ring | global `:focus-visible` = `2px solid {colors.ring}` 2px offset | single source of truth |
| Destructive icon | existing `alert` icon (icon set), `[&_svg]:text-destructive` | NO emoji (taste ban) |
| Motion | scale+fade 150ms ease-out (`product-motion-quick-transitions`); crossfade-only under reduced-motion | `modal-motion` from trigger source |

All of these consume the **existing Tailwind v4 token utilities** (`bg-popover`, `border-border`, `rounded-lg`, `bg-foreground/40`, `text-destructive`, etc.) already wired per DESIGN.md "How to use these tokens." Reuse the `Button` primitive for both buttons (do not hand-roll button styling). The "Overlay" shadow already appears verbatim in `Toast.tsx` (`shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]`) and `ProjectStatusControl.tsx` (`shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]`) -> copy that exact class so elevation stays consistent.

### 5.4 a11y contract (WCAG-AA) -- folded from ui-ux-pro-max + taste

- **Role/semantics:** modal => `role="alertdialog"` (destructive) with `aria-modal="true"`, `aria-labelledby` (title id) + `aria-describedby` (description id). Popover => `role="dialog"` + the same labelled-by/described-by wiring.
- **Focus trap (modal):** focus moves to the Cancel button on open (safe default for destructive: not the destructive confirm); Tab/Shift+Tab cycle within the dialog; focus restored to the trigger on close (`focus-management`, `escape-routes`). Popover does the same minus the scrim.
- **Esc to close:** `Escape` calls `onCancel` (`modal-escape`). Click on scrim (modal) calls `onCancel`. Outside-click (popover) calls `onCancel`.
- **Keyboard paths:** Cancel = first focus + Esc; Enter on the focused confirm commits; full Tab order is Cancel -> Confirm (DOM order matches visual; destructive confirm is NOT the default-focused element).
- **Contrast:** all token pairs already AA per DESIGN.md "Accessibility posture" (destructive-foreground on destructive is AA; body text near-black on white is AAA). Description text is `foreground`, not `muted-foreground`, so it clears 4.5:1 (taste/impeccable color rule).
- **Touch targets:** both buttons are `Button` default `h-8` (32px). **I5 caveat:** on coarse-pointer/mobile the action row gets `gap-2` and the buttons grow padding to a >=44px hit area (`touch-target-size`); do this via `[@media(pointer:coarse)]` padding, not a taller visual button (don't break the 32px control rule on desktop).
- **Color-not-only:** destructive tone carries the `alert` icon + red, never red alone (`color-not-only`).
- **Toast:** confirmation feedback uses the existing `useToast` (`role="status"`, `aria-live="polite"`, does not steal focus -> `toast-accessibility`). Success => `'success'` kind; failure => `'warning'` kind with the verbatim RPC error (so the P0001 SoD message still surfaces).

### 5.5 z-index (semantic scale, not arbitrary)

DESIGN.md has no z-scale; this is a flagged gap. The existing code uses `z-[900]` (Tooltip), `z-[1000]` (Toast), `z-20` (ProjectStatusControl popover). Adopt the existing values so layering stays consistent: modal scrim `z-[800]`, modal dialog `z-[810]`, popover `z-[820]` (above page chrome, below toast `z-[1000]` so success toasts render over a closing dialog). Record this as a proposed DESIGN.md addition (see [Open Questions](#10-open-questions--proposed-design-md-additions)).

### 5.6 Required states (taste Rule 5 + impeccable product "all states")

| State | Behavior |
|---|---|
| **default/idle** | dialog closed; trigger button rendered normally |
| **open** | dialog visible, focus trapped, scrim (modal) painted |
| **loading** | Confirm shows `Button loading` spinner + `aria-busy`; both buttons disabled; Esc still cancels only if not in-flight (block close while pending to avoid orphaned mutations) |
| **success** | dialog closes, focus restored, success toast |
| **error** | dialog closes (or stays open with inline error -- see per-call-site below), warning toast with RPC message; trigger re-enabled |
| **edge: rapid double-click** | confirm button disabled during `loading` so the mutation cannot double-fire |
| **edge: reduced-motion** | crossfade/instant, no scale (`reduced-motion`) |

---

## 6. EXHAUSTIVE mutation call-site inventory (every DB write)

Every row below currently mutates the DB. Each gets a confirm. "Severity" picks the surface per [3.1](#31-modal-as-first-thought-guardrail-resolves-the-product-register-tension). Tokens column names the confirm-button token. All call-sites already surface errors inline and/or toast; the confirm wraps the existing handler -- the RPC contract (args, no `org_id`) is **byte-for-byte preserved**.

### 6.1 Procurement -- `pmo-portal/pages/ProcurementDetails.tsx`

Mutations via `useProcurementMutations(id)` (`transition`, `createReceipt`, `createInvoice`, `createQuotation`). Action variants come from `allowedActions()` (already classify severity).

| # | Call-site (line) | Action | Severity / surface | Confirm copy (title / confirm label) | Confirm token |
|---|---|---|---|---|---|
| P1 | action buttons `handleTransition(action.to)` (lines 348-360), forward variants `primary`/`success` (Submit Request, Request Vendor Quotes, Generate PO, Select Quote, Confirm Receipt, Mark Vendor Invoiced, Mark as Paid) | transition forward | lightweight popover | "Move request to {to}?" / action.label | `button-primary` |
| P2 | same map, `variant: 'destructive'` actions: **Reject** (to `Rejected`), **Cancel** (to `Cancelled`) | transition destructive/irreversible | **modal + scrim**, `tone="destructive"` | "Reject this request" / "Reject"; "Cancel this request" / "Cancel request" | `button-destructive` |
| P3 | GR form submit `mutations.createReceipt.mutateAsync` (lines 392-395) | create receipt (DB insert) | lightweight popover on the "Save GR" submit | "Record this goods receipt?" / "Save GR" | `button-primary` (form already collects status+date; confirm is the commit gate) |
| P4 | VI form submit `mutations.createInvoice.mutateAsync` (lines 454-457) | create invoice (DB insert) | lightweight popover on "Save VI" | "Record this vendor invoice?" / "Save VI" | `button-primary` |
| P5 | `createQuotation` (exists in `useProcurementDetail` hook, **not yet wired to UI** -- only in test) | create quotation | lightweight popover **when wired** | "Record this vendor quotation?" / "Save quote" | `button-primary` |

> **P5 note:** `createQuotation` has no UI button today (grep: only `ProcurementDetails.test.tsx` references it). Implementer: do NOT invent a quotation-create UI in this workstream. Add the confirm-wrapping helper so that IF/WHEN a quotation-create button is added it adopts the confirm by default. Flag to owner (Open Questions).

### 6.2 Project / Pipeline transitions

| # | File / line | Action | Severity / surface | Confirm copy | Token |
|---|---|---|---|---|---|
| PR1 | `pmo-portal/components/ProjectStatusControl.tsx` -- `mutation.mutate` for non-win targets (line 55, `handleTargetSelect`) | transition forward (e.g. KoM stages, internal) | lightweight popover anchored to the dropdown item | "Move project to {target}?" / "Move to {target}" | `button-primary` |
| PR2 | `ProjectStatusControl.tsx` -- win submit `handleWinSubmit` -> `mutation.mutate(... 'Won, Pending KoM')` (lines 59-69) | win (forward, with SoD capture) | **PRESERVE existing inline win form**; its "Confirm" button IS the confirm step (no extra dialog) | (unchanged: "Win -- enter contract details" / "Confirm") | `button-primary` (existing) |
| PR3 | `ProjectStatusControl.tsx` -- if a `Loss`/terminal target appears in `legalTargets`, selecting it via `handleTargetSelect` | loss/terminal (destructive) | **modal + scrim**, `tone="destructive"` | "Mark project as lost" / "Mark lost" | `button-destructive` |

> The Loss path on the projects list flows through `LEGAL_PROJECT_TRANSITIONS`; route any target that is a Loss/terminal status (group !== 'pipeline' and the label reads Loss/Cancel) to the destructive modal. Forward stage moves use the popover.

### 6.3 OpportunityDetail -- `pmo-portal/pages/OpportunityDetail.tsx` (also owns I4)

Mutations via `runTransition()` (calls `transitionProject` directly, lines 128-152).

| # | Call-site (line) | Action | Severity / surface | Confirm copy | Token |
|---|---|---|---|---|---|
| O1 | "Advance" button `runTransition(nextStage)` (lines 225-228) | transition forward | lightweight popover | "Advance to {next}?" / "Advance to {next}" | `button-primary` |
| O2 | "Mark won" -> opens the existing "Record the won deal" SoD panel (lines 229-233, 247-318) | win (forward, SoD capture) | **PRESERVE inline panel**; the panel's "Confirm won" (line 303) IS the confirm step | (unchanged) | `button-primary` (existing) |
| O3 | "Mark lost" button `runTransition('Loss Tender')` (lines 234-242) | loss (destructive/irreversible) | **modal + scrim**, `tone="destructive"` | "Mark deal as lost" / "Mark lost" | `button-destructive` |

### 6.4 I4 -- OpportunityDetail "Next actions" action hierarchy (audit line 18)

Current (WRONG): Advance = `variant="outline"` (weak ghost-ish), Mark won = `variant="primary"` (solid blue), Mark lost = `variant="destructive"` (solid red) -> two solid fills compete and the PRIMARY path is weakest.

Target hierarchy (DESIGN.md One-Blue + Tinted-Status):

| Button | Before | After | Token / treatment |
|---|---|---|---|
| **Advance to {next}** | `outline` | **`primary`** (the one blue, primary path) | `button-primary` |
| **Mark won** | `primary` (solid blue) | **`outline` + leading `success` status-dot** | `button-outline`; 6px dot `bg-success` (Tinted-Status dot, NOT a solid fill) |
| **Mark lost** | `destructive` (solid red, anchors the card) | **`outline` + leading `destructive` status-dot** | `button-outline`; 6px dot `bg-destructive`; the destructive SOLID appears only inside the O3 confirm |

Result: exactly ONE solid blue (Advance), the two terminal actions are quiet outlines distinguished by their status-dot color, and the only solid `destructive` fill in the whole flow is the confirm button inside the Mark-lost modal. This satisfies One-Blue, the Tinted-Status Rule, and `primary-action` (one primary CTA). Apply the same dot+outline treatment to `ProjectStatusControl` win/loss affordances if/when they render as direct buttons (they currently render as dropdown items, which stay neutral text rows -- no change needed there).

### 6.5 Budget -- `pmo-portal/pages/ProjectBudget.tsx`

Mutations via `useBudgetMutations(projectId)`, wired through `VersionCard` callbacks (lines 445-452) and `NewVersionForm` (lines 399-407 / 428-436).

| # | Call-site (line) | Action | Severity / surface | Confirm copy | Token |
|---|---|---|---|---|---|
| B1 | `NewVersionForm onSubmit` -> `createVersion.mutateAsync` (lines 400, 429) | create version (insert) | lightweight popover on the form's submit (the name-entry form is the input; confirm is the commit) | "Create budget version {name}?" / "Create version" | `button-primary` |
| B2 | `VersionCard onActivate` -> `activate.mutateAsync` (line 445; button line 215) | activate version (swaps the live budget -- material) | lightweight popover (forward but consequential) | "Make {version} the active budget?" / "Activate version" | `button-primary` |
| B3 | `VersionCard onClone` -> `cloneVersion.mutateAsync` (lines 447, 263/274) | clone version (insert) | lightweight popover | "Clone {version} to a new draft?" / "Clone version" | `button-primary` |
| B4 | `VersionCard onArchive` -> `archive.mutateAsync` (lines 446, ~248) | archive version (state change, recoverable-ish) | **modal + scrim**, `tone="destructive"` | "Archive {version}?" / "Archive version" | `button-destructive` |
| B5 | `VersionCard onDeleteDraft` -> `deleteDraft.mutateAsync` (lines 448, ~221) | delete draft (hard delete) | **modal + scrim**, `tone="destructive"` | "Delete draft {version}? This cannot be undone." / "Delete draft" | `button-destructive` |

> **Line-item mutations** (`createLineItem`, `updateLineItem`, `deleteLineItem`, lines 449-452) ARE DB writes. `createLineItem`/`updateLineItem` are low-risk inline-edit forms -> lightweight popover on save IS overkill for inline edits; per the owner rule they still must not single-click-write, so wire a lightweight popover on **delete-line-item** (destructive) and keep create/update as form-submit (the submit IS a deliberate two-step: type then submit). **Delete line item => modal `tone="destructive"`** "Delete line item?" / "Delete". Confirm with owner whether create/update line-item submits count as already-deliberate (recommended: yes -- a form submit is not a single click).

### 6.6 Timesheets

| # | File / line | Action | Severity / surface | Confirm copy | Token |
|---|---|---|---|---|---|
| T1 | `pmo-portal/pages/Timesheets.tsx` -- "Submit timesheet" `submit.mutate` (line 162) | submit week (state change) | lightweight popover | "Submit this week for approval?" / "Submit timesheet" | `button-primary` |
| T2 | `pmo-portal/pages/timesheets/ApprovalsQueue.tsx` -- "Approve" `approve.mutate` (line 114) | approve (SoD-gated forward) | lightweight popover | "Approve {name}'s week?" / "Approve" | `button-primary` |
| T3 | `ApprovalsQueue.tsx` -- "Return" `reject.mutate` (line 125) | return/reject (sends back -- destructive to the submitter's state) | **modal + scrim**, `tone="destructive"` | "Return {name}'s timesheet?" / "Return timesheet" | `button-destructive` |

### 6.7 Feedback (toast) wiring per call-site

Every confirmed mutation MUST toast on resolve. Pattern (already used in OpportunityDetail line 145 + ProcurementDetails line 236):

- Success: `toast('<Thing> updated', '<what changed>', 'success')`.
- Error: `toast('<Thing> failed', err.message, 'warning')` AND keep the existing inline `role="alert"`/`mutation.isError` surface (don't remove inline errors -- redundancy is correct for forms). The RPC P0001 SoD message must pass through verbatim.

Call-sites currently MISSING a toast that must add one on this pass: `ProjectStatusControl` (PR1-PR3 -- only inline error today), `ProjectBudget` (B1-B5 -- no toast today), `Timesheets` submit (T1), `ApprovalsQueue` (T2-T3). OpportunityDetail (O1-O3) and ProcurementDetails (P1-P4) already toast -- keep.

---

## 7. Responsive breakpoints

DESIGN.md breakpoint is 920px (rail collapse). For this primitive:

- **>= 920px (desktop):** popover anchors to its trigger (right-aligned, like `#rowmenu`); modal is centered, `max-w-[420px]`.
- **375-919px (mobile/tablet):** modal goes full-width minus `spacing.4` gutters, bottom-anchored sheet style is NOT required (keep centered for simplicity; the existing app has no sheet pattern -- don't invent one, `product-ban-reinvented-affordances`). Popover becomes a centered modal-lite on coarse-pointer so it isn't clipped (`skill-interaction-dropdown-clipping`: render via `position: fixed`/portal, never `absolute` inside an `overflow` container).
- **Touch targets:** action-row buttons reach >=44px hit area at `pointer:coarse` (I5).
- **No horizontal scroll**, `min-h-[100dvh]` not used (dialog is not full-height); scrim uses `fixed inset-0`.

---

## 8. TDD task list (2-5 min each, red-green-refactor; conflict-safe order)

> Tests live beside source. Run from `pmo-portal/`: `npm test -- <path>`, `npm run typecheck`, `npm run lint`. Each task: write failing test first, then minimal impl. AC tags use the next free range; record in the plan's traceability when the spec is cut. Suggested ids `AC-CONFIRM-001..` (confirm with spec-miner/feature-forge at spec time).

**Phase A -- the primitive (no cross-file overlap; build first)**

1. `ConfirmDialog.test.tsx`: renders `title`, `description`, `confirmLabel`, default `cancelLabel="Cancel"` when `open`; renders nothing when `!open`. (red -> green)
2. Test: `onConfirm` fires on confirm-button click; `onCancel` fires on cancel-button click.
3. Test: `tone="destructive"` => confirm button has `bg-destructive` class + `role="alertdialog"` + leading `alert` icon; `tone="default"` => `bg-primary` + `role="dialog"`.
4. Test: `Escape` key calls `onCancel`; scrim click (modal) calls `onCancel`; while `loading`, Esc/scrim do NOT close.
5. Test (a11y): on open, focus lands on Cancel; `aria-modal`, `aria-labelledby`, `aria-describedby` wired to title/description ids; focus restored to trigger on close.
6. Test: `loading` => confirm shows `button-spinner`, both buttons `disabled`, `aria-busy` on confirm.
7. Implement `ConfirmDialog.tsx` to pass 1-6 (reuse `Button`, `Icon`, copy the Overlay shadow class verbatim; portal via `createPortal`; semantic z from §5.5).
8. Add `ConfirmDialog` + types to `src/components/ui/index.ts`; typecheck green.
9. Reduced-motion: add scale+fade with a `motion-reduce:` crossfade variant; test asserts the `motion-reduce:` class present (or no-scale under reduced-motion query).

**Phase B -- OpportunityDetail (I4 + O1-O3); self-contained file**

10. `OpportunityDetail.test.tsx`: Advance renders `variant="primary"`; Mark won renders `variant="outline"` + a `success` dot; Mark lost renders `variant="outline"` + a `destructive` dot (I4). (red -> green)
11. Test: clicking "Advance" opens a ConfirmDialog (popover, default tone) and does NOT call `transitionProject` until Confirm; Confirm calls `runTransition(nextStage)` then toasts success. Assert `transitionProject` NOT called on first click.
12. Test: clicking "Mark lost" opens a destructive ConfirmDialog; only its Confirm calls `runTransition('Loss Tender')`.
13. Test: "Mark won" still opens the existing inline SoD panel (unchanged); no double-confirm.
14. Wire O1-O3 + I4 in `OpportunityDetail.tsx`.

**Phase C -- ProcurementDetails (P1-P4)**

15. `ProcurementDetails.test.tsx`: a forward action (e.g. "Mark as Paid") opens a default popover confirm; `transition.mutateAsync` NOT called until Confirm. (red -> green)
16. Test: a destructive action (Reject / Cancel) opens a `tone="destructive"` modal; only Confirm fires the transition.
17. Test: "Save GR" / "Save VI" submit opens a confirm before `createReceipt`/`createInvoice` fires.
18. Wire P1-P4 in `ProcurementDetails.tsx` (P5 helper only, no UI).

**Phase D -- ProjectStatusControl (PR1-PR3)**

19. `ProjectStatusControl.test.tsx`: selecting a forward target opens a confirm; `mutation.mutate` NOT called until Confirm. Win path unchanged (PR2). Loss/terminal target opens destructive modal (PR3). Add toast on resolve. (red -> green -> wire)

**Phase E -- ProjectBudget (B1-B5 + line-item delete)**

20. `ProjectBudget.test.tsx`: create-version submit opens confirm (B1); activate opens confirm (B2); clone opens confirm (B3). (red -> green)
21. Test: archive (B4) + delete-draft (B5) + delete-line-item open `tone="destructive"` modals; mutateAsync NOT called until Confirm; add success/error toast.
22. Wire B1-B5 + delete-line-item in `ProjectBudget.tsx` (and `VersionCard`).

**Phase F -- Timesheets (T1-T3)**

23. `Timesheets.test.tsx`: "Submit timesheet" opens confirm; `submit.mutate` NOT called until Confirm; toast on resolve (T1). (red -> green -> wire)
24. `Approvals.test.tsx` / `ApprovalsQueue`: "Approve" opens default confirm (T2); "Return" opens destructive modal (T3); mutate NOT called until Confirm; toast on resolve. Wire.

**Phase G -- verification**

25. Full `npm test`, `npm run typecheck`, `npm run lint --max-warnings=0` green; coverage >=80% on changed files.
26. `/design-review` (design-reviewer) renders each surface + screenshots the confirm in default + destructive + loading + mobile (375px) states; verify against this plan's token table and a11y contract before merge.

---

## 9. Cross-workstream dependencies (build sequencing)

This workstream **must build LAST among code-changers** because it edits the same files other audit workstreams touch. Flagged overlaps:

- `pmo-portal/pages/OpportunityDetail.tsx` -- shared with the **I3 em-dash placeholder** workstream (the `Decision —` stat, line 181) and the **C2 funnel-color** workstream (`stageDot`/`SALES_COLUMNS`, lines 44-46). Sequence after those land.
- `pmo-portal/pages/ProcurementDetails.tsx` -- shared with **I1 status-pill** (`pillVariantForStatus`/`StatusPill`) and **I3** (`Goods received —`). Sequence after.
- `pmo-portal/pages/ProjectBudget.tsx` -- shared with the **owner "budget-version dropdown"** restore workstream (line 42 of the audit) which restructures `VersionCard`/version list. **Hard dependency:** the version-dropdown rebuild changes the same `VersionCard` callbacks (B2-B5); land the dropdown restore FIRST, then wire confirms onto the final control set.
- `pmo-portal/pages/Timesheets.tsx` + `pages/timesheets/ApprovalsQueue.tsx` -- shared with **C4 thin-pages** (populated timesheet grid) workstream. Sequence after C4.
- `pmo-portal/components/ProjectStatusControl.tsx` -- shared with the **Projects list C3 disabled-CTA removal** + **M5 status-pill left-align** workstreams. Sequence after.
- `pmo-portal/src/components/ui/index.ts` -- the barrel is touched by nearly every other UI workstream (adds/edits exports). Low-conflict (append-only) but rebase carefully; add the `ConfirmDialog` export last.
- **No overlap (safe to build anytime in Phase A):** the new `ConfirmDialog.tsx` + its test are net-new files -- zero conflict. The primitive can land independently even before the call-site wiring is sequenced.

---

## 10. Open questions / proposed DESIGN.md additions (owner sign-off)

1. **z-index scale (gap).** DESIGN.md has no semantic z-scale; code uses ad-hoc values (`z-20`, `z-[900]`, `z-[1000]`). Propose adding a documented scale to DESIGN.md (dropdown 700 / sticky 750 / modal-scrim 800 / modal 810 / popover 820 / toast 1000 / tooltip 900). Owner sign-off to codify.
2. **Disabled/loading button state (gap, already flagged in DESIGN.md Open Questions line 260).** The confirm primitive relies on the proposed disabled state (`opacity .5; not-allowed; pointer-events:none`). `Button` already implements `disabled:opacity-45`. Confirm this is the canonical disabled token (45% vs the 50% the DESIGN.md gap proposes) -- recommend standardizing on the existing 45%.
3. **Line-item create/update confirms.** Recommend: a form submit (type-then-submit) already satisfies "no single-click write," so create/update line-item do NOT get an extra confirm; only DELETE line-item does. Confirm owner agrees.
4. **`createQuotation` (P5).** No UI today. Recommend: ship the confirm-wrapping helper now, do not build a quotation-create UI in this workstream. Confirm scope.
5. **Reported "procurement state change clicked but status doesn't change"** (audit line 41). This is a possible silent no-op / illegal-transition-without-feedback. The toast-on-resolve wiring (§6.7) will surface the RPC error if one is thrown; if the RPC silently succeeds with no state change, that is a backend/transition-map bug OUT OF SCOPE for this design-plan -- flag to the Director to route to spec-miner/implementer as a separate investigation issue.
6. **Confirm "don't ask again" affordance?** Not in this pass. The owner rule is "every mutation confirms"; a remember-my-choice toggle would violate it. Recommend: no suppression. Confirm.
