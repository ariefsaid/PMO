# CRUD Component Architecture — PMO Portal

**Status:** Design-plan (Phase 0, step 1 of the CRUD+RBAC program). Drives `docs/design-mockups/crud-*.html`, the Phase-1 form primitives, and every per-entity build.
**Authority:** `DESIGN.md` is the identity authority — every visual decision below names a `DESIGN.md` token, never a literal. This doc adds CRUD *patterns* on top of the shipped IA-3 shell + primitive library; it does not introduce a new aesthetic, palette, or font.
**Plan:** `docs/plans/2026-06-07-crud-rbac-program.md` (RBAC matrix, owner/Director decisions, ADR-0016..0019).
**Companion:** `docs/design/rbac-visibility.md` (the role × affordance visibility map; the precise UI projection of the matrix).
**Skills applied:** `impeccable shape` (UX shaping, product register), `ui-ux-pro-max` (ERP/PM/CRM conventions + the 99-guideline checklist). Reference/gap-analysis only.

---

## 0. Principles (non-negotiable, from the existing system)

1. **Build on what exists.** The shipped library (`pmo-portal/src/components/ui/*`, `src/components/shell/*`) already supplies `DataTable`+`Toolbar`+`RowMenu`, `ConfirmDialog`, `Button` (all states + loading), `StatusPill`, `ListState` (loading/empty/error), `GateNotice`, `PageHeader`, `Tabs`, `Toast`/`useToast`, `LifecycleStepper`. CRUD reuses these. We add only the missing **form layer**.
2. **One blue.** `primary` drives the single per-screen CTA (ui-ux-pro-max `primary-action`; DESIGN.md *One Blue Rule*). Edit/Archive/Cancel are quieter (`outline`/`ghost`/row-menu). The only solid `destructive` fill is inside `ConfirmDialog` (DESIGN.md *Tinted-Status Rule*).
3. **Flat-by-default, borders not shadows** (DESIGN.md *Flat-By-Default Rule*). Forms live in white `card` on `secondary/35%`, framed by the single 1px `border`. No new border color, no decorative shadow.
4. **Nothing writes on a single click** (owner rule, already enforced in `ProcurementDetails`). Every DB mutation routes through `ConfirmDialog` (destructive → `alertdialog`+scrim; default → confirm) OR an explicit form Submit — never a bare row-click.
5. **Every interactive component ships all 7 states** (impeccable product register `product-components-all-states`): default, hover, focus, active, disabled, loading, error. Half-built controls are a defect.
6. **Affordance gating is a UI projection of policy, never the authority.** RLS/RPC is the enforcement authority (plan §Architecture). The FE hides/disables affordances for clarity; it *never* assumes the hide is the security boundary. Gating reads the **real JWT role**, not the impersonated `effectiveRole` (ADR-0016).

---

## 1. ui-ux-pro-max ERP / PM / CRM conventions adopted (cited)

The skill's data-dense admin/ERP product type and its 99-guideline corpus pin these conventions; each is mapped to a DESIGN.md token or an existing primitive so we adopt the *idiom* without importing a foreign look.

| ui-ux-pro-max convention (rule id) | How PMO Portal honors it |
|---|---|
| `primary-action` — one primary CTA per screen | Index header carries the single **New …** primary button; detail header carries at most one primary; everything else is `outline`/`ghost`/row-menu. |
| `input-labels` — visible label per field, never placeholder-only | `<FormField>` always renders a `<label htmlFor>` in `label` type (12px/600, `muted-foreground`). Placeholders are hints only. |
| `required-indicators` | Required fields show a `destructive` asterisk after the label text + `aria-required`. |
| `error-placement` / `aria-live-errors` / `inline-validation` (validate on blur) | `<FieldError>` renders directly below its field, `role="alert"`, `destructive` text; validation fires on blur + on submit, not per keystroke. |
| `error-summary` / `focus-management` | On submit-with-errors, an `ErrBanner` summary appears at the top of the form body and focus moves to the first invalid field. |
| `field-grouping` | Related fields grouped via `<FormSection>` (fieldset/legend semantics) with `subheading`-type group titles. |
| `read-only-distinction` — visually + semantically distinct from disabled | Read-only fields render as static `body`-type value rows (not greyed inputs); disabled inputs use `disabled:opacity-45` (the Button/input convention). Two different treatments on purpose. |
| `disabled-states` — reduced opacity + cursor + semantic attr | Reuse the existing `disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none` from `Button`. |
| `confirmation-dialogs` / `destructive-emphasis` / `destructive-nav-separation` | `ConfirmDialog`; destructive confirm is the only solid red; Delete/Archive live in the row-menu's `danger` slot, spatially separated from primary. |
| `progressive-disclosure` — don't overwhelm upfront | New-deal and New-PR forms show core fields first; advanced/optional fields behind a "More details" disclosure. |
| `sheet-dismiss-confirm` / `form-autosave` (adapted) | `EntityFormModal` confirms before discarding a dirty form (a small nested confirm); no autosave server-side (single-tenant MVP) but dirty state is preserved across accidental scrim-click. |
| `sortable-table` (`aria-sort`) / `empty-states` / `loading-chart`→skeleton | Already shipped in `DataTable`+`ListState`; CRUD indexes reuse verbatim. |
| `number-tabular` | All money/qty/count fields use the `tabular` utility (DESIGN.md *Tabular-Numbers Rule*). |
| `toast-accessibility` (`aria-live="polite"`, no focus steal) / `success-feedback` / `error-recovery` | `useToast` on every mutation result; success = brief confirm toast, error = classified headline + recovery detail (the `classifyMutationError` pattern, promoted to a shared lib per ADR-0017). |
| `breadcrumb-web` / `back-behavior` / `deep-linking` | Existing top-bar breadcrumb + index→detail routing is the wayfinding spine; CRUD adds no new nav layer. |
| `modal-vs-navigation` / impeccable `product-ban-modal-first-thought` | Modals are reserved for **create** and **small focused edits**; full-record edit prefers **inline detail-header edit** over a giant modal (see §3). |

ui-ux-pro-max's mobile-only rules (safe-area, bottom-nav, haptics, Dynamic Type) are scoped out — this is a desktop-first data product (DESIGN.md responsive: rail collapses < 920px, no native shell).

---

## 2. The reusable primitives to build (Phase 1, ADR-0017 form layer)

All live in `pmo-portal/src/components/ui/` and are exported from the barrel `index.ts`. Strictly DESIGN.md-tokened. None re-implements anything the library already has.

### 2.1 Field primitives

| Primitive | Purpose | Token mapping |
|---|---|---|
| **`<FormField>`** | Label + control + helper/error wrapper. Wires `htmlFor`/`id`/`aria-describedby`/`aria-invalid`/`aria-required`. The single source of field a11y. | label = `typography.label`; helper = `body` 12.5px `muted-foreground`; gap `spacing.1`. |
| **`<TextField>`** | Single-line text, mirrors the shipped `input` shell. | `components.input` (bg `background`, 1px `input` border, `rounded.md`, h 32px, pad `0 10px`); focus = global `:focus-visible` ring (`ring`). |
| **`<NumberField>`** | Numeric (contract value, qty, amount). `inputMode="decimal"`, right-aligned, `tabular`. | same as `input` + `tabular` utility. |
| **`<TextArea>`** | Multi-line (notes, descriptions, justification). Already exists ad-hoc in ProcurementDetails — promote to a primitive. | `input` tokens, auto-min 2 rows. |
| **`<SelectField>`** | Native `<select>` for short, fixed enum lists (status, GR status, role). Keeps the native control (ui-ux-pro-max `system-controls`). | `components.input` shell; chevron in `muted-foreground`. |
| **`<DateField>`** | Native `<input type=date>` (receipt date, invoice date — already used inline). | `input` tokens. |
| **`<Combobox>`** | **FK picker** — searchable single-select for long reference lists (client company, vendor, PM, project, assignee). Type-ahead filter, keyboard nav (↑/↓/Enter/Esc), `role="combobox"`+`aria-expanded`+`aria-activedescendant`, portal-rendered popover to escape `overflow` clipping (DESIGN.md interaction rule; impeccable `skill-interaction-dropdown-clipping`). | popover = `popover` bg + 1px `border` + `rounded.md` + the *Overlay* shadow; selected row `primary/7%`; hover `accent`; empty-result row in `muted-foreground`. |
| **`<FieldError>`** | Inline below-field error, `role="alert"`. | `destructive` text 12.5px; leading `alert` icon. |
| **`<Checkbox>`** | Boolean (e.g. "block delete if referenced" confirmations, "active"). Reuse the documented 16px custom checkbox spec. | 1.5px `input` border, `rounded.xs`; checked = `primary` fill + white check. |

### 2.2 Composition primitives

| Primitive | Purpose | Token mapping |
|---|---|---|
| **`<FormRow>` / `<FormGrid>`** | Layout: single-column on mobile, 2-col grid ≥ `768px` for paired fields (ui-ux-pro-max `breakpoint-consistency`; impeccable `product-layout-responsive-structural`). | gaps on `spacing.4`/`spacing.3`; `repeat(auto-fit, minmax(240px,1fr))` for the responsive grid. |
| **`<FormSection>`** | `fieldset`+`legend` group with a `subheading` title (`field-grouping`). | title = `typography.subheading`; top `border` divider between sections. |
| **`<FormActions>`** | Footer button cluster: trailing-right, primary last (LTR convention), Cancel as `outline`. | `spacing.2` gap; primary = `button-primary`, cancel = `button-outline`. |
| **`<EntityFormModal>`** | The **create / focused-edit modal composite**. Portal + scrim (reuse ConfirmDialog's portal/scrim/focus-trap/Esc machinery), header (title + close `ghost` icon-button), scrollable body of FormSections, sticky `FormActions` footer. Confirms before discarding a dirty form. | white `popover` surface, 1px `border`, `rounded.lg`, *Overlay* shadow; max-w 520px (single-entity) / 640px (with line-items); body `max-h-[70dvh]` scroll. |
| **`<InlineEditField>`** | Detail-header / row inline edit: a value that becomes an editable control on Edit, with Save/Cancel. For single-field SoD edits (e.g. `contract_value` on a won project). | static = `body`; editing = `input` tokens; Save = `button-primary sm`, Cancel = `button-ghost sm`. |

### 2.3 Shared logic (not visual)

- **`useEntityForm`** — tiny controlled-form + per-field validation helper (values, errors, touched, isDirty, isSubmitting, validate-on-blur, submit). No new dep; ~80 lines. Returns the props `<FormField>` consumes.
- **`can(action, entity, ctx)`** + `usePermission()` + `<CanWrite>` (ADR-0016) — the policy gate every affordance below consults. Reads **real role**. `<CanWrite action entity fallback?>` renders children only when permitted; `fallback` optionally renders a read-only or GateNotice variant.
- **`classifyMutationError`** promoted to `src/lib/appError.ts` (ADR-0017) — maps `P0001`→illegal-stage, `42501`→not-permitted/SoD, else generic; feeds the toast headline + recovery detail on every CRUD mutation.

---

## 3. The two create/edit patterns — when to use which

ui-ux-pro-max `modal-vs-navigation` + impeccable `product-ban-modal-first-thought`: **modal is not the first thought.** The decision rule:

| Situation | Pattern | Rationale |
|---|---|---|
| **Create a new record** (any entity) | **`EntityFormModal`** launched from the index header **New …** primary button | Create is a discrete, focused, dismissable task; a modal keeps the user's place in the index list. ui-ux-pro-max ERP convention: "New" on the index/list header. |
| **Create from a parent context** (line-item on a PR, quotation on a PR, task on a project, document on a project) | **`EntityFormModal`** launched from a section-level **Add …** button (`outline sm` + plus icon), OR an **inline add-row** at the foot of the section list for very small records (a line item = description + qty + unit price). | Keeps the child in its parent's context; inline-add-row suits 2–3 field records, modal suits richer ones. |
| **Edit a record's header fields** (project header, company, PR while Draft) | **Inline detail-header edit**: detail `PageHeader` gains an **Edit** (`outline`) action that flips the header into editable `InlineEditField`s with a Save/Cancel `FormActions`. | Full-record edit on a deep detail page should not pop a giant modal over the page the user is already on; inline keeps context (avoids the modal-first anti-pattern). |
| **Edit a single SoD-gated field** (`contract_value` on a won project) | **`InlineEditField`** on the field itself, gated to Exec/Finance, committing through the scoped RPC + a `ConfirmDialog` (audit-stamped) | Smallest possible surface for the highest-friction edit; the confirm names the SoD reason. |
| **Edit a child collection** (line items, quotations) | **Inline editable rows** inside the parent section (edit/delete via row affordances), with a confirm on delete | Tabular children belong in their table, not a modal-over-modal. |
| **Lifecycle / approval transition** (procurement stages, project win, document status) | **Action button → `ConfirmDialog`** (existing pattern, unchanged) — NOT a form | These are state-machine moves, not field edits; the shipped pattern is correct and stays. |

**Where each affordance lives (the IA contract):**

- **Index page header** (`PageHeader`/page head): the **New …** primary button (single per-screen CTA). Gated by `can('create', entity)`.
- **Index row**: drill-down (existing) + an optional **row `RowMenu`** (`⋯`, hidden until hover — already in `DataTable`) carrying **Edit**, **Archive**, **Delete** (`danger`), each gated by `can(...)`. Quick row actions only; the canonical edit is on the detail page.
- **Detail page header** (`PageHeader.actions`): **Edit** (`outline`), **Archive** (`ghost`/menu), **Delete** (`danger`, Admin-only, in an overflow `RowMenu` on the header). Lifecycle/approval buttons stay in their dedicated action `Card` (existing).
- **Section header** (within a detail tab): **Add …** (`outline sm`) for child collections.

This matches the shipped IA exactly (index→detail, `RowMenu`, `PageHeader.actions`, action `Card`) — no new navigation surface.

---

## 4. FK pickers (`<Combobox>`) — the reference-selection convention

ERP/CRM forms are dense with foreign keys. The rule:

- **Short fixed enum (≤ ~7 options, stable):** native `<SelectField>` (status, role, GR/VI status, priority). Cheaper, native keyboard, no popover.
- **Long / data-driven reference (companies, vendors, PMs, projects, assignees):** `<Combobox>` — type-ahead, async-aware, keyboard-first.

`<Combobox>` data sources already exist in the DAL: `listClientCompanies`, `listProjectManagers`, project lists (plan §Critical files). Each `<Combobox>` instance:
- shows a **loading** skeleton row while options fetch (ui-ux-pro-max `loading-states`),
- an **empty** "No matches — [Create new …]" row when the query returns nothing (ties into create-inline for companies, deferred where not yet built),
- an **error** row with retry if the option fetch fails,
- a **required** + **invalid** state surfaced through the wrapping `<FormField>`.

Token mapping: trigger = `input` shell with a value chip; popover = `popover`+`border`+*Overlay* shadow, portaled (never clipped); option hover `accent`, selected `primary/7%`, all on `rounded.md`.

---

## 5. Confirm / approve flows

Two distinct flows, both already patterned in the app — CRUD reuses them:

### 5.1 Destructive / irreversible (Delete, hard-delete, Cancel PR, Reject)
`ConfirmDialog tone="destructive"` → `role="alertdialog"` + scrim + the single solid `destructive` confirm. Copy = verb+object (DESIGN.md/ui-ux-pro-max `confirmation-dialogs`, impeccable `skill-copy-button-verb-object`). Loading disables confirm and blocks Esc/scrim so the mutation can't double-fire (already implemented).

### 5.2 Approval / SoD transitions (procurement, project win, document approve)
Action button (in the action `Card`) → `ConfirmDialog tone="default"`. The **`GateNotice`** banner (existing) explains *why* an action is blocked when the viewer is the requester / lacks the role (the SoD gate copy pattern from `ProcurementDetails.sodGateMessage`). On RPC rejection, `classifyMutationError` turns `P0001`/`42501` into a human toast headline (not a silent no-op). **The contract_value-on-won edit** uses this flow: an `InlineEditField` gated to Exec/Finance, committing via the scoped RPC behind a default-tone confirm whose copy names the SoD ("Changing the contract value on a won project is a segregation-of-duties action and is recorded.").

### 5.3 Companies block-delete-if-referenced
When delete is attempted on a referenced company, the RPC returns a guard error; `ConfirmDialog` is replaced by an **inline `GateNotice variant="blocked"`** (or the delete confirm is pre-empted) reading: "This company is referenced by N projects / procurements and can't be deleted. Archive it instead." with an **Archive** action. (ui-ux-pro-max `error-recovery` — every error names a recovery path.)

---

## 6. All states (every CRUD surface must render these)

Per impeccable `product-components-all-states` + ui-ux-pro-max §8. The shipped `ListState` and `Button(loading)` already cover most; the table is the per-surface acceptance checklist.

| State | Index (list) | Form (create/edit) | Detail | Token / primitive |
|---|---|---|---|---|
| **Loading** | `ListState variant="loading"` skeleton rows (no spinner-in-content) | `Combobox` option skeletons; submit button `loading` spinner + `aria-busy` | `ListState loading` | `skel` utility; `Button` spinner |
| **Empty** | `ListState variant="empty"` — teaches + a `can('create')`-gated populate action (impeccable `product-components-empty-states`) | n/a | empty child sections = "No items yet" + gated Add | `ListState empty` icon tile (`secondary`) |
| **Error (load)** | `ListState variant="error"` + Retry (`error-recovery`) | option-fetch error row + retry | `ListState error` + Back action | `destructive/30` border, `destructive/7%` bg, darkened AA text |
| **Error (validation)** | n/a | `<FieldError>` below each field (`role="alert"`) + top `ErrBanner` summary + focus first invalid | n/a | `destructive` text; `aria-live` |
| **Error (mutation/RPC)** | toast (classified) | toast + inline error retained in form | toast + `GateNotice` for SoD | `classifyMutationError`; `useToast` |
| **Success** | optimistic row insert/update + success toast | modal closes + success toast (`success-feedback`) | inline value updates + toast | success `Toast` accent stripe |
| **Read-only** (role lacks write) | no New/Edit/Archive/Delete affordances rendered (see rbac-visibility.md) | fields render as static value rows (`read-only-distinction`), no Submit | header shows no Edit; values static | static `body` rows, NOT greyed inputs |
| **Disabled** (transiently, e.g. submit while invalid or in-flight) | n/a | `Button` `disabled`/`loading` | n/a | `disabled:opacity-45` |
| **Edge — archived record** | hidden by default; a "Show archived" toggle reveals them dimmed with an "Archived" `neutral` pill + Restore action | edit blocked, banner "This record is archived" | "Archived" pill in header + Restore (Admin/Exec) | `neutral` StatusPill; `GateNotice` |
| **Edge — long values / overflow** | cell truncate + title tooltip (existing); name wraps in roomy 54px row | `TextArea` wraps; labels never truncate | `truncation-strategy` | existing DataTable cell rules |
| **Edge — concurrent edit / stale** | refetch on focus (TanStack Query default) | on RPC version conflict → toast "This record changed — reload" + Retry | same | toast + invalidate |
| **Edge — zero permissions on a visible record** | row visible (RLS-readable) but no `⋯` write items | form opens read-only | header read-only | `<CanWrite>` falls through to read-only |

---

## 7. Responsive breakpoints

Structural, not fluid (impeccable `product-layout-responsive-structural`; ui-ux-pro-max `breakpoint-consistency`). Aligns with the shipped shell (`--rail-w` collapses < 920px).

| Breakpoint | Behavior |
|---|---|
| **< 768px (phone)** | Forms single-column (`FormGrid` collapses to 1 col); `EntityFormModal` becomes near-full-width (`w-[calc(100%-32px)]`, `max-h-[85dvh]` scroll); index DataTable hides low-priority columns (existing `colClassName="hidden …"` pattern) and the toolbar wraps; row `⋯` menu remains the action surface; touch targets ≥ 44px (the `[@media(pointer:coarse)]` padding bump already in ConfirmDialog is the pattern). |
| **768–1024px (tablet)** | Forms 2-col where paired; modal `max-w-520/640`; DataTable shows mid-priority columns. |
| **≥ 1024px (desktop, primary)** | Full density; rail visible; all columns; inline detail-header edit comfortable. |
| **≥ 1280px** | Widest columns shown (e.g. Projects "Customer" column reappears, per existing `hidden xl:table-cell`). |

No horizontal scroll on the page (`horizontal-scroll`); the DataTable's own `overflow-x-auto` is the single sanctioned scroll region.

---

## 8. WCAG-AA accessibility contract (every CRUD surface)

Per ui-ux-pro-max §1 + DESIGN.md *Accessibility posture*. This is the a11y acceptance list.

- **Contrast:** all field/label/helper/error text ≥ 4.5:1 (labels/placeholders in `muted-foreground` at the darkened 40% L — clears AA; error/required in `destructive`; success/SoD pills use the darkened AA text variants — never the base hue as text).
- **Labels:** every field has a visible `<label htmlFor>` (never placeholder-only); required fields `aria-required` + asterisk; icon-only buttons (close, row `⋯`, combobox clear) carry `aria-label` (the `Button` iconOnly guardrail already warns on omission).
- **Focus order:** DOM order = visual order (impeccable shape). In a form: top error summary → fields top-to-bottom → FormActions. Modal traps focus (reuse ConfirmDialog trap), moves focus in on open, restores to trigger on close, Esc closes (blocked while submitting).
- **Keyboard paths:** Combobox fully operable by keyboard (↑/↓/Enter/Esc/type-ahead); native select/date/checkbox keep native keyboard; row `⋯` menu reachable + Esc-closes (existing); the global `:focus-visible` ring (`2px ring`, 2px offset) on every focusable element.
- **Errors:** `<FieldError role="alert">` announced; submit-error summary `aria-live`; focus moves to first invalid field (`focus-management`).
- **Feedback:** toasts `aria-live="polite"`, do not steal focus (existing); state never conveyed by color alone — pills carry a dot + label, errors carry an icon + text (`color-not-only`).
- **Semantics:** `EntityFormModal` = `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`; `Combobox` = `role="combobox"`/`listbox`/`option` + `aria-activedescendant`; read-only ≠ disabled semantics (`read-only-distinction`).
- **Reduced motion:** modal scale+fade degrades to crossfade under `prefers-reduced-motion` (existing ConfirmDialog pattern; impeccable `skill-motion-reduced-motion`).

---

## 9. Per-entity mapping onto the patterns

Each entity = which create/edit pattern, which primitives, FK pickers, child collections, and the gating reference. Gating detail (who sees what) is in `docs/design/rbac-visibility.md`; this column names the policy only.

### 9.1 Project / Opportunity
- **Create:** `EntityFormModal` "New deal" from `/projects` (and `/sales`) header. Fields: name (`TextField`, required), client company (`Combobox` → `listClientCompanies`, required), PM (`Combobox` → `listProjectManagers`), origination status `SelectField` (Leads / Internal Project only — **never** a direct on-hand create; on-hand is reached only via the win-transition, plan Director-decision), estimated contract value (`NumberField`, optional pre-win), customer contract ref (`TextField`, optional). Advanced (disclosure): description, dates.
- **Edit header:** inline detail-header edit (`InlineEditField`s) on `ProjectDetailHeader` — name, client, PM, ref, value (value subject to SoD, §5.2).
- **`contract_value` SoD:** on a WON project, the value field is read-only for PM and editable only for Exec/Finance via the scoped RPC + audit confirm (ADR-0019).
- **Archive:** detail-header **Archive** (Admin·Exec) → confirm; index row hidden by default. **Hard-delete:** Admin only, row-menu `danger` + destructive confirm.
- **Lifecycle (win/lose/hold):** unchanged — `ProjectStatusControl` + ConfirmDialog (existing).
- **Gating:** `can('create'|'edit', 'project')` = Admin·Exec·PM; Finance excluded from create/edit (FE stricter than RLS, plan Director-decision).

### 9.2 Company (client / vendor)
- **Create:** `EntityFormModal` "New company" from `/companies` header. Fields: name (required), type `SelectField` (Client / Vendor / Both), contact name/email/phone (`TextField`, `type=email`/`tel` for the mobile keyboard hint), notes (`TextArea`).
- **Edit:** inline detail-header edit (or modal if no detail page yet — companies index ships first).
- **Archive:** Admin·Exec; **delete blocked-if-referenced** → §5.3 GateNotice + Archive fallback.
- **Gating:** create/edit = Admin·Exec·PM·Finance (master data, no SoD).

### 9.3 Procurement — PR header
- **Create (Raise request):** `EntityFormModal` "Raise procurement request" from `/procurement` header — **available to ANY member incl. Engineer** (requester server-stamped). Fields: title (required), project (`Combobox`), description/justification (`TextArea`), need-by `DateField`. Header total derives from line items.
- **Edit:** requester may edit header **while Draft/Rejected** (inline or modal); locked once Requested+.
- **Cancel:** the only "delete" — `ConfirmDialog destructive` "Cancel request" (no hard delete; audit trail). Subject to `canCancel` boundary (existing).
- **Lifecycle/SoD:** unchanged (the rich `allowedActions` + GateNotice + classified-toast machinery already shipped; ADR-0016 tightens `allowedActions` to read the real role and consume `can()`).

### 9.4 Procurement — line items
- **Create/edit:** **inline editable rows** in a "Line items" section on the PR detail (add-row at foot: description `TextField`, qty `NumberField`, unit price `NumberField` → line total `tabular` derived). Editable by requester + PM·Finance·Admin **while Draft**.
- **Delete:** row affordance + confirm (Draft only).
- **Note:** items must be added to the procurement `DETAIL_SELECT` first (plan Phase 2 §3) — a DAL change, not a new visual primitive.

### 9.5 Procurement — quotations
- **Create:** "Add quotation" `EntityFormModal` or inline-add (vendor `Combobox`, VQ#, total amount `NumberField`, attach later). Wires the already-built `createQuotation`.
- **Select quote:** the existing "Select Quote" lifecycle action → **select-quote RPC** sets `is_selected` + syncs header (fixes the real bug where `is_selected` is never set). Selected quote shows the `won`/"Selected" pill (existing).

### 9.6 Procurement — documents (metadata)
- **Register:** a "Documents" section/tab on the PR detail listing `procurement_documents` (currently a dead table). Metadata-only CRUD (name, type, status) via inline rows / small modal. File upload **deferred** (Storage off — show a disabled "Attach file" with a tooltip "File upload coming soon", not a broken control).
- **Status workflow:** approver ≠ author (Document approval SoD) → ConfirmDialog default + GateNotice.

### 9.7 Task (+ dependencies)
- **Create:** `EntityFormModal` "New task" from the project Tasks tab / `/tasks` (Admin·Exec·PM). Fields: title (required), assignee (`Combobox`), status `SelectField`, due `DateField`, depends-on (`Combobox`, multi later).
- **Edit:** PM·Exec·Admin edit structure; **Engineer edits OWN task status only** — for the assignee, the status `SelectField` is the *only* editable control (everything else read-only); needs the RLS widening for own-task status (plan). This is the clearest read-only-vs-editable split (`read-only-distinction`).
- **Board:** Tasks can render on the existing `Kanban` (status columns) with status change via drag → confirm, or the `SelectField` for keyboard users (gesture-alternative).
- **Delete:** Admin·Exec·PM, row-menu danger + confirm.

### 9.8 Incident
- **Create (File incident):** `EntityFormModal` "File an incident" — **ANY member** (reporter server-stamped). Fields: title (required), project (`Combobox`), severity `SelectField`, description (`TextArea`).
- **Workflow:** Open → Investigating → Closed via action button + confirm; **managers** (PM·Exec·Admin) investigate/close, reporter cannot self-close beyond filing. **Delete:** Admin.
- **New route** `/incidents` + index (reuses DataTable/ListState).

### 9.9 Document (project-level metadata)
- **Create:** "Add document" (Admin·Exec·PM·Finance) — name, type `SelectField`, status, notes. Files deferred (as §9.6).
- **Edit:** author edits; **status transition by approver ≠ author** (SoD) → confirm + GateNotice. **Delete:** Admin.
- **Register:** the project Documents tab (currently a stub) becomes a real metadata register.

### 9.10 User / Profile (Admin module)
- **Create (Invite/create user):** `EntityFormModal` "Add user" — **Admin only**. Fields: full name, email (`type=email`), role `SelectField`, manager (`Combobox` → managers).
- **Edit:** Admin edits role + manager_id (inline-edit rows on the user detail / row-edit). Role change is high-impact → confirm.
- **Archive/disable:** Admin; **no SoD** (but Admin still can't self-approve/self-pay procurement — that SoD is unchanged).
- **Visibility:** the entire Administration surface + the `/administration` nav item is Admin-only (already gated in `Rail`; this matches `can(..., 'user')` = Admin).

### 9.11 Budget line-item (small)
- **Edit:** add the missing **Edit** affordance (inline-edit row) to existing budget line items — DAL/hook/schema already support it (plan Phase 2 §8). Editable by Admin·Exec·PM·Finance, **Draft version only** (activation = the existing Draft→Active approval). No new primitive; reuse `InlineEditField`.

---

## 10. What we deliberately do NOT add (anti-slop guard)

- No new modal/sheet style, no custom scrollbar, no custom form controls beyond `Combobox` (impeccable `product-ban-reinvented-affordances`). Native select/date/checkbox stay native.
- No second brand color, no new font, no new border color, no new radius outside the 4/6/8/10/999 scale (DESIGN.md *Don'ts*).
- No decorative motion — modal scale+fade and toast slide are the only CRUD animations, both state-conveying, both reduced-motion-safe (`product-motion-state-not-decoration`).
- No solid status fills behind body text; the only solid `destructive` remains the destructive confirm button.
- No em dashes in UI copy (impeccable `skill-copy-no-em-dashes`); button labels are verb+object; no marketing buzzwords in empty-state/error copy.
- No modal-first reflex — full-record edit prefers inline detail-header edit (§3).

---

## 11. Open questions / proposed additions for owner sign-off

1. **`<Combobox>` "Create new …" inline** — when an FK lookup has no match (e.g. a vendor not yet in Companies), do we allow inline-create from the picker, or force the user to Companies first? *Proposed default:* allow inline-create **only for Company** (the FK most likely to be missing mid-flow), gated to roles that can create companies; everything else routes to its own create. Needs sign-off.
2. **Error-state token gap (DESIGN.md Open Questions, restated):** DESIGN.md flags that field error/disabled styling was not in the original mockups and proposes error border = `destructive`, helper = `destructive`, disabled = `secondary` bg + `muted-foreground` + not-allowed. These CRUD forms are the first surface to need them — **proposing to ratify those exact values as DESIGN.md tokens** (no new hue, just applying existing `destructive`/`secondary`/`muted-foreground`). Sign-off folds them into DESIGN.md §Components.
3. **Inline-edit vs modal for company edit before the company *detail* page exists** — Companies index ships first (Phase 2.1) without a detail page. *Proposed:* edit-via-modal initially, migrate to inline detail-header edit if/when a company detail page is built. Confirm acceptable.
4. **Multi-select dependencies on Tasks** — depends-on as single vs multi `Combobox`. *Proposed:* single FK in the first slice, multi deferred. Confirm.
5. **"Show archived" placement** — a toolbar toggle vs a filter chip. *Proposed:* a quiet toolbar checkbox "Show archived" (off by default), matching the existing toolbar control vocabulary. Confirm.
