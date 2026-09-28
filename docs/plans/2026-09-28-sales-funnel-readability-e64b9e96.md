# Plan: Sales Pipeline funnel amount readability (#687)

**Binding scope:** `docs/specs/sales-funnel-amount-readability.spec.md` (FR-SFA-001..004; AC-SFA-001..004), `DESIGN.md`, and `docs/qa-portfolio.md`. `scripts/prior-art.sh funnel` exited 0; its five searched sources contain no competing ruling for this defect. This is a bounded shared-UI CSS/markup change: no ADR, dependency, data/API/schema/RLS/auth, money-formatting, locale-parser, filtering, Kanban-card, or `ProjectCardShell` change is warranted.

## Design

The defect is caused by the Sales Pipeline passing `min-w-[640px]` to a five-column `Funnel`: its 128px tracks retain only about 100px after the component's horizontal padding, while the exact representative amount requires about 117px. The correct boundary is the shared `Funnel`, because it is also rendered inside dashboard panels. Make the component own a `max-w-full min-w-0 overflow-x-auto` scroll viewport and render its stage grid inside it with `gridTemplateColumns: repeat(stageCount, minmax(10rem, 1fr))` and `min-w-full`. Thus every stage receives at least 160px (132px content after the existing 28px horizontal padding), a five-stage phone funnel scrolls locally at a minimum 800px grid width, and a wider Sales page retains the existing equal-width desktop presentation. A narrow dashboard host gets the same local scroll boundary rather than widening its panel or the page.

Keep the existing stage DOM behavior intact: `onClick`, Enter/Space `onKeyDown`, `selectedIndex`, `aria-pressed`, probability, weighted value, bar, and raw `s.value` rendering remain unchanged. Remove SalesPipeline's now-redundant outer scroller and `min-w-[640px]` override so there is exactly one scroll owner. Add stable, component-local `data-funnel-stage` and `data-funnel-stage-amount` hooks only for the browser containment oracle; they expose no application data not already rendered and let the test measure every stage independent of translated labels/currency symbols.

This is constant-size, CSS-only layout work: no query, cache, rerender loop, money calculation, parser, or network behavior changes. The `minmax` grid applies proportional excess space on desktop and a bounded per-stage floor in narrow containers, avoiding both digit overlap and page-width overflow.

## TDD implementation tasks

1. **Write the RTL behavior and local-scroll contracts before production code.**
   - **Files:** `pmo-portal/pages/__tests__/SalesPipeline.funnel.test.tsx`; `pmo-portal/src/components/ui/__tests__/composites.test.tsx`
   - In `SalesPipeline.funnel.test.tsx`, add three RTL `it(...)` cases whose titles begin respectively with `AC-SFA-002:` for click, Enter, and Space. Using the existing mocked five-stage Pipeline, target Tender's `[role="button"]`, assert its initial `aria-pressed="false"`, perform the named interaction, then assert `aria-pressed="true"` and that only `Tender Project Beta` remains while Leads, PQ, and Negotiation rows are absent. This proves the selected visual/semantic state agrees with the existing list filter for all three activation paths.
   - In the existing `describe('Funnel')` in `composites.test.tsx`, add an `it('AC-SFA-004: ...')` RTL layout-contract test that renders a long exact value such as `$1,234,567` in a narrow dashboard-host div. Assert the exact value is still rendered, the new Funnel scroll viewport has `data-testid="funnel-scroll-area"` plus `max-w-full`, `min-w-0`, and `overflow-x-auto`, and its child grid has `data-testid="funnel-stage-grid"`, `min-w-full`, and five `minmax(10rem, 1fr)` tracks. This is the component-level proof that a dashboard panel delegates overflow to one contained local viewport rather than shrinking/abbreviating the amount or widening its host.
   - **Red proof (before editing `Funnel.tsx` or `SalesPipeline.tsx`):** `cd pmo-portal && npm test -- pages/__tests__/SalesPipeline.funnel.test.tsx src/components/ui/__tests__/composites.test.tsx`. The new AC-SFA-004 contract must fail against the current single grid root; AC-SFA-002 is a preservation proof and may already be green because the shipped activation behavior is intentionally unchanged.

2. **Add the browser geometry regression before the layout implementation.**
   - **Files:** `pmo-portal/e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts`
   - Create a new spec because the existing `AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` is a route-wide bleed sweep, not a Sales-funnel amount-containment oracle, and no Sales Pipeline visual/geometry spec exists. Make line 1 exactly `// @e2e-isolation: read-only — reads the seeded Sales Pipeline and measures rendered boxes; no writes.`
   - Add `test('AC-SFA-001: ...')` that sets `390x844`, signs in with the existing read-only seeded user, navigates directly to `/sales`, and waits for `Pipeline summary` and exactly five `[data-funnel-stage]` cells. Require at least one `[data-funnel-stage-amount]` text value to have the formatted long-number shape (currency symbol plus a grouped thousands separator), so the geometry is exercised against a noncompact representative amount. For every stage, obtain the stage and its direct amount bounding boxes; require both boxes to be non-null and assert `amount.x >= stage.x - 1` and `amount.x + amount.width <= stage.x + stage.width + 1`, with messages naming the stage index and measured rectangles. Also assert `document.documentElement.scrollWidth <= 392` so the deliberate funnel scroller never becomes page overflow. Do not add any `process.env.CI` branch, skip, data mutation, or service-function dependency.
   - **Red proof (before production code):** `scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm exec playwright test -- --project=chromium e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts'`. It must fail initially because the measurement hooks/local layout contract do not yet exist; do not weaken the rectangle oracle.

3. **Implement the single local-scroll Funnel layout without changing stage semantics.**
   - **Files:** `pmo-portal/src/components/ui/Funnel.tsx`; `pmo-portal/pages/SalesPipeline.tsx`
   - In `Funnel.tsx`, make the component root the `data-testid="funnel-scroll-area"` local scroll viewport with `max-w-full min-w-0 overflow-x-auto` plus the caller's `className`. Move the existing grid and map inside it as `data-testid="funnel-stage-grid"`, with `grid min-w-full`, and change only its inline template to `repeat(${stages.length}, minmax(10rem, 1fr))`. Preserve all existing border, padding, selected styling, probability, weighted, bar, and keyboard/click code. Mark each existing stage element `data-funnel-stage` and its existing value div `data-funnel-stage-amount`; do not change `s.value` or use truncation, `whitespace-nowrap`, compact notation, or abbreviation.
   - In `SalesPipeline.tsx`, replace the current wrapper `<div className="overflow-x-auto">` and `<Funnel className="min-w-[640px]" ...>` with the direct existing `Funnel` invocation. Leave `aria-label="Pipeline summary"`, `stages`, `selectedIndex`, toggle callback, forecast total, and all filtering logic exactly as they are; the shared component is now the sole scroll area.
   - **Green proof:** `cd pmo-portal && npm test -- pages/__tests__/SalesPipeline.funnel.test.tsx src/components/ui/__tests__/composites.test.tsx`.

4. **Run the deterministic phone geometry and bounded static checks.**
   - **Files:** no additional files.
   - Run the new browser geometry proof under the shared DB lock, then the exact required static/component gates. If a test fails, correct only the Funnel/Sales CSS or test binding that caused it; do not change currency formatting, locale behavior, pipeline filtering, the test oracle, or test skips.
   - **Verify:** `scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm exec playwright test -- --project=chromium e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts'` followed by `cd pmo-portal && npm run typecheck && npm run lint:ci && npm test`.

5. **Complete AC-SFA-003 as the Director’s rendered-review matrix, not a synthetic unit test.**
   - **Files:** no tracked files; save review screenshots only under `adws/adw_data/sessions/e64b9e96/context_handoff/screenshots/`.
   - With the implemented local app and rich seeded Sales Pipeline, have the Director inspect `/sales` at `390x844` and desktop `1440x1000` in all eight combinations of English/Bahasa Indonesia × Light/Dark. For every state, verify the full noncompact stage amount, label, probability, and weighted value are legible; at phone width verify horizontal funnel scrolling exposes each stage without neighboring-value overlap; at desktop verify equal-stage presentation remains intact. Confirm one stage selection by click, Enter, and Space still visibly agrees with the filtered list. Do not fabricate AC-SFA-003 with RTL text/class assertions.
   - If Discover finds a real issue, stop acceptance, first add its failing focused regression at the lowest sufficient layer, fix it, and record the affected `/sales × {mobile@390, data-correctness, WCAG-AA, cross-screen consistency}` matrix cell plus its DESIGN.md/decision note as required by `docs/qa-portfolio.md`; rerender the affected matrix state. If clean, record the Director’s AC-SFA-003 result and the eight screenshot paths in the handoff.
   - **Verify:** all eight named review artifacts exist under `adws/adw_data/sessions/e64b9e96/context_handoff/screenshots/` and the Director records pass/fail for AC-SFA-003; this manual review is the owning proof.

6. **Run the full local gate and review the issue boundary.**
   - **Files:** no additional files.
   - Confirm the diff is limited to the two production files, the two RTL tests, the one read-only e2e spec, and this issue plan. Confirm no `package-lock.json`, `ProjectCardShell`, Kanban component, money/locale code, repository/DAL, migration, RLS, or dependency changed. Run the full locked verification after the targeted red-green loop; report actual exit status and stop on any red test rather than weakening/deleting/skipping it.
   - **Verify:** `cd pmo-portal && npm run verify:locked`.

## Acceptance traceability

| Acceptance criterion | Owning proof | Tasks |
|---|---|---|
| AC-SFA-001 | `pmo-portal/e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts` at 390px: every stage amount rectangle is contained by its stage and the page has no horizontal overflow | 2, 3, 4 |
| AC-SFA-002 | `pmo-portal/pages/__tests__/SalesPipeline.funnel.test.tsx`: click, Enter, and Space each synchronize `aria-pressed` with the filtered list | 1, 3, 4 |
| AC-SFA-003 | Director rendered-review matrix: `/sales` at phone/desktop, English/Bahasa Indonesia, Light/Dark | 5 |
| AC-SFA-004 | `pmo-portal/src/components/ui/__tests__/composites.test.tsx`: long dashboard-host value is exact and the shared Funnel owns a bounded local scroll viewport/minimum-track grid | 1, 3, 4 |

## Scope fences

- Keep exact `formatCurrency` output and the `FunnelStage.value` node intact; never compact, parse, recalculate, translate, truncate, or otherwise alter money values.
- Preserve five-stage ordering, selection toggle/filter behavior, `aria-pressed`, click, Enter, Space, probability, weighted value, and desktop equal-track appearance.
- The shared Funnel owns local horizontal scrolling so dashboard consumers are contained; do not add a second dashboard-specific implementation.
- Add no dependency, lockfile change, route, schema/migration, API, repository/DAL, RLS, auth/permission, cache, Kanban-card, or `ProjectCardShell` work.
