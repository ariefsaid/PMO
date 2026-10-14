# #1007 — Conditional sticky row-actions seam

## Acceptance contract

- **AC-TBL-STICKY-001:** Given the desktop `DataTable` renders a `rowMenu`, when its table content overflows the `dt-table-branch` scrollport and more than 1px remains hidden to the right (`scrollWidth - clientWidth - scrollLeft > 1`), then the 12px left-cast gradient is rendered in the sticky Actions header and every sticky body action cell. Given the table fits, or the scrollport is at its right end, then no gradient is rendered. The sticky cells retain their opaque `card` surface, `-right-px` position, and 1px inset `--border` hairline in every state; the phone card branch and row-menu behavior are unchanged.

The issue description is the complete acceptance contract; no issue-specific spec exists. The existing AC identifier is retained rather than inventing a second contract.

## Design

### Decision and data flow

Keep the behavior wholly inside `pmo-portal/src/components/ui/DataTable.tsx`; no consumer, table layout, API, schema, or page-specific adjustment is needed. Add one module-local hook in that file with this concrete signature:

```ts
function useStickyRowMenuSeam(
  scrollportRef: React.RefObject<HTMLDivElement | null>,
  tableRef: React.RefObject<HTMLTableElement | null>,
  enabled: boolean,
): boolean
```

`enabled` is `isDesktop && Boolean(rowMenu)`. On layout effect it obtains the desktop scrollport and table refs, measures `scrollWidth - clientWidth - scrollLeft > 1`, and stores that boolean once at DataTable scope. It measures immediately (before paint), listens to passive `scroll` on the scrollport, and attaches one `ResizeObserver` to both the scrollport and `<table>` so width changes and table-content width changes recompute it. If `ResizeObserver` is unavailable, it instead listens to `window` `resize`; all listeners/observers disconnect on cleanup and the hook resets false when disabled or either element is absent.

The desktop wrapper receives `data-dt-overflowing=""` only while that state is true. The existing `ROW_MENU_SEAM_CLASS` stays token-identical; render its `span[data-dt-seam]` in the Actions `<th>` and each action `<td>` only while the single hook state is true. This removes the shadow from fit/right-end states without per-cell listeners or style drift. `ROW_MENU_STICKY_CLASS` remains untouched, retaining `sticky -right-px bg-card shadow-[inset_1px_0_0_hsl(var(--border))]` in every state.

This is a constant-cost event/observer pair per mounted desktop DataTable, not per row. It follows the existing ResizeObserver fallback convention in `MobileActionBar`; no dependency, migration, or ADR is warranted.

### QA ownership

The component-only visibility predicate is owned at the lowest sufficient layer by RTL in `DataTable.test.tsx`; the existing `e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` remains supporting browser geometry proof for sticky positioning, hairline paint, menu portal behavior, and both themes. No new browser journey is needed for this presentation-state predicate.

## Implementation plan

### Task 1 — Write the failing conditional-seam RTL contract (3–5 min)

**Files:** `pmo-portal/src/components/ui/__tests__/DataTable.test.tsx`

1. Before production changes, extend the existing `AC-TBL-STICKY-001` block. Import `act` and `fireEvent` from `@testing-library/react` beside the existing render helpers.
2. Add a local test helper that obtains `screen.getByTestId('dt-table-branch')` and defines configurable `scrollWidth`, `clientWidth`, and `scrollLeft` getters on that **container element** (not a global prototype). Add a small `TestResizeObserver` double that records the callback and observed elements, then install it with `vi.stubGlobal`; use `act` to invoke its callback after changing the container metrics.
3. Add a failing test named `AC-TBL-STICKY-001 renders the gradient in the header and every body sticky cell only while content remains hidden to the right`. Render the desktop fixture with its existing two rows and `rowMenu`; set `scrollWidth=500`, `clientWidth=300`, `scrollLeft=0`, trigger the observer, then assert `data-dt-overflowing` is on `dt-table-branch` and exactly three `[data-dt-seam]` spans exist (one inside the Actions `<th>`, one inside each generated action `<td>`). Retain the existing assertions that each rendered span is decorative and has the absolute 12px tokenized gradient classes.
4. Add a second failing test named `AC-TBL-STICKY-001 omits the gradient when the table fits or the scrollport reaches its right end`. First set `scrollWidth=clientWidth=300` and assert the scrollport has no `data-dt-overflowing` attribute and no seam spans, while the Actions header and first action cell still contain `shadow-[inset_1px_0_0_hsl(var(--border))]`. Then change the same rendered container to `scrollWidth=500`, `clientWidth=300`, `scrollLeft=200`, dispatch `fireEvent.scroll(container)`, and assert the attribute and all seam spans remain absent. This locks the >1px right-end tolerance and the always-on divider.
5. In the observer test, assert its observed-element set includes both `dt-table-branch` and its child `<table>`; this binds the size-change requirement rather than only proving initial or scroll measurement. Restore globals/mocks in the test cleanup already present in the file.

**Covers:** `AC-TBL-STICKY-001` (owning RTL proof).

**Red verification:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/DataTable.test.tsx'
```

### Task 2 — Measure hidden right-side content once and conditionally render the shared seam (3–5 min)

**Files:** `pmo-portal/src/components/ui/DataTable.tsx`

1. Add `useStickyRowMenuSeam` after `useNarrowerThan`. Use `useLayoutEffect` so the first visible desktop paint follows the measured state. Its `measure` function must calculate exactly `scrollport.scrollWidth - scrollport.clientWidth - scrollport.scrollLeft > 1` and update state only when the boolean changes.
2. When enabled, call `measure()` immediately; register `scrollport.addEventListener('scroll', measure, { passive: true })`; if `ResizeObserver` exists, observe **both** `scrollport` and `table`, otherwise register `window.addEventListener('resize', measure)`. On every cleanup remove the scroll/resize listener or disconnect the observer. When the hook is disabled or a ref is missing, clear the state to false and attach nothing.
3. Add `tableBranchRef` and `tableRef` to `DataTable`, call the hook with `isDesktop && Boolean(rowMenu)`, attach the refs to the existing `dt-table-branch` `<div>` and its `<table>`, and put `data-dt-overflowing=""` on that div only when the hook returns true. Do not change its `relative overflow-x-auto` classes.
4. In the desktop Actions `<th>` and generated action `<td>`, wrap only the existing seam span in `hasHiddenRightContent && (...)`. Leave `ROW_MENU_SEAM_CLASS`, `ROW_MENU_STICKY_CLASS`, `scope`, z-indexes, `-right-px`, inset hairline, `RowMenu`, table markup, and the complete `dt-card-branch` untouched.
5. Re-run the new RTL contract. Confirm the new tests transition the shared state through overflow, fit, and right-end states without creating per-cell event handlers.

**Covers:** `AC-TBL-STICKY-001`.

**Green verification:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/DataTable.test.tsx src/components/ui/__tests__/DataTable.mobile.test.tsx src/components/ui/__tests__/DataTable.rowmenu-clip.test.tsx src/components/ui/__tests__/DataTable.containerCards.test.tsx'
```

### Task 3 — Record the conditional visual rule (2–3 min)

**Files:** `DESIGN.md`

1. In §5 **Data Table (signature)**, revise only the **Row actions** paragraph: retain the opaque `card` surface, sticky z-order, inset `--border` hairline, positioned 12px `foreground` gradient, `-right-px` Chromium seam protection, and unchanged mobile-card action placement.
2. State explicitly that the gradient is a scroll affordance, rendered only when the desktop scrollport overflows **and** more than 1px of content remains hidden to its right; it disappears when the table fits or reaches its right end. State explicitly that the inset hairline remains visible in all three states.
3. Do not alter any token, broad table geometry, row-menu discoverability rule, or unrelated DESIGN.md section.

**Covers:** `AC-TBL-STICKY-001` retained design knowledge.

**Verification:**
```bash
grep -n -A10 -B2 'Row actions' DESIGN.md
```

### Task 4 — Run deterministic gates and the bounded rendered check (3–5 min)

**Files:** no additional files.

1. Run the focused existing browser geometry proof; it must still find the seam in the initially-left, overflowing Sales Invoices table and retain the sticky/hairline/menu guarantees in light and dark.
2. Run the local final unit/type/lint gates. Keep `package-lock.json`, migrations, data, page consumers, and e2e specs unchanged.
3. Run the mandated post-edit Impeccable detector once on the changed UI component.
4. In one bounded rendered Discover pass with rich local seed, inspect light and dark: at **1440×900** visit `/companies` and verify its fitting table has the hairline but no gradient; at **1024×900** visit a genuinely wide `/projects` or Procurement table, verify the gradient while at scroll-left 0, scroll fully right, and verify it disappears while the hairline, pinned ⋯, and row menu still work. Also verify a sub-768px viewport retains the unchanged card branch with its top-right menu. Record any new finding as a test plus QA-portfolio matrix/design knowledge before merge; do not turn a clean pass into a new artifact.

**Covers:** `AC-TBL-STICKY-001` regression and rendered-oracle evidence.

**Verification:**
```bash
scripts/e2e-local.sh AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
cd pmo-portal && npx eslint --max-warnings=0 src/components/ui/DataTable.tsx src/components/ui/__tests__/DataTable.test.tsx
/Users/ariefsaid/Coding/PMO/.claude/skills/impeccable/scripts/impeccable detect --json pmo-portal/src/components/ui/DataTable.tsx
```

## Traceability

| Acceptance criterion | Owning proof | Supporting proof | Tasks |
| --- | --- | --- | --- |
| `AC-TBL-STICKY-001` | `pmo-portal/src/components/ui/__tests__/DataTable.test.tsx` — overflow-left / fit / right-end state contract, header+body seam placement, and dual ResizeObserver targets | `pmo-portal/e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` — real browser sticky geometry, hairline, portal and light/dark rendering | 1–4 |

## Scope fences

- Do not change `ROW_MENU_STICKY_CLASS`, sticky `-right-px` placement, z-indexes, the inset hairline, row-menu behavior, consumer pages, columns, or the phone card branch.
- Do not add per-cell listeners, a dependency, migration, RLS/API/repository work, seed data, e2e fixture changes, or a package-lock change.
- Do not remove the existing E2E seam assertion: at initial left scroll on an overflowing table the gradient must remain present.
- No ADR is needed; this is a reversible, local rendering predicate within the existing shared DataTable pattern.
