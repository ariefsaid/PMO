# Plan: Budget-version dropdown (restore single-version view) — 2026-06-07

> **Workstream:** UI slop-audit remediation, owner directive "Budget-version dropdown" (audit
> `docs/reviews/2026-06-07-ui-slop-audit.md`, Owner directives §4). Presentation-only.
> **Surface:** `pmo-portal/pages/ProjectBudget.tsx` (mounted via `pages/project-detail/tabs/BudgetTab.tsx`).
> **Design authority:** `DESIGN.md` ("The Quiet Control Surface", RIS). Tokens only — no new aesthetic.
> **Owner of build:** ui-implementer (TDD). This doc is the design-plan + design section the eng plan references.

---

## 0. Root cause — WHY the dropdown was lost (confirmed, do NOT re-litigate)

The original AI-Studio prototype presented the project budget as **one version at a time**, chosen from
a selector, defaulting to the Active version. When the Budget module was **rebuilt on real Supabase data**
in build-wave #1 (`docs/plans/2026-06-04-budget-versioning.md`), the new `ProjectBudget.tsx` was specced as
a **"versions list"** — see that plan line 97: *"versions list with a status badge + per-version total."*
The implementation (`pages/ProjectBudget.tsx` lines 439-455) renders `versions.map(... <VersionCard/> ...)`,
i.e. **every version stacked**. The selector UX simply was not carried into the rebuild; it was a scope
omission, not a deliberate change. The reference markup still carries the selector vocabulary — the `vpill`
status pill (`docs/design-mockups/proposal-IA-3-hybrid.html` lines 657-662: `vpill.active` →
`success/12%` + `hsl(142 64% 30%)`; `vpill.draft` → `warning/16%` + `warning-foreground`; `vpill.archived`
→ `secondary` + `muted-foreground`) and the 32px `.control` field shell (same file line 472).

**Hard constraint (charter + workstream brief):** the budget **query/RPC/mutation logic is correct and
RLS-safe** (`src/lib/db/budgets.ts`, `src/hooks/useBudget.ts`, ADR-0011). This change is **presentation
only**. Do NOT touch the DAL, the hooks, the query keys, or any migration. The data already arrives as
`BudgetVersionWithItems[]` ordered ascending by `version`; we change only WHICH of those we render.

---

## 1. What we are building

A **version selector** at the top of the Project Budget tab that switches which single version's
line-items + per-version total are shown. It:

- defaults to the **Active** version (or, if none Active, the highest-`version` Draft, else the
  highest-`version` Archived — see §4 edge rules);
- shows the selected version's **status** (Draft / Active / Archived) via the existing `StatusPill`;
- renders **exactly one** `VersionCard` (the selected version) instead of the stacked list;
- preserves every existing capability of the current `VersionCard` (line-item editor for a selected
  Draft, lifecycle actions gated by `canWrite`, the read-only table + total for Active/Archived).

Everything below the selector is the **unchanged** `VersionCard` already in the file. We are wrapping the
list in a selector and rendering one card; we are not redesigning the card.

### Primary user action
Pick which budget version to inspect; understand at a glance its status and total. (One action, one
selector — satisfies `ui-ux-pro-max §4 primary-action`: one primary control per region.)

### Design direction (DESIGN.md, no override)
- **Color strategy:** Restrained (product default; DESIGN.md "The One Blue Rule"). The selector is a
  neutral field; status is the only color and it is **tinted, not saturated** (Tinted-Status Rule).
- **Scene sentence:** A project manager on desktop (and occasionally a phone, 375px) reviewing a project's
  budget under office light, scanning for the current Active number and comparing it against a prior
  revision — focused, not exploring. Forces **light scheme** (DESIGN.md is light-only) and **density**.
- **Anchor references (existing, in-repo):** the `seg`/`ViewToggle` field vocabulary, the LineItemEditor's
  styled native `<select>` (`ProjectBudget.tsx` lines 120-131), the reference `vpill`.

### Component choice — native `<select>`, not a custom listbox (decision, locked)
Use a **styled native `<select>`** as the selector control, matching the existing `aria-label="Line item
category"` select already in this file (lines 120-131) and the `.control` field shell (DESIGN.md "Inputs /
Fields", 32px, `input` border, `md` radius, global focus ring). Rationale, in order:
1. **Identity-consistent:** the file already styles a native select; a second custom-built listbox would be
   `ui-ux-pro-max §4 avoid-mixed-patterns` and `product-ban-reinvented-affordances` (taste §7).
2. **A11y for free:** native `<select>` gives keyboard navigation, type-ahead, screen-reader role/state,
   and Esc-to-close with zero custom focus-management code — the exact gap DESIGN.md "Accessibility posture"
   flags for hand-rolled overlays.
3. **No clipping risk:** the tab body is inside a scroll container; a `position:absolute` custom popover
   would hit `impeccable skill-interaction-dropdown-clipping`. Native select escapes the stacking context
   by default.
4. **Lowest-risk for a presentation-only change.**

A custom `role="listbox"` is explicitly **out of scope** and flagged as a possible future enhancement only
if the owner wants per-option status pills inside the open menu (Open Questions Q1). The selected status is
shown in a pill **next to** the select, which delivers the requirement without the custom-menu cost.

---

## 2. Layout strategy

A single **selector bar** above the one rendered `VersionCard`, sitting under the existing `head` block
(the "Project Budget" h2 + derived-budget line + "+ New version" button). Spatial flow top→bottom:

```
┌─ head (UNCHANGED) ─────────────────────────────────────────────┐
│  Project Budget                                  [+ New version]│
│  Active budget: $4,700,000                                       │
└─────────────────────────────────────────────────────────────────┘
┌─ selector bar (NEW) ───────────────────────────────────────────┐
│  Version  [ v2 · Draft v2            ▼ ]   ◖ Draft ◗   $200,000 │   ← label · select · StatusPill · total
└─────────────────────────────────────────────────────────────────┘
┌─ ONE VersionCard (selected version, EXISTING component) ───────┐
│  v2  Draft v2   ◖ Draft ◗                            $200,000   │
│  [Activate] [Delete draft]                                       │
│  ┌ line-item editor / read-only table ┐                         │
│  └──────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

- Selector bar uses the existing `Toolbar` primitive shell (`card` bg, `border`, seamed look) OR a plain
  flex row inside the page's `flex-col gap-4` rhythm; pick `Toolbar standalone` for consistency with the
  `NewVersionForm` row already in this file.
- The selected-version status pill **and** total live in the selector bar so the user sees status + number
  without scrolling to the card. The `VersionCard` keeps its own internal status + total (unchanged) — this
  is intentional reinforcement at the control, not duplication slop, because the card scrolls out of view on
  a long line-item list.
- The selector occupies ≤ ~40% width on desktop; the status pill + total trail right. On mobile the bar
  wraps (`flex-wrap`) so nothing overflows (`impeccable skill-ban-text-overflow`,
  `ui-ux-pro-max horizontal-scroll`).

### Token map (every visual decision names a DESIGN.md token — no raw hex/px in review)
| Piece | DESIGN.md token(s) |
|---|---|
| Selector bar container | `components.card` (bg `colors.card`, `rounded.md`, `border` 1px) via existing `Toolbar` |
| "Version" field label | typography `label` (12px/600) in `colors.muted-foreground` |
| Select control shell | `components.input` (bg `colors.background`, `border`=`colors.input`, `rounded.md`, height 32px, pad `0 10px`) |
| Select chevron icon | `Icon name="chev"` in `colors.muted-foreground`, 14px (matches `.control` chevron) |
| Select focus | global `:focus-visible` ring = `colors.ring` 2px / 2px offset (DESIGN.md "Focus", inherited) |
| Selected-status pill | `StatusPill` — Active→`won` (success tint), Draft→`warn` (warning tint), Archived→`neutral` (secondary). Darkened AA text variants preserved by the component. |
| Selector total | typography `body`/600 + **`tabular`** numeric (Tabular-Numbers Rule); negative would turn `colors.destructive` (n/a for budgeted Σ ≥ 0) |
| Spacing (label↔select↔pill↔total) | `spacing.2` (8px) / `spacing.3` (12px) |
| Card list → single card | unchanged `VersionCard` (`components.card`) |

No new token is required. (No gap surfaced; nothing to escalate on tokens.)

---

## 3. State model (presentation only — no new data fetch)

Add ONE piece of local state to `ProjectBudget`:

```ts
const [selectedId, setSelectedId] = useState<string | null>(null);
```

Derive the **effective selected version** with a default-resolution rule (memoized), so the selector
defaults to Active and self-heals when the data changes (e.g. after Activate/Archive/Clone mutations
invalidate the query and the versions array changes identity):

```ts
// default-resolution priority: explicit pick (if still present) → Active → highest Draft → highest Archived → first
const selected = useMemo(() => {
  if (versions.length === 0) return null;
  const byId = selectedId && versions.find(v => v.id === selectedId);
  if (byId) return byId;
  return (
    versions.find(v => v.status === 'Active') ??
    [...versions].reverse().find(v => v.status === 'Draft') ??
    [...versions].reverse().find(v => v.status === 'Archived') ??
    versions[0]
  );
}, [versions, selectedId]);
```

This keeps the existing `versions` (ascending-by-`version`) ordering for the **option list** while making
the **default selection** Active-first. No effect/`useEffect` reset is needed because selection is derived,
not mirrored — avoids the stale-selection-after-mutation class of bug.

---

## 4. All states (taste Rule 5 + impeccable shape §6 + product-components-all-states)

Each state below is an **acceptance item**. The three async states (loading/empty/error) are ALREADY
handled by the existing `ListState` plumbing and **must remain byte-for-byte** — the selector only renders
in the "normal" branch.

| # | State | What the user sees | Behaviour | Tokens |
|---|---|---|---|---|
| S1 | **Loading** | existing `budget-loading` skeleton (`ListState variant="loading"`) | UNCHANGED — selector not rendered while `isPending` | `ListState` |
| S2 | **Error** | existing `Couldn't load budget` + Retry | UNCHANGED — selector not rendered while `isError` | `ListState` (`destructive` accents) |
| S3 | **Empty (0 versions)** | existing `budget-empty` empty state + "+ New version" | UNCHANGED — no selector (nothing to select) | `ListState variant="empty" icon="dollar"` |
| S4 | **Single version** | selector shows the one version, defaulted-selected; that one card below | selector is still rendered (consistency) but has one option; NOT auto-hidden | `components.input`, `StatusPill` |
| S5 | **No Active version** (only Draft/Archived exist) | selector defaults to highest Draft, else highest Archived; status pill reflects it; the `head` "Active budget" line shows `$0` (existing `deriveProjectBudget` behaviour FR-BV-002 — unchanged) | default-resolution §3 | `StatusPill warn`/`neutral` |
| S6 | **Active selected (default, typical)** | selector shows Active version; read-only table + total; lifecycle actions (Archive w/ confirm, Clone) | unchanged `VersionCard` Active branch | `StatusPill won` |
| S7 | **Draft selected** | selector shows Draft; **line-item editor** (add/delete rows) + Activate + Delete draft, gated by `canWrite` | unchanged `VersionCard` Draft branch (editor preserved) | `StatusPill warn` |
| S8 | **Archived selected** | read-only table + total + "Clone to revise" | unchanged `VersionCard` Archived branch | `StatusPill neutral` |
| S9 | **Read-only role** (`canWrite` false) | selector + read-only single card, no action buttons, no editor | selector still usable (viewing is allowed); existing `canWrite` gates unchanged | — |
| S10 | **After a mutation** (Activate/Archive/Clone/Delete-draft) | query invalidates → `versions` changes → selection self-heals to the new Active (Activate), or to default if the selected id vanished (Delete-draft) | derived selection §3, no manual reset | — |

Edge specifics:
- **Delete-draft of the currently-selected version:** `selectedId` no longer matches any version →
  `selected` falls back to default (Active). No crash, no blank card. (Acceptance AC-BD-09.)
- **Clone creates a new Draft:** after invalidation the new Draft appears in options; selection stays on
  the user's current pick (Active) — we do NOT auto-jump to the clone (that would steal focus, taste
  toast-accessibility spirit). Owner may want auto-select-clone later (Open Q2).

---

## 5. Interaction model

- **Change selection:** user opens the native select (click / Space / Enter / Arrow keys / type-ahead) →
  picks an option → `onChange` sets `selectedId` → the single `VersionCard` below swaps. No async, no
  spinner (data is already loaded). Instant content swap is correct here (no layout-animation needed;
  `product-motion-state-not-decoration`).
- **Option label format:** `v{version} · {name}  —  {status}` is NOT used (no em-dash;
  `impeccable skill-copy-no-em-dashes`). Use: `v{version} · {name} ({status})`, e.g. `v2 · Draft v2 (Draft)`.
  Status is in the option text **and** in the trailing pill so selection is never color-only
  (`ux color-not-only`, `color-not-decorative-only`).
- **Reduced motion:** no animation introduced, so nothing to gate; the content swap is instant
  (`prefers-reduced-motion` safe by construction).
- **Focus:** the global `*:focus-visible` ring applies to the native select automatically (DESIGN.md
  "Focus" single-source-of-truth). Do NOT add a per-component focus style.

---

## 6. Responsive

DESIGN.md is structural-responsive (product-layout-responsive-structural), not fluid type.

| Breakpoint | Behaviour |
|---|---|
| Desktop (≥768px) | selector bar is one row: `Version` label · select (~280-320px) · status pill · total trailing right |
| Mobile (375px) | bar uses `flex-wrap`: label+select on row 1, pill+total wrap to row 2; no horizontal scroll; the native select opens the OS picker (ideal touch UX) |
| Touch targets | the select is 32px visual height; on coarse pointers ensure the **hit area** ≥44px via vertical padding on its wrapper (WCAG 2.5.5 / `touch-target-size`) — note: audit I5 tracks the global 44px sweep; this control must not regress it. Grow padding, not visual size. |

---

## 7. Accessibility (WCAG-AA — acceptance items)

| Item | Requirement |
|---|---|
| A1 | The select has a programmatic label: a visible `<label htmlFor>` "Version" wired to the select `id` (not placeholder-only; `form-labels`, `input-labels`). |
| A2 | Native `<select>` keyboard path verified: Tab to focus, Arrow/type-ahead to change, Enter/Space to open, Esc to close — all free with native element (`keyboard-nav`). |
| A3 | Focus ring visible on the select = global `ring` token, 2px/2px offset (`focus-states`). |
| A4 | Selected status conveyed by **text + pill dot**, never color alone — option text includes `(Draft|Active|Archived)` and the `StatusPill` carries a 6px dot (`color-not-only`). |
| A5 | Status-pill text uses the **darkened AA variants** baked into `StatusPill` (won `hsl(142 64% 30%)`, warn `warning-foreground`, neutral `muted-foreground` on `secondary`) — all clear AA per DESIGN.md "Accessibility posture". Do not substitute base hue as text. |
| A6 | Total value is `tabular` so it does not jitter on version switch (`number-tabular`). |
| A7 | Reading order: label → select → status → total → card, matching DOM order (`voiceover-sr`). |
| A8 | Touch target ≥44px hit area on coarse pointers (`touch-target-size`, WCAG 2.5.5). |

---

## 8. Anti-AI-slop acceptance (taste §7 + impeccable absolute bans — fold into checklist)

| Item | Check |
|---|---|
| N1 | **No emoji** anywhere in the selector or option labels (taste anti-emoji; audit C5 context). Status uses `StatusPill` SVG-dot vocabulary only. |
| N2 | **No em-dash** in option labels / copy — use `()` or `·` (`skill-copy-no-em-dashes`). |
| N3 | **No new color** — one blue + neutrals + the three status tints only; no invented hue for the selector (DESIGN.md "Don't introduce a second brand color"; audit C2 context). |
| N4 | **No second affordance vocabulary** — native select matches the existing field shell; no custom popover, no glassmorphism, no drop-shadow on the rest-state bar (Flat-By-Default; `product-ban-reinvented-affordances`). |
| N5 | **No saturated status fill** behind the pill text — tint + darkened text only (Tinted-Status Rule). |
| N6 | **No disabled dead-CTA** added (audit C3) — the selector is always live when ≥1 version exists. |
| N7 | Button label discipline preserved on the unchanged actions (verb+object already satisfied: "Activate", "Delete draft", "Clone to revise"). |
| N8 | Copy: the field label is the single word "Version" (every word earns its place); no restated heading. |

---

## 9. Build tasks (TDD, red→green, 2-5 min each, conflict-safe order)

> All edits are confined to **`pmo-portal/pages/ProjectBudget.tsx`** and its test
> **`pmo-portal/pages/ProjectBudget.test.tsx`**. No other source file changes. `Icon`, `StatusPill`,
> `Toolbar` are imported from the existing `@/src/components/ui` barrel (already partially imported in the
> file — add `Icon` to the import on line 5).
>
> Verify each task with: `cd pmo-portal && npm test -- ProjectBudget` (Vitest). Full gate at the end:
> `npm run typecheck && npm test -- ProjectBudget && npm run lint`.

**T0 — Read-only baseline (no code).** Run `cd pmo-portal && npm test -- ProjectBudget` and confirm all
existing tests in `ProjectBudget.test.tsx` pass before touching anything. Record the count (currently ~30
its). This is the regression floor — every one of these must still pass at the end (the stacked-list tests
that assert a single version's content still hold because that version will be the default selection).
_Verify: green, note baseline count._

**T1 — RED: selector renders with a labelled control.** In `ProjectBudget.test.tsx` add a describe block
`ProjectBudget version selector (budget-dropdown)`. First test: with `versionsState.data = [activeVersion,
draftVersion]`, assert `screen.getByLabelText(/Version/i)` is in the document and is a `combobox`
(`getByRole('combobox', { name: /version/i })`). _Verify: fails (no select yet)._

**T2 — GREEN: add the selector bar.** In `ProjectBudget.tsx`, in the **normal-state return** (lines
422-456), between `{head}`/`NewVersionForm` and the versions block, render a selector bar: a `<label
htmlFor="budget-version-select">Version</label>` (`label` token, `muted-foreground`) + a native
`<select id="budget-version-select" aria-label="Version">` styled with the existing field classes (reuse
the `fieldCls` pattern: `h-8 rounded-md border border-input bg-background px-2.5 ...focus-visible:outline-ring`).
Options: `versions.map(v => <option value={v.id}>v{v.version} · {v.name} ({v.status})</option>)`. Wire
`value={selected?.id} onChange={e => setSelectedId(e.target.value)}`. Add the `useState`/`useMemo` from §3
and add `Icon` to the line-5 import. _Verify: T1 passes._

**T3 — RED: defaults to Active.** Test: `versionsState.data = [archivedVersion, activeVersion,
draftVersion]` (deliberately unordered), assert the select's value resolves to the Active version — assert
the selector-bar `StatusPill` shows `Active` (e.g. `within(getByTestId('version-selector')).getByText('Active')`,
add `data-testid="version-selector"` to the bar). _Verify: fails until default-resolution is wired._

**T4 — GREEN: default-resolution + selector status pill + total.** Implement the §3 `selected` memo
(Active → highest Draft → highest Archived → first). In the selector bar, after the select, render
`<StatusPill variant={VERSION_PILL[selected.status]}>{selected.status}</StatusPill>` and the total
`<span className="ml-auto tabular font-semibold">{formatCurrency(selected.total)}</span>`. _Verify: T3
passes._

**T5 — RED: switching selection swaps the single card.** Test: data `[activeVersion(total 4_700_000),
draftVersion(name 'Draft v2', li 'Developers')]`; default shows Active (assert `Developers` NOT present);
`await userEvent.selectOptions(getByRole('combobox'), draftVersion.id)`; assert `Developers` now present and
the Active-only content is gone. _Verify: fails (still stacked)._

**T6 — GREEN: render ONE card (the selected version).** Replace `versions.map(...)` (lines 439-455) with a
single `selected && <VersionCard version={selected} ... />` passing the same handlers. Keep the
`flex-col gap-4` wrapper. _Verify: T5 passes; re-run full file — confirm T0 baseline tests still green
(the badge/draft-action/active-action/archived tests each render a single-version array, so that version is
the default selection and its content renders exactly as before)._

**T7 — RED: single-version still shows the selector (S4).** Test: `versionsState.data = [activeVersion]`,
assert `getByRole('combobox', { name: /version/i })` present AND the one card present. _Verify: should pass
already from T6; if a "hide selector when one version" shortcut crept in, this fails and forces removal._

**T8 — RED: no-Active fallback (S5).** Test: `versionsState.data = [archivedVersion, draftVersion]` (no
Active), assert selector-bar pill shows `Draft` (highest Draft wins over Archived). _Verify: fails if
fallback order wrong._ Then confirm green against §3 order (already implemented in T4 — this test pins it).

**T9 — RED: delete-selected-draft self-heals (S10/AC-BD-09).** Test: data `[activeVersion, draftVersion]`;
select the Draft; the `VersionCard` Delete-draft handler is mocked (existing `mockDeleteDraft`). Simulate
the post-mutation data change by re-rendering with `versionsState.data = [activeVersion]` (the draft gone)
and assert no crash + selector falls back to Active (pill shows `Active`). _Verify: confirms derived
selection (not mirrored state) handles the vanished id._

**T10 — A11y + anti-slop assertions.** Add tests: (a) the option text for a Draft contains `(Draft)` not a
color-only signal (A4/N1); (b) no `—` em-dash in any rendered option (`expect(container.textContent).not.toContain('—')`
within the selector — N2); (c) the select has an associated visible label (`getByLabelText` already covers
A1). _Verify: green._

**T11 — Full gate + visual check.** Run `npm run typecheck && npm test -- ProjectBudget && npm run lint`
(all zero-error). Then hand to the Director for a rendered `/design-review` pass on the Budget tab at 1440px
and 375px (selector wrap, focus ring, pill contrast, no overflow). _Verify: gates green; review queued._

---

## 10. Traceability (acceptance ↔ owning test layer, ADR-0010)

All acceptance for this presentation-only change is **Unit (Vitest/RTL)** — it is component render +
interaction + state logic, the lowest sufficient layer. No new pgTAP (no RLS/data-contract change) and no
new e2e (the existing `e2e/AC-732-budget-activate.spec.ts` journey still covers the cross-stack activate
flow; the selector is presentation). New AC ids proposed for the eng plan's table:

| AC | Statement | State | Owning test |
|---|---|---|---|
| AC-BD-01 | Given ≥1 version, When the budget tab renders, Then a labelled "Version" selector is shown | S4/S6 | Vitest T1/T2 |
| AC-BD-02 | Given versions incl. an Active one, When the tab loads, Then the Active version is selected by default | S6 | Vitest T3/T4 |
| AC-BD-03 | Given no Active version, When the tab loads, Then the highest Draft (else highest Archived) is selected | S5 | Vitest T8 |
| AC-BD-04 | Given a selection, When the user picks another version, Then only that version's card is shown | S7/S8 | Vitest T5/T6 |
| AC-BD-05 | Given any state, When rendering, Then exactly one VersionCard is shown (never stacked) | all | Vitest T6 |
| AC-BD-06 | Given one version, When the tab loads, Then the selector is still present | S4 | Vitest T7 |
| AC-BD-07 | Given a version is selected, Then its status (Draft/Active/Archived) is shown as a tinted pill with text | A4 | Vitest T4/T10 |
| AC-BD-08 | Loading / empty / error states render unchanged (no selector) | S1-S3 | Vitest T0 (existing AC-726) |
| AC-BD-09 | Given the selected Draft is deleted, Then selection self-heals to default without crash | S10 | Vitest T9 |

---

## 11. Cross-workstream file overlaps (FLAG for build sequencing)

This plan edits **`pmo-portal/pages/ProjectBudget.tsx`** + its test only. Overlaps with other slop-audit
workstreams:

- **`StatusPill.tsx` / `StatusPill` variants** — this plan REUSES the existing `won`/`warn`/`neutral`
  variants unchanged. Audit **I1/I2** (status-pill / status-dot differentiation) may edit `StatusPill.tsx`.
  No conflict on `ProjectBudget.tsx`, but if I1 changes the `warn`/`neutral` tints, the budget selector pill
  inherits the change automatically — coordinate so the Draft/Archived pills stay legible. **Sequence:**
  land this AFTER or independently of I1; re-screenshot the Budget tab if I1 lands first.
- **Confirmation-before-mutation workstream** (Owner directive §3) — touches the **same `VersionCard`
  lifecycle actions** (Activate/Archive/Clone/Delete-draft) inside `ProjectBudget.tsx`. **HARD OVERLAP on
  the same file.** This budget-dropdown change wraps the card in a selector and renders one card; the
  confirmation change modifies the card's action handlers. **Sequence:** land **budget-dropdown FIRST**
  (smaller, structural), then the confirmation change rebases onto the single-card render. If confirmation
  lands first, this plan's T6 must preserve whatever confirm wrappers exist on the handlers (the handlers
  are passed through unchanged, so low risk, but flag for the rebaser).
- **Tabbed-workspace removal** (Owner directive §1) — touches `BudgetTab.tsx`'s mounting context, not
  `ProjectBudget.tsx` internals. `ProjectBudget` takes a `projectId` prop and is route/tab-agnostic, so no
  conflict. **Sequence:** independent.
- **44px touch-target sweep (audit I5)** — global; this plan's §6/A8 must not regress it. If I5 lands a
  shared coarse-pointer padding utility, the selector should adopt it rather than hand-roll. **Sequence:**
  independent; reconcile the hit-area padding with I5's utility if it exists.

No migration, no DAL, no hook, no query-key overlap — the data layer is untouched.

---

## 12. Open questions (owner sign-off)

- **Q1 — Per-option status pills inside the open menu?** Native `<select>` cannot render a `StatusPill`
  inside its option list (OS-rendered). We deliver status via the trailing pill + the `(Status)` suffix in
  option text. If the owner wants rich in-menu status chips, that requires a custom `role="listbox"`
  (larger scope, focus-management, clipping handling). **Recommend: ship native select; defer custom
  listbox unless owner asks.**
- **Q2 — Auto-select a freshly cloned Draft?** Today, after "Clone to revise" the new Draft appears in the
  options but selection stays on the user's current version. Auto-jumping to the clone would be convenient
  but steals context. **Recommend: do NOT auto-jump (current plan); revisit if owner reports friction.**
- **Q3 — Show version `created_at` / author in the option label?** The data has `created_at`. Adding it
  could disambiguate same-named versions but lengthens the option. **Recommend: keep `v{n} · {name}
  ({status})`; add date only if owner reports ambiguity.**

No token additions proposed — the existing palette and components cover this surface fully.
