# Design-plan — Wave 5, Cluster 6: Detail drawers + dead-affordance cleanup

**Date:** 2026-06-10
**Author:** design-architect (impeccable `shape` + ui-ux-pro-max quick-view drawer / progressive-disclosure / honest-affordance)
**Items:** D11 (company detail drawer + inline status) · D12 (document detail drawer + inline status) · D13 (remove dead "Attach file (coming soon)")
**Lens:** IxD / naturalness. **Desktop-first** (mobile = Wave 4, next). **READ-ONLY analysis of app code; no source edited.**
**Identity:** preserve `DESIGN.md` wholesale — no new brand/palette/font. One genuinely-new primitive is proposed (a `Drawer` shell) built entirely from existing tokens + the existing portal/scrim/focus-trap machinery; flagged in §1.

---

## 0. Problem & shape

Two list surfaces (Companies directory, the per-project Document register) today expose a record only two ways: a row `⋯` menu (Edit / Archive / status-workflow / Delete), and — for editing — a full `EntityFormModal`. There is **no read-first "look at this record" surface**. To see a company's details you must open the *edit* modal (a write affordance used as a viewer — wrong mental model); to move a document's status you must hunt the `⋯` menu, which buries the single most common action behind a generic overflow trigger.

**Naturalness gap (the IxD finding):** the conventional pattern for a dense list where you frequently *inspect-then-act* on one row is a **right-side quick-view drawer** — click the row, a panel slides in over a scrim showing the record read-first, with the primary verb (here: change status) promoted to a visible control inside the panel, and Edit/Archive/Delete as secondary entry points. The list stays in place behind the scrim, so you can close and move to the next row without losing your scroll position. This is progressive disclosure: the table row stays minimal; depth lives in the drawer.

**Anti-goal:** this is NOT a new full-page route, NOT a second source of truth, and NOT a re-skin. The drawer reuses the existing list data (the row object already in hand — no extra fetch in the common case), the existing `can()`/SoD gating, the existing transition/mutation hooks, and the existing `ConfirmDialog` for consequential moves. It is a *presentation* layer over machinery that already ships.

---

## 1. The drawer pattern — primitive decision

**Decision: build ONE new shared primitive, `Drawer` (a right-side sheet).** No Drawer/SidePanel/Sheet exists today (confirmed: `pmo-portal/src/components/ui/` has only `EntityFormModal` and `ConfirmDialog` carrying portal + scrim + focus-trap). `EntityFormModal` is centered-modal-shaped and form-shaped (sticky FormActions footer, dirty-discard confirm, error-summary-to-first-field); bending it into a right-side read-first viewer would overload it. The clean move is a sibling primitive that **reuses EntityFormModal's exact overlay machinery** (it is the proven, a11y-correct reference), re-housed as an edge-anchored panel.

> **⚑ NEW-PRIMITIVE FLAG (for owner/Director sign-off).** `Drawer` is a net-new shared component. It introduces **no new token** — every value below resolves to an existing `DESIGN.md` token. It does need **one new z-index step name** in the existing overlay band (drawer sits at the same tier as the modal, `z-[800]`/`z-[810]`); this is a naming addition in code, not a visual/token change. **No `DESIGN.md` frontmatter edit is required.** (If the Director prefers the design system to *document* the drawer as a named overlay, add a short "Drawer" entry under §5 Components → Overlays — copy-only, no token. Recommended but not blocking.)

### 1.1 `Drawer` spec (minimal, token-pure)

Reuses verbatim from `EntityFormModal`: `createPortal(…, document.body)`, the scrim, Esc-to-close, scrim-click-close, focus-capture-on-open / restore-to-trigger-on-close, the Tab focus-trap, `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`.

| Aspect | Spec | DESIGN.md token |
|---|---|---|
| Anchor | Fixed right edge, full viewport height | overlay band `z-[800]` scrim / `z-[810]` panel (same tier as EntityFormModal) |
| Panel width | `420px` desktop (`sm`), `min(560px, 92vw)` for a denser variant (`lg`) | width is layout, not a token; mirrors EntityFormModal's `sm`/`lg` width presets |
| Surface | `bg-popover` (white), left `border` hairline (the only depth cue on the seam) | `colors.popover`, `colors.border` (Single-Border Rule) |
| Radius | Square against the viewport edge; inner cards/controls keep their own radius | n/a (edge-anchored = no outer radius) |
| Scrim | `bg-foreground/40`, desaturated near-black, `confirm-scrim-anim` | `colors.foreground` @ 40% (No-Pure-Black-Shadow) |
| Shadow | The verbatim **Overlay** shadow on the panel's left edge (it genuinely floats) | DESIGN.md §4 Overlay: `0 10px 30px hsl(240 10% 8% / 0.16), 0 2px 6px …/0.08` |
| Header | 56px-ish, title (`heading`/`subheading` scale) + subtitle (`muted-foreground`) + ghost close icon-button (`Icon name="x"`, `aria-label="Close"`) | `typography.subheading`, `colors.muted-foreground`, `button-ghost` |
| Body | Scrollable (`overflow-y-auto`), `18px` padding (matches EntityFormModal `px-[18px] py-4`) | `spacing` (16–20 band) |
| Footer (optional) | Border-top action row for secondary entry points (Edit / Archive / Delete) | `colors.border`, `button-outline` / `button-ghost` / `button-destructive` |
| Motion | Slide-in from right (`translateX`), ease-out (exp), `motion-reduce:` → crossfade/instant | mirror EntityFormModal's `confirm-anim` discipline + reduced-motion |
| Responsive | `≥ sm`: right panel at fixed width. `< sm` (mobile, **Wave 4**): becomes a near-full-width sheet (`w-[92vw]` already covers it; full bottom-sheet treatment deferred to Wave 4). | breakpoint note only — do NOT optimize 375px here |

**a11y (WCAG-AA), inherited + required:**
- `role="dialog" aria-modal="true"`, labelled by the record name (`aria-labelledby` → the drawer h2), described by the subtitle when present.
- Focus moves into the drawer on open (first focusable, else the panel); restores to the triggering row-button on close.
- Esc closes; scrim-click closes; both blocked while a mutation is in flight (reuse EntityFormModal's `loading` gate).
- Tab focus-trap cycles within the panel; suspended while a nested `ConfirmDialog` owns focus (the exact pattern EntityFormModal already uses for its discard dialog — `inert`/`aria-hidden` the panel while the confirm is up).
- The drawer's open trigger is the row's existing first-cell `<button>` (`DataTable` already renders a focusable, `aria-label`-carrying activation button when `onActivate` + `rowLabel` are supplied — wire `onActivate` to open the drawer; the row keeps its implicit `role="row"`).

### 1.2 Read-first, not edit-first

The drawer body is **read-mode by default** (definition-list of fields, no inputs). The only *inline-editable* control is the status/type control (§2). Full edit stays in `EntityFormModal`, launched from the drawer footer "Edit" button — i.e. the drawer never duplicates the form. This keeps one canonical write surface and avoids a half-form in the drawer.

---

## 2. Per-surface design

### 2.1 D11 — Company detail drawer + inline type control (`pages/Companies.tsx`)

**Trigger:** row click / first-cell activation opens the drawer for that `CompanyRow` (data already in `data` — **no extra fetch**). The `⋯` menu stays for power users (Edit / Archive / Delete remain reachable both there and in the drawer footer).

**Drawer body (read-first):**
- **Header:** company name (`heading`), subtitle = its current type pill inline (`StatusPill variant={TYPE_PILL[type]}`).
- **Identity block (definition list):** Name; Type (see inline control below); created/updated if cheaply on the row.
- **Referenced-by (only if cheap):** counts of projects / procurements that reference this company. **Recommend: render this ONLY if the row already carries the counts or the list query already has them.** If it needs a new join/query, **defer it** (label the block "Usage — coming with the directory rollup" is NOT acceptable per honest-affordance; instead simply omit the block). The in-use signal already surfaces honestly at delete-time via the existing 23503 `GateNotice`, so the drawer doesn't have to pre-empt it. → **OWNER-DECISION flag #3.**

**Inline type control:** an inline `SelectField` (or a small segmented control) bound to `company.type` (Client / Vendor / Internal), gated by `canEdit = may('edit','company')`. Company `type` is master-data classification, not a workflow with SoD — changing it is a **routine reversible write**, so per **OD-UX-1** it is **single-click (on select) + a success toast, no ConfirmDialog**. On change → `update.mutateAsync({ id, input:{ name, type } })` (the existing mutation), optimistic pill update, toast "Company updated". On error → `classifyMutationError` toast (reuse the page's existing handler). When `!canEdit`, the control renders as the read-only pill (no select), so a denied viewer sees the value but no affordance.

**Footer entry points (gated, reuse existing state setters):** `Edit` → `setFormTarget({company})`; `Archive` → `setArchiveTarget(company)`; `Delete` (danger) → `setDeleteTarget(company)`. These already drive the existing `EntityFormModal` + `ConfirmDialog`s; the drawer just adds a second launch point. (Opening Edit from the drawer: close the drawer first, or stack — **recommend close-drawer-then-open-modal** to avoid two dialogs fighting the focus-trap.)

### 2.2 D12 — Document detail drawer + inline status workflow (`pages/project-detail/tabs/DocumentsTab.tsx`)

**Trigger:** row click opens the drawer for that `ProjectDocumentRow` (data in hand — no fetch).

**Drawer body (read-first):** Title (`heading`) + `Rev {revision}`; Code (mono); Category; Document date; Author (if resolvable from the row — else omit, do not invent); current status pill (`StatusPill variant={STATUS_PILL[status]}`).

**Inline status control = the workflow, promoted out of the `⋯` menu.** This is the headline of D12: replace "hunt the overflow menu" with a clear status section in the drawer. It must **reuse the EXACT gating already in `statusActions(d)`** — do not re-derive the rules:
- The available transitions are computed by the existing `statusActions` logic (Draft→Issued; Issued→Approved/Rejected; Approved→Closed; Rejected→Reopen/Close), already role- and SoD-gated.
- Render them as **primary/secondary buttons in a "Status" section** (not a dropdown): e.g. on an Issued doc the reviewer sees `Approve` (primary) + `Reject` (destructive); a Draft shows `Issue` (primary).
- **SoD preserved:** `Issued` + `isOwnDocument(d)` → no Approve/Reject buttons; instead the existing **"Why is review unavailable?"** explanation renders inline in the drawer (reuse the `sodBlocked` `GateNotice` copy — author can't approve own doc). This is honest-disabled done right: the reason is shown, not a dead button.
- **Consequential moves keep their `ConfirmDialog`** (OD-UX-1): every document status transition in the current code already routes through `setPending(...)` → the `ConfirmDialog` (Approve/Reject/Issue/Close/Reopen all confirm, with Reject in destructive tone). The drawer buttons call the SAME `setPending` setters, so the confirm + SoD-recording copy is unchanged. **No transition becomes single-click here** — document status is a controlled lifecycle, unlike company type. (Contrast with D11's type change, which is routine.)
- When the confirm dialog opens from a drawer button, it stacks above the drawer (same `inert`-the-panel pattern as EntityFormModal's discard dialog).

**Footer entry points (gated):** `Edit` → `setFormTarget({doc})` (author-scoped via `canEditDoc(d)`, Draft/Issued/Rejected only — reuse the existing predicate); `Delete` (danger, Admin) → `setDeleteTarget(d)`.

### 2.3 D13 — Remove the dead "Attach file (coming soon)" placeholder

**Current:** `DocumentsTab.tsx` renders a `Tooltip`-wrapped **disabled** `Button` "Attach file" (`aria-label="Attach file (coming soon)"`) next to "Add document", because Storage is off.

**Recommendation: REMOVE the disabled button entirely.** Rationale (honest-affordance rule, OD-W2-5 / OD-UX-3 precedent): a *peer* disabled control sitting beside a live primary is clutter — it implies a near-term capability the page can't deliver and competes with the real "Add document" CTA. The honest-signpost pattern (OD-UX-3's "coming soon", OD-W2-5's `/reports` stub) is reserved for **destinations a user might navigate to and find empty** (a Reports route, a Board-pack export). "Attach file" is not a destination; it's an inline action with no behavior, so the honest move is **absence**, not a disabled peer.

The **honest signposting already exists in copy** and should stay: the register's intro ("Metadata is tracked here; file attachments arrive with Storage") and the create-modal subtitle ("File upload arrives with Storage"). That sentence carries the "Storage is coming" message without a dead button. So D13 = delete the `Tooltip`+disabled-`Button` block; keep the explanatory copy. → confirm in **OWNER-DECISION flag #2**.

---

## 3. All states + a11y matrix

### Drawer-level states
| State | Behavior |
|---|---|
| **Open / default** | Read-first body, status/type control live (if permitted), footer entry points. |
| **Loading (data)** | In the common case data is the in-hand row → **no loading state needed**. If a "referenced-by" block is added with its own query (flag #3), that block shows a `ListState`-style inline skeleton; the rest of the drawer renders immediately. |
| **Mutation in flight** | The acted control shows a spinner/disabled (reuse `transition.isPending` / `update.isPending`); Esc + scrim-close locked (EntityFormModal `loading` gate). |
| **Error (mutation)** | Toast via `classifyMutationError` (existing); the drawer stays open so the user can retry. Document SoD/illegal-stage (P0001/42501) classified by the existing handler. |
| **Empty / N/A** | A field with no value renders an em-dash `—` (matches the table's existing `—` convention), never a blank gap. |
| **Permission-denied control** | Inline status/type control renders as the **read-only pill** (value visible, no affordance). SoD-blocked document → inline reason `GateNotice` (not a dead button). |
| **Close** | Esc / scrim-click / close-button / after a footer action that opens a modal. Focus restores to the row trigger. |

### WCAG-AA
- **Focus order:** row trigger → drawer open → focus into drawer → trap cycles → close → focus returns to row. Nested ConfirmDialog/EntityFormModal own focus while up (panel `inert`).
- **Keyboard:** drawer fully operable by keyboard — open via the row's first-cell `<button>` (Enter/Space), Tab through fields/controls, status buttons are real `<button>`s, Esc closes. No mouse-only path.
- **Announcement:** `role="dialog"` labelled by the record name; status change → the toast is the existing `role`-correct `Toast` (announced). The status pill update is a visible state change; pair the inline control with an `aria-live="polite"` region or rely on the toast (recommend: toast carries the announcement, consistent with the rest of the app).
- **Contrast:** all text uses existing AA-cleared tokens (`foreground`, `muted-foreground` @ 40% L, the darkened pill text variants). No new color.
- **Targets:** controls stay 32px (`DESIGN.md` control height); coarse-pointer ≥44px via the existing `.touch-target` utility on icon buttons.

---

## 4. Exact `DESIGN.md` tokens per piece

| Piece | Tokens (named, no literals) |
|---|---|
| Drawer panel | `colors.popover` (surface), `colors.border` (left seam, Single-Border Rule), §4 **Overlay** shadow, overlay z-band `z-[800]/[810]` |
| Scrim | `colors.foreground` @ 40% (No-Pure-Black-Shadow), `confirm-scrim-anim` |
| Header title / subtitle | `typography.heading` / `typography.subheading`; subtitle `colors.muted-foreground` |
| Close button | `button-ghost` + `button-ghost-hover` (`colors.accent` wash), `Icon name="x"` |
| Body padding / rhythm | `spacing.4`/`spacing.5` (16/20px), body text `typography.body` |
| Field labels (definition list) | `typography.label` (12/600) `colors.muted-foreground`; values `typography.body` `colors.foreground`; codes `typography.mono` |
| Company type pill / Doc status pill | `StatusPill` variants — company: `open`/`violet`/`won` (`TYPE_PILL`); document: `draft`/`open`/`won`/`lost`/`neutral` (`STATUS_PILL`). Tinted-Status Rule. |
| Inline type/status control | `input` (SelectField, 32px, `rounded.md`, `colors.input` border) OR status buttons: `button-primary` (Approve/Issue), `button-destructive` (Reject/Delete), `button-outline` (secondary) |
| SoD / usage notice | `GateNotice variant="blocked"` (existing) |
| Footer | border-top `colors.border`; `button-outline` (Edit), `button-ghost`/`button-outline` (Archive), `button-destructive` (Delete) |
| Focus ring | global `:focus-visible` `2px colors.ring` @ 2px offset (inherited) |
| Toast feedback | existing `Toast` (`colors.border` + accent stripe `colors.primary`/`success`) |

**New tokens required: NONE.** New code-level name: one z-index step alias for the drawer (sits in the existing modal overlay band — no new visual tier). **No `DESIGN.md` frontmatter change.**

---

## 5. PR breakdown

**Recommend: ONE PR** — `feat(ui): record detail drawers (company + document) + drop dead attach-file affordance`.

Internal order (TDD, implementer):
1. **`Drawer` primitive** (`src/components/ui/Drawer.tsx`) extracted from EntityFormModal's overlay machinery; exported from the `ui` barrel. Unit tests: open/close, Esc, scrim-click, focus-trap, focus-restore, `role`/`aria` (the AC-owning layer = Vitest/RTL render).
2. **D13** (smallest, lowest-risk): remove the disabled "Attach file" block from `DocumentsTab.tsx`; keep the explanatory copy. (Unit: assert the dead button is gone, the copy remains.)
3. **D11** company drawer + inline type control wired to `useCompanies`/`useCompanyMutations` + `can('edit','company')` + OD-UX-1 single-click toast.
4. **D12** document drawer + inline status section reusing `statusActions` gating + `setPending`→`ConfirmDialog` + SoD `GateNotice`.

One PR is right: the three items share the new primitive, and splitting would ship the `Drawer` with no consumer. Coverage ≥80% on changed code; AC tags owned at the lowest sufficient layer (drawer behavior + inline-control gating = Vitest/RTL; the SoD rule is already pgTAP-owned at the RLS/RPC layer — the drawer test asserts FE *visibility*, not the server rule). `/design-review` (rendered 3-lens battery) before merge — the drawer is a net-new visual pattern.

---

## 6. Owner-decision flags (Director must take these to the owner / decide)

1. **▶ DO WE WANT QUICK-VIEW DRAWERS AT ALL? (the load-bearing one.)** Three options:
   - **(A) Right-side quick-view drawer** — *recommended.* Click row → panel slides in, read-first + inline status, list stays behind a scrim. Best for inspect-then-act on consecutive rows; matches the convention for dense operator tables; lowest navigation cost.
   - **(B) Row-click → existing full-detail route.** Companies/Documents have no dedicated detail *page* today; this would mean building one (heavier, and a document has no standalone route — it lives under a project). Over-scoped for a "list-page enhancement" cluster.
   - **(C) Expand-in-place (accordion row).** Cheap, but fights the dense-table density (`DESIGN.md`: 54px rows, scannable), and an expanded row with action buttons inside a `<td>` is awkward for SoD buttons + focus. Not recommended.
   **Recommendation: (A).** It is the smallest net-new surface that delivers both the read-first viewer (D11/D12) and the promoted inline status (D12), without inventing routes. If the owner prefers (B/C), D11/D12 change shape materially — decide before build.

2. **D13: remove vs honest-disabled signpost.** **Recommend REMOVE** the disabled "Attach file" button (it's an inline action, not a navigable destination → absence is the honest move; the "file upload arrives with Storage" copy already signposts). The owner *could* prefer keeping a single honest-disabled control as a roadmap signal — but that conflicts with the OD-W2-5 "dead/no-op affordances = removed" precedent. Confirm remove.

3. **D11 "referenced-by" block scope.** Show project/procurement usage counts in the company drawer **only if the count is already cheaply available** on the row/query. **Recommend: omit unless free** (the 23503 delete-block `GateNotice` already surfaces "in use" honestly at the moment it matters; a new join for a nice-to-have is out of cluster scope). Owner: ship the drawer without usage counts now, or pull them in (adds a query)?

**Secondary (Director can decide, surfaced for visibility):**
- Drawer-open-then-Edit: close drawer before opening `EntityFormModal` (recommended) vs stack. → close-then-open.
- Document inline status = **buttons** (Approve/Reject/Issue visible) not a dropdown — keeps the SoD branches and confirm flow legible. (Recommended; no owner input needed.)
- Mockup: the drawer is a net-new visual pattern → **recommend a quick static mockup of one drawer (the document drawer, since it carries the richest state: SoD branch + status buttons + confirm) before the full build**, owner taste-gate it, then build both surfaces to it. Lower-risk than build-then-review for a brand-new pattern. (Alternatively, review-post-build via `/design-review` rendered if the owner wants to move fast — but recommend the pre-build mockup given §6.1 is itself unsettled.)

---

## 7. References used
- `DESIGN.md` (overlay/§4 elevation, StatusPill/Tinted-Status, control sizing, Single-Border, focus ring).
- `pmo-portal/src/components/ui/EntityFormModal.tsx` (the portal/scrim/focus-trap/inert reference the `Drawer` reuses).
- `pmo-portal/src/components/ui/DataTable.tsx` (`onActivate` + `rowLabel` = the keyboard/SR row trigger; `RowMenu`).
- `pmo-portal/src/components/ui/StatusPill.tsx` (variants), `GateNotice`, `ConfirmDialog`, `Tooltip`, `SelectField`.
- `pages/Companies.tsx` (D11 host: `TYPE_PILL`, `useCompanyMutations`, the archive/delete/edit state setters, the 23503 `GateNotice`).
- `pages/project-detail/tabs/DocumentsTab.tsx` (D12 host: `statusActions` gating, `isOwnDocument` SoD, `setPending`→`ConfirmDialog`, `canEditDoc`; D13: the disabled "Attach file" block).
- `docs/decisions.md` OD-UX-1 (write-confirm policy), OD-UX-3 / OD-W2-5 (honest-affordance precedent).
