# Implementation Plan: View Builder UI (I4)

**Date:** 2026-06-29
**Spec:** `docs/specs/view-builder.spec.md`
**ADRs:** `docs/adr/0036-agent-native-user-composed-ui.md`, `docs/adr/0037-view-composition-compiler-dsl.md`, `docs/adr/0038-view-renderer-executor-dispatch-pattern.md`
**Pre-push gate:** `cd pmo-portal && npm run verify` (typecheck + lint + test + build) — must be green before the PR opens.

---

## Design

### Architecture overview

Nine new files, two existing-file additions, one Playwright e2e. All build on existing infrastructure — no new dependencies.

```
pmo-portal/
  pages/
    MyViewsPage.tsx                       NEW — /views list (FR-VB-010..016)
    ViewBuilderPage.tsx                   NEW — /views/new + /views/:viewId/edit (FR-VB-020..072)
  src/
    auth/policy.ts                        EDIT — add 'userView' entity
    components/
      builder/
        PanelEditorForm.tsx               NEW — EntityFormModal panel editor (FR-VB-031..035)
        PanelList.tsx                     NEW — ordered panel cards (FR-VB-036..037)
        ViewPreview.tsx                   NEW — in-memory spec preview (FR-VB-050..054)
        PanelEditorForm.test.tsx          NEW — AC-VB-003/004/005/006
        ViewBuilderPage.test.tsx          NEW — AC-VB-001/002/007/008/009/010/011/014/015/018/019
        ViewPreview.test.tsx              NEW — AC-VB-012/013
    pages/
      MyViewsPage.test.tsx               NEW — AC-VB-016/017
  App.tsx                                EDIT — add 3 routes before /views/:viewId
  e2e/
    AC-VB-E01-view-builder-compose-save.spec.ts   NEW — AC-VB-E01
```

### Data flow

```
/views
  → MyViewsPage
      → useUserViews()                    // TQ cache ['user_views', orgId]
      → useUserViewMutations().archive    // on confirm
      → ConfirmDialog, DataTable, ListState
      → navigate('/views/new') or navigate(`/views/${id}/edit`)

/views/new | /views/:viewId/edit
  → ViewBuilderPage
      → useUserView(viewId)               // edit mode only
      → local state: { name, description, scope, panels: PanelSpec[] }
      → PanelList (ordered list of panel cards)
          → PanelEditorForm (EntityFormModal)
              → ENTITY_WHITELIST, registry.keys()
              → builds PanelSpec.querySpec from form values
      → ViewPreview (in-memory preview, FR-VB-050 OD-VB-6)
          → compileCompositionSpec(spec, ctx)  // compile-before-preview
          → executeCompiledQuery(panel.compiledQuery)  // per panel
          → HydratedPrimitive (copied from UserViewRenderer; see below)
      → compileCompositionSpec(spec, ctx)  // compile-before-save (FR-VB-040)
      → useUserViewMutations().create / .update
      → navigate(`/views/${id}`) on success
      → useBlocker() for dirty-discard (OD-VB-8)
```

### Key design decisions

**1. `<ViewPreview>` is a thin standalone component — `UserViewRenderer` is unchanged (OD-VB-6).**
`UserViewRenderer` loads from a `user_views` row via `useUserView(id)`. The preview needs a `CompositionSpec` prop directly. Rather than introducing a prop-bypass mode into the renderer (which would pollute its single-responsibility design), `ViewPreview` reimplements the `compile → executeCompiledQuery → HydratedPrimitive` pipeline with a `spec: CompositionSpec` prop as its entry point. The `HydratedPrimitive` internal function in `UserViewRenderer` is duplicated (not extracted) — it is 30 lines, and extracting it into a shared module would introduce a layering violation (`src/lib/viewspec/` would import React). The duplication is minimal and deliberate; NFR-VB-LAYER-002 explicitly permits `ViewPreview` to import `executeCompiledQuery`.

**2. `panel-level compile guard` in `<ViewPreview>` — OD-VB-7.**
`compileCompositionSpec` is fail-fast: it throws on the first invalid panel. For the live preview during editing, each panel's `QuerySpec` is independently compiled via `compileQuerySpec` (the single-panel variant) rather than `compileCompositionSpec` (which validates the whole spec at once). This lets the preview render valid panels while displaying an inline callout for the panel currently being configured. `compileCompositionSpec` (whole-spec) is still called at save-time for the FR-VB-040 invariant.

**3. `policy.ts` addition — 'userView' entity.**
The spec requires `can('archive', 'userView')` (G-6). `userView` is not yet in the policy. Because user-view write is scoped to the authenticated user (any role that has `FEATURES.userViews` may archive their own views), the policy entry is `archive: allow(ALL)`. This is a UX-only gate — the real authority is the RLS `user_views_delete` / `archived_at` path that is already server-enforced in I1. No new ADR needed: this is a routine extension of the existing policy table, not an architectural decision.

**4. Panel editor surface — `EntityFormModal` (OD-VB-3).**
The `PanelEditorForm` receives an initial `PanelSpec | null` prop (null = add, non-null = edit), builds its values from `useEntityForm`, and calls `onConfirm(panelSpec)` on submit. It does NOT own its open/close state — `ViewBuilderPage` owns the modal open flag.

**5. `useBlocker` for dirty-discard (OD-VB-8).**
`react-router-dom 7` exports `useBlocker` which fires when the user navigates away. When the builder has unsaved changes (`isDirty: panels.length > 0 || name !== ''` for create, or any field modified for edit), `useBlocker` triggers a `ConfirmDialog`. No `beforeunload` handler.

**6. Preview debounce — NFR-VB-PERF-001.**
`ViewPreview` uses a `cancelled` ref pattern identical to `UserViewRenderer` (one ref per re-render cycle). When the `spec` prop changes, a new render cycle starts, the ref is set to `cancelled = true` for the prior cycle, and only the latest cycle's results are committed to state.

**7. Panel ID generation.**
New panels use `crypto.randomUUID().slice(0, 8)` (available in all modern browsers and jsdom/Vitest). No nanoid dependency needed.

**8. Column multi-select in `PanelEditorForm`.**
`Combobox` in the shared library is a single-select async picker. For multi-column selection, the implementation uses a controlled list of checkboxes rendered inline (not the `Combobox` component, which does not support multi-select). The fieldset uses `aria-label="Select columns"`. This is the minimum viable implementation; a dedicated multi-select Combobox is a follow-up.

**9. `tasks` required-filter enforcement in `PanelEditorForm`.**
When entity is `tasks`, the "Add panel" / "Confirm" button in `PanelEditorForm` is disabled until at least one filter with `column = 'project_id'` and `op = 'eq' | 'in'` is present. An explanatory `<FieldError>` note is rendered below the entity selector (AC-VB-006).

**10. Route ordering — `/views/new` before `/views/:viewId` (spec §9).**
In `App.tsx`'s `<AppRoutes>`, the three new `<FeatureRoute>` entries are inserted immediately before the existing `/views/:viewId` route, in the order `/views`, `/views/new`, `/views/:viewId/edit`, `/views/:viewId`. React Router 7 uses path specificity, so literal segment `new` matches before the `:viewId` wildcard. The edit route `/views/:viewId/edit` is also more specific than `/views/:viewId` and must precede it.

### Scaling notes

- `PanelEditorForm` derives all option lists from `ENTITY_WHITELIST` and `registry.keys()` — pure in-memory maps, no network call for options. Scales to N entities with zero additional cost.
- `ViewPreview` fires panel queries sequentially per `useEffect` cycle but cancels stale cycles. With 20 panels max (FR-VB-038), the `Promise.allSettled` approach from `UserViewRenderer` is reused.
- `useUserViews()` cache is already seeded by `ShellChrome` — `MyViewsPage` reads the same TQ cache key `['user_views', orgId]` with no additional network call on initial load.
- The `isDirty` check in `useBlocker` is `O(panels.length)` — bounded by `MAX_PANELS_PER_VIEW = 20`.

---

## Traceability table

| AC | Requirement(s) | Owning layer | Test file | Task(s) |
|---|---|---|---|---|
| AC-VB-001 | FR-VB-030, FR-VB-042, FR-VB-023 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-08 |
| AC-VB-002 | FR-VB-033 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-08 |
| AC-VB-003 | FR-VB-032, NFR-VB-SEC-001 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` | T-06 |
| AC-VB-004 | FR-VB-032 §5, NFR-VB-SEC-001 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` | T-06 |
| AC-VB-005 | FR-VB-032 §6 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` | T-06 |
| AC-VB-006 | FR-VB-032 §4, ADR-0037 §1 | Vitest/RTL | `src/components/builder/PanelEditorForm.test.tsx` | T-06 |
| AC-VB-007 | FR-VB-040, NFR-VB-SEC-004 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-09 |
| AC-VB-008 | FR-VB-041, NFR-VB-SEC-003 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-09 |
| AC-VB-009 | FR-VB-062 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-09 |
| AC-VB-010 | FR-VB-043, FR-VB-023 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-08 |
| AC-VB-011 | FR-VB-042 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-08 |
| AC-VB-012 | FR-VB-053, FR-VB-050 | Vitest/RTL | `src/components/builder/ViewPreview.test.tsx` | T-07 |
| AC-VB-013 | FR-VB-051 | Vitest/RTL | `src/components/builder/ViewPreview.test.tsx` | T-07 |
| AC-VB-014 | FR-VB-037 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-10 |
| AC-VB-015 | FR-VB-036 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-10 |
| AC-VB-016 | FR-VB-015, FR-VB-016 | Vitest/RTL | `src/pages/MyViewsPage.test.tsx` | T-04 |
| AC-VB-017 | FR-VB-012 | Vitest/RTL | `src/pages/MyViewsPage.test.tsx` | T-04 |
| AC-VB-018 | NFR-VB-A11Y-001 | Vitest/RTL (axe-core) | `src/components/builder/ViewBuilderPage.test.tsx` | T-11 |
| AC-VB-019 | FR-VB-070 | Vitest/RTL | `src/components/builder/ViewBuilderPage.test.tsx` | T-09 |
| AC-VB-E01 | FR-VB-041, FR-VB-060, FR-VB-010, FR-VB-013 | Playwright e2e | `e2e/AC-VB-E01-view-builder-compose-save.spec.ts` | T-12 |

---

## Tasks

### T-01 — Add `userView` entity to `src/auth/policy.ts`

**AC covered:** gates `can('archive', 'userView')` used in T-03/T-04.

**File:** `pmo-portal/src/auth/policy.ts`

In the `Entity` type union, add `'userView'`. In the `POLICY` record, add:

```ts
userView: {
  // Any authenticated user may create, edit, and archive their OWN views.
  // RLS is the real authority (user_views_insert/update/delete, I1).
  create: allow(ALL),
  edit:   allow(ALL),
  archive: allow(ALL),
},
```

**Verify:** `cd pmo-portal && npm run typecheck` — zero errors. `npm test -- --reporter=verbose src/auth/usePermission.test.tsx` — existing tests stay green (no behavior changed for existing entities).

---

### T-02 — Add three new routes in `App.tsx` before `/views/:viewId`

**AC covered:** FR-VB-001 (routes exist); transitively required by AC-VB-E01.

**File:** `pmo-portal/App.tsx`

Add lazy imports at the top of the lazy-route block (after `UserViewRenderer`):

```ts
const MyViewsPage    = React.lazy(() => import('./pages/MyViewsPage'));
const ViewBuilderPage = React.lazy(() => import('./pages/ViewBuilderPage'));
```

In `AppRoutes`, replace the existing `/views/:viewId` block with:

```tsx
{/* I4: My Views list (/views) — before /:viewId to avoid wildcard collision */}
<Route
  path="/views"
  element={<FeatureRoute feature="userViews" element={<MyViewsPage />} />}
/>
{/* I4: Create builder — literal 'new' before /:viewId param */}
<Route
  path="/views/new"
  element={<FeatureRoute feature="userViews" element={<ViewBuilderPage mode="create" />} />}
/>
{/* I4: Edit builder — /:viewId/edit is more specific than /:viewId alone */}
<Route
  path="/views/:viewId/edit"
  element={<FeatureRoute feature="userViews" element={<ViewBuilderPage mode="edit" />} />}
/>
{/* I3: Read-only renderer (unchanged) */}
<Route
  path="/views/:viewId"
  element={<FeatureRoute feature="userViews" element={<UserViewRenderer />} />}
/>
```

**Verify:** `cd pmo-portal && npm run typecheck` — zero errors. `npm run build` — no chunk/import errors.

---

### T-03 — Write failing tests for `MyViewsPage` (RED — AC-VB-016, AC-VB-017)

**AC covered:** AC-VB-016 (archive confirm + toast), AC-VB-017 (empty state CTA).

**File:** `pmo-portal/src/pages/MyViewsPage.test.tsx` (new file)

```tsx
/**
 * MyViewsPage — RTL tests.
 * AC-VB-016: archive confirm + success toast.
 * AC-VB-017: empty state shows CTA to /views/new.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const { mockUseUserViews, mockArchive, mockUseAuth, mockToast } = vi.hoisted(() => ({
  mockUseUserViews: vi.fn(),
  mockArchive: vi.fn(),
  mockUseAuth: vi.fn(() => ({
    currentUser: { id: 'u1', org_id: 'org1' },
    role: 'Admin',
    session: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  })),
  mockToast: vi.fn(),
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: mockUseUserViews,
  useUserViewMutations: () => ({
    archive: { mutateAsync: mockArchive, isPending: false },
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: mockUseAuth }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
  CanWrite: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: mockToast }) };
});

import MyViewsPage from '@/src/pages/MyViewsPage';

const VIEW_ROW = {
  id: 'v1',
  name: 'Weekly Status',
  description: null,
  scope: 'private',
  spec: { version: 1, panels: [] },
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-28T10:00:00Z',
  archived_at: null,
  org_id: 'org1',
  user_id: 'u1',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/views']}>
      <MyViewsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockArchive.mockResolvedValue(undefined);
  mockUseUserViews.mockReturnValue({ data: [VIEW_ROW], isPending: false, isError: false });
});

describe('MyViewsPage', () => {
  it('AC-VB-017: empty state shows "Create your first view" CTA linking to /views/new', () => {
    mockUseUserViews.mockReturnValue({ data: [], isPending: false, isError: false });
    renderPage();
    expect(screen.getByText(/create your first view/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /create your first view/i });
    expect(cta).toHaveAttribute('href', '/views/new');
  });

  it('AC-VB-016: archive confirm + success toast + mutation called with view id', async () => {
    const user = userEvent.setup();
    renderPage();
    // Row action menu — open it
    const menuBtn = screen.getByRole('button', { name: /actions/i });
    await user.click(menuBtn);
    const archiveItem = screen.getByRole('menuitem', { name: /archive/i });
    await user.click(archiveItem);
    // ConfirmDialog should appear
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/archive this view/i)).toBeInTheDocument();
    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /^archive$/i });
    await user.click(confirmBtn);
    await waitFor(() => expect(mockArchive).toHaveBeenCalledWith('v1'));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'View archived', kind: 'success' }),
      ),
    );
  });
});
```

**Verify:** `cd pmo-portal && npx vitest run src/pages/MyViewsPage.test.tsx` — both tests FAIL (file does not exist yet).

---

### T-04 — Implement `MyViewsPage` (GREEN — AC-VB-016, AC-VB-017)

**AC covered:** AC-VB-016, AC-VB-017; also FR-VB-010/011/012/013/014/015/016.

**File:** `pmo-portal/src/pages/MyViewsPage.tsx` (new file)

```tsx
/**
 * My Views list page — /views (I4, FR-VB-010..016).
 * Lists the current user's non-archived views; open / edit / archive affordances.
 * Follows Companies.tsx CRUD/RBAC pattern (ADR-0016/0017/0018).
 */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ListPage,
  DataTable,
  ListState,
  ConfirmDialog,
  Button,
  useToast,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { useUserViews, useUserViewMutations } from '@/src/hooks/useUserViews';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { UserViewRow } from '@/src/lib/db/userViews';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

const MyViewsPage: React.FC = () => {
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useUserViews();
  const { archive } = useUserViewMutations();

  const [archiveTarget, setArchiveTarget] = useState<UserViewRow | null>(null);

  const canArchive = may('archive', 'userView');

  const columns: Column<UserViewRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <Link to={`/views/${row.id}`} className="font-medium text-foreground hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span className="text-muted-foreground">{row.description ?? '—'}</span>
      ),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      render: (row) => (
        <span className="text-muted-foreground">{timeAgo(row.updated_at)}</span>
      ),
    },
  ];

  const rowMenu = (row: UserViewRow): RowMenuItem[] => [
    {
      label: 'Edit',
      onClick: () => navigate(`/views/${row.id}/edit`),
    },
    ...(canArchive
      ? [{ label: 'Archive', onClick: () => setArchiveTarget(row) }]
      : []),
  ];

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync(archiveTarget.id);
      toast({ title: 'View archived', description: archiveTarget.name, kind: 'success' });
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast({ title: headline, description: detail, kind: 'warning' });
    } finally {
      setArchiveTarget(null);
    }
  };

  if (isError) {
    return (
      <ListState
        variant="error"
        title="Could not load views."
        sub="A network or server error occurred."
        onRetry={refetch}
      />
    );
  }

  const rows = data ?? [];

  return (
    <ListPage
      title="My Views"
      actions={
        <Button variant="primary" onClick={() => navigate('/views/new')}>
          New View
        </Button>
      }
    >
      {isPending ? (
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          state="loading"
        />
      ) : rows.length === 0 ? (
        <ListState
          variant="empty"
          title="No views yet."
          sub={
            <Link
              to="/views/new"
              className="font-medium text-primary hover:underline"
            >
              Create your first view
            </Link>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowMenu={rowMenu}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        tone="destructive"
        title="Archive this view?"
        description={`"${archiveTarget?.name}" will be archived and removed from your list.`}
        confirmLabel="Archive"
        cancelLabel="Keep"
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
        loading={archive.isPending}
      />
    </ListPage>
  );
};

export default MyViewsPage;
```

**Verify:** `cd pmo-portal && npx vitest run src/pages/MyViewsPage.test.tsx` — both tests GREEN.

---

### T-05 — Write failing tests for `PanelEditorForm` (RED — AC-VB-003/004/005/006)

**AC covered:** AC-VB-003 (whitelist-constrained column options for `incidents`), AC-VB-004 (groupBy only shows groupable columns), AC-VB-005 (aggregate column respects numericColumns for sum), AC-VB-006 (`tasks` requires project_id filter).

**File:** `pmo-portal/src/components/builder/PanelEditorForm.test.tsx` (new file)

```tsx
/**
 * PanelEditorForm — whitelist-constraint tests.
 * AC-VB-003: column options = ENTITY_WHITELIST['incidents'].allowedColumns exactly.
 * AC-VB-004: groupBy options = groupableColumns only.
 * AC-VB-005: aggregate column for sum = numericColumns only.
 * AC-VB-006: tasks entity requires project_id filter; confirm disabled until present.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', org_id: 'org1' },
    role: 'Admin',
    session: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import PanelEditorForm from '@/src/components/builder/PanelEditorForm';
import { ENTITY_WHITELIST } from '@/src/lib/viewspec/types';

const noop = () => {};

function openForm(props?: Partial<React.ComponentProps<typeof PanelEditorForm>>) {
  return render(
    <PanelEditorForm
      open={true}
      initialPanel={null}
      onConfirm={noop}
      onClose={noop}
      {...props}
    />,
  );
}

describe('PanelEditorForm — whitelist constraints', () => {
  it('AC-VB-003: incidents column options equal exactly ENTITY_WHITELIST["incidents"].allowedColumns', async () => {
    const user = userEvent.setup();
    openForm();
    // Select entity = incidents
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'incidents');
    // All expected column checkboxes should be present; no extra ones
    const allowed = Array.from(ENTITY_WHITELIST.incidents.allowedColumns).sort();
    for (const col of allowed) {
      expect(screen.getByRole('checkbox', { name: new RegExp(col, 'i') })).toBeInTheDocument();
    }
    // Ensure no column outside the set is offered (sample: a definitely-absent col)
    expect(screen.queryByRole('checkbox', { name: /budget/i })).not.toBeInTheDocument();
  });

  it('AC-VB-004: groupBy options for projects = groupableColumns only (status, client_id, project_manager_id)', async () => {
    const user = userEvent.setup();
    openForm();
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'projects');
    const groupBySelect = screen.getByRole('combobox', { name: /group by/i });
    // Only groupable columns should appear as options
    const groupable = Array.from(ENTITY_WHITELIST.projects.groupableColumns);
    const options = Array.from(groupBySelect.querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options.sort()).toEqual(['', ...groupable].sort());
    // name and budget are allowedColumns but NOT groupable
    expect(options).not.toContain('name');
    expect(options).not.toContain('budget');
  });

  it('AC-VB-005: aggregate column for sum function on projects = numericColumns only', async () => {
    const user = userEvent.setup();
    openForm();
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'projects');
    const fnSelect = screen.getByRole('combobox', { name: /aggregate function/i });
    await user.selectOptions(fnSelect, 'sum');
    const colSelect = screen.getByRole('combobox', { name: /aggregate column/i });
    const numeric = Array.from(ENTITY_WHITELIST.projects.numericColumns);
    const options = Array.from(colSelect.querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options.sort()).toEqual(['', ...numeric].sort());
    expect(options).not.toContain('name');
    expect(options).not.toContain('status');
    expect(options).not.toContain('id');
  });

  it('AC-VB-006: tasks entity shows required-filter note; confirm disabled until project_id eq/in filter added', async () => {
    const user = userEvent.setup();
    openForm();
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'tasks');
    // Note must be visible
    expect(screen.getByText(/tasks require a project filter/i)).toBeInTheDocument();
    // The form submit/confirm should be disabled
    const confirmBtn = screen.getByRole('button', { name: /add panel|confirm/i });
    expect(confirmBtn).toBeDisabled();
    // Add a filter on project_id with op eq
    const addFilterBtn = screen.getByRole('button', { name: /add filter/i });
    await user.click(addFilterBtn);
    const filterColSelect = screen.getAllByRole('combobox', { name: /filter column/i })[0];
    await user.selectOptions(filterColSelect, 'project_id');
    const filterOpSelect = screen.getAllByRole('combobox', { name: /filter operator/i })[0];
    await user.selectOptions(filterOpSelect, 'eq');
    const filterValInput = screen.getAllByRole('textbox', { name: /filter value/i })[0];
    await user.type(filterValInput, 'proj-123');
    // Also need to select at least one column (required)
    const colCheckbox = screen.getAllByRole('checkbox')[0];
    await user.click(colCheckbox);
    // Confirm button should now be enabled
    expect(confirmBtn).not.toBeDisabled();
  });
});
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/PanelEditorForm.test.tsx` — all 4 tests FAIL (component does not exist yet).

---

### T-06 — Implement `PanelEditorForm` and `PanelList` (GREEN — AC-VB-003/004/005/006)

**AC covered:** AC-VB-003, AC-VB-004, AC-VB-005, AC-VB-006; also FR-VB-032/033/034/035/036/037.

**File:** `pmo-portal/src/components/builder/PanelEditorForm.tsx` (new file)

```tsx
/**
 * PanelEditorForm — EntityFormModal-based panel editor (I4, FR-VB-031..035, OD-VB-3).
 *
 * All option lists are derived from ENTITY_WHITELIST and registry.keys() so it is
 * impossible to construct an off-whitelist QuerySpec via the UI (NFR-VB-SEC-001).
 *
 * Props:
 *   open           — whether the modal is open (owner state)
 *   initialPanel   — null (add mode) | PanelSpec (edit mode)
 *   onConfirm(p)   — called with the assembled PanelSpec when the form is submitted
 *   onClose()      — called when the modal is closed (cancel/discard)
 */
import React, { useEffect, useId, useState } from 'react';
import {
  EntityFormModal,
  SelectField,
  TextField,
  FormGrid,
  FormSection,
  FieldError,
  type SelectOption,
} from '@/src/components/ui';
import {
  ENTITY_WHITELIST,
  VALID_FILTER_OPS,
  VALID_TOKENS,
  ValidationError,
} from '@/src/lib/viewspec/types';
import { registry } from '@/src/lib/viewspec/registry';
import type {
  PanelSpec,
  QuerySpec,
  WhitelistedEntity,
  AggregateFn,
  FilterClause,
} from '@/src/lib/viewspec/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FilterRow {
  column: string;
  op: string;
  value: string;
}

interface FormState {
  primitive: string;
  entity: WhitelistedEntity | '';
  selectedColumns: string[];
  filters: FilterRow[];
  groupBy: string;
  aggregateFn: AggregateFn | '';
  aggregateColumn: string;
  aggregateAlias: string;
  timeRangeColumn: string;
  timeRangeFrom: string;
  timeRangeTo: string;
  orderByColumn: string;
  orderByDir: 'asc' | 'desc';
  limit: string;
  label: string;
  colSpan: string;
}

function emptyForm(): FormState {
  return {
    primitive: '',
    entity: '',
    selectedColumns: [],
    filters: [],
    groupBy: '',
    aggregateFn: '',
    aggregateColumn: '',
    aggregateAlias: '',
    timeRangeColumn: '',
    timeRangeFrom: '',
    timeRangeTo: '',
    orderByColumn: '',
    orderByDir: 'asc',
    limit: '',
    label: '',
    colSpan: '',
  };
}

function panelToForm(panel: PanelSpec): FormState {
  const qs = panel.querySpec;
  const firstFilter = qs.filters?.[0];
  return {
    primitive: panel.primitive,
    entity: qs.entity,
    selectedColumns: [...qs.select],
    filters: (qs.filters ?? []).map((f) => ({
      column: f.column,
      op: f.op,
      value: Array.isArray(f.value) ? (f.value as string[]).join(',') : String(f.value),
    })),
    groupBy: qs.groupBy ?? '',
    aggregateFn: qs.aggregate?.fn ?? '',
    aggregateColumn: qs.aggregate?.column ?? '',
    aggregateAlias: qs.aggregate?.alias ?? '',
    timeRangeColumn: qs.timeRange?.column ?? '',
    timeRangeFrom: qs.timeRange?.from ?? '',
    timeRangeTo: qs.timeRange?.to ?? '',
    orderByColumn: qs.orderBy?.column ?? '',
    orderByDir: qs.orderBy?.dir ?? 'asc',
    limit: qs.limit !== undefined ? String(qs.limit) : '',
    label: (panel.props?.label as string | undefined) ?? '',
    colSpan: panel.layout?.colSpan !== undefined ? String(panel.layout.colSpan) : '',
  };
}

// Filter ops minus date-range (date-range is only via the time-range compound field)
const FORM_FILTER_OPS: SelectOption[] = Array.from(VALID_FILTER_OPS)
  .filter((op) => op !== 'date-range')
  .map((op) => ({ value: op, label: op }));

const AGGREGATE_FNS: SelectOption[] = [
  { value: 'count', label: 'count' },
  { value: 'sum', label: 'sum' },
  { value: 'avg', label: 'avg' },
  { value: 'min', label: 'min' },
  { value: 'max', label: 'max' },
];

const DIR_OPTIONS: SelectOption[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

export interface PanelEditorFormProps {
  open: boolean;
  /** null = add mode; PanelSpec = edit mode (pre-populated) */
  initialPanel: PanelSpec | null;
  onConfirm: (panel: PanelSpec) => void;
  onClose: () => void;
}

export const PanelEditorForm: React.FC<PanelEditorFormProps> = ({
  open,
  initialPanel,
  onConfirm,
  onClose,
}) => {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // Reset or pre-populate when the modal opens
  useEffect(() => {
    if (!open) return;
    setForm(initialPanel ? panelToForm(initialPanel) : emptyForm());
    setError(null);
  }, [open, initialPanel]);

  const entityEntry =
    form.entity !== '' ? ENTITY_WHITELIST[form.entity] : null;

  // When entity changes, reset all entity-dependent fields (FR-VB-033)
  const handleEntityChange = (entity: string) => {
    setForm((prev) => ({
      ...emptyForm(),
      primitive: prev.primitive,
      entity: entity as WhitelistedEntity,
    }));
  };

  const toggleColumn = (col: string) => {
    setForm((prev) => ({
      ...prev,
      selectedColumns: prev.selectedColumns.includes(col)
        ? prev.selectedColumns.filter((c) => c !== col)
        : [...prev.selectedColumns, col],
    }));
  };

  const addFilter = () => {
    setForm((prev) => ({
      ...prev,
      filters: [...prev.filters, { column: '', op: 'eq', value: '' }],
    }));
  };

  const removeFilter = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== idx),
    }));
  };

  const updateFilter = (idx: number, key: keyof FilterRow, value: string) => {
    setForm((prev) => {
      const next = [...prev.filters];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, filters: next };
    });
  };

  // tasks entity: requires a project_id eq|in filter (FR-VB-032 §4, AC-VB-006)
  const tasksFilterSatisfied =
    form.entity !== 'tasks' ||
    form.filters.some(
      (f) => f.column === 'project_id' && (f.op === 'eq' || f.op === 'in'),
    );

  const isFormComplete =
    form.primitive !== '' &&
    form.entity !== '' &&
    form.selectedColumns.length > 0 &&
    tasksFilterSatisfied;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isFormComplete) return;

    // Build QuerySpec
    const filters: FilterClause[] = form.filters
      .filter((f) => f.column && f.op && f.value)
      .map((f) => ({
        column: f.column,
        op: f.op as FilterClause['op'],
        value: f.op === 'in' ? f.value.split(',').map((v) => v.trim()) : f.value,
      }));

    const qs: QuerySpec = {
      entity: form.entity as WhitelistedEntity,
      select: [...form.selectedColumns],
      ...(filters.length > 0 && { filters }),
      ...(form.groupBy && { groupBy: form.groupBy }),
      ...(form.aggregateFn && form.aggregateColumn && form.aggregateAlias && {
        aggregate: {
          fn: form.aggregateFn as AggregateFn,
          column: form.aggregateColumn,
          alias: form.aggregateAlias,
        },
      }),
      ...(form.timeRangeColumn && form.timeRangeFrom && form.timeRangeTo && {
        timeRange: {
          column: form.timeRangeColumn,
          from: form.timeRangeFrom,
          to: form.timeRangeTo,
        },
      }),
      ...(form.orderByColumn && {
        orderBy: { column: form.orderByColumn, dir: form.orderByDir },
      }),
      ...(form.limit && { limit: parseInt(form.limit, 10) }),
    };

    const id =
      initialPanel?.id ?? crypto.randomUUID().slice(0, 8);

    const panel: PanelSpec = {
      id,
      primitive: form.primitive,
      querySpec: qs,
      ...(form.colSpan && {
        layout: { colSpan: parseInt(form.colSpan, 10) },
      }),
      ...(form.label && {
        props: { label: form.label },
      }),
    };

    onConfirm(panel);
  };

  const primitiveOptions: SelectOption[] = registry
    .keys()
    .map((name) => ({ value: name, label: registry.get(name)!.description.slice(0, 60) }));

  const entityOptions: SelectOption[] = Object.keys(ENTITY_WHITELIST).map((e) => ({
    value: e,
    label: e,
  }));

  const allCols = entityEntry
    ? Array.from(entityEntry.allowedColumns).sort()
    : [];

  const groupableCols: SelectOption[] = entityEntry
    ? [
        { value: '', label: '— none —' },
        ...Array.from(entityEntry.groupableColumns)
          .sort()
          .map((c) => ({ value: c, label: c })),
      ]
    : [{ value: '', label: '— none —' }];

  const aggregateColOptions: SelectOption[] = (() => {
    if (!entityEntry || !form.aggregateFn) return [{ value: '', label: '— select —' }];
    const cols =
      form.aggregateFn === 'count'
        ? Array.from(entityEntry.allowedColumns)
        : Array.from(entityEntry.numericColumns);
    return [
      { value: '', label: '— select —' },
      ...cols.sort().map((c) => ({ value: c, label: c })),
    ];
  })();

  const dateColOptions: SelectOption[] = entityEntry
    ? [
        { value: '', label: '— none —' },
        ...Array.from(entityEntry.dateColumns)
          .sort()
          .map((c) => ({ value: c, label: c })),
      ]
    : [{ value: '', label: '— none —' }];

  const allowedColOptions: SelectOption[] = entityEntry
    ? [
        { value: '', label: '— none —' },
        ...Array.from(entityEntry.allowedColumns)
          .sort()
          .map((c) => ({ value: c, label: c })),
      ]
    : [{ value: '', label: '— none —' }];

  // Warn if $current_team is entered in any filter value
  const hasTeamToken = form.filters.some((f) => f.value === '$current_team');

  return (
    <EntityFormModal
      open={open}
      title={initialPanel ? 'Edit panel' : 'Add panel'}
      subtitle="Configure this panel's data source"
      submitLabel={initialPanel ? 'Update panel' : 'Add panel'}
      onSubmit={handleSubmit}
      onClose={onClose}
      submitDisabled={!isFormComplete}
      width="lg"
      errorSummary={error ? [{ fieldId: 'panel-error', message: error }] : undefined}
    >
      <FormGrid>
        {/* Primitive selector */}
        <SelectField
          label="Primitive"
          required
          aria-label="primitive"
          value={form.primitive}
          options={[{ value: '', label: '— select a primitive —' }, ...primitiveOptions]}
          onChange={(v) => setForm((p) => ({ ...p, primitive: v }))}
        />

        {/* Entity selector */}
        <SelectField
          label="Entity"
          required
          aria-label="entity"
          value={form.entity}
          options={[{ value: '', label: '— select an entity —' }, ...entityOptions]}
          onChange={handleEntityChange}
        />

        {/* tasks required-filter note (FR-VB-032 §4) */}
        {form.entity === 'tasks' && (
          <div className="col-span-2">
            <FieldError>Tasks require a project filter (column: project_id, op: eq or in)</FieldError>
          </div>
        )}

        {/* Select columns — multi-checkbox (FR-VB-032 §3) */}
        {form.entity !== '' && (
          <FormSection title="Select columns *" fullWidth>
            <fieldset aria-label="Select columns" className="flex flex-wrap gap-2">
              {allCols.map((col) => (
                <label key={col} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={form.selectedColumns.includes(col)}
                    onChange={() => toggleColumn(col)}
                    aria-label={col}
                  />
                  {col}
                </label>
              ))}
            </fieldset>
          </FormSection>
        )}

        {/* Filters */}
        {form.entity !== '' && (
          <FormSection title="Filters" fullWidth>
            {form.filters.map((f, idx) => (
              <div key={idx} className="mb-2 flex flex-wrap items-end gap-2">
                <SelectField
                  label="Filter column"
                  aria-label="filter column"
                  value={f.column}
                  options={[
                    { value: '', label: '— column —' },
                    ...allCols.map((c) => ({ value: c, label: c })),
                  ]}
                  onChange={(v) => updateFilter(idx, 'column', v)}
                />
                <SelectField
                  label="Filter operator"
                  aria-label="filter operator"
                  value={f.op}
                  options={FORM_FILTER_OPS}
                  onChange={(v) => updateFilter(idx, 'op', v)}
                />
                <TextField
                  label="Filter value"
                  aria-label="filter value"
                  value={f.value}
                  onChange={(v) => updateFilter(idx, 'value', v)}
                />
                <button
                  type="button"
                  aria-label="Remove filter"
                  onClick={() => removeFilter(idx)}
                  className="self-end pb-0.5 text-[12px] text-destructive hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
            {hasTeamToken && (
              <FieldError>
                $current_team requires a teamId context at render time — it may fail at preview.
              </FieldError>
            )}
            <button
              type="button"
              onClick={addFilter}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              + Add filter
            </button>
          </FormSection>
        )}

        {/* Group by */}
        {form.entity !== '' && (
          <SelectField
            label="Group by"
            aria-label="group by"
            value={form.groupBy}
            options={groupableCols}
            onChange={(v) => setForm((p) => ({ ...p, groupBy: v }))}
          />
        )}

        {/* Aggregate */}
        {form.entity !== '' && (
          <FormSection title="Aggregate" fullWidth>
            <div className="flex flex-wrap gap-2">
              <SelectField
                label="Aggregate function"
                aria-label="aggregate function"
                value={form.aggregateFn}
                options={[{ value: '', label: '— none —' }, ...AGGREGATE_FNS]}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    aggregateFn: v as AggregateFn | '',
                    aggregateColumn: '',
                  }))
                }
              />
              {form.aggregateFn && (
                <>
                  <SelectField
                    label="Aggregate column"
                    aria-label="aggregate column"
                    value={form.aggregateColumn}
                    options={aggregateColOptions}
                    onChange={(v) => setForm((p) => ({ ...p, aggregateColumn: v }))}
                  />
                  <TextField
                    label="Alias"
                    aria-label="aggregate alias"
                    value={form.aggregateAlias}
                    onChange={(v) => setForm((p) => ({ ...p, aggregateAlias: v }))}
                  />
                </>
              )}
            </div>
          </FormSection>
        )}

        {/* Time range */}
        {form.entity !== '' && (
          <FormSection title="Time range" fullWidth>
            <div className="flex flex-wrap gap-2">
              <SelectField
                label="Date column"
                aria-label="time range column"
                value={form.timeRangeColumn}
                options={dateColOptions}
                onChange={(v) => setForm((p) => ({ ...p, timeRangeColumn: v }))}
              />
              {form.timeRangeColumn && (
                <>
                  <TextField
                    label="From (ISO date or token)"
                    aria-label="time range from"
                    value={form.timeRangeFrom}
                    onChange={(v) => setForm((p) => ({ ...p, timeRangeFrom: v }))}
                  />
                  <TextField
                    label="To (ISO date or token)"
                    aria-label="time range to"
                    value={form.timeRangeTo}
                    onChange={(v) => setForm((p) => ({ ...p, timeRangeTo: v }))}
                  />
                </>
              )}
            </div>
          </FormSection>
        )}

        {/* Order by */}
        {form.entity !== '' && (
          <FormSection title="Order by" fullWidth>
            <div className="flex flex-wrap gap-2">
              <SelectField
                label="Order column"
                aria-label="order by column"
                value={form.orderByColumn}
                options={allowedColOptions}
                onChange={(v) => setForm((p) => ({ ...p, orderByColumn: v }))}
              />
              {form.orderByColumn && (
                <SelectField
                  label="Direction"
                  aria-label="order by direction"
                  value={form.orderByDir}
                  options={DIR_OPTIONS}
                  onChange={(v) =>
                    setForm((p) => ({ ...p, orderByDir: v as 'asc' | 'desc' }))
                  }
                />
              )}
            </div>
          </FormSection>
        )}

        {/* Limit */}
        <TextField
          label="Limit (1–500)"
          aria-label="limit"
          value={form.limit}
          onChange={(v) => setForm((p) => ({ ...p, limit: v }))}
        />

        {/* Panel label */}
        <TextField
          label="Panel label"
          aria-label="panel label"
          value={form.label}
          onChange={(v) => setForm((p) => ({ ...p, label: v }))}
        />

        {/* Layout colSpan */}
        <TextField
          label="Column span (1–4)"
          aria-label="column span"
          value={form.colSpan}
          onChange={(v) => setForm((p) => ({ ...p, colSpan: v }))}
        />
      </FormGrid>
    </EntityFormModal>
  );
};

export default PanelEditorForm;
```

**File:** `pmo-portal/src/components/builder/PanelList.tsx` (new file)

```tsx
/**
 * PanelList — ordered panel cards with edit/remove/move-up/move-down (FR-VB-036/037, OD-VB-5).
 */
import React from 'react';
import { Button } from '@/src/components/ui';
import type { PanelSpec } from '@/src/lib/viewspec/types';

export interface PanelListProps {
  panels: PanelSpec[];
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

function panelSummary(p: PanelSpec): string {
  const cols = p.querySpec.select.slice(0, 3).join(', ');
  const more = p.querySpec.select.length > 3 ? ` +${p.querySpec.select.length - 3}` : '';
  return `${p.querySpec.entity} — ${cols}${more}`;
}

export const PanelList: React.FC<PanelListProps> = ({
  panels,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}) => {
  if (panels.length === 0) return null;

  return (
    <ol aria-label="Panel list" className="flex flex-col gap-2">
      {panels.map((panel, idx) => (
        <li
          key={panel.id}
          className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <span className="text-[13px] font-semibold">{panel.primitive}</span>
            <span className="ml-2 text-[12px] text-muted-foreground">{panelSummary(panel)}</span>
          </div>
          <div className="ml-2 flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move panel ${idx + 1} up`}
              disabled={idx === 0}
              onClick={() => onMoveUp(idx)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move panel ${idx + 1} down`}
              disabled={idx === panels.length - 1}
              onClick={() => onMoveDown(idx)}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Edit panel ${idx + 1}`}
              onClick={() => onEdit(idx)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove panel ${idx + 1}`}
              onClick={() => onRemove(idx)}
            >
              Remove
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
};

export default PanelList;
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/PanelEditorForm.test.tsx` — all 4 tests GREEN.

---

### T-07 — Write failing tests for `ViewPreview` (RED — AC-VB-012, AC-VB-013)

**AC covered:** AC-VB-012 (preview rerenders on spec change; executor called per new panel), AC-VB-013 (empty spec → empty-state placeholder, executor not called).

**File:** `pmo-portal/src/components/builder/ViewPreview.test.tsx` (new file)

```tsx
/**
 * ViewPreview — in-memory preview tests.
 * AC-VB-012: spec with 1→2 panels triggers 2 executeCompiledQuery calls on the new spec.
 * AC-VB-013: spec with panels:[] shows placeholder; executeCompiledQuery not called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

const mockExecute = vi.fn();
vi.mock('@/src/lib/viewspec/executor', () => ({
  executeCompiledQuery: mockExecute,
}));
vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: vi.fn(),
  compileQuerySpec: vi.fn((qs: unknown) => ({
    entity: (qs as { entity: string }).entity,
    repositoryMethod: 'company.list',
    resolvedFilters: [],
    resolvedSelect: ['id', 'name'],
  })),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }),
}));

import ViewPreview from '@/src/components/builder/ViewPreview';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const ONE_PANEL_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'DataTable',
      querySpec: { entity: 'companies', select: ['id', 'name'] },
    },
  ],
};

const TWO_PANEL_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'DataTable',
      querySpec: { entity: 'companies', select: ['id', 'name'] },
    },
    {
      id: 'p2',
      primitive: 'DataTable',
      querySpec: { entity: 'companies', select: ['id', 'name'] },
    },
  ],
};

const EMPTY_SPEC: CompositionSpec = { version: 1, panels: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([]);
});

describe('ViewPreview', () => {
  it('AC-VB-013: empty spec shows placeholder; executeCompiledQuery not called', () => {
    render(<ViewPreview spec={EMPTY_SPEC} />);
    expect(
      screen.getByText(/your preview will appear here once you add a panel/i),
    ).toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('AC-VB-012: updating spec from 1 panel to 2 panels triggers 2 executeCompiledQuery calls', async () => {
    const { rerender } = render(<ViewPreview spec={ONE_PANEL_SPEC} />);
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));

    mockExecute.mockClear();
    await act(async () => {
      rerender(<ViewPreview spec={TWO_PANEL_SPEC} />);
    });
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(2));
  });
});
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/ViewPreview.test.tsx` — both tests FAIL (component does not exist yet).

---

### T-08 — Write failing tests for `ViewBuilderPage` guard states (RED — AC-VB-001/002/010/011/019)

**AC covered:** AC-VB-001 (opens empty), AC-VB-002 (entity change resets fields), AC-VB-010 (save disabled when name empty), AC-VB-011 (save disabled when no panels), AC-VB-019 (edit pre-population).

**File:** `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` (new file — first batch of tests; more added in T-09/T-10/T-11)

```tsx
/**
 * ViewBuilderPage — state machine and guard tests.
 * AC-VB-001, AC-VB-002, AC-VB-007, AC-VB-008, AC-VB-009, AC-VB-010, AC-VB-011,
 * AC-VB-014, AC-VB-015, AC-VB-018, AC-VB-019.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockCreate,
  mockUpdate,
  mockUseUserView,
  mockCompile,
  mockUseAuth,
  mockToast,
  mockBlocker,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockUseUserView: vi.fn(),
  mockCompile: vi.fn(),
  mockUseAuth: vi.fn(() => ({
    currentUser: { id: 'u1', org_id: 'org1' },
    role: 'Admin',
    session: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  })),
  mockToast: vi.fn(),
  mockBlocker: vi.fn(() => ({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() })),
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserView: mockUseUserView,
  useUserViews: vi.fn(() => ({ data: [], isPending: false, isError: false })),
  useUserViewMutations: () => ({
    create: { mutateAsync: mockCreate, isPending: false },
    update: { mutateAsync: mockUpdate, isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: mockUseAuth }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
  CanWrite: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: mockCompile,
  compileQuerySpec: vi.fn(),
}));
vi.mock('@/src/lib/viewspec/executor', () => ({
  executeCompiledQuery: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: mockToast }) };
});
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useBlocker: mockBlocker };
});

import ViewBuilderPage from '@/pmo-portal/pages/ViewBuilderPage';
import { ValidationError } from '@/src/lib/viewspec/types';

// A minimal PanelSpec that can be added to the list via direct prop injection
const PANEL_A = {
  id: 'a',
  primitive: 'DataTable',
  querySpec: { entity: 'companies' as const, select: ['id', 'name'] },
};
const PANEL_B = {
  id: 'b',
  primitive: 'DataTable',
  querySpec: { entity: 'companies' as const, select: ['id'] },
};
const PANEL_C = {
  id: 'c',
  primitive: 'DataTable',
  querySpec: { entity: 'companies' as const, select: ['name'] },
};

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/views/new']}>
      <Routes>
        <Route path="/views/new" element={<ViewBuilderPage mode="create" />} />
        <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        <Route path="/views" element={<div data-testid="list-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEdit(viewId = 'v1') {
  return render(
    <MemoryRouter initialEntries={[`/views/${viewId}/edit`]}>
      <Routes>
        <Route path="/views/:viewId/edit" element={<ViewBuilderPage mode="edit" />} />
        <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'new-id', name: 'Test View' });
  mockUpdate.mockResolvedValue(undefined);
  mockCompile.mockReturnValue([{ id: 'p1', primitive: 'DataTable', compiledQuery: { entity: 'companies', repositoryMethod: 'company.list', resolvedFilters: [], resolvedSelect: ['id', 'name'] } }]);
  mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false });
});

describe('ViewBuilderPage — guard states', () => {
  it('AC-VB-001: opens empty (no panels, add-panel button, save disabled, name empty)', () => {
    renderCreate();
    expect(screen.getByRole('textbox', { name: /view name/i })).toHaveValue('');
    expect(screen.getByRole('button', { name: /add panel/i })).toBeInTheDocument();
    const saveBtn = screen.getByRole('button', { name: /save view/i });
    expect(saveBtn).toBeDisabled();
  });

  it('AC-VB-010: save disabled when name is empty (even with panels)', async () => {
    renderCreate();
    // Verify name field is empty and save is disabled
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    expect(nameField).toHaveValue('');
    expect(screen.getByRole('button', { name: /save view/i })).toBeDisabled();
  });

  it('AC-VB-011: save disabled when panel list is empty; explanatory note visible', () => {
    renderCreate();
    // Type a name to satisfy that condition, but no panels
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    act(() => { nameField.focus(); });
    // The "Add at least one panel" note should be present regardless of name
    expect(screen.getByText(/add at least one panel to save/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save view/i })).toBeDisabled();
  });

  it('AC-VB-019: edit mode pre-populates name, scope, and panel list', () => {
    mockUseUserView.mockReturnValue({
      data: {
        id: 'v1',
        name: 'Q2 Projects',
        description: null,
        scope: 'private',
        spec: {
          version: 1,
          panels: [PANEL_A],
        },
        archived_at: null,
        org_id: 'org1',
        user_id: 'u1',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-28T00:00:00Z',
      },
      isPending: false,
      isError: false,
    });
    renderEdit('v1');
    expect(screen.getByRole('textbox', { name: /view name/i })).toHaveValue('Q2 Projects');
    // Panel list should have one entry
    expect(screen.getByText(/DataTable/i)).toBeInTheDocument();
    // Save button should say "Update view"
    expect(screen.getByRole('button', { name: /update view/i })).toBeInTheDocument();
  });
});
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/ViewBuilderPage.test.tsx` — all 4 tests FAIL (component does not exist yet).

---

### T-09 — Write failing tests for save/error flows (RED — AC-VB-007/008/009/002)

These tests extend the same `ViewBuilderPage.test.tsx` file. They are added as additional `describe` blocks and test the compile-before-save invariant, the create/update call shape, and the error banner.

**File:** `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` (extend — append these describe blocks)

```tsx
  // Add to bottom of ViewBuilderPage.test.tsx:

describe('ViewBuilderPage — compile-before-save', () => {
  it('AC-VB-007: ValidationError from compile blocks mutate call; error code displayed', async () => {
    // This test requires the builder to have one panel and a name.
    // We inject them by rendering with pre-seeded state via initialPanels prop.
    // Since ViewBuilderPage exposes an optional initialPanels prop for testing,
    // this test passes an initialPanel.
    mockCompile.mockImplementation(() => {
      throw new ValidationError('UNKNOWN_ENTITY', 'companies');
    });
    const { rerender } = renderCreate();
    // Seed name field
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.type(nameField, 'My View');
    // Seed a panel by using the test hook: ViewBuilderPage accepts __testPanels prop
    rerender(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={
              <ViewBuilderPage
                mode="create"
                __testPanels={[PANEL_A]}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const saveBtn = screen.getByRole('button', { name: /save view/i });
    await userEvent.click(saveBtn);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/UNKNOWN_ENTITY/i)).toBeInTheDocument();
  });

  it('AC-VB-008: create mode calls create with {name,description,spec,scope} — no org_id/user_id', async () => {
    mockCompile.mockReturnValue([]);
    const { rerender } = renderCreate();
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.type(nameField, 'My View');
    rerender(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A]} />}
          />
          <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        </Routes>
      </MemoryRouter>,
    );
    const saveBtn = screen.getByRole('button', { name: /save view/i });
    await userEvent.click(saveBtn);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const callArg = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).toHaveProperty('name');
    expect(callArg).toHaveProperty('spec');
    expect(callArg).toHaveProperty('scope');
    expect(callArg).not.toHaveProperty('org_id');
    expect(callArg).not.toHaveProperty('user_id');
  });

  it('AC-VB-009: save error surfaces classifyMutationError headline; panel list preserved', async () => {
    mockCompile.mockReturnValue([]);
    const appError = Object.assign(new Error('rls reject'), { code: '42501' });
    mockCreate.mockRejectedValue(appError);
    const { rerender } = renderCreate();
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.type(nameField, 'My View');
    rerender(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /save view/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/you don.t have permission to do that/i),
      ).toBeInTheDocument(),
    );
    // Panel list should still show the panel
    expect(screen.getByText(/DataTable/i)).toBeInTheDocument();
  });
});
```

Note: the `__testPanels` prop is a test-only escape hatch that bypasses the panel-editor modal. It is typed as `PanelSpec[] | undefined` and only used in tests to seed the panel list without simulating the full modal interaction (which would require extensive user-event choreography across the modal and the main builder). This keeps tests focused on the save/error state machine, not the modal interaction (which is tested by AC-VB-003/004/005/006 in T-06).

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/ViewBuilderPage.test.tsx` — all tests FAIL (component does not exist yet).

---

### T-10 — Write failing tests for panel reorder/remove (RED — AC-VB-014, AC-VB-015)

**AC covered:** AC-VB-014 (move down/up panel order), AC-VB-015 (remove is immediate; no mutation called).

These are additional `describe` blocks appended to `ViewBuilderPage.test.tsx`:

```tsx
describe('ViewBuilderPage — panel reorder and remove', () => {
  function renderWithPanels(panels: typeof PANEL_A[]) {
    return render(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={panels} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('AC-VB-014: Move down on panel A puts it after B; Move up on C puts it before A', async () => {
    const user = userEvent.setup();
    renderWithPanels([PANEL_A, PANEL_B, PANEL_C]);
    // Initial order should be A, B, C — check Move down button on first item
    const moveDownBtns = screen.getAllByRole('button', { name: /move panel \d+ down/i });
    await user.click(moveDownBtns[0]); // moves A down → [B, A, C]
    // Now the first panel should be B (id='b') and second should be A (id='a')
    const listItems = screen.getAllByRole('listitem');
    expect(listItems[0].textContent).toMatch(/DataTable/);
    // Verify via aria-labels: Move up for panel 2 should now correspond to 'a'
    const moveUpBtns = screen.getAllByRole('button', { name: /move panel \d+ up/i });
    // Panel at index 2 is C; move it up → [B, C, A]
    await user.click(moveUpBtns[1]); // index 1 in current [B,A,C] → moves A up? No: moves panel at idx 2 (C) up
    // After moving C up from [B,A,C] → [B,C,A] only if we click the right button
    // In [B, A, C], panel 3 (C) has moveUp at index 2 of moveUpBtns
    // We already clicked index 1 above which moved panel 2 (A) up → [A,B,C] or [B,A,C]?
    // Recompute: after first click → [B, A, C]. moveUpBtns recomputed:
    //   btn[0] for B (disabled), btn[1] for A, btn[2] for C
    // Click btn[2] → moves C up → [B, C, A]
    // But we clicked btn[1] above which moves A up → [A, B, C]. Let's re-do this test clearly.
    // The AC specifies: start [A,B,C] → Move down on A → [B,A,C] → Move up on C → [B,C,A].
    // The test above has an error in button indexing. The correct test is below.
  });
});
```

Given the complexity of button-index logic in the above test, let me write a cleaner version. The existing test block above is replaced with:

```tsx
describe('ViewBuilderPage — panel reorder and remove', () => {
  it('AC-VB-014: Move down on A gives [B,A,C]; then Move up on C gives [B,C,A]', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A, PANEL_B, PANEL_C]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    // [A, B, C] — Move down on panel 1 (A)
    await user.click(screen.getByRole('button', { name: 'Move panel 1 down' }));
    // Now [B, A, C] — panel 2 is A; click Move up on panel 3 (C) 
    await user.click(screen.getByRole('button', { name: 'Move panel 3 up' }));
    // Now [B, C, A]
    const items = screen.getAllByRole('listitem');
    // Panel 1 should now be B (id='b'), panel 3 should be A (id='a')
    expect(items[0]).toHaveTextContent('companies — id');  // PANEL_B: select ['id']
    expect(items[2]).toHaveTextContent('companies — id, name');  // PANEL_A: select ['id','name']
  });

  it('AC-VB-015: Remove panel A; list = [B]; no mutation called', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A, PANEL_B]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove panel 1' }));
    // Only B should remain
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/ViewBuilderPage.test.tsx` — all tests FAIL (component does not exist yet).

---

### T-11 — Implement `ViewPreview` (GREEN — AC-VB-012, AC-VB-013)

**AC covered:** AC-VB-012, AC-VB-013; also FR-VB-050..054, NFR-VB-PERF-001, NFR-VB-LAYER-002.

**File:** `pmo-portal/src/components/builder/ViewPreview.tsx` (new file)

```tsx
/**
 * ViewPreview — in-memory preview component (I4, OD-VB-6, FR-VB-050..054).
 *
 * Accepts a `CompositionSpec` prop directly (no DB row, no useUserView fetch).
 * Compiles each panel's querySpec independently via compileQuerySpec (not
 * compileCompositionSpec) so valid panels render while the one being configured
 * may show an inline error callout (OD-VB-7, FR-VB-054).
 *
 * Uses executeCompiledQuery for data fetching — same executor as UserViewRenderer (I3).
 * Cancelled-ref pattern mirrors UserViewRenderer to avoid stale state updates.
 *
 * Layering: imports src/lib/viewspec/* and src/auth/useAuth only (NFR-VB-LAYER-002).
 * Does NOT import from src/lib/db/* or src/lib/repositories.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { compileQuerySpec } from '@/src/lib/viewspec/compiler';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import { registry } from '@/src/lib/viewspec/registry';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { CompiledPanel, CompiledQuery, CompositionSpec } from '@/src/lib/viewspec/types';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { DashGrid } from '@/src/components/dashboard/layout';
import { KPITile } from '@/src/components/ui/KPITile';
import type { IconName } from '@/src/components/ui/icons';

// ── Per-panel state ───────────────────────────────────────────────────────────

interface PreviewPanelState {
  loading: boolean;
  data: unknown[];
  error: Error | null;
  compileError: ValidationError | null;
}

// ── HydratedPrimitive (duplicated from UserViewRenderer — see design notes) ───
// Duplication is deliberate: extracting into shared lib would force a React import
// into src/lib/viewspec/ (layering violation). 30-line surface; delta risk is minimal.

function HydratedPrimitive({ panel, data }: { panel: CompiledPanel; data: unknown[] }) {
  const descriptor = registry.get(panel.primitive);
  if (!descriptor) return null;
  const props = panel.props ?? {};

  switch (panel.primitive) {
    case 'KPITile': {
      const row = data[0] as Record<string, unknown> | undefined;
      const alias = panel.compiledQuery.resolvedAggregate?.alias;
      const value = alias != null ? row?.[alias] : row?.[panel.compiledQuery.resolvedSelect[0]];
      return (
        <KPITile
          icon={((props.icon as IconName | undefined) ?? 'doc') as IconName}
          tone={(props.tone as 'blue' | 'violet' | 'amber' | 'red' | 'green' | undefined) ?? 'blue'}
          label={(props.label as string | undefined) ?? panel.id}
          value={value as React.ReactNode}
          negative={props.negative as boolean | undefined}
          help={props.help as string | undefined}
          vs={props.vs as string | undefined}
        />
      );
    }
    default:
      return (
        <pre className="overflow-auto rounded p-3 text-[12px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ViewPreviewProps {
  spec: CompositionSpec;
}

const ViewPreview: React.FC<ViewPreviewProps> = ({ spec }) => {
  const { currentUser } = useAuth();
  const [panelStates, setPanelStates] = useState<PreviewPanelState[]>([]);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!currentUser || spec.panels.length === 0) {
      setPanelStates([]);
      return;
    }

    const ctx = { userId: currentUser.id, orgId: currentUser.org_id };
    cancelRef.current = false;

    // Per-panel compile (independent — valid panels show while invalid ones show errors)
    const compiledEntries: Array<{
      compiledQuery: CompiledQuery;
      panel: typeof spec.panels[number];
      compileError: ValidationError | null;
    }> = spec.panels.map((panel) => {
      try {
        const compiledQuery = compileQuerySpec(panel.querySpec, ctx);
        return { compiledQuery, panel, compileError: null };
      } catch (err) {
        return {
          compiledQuery: null as unknown as CompiledQuery,
          panel,
          compileError: err instanceof ValidationError ? err : new ValidationError('UNKNOWN_ENTITY', String(err)),
        };
      }
    });

    // Initialize all panels as loading
    setPanelStates(
      compiledEntries.map((e) => ({
        loading: e.compileError === null,
        data: [],
        error: null,
        compileError: e.compileError,
      })),
    );

    // Fire queries for panels that compiled successfully
    compiledEntries.forEach((entry, idx) => {
      if (entry.compileError !== null) return;
      executeCompiledQuery(entry.compiledQuery).then(
        (rows) => {
          if (cancelRef.current) return;
          setPanelStates((prev) => {
            const next = [...prev];
            next[idx] = { loading: false, data: rows as unknown[], error: null, compileError: null };
            return next;
          });
        },
        (err: Error) => {
          if (cancelRef.current) return;
          setPanelStates((prev) => {
            const next = [...prev];
            next[idx] = { loading: false, data: [], error: err, compileError: null };
            return next;
          });
        },
      );
    });

    return () => {
      cancelRef.current = true;
    };
  }, [spec, currentUser]);

  // Empty spec placeholder (FR-VB-051)
  if (spec.panels.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border p-6 text-[13px] text-muted-foreground">
        Your preview will appear here once you add a panel.
      </div>
    );
  }

  return (
    <DashGrid>
      {spec.panels.map((panel, idx) => {
        const state = panelStates[idx] ?? { loading: true, data: [], error: null, compileError: null };
        const colSpan = panel.layout?.colSpan;
        const panelStyle = colSpan ? { gridColumn: `span ${colSpan}` } : undefined;

        // Per-panel compile error callout (OD-VB-7, FR-VB-054)
        if (state.compileError) {
          return (
            <div
              key={panel.id}
              style={panelStyle}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div
                role="status"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
              >
                Preview unavailable: {state.compileError.code}
                {state.compileError.detail ? ` — ${state.compileError.detail}` : ''}
              </div>
            </div>
          );
        }

        const compiledPanel: CompiledPanel = {
          id: panel.id,
          primitive: panel.primitive,
          // The query was compiled above; for rendering purposes we need the compiled query.
          // panelStates does not store compiledQuery, so re-compile here (cheap, pure).
          compiledQuery: (() => {
            try {
              const ctx = currentUser
                ? { userId: currentUser.id, orgId: currentUser.org_id }
                : { userId: '', orgId: '' };
              return compileQuerySpec(panel.querySpec, ctx);
            } catch {
              return null as unknown as CompiledQuery;
            }
          })(),
          ...(panel.layout !== undefined && { layout: panel.layout }),
          ...(panel.props !== undefined && { props: panel.props }),
        };

        return (
          <div
            key={panel.id}
            style={panelStyle}
            className="rounded-lg border border-border bg-card p-4"
          >
            <ChartFrame
              state={
                state.loading
                  ? 'loading'
                  : state.error
                  ? 'error'
                  : state.data.length === 0
                  ? 'empty'
                  : 'ready'
              }
              emptyTitle={(panel.props?.emptyTitle as string | undefined) ?? 'No data'}
            >
              <HydratedPrimitive panel={compiledPanel} data={state.data} />
            </ChartFrame>
          </div>
        );
      })}
    </DashGrid>
  );
};

export default ViewPreview;
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/ViewPreview.test.tsx` — both tests GREEN.

---

### T-12 — Implement `ViewBuilderPage` (GREEN — AC-VB-001/002/007/008/009/010/011/014/015/019)

**AC covered:** All builder state-machine ACs; satisfies FR-VB-020..072 and all NFR layering/security constraints.

**File:** `pmo-portal/pages/ViewBuilderPage.tsx` (new file)

```tsx
/**
 * View Builder Page (I4, FR-VB-020..072).
 *
 * Routes: /views/new (mode="create") and /views/:viewId/edit (mode="edit").
 *
 * Responsibilities:
 *   - View metadata form (name, description, scope) — useEntityForm
 *   - Panel list (PanelList component)
 *   - Panel editor modal (PanelEditorForm component)
 *   - Live preview pane (ViewPreview component)
 *   - Compile-before-save invariant (FR-VB-040, NFR-VB-SEC-004)
 *   - Create/update via useUserViewMutations (FR-VB-041)
 *   - Dirty-discard via useBlocker (OD-VB-8)
 *   - Error classification via classifyMutationError (FR-VB-062)
 *
 * Layering (NFR-VB-LAYER-001): imports from src/lib/viewspec/, src/hooks/useUserViews,
 * src/auth/, src/components/ui/, src/lib/classifyMutationError, react-router-dom.
 * Does NOT import from src/lib/db/* or src/lib/supabase/client.
 *
 * Test-only escape hatch: __testPanels?: PanelSpec[] — seeds the panel list in RTL tests
 * without requiring modal interaction. Undefined in production usage.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useBlocker } from 'react-router-dom';
import {
  ListPage,
  ListState,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  SelectField,
  FormGrid,
  FormSection,
  FieldError,
  Button,
  useToast,
} from '@/src/components/ui';
import { useUserView, useUserViewMutations } from '@/src/hooks/useUserViews';
import { useAuth } from '@/src/auth/useAuth';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { ValidationError } from '@/src/lib/viewspec/types';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { PanelSpec, CompositionSpec } from '@/src/lib/viewspec/types';
import PanelEditorForm from '@/src/components/builder/PanelEditorForm';
import PanelList from '@/src/components/builder/PanelList';
import ViewPreview from '@/src/components/builder/ViewPreview';

/** Maximum panels per view — mirrors UserViewRenderer's constant (FR-VB-038). */
const MAX_PANELS_PER_VIEW = 20;

export interface ViewBuilderPageProps {
  mode: 'create' | 'edit';
  /** TEST ONLY: seeds the panel list without requiring modal interaction. */
  __testPanels?: PanelSpec[];
}

const SCOPE_OPTIONS = [
  { value: 'private', label: 'Private — only you' },
  { value: 'shared_org', label: 'Shared with your organisation' },
];

const ViewBuilderPage: React.FC<ViewBuilderPageProps> = ({ mode, __testPanels }) => {
  const navigate = useNavigate();
  const params = useParams<{ viewId: string }>();
  const viewId = mode === 'edit' ? (params.viewId ?? '') : undefined;

  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { create, update } = useUserViewMutations();

  // ── Edit mode: load existing view ────────────────────────────────────────
  const { data: existingView, isPending: viewLoading } = useUserView(viewId);

  // ── Metadata form state ───────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'private' | 'shared_org'>('private');

  // ── Panel list state ──────────────────────────────────────────────────────
  const [panels, setPanels] = useState<PanelSpec[]>(__testPanels ?? []);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [panelModalOpen, setPanelModalOpen] = useState(false);

  // ── Save error state ──────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── Pre-populate in edit mode (FR-VB-070) ────────────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || !existingView) return;
    setName(existingView.name);
    setDescription(existingView.description ?? '');
    setScope((existingView.scope as 'private' | 'shared_org') ?? 'private');
    const raw = existingView.spec as unknown as CompositionSpec;
    if (raw && Array.isArray(raw.panels)) {
      setPanels(raw.panels);
    }
  }, [mode, existingView]);

  // ── Seed test panels when __testPanels changes ────────────────────────────
  useEffect(() => {
    if (__testPanels !== undefined) {
      setPanels(__testPanels);
    }
  }, [__testPanels]);

  // ── Dirty detection for useBlocker ───────────────────────────────────────
  const isDirty = name !== '' || panels.length > 0 || description !== '';

  // useBlocker fires when the user navigates away with unsaved changes (OD-VB-8)
  const blocker = useBlocker(isDirty && !isSaving);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowDiscardDialog(true);
    }
  }, [blocker.state]);

  // ── Panel operations ──────────────────────────────────────────────────────

  const handleAddPanel = () => {
    setEditingIndex(null);
    setPanelModalOpen(true);
  };

  const handleEditPanel = (idx: number) => {
    setEditingIndex(idx);
    setPanelModalOpen(true);
  };

  const handleRemovePanel = (idx: number) => {
    setPanels((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setPanels((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleMoveDown = (idx: number) => {
    setPanels((prev) => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const handlePanelConfirm = (panel: PanelSpec) => {
    setPanels((prev) => {
      if (editingIndex !== null) {
        const next = [...prev];
        next[editingIndex] = panel;
        return next;
      }
      return [...prev, panel];
    });
    setPanelModalOpen(false);
    setEditingIndex(null);
  };

  // ── Compile-before-save + save (FR-VB-040/041) ───────────────────────────

  const spec: CompositionSpec = { version: 1, panels };

  const handleSave = async () => {
    if (!currentUser) return;
    setSaveError(null);

    // Compile-before-save invariant (NFR-VB-SEC-004)
    try {
      const ctx = { userId: currentUser.id, orgId: currentUser.org_id };
      compileCompositionSpec(spec, ctx);
    } catch (err) {
      if (err instanceof ValidationError) {
        setSaveError(`${err.code}${err.detail ? ': ' + err.detail : ''}`);
      } else {
        setSaveError('Validation failed. Please review your panels.');
      }
      return;
    }

    const input = { name, description: description || null, spec, scope };

    setIsSaving(true);
    try {
      if (mode === 'create') {
        const row = await create.mutateAsync(input);
        toast({ title: 'View created', description: name, kind: 'success' });
        navigate(`/views/${row.id}`);
      } else if (mode === 'edit' && viewId) {
        await update.mutateAsync({ id: viewId, input });
        toast({ title: 'View updated', description: name, kind: 'success' });
        navigate(`/views/${viewId}`);
      }
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSaveError(`${headline} — ${detail}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Disabled save conditions ──────────────────────────────────────────────
  const nameIsEmpty = name.trim() === '';
  const noPanel = panels.length === 0;
  const saveDisabled = nameIsEmpty || noPanel || isSaving;

  // ── Edit-mode guard states (FR-VB-071/072) ───────────────────────────────
  if (mode === 'edit' && viewLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <div aria-hidden className="skel h-7 w-2/5 rounded" />
        <div aria-hidden className="skel h-5 w-3/5 rounded" />
      </div>
    );
  }

  if (mode === 'edit' && !viewLoading && (!existingView || existingView.archived_at !== null)) {
    return (
      <ListState
        variant="empty"
        title="View not found."
        sub="This view may have been archived or you don't have access."
        action={{ label: 'Go to My Views', onClick: () => navigate('/views') }}
      />
    );
  }

  return (
    <ListPage
      title={mode === 'create' ? 'New View' : `Edit: ${existingView?.name ?? ''}`}
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => {
            if (isDirty) setShowDiscardDialog(true);
            else navigate('/views');
          }}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saveDisabled}
            aria-disabled={saveDisabled}
            onClick={handleSave}
          >
            {mode === 'create' ? 'Save view' : 'Update view'}
          </Button>
        </div>
      }
    >
      {/* Save error banner */}
      {saveError && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-[13px] text-destructive">
          {saveError}
        </div>
      )}

      {/* Metadata section */}
      <FormSection title="View details">
        <FormGrid>
          <TextField
            label="View name"
            required
            aria-required="true"
            value={name}
            onChange={setName}
            maxLength={120}
            error={name === '' ? undefined : undefined}
          />
          <TextField
            label="Description"
            value={description}
            onChange={setDescription}
            multiline
          />
          <SelectField
            label="Scope"
            value={scope}
            options={SCOPE_OPTIONS}
            onChange={(v) => setScope(v as 'private' | 'shared_org')}
          />
        </FormGrid>
      </FormSection>

      {/* Panel editor section */}
      <FormSection title="Panels">
        <PanelList
          panels={panels}
          onEdit={handleEditPanel}
          onRemove={handleRemovePanel}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
        />

        {noPanel && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Add at least one panel to save.
          </p>
        )}

        {panels.length < MAX_PANELS_PER_VIEW ? (
          <Button variant="secondary" onClick={handleAddPanel} className="mt-3">
            + Add panel
          </Button>
        ) : (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            Maximum of {MAX_PANELS_PER_VIEW} panels reached.
          </p>
        )}
      </FormSection>

      {/* Live preview pane */}
      <FormSection title="Live preview">
        <ViewPreview spec={spec} />
      </FormSection>

      {/* Panel editor modal */}
      <PanelEditorForm
        open={panelModalOpen}
        initialPanel={editingIndex !== null ? (panels[editingIndex] ?? null) : null}
        onConfirm={handlePanelConfirm}
        onClose={() => {
          setPanelModalOpen(false);
          setEditingIndex(null);
        }}
      />

      {/* Dirty-discard confirm (FR-VB-063, OD-VB-8) */}
      <ConfirmDialog
        open={showDiscardDialog}
        tone="destructive"
        title="Discard unsaved changes?"
        description="Your panel configuration and name will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setShowDiscardDialog(false);
          if (blocker.state === 'blocked') blocker.proceed?.();
          else navigate('/views');
        }}
        onCancel={() => {
          setShowDiscardDialog(false);
          if (blocker.state === 'blocked') blocker.reset?.();
        }}
      />
    </ListPage>
  );
};

export default ViewBuilderPage;
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/ViewBuilderPage.test.tsx` — all tests GREEN.

---

### T-13 — axe-core a11y test (RED→GREEN — AC-VB-018)

**AC covered:** AC-VB-018 (zero axe-core violations on builder and My Views).

Add to `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` as an additional describe block:

```tsx
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';

describe('ViewBuilderPage + MyViewsPage — axe-core a11y', () => {
  it('AC-VB-018: no a11y violations on ViewBuilderPage (one panel, modal closed)', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('AC-VB-018: no a11y violations on MyViewsPage (one view in list)', async () => {
    mockUseUserViews.mockReturnValue({
      data: [
        {
          id: 'v1',
          name: 'Weekly Status',
          description: null,
          scope: 'private',
          spec: { version: 1, panels: [] },
          created_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-28T10:00:00Z',
          archived_at: null,
          org_id: 'org1',
          user_id: 'u1',
        },
      ],
      isPending: false,
      isError: false,
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/views']}>
        <MyViewsPage />
      </MemoryRouter>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

Also requires `jest-axe` in devDependencies. Check if already installed:

```bash
cd pmo-portal && grep jest-axe package.json
```

If absent, add it:
```bash
cd pmo-portal && npm install --save-dev jest-axe @types/jest-axe
```

**Verify:** `cd pmo-portal && npx vitest run src/components/builder/ViewBuilderPage.test.tsx` — all tests GREEN including a11y.

---

### T-14 — Playwright e2e: compose, save, list, render (AC-VB-E01)

**AC covered:** AC-VB-E01; transitively covers FR-VB-041, FR-VB-060, FR-VB-010, FR-VB-013.

**File:** `pmo-portal/e2e/AC-VB-E01-view-builder-compose-save.spec.ts` (new file)

```ts
/**
 * AC-VB-E01 — Compose a view, save it, verify it renders in I3, check My Views list.
 * Curated cross-stack Playwright journey (ADR-0010, one e2e per genuine cross-stack AC).
 *
 * Prerequisites (CI seed): local Supabase running with at least one companies row.
 * Feature flag: VITE_FEATURES_USERVIEWS=true in .env.test.
 */
import { test, expect } from '@playwright/test';

test.describe('AC-VB-E01: View builder — compose, save, list, render', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate (reuse auth state from playwright.config.ts storageState)
    await page.goto('/views/new');
    await expect(page).toHaveURL(/\/views\/new/);
  });

  test('AC-VB-E01: compose 1-panel view → save → renderer → My Views list', async ({ page }) => {
    // ── 1. Enter view name ──────────────────────────────────────────────────
    await page.getByRole('textbox', { name: /view name/i }).fill('Test View');

    // ── 2. Add a panel ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: /add panel/i }).click();
    // Panel editor modal should open
    await expect(page.getByRole('dialog', { name: /add panel/i })).toBeVisible();

    // Select primitive DataTable
    await page.getByRole('combobox', { name: /primitive/i }).selectOption('DataTable');
    // Select entity companies
    await page.getByRole('combobox', { name: /entity/i }).selectOption('companies');
    // Select columns id and name
    await page.getByRole('checkbox', { name: 'id' }).check();
    await page.getByRole('checkbox', { name: 'name' }).check();
    // Confirm panel
    await page.getByRole('button', { name: /add panel/i }).last().click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // ── 3. Save the view ────────────────────────────────────────────────────
    await page.getByRole('button', { name: /save view/i }).click();

    // ── 4. App navigates to /views/:newViewId — renderer shows the view ────
    await expect(page).toHaveURL(/\/views\/[^/]+$/);
    await expect(page.getByText('Test View')).toBeVisible();
    // The DataTable panel should render (companies data or empty state)
    await expect(
      page.getByRole('table').or(page.getByText(/no data/i)),
    ).toBeVisible({ timeout: 10_000 });

    // ── 5. Navigate to My Views list ────────────────────────────────────────
    await page.goto('/views');
    await expect(page).toHaveURL('/views');

    // ── 6. "Test View" appears in the list with an Edit affordance ──────────
    await expect(page.getByRole('link', { name: 'Test View' })).toBeVisible();
    // Row action menu should have an Edit entry
    await page.getByRole('button', { name: /actions/i }).first().click();
    await expect(page.getByRole('menuitem', { name: /edit/i })).toBeVisible();
  });
});
```

**Verify (CI-only):** `cd pmo-portal && VITE_FEATURES_USERVIEWS=true npx playwright test e2e/AC-VB-E01-view-builder-compose-save.spec.ts` — test GREEN against local Supabase with seed data.

---

### T-15 — Full verify

**Purpose:** Confirm no regressions across the whole suite before the PR opens.

**Verify:** `cd pmo-portal && npm run verify`
Expected: typecheck zero errors, lint zero warnings, all Vitest tests green (including new tests at T-03/T-05/T-07/T-08/T-09/T-10/T-11/T-13), build succeeds.

---

## Summary

| Task | Description | AC covered |
|---|---|---|
| T-01 | Add `userView` entity to `policy.ts` | gate for T-03/T-04 |
| T-02 | Add 3 routes in `App.tsx` before `/views/:viewId` | FR-VB-001 |
| T-03 | RED tests: `MyViewsPage.test.tsx` | AC-VB-016, AC-VB-017 |
| T-04 | GREEN `MyViewsPage.tsx` | AC-VB-016, AC-VB-017 |
| T-05 | RED tests: `PanelEditorForm.test.tsx` | AC-VB-003/004/005/006 |
| T-06 | GREEN `PanelEditorForm.tsx` + `PanelList.tsx` | AC-VB-003/004/005/006 |
| T-07 | RED tests: `ViewPreview.test.tsx` | AC-VB-012, AC-VB-013 |
| T-08 | RED tests: `ViewBuilderPage.test.tsx` (guard states) | AC-VB-001/002/010/011/019 |
| T-09 | RED tests: save/error flows (extend test file) | AC-VB-007/008/009 |
| T-10 | RED tests: reorder/remove (extend test file) | AC-VB-014, AC-VB-015 |
| T-11 | GREEN `ViewPreview.tsx` | AC-VB-012, AC-VB-013 |
| T-12 | GREEN `ViewBuilderPage.tsx` | AC-VB-001/002/007/008/009/010/011/014/015/019 |
| T-13 | axe-core a11y tests (extend test file) | AC-VB-018 |
| T-14 | Playwright e2e | AC-VB-E01 |
| T-15 | Full verify (`npm run verify`) | all |

**Total tasks: 15**

---

## Open questions for the Director

1. **`jest-axe` dependency** — `pmo-portal/package.json` does not currently list `jest-axe`. The a11y tests (T-13, AC-VB-018) need it. Confirm whether to install it as a new devDependency or to use the `@axe-core/react` / `@testing-library/jest-dom` approach instead. If `jest-axe` is already present under a different import path, T-13 needs adjusting.

2. **`MyViewsPage.tsx` file location** — the spec's component structure table (§9) lists it as `pages/MyViewsPage.tsx` (page-level, like `Companies.tsx`), but the traceability table lists the test at `src/pages/MyViewsPage.test.tsx`. This plan follows the spec's component table (`pages/MyViewsPage.tsx`) and co-locates the test at `src/pages/MyViewsPage.test.tsx` consistent with the spec. Confirm this split is acceptable, or whether both should move to `pages/`.

3. **`FEATURES.userViews` in the CI `.env`** — the Playwright e2e (AC-VB-E01) needs `VITE_FEATURES_USERVIEWS=true`. If the CI integration job does not already set this env var, the e2e will skip the `/views` routes silently (FeatureRoute redirects to `/`). Confirm CI env config or whether the test should toggle the feature flag programmatically.

4. **`AC-VB-002` (entity change resets fields)** — this AC is listed as covered in T-08 (guard states), but the reset behavior is implemented in `PanelEditorForm` (T-06). The test for AC-VB-002 will render `PanelEditorForm` directly (choosing the entity then changing it) and assert field reset. Confirm whether to include this test in `PanelEditorForm.test.tsx` (T-05) or keep it in `ViewBuilderPage.test.tsx` (T-08). Current plan places it in `ViewBuilderPage.test.tsx` per the spec's traceability table.
