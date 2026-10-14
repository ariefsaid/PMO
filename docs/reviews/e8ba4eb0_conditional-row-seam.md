# Conditional sticky row-actions seam

Issue #1007 changes the desktop `DataTable` row-actions seam so its 12px gradient appears only when horizontal content is hidden to the right of the pinned Actions column. The inset 1px border hairline remains present regardless of fit, overflow position, or theme; the mobile card branch and sticky positioning are unchanged.

## What changed

- `pmo-portal/src/components/ui/DataTable.tsx` adds a single `useStickyRowMenuSeam` state/effect at `DataTable` scope. It measures `scrollWidth - clientWidth - scrollLeft > 1`, measures before paint, updates on scroll, and observes both the scroll container and table with `ResizeObserver`. When `ResizeObserver` is unavailable, it falls back to window resize. Cleanup removes listeners or disconnects the observer.
- The desktop `dt-table-branch` receives refs and a `data-dt-overflowing` attribute while hidden right-side content exists. The shared seam span is rendered in the Actions header and each body action cell only in that state. `ROW_MENU_STICKY_CLASS`, including the inset border, remains unchanged.
- `pmo-portal/src/components/ui/__tests__/DataTable.test.tsx` expands `AC-TBL-STICKY-001` with local scroll-metric stubbing and a `ResizeObserver` double. Tests cover the header plus every body seam during left-side overflow, no seam when the table fits, no seam at the right end (including the 1px tolerance), both observer targets, and the always-on hairline.
- `DESIGN.md` records the gradient as a conditional scroll affordance and explicitly preserves the hairline in all states.
- `docs/plans/2026-10-14-conditional-row-seam-e8ba4eb0.md` and its `_v2` version contain the acceptance contract, implementation plan, QA ownership, traceability, and scope fences for this change.

## Verification

Run the focused DataTable test suite, then the related DataTable tests, typecheck, changed-test suite, and lint against the two changed TypeScript files. The plan also identifies the existing `AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` browser proof and a bounded rendered check: Companies at 1440px should show only the hairline when the table fits; a wide table at 1024px should show the gradient at scroll-left and remove it at the right end; the phone card branch should remain unchanged. Check both light and dark themes.
