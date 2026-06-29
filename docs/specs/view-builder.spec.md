# Spec: View Builder UI (Issue I4 — manual view builder)

> **Status:** Draft (2026-06-29).
>
> Fourth build slice of **ADR-0036 §10.4** (the "renderer-first" build sequence). Grounds:
> ADR-0036 §4/§5/§6/§7/§10.4 (declarative-artifact rule, user_views, coexistence, build
> sequence); ADR-0037 (compiler DSL + `ENTITY_WHITELIST` + `ValidationError` taxonomy);
> ADR-0038 (executor + PostgREST dispatch); the I1 entity (`user_views` table + RLS + hook,
> `docs/specs/user-views.spec.md`); the I2 trusted core (`src/lib/viewspec/{types,registry,
> compiler}.ts`); the I3 renderer (`pages/UserViewRenderer.tsx`). Conforms to house conventions
> (EARS + `FR-VB-`/`NFR-VB-`/`AC-VB-` ids; Given/When/Then; ADR-0010 test-pyramid traceability;
> ADR-0016/0017/0018/0019 CRUD/RBAC patterns).
>
> **Scope (locked, Director):** A _manual_ view builder — a dedicated browser-side page where a
> user names a view, adds/reorders/removes panels (each panel = one registry primitive + one
> whitelisted `QuerySpec`), previews the live-rendered composition via `<UserViewRenderer>`,
> and saves/updates to `user_views` via `useUserViewMutations`. The "My Views" management list
> (open / edit / archive own views) is part of this issue. The **agent spec-author (I5) is out
> of scope**.
>
> **Out of scope:** Agent composition (I5); `scope='shared_roles'` row-level enforcement (I6);
> Storybook entries for new builder components (Phase 3); promoting a user view to a coded module.

---

## Lens-D job story (for `docs/jtbd.md` — note here; do not edit `jtbd.md` in this issue)

> **When** I need a custom summary of my project data that the built-in dashboards don't cover,
> **I want to** compose a view by picking primitives from the kit and pointing each one at the
> data I care about — without writing code —
> **so I can** open it from the sidebar the next day and instantly see my data, visually
> consistent with the rest of the app.

---

## 1. Context (AS-IS) and Scope

Issues I1–I3 shipped: the `user_views` persistence layer, the query-spec compiler/DSL trusted
core, and the `<UserViewRenderer>` at `/views/:viewId`. The renderer proves the composition
end-to-end: a `CompositionSpec` stored as `user_views.spec (jsonb)` is compiled and hydrated
into live primitives. What does **not** exist yet is any UI for a human to _author_ that spec.

The manual builder (I4) closes that gap. It is the first consumer that exercises the full stack —
it writes via `useUserViewMutations`, reads back via `useUserViews`/`useUserView`, previews via
`<UserViewRenderer>`, and validates via `compileCompositionSpec` — before any agent involvement
(I5). It also ships real user value: non-technical users can compose dashboards without waiting
for an agent runtime.

The builder must:
1. Stay within the declarative-artifact rule (ADR-0036 §5): it authors `QuerySpec`s, never raw
   SQL or JSX code.
2. Be whitelist-constrained: the form can only express queries that `compileCompositionSpec`
   would accept. An off-whitelist query is _impossible to construct_ via the UI (the form
   dynamically constrains options to `ENTITY_WHITELIST`), not merely rejected after the fact.
3. Validate via `compileCompositionSpec` before every save — a spec that fails validation
   cannot be saved.
4. Reuse I3's `<UserViewRenderer>` for live preview, providing a real preview under the
   current user's JWT → RLS.
5. Follow the Companies slice CRUD/RBAC pattern (`pages/Companies.tsx`) for the management
   list and form primitives.

## 2. Route decision

**Decision: two dedicated routes — `/views/new` (create) and `/views/:viewId/edit` (edit),
both behind `FEATURES.userViews`.**

**Rationale over alternatives:**

- **Alternative A — a "builder mode" on `/views/:viewId`** (a toggle on the renderer page).
  Rejected: it conflates the viewer and the author state machines into one component, which
  already has a complex state machine (loading / not-found / archived / spec-invalid / empty /
  per-panel). The builder has its own multi-step state (no-panels / panel-configuring /
  invalid-panel / save-in-flight / save-error / success). Merging them creates a large,
  hard-to-test blob. Separation keeps I3 `UserViewRenderer` read-only and stable.

- **Alternative B — an inline slide-over / drawer** attached to the "My Views" list.
  Rejected: the builder needs significant vertical space for the panel editor (entity dropdown,
  column pickers, filter rows) plus a side-by-side or stacked live preview; a slide-over is too
  narrow for both. A dedicated route gives full viewport width.

- **Chosen: `/views/new` + `/views/:viewId/edit`**. The pattern is idiomatic for the
  React Router 7 SPA and is consistent with how edit forms are expressed elsewhere in the app
  (e.g. project/task detail routes). The "My Views" management page lives at `/views`
  (a new route, not a dynamic `/views/:viewId` collision — `/views/new` and `/views/edit` are
  matched before the `:viewId` param). All three routes are behind `FEATURES.userViews`
  (`<FeatureRoute>`). Navigation entry point is the existing "My Views" dynamic Rail group
  (already wired in I3 via `useUserViews()`).

**Route table:**

| Route | Component | Purpose |
|---|---|---|
| `/views` | `<MyViewsPage>` | List own views; open / new / archive affordances |
| `/views/new` | `<ViewBuilderPage>` | Create a new view |
| `/views/:viewId/edit` | `<ViewBuilderPage>` | Edit an existing view's spec |
| `/views/:viewId` | `<UserViewRenderer>` (I3) | Read-only render (unchanged) |

All four are behind the same `FEATURES.userViews` flag.

**[OWNER-DECISION OD-VB-1] Route placement of "My Views".** This spec introduces `/views` as
the management list. If the owner prefers the list at `/my-views` or embedded in the Shell's
Rail without a dedicated route, the route can be changed; the builder routes `/views/new` and
`/views/:viewId/edit` are independent. **Default: `/views`.**

---

## 3. Goals

- **G-1** A human user can compose a multi-panel view using only the registry's 7 primitives
  and the `ENTITY_WHITELIST`'s 6 entities — entirely through form controls; no JSON editing.
- **G-2** The builder validates the full `CompositionSpec` via `compileCompositionSpec` before
  every save; a failing spec cannot reach `useUserViewMutations.create/update`.
- **G-3** A live preview using `<UserViewRenderer>` (I3) is embedded in the builder and
  refreshes whenever a panel is added, edited, or reordered — under the current user's JWT.
- **G-4** The "My Views" page lists the user's non-archived views (owner-RLS scoped via
  `useUserViews()`); each row has open / edit / archive affordances; archive is confirmed via
  `ConfirmDialog`.
- **G-5** The builder reuses all shared primitives: `EntityFormModal` / `useEntityForm` /
  `TextField` / `SelectField` / `Combobox` / `FormGrid` / `FieldError` / `ConfirmDialog` /
  `classifyMutationError` / `DESIGN.md` tokens.
- **G-6** Authorization: any authenticated user with the `FEATURES.userViews` flag can create
  and edit their own views. `can()` gates the archive affordance (`can('archive', 'userView')`);
  the write affordances follow the Companies slice pattern.
- **G-7** The builder's query-spec form dynamically derives available options from
  `ENTITY_WHITELIST` for the selected entity — it is **impossible** to construct an
  off-whitelist `QuerySpec` via the UI.
- **G-8** `org_id` and `user_id` are never sent by the builder; they are stamped server-side
  by the RLS column defaults (FR-UV-003 / I1).

---

## 4. Functional requirements (EARS)

### 4.1 Route + feature gate

- **FR-VB-001** (conditional) Where `FEATURES.userViews` is enabled, the system shall expose
  three routes: `/views` (My Views list), `/views/new` (create builder), and
  `/views/:viewId/edit` (edit builder), each rendered via a `<FeatureRoute>` wrapper consistent
  with the `/views/:viewId` pattern in I3.

- **FR-VB-002** (conditional) Where `FEATURES.userViews` is disabled, navigating to any of the
  three routes defined in FR-VB-001 shall render the same feature-disabled surface used by I3
  (not a 404 or blank page).

### 4.2 My Views list (`/views`)

- **FR-VB-010** (ubiquitous) The "My Views" page shall display the current user's non-archived
  views (from `useUserViews()`, which applies owner-RLS; shared-org views visible to the user
  are also included per I1 FR-UV-005) ordered by `updated_at desc`.

- **FR-VB-011** (state-driven) While `useUserViews()` is loading, the page shall render a
  loading skeleton consistent with the `DataTable` `state="loading"` pattern.

- **FR-VB-012** (state-driven) While the list is empty (no non-archived visible views), the
  page shall render an empty state (`ListState variant="empty"`) with a primary CTA: "Create
  your first view" navigating to `/views/new`.

- **FR-VB-013** (ubiquitous) Each view in the list shall expose: a linked name (navigates to
  `/views/:viewId`), a description (if present), the `updated_at` timestamp (human-friendly,
  e.g. "3 days ago"), and a row action menu with "Edit" (navigates to `/views/:viewId/edit`)
  and "Archive" (triggers archive confirm).

- **FR-VB-014** (ubiquitous) The page shall show a "New View" primary button in the page
  header; clicking it navigates to `/views/new`.

- **FR-VB-015** (event-driven) When the user initiates an archive action on a view, the system
  shall present a `ConfirmDialog` ("Archive this view?", tone="destructive", confirm="Archive",
  cancel="Keep") before calling `useUserViewMutations().archive`.

- **FR-VB-016** (event-driven) When `archive.mutateAsync` resolves, the system shall show a
  success toast ("View archived", `view.name`, "success") and dismiss the confirm; on error, it
  shall show a warning toast via `classifyMutationError`.

### 4.3 Builder surface — view metadata

- **FR-VB-020** (ubiquitous) The `<ViewBuilderPage>` shall render a two-section layout: a
  **metadata panel** (name, description, scope) and a **panel-editor section** (add/list/remove
  panels + live preview).

- **FR-VB-021** (ubiquitous) The view name field shall be required (`TextField`, label "View
  name", maxLength=120, `aria-required="true"`); description is optional (`TextField` multiline,
  label "Description").

- **FR-VB-022** (ubiquitous) The scope field shall be a `SelectField` with options `'private'`
  (label "Private — only you") and `'shared_org'` (label "Shared with your organisation");
  `'shared_roles'` is stored but **not** offered in the form UI (its enforcement is deferred to
  I6). Default: `'private'`.

  **[OWNER-DECISION OD-VB-2] Whether to offer `'shared_org'` in the I4 builder.** The I1 RLS
  policy enforces `shared_org` visibility correctly. Offering it in I4 is safe. **Default:
  expose `'private'` and `'shared_org'` only; `'shared_roles'` is hidden until I6.**

- **FR-VB-023** (ubiquitous) The name field shall be validated client-side before save: empty
  or whitespace-only → validation error displayed via `FieldError`; save button remains disabled.

### 4.4 Builder surface — panel editor

- **FR-VB-030** (ubiquitous) The builder shall maintain an ordered list of `PanelSpec` objects
  in local state. The list is initially empty (create flow) or pre-populated from the saved
  view's `spec.panels` (edit flow).

- **FR-VB-031** (ubiquitous) The builder shall offer an "Add panel" affordance. Activating it
  opens a panel-editor form (inline or a `EntityFormModal`, see OD-VB-3) in which the user
  configures one `PanelSpec`.

  **[OWNER-DECISION OD-VB-3] Panel editor surface: inline (accordion/step) vs. `EntityFormModal`.**
  Inline is more spatial (query config + preview visible simultaneously); a modal is simpler to
  implement and reuses the shared primitive exactly. The builder's preview is always in the main
  canvas, not inside the editor form, so either works. **Default: `EntityFormModal` (reuses the
  shared primitive with zero divergence; can be promoted to inline in a follow-up).**

- **FR-VB-032** (ubiquitous) The panel-editor form shall offer the following fields driven
  entirely by `ENTITY_WHITELIST` and `registry`:

  1. **Primitive selector** — a `SelectField` populated from `registry.keys()` (7 options;
     labels are `PrimitiveDescriptor.description` truncated or the name). Required.
  2. **Entity selector** — a `SelectField` populated from `Object.keys(ENTITY_WHITELIST)` (6
     entities). Required.
  3. **Select columns** — a multi-`Combobox` populated from `entityEntry.allowedColumns` for
     the selected entity. Required (≥1 column).
  4. **Filters** — an optional repeatable row (Add filter / Remove filter) where each row has:
     a column `SelectField` (from `allowedColumns`), an operator `SelectField` (from
     `VALID_FILTER_OPS`, minus `date-range` which is only expressible via the time-range
     picker), and a value `TextField`. For string values, the field accepts a literal or a
     `$current_*` token (see FR-VB-034). For `tasks` entity, the form shall require a
     `project_id` filter and display an explanatory note.
  5. **Group by** — an optional `SelectField` populated from `entityEntry.groupableColumns` for
     the selected entity (empty = no grouping). The form never offers a column that is not in
     `groupableColumns` for `groupBy`.
  6. **Aggregate** — an optional compound field: function `SelectField` (count / sum / avg /
     min / max) + column `SelectField` (for sum/avg/min/max: only `numericColumns` for the
     entity; for count: any `allowedColumn`) + alias `TextField`.
  7. **Time range** — an optional compound field: column `SelectField` (from `dateColumns`),
     from `TextField` (ISO date or token), to `TextField` (ISO date or token). The `date-range`
     filter op is only produced via this field, never via the free-form filter rows.
  8. **Order by** — optional: column `SelectField` (from `allowedColumns`) + direction
     `SelectField` (asc / desc).
  9. **Limit** — optional `TextField` (integer 1–500; the compiler's `INVALID_LIMIT` range).
  10. **Panel label** — an optional `TextField` for a human-readable label (stored in
      `PanelSpec.props.label`; used by primitives that accept a `label` prop, e.g. `KPITile`).
  11. **Layout span** — optional `TextField` for `colSpan` (integer 1–4; stored in
      `PanelSpec.layout.colSpan`). **[OWNER-DECISION OD-VB-4] Whether to expose `rowSpan`.**
      Default: only `colSpan` in I4; `rowSpan` can be added in a follow-up.

- **FR-VB-033** (event-driven) When the user changes the entity selector, the system shall
  reset all entity-dependent fields (select columns, filters, group by, aggregate, time range,
  order by) to empty — because their values reference columns specific to the previously
  selected entity.

- **FR-VB-034** (ubiquitous) For filter value fields, the system shall accept the following
  `$current_*` token strings from `VALID_TOKENS` as literal inputs and pass them to the
  `QuerySpec` verbatim: `$current_user`, `$current_org`, `$current_project`, `$today`,
  `$start_of_month`, `$end_of_month`. (`$current_team` is in `VALID_TOKENS` but the compiler
  will throw `UNRESOLVABLE_TOKEN` at render time if the context lacks `teamId`; the builder
  shall display a warning note if `$current_team` is entered.)

- **FR-VB-035** (event-driven) When the user confirms the panel-editor form, the system shall
  generate a stable `PanelSpec.id` (e.g. `nanoid(8)` or `crypto.randomUUID().slice(0,8)`) for
  new panels, or preserve the existing id for edit, and add/replace the panel in the ordered
  list.

- **FR-VB-036** (ubiquitous) Each panel in the ordered list shall display: its primitive name,
  entity, and a short query summary (entity + columns or aggregate); and two affordances: "Edit"
  (reopens the panel-editor form pre-populated) and "Remove" (removes from the list, no
  confirm needed — the spec is not yet saved).

- **FR-VB-037** (ubiquitous) The builder shall support reordering panels via "Move up" / "Move
  down" affordances on each panel card. **[OWNER-DECISION OD-VB-5] Drag-to-reorder.** Drag
  handles (mouse + keyboard via `aria-grabbed`) would improve UX but add complexity and a
  drag library. **Default: Move up / Move down buttons; drag-to-reorder is a follow-up.**

- **FR-VB-038** (ubiquitous) The builder shall enforce a maximum of 20 panels (matching
  `MAX_PANELS_PER_VIEW` from `UserViewRenderer`); the "Add panel" affordance shall be disabled
  when 20 panels are present, with an explanatory tooltip/note.

### 4.5 Compile-before-save invariant

- **FR-VB-040** (event-driven) When the user activates "Save view" (create) or "Update view"
  (edit), the system shall first call `compileCompositionSpec(spec, ctx)` with a
  `CompilerContext` built from `currentUser.id` and `currentUser.org_id`. If `compileCompositionSpec`
  throws a `ValidationError`, the save shall be aborted and the `ValidationError.code` +
  `ValidationError.detail` shall be surfaced as a form-level error; `useUserViewMutations` shall
  not be called.

- **FR-VB-041** (conditional) Where `compileCompositionSpec` succeeds, the system shall call
  `useUserViewMutations().create(input)` (new view) or `useUserViewMutations().update({ id,
  input })` (existing view) with `input = { name, description, spec, scope }`. `org_id` and
  `user_id` are never included in `input` (I1 FR-UV-003; RLS stamps them).

- **FR-VB-042** (conditional) Where the builder has zero panels (empty `spec.panels`), the
  save button shall be disabled with an explanatory note: "Add at least one panel to save."

- **FR-VB-043** (conditional) Where the view name is empty, the save button shall be disabled
  (client-side validation, FR-VB-023) independently of the panel state.

### 4.6 Live preview

- **FR-VB-050** (ubiquitous) The builder page shall embed `<UserViewRenderer>` (I3) as a live
  preview pane. The preview receives a _transient_ `viewId` derived from a temporary
  `user_views` row **or** uses a preview-only prop path.

  **[OWNER-DECISION OD-VB-6] Live preview implementation: ephemeral save vs. in-memory prop.**
  Two options:
  - **(a) In-memory prop path** — extend `<UserViewRenderer>` (or a thin sibling
    `<ViewPreview>`) to accept a `spec: CompositionSpec` prop directly (bypassing the
    `useUserView(id)` fetch) so the builder can pass the in-progress spec without any DB
    write. The preview compiles + executes the spec client-side the same as the renderer but
    against a prop, not a loaded row.
  - **(b) Ephemeral save-before-preview** — auto-save a `user_views` row on every change and
    use the real `viewId`. This creates noise rows in the DB and couples preview to network.
  **Default: (a) in-memory prop** — a thin `<ViewPreview spec={compositionSpec} />` component
  that wraps the executor + hydration logic from `UserViewRenderer` but accepts a prop directly.
  `UserViewRenderer` itself is NOT modified (it stays clean for I3). The `<ViewPreview>` component
  is a new, narrow addition that reuses `compileCompositionSpec` + `executeCompiledQuery` +
  `HydratedPrimitive` logic (extracted into a shared helper or duplicated minimally for now).
  This keeps I3 stable and avoids any DB side-effect from preview.

- **FR-VB-051** (state-driven) While the in-progress spec has zero panels, the preview pane
  shall show an empty-state placeholder ("Your preview will appear here once you add a panel.")
  rather than rendering an empty `<UserViewRenderer>`.

- **FR-VB-052** (state-driven) While any panel's preview data is loading, the preview pane
  shall render a per-panel skeleton (matching I3's `ChartFrame state="loading"` pattern).

- **FR-VB-053** (event-driven) When a panel is added, edited, or removed, the preview shall
  re-render from the updated in-memory spec automatically (React state-driven; no user action
  required).

- **FR-VB-054** (state-driven) While the in-progress `CompositionSpec` fails
  `compileCompositionSpec` (spec is structurally invalid mid-edit), the preview pane shall show
  the `ValidationError.code` in a non-blocking informational callout alongside whatever
  currently-valid panels can be previewed.

  **[OWNER-DECISION OD-VB-7] Mid-edit validation strictness.** The compiler is fail-fast (first
  error per panel). During live editing (before save), showing a per-panel compile error callout
  inside the preview keeps feedback close to the work without blocking. **Default: show
  per-panel `ValidationError` detail as an inline callout in the preview; do not block the
  panel list from rendering valid panels.**

### 4.7 Save / update / navigation

- **FR-VB-060** (event-driven) When `create.mutateAsync` resolves (new view saved), the system
  shall show a success toast ("View created", `view.name`, "success") and navigate to
  `/views/:newViewId` (the renderer), clearing the builder state.

- **FR-VB-061** (event-driven) When `update.mutateAsync` resolves (existing view updated), the
  system shall show a success toast ("View updated", `view.name`, "success") and navigate to
  `/views/:viewId` (the renderer).

- **FR-VB-062** (event-driven) When `create.mutateAsync` or `update.mutateAsync` rejects, the
  system shall surface the error via `classifyMutationError` as a form-level error banner
  (persists until dismissed or next save attempt); the builder state is preserved (user can
  retry or fix).

- **FR-VB-063** (event-driven) When the user navigates away from a builder with unsaved changes
  (non-empty panels or a modified name/description), the system shall prompt for confirmation
  via a `ConfirmDialog` (or the `EntityFormModal`'s built-in dirty-discard flow if the builder
  fits in a modal variant). **[OWNER-DECISION OD-VB-8] Whether to use browser `beforeunload`
  in addition to the in-app confirm.** Default: in-app confirm only (Esc / Cancel / navigate
  away via `useBlocker` from react-router-dom 7); `beforeunload` is a follow-up.

- **FR-VB-064** (ubiquitous) The builder page shall expose a "Cancel" or "Discard" affordance
  that navigates back to `/views` (the My Views list) after the dirty-confirm flow.

### 4.8 Edit flow (pre-population)

- **FR-VB-070** (event-driven) When the user navigates to `/views/:viewId/edit`, the system
  shall load the existing `user_views` row via `useUserView(viewId)` and pre-populate the
  builder's local state: `name`, `description`, `scope`, and the parsed `spec.panels` list.

- **FR-VB-071** (conditional) Where `useUserView(viewId)` returns `null` (not found / RLS-
  scoped out) or the row is archived, the edit page shall render the same not-found surface as
  I3 (`ListState variant="empty"`) with a "Go to My Views" CTA.

- **FR-VB-072** (conditional) Where `useUserView(viewId)` returns a view whose `spec` does
  not parse as a valid `CompositionSpec` (e.g. corrupted JSON or unknown version), the edit
  page shall render an error state explaining the view cannot be edited, with a "Go to My Views"
  CTA. (This is a last-resort guard; well-formed specs created by I4 will always be valid.)

---

## 5. Non-functional requirements

- **NFR-VB-SEC-001** (whitelist invariant) The builder shall only construct `QuerySpec` objects
  whose `entity`, `select`, `filters[].column`, `filters[].op`, `groupBy`, `aggregate.column`,
  `timeRange.column`, and `orderBy.column` values are drawn from `ENTITY_WHITELIST` for the
  selected entity and `VALID_FILTER_OPS`. An off-whitelist value cannot appear in the spec
  because the form controls are _generated from_ the whitelist, not validated against it after
  the fact. (ADR-0036 §4, §5 declarative-artifact rule.)

- **NFR-VB-SEC-002** (no service_role) The builder's save path goes through
  `useUserViewMutations` → `repositories.userView.create/update` → `src/lib/db/userViews.ts` →
  the anon-key Supabase client (authenticated as the current user's JWT). No `service_role` or
  privileged connection is used. RLS is the write authority (ADR-0036 §2 deputy model;
  ADR-0016).

- **NFR-VB-SEC-003** (org_id / user_id never sent) `org_id` and `user_id` shall never appear
  in any `UserViewInput` assembled by the builder. They are stamped server-side by the
  `user_views` column defaults + RLS `WITH CHECK` (I1 FR-UV-003).

- **NFR-VB-SEC-004** (compile-before-save) `compileCompositionSpec` is called before every
  `create`/`update` mutation. A `ValidationError` from the compiler aborts the save — the
  repository is never called with an invalid spec. (Mirrors NFR-VR-SEC-004 from I3.)

- **NFR-VB-A11Y-001** (WCAG AA) The builder shall pass `axe-core` with zero violations at
  the RTL/Vitest layer. Specifically: all form controls have associated `<label>` elements;
  error messages are announced via `role="alert"` (reusing `EntityFormModal`'s error-summary
  mechanism); the panel list supports keyboard navigation (Move up / Move down buttons are
  focusable; panel editor opens to first field on open); the live-preview pane is not
  keyboard-trapped.

- **NFR-VB-A11Y-002** (WCAG AA — focus management) Opening the panel-editor form (`EntityFormModal`)
  moves focus to the first field (primitive selector); closing it restores focus to the
  triggering "Add panel" or "Edit" button (EntityFormModal's built-in focus-restore behaviour).

- **NFR-VB-PERF-001** (preview debounce) Live preview re-renders are triggered by spec state
  changes. If entity or column changes fire many rapid React state updates, the
  `executeCompiledQuery` calls for the preview shall be debounced or cancelled-on-stale so that
  at most one in-flight fetch per panel runs at a time (analogous to I3's `cancelled` ref pattern).

- **NFR-VB-LAYER-001** (layering) `<ViewBuilderPage>` and `<MyViewsPage>` shall import from:
  `src/lib/viewspec/` (compiler, registry, types); `src/hooks/useUserViews`; `src/auth/`; 
  `src/components/ui/`; `src/lib/classifyMutationError`; `react-router-dom`. They shall NOT
  import from `src/lib/db/*` directly (repository seam — ADR-0017) nor from `src/lib/supabase/client`
  (executor only — ADR-0038).

- **NFR-VB-LAYER-002** (viewspec purity) The `<ViewPreview>` component (see FR-VB-050 OD-VB-6)
  may import `executeCompiledQuery` from `src/lib/viewspec/executor` (same as I3's renderer).
  It shall not import from `src/lib/db/*` or `src/lib/repositories`.

---

## 6. Acceptance criteria (Given/When/Then)

> **Test layering per ADR-0010:**
> - **RTL/Vitest** (local, no DB): builder state machine; form-from-whitelist; compile-before-save;
>   preview wiring; axe-core a11y. All owned at this layer.
> - **Playwright e2e** (one curated cross-stack journey; CI `integration` lane): compose a
>   1-panel view → save → My Views list → view renders in I3 renderer.
> - **pgTAP**: not needed — I1 RLS already covers `user_views` tenancy/ownership/scope contracts.

### RTL / Vitest (unit + component)

**AC-VB-001** — Builder opens empty.
**Given** a user navigates to `/views/new`,
**When** `<ViewBuilderPage>` mounts,
**Then** the panel list is empty, the "Add panel" button is present, the save button is
disabled (no panels), and the view name field is empty and focused.
*(FR-VB-030, FR-VB-042, FR-VB-023)*

**AC-VB-002** — Entity change resets entity-dependent fields.
**Given** the user has opened the panel-editor form and selected entity `projects` with columns
`['name', 'status']` and a filter on `status`,
**When** the user changes the entity selector to `companies`,
**Then** the select columns, filters, group by, aggregate, time range, and order by fields are
reset to empty (no projects-specific column values remain), and the columns options reflect
`ENTITY_WHITELIST['companies'].allowedColumns`.
*(FR-VB-033)*

**AC-VB-003** — Form options are whitelist-constrained: only valid columns are offered.
**Given** the user selects entity `incidents` in the panel-editor form,
**When** the select-columns `Combobox` renders,
**Then** the available options equal exactly `ENTITY_WHITELIST['incidents'].allowedColumns`
(7 values: `id`, `type`, `severity`, `status`, `incident_date`, `location`, `project_id`,
`created_at`); no column outside this set is offered.
*(FR-VB-032, NFR-VB-SEC-001)*

**AC-VB-004** — GroupBy only offers groupable columns.
**Given** the user selects entity `projects` in the panel-editor form,
**When** the group-by `SelectField` renders,
**Then** the available options equal exactly `ENTITY_WHITELIST['projects'].groupableColumns`
(`status`, `client_id`, `project_manager_id`); columns such as `name` or `budget` — which are
in `allowedColumns` but not `groupableColumns` — are absent.
*(FR-VB-032 §5, NFR-VB-SEC-001)*

**AC-VB-005** — Aggregate column respects numericColumns for sum/avg/min/max.
**Given** the user selects entity `projects` and aggregate function `sum`,
**When** the aggregate column `SelectField` renders,
**Then** the options are `contract_value`, `budget`, `spent` only (the
`ENTITY_WHITELIST['projects'].numericColumns`); `name`, `status`, `id`, etc. are absent.
*(FR-VB-032 §6)*

**AC-VB-006** — `tasks` entity requires project_id filter; form enforces it.
**Given** the user selects entity `tasks` in the panel-editor form,
**When** the form renders,
**Then** an explanatory note is displayed: "Tasks require a project filter"; the panel-editor
form does not allow confirming (Add panel button is disabled) until a filter on `project_id`
with op `eq` or `in` is present.
*(FR-VB-032 §4, ADR-0037 §1, `ENTITY_WHITELIST.tasks.requiredFilter`)*

**AC-VB-007** — `compileCompositionSpec` is called before save; a ValidationError blocks save.
**Given** the builder has one panel with a `QuerySpec` that would pass compile (entity
`companies`, `select: ['id','name']`), and the user clicks "Save view",
**When** `compileCompositionSpec` is called with the assembled spec and compiler context,
**Then** if `compileCompositionSpec` throws a `ValidationError` (simulated in the test via a
spy), the mutation `create.mutateAsync` is NOT called and the `ValidationError.code` is
displayed in the form-level error area.
*(FR-VB-040, NFR-VB-SEC-004)*

**AC-VB-008** — Save calls `create` on first save, `update` on edit.
**Given** the builder is in create mode (`/views/new`) with a valid spec (name + ≥1 panel,
compiler passes),
**When** the user clicks "Save view",
**Then** `useUserViewMutations().create` is called with `{ name, description, spec, scope }` —
`org_id` and `user_id` are absent from the call.
**And given** the builder is in edit mode (`/views/:viewId/edit`) with the same valid spec,
**When** the user clicks "Update view",
**Then** `useUserViewMutations().update` is called with `{ id: viewId, input: { name, description, spec, scope } }`.
*(FR-VB-041, NFR-VB-SEC-003)*

**AC-VB-009** — Save error is surfaced via `classifyMutationError`.
**Given** the builder has a valid spec and `create.mutateAsync` rejects with a simulated
`AppError`,
**When** the user clicks "Save view",
**Then** a form-level error banner appears containing the `classifyMutationError` headline;
`create.mutateAsync` is NOT called a second time; the panel list is preserved.
*(FR-VB-062)*

**AC-VB-010** — Save disabled when name is empty.
**Given** the builder has one valid panel but the name field is empty,
**When** the component renders,
**Then** the save button has `aria-disabled="true"` (or `disabled`) and cannot be submitted.
*(FR-VB-043, FR-VB-023)*

**AC-VB-011** — Save disabled when panel list is empty.
**Given** the builder has a name ("My View") but no panels in the list,
**When** the component renders,
**Then** the save button has `aria-disabled="true"` and an explanatory note ("Add at least one
panel to save.") is visible.
*(FR-VB-042)*

**AC-VB-012** — Live preview reflects in-memory spec.
**Given** a `<ViewPreview>` component (or the preview pane in `<ViewBuilderPage>`) receiving a
`CompositionSpec` prop with one panel,
**When** the spec prop changes to a two-panel spec,
**Then** the preview rerenders with two panel skeletons (executor is mocked) and
`executeCompiledQuery` is called once per new panel.
*(FR-VB-053, FR-VB-050 OD-VB-6)*

**AC-VB-013** — Preview shows empty-state placeholder when spec has zero panels.
**Given** `<ViewPreview>` receives a `CompositionSpec` with `panels: []`,
**When** the component renders,
**Then** the empty-state placeholder text is visible and `executeCompiledQuery` is not called.
*(FR-VB-051)*

**AC-VB-014** — Panel reorder (Move up / Move down) updates order.
**Given** the builder has three panels (A, B, C) in order,
**When** the user clicks "Move down" on panel A,
**Then** the panel list is [B, A, C].
**And when** the user clicks "Move up" on panel C,
**Then** the panel list is [B, C, A].
*(FR-VB-037)*

**AC-VB-015** — Panel remove is immediate; view spec is not persisted until Save.
**Given** the builder has two panels (A, B) and no save has been performed,
**When** the user clicks "Remove" on panel A,
**Then** the panel list contains only [B] and no `useUserViewMutations` call is made.
*(FR-VB-036)*

**AC-VB-016** — My Views list: archive confirm + success toast.
**Given** the My Views list shows one view "Weekly Status",
**When** the user clicks "Archive" on the row and then confirms in the `ConfirmDialog`,
**Then** `archive.mutateAsync` is called with the view's id, a success toast "View archived"
appears, and the view is removed from the list (query invalidation).
*(FR-VB-015, FR-VB-016)*

**AC-VB-017** — My Views list: empty state shows CTA.
**Given** `useUserViews()` returns an empty array,
**When** `<MyViewsPage>` renders,
**Then** `ListState variant="empty"` is visible with the text "Create your first view" and a
button/link to `/views/new`.
*(FR-VB-012)*

**AC-VB-018** — axe-core: no a11y violations in builder and My Views surfaces.
**Given** `<ViewBuilderPage>` (with one panel in the list, panel-editor modal closed) and
`<MyViewsPage>` (with one view in the list) rendered under an RTL test,
**When** `axe` is run on each,
**Then** zero violations are reported.
*(NFR-VB-A11Y-001)*

**AC-VB-019** — Edit pre-population: builder loads existing spec.
**Given** a saved `user_views` row `{ id: 'v1', name: 'Q2 Projects', spec: { version: 1, panels: [P1] }, scope: 'private' }` (returned by a mocked `useUserView`),
**When** `<ViewBuilderPage>` mounts at `/views/v1/edit`,
**Then** the name field contains "Q2 Projects", the scope selector shows "Private", the panel
list contains one panel corresponding to P1, and the save button shows "Update view".
*(FR-VB-070)*

### Playwright e2e (one curated cross-stack journey)

**AC-VB-E01** — Compose, save, view list, render.
**Given** a logged-in user with `FEATURES.userViews=true` and a seeded local Supabase (projects
and companies rows exist),
**When** the user navigates to `/views/new`, enters name "Test View", clicks "Add panel",
selects primitive "DataTable", entity "companies", columns "id" and "name", confirms the panel,
clicks "Save view",
**Then** the app navigates to `/views/:newViewId`, the `<UserViewRenderer>` renders the view
with its name "Test View" and the DataTable panel with companies data;
**and when** the user navigates to `/views`,
**Then** "Test View" appears in the My Views list with an "Edit" affordance.
*(FR-VB-041, FR-VB-060, FR-VB-010, FR-VB-013)*

> Playwright test file: `pmo-portal/e2e/AC-VB-E01-view-builder-compose-save.spec.ts`

---

## 7. Traceability

| AC | Requirement(s) | Owning layer | Planned test file |
|---|---|---|---|
| AC-VB-001 | FR-VB-030, FR-VB-042, FR-VB-023 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-002 | FR-VB-033 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-003 | FR-VB-032, NFR-VB-SEC-001 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` |
| AC-VB-004 | FR-VB-032 §5, NFR-VB-SEC-001 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` |
| AC-VB-005 | FR-VB-032 §6 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` |
| AC-VB-006 | FR-VB-032 §4, ADR-0037 §1 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` |
| AC-VB-007 | FR-VB-040, NFR-VB-SEC-004 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-008 | FR-VB-041, NFR-VB-SEC-003 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-009 | FR-VB-062 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-010 | FR-VB-043, FR-VB-023 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-011 | FR-VB-042 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-012 | FR-VB-053, FR-VB-050 | Vitest/RTL | `src/components/builder/ViewPreview.test.tsx` |
| AC-VB-013 | FR-VB-051 | Vitest/RTL | `src/components/builder/ViewPreview.test.tsx` |
| AC-VB-014 | FR-VB-037 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-015 | FR-VB-036 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-016 | FR-VB-015, FR-VB-016 | Vitest/RTL | `src/pages/MyViewsPage.test.tsx` |
| AC-VB-017 | FR-VB-012 | Vitest/RTL | `src/pages/MyViewsPage.test.tsx` |
| AC-VB-018 | NFR-VB-A11Y-001 | Vitest/RTL (axe-core) | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-019 | FR-VB-070 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` |
| AC-VB-E01 | FR-VB-041, FR-VB-060, FR-VB-010, FR-VB-013 | Playwright e2e | `e2e/AC-VB-E01-view-builder-compose-save.spec.ts` |

> FR-VB-001/002/011/022/031/034/035/038/050–054/060–064/070–072 and NFR-VB-PERF-001/LAYER-001/002
> are structural/enabling requirements proven transitively by the ACs above or by the routing test
> (FR-VB-001: the e2e navigates to the route), the feature-flag smoke (FR-VB-002: Vitest renders
> under disabled-flag and checks the feature-disabled surface), and the constraint-by-construction
> approach (NFR-VB-SEC-001: AC-VB-003/004/005/006 prove the form never generates off-whitelist values).
> AC-VB-E01 is the single curated Playwright journey; no additional e2e for the list page (covered
> by Vitest) per ADR-0010 (e2e only for genuine cross-stack ACs).

---

## 8. Open decisions and owner-decision flags

| Flag | Decision | Default |
|---|---|---|
| **OD-VB-1** | Route placement of "My Views" list: `/views` vs. `/my-views` vs. Rail-only | `/views` |
| **OD-VB-2** | Expose `'shared_org'` scope in I4 builder UI (I1 RLS enforces it correctly) | Yes — offer `private` and `shared_org`; hide `shared_roles` until I6 |
| **OD-VB-3** | Panel editor surface: `EntityFormModal` (default) vs. inline accordion/step | `EntityFormModal` |
| **OD-VB-4** | Expose `rowSpan` in layout span field in addition to `colSpan` | `colSpan` only; `rowSpan` in follow-up |
| **OD-VB-5** | Panel reorder: Move up/down buttons (default) vs. drag-to-reorder | Move up / Move down buttons |
| **OD-VB-6** | Live preview: in-memory `<ViewPreview spec={…}>` (default) vs. ephemeral save-before-preview | In-memory prop path; new `<ViewPreview>` component |
| **OD-VB-7** | Mid-edit ValidationError in preview: per-panel inline callout (default) vs. blocking the preview | Per-panel inline callout; non-blocking |
| **OD-VB-8** | Dirty-discard guard: in-app confirm + `useBlocker` (default) vs. also `beforeunload` | In-app confirm + `useBlocker` only |

---

## 9. Component structure (guidance for eng-planner)

Suggested new files (all under `pmo-portal/`):

| File | Description |
|---|---|
| `pages/MyViewsPage.tsx` | My Views list (`/views`) |
| `pages/ViewBuilderPage.tsx` | Builder shell (`/views/new`, `/views/:viewId/edit`) |
| `src/components/builder/PanelEditorForm.tsx` | `EntityFormModal`-based panel editor; renders all entity/column/filter/aggregate fields from whitelist |
| `src/components/builder/PanelList.tsx` | Ordered panel cards with edit/remove/move-up/move-down |
| `src/components/builder/ViewPreview.tsx` | In-memory preview; wraps compile+execute+hydrate without a saved row |
| `src/components/builder/ViewPreview.test.tsx` | RTL tests for AC-VB-012/013 |
| `src/components/builder/PanelEditorForm.test.tsx` | RTL tests for AC-VB-003/004/005/006 |
| `src/components/builder/ViewBuilderPage.test.tsx` | RTL tests for AC-VB-001/002/007/008/009/010/011/014/015/018/019 |
| `src/pages/MyViewsPage.test.tsx` | RTL tests for AC-VB-016/017 |
| `e2e/AC-VB-E01-view-builder-compose-save.spec.ts` | Playwright curated e2e for AC-VB-E01 |

`App.tsx` additions: three `<FeatureRoute>` entries behind `FEATURES.userViews` for `/views`,
`/views/new`, `/views/:viewId/edit`; the `/views/new` and `/views/:viewId/edit` routes must be
declared **before** `/views/:viewId` in the route tree to avoid the `:viewId` wildcard matching
"new" or `:viewId/edit`.

The `FEATURES.userViews` flag and `FeatureRoute` wrapper already exist from I3 and are
unchanged by I4.
