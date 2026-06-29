# Spec: User-View Renderer, Route, and Dynamic Nav (Issue I3 — ADR-0036 §7)

> **Status:** Draft — 2026-06-29.
>
> Third build slice of **ADR-0036 §10.3** (the renderer-first build sequence). Conforms to house
> conventions (EARS + `FR-VR-`/`NFR-VR-`/`AC-VR-` ids; Given/When/Then; ADR-0010 test-pyramid
> traceability). Grounds: ADR-0036 §4c (spec renderer), §5 (declarative-artifact rule), §7
> (coexistence — built-in UI vs user-owned UI); ADR-0010 (test pyramid), ADR-0016 (real-JWT deputy
> model), ADR-0017 (repository seam), ADR-0018 (soft-archive), ADR-0030 (QA portfolio / axe-core
> a11y gate); DESIGN.md (token authority); I1 entity (`user_views`, `useUserViews`, `useUserView`,
> `src/lib/db/userViews.ts`); I2 trusted core (`src/lib/viewspec/{registry.ts,compiler.ts,types.ts}`).
>
> **Scope (locked, Director):** the read-only rendering surface only — the `<UserViewRenderer>`
> component (spec hydration, loading/empty/error/permission states), the `/views/:viewId` route in
> `App.tsx`, and the dynamic "My Views" / "Views" nav additions to `Rail` + `CommandPalette`.
> Everything is gated behind `FEATURES.userViews`.
>
> **Out of scope (later ADR-0036 issues — do NOT build here):** the manual view builder UI (I4);
> the agent spec-author (I5); `shared_roles` row-level enforcement (I6). No new migrations, no new
> pgTAP tests, no writes to `user_views`.

---

## 1. Context (AS-IS) and Scope

ADR-0036 §7 defines the coexistence contract between built-in PMO UI (static `<Route>`s in `App.tsx`,
`MODULES`/`ALL_ITEMS`) and user-owned UI (`user_views` rows). The contract is:

- **One static route**: `<Route path="/views/:viewId" …>` in `App.tsx`, rendering a generic
  `<UserViewRenderer>`.
- **One dynamic nav source**: `useUserViews()` appended to the `Rail`'s "My Views" group and a
  new "Views" group in the ⌘K `CommandPalette`, replacing no existing group.
- **Namespace isolation**: user views live **only** under `/views/*` and cannot shadow built-in
  routes (`/projects`, `/companies`, etc.) — separation is by URL prefix, not runtime conflict
  detection.
- **Same kit + tokens**: the renderer hydrates PMO's existing primitives (`DataTable`, `KPITile`,
  `StatTiles`, `Funnel`, `StatusBarChart`, `ProgressBar`, `Card`) using the `ChartFrame`/`DashGrid`
  composition pattern and `DESIGN.md` tokens, so user views are visually native.

The **deputy authorization model** (ADR-0036 §2 / §5 rule 2) governs all rendering:

> A shared view re-runs its queries under the **current viewer's JWT**, not the owner's. Queries are
> never cached rows — the `spec` stores queries, and each render re-executes them under the viewer's
> RLS-scoped Supabase client. Sharing can never leak rows from one user to another.

### What is already built (inputs to this issue)

| Layer | Location | Status |
|---|---|---|
| `user_views` table + RLS + pgTAP | `supabase/migrations/` | Shipped (I1) |
| `listUserViews`, `getUserView` | `src/lib/db/userViews.ts` | Shipped (I1) |
| `useUserViews()`, `useUserView(id)` | `src/hooks/useUserViews.ts` | Shipped (I1) |
| `repositories.userView` | `src/lib/repositories` | Shipped (I1) |
| `PrimitiveRegistry`, `validatePrimitive` | `src/lib/viewspec/registry.ts` | Shipped (I2) |
| `CompositionSpec`, `PanelSpec`, `QuerySpec`, `CompiledQuery` types | `src/lib/viewspec/types.ts` | Shipped (I2) |
| `compileQuerySpec(spec, ctx)` | `src/lib/viewspec/compiler.ts` | Shipped (I2) |
| `ChartFrame`, `DashGrid`, `DashPageHead` | `src/components/dashboard/layout.tsx` + `ChartFrame.tsx` | Shipped |
| `FeatureRoute`, `FEATURES`, `isFeatureEnabled` | `src/components/FeatureRoute.tsx`, `src/lib/features.ts` | Shipped |
| `Rail`, `ALL_ITEMS`, `GROUP_ORDER` | `src/components/shell/Rail.tsx` | Shipped |
| `CommandPalette`, `PaletteItem` | `src/components/shell/CommandPalette.tsx` | Shipped |
| `MODULES`, `modulesForRole` | `src/components/shell/routeMatch.ts` | Shipped |

### What this issue adds

1. **`FEATURES.userViews`** flag in `src/lib/features.ts` (initially `false` — UI-hide-first).
2. **`<UserViewRenderer>`** component at `pmo-portal/pages/UserViewRenderer.tsx` (or
   `src/components/UserViewRenderer.tsx` — implementer to choose; the plan fixes the path).
3. **`/views/:viewId`** route in `App.tsx`'s `AppRoutes`, wrapped in `<FeatureRoute>`.
4. **`compileCompositionSpec(spec, ctx)`** helper in `src/lib/viewspec/compiler.ts` (the per-panel
   wrapper over the existing `compileQuerySpec` that validates each panel's `primitive` via the
   registry before compiling its `querySpec`). This was deferred from I2 (FR-VC-051) and belongs here
   because I3 is the first consumer.
5. **`executeCompiledQuery(compiled)`** executor in a new `src/lib/viewspec/executor.ts` that calls
   the correct `repositories.*` method for a given `CompiledQuery`, applying in-memory
   aggregation/groupBy if requested (OD-3 from I2: aggregation is done client-side). This is the only
   place that calls into the repository seam on behalf of the renderer.
6. **Rail "My Views" group** — appended after the existing `GROUP_ORDER` groups in `Rail.tsx`, driven
   by `useUserViews()`. Never modifies `ALL_ITEMS` or `GROUP_ORDER` (additive only).
7. **CommandPalette "Views" group** — appended to `paletteItems` in `ShellChrome` (`App.tsx`) via
   `useUserViews()`, in a `'Views'` group distinct from `'Navigate'` and `'Records'`.

---

## 2. Goals

- **G-1** A `<UserViewRenderer>` that turns a `user_views` row's `spec` (validated as a
  `CompositionSpec`) into a live PMO page: each panel's `CompiledQuery` is executed under the current
  viewer's RLS-scoped client, and the result hydrates the matching kit primitive — using
  `ChartFrame`/`DashGrid` composition and `DESIGN.md` tokens.
- **G-2** All render states handled explicitly: page-level loading (row fetching), page-level error
  (fetch failed / spec invalid), page-level permission (row absent / RLS-scoped-out), page-level
  empty (spec has zero panels), and per-panel loading/empty/error states using `ChartFrame`.
- **G-3** A single `/views/:viewId` route that plugs `<UserViewRenderer>` into the app's existing
  shell, breadcrumb, and navigation — with the same `<Suspense>` / lazy-split pattern as all other
  pages.
- **G-4** Dynamic "My Views" rail group and "Views" ⌘K group, sourced from `useUserViews()`,
  coexisting with the static `MODULES`/`ALL_ITEMS` in their own namespace (no collision, no shadow).
- **G-5** The entire capability gated behind `FEATURES.userViews` (`false` by default): `Rail`
  filters the "My Views" group, `App.tsx` wraps the route in `<FeatureRoute feature="userViews">`,
  and `ShellChrome` omits the "Views" palette group when the feature is off.
- **G-6** Layer-1 RTL/Vitest tests covering all renderer component states + nav data-driving; an
  axe-core a11y test at the same layer; one curated Playwright e2e for the cross-stack ownership
  journey.

---

## 3. Functional requirements (EARS)

### 3.1 Feature flag

- **FR-VR-001** (ubiquitous) The system shall add `userViews: false` to the `FEATURES` object in
  `src/lib/features.ts`. The `FeatureKey` type union shall include `'userViews'` automatically
  (it is `keyof typeof FEATURES`). Flipping to `true` re-enables the entire I3 surface without any
  other code change.

### 3.2 `compileCompositionSpec` — per-panel wrapper (FR-VC-051 deferred from I2)

- **FR-VR-010** (ubiquitous) The system shall export a `compileCompositionSpec(spec: CompositionSpec,
  ctx: CompilerContext): CompiledPanel[]` function from `src/lib/viewspec/compiler.ts`, where
  `CompiledPanel` is:
  ```
  CompiledPanel {
    id:              string          // panel.id (stable, for React key)
    primitive:       string          // validated registry name
    compiledQuery:   CompiledQuery   // result of compileQuerySpec(panel.querySpec, ctx)
    layout?:         LayoutHint
    props?:          Record<string, unknown>
  }
  ```
- **FR-VR-011** (event-driven) When `compileCompositionSpec` processes a panel whose `primitive` is
  NOT in the `PrimitiveRegistry`, it shall throw `ValidationError({ code: 'UNKNOWN_PRIMITIVE',
  detail: panelId })`. It shall NOT skip the panel silently.
- **FR-VR-012** (event-driven) When `compileCompositionSpec` processes a panel whose `querySpec`
  fails `compileQuerySpec` validation, it shall re-throw the `ValidationError` (already typed with
  the originating error code and detail), with the `panelId` appended to the `detail` so the
  renderer can surface which panel failed.
- **FR-VR-013** (ubiquitous) `compileCompositionSpec` shall be a pure function (no side effects,
  no network calls). It validates all panels before returning; if any panel fails, it throws
  immediately (fail-fast, not accumulate-errors).
- **FR-VR-014** (ubiquitous) `CompositionSpec.version` shall be checked: if `spec.version !== 1`,
  `compileCompositionSpec` shall throw `ValidationError({ code: 'UNSUPPORTED_VERSION',
  detail: String(spec.version) })` before processing any panels.

### 3.3 `executeCompiledQuery` — executor

- **FR-VR-020** (ubiquitous) The system shall provide an `executeCompiledQuery(compiled:
  CompiledQuery): Promise<unknown[]>` function exported from `src/lib/viewspec/executor.ts`. It
  dispatches to the existing `repositories.*` methods (the same methods the existing DAL uses) based
  on `compiled.repositoryMethod`, passing any required parameters extracted from
  `compiled.resolvedFilters` (e.g. `project_id` eq-filter → `projectId` for `repositories.task.list`).
- **FR-VR-021** (ubiquitous) `executeCompiledQuery` shall use the **same RLS-scoped Supabase client**
  that the rest of the DAL uses (`src/lib/supabase/client`) — it shall NEVER import or reference the
  service-role key or any bypass-RLS path (ADR-0036 §2 / NFR-VR-SEC-001). The client's JWT is the
  current viewer's JWT; RLS scopes every row returned.
- **FR-VR-022** (ubiquitous) When `compiled.resolvedGroupBy` and/or `compiled.resolvedAggregate` are
  present, `executeCompiledQuery` shall apply the groupBy and aggregate **in-memory** on the full
  result returned by the repository method (OD-3 from I2: in-memory aggregation, with row cap ≤ 500
  bounding memory use). The aggregated result is returned as an array of plain objects.
- **FR-VR-023** (ubiquitous) `executeCompiledQuery` shall apply `compiled.resolvedFilters` as
  query-time PostgREST filters on the Supabase client call (e.g. `.eq('column', value)`, `.in(...)`,
  `.gte(...)`, `.lte(...)`, `.is(...)`) using only the operators in `VALID_FILTER_OPS`. It shall
  apply `compiled.limit` as `.limit(n)` when present. It shall apply `compiled.resolvedOrderBy` as
  `.order(column, { ascending: dir === 'asc' })` when present. It shall apply
  `compiled.resolvedSelect` as `.select(columns.join(','))` to restrict the returned columns.
- **FR-VR-024** (event-driven) When the Supabase client returns an error from the repository call,
  `executeCompiledQuery` shall throw an `AppError` (consistent with the repository seam contract,
  ADR-0017) so the renderer can classify it via `classifyMutationError` or show a per-panel error
  state.

### 3.4 `<UserViewRenderer>` component

- **FR-VR-030** (ubiquitous) The system shall provide a `<UserViewRenderer>` React component that
  accepts `{ viewId: string }` (extracted from the `:viewId` route param) and renders the full
  page content for a user view. It shall use `useUserView(viewId)` to fetch the `user_views` row
  (I1 hook; RLS-scoped — returns `null` when absent or unauthorized).
- **FR-VR-031** (state-driven) While `useUserView` is pending (the row has not yet resolved),
  `<UserViewRenderer>` shall render a **page-level skeleton** state (not a spinner) — a
  `DashPageHead` skeleton + one or more `ChartFrame state="loading"` placeholder panels — so the
  layout is stable and no content-layout-shift occurs on load.
- **FR-VR-032** (event-driven) When `useUserView` resolves with `null` (the row is absent or
  RLS-scoped out — i.e. the viewer has no read access under the `user_views` RLS policy), the
  renderer shall show a **not-found / no-access** state: a `ListState variant="empty"` (or
  equivalent empty-state component) with a message indicating the view was not found or the viewer
  does not have access. It shall NOT distinguish between "deleted" and "private to another user" (RLS
  makes them identical from the viewer's perspective). **[OWNER-DECISION OD-1: empty-state wording
  and whether to show a CTA — see §7]**.
- **FR-VR-033** (event-driven) When `useUserView` resolves with a row whose `archived_at` is
  non-null (the view is soft-archived), the renderer shall treat it as not-found (same state as
  FR-VR-032). Rationale: `listUserViews` already filters `archived_at is null`; `getUserView` by id
  may still return an archived row if the viewer fetches by UUID directly. The renderer must not
  silently render a stale archived spec.
- **FR-VR-034** (event-driven) When `useUserView` resolves with a row but the `spec` column fails
  `compileCompositionSpec` validation (i.e. the stored spec references an unknown primitive, a bad
  column, or an unsupported version), the renderer shall render a **spec-invalid** error state: a
  `ListState variant="error"` with a message indicating the view definition is invalid. It shall not
  silently skip bad panels or partially render. **[OWNER-DECISION OD-2: whether to show the
  `ValidationError.detail` in a dev/non-prod disclosure — see §7]**.
- **FR-VR-035** (event-driven) When the `spec` is valid and `compileCompositionSpec` succeeds but
  the `CompositionSpec.panels` array is empty (zero panels), the renderer shall render an
  **empty-spec** state: a page with the view's `name` as the heading, and a `ListState
  variant="empty"` with the message "This view has no panels yet." **[OWNER-DECISION OD-3: whether
  the empty-spec state includes a CTA to open the builder (I4) — see §7]**.
- **FR-VR-036** (state-driven) While data for an individual panel is fetching (per-panel query
  pending), the renderer shall render that panel's `ChartFrame` with `state="loading"` and the
  remaining panels in their own resolved states (panels fetch in parallel; one slow panel does not
  block others).
- **FR-VR-037** (state-driven) While a panel's data is resolved and the result set is empty (the
  repository call returned zero rows), the renderer shall render that panel's `ChartFrame` with
  `state="empty"` and `emptyTitle` sourced from the panel's `props.emptyTitle` if present, else
  `"No data"`.
- **FR-VR-038** (event-driven) When a panel's `executeCompiledQuery` call throws (the Supabase call
  returned an error), the renderer shall render that panel's `ChartFrame` with `state="error"` and
  offer a per-panel retry button. The error shall not bubble to the page-level error state.
- **FR-VR-039** (ubiquitous) For each compiled panel the renderer shall resolve the kit primitive
  from `registry.get(primitive)` and hydrate it with: (a) the data returned by
  `executeCompiledQuery` mapped to the primitive's `dataShape`, and (b) the panel's static `props`
  (validated against the primitive's `propSchema` — unknown props are silently ignored to avoid
  render failures on minor schema drift). Hydration is **additive and defensive**: if a required
  static prop (e.g. `KPITile.label`) is absent from `panel.props`, the renderer substitutes a
  sensible default (e.g. the panel `id` as the label) and does not throw.
- **FR-VR-040** (ubiquitous) The renderer shall lay out panels using `DashGrid` (the existing
  two-up dashboard grid from `src/components/dashboard/layout.tsx`) and, where `panel.layout` is
  present, apply the `colSpan`/`rowSpan` hints as inline CSS grid-column/row-span styles on the
  panel wrapper. The page heading uses `DashPageHead` with the view's `name` and, where present,
  its `description`.
- **FR-VR-041** (ubiquitous) The renderer shall use `useAuth()` to extract `{ currentUser }` and
  build the `CompilerContext` as `{ userId: currentUser.id, orgId: currentUser.org_id }` (no
  `teamId`/`projectId` unless the user's profile includes them). This `ctx` is the input to
  `compileCompositionSpec`. The compiler never receives the Supabase service key; RLS is the
  ceiling (ADR-0036 §2, NFR-VR-SEC-001).
- **FR-VR-042** (ubiquitous) Panel queries shall be executed in parallel using `Promise.all` (not
  sequentially), so a multi-panel view does not incur serial round-trips. Each panel manages its own
  loading/error state independently (e.g. via `useQuery` with a per-panel query key, or
  `Promise.allSettled` if per-panel errors are isolated without TanStack Query).
- **FR-VR-043** (ubiquitous) The `<UserViewRenderer>` shall be a lazy-imported chunk (React.lazy)
  in `App.tsx`, consistent with all other page components and the existing `<Suspense
  fallback={<LoadingFallback />}>` boundary.

### 3.5 `/views/:viewId` route

- **FR-VR-050** (ubiquitous) The system shall add a route `<Route path="/views/:viewId"
  element={<FeatureRoute feature="userViews" element={<UserViewRenderer />} />} />` to
  `AppRoutes` in `App.tsx`. This is the **only** route under `/views/`; there is no `/views` index
  route (a bare `/views` 404s via the existing `<Route path="*" element={<NotFoundPage />} />`).
- **FR-VR-051** (event-driven) When `FEATURES.userViews` is `false` (the default), navigating to
  `/views/:viewId` shall redirect to `/` (the root redirect behavior of `<FeatureRoute>`) — identical
  to how `/incidents` behaves today.
- **FR-VR-052** (ubiquitous) The `/views/:viewId` route shall coexist with all existing routes
  without collision. The `/views/` prefix is unoccupied in the current `AppRoutes`; no existing route
  matches `/views/*`. The implementer shall verify this at build time by confirming no `MODULES` entry
  has `path.startsWith('/views')` and no `ALL_ITEMS` entry has `to.startsWith('/views')`.
- **FR-VR-053** (ubiquitous) The `breadcrumbForPath` resolver in `routeMatch.ts` shall be extended
  to recognize `/views/:viewId` paths. The breadcrumb for a view detail shall be `[My Views (link to
  first user view list / home) > <view.name>]`. The `<view.name>` shall resolve from the same
  `useUserViews()` cache (no new query). The `recordLabelForPath` function shall be extended to
  handle the `/views/` prefix. **[OWNER-DECISION OD-4: what "My Views" links back to in the
  breadcrumb — see §7]**.

### 3.6 Dynamic "My Views" rail group

- **FR-VR-060** (ubiquitous) The system shall add a **"My Views" group** to `Rail.tsx`, rendered
  after the existing `GROUP_ORDER` groups. It is sourced from `useUserViews()` and appears only when
  `isFeatureEnabled('userViews')` is `true` AND the hook returns at least one view.
- **FR-VR-061** (ubiquitous) Each view in `useUserViews().data` shall appear as a nav link with:
  - `to`: `/views/${view.id}`
  - `text`: `view.name` (truncated to a single line with text-overflow: ellipsis)
  - `icon`: a generic `'grid'` icon (or a future icon slot in the view spec — see OD-5)
  - Standard `NAV_LINK_BASE` active/hover classes (identical to existing nav items)
- **FR-VR-062** (state-driven) While `useUserViews()` is pending or returns an empty array and the
  feature is on, the "My Views" group is **not rendered** (no skeleton, no empty placeholder in the
  nav). This avoids layout thrash on load. **[OWNER-DECISION OD-6: whether a loading skeleton for
  the nav group is desired — see §7]**.
- **FR-VR-063** (event-driven) When `useUserViews()` returns an error, the "My Views" group is
  **silently omitted** (no error banner in the rail). The nav must not break due to a secondary
  data-source failure.
- **FR-VR-064** (ubiquitous) **No collision with existing nav:** the `ALL_ITEMS` array and
  `GROUP_ORDER` are NOT modified. The "My Views" group uses a separate `group` value `'My Views'`
  that does not appear in `GROUP_ORDER`. It is rendered after the mapped `GROUP_ORDER` section,
  inside the same `<nav>` element. `isActive` matching for `/views/:viewId` routes is URL-prefix
  based (`to.startsWith('/views/')` matches the current path), not end-match.
- **FR-VR-065** (ubiquitous) The "My Views" group shall display at most **`MAX_NAV_VIEWS`** entries
  (proposed default: 8) in the rail, ordered by `updated_at desc` (the hook's natural sort). Entries
  beyond the cap are accessible via ⌘K. **[OWNER-DECISION OD-7: the cap value — see §7]**.

### 3.7 Dynamic "Views" CommandPalette group

- **FR-VR-070** (ubiquitous) The system shall add a `'Views'` group to the `paletteItems` array
  computed in `ShellChrome` (`App.tsx`), after the existing `'Navigate'` group. Each entry maps a
  `user_views` row to a `PaletteItem`:
  - `id`: `view-${view.id}`
  - `group`: `'Views'`
  - `title`: `view.name`
  - `sub`: `view.description ?? undefined`
  - `icon`: `'grid'`
  - `run`: `() => navigate('/views/${view.id}')`
- **FR-VR-071** (ubiquitous) The "Views" group shall be included only when
  `isFeatureEnabled('userViews')` is `true`. When the feature is off, `paletteItems` is unchanged.
- **FR-VR-072** (ubiquitous) The "Views" palette entries shall be present **regardless of whether
  the user is searching** (unlike the `'Records'` group, which is search-only). The `CommandPalette`
  component already handles groups whose items are always shown by not filtering them when `q === ''`
  — the `'Views'` group follows the same behavior as `'Navigate'`.
- **FR-VR-073** (event-driven) When `useUserViews()` is pending or returns an error, the "Views"
  group is **not added** to `paletteItems` (the `useMemo` that builds `paletteItems` guards on
  `data?.length > 0`). The palette continues to function with only the `'Navigate'` group.
- **FR-VR-074** (ubiquitous) The "Views" group shall NOT be limited to `MAX_NAV_VIEWS`; the full
  list is accessible in ⌘K (users can search to narrow). The existing `filterAndCap` behavior in
  `CommandPalette` caps results per group during search.

### 3.8 Namespace isolation (ADR-0036 §7)

- **FR-VR-080** (ubiquitous) User views shall ONLY be routable under the `/views/*` path prefix.
  No `user_views` row's `id` or `name` may be used as a route segment outside `/views/`. The
  renderer never accepts a route param other than `viewId`.
- **FR-VR-081** (ubiquitous) The `/views/*` prefix shall not shadow any route in `MODULES` or any
  `<Route>` in `AppRoutes`. Verified at build/typecheck time: no `ModuleDef.path` or `NavItem.to`
  starts with `/views`.
- **FR-VR-082** (ubiquitous) The `breadcrumbForPath` and `recordLabelForPath` functions in
  `routeMatch.ts` shall be extended with a `/views/` case that resolves the view's name from the
  `useUserViews()` cache, consistent with how `/companies/:id` resolves a company name. The
  `RecordLists` interface shall be extended with `userViews?: { id: string; name: string }[]`.

---

## 4. Non-functional requirements

### Security invariants (ADR-0036 §2 / §5 rules 1–3 — binding and testable)

- **NFR-VR-SEC-001** (re-execution under viewer JWT — the deputy model) The renderer shall NEVER
  use cached query results from the row owner's session. On every render of `/views/:viewId`, queries
  are **re-executed** via `executeCompiledQuery` under the **current viewer's JWT**. The Supabase
  client used is `src/lib/supabase/client` (the same RLS-scoped authenticated client the rest of the
  DAL uses). A shared view returns each viewer their own RLS-authorized data. This security property
  is testable: an AC-VR-### Playwright test asserts that a second user opening a shared view sees
  only their own org's data (AC-VR-020).
- **NFR-VR-SEC-002** (spec stores queries, not rows) The renderer shall never serialize or cache
  the **data rows** returned by panel queries into the `user_views.spec` column or into any
  client-side persistent store (localStorage, sessionStorage, IndexedDB). The `spec` stores only
  the declarative `CompositionSpec`; data is ephemeral per render.
- **NFR-VR-SEC-003** (no service-role path) `executeCompiledQuery` and `compileCompositionSpec`
  shall NOT import or reference `SUPABASE_SERVICE_ROLE_KEY`, a `bypassRls` flag, or any Supabase
  client other than `src/lib/supabase/client`. Verified by static import chain review (code-quality
  reviewer gate) — the import chain from `executor.ts` must not reach `service_role`.
- **NFR-VR-SEC-004** (spec validation before execution) The renderer shall ALWAYS call
  `compileCompositionSpec` (which validates primitives + queries via the whitelist) before calling
  `executeCompiledQuery`. A spec that fails compilation is rejected with an error state; no query
  is executed against an unvalidated spec.

### Accessibility (WCAG 2.1 AA — Layer-1 axe-core gate, ADR-0030 §C)

- **NFR-VR-A11Y-001** (WCAG 2.1 AA) The `<UserViewRenderer>` page and all panel states (loading,
  empty, error, ready) shall pass `axe-core` at zero violations. The axe test is a Vitest/RTL
  Layer-1 gate test (`pmo-portal/pages/UserViewRenderer.test.tsx`), run on every `npm run verify`.
- **NFR-VR-A11Y-002** (landmarks) The renderer shall render its panels within a `<main>` landmark
  (or inherit the existing shell's `<main>`). Panel headings (if any) shall use the correct heading
  level hierarchy (no heading rank skips).
- **NFR-VR-A11Y-003** (nav group) The "My Views" rail group shall render a group label (`<div
  role="group" aria-label="My Views">` or the existing overline pattern from `Rail.tsx`) so
  assistive technology announces the group name before the items. Active/inactive states shall be
  conveyed via `aria-current="page"` on the active link.
- **NFR-VR-A11Y-004** (empty and error states) Empty and error states shall include a non-decorative
  text label readable by screen readers (not icon-only). Retry buttons shall have accessible names.

### Namespace isolation (ADR-0036 §7)

- **NFR-VR-NS-001** (no shadow) No `user_views.id` (a UUID) can match a segment of any existing
  built-in route (the UUID format is disjoint from slugs like `projects`, `companies`, etc.). The
  `/views/` prefix isolates the namespace by construction.
- **NFR-VR-NS-002** (no `MODULES` modification) The `MODULES` array and `ALL_ITEMS` array shall NOT
  be modified. The "My Views" nav group and "Views" palette group are purely additive, driven by a
  separate hook and rendered outside the existing group loops.

### Performance

- **NFR-VR-PERF-001** Panel queries shall execute in parallel (`Promise.all` or independent
  `useQuery` hooks per panel), not serially. A view with N panels shall incur at most one
  round-trip latency, not N.
- **NFR-VR-PERF-002** The `useUserViews()` call in `ShellChrome` (for nav and palette) shall share
  the TanStack Query cache with the `useUserViews()` call in `<UserViewRenderer>` (same query key
  `['user_views', orgId]`). No duplicate fetch occurs when the renderer is mounted after the nav
  has already loaded the list.

### Layering

- **NFR-VR-LAYER-001** `executor.ts` shall import ONLY from: `src/lib/repositories` (the read
  methods), `src/lib/viewspec/types.ts` (for `CompiledQuery` types), and `src/lib/appError.ts`.
  It shall NOT import from pages, hooks, or route modules.
- **NFR-VR-LAYER-002** `<UserViewRenderer>` shall import ONLY from: `src/lib/viewspec/` (compiler,
  types, registry), `src/lib/viewspec/executor.ts`, `src/hooks/useUserViews.ts`,
  `src/auth/useAuth.ts`, `src/components/dashboard/` (ChartFrame, layout), `src/components/ui/`
  (ListState, Card), and `DESIGN.md` token classes. It shall NOT import from `src/lib/db/*` directly
  (ADR-0017: the DAL is consumed only through the hook / repository seam).

---

## 5. Acceptance criteria (Given/When/Then)

> **Test layer mapping (ADR-0010):**
> - **AC-VR-001..011** → **Vitest/RTL** unit tests (`pmo-portal/pages/UserViewRenderer.test.tsx`
>   or co-located with the component). All renderer states, nav data-driving, and the
>   `compileCompositionSpec` wrapper are unit-testable with mocked hooks/modules. No Docker, no
>   Playwright.
> - **AC-VR-012** → **Vitest axe-core** a11y gate (Layer-1, ADR-0030 §C), co-located or in the
>   same test file.
> - **AC-VR-013** → **Vitest** unit test for `compileCompositionSpec` and `executeCompiledQuery`
>   in `src/lib/viewspec/`.
> - **AC-VR-020** → **Playwright e2e** (`e2e/AC-VR-020-view-renderer-ownership.spec.ts`) — the one
>   curated cross-stack journey (real DB, two real sessions, `/views/:id` route). Runs in CI
>   `integration` (PR→`main`).
> - **No pgTAP** — RLS is already proven in I1; no new migration in I3.

---

### Renderer component states

- **AC-VR-001** — Page-level loading state renders a skeleton.
  **Given** `useUserView(viewId)` is in a pending (fetching) state,
  **When** `<UserViewRenderer viewId="abc">` is rendered,
  **Then** the component renders at least one `ChartFrame` in loading state (or an equivalent
  skeleton) and does NOT render any panel content or error UI. The page-level heading area is
  rendered as a skeleton placeholder (not blank). (FR-VR-031, NFR-VR-A11Y-001)

- **AC-VR-002** — Not-found / no-access state renders the empty guard.
  **Given** `useUserView(viewId)` resolves with `null` (row absent or RLS-scoped-out),
  **When** `<UserViewRenderer viewId="abc">` is rendered,
  **Then** a `ListState variant="empty"` (or equivalent) is shown with a message indicating the view
  was not found or is inaccessible. No panel content is rendered. No error is thrown to the error
  boundary. (FR-VR-032, NFR-VR-SEC-001)

- **AC-VR-003** — Archived view renders the not-found guard.
  **Given** `useUserView(viewId)` resolves with a row whose `archived_at` is a non-null timestamp,
  **When** `<UserViewRenderer viewId="abc">` is rendered,
  **Then** the same not-found / no-access state as AC-VR-002 is shown. The view is not rendered as
  live content. (FR-VR-033)

- **AC-VR-004** — Spec-invalid state renders the error guard.
  **Given** `useUserView(viewId)` resolves with a row whose `spec` contains an unknown primitive
  (e.g. `{ version: 1, panels: [{ id: 'p1', primitive: 'PieChart', querySpec: {...} }] }`),
  **When** `<UserViewRenderer viewId="abc">` is rendered,
  **Then** a `ListState variant="error"` is shown with a message indicating the view definition is
  invalid. No panel is partially rendered. (FR-VR-034, NFR-VR-SEC-004)

- **AC-VR-005** — Empty spec (zero panels) renders the empty-spec state.
  **Given** `useUserView(viewId)` resolves with a valid row whose `spec` is
  `{ version: 1, panels: [] }`,
  **When** `<UserViewRenderer viewId="abc">` is rendered,
  **Then** a page-level heading with the view's name is shown, and a `ListState variant="empty"`
  with the message "This view has no panels yet." (or owner-approved wording). No error is shown.
  (FR-VR-035)

- **AC-VR-006** — Valid spec with one `KPITile` panel: data hydrates the primitive.
  **Given** `useUserView(viewId)` resolves with a valid row whose `spec` is:
  ```json
  {
    "version": 1,
    "panels": [{
      "id": "p1",
      "primitive": "KPITile",
      "querySpec": { "entity": "projects", "select": ["contract_value"], "aggregate": { "fn": "sum", "column": "contract_value", "alias": "total" } },
      "props": { "icon": "doc", "tone": "blue", "label": "Total Contract Value" }
    }]
  }
  ```
  **and** `executeCompiledQuery` (mocked) returns `[{ total: 1234567 }]`,
  **When** `<UserViewRenderer viewId="abc">` is rendered and data resolves,
  **Then** a `KPITile` is rendered with `label="Total Contract Value"`, `tone="blue"`,
  and `value=1234567`. The `ChartFrame` is in `state="ready"`. (FR-VR-036, FR-VR-039, FR-VR-040)

- **AC-VR-007** — Per-panel loading state while data is fetching.
  **Given** a valid spec with one panel, **and** the panel's query is still pending (the mocked
  `executeCompiledQuery` has not yet resolved),
  **When** `<UserViewRenderer viewId="abc">` is rendered,
  **Then** that panel's `ChartFrame` is in `state="loading"`. The page heading IS rendered (the
  row has already resolved). (FR-VR-036)

- **AC-VR-008** — Per-panel error state when query fails, with retry.
  **Given** a valid spec with one panel, **and** `executeCompiledQuery` (mocked) rejects with an
  `AppError`,
  **When** `<UserViewRenderer viewId="abc">` is rendered and the query settles,
  **Then** that panel's `ChartFrame` is in `state="error"` and a retry button is present. The
  page-level state remains non-error (the page heading is still shown). (FR-VR-038)

- **AC-VR-009** — Per-panel empty state when query returns zero rows.
  **Given** a valid spec with one panel, **and** `executeCompiledQuery` (mocked) resolves with `[]`,
  **When** `<UserViewRenderer viewId="abc">` is rendered and the query settles,
  **Then** that panel's `ChartFrame` is in `state="empty"` with `emptyTitle="No data"` (or the
  panel's `props.emptyTitle` if supplied). (FR-VR-037)

- **AC-VR-010** — Multi-panel layout uses DashGrid; colSpan hint applies.
  **Given** a valid spec with two panels where the first has `layout: { colSpan: 2 }` and the second
  has no layout hint, **and** both `executeCompiledQuery` calls (mocked) return non-empty data,
  **When** `<UserViewRenderer viewId="abc">` is rendered,
  **Then** the panels are wrapped in a `DashGrid` container; the first panel wrapper has an inline
  style `grid-column: span 2` (or equivalent class); the second has no span override. (FR-VR-040)

- **AC-VR-011** — `compileCompositionSpec` validates primitives before compiling queries.
  **Given** a `CompositionSpec` whose first panel has `primitive: 'UnknownWidget'`,
  **When** `compileCompositionSpec(spec, ctx)` is called,
  **Then** it throws `ValidationError` with `code === 'UNKNOWN_PRIMITIVE'` and the `detail` contains
  the panel `id`. No `compileQuerySpec` call is made for that panel. (FR-VR-011)

  **And given** a `CompositionSpec` whose first panel has a valid primitive but an invalid querySpec
  (e.g. unknown entity),
  **When** `compileCompositionSpec(spec, ctx)` is called,
  **Then** it throws the `ValidationError` from `compileQuerySpec` (e.g. `UNKNOWN_ENTITY`), with the
  panel `id` appended to the `detail`. (FR-VR-012)

  **And given** a `CompositionSpec` with `version: 2`,
  **When** `compileCompositionSpec(spec, ctx)` is called,
  **Then** it throws `ValidationError` with `code === 'UNSUPPORTED_VERSION'`. (FR-VR-014)

- **AC-VR-012** — `<UserViewRenderer>` passes axe-core at zero violations in all states.
  **Given** the `<UserViewRenderer>` rendered via RTL in each of its four states: loading, not-found,
  error (spec-invalid), and ready (with a `KPITile` panel),
  **When** `axe(container)` is run in each state,
  **Then** each produces zero `critical` or `serious` violations (the Layer-1 a11y gate).
  Specifically: loading skeleton includes `aria-hidden` on decorative elements; not-found empty state
  has a descriptive text node; error state retry button has an accessible name; ready state KPITile
  panel heading and group label are present and correct. (NFR-VR-A11Y-001..004)

- **AC-VR-013** — `executeCompiledQuery` dispatches to the correct repository method and applies
  filters/limit/order.
  **Given** a `CompiledQuery` with `entity: 'companies'`, `repositoryMethod: 'company.list'`,
  `resolvedFilters: [{ column: 'type', op: 'eq', value: 'Client' }]`, `limit: 10`,
  `resolvedOrderBy: { column: 'name', dir: 'asc' }`, `resolvedSelect: ['id', 'name', 'type']`,
  **and** the `supabase` client is mocked to capture calls,
  **When** `executeCompiledQuery(compiled)` is called,
  **Then** the Supabase client is called with `.from('companies').select('id,name,type').eq('type',
  'Client').order('name', { ascending: true }).limit(10)` (or equivalent supabase-js chain). The
  returned rows are the mocked data rows. No SQL string is constructed. (FR-VR-020..023,
  NFR-VR-SEC-001, NFR-VR-SEC-003)

  **And given** the same query with `resolvedGroupBy: 'type'` and `resolvedAggregate: { fn: 'count',
  column: 'id', alias: 'cnt' }`,
  **When** `executeCompiledQuery(compiled)` is called and the mock returns
  `[{ id: 'x', name: 'Acme', type: 'Client' }, { id: 'y', name: 'Corp', type: 'Client' }]`,
  **Then** the returned array is `[{ type: 'Client', cnt: 2 }]` (in-memory group-by + count applied).
  (FR-VR-022)

### Nav integration

- **AC-VR-014** — Rail "My Views" group renders iff feature is on and views exist.
  **Given** `isFeatureEnabled('userViews')` returns `true` **and** `useUserViews()` (mocked)
  returns `[{ id: 'v1', name: 'My Dashboard', … }]`,
  **When** `<Rail />` is rendered,
  **Then** a "My Views" group heading is rendered with a nav link "My Dashboard" pointing to
  `/views/v1`.

  **And given** `isFeatureEnabled('userViews')` returns `false`,
  **When** `<Rail />` is rendered,
  **Then** no "My Views" group or `/views/*` link is rendered. (FR-VR-060, FR-VR-061, FR-VR-065)

- **AC-VR-015** — Rail "My Views" group is absent when no views exist or hook is pending.
  **Given** `isFeatureEnabled('userViews')` is `true` **but** `useUserViews()` returns `[]` (or is
  pending),
  **When** `<Rail />` is rendered,
  **Then** no "My Views" group heading or link appears. (FR-VR-062)

- **AC-VR-016** — ⌘K palette includes "Views" group iff feature is on and views exist.
  **Given** `isFeatureEnabled('userViews')` is `true` **and** `useUserViews()` (mocked) returns
  `[{ id: 'v1', name: 'Revenue View', description: 'Monthly revenue', … }]`,
  **When** the `paletteItems` memo in `ShellChrome` is computed,
  **Then** `paletteItems` contains an item with `group: 'Views'`, `id: 'view-v1'`,
  `title: 'Revenue View'`, `sub: 'Monthly revenue'`, and `run` navigates to `/views/v1`.

  **And given** `isFeatureEnabled('userViews')` is `false`,
  **Then** no item with `group: 'Views'` appears in `paletteItems`. (FR-VR-070, FR-VR-071)

- **AC-VR-017** — Nav entries do not shadow or modify existing `MODULES`/`ALL_ITEMS`.
  **Given** any state of `useUserViews()`,
  **When** `<Rail />` and `paletteItems` are computed,
  **Then** `MODULES` remains unmodified; `ALL_ITEMS` remains unmodified; no existing `group` in
  `CommandPalette` is replaced; the "Views" palette group appears as an additional group, never
  replacing `'Navigate'`. (NFR-VR-NS-002, FR-VR-064, FR-VR-080)

### Feature flag gating

- **AC-VR-018** — `/views/:viewId` route redirects to `/` when feature is off.
  **Given** `FEATURES.userViews = false`,
  **When** the user navigates to `/views/some-uuid`,
  **Then** the `<FeatureRoute>` redirects them to `/` (same behavior as `/incidents` when
  `FEATURES.incidents = false`). No `<UserViewRenderer>` is mounted. (FR-VR-050, FR-VR-051)

### Cross-stack ownership e2e (Playwright)

- **AC-VR-020** — A private view is accessible only to its owner; a second user cannot open it.
  **Given** user Alice has saved a `private` view "Alice's Dashboard" (`user_views` row, `scope =
  'private'`, `owner_id = Alice.uid`, `spec` is a valid `CompositionSpec` with one `KPITile` panel
  querying `projects`),
  **When** Alice navigates to `/views/<viewId>`,
  **Then** the page renders `<UserViewRenderer>` with the heading "Alice's Dashboard" and the
  `KPITile` panel is present and not in an error state (data fetched, zero or more rows returned
  from Alice's org's projects, no error).

  **And when** a different user Bob (same org, `scope = 'private'` does NOT include him) navigates
  to the same `/views/<viewId>`,
  **Then** `<UserViewRenderer>` renders the not-found / no-access state (FR-VR-032): Bob sees
  the "view not found or inaccessible" message, not Alice's data, not an app crash. Bob's own views
  are unaffected.

  **Test file:** `e2e/AC-VR-020-view-renderer-ownership.spec.ts`.
  **Owning layer:** Playwright e2e (runs in CI `integration` job on PR→`main`).
  **Note:** pgTAP already proves the RLS isolation (I1); this e2e proves the **renderer**
  correctly surfaces the RLS outcome to the user (the "what the user sees" cross-stack layer).
  (NFR-VR-SEC-001, FR-VR-032, ADR-0010)

---

## 6. Traceability

| AC | Requirement(s) | Owning layer | Planned test file |
|---|---|---|---|
| AC-VR-001 | FR-VR-031, NFR-VR-A11Y-001 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-002 | FR-VR-032, NFR-VR-SEC-001 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-003 | FR-VR-033 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-004 | FR-VR-034, NFR-VR-SEC-004 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-005 | FR-VR-035 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-006 | FR-VR-036, FR-VR-039, FR-VR-040 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-007 | FR-VR-036 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-008 | FR-VR-038 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-009 | FR-VR-037 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-010 | FR-VR-040 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-011 | FR-VR-011, FR-VR-012, FR-VR-014 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VR-012 | NFR-VR-A11Y-001..004 | Vitest/RTL + axe-core | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-013 | FR-VR-020..023, NFR-VR-SEC-001, NFR-VR-SEC-003 | Vitest | `pmo-portal/src/lib/viewspec/executor.test.ts` |
| AC-VR-014 | FR-VR-060, FR-VR-061, FR-VR-065 | Vitest/RTL | `pmo-portal/src/components/shell/Rail.test.tsx` |
| AC-VR-015 | FR-VR-062 | Vitest/RTL | `pmo-portal/src/components/shell/Rail.test.tsx` |
| AC-VR-016 | FR-VR-070, FR-VR-071 | Vitest/RTL | `pmo-portal/src/components/shell/ShellChrome.test.tsx` |
| AC-VR-017 | NFR-VR-NS-002, FR-VR-064, FR-VR-080 | Vitest/RTL | `pmo-portal/src/components/shell/Rail.test.tsx` |
| AC-VR-018 | FR-VR-050, FR-VR-051 | Vitest/RTL | `pmo-portal/pages/UserViewRenderer.test.tsx` |
| AC-VR-020 | NFR-VR-SEC-001, FR-VR-032, ADR-0010 | Playwright e2e | `pmo-portal/e2e/AC-VR-020-view-renderer-ownership.spec.ts` |

> **Traceability notes:**
> - FR-VR-001 (feature flag) is proven transitively by AC-VR-014, AC-VR-016, and AC-VR-018 (all
>   three test both `feature=true` and `feature=false` branches).
> - FR-VR-010 (`compileCompositionSpec` type / shape) is proven by AC-VR-011 (the compilation
>   paths) and AC-VR-006 (the renderer's successful consumption of a compiled panel).
> - FR-VR-013 (pure function) is not a separate AC — it is a pre-condition for AC-VR-011 being
>   runnable offline (`npm test`), verified by the absence of any I/O in the compiler module
>   (static review gate, code-quality-reviewer).
> - FR-VR-041 (`CompilerContext` from `useAuth`) is exercised by AC-VR-006 (the mock must supply
>   a user to compile the spec; the renderer extracts it from `useAuth`).
> - FR-VR-042 (parallel fetch) is exercised structurally by AC-VR-010 (multi-panel) and verified
>   as a design property by the code-quality reviewer.
> - FR-VR-043 (lazy import) is a `tsc`/build-time property, verified by `npm run build` in the
>   pre-push `verify` gate.
> - FR-VR-050..053 (route + breadcrumb) are covered by AC-VR-018 (route gating) and AC-VR-020
>   (the e2e navigates the real route). The breadcrumb extension (FR-VR-053, FR-VR-082) is
>   verified by a targeted RTL test in `routeMatch.test.ts` (implementer to add alongside the
>   `recordLabelForPath` change — no separate AC needed; it is a pure function with existing test
>   coverage to extend).
> - NFR-VR-SEC-002 (no rows in spec) and NFR-VR-SEC-003 (no service-role) are structural
>   properties verified by the code-quality-reviewer + security-auditor import-chain inspection at
>   the review gate — not by a runtime AC.
> - NFR-VR-NS-001 (UUID non-collision) is a structural property (UUIDs are disjoint from path
>   slugs by construction); verified by the code-quality reviewer.
> - NFR-VR-PERF-001/002 are design properties verified by code review (parallel fetch) and the
>   TanStack Query shared-cache behavior (no new query key introduced for the nav vs renderer).

---

## 7. Open questions / owner-decision flags

- **[OWNER-DECISION] OD-1 — Empty-state wording for not-found / no-access.**
  When a viewer opens `/views/:viewId` and the row is absent or RLS-scoped-out (i.e. the view is
  private to another user), the renderer shows a friendly message. Two options:
  (a) Generic: "This view was not found." (hides the privacy distinction entirely — recommended for
  parity with how `null` RLS results look in other modules; no information leakage).
  (b) Split: "View not found" vs "You don't have access to this view" (leaks that a view exists at
  that id to unauthorized users — NOT recommended).
  **Defaulting to: (a) — single generic "This view was not found." message.**
  Owner may also specify whether a CTA ("Go to Dashboard" or "Back to My Views") is shown here.
  **Defaulting to: show a "Go to Dashboard" link button (consistent with `NotFoundPage`).**

- **[OWNER-DECISION] OD-2 — Dev disclosure of `ValidationError.detail` for spec-invalid views.**
  When a view's stored spec fails `compileCompositionSpec`, the renderer shows a generic error
  message to the user ("This view's definition is invalid"). In dev/local environments, it may be
  useful to also show the `ValidationError.code` and `detail` (the failing primitive name or column)
  to aid the builder (I4) or agent (I5) in fixing the spec.
  **Defaulting to: in non-`production` environments, render the `ValidationError.code` + `detail`
  in a collapsible `<details>` below the main error message. In `production`, show the generic
  message only.** Owner to confirm.

- **[OWNER-DECISION] OD-3 — Empty-spec CTA.**
  When a view has `spec.panels = []`, the renderer shows "This view has no panels yet." Whether to
  also show a CTA to open the builder UI depends on whether the builder (I4) is available.
  **Defaulting to: no CTA in I3 (builder is not yet built); a `/* TODO I4: add CTA */` comment
  marks the spot. Owner to confirm; a CTA can be wired in I4.**

- **[OWNER-DECISION] OD-4 — Breadcrumb "parent" for `/views/:viewId`.**
  The breadcrumb for a user view should be `[<parent> > <view.name>]`. The parent could be:
  (a) "My Views" — a label only (no routable index for `/views`); links back to `/` (Dashboard).
  (b) "My Views" — links to a future `/views` index page (deferred, not in I3 scope).
  (c) No parent — a single `[<view.name>]` crumb (consistent with index pages like `/projects`).
  **Defaulting to: (a) — "My Views" label that links back to `/` (Dashboard); a simple, not-broken
  breadcrumb that signals context.** Owner to confirm; option (b) is trivial to wire in once a
  `/views` index route ships.

- **[OWNER-DECISION] OD-5 — Per-view icon slot.**
  The rail nav and ⌘K palette entries for user views use a generic `'grid'` icon. A future extension
  could add an `icon` field to `CompositionSpec` (or the `user_views` metadata) so different views
  can have different icons.
  **Defaulting to: `'grid'` icon for all user views in I3. A `spec.icon?: IconName` extension is
  deferred to I4.** Owner may override.

- **[OWNER-DECISION] OD-6 — Rail "My Views" group: loading skeleton.**
  When `useUserViews()` is pending (initial load), the rail "My Views" group is silent (not rendered,
  no skeleton). This avoids layout shift but means the section appears with a slight delay on first
  load. A skeleton (e.g. two gray lines in the nav) could preview the space.
  **Defaulting to: no skeleton — the group appears when data resolves.** Owner to confirm.

- **[OWNER-DECISION] OD-7 — Rail "My Views" nav cap.**
  The rail shows at most `MAX_NAV_VIEWS` (proposed: 8) entries. Views beyond the cap are accessible
  only via ⌘K.
  **Defaulting to: 8 entries.** Owner to confirm; implementer defines `MAX_NAV_VIEWS = 8` as a
  named constant in `Rail.tsx`.

- **[OWNER-DECISION] OD-8 — Whether nav shows archived views.**
  `useUserViews()` already filters `archived_at is null` in the DAL (FR-UV-009), so archived views
  never appear in the nav or ⌘K. This is the correct default.
  **Defaulting to: archived views are not shown in nav (no change needed).**
  Owner to confirm this is the desired behavior (an archive is a deliberate hide).

- **[OWNER-DECISION] OD-9 — Max panels per view (renderer guard).**
  The `CompositionSpec` has no panel count limit today. A malformed or agent-generated spec with
  hundreds of panels would issue hundreds of concurrent queries.
  **Defaulting to: the renderer validates `spec.panels.length ≤ 20` before calling
  `compileCompositionSpec`; if exceeded, it renders the spec-invalid error state with a message
  "This view exceeds the maximum of 20 panels." Owner to confirm the limit.**
  A `MAX_PANELS_PER_VIEW = 20` named constant in the renderer makes it a one-line change later.
