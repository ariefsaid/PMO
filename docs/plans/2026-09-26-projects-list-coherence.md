# Design plan — Projects list coherence

**Date:** 2026-09-26  
**Status:** ready for implementation after owner sketch-glance  
**Spec:** [`docs/specs/projects-list-coherence.spec.md`](../specs/projects-list-coherence.spec.md)  
**Design authority:** [`DESIGN.md`](../../DESIGN.md), especially the ListPage shell, the content-over-containers rule, the shared focus contract, and the light/dark token pairs.  
**Product brief:** [`docs/design/2026-09-26-enterprise-coherence-brief.md`](../design/2026-09-26-enterprise-coherence-brief.md)

This plan improves the Projects index as an operator surface. It keeps the existing identity, project data, permissions, status URL values, analytics values, and desktop toolbar order. The work is structural and behavioral: the phone toolbar becomes progressive, filter choices become unambiguous, and the same project-manager meaning is used in the filter and the visible record.

## 1. Job and outcome

### Job story

When a RIS Admin or project manager reviews projects on a phone, they need to locate a project quickly and refine the list without traversing a desktop-sized control strip. When they filter by manager, every option and every result must say whether a project is assigned to a named person, an unnamed profile, or nobody.

### Success proof

- At the 390 viewport fixture, the first project follows a compact status/search/view area. Customer and project-manager filters are behind a control labelled **Filters**; export and both import actions are behind **More actions**.
- A selected customer or manager is visible as a removable applied-filter chip. **Clear all** removes search and secondary filters and returns the status segment to the viewer's role default (`My Projects` for Engineer, `All` for other roles).
- A blank or whitespace-only manager name is rendered as translated **Unnamed user** plus a short stable identifier when needed. A null manager is rendered as translated **Unassigned**. The two values are never represented by the same label or filter value.
- The 390 and 360 viewport no-bleed sweep stays green, and keyboard users can reach every visible control, open either disclosure, use its fields/actions, press Escape, and return focus to the trigger.
- At `md` and wider, the existing status/search/filter/export/import/view slots remain available in the existing order. No permission gate, write path, query, URL token, or analytics value changes.

## 2. Design direction and interaction model

### Identity and visual language

Preserve the **Quiet Control Surface**. The plan introduces no brand color, font, radius, spacing value, elevation style, or icon family. It uses the existing `ListPage`, `Toolbar`, `ViewToggle`, `SearchMini`, `SelectField`, `Button`, `ListState`, `DataTable`, and `Icon` contracts. The only new reusable molecule is a responsive disclosure for a list toolbar; it is made from existing primitives and tokens.

Use the existing `md` responsive boundary. Below `md`, render one mobile toolbar tree; at `md` and wider, render the current canonical toolbar tree. A single tree per viewport prevents duplicate selects, duplicate labels in the accessibility tree, stale IDs, and conflicting focus targets. The `DataTable` already uses the same single-render rule for its phone card branch.

### Mobile information architecture

1. Keep the status segment first. It remains horizontally scrollable inside its own bounded strip, so **At risk** is reachable without making the page itself pan.
2. Keep search next and give it the available row width. Search stays immediately findable because it is a primary find operation, not a secondary filter.
3. Keep the view switcher visible. The selected view must remain visible on a phone, including the existing **Table** choice, whose `DataTable` presentation already reflows to cards below `md`.
4. Render **Filters** only for roles that currently receive the customer and manager filters. Its count is the number of selected secondary filters, not the result count. The panel contains visible labels for Customer and Project manager, the current values, and any query loading/error helper state.
5. Render **More actions** when at least one export/import action is available. Its panel contains the existing export and import buttons in their current permission-gated form. It does not make a bulk action primary.
6. Render applied secondary-filter chips below the compact toolbar when a customer or manager is selected. Each chip has a visible label and a separate, labelled remove button. Render **Clear all** alongside the chips when any filter/search/status state is non-default; it is a neutral action.
7. Keep **New project** in the page header as the one primary action. Do not repeat it in either disclosure.

### Desktop information architecture

The desktop branch remains the current `ListPage` grammar:

`status filters → search → customer/manager filters → Export → Import/Import budgets → view switcher`

The existing controls keep their permission behavior and visual placement. The manager-label fallback and the `Unassigned` sentinel apply here as well, so the same data has the same meaning at every width.

### Disclosure behavior

`MobileToolbarDisclosure` is a non-modal, inline progressive disclosure:

- The trigger is a real button with an accessible name, `aria-expanded`, and `aria-controls`.
- The open panel is labelled by the trigger, stays inside the toolbar's width, and participates in normal document flow. It is not an absolutely positioned child of a scroll container.
- Opening moves focus to the first enabled control in the panel. Escape, outside pointer interaction, and an action that completes the panel's purpose close it and restore focus to the trigger.
- Tab follows the normal DOM order; the panel does not trap focus because it is not a modal task. Disabled/loading controls remain discoverable with their state and helper text.
- The panel uses the existing motion token only for a short expand/collapse transition and disables that transition under `prefers-reduced-motion`.

### Manager semantics

Use a distinct sentinel for no manager, such as `UNASSIGNED_PROJECT_MANAGER`, rather than overloading `All` or an empty string. The filter predicate must be explicit:

- `All` → do not restrict by manager;
- `UNASSIGNED_PROJECT_MANAGER` → `project_manager_id == null`;
- a profile ID → `project_manager_id === profileId`, including a profile whose display name is blank.

The display helper receives the profile name, the project manager ID, and translated `unassigned`/`unnamedUser` labels. It trims whitespace, never returns an empty string, and appends a stable short ID to the unnamed label when the ID is available. The helper is used for the manager filter options, table/card display, chip text, and the manager export value where the page currently exposes that value.

## 3. Component and token specification

Every visual decision below names the existing `DESIGN.md` token or component pattern. Do not add raw color, font, radius, spacing, shadow, or control-height values.

| Piece | Composition and states | `DESIGN.md` tokens/patterns |
|---|---|---|
| `ListPage` mobile branch | Optional `mobileToolbar` slot. When supplied, single-render it below `md`; otherwise preserve the current toolbar at every width. Keep the page header and body states unchanged. | ListPage shell; `colors.card`, `colors.border`, `colors.foreground`; `typography.page-title`, `typography.body`; `spacing.base`; `rounded.lg`. |
| Status filter strip | Existing `ViewToggle` labels and values. Bound the horizontal scroller to the toolbar width; preserve `FILTERS`, URL tokens, and analytics inputs. Keep arrow-key movement and selected state. | `components.button-ghost`, `colors.secondary`, `colors.foreground`, `colors.muted-foreground`, `colors.ring`; `rounded.lg`; `typography.body`; `motion.ds-ease`. |
| Search | Existing `SearchMini`, full available mobile width, no clipped right edge. Preserve debounce and result-count analytics. | `components.input`; `colors.background`, `colors.input`, `colors.foreground`, `colors.muted-foreground`, `colors.ring`; `rounded.lg`; `typography.body`; `spacing.base`. |
| Filters trigger | Neutral outline button labelled `Filters`; optional count uses a quiet badge, not action blue. | `components.button-outline`, `components.badge-status`; `colors.border`, `colors.foreground`, `colors.secondary`, `colors.muted-foreground`, `colors.ring`; `rounded.lg`/`rounded.full`; `typography.label`; `motion.ds-ease`. |
| Filters panel | Inline panel with visible Customer and Project manager labels, native `SelectField`s, current values, and query-source helper/error copy. | `components.card`, `components.input`; `colors.card`, `colors.card-foreground`, `colors.border`, `colors.input`, `colors.muted-foreground`, `colors.destructive-text`, `colors.ring`; `rounded.lg`; `spacing.base`; `typography.body`/`typography.label`. |
| More actions trigger/panel | Neutral outline trigger; existing Export/Import/Import budgets buttons stacked in a readable action group. The panel never uses the primary color for its trigger. | `components.button-outline`; existing `components.button-outline` for actions; `colors.card`, `colors.border`, `colors.foreground`, `colors.muted-foreground`, `colors.ring`; `rounded.lg`; `spacing.base`; `typography.body`; `motion.ds-ease`. |
| View switcher | Existing `ViewToggle`, including the selected Table/List view on mobile. No new view label or storage key. | Existing `ViewToggle` pattern; `components.button-ghost`; `colors.secondary`, `colors.background`, `colors.foreground`, `colors.muted-foreground`, `colors.ring`; `rounded.lg`; `typography.label`. |
| Applied-filter strip | Quiet status-style chips with text plus a labelled remove button. Add no saturated status color; the label carries meaning. | `components.badge-status`; `colors.secondary`, `colors.secondary-foreground`, `colors.muted-foreground`, `colors.ring`; `rounded.full`; `spacing.base`; `typography.label`; `Icon` monoline `x`. |
| Clear all | Ghost/outline neutral button, visible only when there is state to clear. | `components.button-ghost` or `components.button-outline`; `colors.foreground`, `colors.border`, `colors.ring`; `rounded.lg`; `typography.label`. |
| Project manager display | Existing row/card typography with a quiet initials marker. Stable IDs are machine identifiers only and use the mono token; names stay Inter. | `colors.secondary`, `colors.muted-foreground`, `colors.foreground`; `typography.body`, `typography.mono`; `rounded.full`; existing avatar categorical rule where an avatar solid is required. |
| Loading/error/empty bodies | Reuse existing `ListState`, including project-specific copy and retry/clear actions. Do not replace the skeleton with a spinner or create a second empty-state grammar. | Existing `ListState`; `colors.card`, `colors.muted-foreground`, `colors.destructive-text`, `colors.ring`; `components.card`; `motion.ds-ease` with reduced motion. |

### Copy and localization

Add matching English and Bahasa Indonesia keys for the new trigger, count, panel heading/helper, active-filter region, remove-filter labels, clear action, unnamed-user fallback, manager loading/error/empty helpers, and translated Export/Import labels used by the Projects surface. Use `t(key, default)` at the call site. Do not translate the persisted status filter values, URL values, analytics values, project status enum content, or machine IDs. The existing status-label localization decision remains out of scope.

## 4. State matrix

| Surface/state | Expected behavior | Proof owner |
|---|---|---|
| Projects query loading | Keep the page title, description, and permission-gated New project action. Use the existing stable `ListState` skeleton; do not render an incomplete toolbar. | Existing Projects loading render plus component regression. |
| Projects query error | Keep title/description/primary action. Show existing error state and retry. Do not show filter disclosures with stale/unknown rows. | Existing Projects error render plus retry assertion. |
| No projects | Keep the existing educational empty state and New project action. No Filters/More actions toolbar is needed because there is no list result to refine or export. | Existing Projects empty render. |
| Loaded list, no active filters | Mobile shows status/search/selected view, closed disclosures, and no applied-filter strip. Desktop retains the canonical toolbar. | `Projects.mobileToolbar.test.tsx`; existing Engineer/desktop tests. |
| Customer selected | Filters trigger reports count; chip names customer; removing it leaves manager/search/status untouched. | `Projects.mobileToolbar.test.tsx`. |
| Named manager selected | Same as customer; selection filters by profile ID. | `Projects.mobileToolbar.test.tsx`. |
| Unnamed assigned manager | Option and row show translated `Unnamed user` plus stable ID when needed. Selecting it returns that manager's projects. | `Projects.mobileToolbar.test.tsx`; `ProjectCard.test.tsx` if card display is exercised. |
| Unassigned project | Row/card displays translated `Unassigned`; sentinel filter returns only rows with null `project_manager_id`; it never matches an unnamed assigned profile. | `Projects.managerSemantics.test.tsx` or the mobile toolbar suite. |
| No matching rows after filtering | Keep the mobile controls and applied chips visible. Reuse the existing “No projects match these filters” state and Clear filters action; do not claim “No projects yet.” | Existing Projects empty-state assertions extended for secondary filters. |
| At-risk filter with no matches | Preserve the current “Nothing at risk” copy and no misleading create/clear action. The secondary chip behavior still works if customer/manager is also selected. | Existing `Projects.atRiskFilter.test.tsx` plus combined-filter case. |
| Manager/customer options loading | Keep `All` option usable, disable the affected select or show its helper state until options resolve, and avoid a blank option. | Mobile toolbar component test with pending query mocks. |
| Manager/customer options error | Keep the list usable; show an inline error with a retry action or retryable helper inside Filters. Do not silently render a blank selector. | Mobile toolbar component test with error query mocks. |
| Manager/customer options empty | Render the `All` option and a translated “no … available” helper. The panel remains keyboard reachable. | Mobile toolbar component test with empty query mocks. |
| More actions open | Export/Import/Import budgets remain permission-gated and retain their existing loading/disabled/wizard behavior. Closing the panel restores trigger focus. | Disclosure and Projects mobile tests. |
| Permission variants | Engineer keeps status/search/view and does not receive manager/customer filter controls; create/import actions remain governed by `usePermission`. Other roles preserve current controls. | Existing `Projects.engineerToolbar.test.tsx` plus mobile Engineer case. |
| Desktop at `md`+ | Current slot order, control labels, view choices, role gates, and row/card actions remain available. No second mobile copy is present in the DOM. | `ListPage.mobile.test.tsx`; desktop Projects regression. |
| English/Bahasa | All new UI copy, fallback labels, aria names, and helper/error states resolve in both catalogues. | Projects i18n component tests and `npm run check:i18n`. |
| Light/dark | The same semantic tokens remain readable in both themes; no literal colors or theme-specific layout branch is introduced. | Token/class assertions plus rendered Discover review at 390 and desktop. |

## 5. Accessibility and IxD acceptance

- Every disclosure trigger has a unique accessible name, `aria-expanded`, and `aria-controls`; the open panel has a programmatic label.
- Every select has a visible label in the mobile panel. `hideLabel` remains a desktop-only presentation detail; it must not remove the accessible name.
- Focus order is status → search → view → Filters (when permitted) → More actions. The primary New project action remains in the page-header path. Opening a panel focuses its first available control; Escape/outside close returns focus to the originating trigger.
- The selected status/view control exposes its selected state through the existing `ViewToggle` semantics. Arrow-key navigation and ordinary Tab activation remain usable; do not rely on hover or color alone.
- Filter chips expose text and a labelled remove button. The label itself distinguishes Customer, Manager, Unassigned, and Unnamed user; color is never the only state signal.
- The manager stable identifier is supplementary machine-readable text. It uses the mono token and is never the only name exposed to assistive technology.
- All icon-only controls use the existing `Icon` facade and an accessible label. No emoji, raw SVG family, or decorative icon is introduced.
- Use existing AA text/ring/status tokens in both themes. Keep visible focus through the global `colors.ring` focus contract. Run `axe` on closed/open Filters and More actions, with named selects and chips present.
- The panel transition is short, interruptible, and uses `motion.ds-ease`; `prefers-reduced-motion` removes the transition. No entrance choreography or layout animation is needed for a data list.
- The 390 and 360 browser checks prove the page itself does not pan horizontally. The status strip may scroll within its bounded container; the toolbar, disclosures, chips, and action buttons may not bleed or clip.

## 6. Implementation and proof tasks

Each task is intentionally small enough to complete in roughly 2–5 minutes once the previous task's contract is available. Tests are written before the corresponding implementation, following the project's TDD and AC traceability rules.

### Task 1 — lock the reusable disclosure contract (RED)

**AC coverage:** AC-PRJUX-003 and the focus parts of AC-PRJUX-001/002.

**Create** `pmo-portal/src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx`.

Cover the real interaction contract: closed trigger state, `aria-expanded`/`aria-controls`, open panel with first-control focus, Escape close with trigger-focus restoration, outside-pointer close with trigger-focus restoration, disabled first control fallback, and axe-clean closed/open states. Assert that the panel is a bounded inline region rather than an unlabelled hover-only menu. Do not use timer-only assertions for focus.

**Verify RED:**

```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx
```

### Task 2 — implement the disclosure primitive and export it

**AC coverage:** AC-PRJUX-003.

**Create** `pmo-portal/src/components/ui/MobileToolbarDisclosure.tsx`; **edit** `pmo-portal/src/components/ui/index.ts`.

Implement the controlled/uncontrolled trigger and inline panel using existing `Button`, `Icon`, `cn`, and focus conventions. The primitive owns Escape/outside handling and focus restoration but receives all visible copy from the caller. It must not add a new token, portal a panel into an overflow ancestor, or trap focus. Keep the default closed state stable across re-renders; reset to closed when its responsive branch unmounts.

**Verify GREEN:**

```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx
```

### Task 3 — lock the single-render ListPage mobile seam (RED)

**AC coverage:** AC-PRJUX-001 and AC-PRJUX-006.

**Create** `pmo-portal/src/components/ui/__tests__/ListPage.mobile.test.tsx`.

Stub `matchMedia` at the existing `md` boundary. With a `mobileToolbar` supplied, assert that the mobile node is present and the canonical desktop slot nodes are absent below `md`; at `md` and wider assert the inverse and retain the current fixed slot order. Assert that an ordinary ListPage with no mobile node retains its current behavior. Use `data-testid` only for structural proof, not for user-facing semantics.

**Verify RED:**

```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/ListPage.mobile.test.tsx
```

### Task 4 — implement the ListPage mobile slot without changing desktop consumers

**AC coverage:** AC-PRJUX-001 and AC-PRJUX-006.

**Edit** `pmo-portal/src/components/ui/ListPage.tsx`.

Add an optional `mobileToolbar` prop. Always call the existing `useIsDesktop` hook in the component, but select the mobile node only when it is provided and the viewport is below `md`; otherwise render the current toolbar markup byte-for-byte in structure and order. Keep the page header, banner, children, loading/error/empty behavior, and `list-page-toolbar` test id stable. Do not make other list pages opt in as part of this issue.

**Verify GREEN:**

```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/ListPage.test.tsx src/components/ui/__tests__/ListPage.mobile.test.tsx
```

### Task 5 — add manager-label semantics before wiring the page (RED)

**AC coverage:** AC-PRJUX-004 and AC-PRJUX-005.

**Create** `pmo-portal/src/lib/projects/projectManagerLabel.test.ts` and, if the pure helper is split from the page, `pmo-portal/src/lib/projects/projectManagerLabel.ts` as the implementation target for the next task. Add tests first for named, null, empty, whitespace, missing joined profile, multiple unnamed IDs, and the distinct unassigned sentinel. Add a Projects component test fixture with a blank assigned profile and a null-manager project; assert that the manager option remains selectable by ID and the two visible labels differ.

**Verify RED:**

```bash
cd pmo-portal && npx vitest run src/lib/projects/projectManagerLabel.test.ts pages/__tests__/Projects.managerSemantics.test.tsx
```

### Task 6 — implement manager options, row/card labels, and clear semantics

**AC coverage:** AC-PRJUX-002, AC-PRJUX-004, AC-PRJUX-005, AC-PRJUX-006.

**Edit** `pmo-portal/pages/Projects.tsx`; **edit** `pmo-portal/components/ProjectCard.tsx` only if the card branch consumes the shared display prop; **create/edit** the pure manager-label helper and its test path from Task 5.

- Add the translated unnamed-user fallback and the stable ID suffix; use `Unassigned` only when `project_manager_id` is null.
- Add the `UNASSIGNED_PROJECT_MANAGER` option and explicit predicate. Keep `All` and every real profile ID unchanged.
- Use the helper for PM filter options, table rows, card-view PM display, chip copy, and the page's manager export value. Do not change the database profile shape or invitation flow.
- Make `clearFilters` use `roleDefault`, while still clearing customer, manager, and search state. Preserve the existing URL filter tokens and analytics calls.
- Keep Engineer's current manager-filter omission and `My Projects` default.

**Verify GREEN:**

```bash
cd pmo-portal && npx vitest run src/lib/projects/projectManagerLabel.test.ts pages/__tests__/Projects.managerSemantics.test.tsx components/ProjectCard.test.tsx
```

### Task 7 — write the Projects mobile toolbar tests (RED)

**AC coverage:** AC-PRJUX-001, AC-PRJUX-002, AC-PRJUX-003, AC-PRJUX-006.

**Create** `pmo-portal/pages/__tests__/Projects.mobileToolbar.test.tsx`.

Use the existing Projects mock patterns from `Projects.engineerToolbar.test.tsx`, `Projects.mobileViewToggle.test.tsx`, and `Projects.atRiskFilter.test.tsx`. Add meaningful tests for:

1. 390 mobile composition: status, search, selected view, Filters, and More actions are reachable; desktop slot controls are not duplicated;
2. opening Filters exposes visible Customer/Project manager selects, reports the count, and keeps focus/keyboard paths correct;
3. selecting customer and manager renders removable chips; removing one leaves the other; Clear all restores `All` for a manager role and `My Projects` for Engineer while clearing search;
4. opening More actions exposes Export, Import, and Import budgets according to existing permission gates;
5. Escape and outside interaction close each disclosure and return focus to its trigger;
6. the Table view remains an available selected view on mobile, while Cards/Calendar/Board remain available;
7. blank assigned manager and null manager remain distinct in the list and filter; and
8. English and Bahasa render the new labels, fallback names, aria labels, and helper/error copy.

Use `axe` for the closed and open mobile toolbar states. Do not assert CSS layout through jsdom; leave measured no-bleed proof to the browser gate.

**Verify RED:**

```bash
cd pmo-portal && npx vitest run pages/__tests__/Projects.mobileToolbar.test.tsx
```

### Task 8 — compose the mobile toolbar and localize its copy (GREEN)

**AC coverage:** AC-PRJUX-001 through AC-PRJUX-006.

**Edit** `pmo-portal/pages/Projects.tsx`, `pmo-portal/public/locales/en/common.json`, and `pmo-portal/public/locales/id/common.json`.

Compose the `mobileToolbar` node from the existing status filter, `SearchMini`, `ViewToggle`, `MobileToolbarDisclosure`, `SelectField`, `ExportButton`, and `ImportButton`. Keep status/search/view visible in the compact row. Put secondary filters and actions in the named disclosures. Add applied chips and Clear all below the row. Render the Table view option on mobile; the existing `DataTable` determines the phone presentation.

Pass visible labels into shared Export/Import controls so the Projects surface can render them in Bahasa as well. If `ExportButton` needs a label prop, **edit** `pmo-portal/src/components/export/ExportButton.tsx` and its focused test without changing its default behavior for other consumers; do not move permission logic out of `ImportButton`.

Add translated keys for trigger labels, count, panel/region names, helper/error states, chip remove labels, clear all, unnamed user, and Projects action labels. Keep all status URL/analytics values in their current English token form. If a new helper component contains no user-facing literals, no launch-scope route change is needed; otherwise add it to the `/projects` line in `pmo-portal/src/lib/i18n/launch-scope-routes.txt`.

**Verify GREEN:**

```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx src/components/ui/__tests__/ListPage.test.tsx src/components/ui/__tests__/ListPage.mobile.test.tsx pages/__tests__/Projects.mobileToolbar.test.tsx pages/__tests__/Projects.managerSemantics.test.tsx pages/__tests__/Projects.engineerToolbar.test.tsx pages/__tests__/Projects.mobileViewToggle.test.tsx pages/__tests__/Projects.atRiskFilter.test.tsx components/ProjectCard.test.tsx && npm run check:i18n
```

### Task 9 — add the rendered phone/desktop proof and update deliberate view assertions

**AC coverage:** AC-PRJUX-001 and AC-PRJUX-006.

**Edit** `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` only if the Projects route is not already covered by the existing route list; otherwise add no duplicate journey. **Edit** `pmo-portal/pages/__tests__/Projects.mobileViewToggle.test.tsx` to replace the old intentional Table-hidden expectation with the new requirement that all view choices, including the selected Table view, are reachable below `md`. Keep the existing test IDs and view values where possible.

Add one curated Projects journey to the existing browser coverage only if the current route does not prove the goal: at a 390 viewport, sign in with the existing read-only seed, open Filters, choose a customer and manager, remove one chip, clear all, open More actions, and assert no page-level horizontal pan. Include a desktop assertion that the canonical toolbar controls remain present. Use the existing `@e2e-isolation` convention and do not create a second broad overflow sweep.

**Verify GREEN:**

```bash
cd pmo-portal && npm run e2e -- e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts
```

Run any new curated Projects journey through the appropriate locked/serial command from its isolation class. Do not add a skip or gate on `process.env.CI`.

### Task 10 — full review, verification, and handoff

**AC coverage:** all AC-PRJUX criteria.

1. Run the focused suite and i18n gate again.
2. Inspect the rendered Projects page in English and Bahasa at 390 and desktop widths, in light and dark themes, with rich data, no matches, blank manager names, and no manager assignments. The Discover pass must check first-record reachability, disclosure placement, focus restoration, copy clarity, and whether the list still reads as the same PMO surface.
3. Run the full local gate under the shared test lock:

   ```bash
   cd pmo-portal && npm run verify:locked
   ```

4. Run `git diff --check` and confirm only the planned UI primitive, Projects composition/semantics, optional shared Export label seam, locale catalogues, focused tests, and this plan/spec traceability are present. No source or tests are changed by this planning-only branch until implementation begins.

## 7. Expected implementation surface

Likely files for the implementation PR (the plan itself is the only file written in this planning task):

- `pmo-portal/src/components/ui/MobileToolbarDisclosure.tsx`
- `pmo-portal/src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx`
- `pmo-portal/src/components/ui/ListPage.tsx`
- `pmo-portal/src/components/ui/__tests__/ListPage.mobile.test.tsx`
- `pmo-portal/pages/Projects.tsx`
- `pmo-portal/pages/__tests__/Projects.mobileToolbar.test.tsx`
- `pmo-portal/pages/__tests__/Projects.managerSemantics.test.tsx`
- `pmo-portal/pages/__tests__/Projects.mobileViewToggle.test.tsx`
- `pmo-portal/src/lib/projects/projectManagerLabel.ts`
- `pmo-portal/src/lib/projects/projectManagerLabel.test.ts`
- `pmo-portal/components/ProjectCard.tsx` and `pmo-portal/components/ProjectCard.test.tsx` when card-view fallback is wired through the shared helper
- `pmo-portal/src/components/export/ExportButton.tsx` and its focused test only if the existing shared component needs a translated label prop
- `pmo-portal/public/locales/en/common.json`
- `pmo-portal/public/locales/id/common.json`
- `pmo-portal/src/lib/i18n/launch-scope-routes.txt` only if a new rendered component contains user-facing literals
- the existing overflow e2e spec only if its route list does not already provide the Projects proof

No migration, repository/DAL, auth, invitation, RLS, role policy, project status enum, URL token, analytics event, or production deployment change is part of this issue.

## 8. Open questions / owner decisions

There is one owner-visible choice before implementation: approve the Table view remaining visible on a phone. The current code hides that option below `md`, but the shared `DataTable` already renders a usable card representation there; keeping the selected view visible gives users truthful state and removes a blank selection affordance. The recommendation is **approve**.

The plan otherwise treats the spec's decisions as settled: Filters and More actions are separate, desktop slot order is preserved, blank assigned profiles remain selectable, and `Unassigned` is reserved for a null manager. No new token or design direction needs owner sign-off.
