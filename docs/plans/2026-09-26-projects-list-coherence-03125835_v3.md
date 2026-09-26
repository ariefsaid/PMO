# Projects list coherence — implementation plan

**Spec:** `docs/specs/projects-list-coherence.spec.md`  
**Design authority:** `DESIGN.md` ListPage grammar and `docs/plans/2026-09-26-projects-list-coherence.md`  
**Scope:** Projects list only. No schema, repository/DAL, auth/RLS, invitation, status-token, analytics-token, URL-token, shell, account-menu, or Administration change. No ADR: this is a reversible, local presentation and display-normalization change.

## Design and data flow

- Keep `ListPage`'s current desktop slots, order, and consumers intact. Add an opt-in `mobileToolbar` slot and use the existing `src/components/ui/useIsDesktop.ts` seam to single-render it below `md` (768px); at `md` and wider single-render the canonical desktop toolbar. Projects is the only adopter.
- Add a token-only inline `MobileToolbarDisclosure` primitive. It is a real button/labelled `region` in document flow, not a portal or absolute popover: `aria-expanded`/`aria-controls`, first enabled descendant focus on open, Escape and outside pointer-down close plus return focus to the trigger, panel-focus fallback if all descendants are disabled. It accepts controlled `open`/`onOpenChange` as well as default state, so Projects can close Filters after a selection and More actions after an action click.
- At phone widths, the Projects mobile node orders status (bounded horizontal scroller), `SearchMini`, the existing `ViewToggle`, non-Engineer `Filters`, permission-gated `More actions`, then active secondary-filter chips/Clear all. `New project` remains the sole header primary action. The Table option remains visible; `DataTable` already single-renders its card branch below `md`.
- Centralize PM display semantics in `src/lib/projects/projectManagerLabel.ts`. A non-null ID with blank/missing profile name is always `Unnamed user · <first 8 ID chars>`; a null ID is `Unassigned`; named values are trimmed. The unassigned filter is a non-ID sentinel (`UNASSIGNED_PROJECT_MANAGER`) and has its own explicit predicate. Apply that helper to table, Cards, Kanban, chips, and export so no visible Projects view reintroduces the ambiguity, while retaining ID-based selection and filtering.
- Keep derived filtering in `pages/Projects.tsx`: `All` bypasses PM filtering, the sentinel matches only `project_manager_id == null`, and a real ID matches equality. The page continues to use the existing one-batch delivery summary and never adds per-row queries. Secondary query state comes from the existing React Query results from `useClientCompanies` and `useProjectManagers`; loading, error/retry, and empty states are handled in the mobile Filters panel without changing the hooks.
- All new copy is passed through `t(key, fallback)` and added symmetrically to English and Bahasa catalogues. Persisted status values, URL `filter` values, analytics names, and profile IDs remain machine values.

## AC ownership

| AC | Owning proof | Supporting proof |
|---|---|---|
| AC-PRJUX-001 | `pmo-portal/pages/__tests__/Projects.mobileToolbar.test.tsx` | existing `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` at 390/360; rendered review |
| AC-PRJUX-002 | `pmo-portal/pages/__tests__/Projects.mobileToolbar.test.tsx` | existing no-match and Engineer-default suites |
| AC-PRJUX-003 | `pmo-portal/src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx` | Projects mobile integration test |
| AC-PRJUX-004 | `pmo-portal/pages/__tests__/Projects.managerSemantics.test.tsx` | `projectManagerLabel.test.ts`, `ProjectCard.test.tsx` |
| AC-PRJUX-005 | `pmo-portal/pages/__tests__/Projects.managerSemantics.test.tsx` | `projectManagerLabel.test.ts` |
| AC-PRJUX-006 | `pmo-portal/src/components/ui/__tests__/ListPage.mobile.test.tsx` | `Projects.engineerToolbar.test.tsx`, revised `Projects.mobileViewToggle.test.tsx`, desktop rendered review |

## TDD implementation tasks

### 1. Establish PM-label and sentinel contracts (RED)
**AC:** AC-PRJUX-004, AC-PRJUX-005.

Create `pmo-portal/src/lib/projects/projectManagerLabel.test.ts` and `pmo-portal/pages/__tests__/Projects.managerSemantics.test.tsx` before production changes.

- In the pure test, specify `projectManagerLabel({ managerId, fullName, unassignedLabel, unnamedUserLabel })` for a trimmed named value, null ID, empty/whitespace names, and a non-null ID whose joined profile is absent. Assert blank/missing names become `Unnamed user · <short ID>` and can never return an empty string; assert the exported `UNASSIGNED_PROJECT_MANAGER` is distinct from `All` and profile IDs.
- In the page test, seed a named manager project, an assigned project with a whitespace name, and a null-manager project. Assert the PM selector has a nonempty unnamed option; choosing its real ID returns only its project; choosing the sentinel returns only the null-manager project; table/card output uses distinct `Unnamed user` and `Unassigned` labels. Add the same display-polarity fixture to `components/ProjectKanbanBoard.test.tsx`, because Kanban is a visible Projects view. Name the owning page-test descriptions `AC-PRJUX-004` and `AC-PRJUX-005`.

Verify the intended failure:
```bash
cd pmo-portal && npx vitest run src/lib/projects/projectManagerLabel.test.ts pages/__tests__/Projects.managerSemantics.test.tsx
```

### 2. Implement PM display/filter semantics (GREEN)
**AC:** AC-PRJUX-004, AC-PRJUX-005, AC-PRJUX-006.

Create `pmo-portal/src/lib/projects/projectManagerLabel.ts`; edit `pmo-portal/pages/Projects.tsx`, `pmo-portal/components/ProjectCard.tsx`, `pmo-portal/components/ProjectCard.test.tsx`, `pmo-portal/components/ProjectKanbanBoard.tsx`, and `pmo-portal/components/ProjectKanbanBoard.test.tsx`.

- Export the unassigned sentinel and a pure helper that trims a supplied full name; returns the caller-supplied `unassignedLabel` only for `managerId === null`; otherwise returns the trimmed name or `unnamedUserLabel` plus the first eight stable ID characters. Do not accept an empty ID as unassigned.
- In `Projects.tsx`, construct PM options as All, sentinel/translated Unassigned, then real profile IDs labelled through the helper. Replace the PM filter expression with the three explicit branches above. Use the helper for table label, avatar initial, and `exportValue` so an assigned blank profile is neither blank nor exported as unassigned.
- In `ProjectCard.tsx` and `ProjectKanbanBoard.tsx`, use `useTranslation` and the same helper for each footer label and initial, passing the project manager ID rather than inferring assignment from `pm`. Preserve every existing card/board action, row drill, and status-control permission path.
- Retain `All`, real IDs, status URL values, and analytics values. Do not modify the profile query or project shape.

Verify:
```bash
cd pmo-portal && npx vitest run src/lib/projects/projectManagerLabel.test.ts pages/__tests__/Projects.managerSemantics.test.tsx components/ProjectCard.test.tsx components/ProjectKanbanBoard.test.tsx
```

### 3. Lock the reusable disclosure behaviour (RED)
**AC:** AC-PRJUX-003.

Create `pmo-portal/src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx`.

Test a real trigger plus native select/button children: closed/open `aria-expanded` and stable `aria-controls`; a labelled inline region; first enabled child focus on open; disabled-first-child skip; no-enabled-child panel-focus fallback; Escape and outside pointer-down close and restore trigger focus; normal Tab traversal without a focus trap; and axe-clean closed/open states. The owning test titles must contain `AC-PRJUX-003`.

Verify the intended failure:
```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx
```

### 4. Add the disclosure primitive and public export (GREEN)
**AC:** AC-PRJUX-003.

Create `pmo-portal/src/components/ui/MobileToolbarDisclosure.tsx`; edit `pmo-portal/src/components/ui/index.ts`.

- Implement `label`, `children`, optional controlled `open`/`onOpenChange`, optional `defaultOpen`, and optional `className`/`panelClassName` props around existing `Button`, `Icon`, `cn`, and `useId` conventions.
- Render a neutral outline trigger and a normal-flow `role="region"` panel with `w-full min-w-0 max-w-full`, border/card token classes, and an accessible relationship to the trigger. Do not portal, absolutely position, trap focus, introduce literals intended for callers, raw colors, or new design tokens.
- On open, focus the first enabled interactive descendant; if none exists, focus the panel (`tabIndex={-1}`). Register document `keydown` and `mousedown` only while open; Escape and external pointer-down call the same close path that focuses the trigger. Ensure trigger clicks are not treated as outside events and cleanup is complete.

Verify:
```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx
```

### 5. Establish the ListPage single-render responsive seam (RED)
**AC:** AC-PRJUX-001, AC-PRJUX-006.

Create `pmo-portal/src/components/ui/__tests__/ListPage.mobile.test.tsx`.

Stub `matchMedia('(min-width: 768px)')`. With ordinary desktop slots and a supplied `mobileToolbar`, assert below `md` only the mobile node is in the DOM and at `md`+ only the six current canonical slots are in the DOM in their current order. Assert the header primary action remains in both variants and a `ListPage` without `mobileToolbar` preserves the existing toolbar behavior. Use structural test IDs only; user-facing controls remain role/name assertions in Projects tests. Tag owning descriptions with the AC IDs.

Verify the intended failure:
```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/ListPage.test.tsx src/components/ui/__tests__/ListPage.mobile.test.tsx
```

### 6. Implement the opt-in ListPage mobile branch (GREEN)
**AC:** AC-PRJUX-001, AC-PRJUX-006.

Edit `pmo-portal/src/components/ui/ListPage.tsx`.

Add an optional `mobileToolbar?: React.ReactNode` prop and import/use `useIsDesktop` unconditionally. When that prop exists and the viewport is below `md`, render it as the sole `list-page-toolbar`; otherwise preserve the current `Toolbar` markup, fixed slot order, `list-page-toolbar`, and `list-page-view` hooks exactly. Keep banner/header/body and toolbar omission semantics unchanged for every other consumer.

Verify:
```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/ListPage.test.tsx src/components/ui/__tests__/ListPage.mobile.test.tsx
```

### 7. Specify the Projects mobile composition and regressions (RED)
**AC:** AC-PRJUX-001, AC-PRJUX-002, AC-PRJUX-003, AC-PRJUX-004, AC-PRJUX-005, AC-PRJUX-006.

Create `pmo-portal/pages/__tests__/Projects.mobileToolbar.test.tsx`; edit `pmo-portal/pages/__tests__/Projects.mobileViewToggle.test.tsx`, `pmo-portal/pages/Projects.test.tsx`, and `pmo-portal/pages/__tests__/Projects.engineerToolbar.test.tsx` before production changes. Keep the Kanban fallback assertion from Task 1 in `pmo-portal/components/ProjectKanbanBoard.test.tsx`.

Use a mutable `matchMedia` fixture at 390px plus existing Projects hook/role mock patterns. Add AC-tagged assertions for:

1. loaded PM/Admin mobile composition: status, search, selected view (including Table), Filters, and More actions are reachable; desktop secondary/export/import copies are absent;
2. Filters has visible Customer and Project manager labels, count equals selected secondary filters only, chips identify Customer/Manager and have named remove buttons, removing one retains the other, and Clear all clears search/customer/PM and restores `All` for PM/Admin or `My Projects` for Engineer;
3. open Filters/More actions supports keyboard activation, Escape/outside close with trigger focus restoration, and exposes only the existing permission-gated Export/Import/Import budgets buttons;
4. customer/manager query loading, error/retry, and empty options retain All/no blank option and expose translated helper/error copy; a no-match result retains toolbar/chips and the existing clear action;
5. loading/error/zero-project page states keep their existing ListState/New-project behaviour and render no incomplete mobile toolbar; and
6. English and Bahasa resolve every new visible/ARIA label and PM fallback.

Update the old mobile-view test from “Table hidden below md” to Table, Cards, Calendar, and Board all present and reachable below `md`; preserve the existing view values. Extend existing test setup only as needed for `isPending`, `isError`, and `refetch` on the two option queries. The new suite must fail because neither the mobile toolbar nor its disclosure composition exists yet.

Verify the intended failure:
```bash
cd pmo-portal && npx vitest run pages/__tests__/Projects.mobileToolbar.test.tsx pages/__tests__/Projects.mobileViewToggle.test.tsx pages/Projects.test.tsx pages/__tests__/Projects.engineerToolbar.test.tsx
```

### 8. Compose and localize the Projects mobile toolbar (GREEN)
**AC:** AC-PRJUX-001 through AC-PRJUX-006.

Edit `pmo-portal/pages/Projects.tsx`, `pmo-portal/src/components/export/ExportButton.tsx`, `pmo-portal/src/components/export/__tests__/ExportButton.test.tsx`, `pmo-portal/public/locales/en/common.json`, and `pmo-portal/public/locales/id/common.json`.

- Retain the existing desktop `filters`, `search`, `secondaryFilter`, `exportAction`, `importAction`, and `view` props unchanged in order. Pass a loaded-state-only `mobileToolbar` to `ListPage` that uses the same status callback/analytics, `SearchMini`, `ViewToggle`, filter option lists, row data, import descriptors, and permission-bearing Export/Import components.
- In the mobile node, bound the status scroller; put search and view in the compact toolbar; show Filters only to non-Engineers and More actions only when its existing children render. Put Customer and PM `SelectField`s in Filters with visible labels and full width. During loading, retain current All state with a translated loading helper; on error keep All plus a translated alert/retry button that calls the query refetch; on empty retain All with a translated no-options helper. Never render an empty option.
- Hold disclosure state in `Projects`: selecting a secondary filter closes Filters. Close More actions after Export dispatches, but **do not close or unmount More actions when an Import button opens its internally-owned wizard**; the disclosure must remain mounted for that wizard lifecycle. Build chips from selected customer/PM option labels, use named remove buttons, and make `clearFilters` set `filter` to `roleDefault` rather than literal `All` while clearing customer, PM, and search. Keep status URL and analytics inputs unchanged.
- Remove the Table option’s `wrapperClassName: 'hidden md:block'`; do not change `DataTable`.
- Add an optional `label` prop to `ExportButton`, defaulting to `Export`; use it for the Projects label while retaining default behavior and entity/filename inputs for every existing caller. Supply translated labels to both Import buttons too.
- Add matching nested `projects` locale keys for disclosures, count, panel/region labels, active-filter region, remove-filter aria text, clear action, loading/error/retry/empty option helpers, `unnamedUser`, and localized export/import labels. Preserve all existing keys and both JSON catalogues’ shape.

Verify:
```bash
cd pmo-portal && npx vitest run src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx src/components/ui/__tests__/ListPage.test.tsx src/components/ui/__tests__/ListPage.mobile.test.tsx src/lib/projects/projectManagerLabel.test.ts pages/__tests__/Projects.managerSemantics.test.tsx pages/__tests__/Projects.mobileToolbar.test.tsx pages/__tests__/Projects.mobileViewToggle.test.tsx pages/__tests__/Projects.engineerToolbar.test.tsx pages/Projects.test.tsx components/ProjectCard.test.tsx components/ProjectKanbanBoard.test.tsx src/components/export/__tests__/ExportButton.test.tsx && npm run check:i18n
```

### 9. Run the deterministic rendered layout proof without duplicating e2e coverage
**AC:** AC-PRJUX-001, AC-PRJUX-006.

Do not edit `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts`: it already includes `/projects`, carries the required `read-only` isolation tag, and measures both 390px and 360px with visible-element and root-scroll-width oracles. Run it under the shared DB lock and inspect its actual output body. Then render `/projects` with rich seeded data at 390px, 360px, and desktop in English/Bahasa and light/dark themes; inspect first-record reachability, bounded status scrolling, disclosures/chips/actions, no clipping, fallback distinction, desktop slot order, and focus restoration. Record and graduate any Discover finding before handoff; do not weaken an assertion or add a skip/CI gate.

Verify:
```bash
scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm run e2e:parallel -- e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts'
```

### 10. Full verification and scope review
**AC:** all AC-PRJUX criteria.

Under Node 22.23.2, rerun the focused unit/i18n command from Task 8, then run the complete gate under the shared test lock. Read the actual command output bodies; a command is not accepted solely because a wrapper/pipeline returned zero. Finally run whitespace and scope checks, stage only implementation-scope files, and self-review the diff for desktop grammar, token purity, translations, async states, permission gates, keyboard/focus restoration, and unmodified database/auth surfaces. Do not push or merge.

Verify:
```bash
cd pmo-portal && npm run verify:locked
cd .. && git diff --check && git diff --name-only
```

## Expected implementation surface

- `pmo-portal/src/components/ui/MobileToolbarDisclosure.tsx`
- `pmo-portal/src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx`
- `pmo-portal/src/components/ui/index.ts`
- `pmo-portal/src/components/ui/ListPage.tsx`
- `pmo-portal/src/components/ui/__tests__/ListPage.mobile.test.tsx`
- `pmo-portal/src/lib/projects/projectManagerLabel.ts`
- `pmo-portal/src/lib/projects/projectManagerLabel.test.ts`
- `pmo-portal/pages/Projects.tsx`
- `pmo-portal/pages/__tests__/Projects.managerSemantics.test.tsx`
- `pmo-portal/pages/__tests__/Projects.mobileToolbar.test.tsx`
- `pmo-portal/pages/__tests__/Projects.mobileViewToggle.test.tsx`
- `pmo-portal/pages/__tests__/Projects.engineerToolbar.test.tsx`
- `pmo-portal/pages/Projects.test.tsx`
- `pmo-portal/components/ProjectCard.tsx`
- `pmo-portal/components/ProjectCard.test.tsx`
- `pmo-portal/components/ProjectKanbanBoard.tsx`
- `pmo-portal/components/ProjectKanbanBoard.test.tsx`
- `pmo-portal/src/components/export/ExportButton.tsx`
- `pmo-portal/src/components/export/__tests__/ExportButton.test.tsx`
- `pmo-portal/public/locales/en/common.json`
- `pmo-portal/public/locales/id/common.json`

The existing overflow e2e and all migrations, Supabase policies, auth code, shared shell/account code, and Administration code remain untouched.
