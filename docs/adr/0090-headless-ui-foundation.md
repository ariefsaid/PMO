# ADR-0090 — Base UI behind the existing PMO component facades

- **Status:** Proposed — decision deliverable for Director approval; no application migration in this change
- **Date:** 2026-10-19
- **Related:** ADR-0030 §F (buy the engine, build the skin), ADR-0010 (test ownership), ADR-0024 (Excel export), ADR-0068 (visual language), `DESIGN.md`
- **Inventory and rollout:** [`../plans/2026-10-19-library-adoption.md`](../plans/2026-10-19-library-adoption.md)

## Context

The owner asked which other hand-built generic components should have used a reliable library. The DataTable engine is being replaced with TanStack Table in a separate lane; this decision does **not** recommend or change tables.

The important duplication is not the number of `<div>`s. It is repeated browser-interaction machinery: focus entry/return, nested dismissal, tab stops, popup positioning, modal/background coordination, and notification timers. The existing public facades also encode valuable product contracts: dirty-discard confirmation, persistent save errors, async reference loading, phone sheets, persistent warning/error notifications, and route-preserving tabs. Replacing those facades wholesale would discard tested behavior.

The census inspected all 742 production TypeScript/TSX files in the five requested roots at `f72bb815877b8ae82943bcf62f58e261b174cb45`; the plan explains the denominator, grep counts, implementation families, and complete inline-site register. This was a static source/dependency audit plus the isolated dependency probes below, **not** a rendered WCAG certification or a live-data audit.

### A deciding fact: the foundation already exists in the dependency graph

`pmo-portal/package-lock.json` resolves:

```text
@blocknote/shadcn@0.54.0
  -> @base-ui/react@1.8.0  (declared range ^1.6.0)
       -> @base-ui/utils@0.4.0
       -> @floating-ui/react-dom@2.1.9
@floating-ui/react@0.27.20 is also locked
```

The installed `@blocknote/shadcn/package.json`, Base UI package exports, and lockfile agree. There is no locked Radix, React Aria Components, Ariakit, cmdk, dnd-kit, React Hook Form, or TanStack Virtual in this checkout. `npm ls` was run explicitly for those packages. It labels the Base UI/Floating UI packages **extraneous** in this worktree: `node_modules` is a symlink to the shared checkout, not a clean installation of this branch. That warning is not evidence that the lockfile lacks them. A Linux `npm ci` in the first migration is the reproducibility gate; do not run `npm install` into the shared symlink or regenerate this lockfile on macOS.

**Already installed does not mean zero added browser bytes.** An editor-only dependency can become an eager shell dependency; tree-shaking, lazy boundaries, and common-chunk extraction decide transfer size. Reuse avoids introducing a second primitive implementation, not necessarily a larger initial download.

## Decision

Choose **`@base-ui/react@1.8.0`**, MIT, as the single app-wide headless interaction foundation. Promote the already-locked version to an **exact direct dependency** in the first implementation PR. Do not opportunistically upgrade to 1.9.0 while changing behavior. Use public component subpaths, never `internals/*`.

Keep the current PMO facade names and props. Replace their generic engines in small slices:

| PMO facade / behavior | Foundation | Product behavior retained outside the engine |
|---|---|---|
| `ConfirmDialog` | `AlertDialog` for destructive; `Dialog` otherwise | Cancel-first focus, confirm-before-write, loading dismissal gate, mobile bottom-sheet skin, removed-opener fallback |
| `EntityFormModal` | `Dialog` | First-field focus, dirty discard, submit-only error-summary focus, persistent failed-save region, footer and scrolling |
| `Drawer`, preview, wizard and composer overlays | `Dialog`, styled as the current surface | Domain state, authorized URL accessor, import steps and committing lockout, keep-mounted companion state |
| `Combobox` | `Combobox` + `Positioner` + `Portal` | Existing `loadOptions`, stale-load suppression, selected label, empty/create/retry, clear and locale matching |
| Account/status action menus | `Menu` | Actions, navigation and confirmation semantics remain caller-owned |
| Notification inbox | `Popover` | Real paginated list, read-state behavior, retry; do not mislabel it as an action menu |
| `Tooltip` | `Tooltip` | Constant-dark tokens and rich, non-interactive explanation |
| `Tabs`; tab mode of `ViewToggle` | `Tabs` | Route-state marker, stable panel IDs, one active panel, mobile scrolling |
| Toggle mode of `ViewToggle` | Keep native pressed buttons | No tabpanel relationship may be invented |
| `Checkbox` and inline feature switch | `Checkbox`, `Switch` | Labels, tokens, disabled state and caller value callbacks |
| `ToastProvider` | `Toast` after a separate compatibility proof | Current queue/priority policy, persistent remedies, one visual toast, exact timing, modal-safe placement and live announcements |
| Command palette | `Dialog` + `Autocomplete` | Ranking, exact reference matching, caps, nav during fetch/error, retry, Ask AI fallback |
| Mention suggestions | `Autocomplete` only after multiline/caret pilot | Trailing-mention parser, plain text, five suggestions, mention cap; no editor rewrite |

`MobileToolbarDisclosure`, tax detail disclosure, and native `<details>` are **not popovers**. Keep their document-flow semantics. A simple browser disclosure is not a reason to add a dependency; the toolbar additionally owns sibling-click and child-dialog lifetime policy. Revisit its dismissal integration only after the modal engine pilot, without changing its placement or UX.

**Do not adopt** a second headless kit, cmdk, Floating UI as a new direct dependency, a date-picker kit, a form-state library, a drag-and-drop library, a CSV library, or a virtualizer in this decision. Installed dependencies and browser-native engines already cover much of the remaining inventory. Product-specific Gantt geometry stays owned per ADR-0030; Recharts, date-fns, Intl, ExcelJS, i18next and Zod remain the relevant engines.

### Component structure and data flow

Use current `src/components/ui/*` as the stable API seam. Introduce just `src/components/ui/OverlaySurface.tsx` for the shared **visual** shell (surface, backdrop, layer classes), not a second hand-built dialog state machine. Keep Dialog and AlertDialog wiring in their respective facades; do not create a universal abstraction that hides their different safety semantics. New exports from `ui/index.ts` are unnecessary unless a product caller actually needs them.

Import, for example, `Dialog` from `@base-ui/react/dialog`, `Menu` from `@base-ui/react/menu`, and `DirectionProvider` from `@base-ui/react/direction-provider`. Keep Tailwind v4 classes and existing tokens on the rendered parts. Use Base UI's `render` composition with the existing ref-forwarding Button rather than nesting buttons or changing button behavior. Wrap the app with a direction provider driven by the resolved interface direction; `en`/`id` remain LTR. RTL fixture coverage is a compatibility probe, **not** a new supported-language commitment.

```text
page / domain form -> current PMO facade -> Base UI interaction engine -> DOM
                   -> repository/query seam (unchanged)
```

No database, API, repository, cache, tenancy or `org_id` change. No migration, RLS change, or additional data request. Keep async source ownership in the caller/facade; a positioning library must not become an option-fetching framework. Preserve lazy ExcelJS and BlockNote loading. Millions of users primarily scale through existing server pagination/cache boundaries, not a more elaborate widget layer; do not fetch every record to make a picker look complete.

During mixed-engine rollout, there must be **one owner** of focus containment/dismissal for each migrated surface. Remove that facade's manual trap and document listeners rather than layering Base UI underneath them. Test a migrated confirmation above a legacy form before proceeding. Retain `backgroundInert.ts` until its existing observable contract is preserved for all callers; do not delete it merely because a vendor uses `aria-hidden` instead. Do not let vendor modal isolation silence the persistent toast live regions or disable the toast dismiss button.

## Alternatives evaluated

Registry metadata checked on 2026-10-19; versions below are comparison pins, not dependencies being added. Exact license/peer metadata is primary evidence; websites describe intended capabilities, not proof of app compatibility. Registry modification timestamps indicate recent publishing, not guaranteed support quality.

| Criterion | Base UI **1.8.0** (locked; latest 1.9.0) | React Aria Components **1.22.1** | Radix Primitives (`@radix-ui/react-dialog` **1.3.1**; umbrella `radix-ui` **1.8.1**) | Ariakit **0.4.42** |
|---|---|---|---|---|
| Accessibility model | Shared focus/dismissal/positioning; Dialog/AlertDialog, Menu, Combobox, Autocomplete, Toast, Tabs, Checkbox, Switch. Composition still needs tests | Broad collection/focus/i18n system; strongest fit if accessible calendar/range picker/number field and collection virtualization are central | Proven accessible dialog/menu/popover/tabs/check primitives; no first-party full searchable combobox/calendar engine in this comparison | Strong composable focus/composite/menu/combobox/dialog primitives; particularly good command/combobox work |
| Coverage of this audit | Covers all proposed migrations except multiline-mention fit remains a pilot; keeps native dates/disclosures | Covers proposed core and offers the broadest date/calendar/i18n surface; more adaptation of current facades | Covers overlays/menus/tabs/toasts; combobox/command would need another engine or owned composition | Covers core overlays/combobox/tabs/disclosure; toast/date surface is less unified than the selected set |
| React 19 | Explicit `^19` peers; local React 19 render/open/close probe passed | Published peer range includes `^19.0.0-rc.1` (semver also admits stable 19); not empirically rendered here | Explicit stable 19 peers; not empirically rendered here | Explicit stable 19 peers; not empirically rendered here |
| Tailwind v4 | Unstyled parts, state attributes/render composition; installed BlockNote integration uses it with Tailwind 4 | Unstyled/render-prop classes and data attributes; good fit, different collection API | Unstyled parts, `asChild`, data attributes; good fit | Unstyled parts/stores/render composition; good fit |
| Bundle | Existing graph; measured isolated engine envelope below. Subpath imports avoid unrelated exports | Tree-shakable, but a second shared interaction/i18n graph here; date adapters add cost when used | Small individual primitives; full feature set plus extra combobox engine can cost more than dialog-only numbers suggest | Tree-shakable; second interaction graph here; do not compare npm unpacked size to gzip |
| Maintenance signal | MIT; current registry release 2026-10-09; backed by an active component project; installed compatibility advantage | Apache-2.0; Adobe ecosystem; registry modified 2026-10-09 | MIT; registry updated 2026-10-14. ADR-0030's June concern about cadence is not proof of current inactivity | MIT; registry modified 2026-10-14; active specialist project |
| Decision | **Choose**; broad enough and already resolved, smallest architectural addition | **Reject for this rollout**, not on quality: comprehensive date/locale system is not needed while native dates and Intl suffice; reconsider if a signed calendar/range requirement warrants it | **Reject**: not actually installed by current BlockNote, narrower search coverage; no reason to add a parallel graph | **Reject**: technically credible, but no coverage gain sufficient to justify a second graph |

References: [Base UI components](https://base-ui.com/react/overview/about), [Base UI repository](https://github.com/mui/base-ui), [React Aria Components](https://react-spectrum.adobe.com/react-aria/components.html), [Radix Primitives](https://www.radix-ui.com/primitives), [Ariakit](https://ariakit.org/). Recheck registry/license/peer data on the implementation branch. No library promises that an incorrectly composed popup is accessible.

### Dependency probes and bundle estimate

Read-only probes ran against the installed dependency graph, without changing package files:

1. `npm ls @base-ui/react @floating-ui/react @floating-ui/react-dom @radix-ui/react-dialog react-aria-components @ariakit/react --all` and the additional inventory packages listed in the plan.
2. `npm view <comparison-package> version license peerDependencies time.modified --json`; `npm view @base-ui/react@1.8.0 version license peerDependencies --json` confirmed MIT and React 19 peers.
3. React 19 + JSDOM + RTL, constructed with `React.createElement`: render `Dialog.Root/Trigger/Portal/Backdrop/Popup/Title/Close`, click Open, assert named `role=dialog`, click Close, assert dialog removed and focus restored to Open. **Passed.** Checked installed namespaces for Dialog, AlertDialog, Combobox, Autocomplete, Menu, Toast and Tabs. This does not prove browser scrolling, native PDF focus, screen-reader behavior, or nesting.
4. In-memory Rolldown production minification, ESM, React/ReactDOM external, gzip via Node `zlib`, no output files: export all public parts from selected component subpaths. Dialog: **63,141 minified bytes / 21,150 gzip bytes**. Union of dialog, alert-dialog, combobox, menu, popover, tooltip, tabs, collapsible, checkbox, toast, autocomplete and toggle-group/switch: **274,150 / 88,047 bytes**. These deliberately retain every exported part, including parts the app may not use; they are envelopes, not a measured PMO route delta. The exact selected list was dialog, alert-dialog, combobox, menu, popover, tooltip, tabs, collapsible, checkbox, toast, autocomplete, toggle-group, switch.

Budget the first modal slice at **0–25 KiB additional initial gzip**, the full proposed foundation at **0–90 KiB additional initial gzip before deleting old engines**. These are conservative planning allowances, not promises of savings. Shared editor extraction may move bytes from a lazy chunk into initial load; removed application machinery may offset some cost. Do **not** add each primitive's separate bundle estimate together: shared modules deduplicate.

The first migration must compare the same Linux `vite build` baseline/head output, initial import closure and editor/route lazy chunks, with gzip totals and a duplicate-module check. A delta over 25 KiB for the first slice or over 90 KiB for the union requires Director review before merging; isolate non-shell widgets in route chunks before adding a second library. Preserve module identity across BlockNote and the shell so nested portals share a foundation instance. The simple probe above is enough to select a pilot, not enough to skip ADR-0030's browser/a11y/themeability acceptance gate.

## Consequences

**Benefits:** one maintained interaction graph; less duplicated trap/escape/positioning code; existing design tokens, domain forms and public APIs survive; a library already used by the editor becomes an explicit supported app dependency.

**Costs and risks:** meaningful eager-byte growth; mixed-engine nested overlays during rollout; focus/scroll restoration changes; screen-reader announcements and toast priority differences; native PDF frames; multiline textarea autocomplete fit; mobile virtual keyboard/visual viewport behavior; physical-left/right assumptions in current skins; route-backed tabs and hidden options. The adoption plan orders and tests these boundaries. Do not claim RTL/mobile correctness from the existence of a DirectionProvider or Positioner.

**Reversibility:** each PR replaces one engine behind an unchanged facade. Revert that PR to restore the old implementation; no data migration or feature flag needed. Do not retain two live implementations permanently. Leave the direct Base UI pin while other migrated facades use it. The final cleanup removes obsolete helpers only after a complete reference search and nested-overlay proof.

**Non-decisions:** no redesign, new business workflow, automatic form-library rewrite, numeric storage change, blanket date-math rewrite, new calendar requirement, blanket virtualization, or drag-and-drop feature. These require their own signed acceptance criteria. This ADR is an architectural recommendation, not owner sign-off on new product behavior.
