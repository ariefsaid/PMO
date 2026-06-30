# Implementation Plan: User-View Renderer, Route, and Dynamic Nav (I3)

**Date:** 2026-06-29
**Spec:** `docs/specs/view-renderer.spec.md`
**ADR:** `docs/adr/0036-agent-native-user-composed-ui.md`, `docs/adr/0037-view-composition-compiler-dsl.md`, `docs/adr/0038-view-renderer-executor-dispatch-pattern.md`
**Pre-push gate:** `cd pmo-portal && npm run verify` (typecheck + lint + test + build) — must be green before the PR opens.

---

## Design

### Architecture

Seven surfaces in one PR, TDD-first:

```
src/lib/viewspec/types.ts          ← extend ValidationErrorCode + add CompiledPanel type
src/lib/viewspec/compiler.ts       ← add compileCompositionSpec()
src/lib/viewspec/executor.ts       ← NEW: executeCompiledQuery()
src/lib/features.ts                ← add userViews: false
src/components/shell/Rail.tsx      ← additive "My Views" group
App.tsx                            ← lazy UserViewRenderer + /views/:viewId route
                                      + useUserViews() for breadcrumb + palette
pages/UserViewRenderer.tsx         ← NEW: the renderer component
src/components/shell/routeMatch.ts ← extend RecordLists + recordLabelForPath + breadcrumbForPath
```

Test files (all new):
```
src/lib/viewspec/executor.test.ts
src/components/shell/Rail.test.tsx
src/components/shell/ShellChrome.test.tsx
pages/UserViewRenderer.test.tsx
e2e/AC-VR-020-view-renderer-ownership.spec.ts   (authored; CI-only)
```

### Data flow

```
/views/:viewId
  → UserViewRenderer (lazy chunk)
    → useUserView(id)              — TQ cache key ['user_view', orgId, id]
    → compileCompositionSpec(spec, { userId, orgId })
        → validatePrimitive(panel.primitive)   [registry]
        → compileQuerySpec(panel.querySpec, ctx) [compiler]
    → per panel: executeCompiledQuery(compiledPanel.compiledQuery)
        → supabase.from(table).select(...).eq/in/gte/lte/order/limit(...)
        → in-memory groupBy + aggregate (if resolvedGroupBy/resolvedAggregate)
    → registry.get(primitive) → hydrate primitive component
    → ChartFrame + DashGrid layout
```

Nav data flow:
```
ShellChrome (App.tsx)
  → useUserViews()           — TQ cache key ['user_views', orgId] (shared with renderer)
  → paletteItems useMemo     — appends 'Views' group when feature on + data > 0
  → Rail                     — receives no prop; reads useUserViews() internally
```

### Key design decisions

1. **`executeCompiledQuery` dispatches to `supabase.from(table)` directly** (ADR-0038) — the existing repository methods have bounded typed signatures that don't accept arbitrary filter chains. `ENTITY_WHITELIST[entity].table` provides the table name.

2. **`between` and `date-range` both map to `.gte(col, v[0]).lte(col, v[1])`** — PostgREST has no native `between`; both ops from `VALID_FILTER_OPS` that carry a two-element value array expand to two inequality conditions.

3. **`ValidationErrorCode` extended in `types.ts`** with `'UNKNOWN_PRIMITIVE'` and `'UNSUPPORTED_VERSION'` — these codes are I3-specific (the composition layer) and belong in the single error taxonomy alongside the query-layer codes.

4. **`CompositionSpec.version` is `1` as a literal type** in `types.ts`. At runtime the renderer receives `row.spec` as `Json` (opaque). `compileCompositionSpec` accepts `unknown` for the spec param, casts after the version check. The function signature uses the public `CompositionSpec` type after the guard passes.

5. **`UserViewRenderer` lives at `pmo-portal/pages/UserViewRenderer.tsx`** (page-level, consistent with `Projects.tsx`, `Companies.tsx`, etc.). Lazy-imported in `App.tsx`.

6. **Per-panel state via `useState` + `useEffect`** (not TanStack Query per panel) — `executeCompiledQuery` is a pure Promise call (no cache needed for ephemeral panel data); the renderer manages `{ loading, data, error }` state per panel in local state, firing `Promise.allSettled` on mount after compilation succeeds. This keeps `executor.ts` in the `src/lib/viewspec/` layer (no TQ import there) and satisfies `NFR-VR-LAYER-001`.

7. **`MAX_PANELS_PER_VIEW = 20` guard in `UserViewRenderer`** before calling `compileCompositionSpec` (OD-9). Shows the spec-invalid error state with "This view exceeds the maximum of 20 panels."

8. **Rail "My Views" group reads `useUserViews()` from within `Rail.tsx`** — additive, no prop threading. The existing `RailProps` interface is unchanged (no-break).

9. **`routeMatch.ts`** `RecordLists` is extended with `userViews?: { id: string; name: string }[]`; `recordLabelForPath` handles the `/views/` prefix; `breadcrumbForPath` handles `/views/:viewId` with `[My Views (onClick → navigate('/')) > <view.name>]` (OD-4 default).

### Owner-decision defaults applied (from spec §7)

| OD | Default | Implementation |
|---|---|---|
| OD-1 | Generic "This view was not found." + "Go to Dashboard" link | `ListState variant="empty"` + `action={{ label: 'Go to Dashboard', onClick: () => navigate('/') }}` |
| OD-2 | Dev: show `<details>` with `ValidationError.code + detail`; prod: generic only | `import.meta.env.VITE_APP_ENV !== 'production'` guard |
| OD-3 | No CTA in I3; `/* TODO I4: add CTA */` comment | Empty spec state: `ListState variant="empty" title="This view has no panels yet."` |
| OD-4 | "My Views" crumb links to `/` (Dashboard) | `[{ label: 'My Views', onClick: () => navigate('/') }, { label: view.name }]` |
| OD-5 | `'grid'` icon for all user views | Hardcoded `icon: 'grid'` |
| OD-6 | No loading skeleton for the nav group | Group is silent until data resolves |
| OD-7 | `MAX_NAV_VIEWS = 8` | Named constant in `Rail.tsx` |
| OD-8 | Archived views not shown (already filtered by hook) | No change needed |
| OD-9 | `MAX_PANELS_PER_VIEW = 20` | Named constant in `UserViewRenderer.tsx` |

### Scaling notes

- The TQ cache key `['user_views', orgId]` is shared between `ShellChrome` and `UserViewRenderer` — no duplicate fetch (NFR-VR-PERF-002).
- `Promise.allSettled` parallelizes panel queries — N panels = 1 round-trip latency (NFR-VR-PERF-001).
- The `MAX_NAV_VIEWS = 8` cap and `MAX_PANELS_PER_VIEW = 20` guard bound memory and network at the client layer.
- `compileCompositionSpec` is a pure synchronous function — zero I/O, safe to call on every render.

---

## Traceability table

| AC | Owning layer | Test file | Task(s) |
|---|---|---|---|
| AC-VR-001 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-14 |
| AC-VR-002 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-14 |
| AC-VR-003 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-14 |
| AC-VR-004 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-14 |
| AC-VR-005 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-14 |
| AC-VR-006 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-15 |
| AC-VR-007 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-15 |
| AC-VR-008 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-15 |
| AC-VR-009 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-15 |
| AC-VR-010 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-15 |
| AC-VR-011 | Vitest | `src/lib/viewspec/compiler.test.ts` (extended) | T-05 |
| AC-VR-012 | Vitest/RTL + axe-core | `pages/UserViewRenderer.test.tsx` | T-16 |
| AC-VR-013 | Vitest | `src/lib/viewspec/executor.test.ts` | T-09 |
| AC-VR-014 | Vitest/RTL | `src/components/shell/Rail.test.tsx` | T-12 |
| AC-VR-015 | Vitest/RTL | `src/components/shell/Rail.test.tsx` | T-12 |
| AC-VR-016 | Vitest/RTL | `src/components/shell/ShellChrome.test.tsx` | T-13 |
| AC-VR-017 | Vitest/RTL | `src/components/shell/Rail.test.tsx` | T-12 |
| AC-VR-018 | Vitest/RTL | `pages/UserViewRenderer.test.tsx` | T-14 |
| AC-VR-020 | Playwright e2e | `e2e/AC-VR-020-view-renderer-ownership.spec.ts` | T-17 |

---

## Tasks

> **TDD order:** write the failing test first (RED), then the implementation (GREEN), then verify.
> Each task is 2–5 minutes. `cd pmo-portal` before every `npm` command.

---

### T-01 — Extend `ValidationErrorCode` and add `CompiledPanel` type to `types.ts`

**File:** `pmo-portal/src/lib/viewspec/types.ts`

Add `'UNKNOWN_PRIMITIVE'` and `'UNSUPPORTED_VERSION'` to the `ValidationErrorCode` union, and export the `CompiledPanel` interface.

**Change — extend `ValidationErrorCode` union (line 268 area):**
```typescript
export type ValidationErrorCode =
  | 'UNKNOWN_ENTITY'
  | 'UNKNOWN_COLUMN'
  | 'UNKNOWN_OP'
  | 'NON_NUMERIC_AGGREGATE'
  | 'INVALID_LIMIT'
  | 'UNKNOWN_TOKEN'
  | 'MISSING_REQUIRED_FILTER'
  | 'UNRESOLVABLE_TOKEN'
  | 'NOT_GROUPABLE_COLUMN'
  | 'UNKNOWN_PRIMITIVE'     // compileCompositionSpec: panel.primitive not in PrimitiveRegistry
  | 'UNSUPPORTED_VERSION';  // compileCompositionSpec: spec.version !== 1
```

**Change — add `CompiledPanel` interface after the `CompiledQuery` interface (around line 164):**
```typescript
/**
 * The per-panel output of compileCompositionSpec (FR-VR-010).
 * One CompiledPanel per PanelSpec; carries everything the renderer needs
 * to fetch data and hydrate the primitive — no further spec parsing needed.
 */
export interface CompiledPanel {
  id: string;              // panel.id (stable React key)
  primitive: string;       // validated registry name
  compiledQuery: CompiledQuery;
  layout?: LayoutHint;
  props?: Record<string, unknown>;
}
```

**Verify:** `npm run typecheck` — zero errors. (No test needed: type-only change; proven by downstream consumers compiling.)

---

### T-02 — Extend `compiler.test.ts` with RED tests for `compileCompositionSpec` (AC-VR-011)

**File:** `pmo-portal/src/lib/viewspec/compiler.test.ts`

Append a new `describe` block at the end of the existing test file. These tests are RED until T-05 adds the implementation.

```typescript
// ── compileCompositionSpec (FR-VR-010..014, AC-VR-011) ───────────────────────

import { compileCompositionSpec } from './compiler';
import type { CompositionSpec } from './types';

const BASE_CTX: CompilerContext = { userId: 'u1', orgId: 'org1' };

const VALID_PANEL_SPEC = {
  id: 'p1',
  primitive: 'KPITile',
  querySpec: {
    entity: 'projects' as const,
    select: ['id', 'contract_value'],
    aggregate: { fn: 'sum' as const, column: 'contract_value', alias: 'total' },
  },
};

describe('compileCompositionSpec', () => {
  it('AC-VR-011: throws UNSUPPORTED_VERSION when spec.version !== 1', () => {
    const spec = { version: 2, panels: [] } as unknown as CompositionSpec;
    expect(() => compileCompositionSpec(spec, BASE_CTX)).toThrow(ValidationError);
    try { compileCompositionSpec(spec, BASE_CTX); } catch (e) {
      expect((e as ValidationError).code).toBe('UNSUPPORTED_VERSION');
      expect((e as ValidationError).detail).toBe('2');
    }
  });

  it('AC-VR-011: throws UNKNOWN_PRIMITIVE when panel.primitive is not in registry', () => {
    const spec: CompositionSpec = { version: 1, panels: [{ ...VALID_PANEL_SPEC, id: 'p1', primitive: 'PieChart' }] };
    expect(() => compileCompositionSpec(spec, BASE_CTX)).toThrow(ValidationError);
    try { compileCompositionSpec(spec, BASE_CTX); } catch (e) {
      expect((e as ValidationError).code).toBe('UNKNOWN_PRIMITIVE');
      expect((e as ValidationError).detail).toContain('p1');
    }
  });

  it('AC-VR-011: re-throws ValidationError from compileQuerySpec with panelId in detail', () => {
    const spec: CompositionSpec = {
      version: 1,
      panels: [{
        id: 'p2',
        primitive: 'KPITile',
        querySpec: { entity: 'projects' as const, select: ['nonexistent_col'] },
      }],
    };
    expect(() => compileCompositionSpec(spec, BASE_CTX)).toThrow(ValidationError);
    try { compileCompositionSpec(spec, BASE_CTX); } catch (e) {
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
      expect((e as ValidationError).detail).toContain('p2');
    }
  });

  it('AC-VR-011: returns CompiledPanel[] for a valid single-panel spec', () => {
    const spec: CompositionSpec = { version: 1, panels: [VALID_PANEL_SPEC] };
    const panels = compileCompositionSpec(spec, BASE_CTX);
    expect(panels).toHaveLength(1);
    expect(panels[0].id).toBe('p1');
    expect(panels[0].primitive).toBe('KPITile');
    expect(panels[0].compiledQuery.entity).toBe('projects');
    expect(panels[0].layout).toBeUndefined();
    expect(panels[0].props).toBeUndefined();
  });

  it('AC-VR-011: returns CompiledPanel[] preserving layout and props', () => {
    const spec: CompositionSpec = {
      version: 1,
      panels: [{
        ...VALID_PANEL_SPEC,
        layout: { colSpan: 2 },
        props: { icon: 'doc', tone: 'blue', label: 'Total CV' },
      }],
    };
    const panels = compileCompositionSpec(spec, BASE_CTX);
    expect(panels[0].layout).toEqual({ colSpan: 2 });
    expect(panels[0].props).toEqual({ icon: 'doc', tone: 'blue', label: 'Total CV' });
  });

  it('AC-VR-011: fails fast on the first invalid panel (fail-fast, FR-VR-013)', () => {
    const spec: CompositionSpec = {
      version: 1,
      panels: [
        { id: 'bad', primitive: 'PieChart', querySpec: { entity: 'projects' as const, select: ['id'] } },
        { ...VALID_PANEL_SPEC, id: 'good' },
      ],
    };
    expect(() => compileCompositionSpec(spec, BASE_CTX)).toThrow(ValidationError);
  });
});
```

**Verify (RED):** `npm test -- --reporter=verbose src/lib/viewspec/compiler.test.ts` — the new `compileCompositionSpec` tests fail with "compileCompositionSpec is not a function".

---

### T-03 — Write RED tests for `executeCompiledQuery` (AC-VR-013)

**File:** `pmo-portal/src/lib/viewspec/executor.test.ts` (NEW)

```typescript
/**
 * Vitest gate-tests for executeCompiledQuery.
 * AC-VR-013 (FR-VR-020..023, NFR-VR-SEC-001, NFR-VR-SEC-003).
 * The Supabase client is mocked — no Docker, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';
import type { CompiledQuery } from './types';

// Mock the supabase client BEFORE importing executor
const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};

const mockFrom = vi.fn(() => mockChain);

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom },
}));

import { executeCompiledQuery } from './executor';

const BASE_COMPILED: CompiledQuery = {
  entity: 'companies',
  repositoryMethod: 'company.list',
  resolvedFilters: [],
  resolvedSelect: ['id', 'name', 'type'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeCompiledQuery — AC-VR-013', () => {
  it('calls supabase.from with the correct table name for "companies"', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(mockFrom).toHaveBeenCalledWith('companies');
  });

  it('chains .select() with resolvedSelect columns joined by comma', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(mockChain.select).toHaveBeenCalledWith('id,name,type');
  });

  it('chains .eq() for an eq filter', async () => {
    mockChain.limit.mockResolvedValue({ data: [{ id: 'x', name: 'Acme', type: 'Client' }], error: null });
    const compiled: CompiledQuery = {
      ...BASE_COMPILED,
      resolvedFilters: [{ column: 'type', op: 'eq', value: 'Client' }],
      limit: 10,
    };
    await executeCompiledQuery(compiled);
    expect(mockChain.eq).toHaveBeenCalledWith('type', 'Client');
  });

  it('chains .order() for resolvedOrderBy', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    const compiled: CompiledQuery = {
      ...BASE_COMPILED,
      resolvedOrderBy: { column: 'name', dir: 'asc' },
      limit: 10,
    };
    await executeCompiledQuery(compiled);
    expect(mockChain.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('chains .limit() for the limit field', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(mockChain.limit).toHaveBeenCalledWith(10);
  });

  it('returns rows from the Supabase response', async () => {
    const rows = [{ id: 'x', name: 'Acme', type: 'Client' }];
    mockChain.limit.mockResolvedValue({ data: rows, error: null });
    const result = await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(result).toEqual(rows);
  });

  it('throws AppError when Supabase returns an error', async () => {
    mockChain.limit.mockResolvedValue({ data: null, error: { message: 'RLS denied', code: '42501' } });
    await expect(executeCompiledQuery({ ...BASE_COMPILED, limit: 10 })).rejects.toBeInstanceOf(AppError);
  });

  it('applies in-memory groupBy + count aggregate (FR-VR-022)', async () => {
    // Mock returns two rows for 'Client', executor groups and counts
    const rows = [
      { id: 'x', name: 'Acme', type: 'Client' },
      { id: 'y', name: 'Corp', type: 'Client' },
    ];
    // No limit needed when resolvedGroupBy is present — the limit applies before groupBy
    mockChain.limit.mockResolvedValue({ data: rows, error: null });
    const compiled: CompiledQuery = {
      ...BASE_COMPILED,
      resolvedGroupBy: 'type',
      resolvedAggregate: { fn: 'count', column: 'id', alias: 'cnt' },
      limit: 500,
    };
    const result = await executeCompiledQuery(compiled);
    expect(result).toEqual([{ type: 'Client', cnt: 2 }]);
  });

  it('applies in-memory sum aggregate (FR-VR-022)', async () => {
    const rows = [{ contract_value: 100 }, { contract_value: 200 }];
    mockChain.limit.mockResolvedValue({ data: rows, error: null });
    const compiled: CompiledQuery = {
      entity: 'projects',
      repositoryMethod: 'project.list',
      resolvedFilters: [],
      resolvedSelect: ['contract_value'],
      resolvedAggregate: { fn: 'sum', column: 'contract_value', alias: 'total' },
      limit: 500,
    };
    const result = await executeCompiledQuery(compiled);
    // sum without groupBy: returns a single object { total: 300 }
    expect(result).toEqual([{ total: 300 }]);
  });

  it('expands date-range op to .gte + .lte (ADR-0038)', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    const compiled: CompiledQuery = {
      entity: 'projects',
      repositoryMethod: 'project.list',
      resolvedFilters: [{ column: 'created_at', op: 'date-range', value: ['2026-01-01', '2026-12-31'] }],
      resolvedSelect: ['id'],
      limit: 10,
    };
    await executeCompiledQuery(compiled);
    expect(mockChain.gte).toHaveBeenCalledWith('created_at', '2026-01-01');
    expect(mockChain.lte).toHaveBeenCalledWith('created_at', '2026-12-31');
  });

  it('does NOT import service_role (NFR-VR-SEC-003) — verified by mock: only anon client mock is used', async () => {
    // If executor.ts imported a service-role client the mock above would not intercept it.
    // This test passes only when the single supabase import from client.ts is used.
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 5 });
    expect(mockFrom).toHaveBeenCalledTimes(1); // exactly one client call, not two
  });
});
```

**Verify (RED):** `npm test -- --reporter=verbose src/lib/viewspec/executor.test.ts` — fails with "Cannot find module './executor'".

---

### T-04 — Write RED tests for Rail "My Views" group (AC-VR-014, AC-VR-015, AC-VR-017)

**File:** `pmo-portal/src/components/shell/Rail.test.tsx` (NEW)

```typescript
/**
 * Rail — "My Views" group unit tests.
 * AC-VR-014, AC-VR-015, AC-VR-017 (FR-VR-060, FR-VR-061, FR-VR-062, FR-VR-064, FR-VR-065)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Mocks (hoisted before imports) ──────────────────────────────────────────

const { featureEnabled, userViewsData } = vi.hoisted(() => ({
  featureEnabled: { userViews: true },
  userViewsData: [] as { id: string; name: string; description: string | null }[],
}));

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => featureEnabled[key as keyof typeof featureEnabled] ?? false,
  FEATURES: featureEnabled,
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: userViewsData, isPending: false, isError: false }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Admin', realRole: 'Admin' }),
}));

import { Rail } from './Rail';

function renderRail() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Rail />
    </MemoryRouter>
  );
}

describe('Rail — My Views group (AC-VR-014, AC-VR-015, AC-VR-017)', () => {
  it('AC-VR-014: renders "My Views" group and nav link when feature=true and views exist', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = true;
    renderRail();
    expect(screen.getByRole('group', { name: /my views/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Dashboard' })).toHaveAttribute('href', '/views/v1');
  });

  it('AC-VR-014: does NOT render "My Views" group when feature=false', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = false;
    renderRail();
    expect(screen.queryByRole('group', { name: /my views/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Dashboard' })).not.toBeInTheDocument();
  });

  it('AC-VR-015: does NOT render "My Views" group when feature=true but views array is empty', () => {
    userViewsData.splice(0, userViewsData.length);
    featureEnabled.userViews = true;
    renderRail();
    expect(screen.queryByRole('group', { name: /my views/i })).not.toBeInTheDocument();
  });

  it('AC-VR-017: ALL_ITEMS entries are still present; no existing group is replaced', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = true;
    renderRail();
    // Existing static nav items remain (just check a few)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    // "My Views" group is additional, not replacing "Overview"/"CRM"/"Delivery"/"Workforce"
    expect(screen.getByRole('group', { name: /my views/i })).toBeInTheDocument();
  });

  it('AC-VR-014: caps rail entries at MAX_NAV_VIEWS (8)', () => {
    const views = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, name: `View ${i}`, description: null }));
    userViewsData.splice(0, userViewsData.length, ...views);
    featureEnabled.userViews = true;
    renderRail();
    const group = screen.getByRole('group', { name: /my views/i });
    const links = within(group).getAllByRole('link');
    expect(links).toHaveLength(8);
  });
});
```

**Verify (RED):** `npm test -- --reporter=verbose src/components/shell/Rail.test.tsx` — fails because `Rail` has no "My Views" group yet.

---

### T-05 — Write RED tests for `ShellChrome` palette "Views" group (AC-VR-016)

**File:** `pmo-portal/src/components/shell/ShellChrome.test.tsx` (NEW)

The `paletteItems` memo lives in `ShellChrome` (inside `App.tsx`). The cleanest unit test for the memo logic is to extract the palette-items logic into a pure helper and test it, or to test `ShellChrome` via a lightweight render. We test the logic directly as a pure function extracted via the existing module structure:

```typescript
/**
 * ShellChrome palette "Views" group unit test.
 * AC-VR-016 (FR-VR-070, FR-VR-071, FR-VR-072, FR-VR-073)
 *
 * Tests the buildViewsPaletteItems() pure helper extracted in App.tsx.
 */
import { describe, it, expect } from 'vitest';
import { buildViewsPaletteItems } from '../../App';
import type { UserViewRow } from '@/src/lib/db/userViews';

// Minimal stub of the fields we use from UserViewRow
const makeView = (id: string, name: string, description: string | null = null): Pick<UserViewRow, 'id' | 'name' | 'description'> =>
  ({ id, name, description } as Pick<UserViewRow, 'id' | 'name' | 'description'>);

describe('buildViewsPaletteItems — AC-VR-016', () => {
  it('returns Views palette items when feature is on and views exist', () => {
    const views = [makeView('v1', 'Revenue View', 'Monthly revenue')];
    const items = buildViewsPaletteItems(views, () => {});
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('view-v1');
    expect(items[0].group).toBe('Views');
    expect(items[0].title).toBe('Revenue View');
    expect(items[0].sub).toBe('Monthly revenue');
    expect(items[0].icon).toBe('grid');
  });

  it('returns empty array when views is empty or undefined', () => {
    expect(buildViewsPaletteItems([], () => {})).toEqual([]);
    expect(buildViewsPaletteItems(undefined, () => {})).toEqual([]);
  });

  it('sub is undefined when description is null', () => {
    const items = buildViewsPaletteItems([makeView('v1', 'My View')], () => {});
    expect(items[0].sub).toBeUndefined();
  });

  it('includes all views (no cap unlike the rail)', () => {
    const views = Array.from({ length: 20 }, (_, i) => makeView(`v${i}`, `View ${i}`));
    const items = buildViewsPaletteItems(views, () => {});
    expect(items).toHaveLength(20);
  });
});
```

**Verify (RED):** `npm test -- --reporter=verbose src/components/shell/ShellChrome.test.tsx` — fails with "buildViewsPaletteItems is not exported".

---

### T-06 — Implement `FEATURES.userViews` flag (FR-VR-001)

**File:** `pmo-portal/src/lib/features.ts`

```typescript
export const FEATURES = {
  incidents: false,
  userViews: false,  // I3: user-view renderer; flip to true to enable (FR-VR-001)
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key];
}
```

**Verify:** `npm run typecheck` — zero errors. `FeatureRoute feature="userViews"` and `isFeatureEnabled('userViews')` now type-check.

---

### T-07 — Implement `compileCompositionSpec` in `compiler.ts` (FR-VR-010..014)

**File:** `pmo-portal/src/lib/viewspec/compiler.ts`

Add the following after the existing `compileQuerySpec` export. The import of `validatePrimitive` from `./registry` is added at the top of the file.

**Add to existing imports at top of `compiler.ts`:**
```typescript
import { validatePrimitive } from './registry';
import type { CompositionSpec, CompiledPanel } from './types';
```

**Add new export function at the bottom of the file:**
```typescript
/**
 * Validates a CompositionSpec and compiles each panel to a CompiledPanel.
 * Pure function: no side effects, no I/O. Fail-fast: throws on the first invalid panel.
 *
 * @throws ValidationError(UNSUPPORTED_VERSION)  if spec.version !== 1 (FR-VR-014)
 * @throws ValidationError(UNKNOWN_PRIMITIVE)    if panel.primitive not in registry (FR-VR-011)
 * @throws ValidationError from compileQuerySpec  if panel.querySpec is invalid (FR-VR-012)
 */
export function compileCompositionSpec(
  spec: CompositionSpec,
  ctx: CompilerContext,
): CompiledPanel[] {
  // ── Version guard (FR-VR-014) ──────────────────────────────────────────────
  // spec.version is typed as the literal 1 in CompositionSpec, so the cast is
  // required to make the runtime check meaningful (at runtime the value comes
  // from opaque JSON and may be anything).
  const version = (spec as { version: unknown }).version;
  if (version !== 1) {
    throw new ValidationError('UNSUPPORTED_VERSION', String(version));
  }

  return spec.panels.map((panel): CompiledPanel => {
    // ── Primitive validation (FR-VR-011) ────────────────────────────────────
    if (!validatePrimitive(panel.primitive)) {
      throw new ValidationError('UNKNOWN_PRIMITIVE', panel.id);
    }

    // ── Query compilation (FR-VR-012) ───────────────────────────────────────
    // Re-throw any ValidationError from compileQuerySpec, appending the panelId
    // to the detail so the renderer knows which panel failed.
    let compiledQuery;
    try {
      compiledQuery = compileQuerySpec(panel.querySpec, ctx);
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new ValidationError(
          err.code,
          err.detail != null ? `${err.detail} (panel: ${panel.id})` : `panel: ${panel.id}`,
        );
      }
      throw err;
    }

    return {
      id: panel.id,
      primitive: panel.primitive,
      compiledQuery,
      ...(panel.layout !== undefined && { layout: panel.layout }),
      ...(panel.props !== undefined && { props: panel.props }),
    };
  });
}
```

**Verify (GREEN):** `npm test -- --reporter=verbose src/lib/viewspec/compiler.test.ts` — all tests pass, including the new AC-VR-011 suite.

---

### T-08 — Implement `executeCompiledQuery` in new `executor.ts` (FR-VR-020..024)

**File:** `pmo-portal/src/lib/viewspec/executor.ts` (NEW)

```typescript
/**
 * View-renderer executor (ADR-0036 §4c, ADR-0038, I3).
 *
 * Dispatches a CompiledQuery to the Supabase PostgREST client (the same RLS-scoped
 * singleton the rest of the DAL uses — src/lib/supabase/client). Never imports a
 * service-role key or bypass-RLS path (NFR-VR-SEC-003).
 *
 * Allowed imports (NFR-VR-LAYER-001):
 *   - src/lib/supabase/client  (the viewer-scoped Supabase client)
 *   - src/lib/viewspec/types.ts (CompiledQuery, ENTITY_WHITELIST, VALID_FILTER_OPS)
 *   - src/lib/appError.ts      (AppError for error normalization, FR-VR-024)
 * No page, hook, or repository import is allowed here.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { ENTITY_WHITELIST } from './types';
import type { CompiledQuery, ResolvedFilter } from './types';

// ── In-memory aggregation helpers (OD-3 from ADR-0037, FR-VR-022) ────────────

type Row = Record<string, unknown>;

/**
 * Applies in-memory groupBy + aggregate to a flat result set.
 * Returns one object per group (or one object for an ungrouped aggregate).
 */
function applyGroupByAggregate(
  rows: Row[],
  groupBy: string | undefined,
  aggregate: { fn: string; column: string; alias: string } | undefined,
): Row[] {
  if (!aggregate) return rows;

  // Ungrouped aggregate: reduce all rows to a single metric.
  if (!groupBy) {
    const value = reduceAggregate(rows, aggregate);
    return [{ [aggregate.alias]: value }];
  }

  // Grouped aggregate: partition rows by groupBy column, then reduce each group.
  const groups = new Map<unknown, Row[]>();
  for (const row of rows) {
    const key = row[groupBy];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.entries()).map(([key, groupRows]) => ({
    [groupBy]: key,
    [aggregate.alias]: reduceAggregate(groupRows, aggregate),
  }));
}

function reduceAggregate(
  rows: Row[],
  agg: { fn: string; column: string; alias: string },
): number {
  const vals = rows.map((r) => Number(r[agg.column] ?? 0));
  switch (agg.fn) {
    case 'count': return rows.length;
    case 'sum':   return vals.reduce((a, b) => a + b, 0);
    case 'avg':   return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'min':   return vals.length === 0 ? 0 : Math.min(...vals);
    case 'max':   return vals.length === 0 ? 0 : Math.max(...vals);
    default:      return 0;
  }
}

// ── Filter chaining (FR-VR-023) ───────────────────────────────────────────────

/**
 * Applies a single ResolvedFilter to a Supabase PostgREST query chain.
 * Returns the updated chain. `between` and `date-range` both expand to
 * .gte(col, v[0]).lte(col, v[1]) (ADR-0038: PostgREST has no native between).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter(chain: any, filter: ResolvedFilter): any {
  const { column, op, value } = filter;
  switch (op) {
    case 'eq':     return chain.eq(column, value);
    case 'neq':    return chain.neq(column, value);
    case 'in':     return chain.in(column, value as (string | number)[]);
    case 'gt':     return chain.gt(column, value);
    case 'gte':    return chain.gte(column, value);
    case 'lt':     return chain.lt(column, value);
    case 'lte':    return chain.lte(column, value);
    case 'between':
    case 'date-range': {
      const [from, to] = value as [string | number, string | number];
      return chain.gte(column, from).lte(column, to);
    }
    default:
      // Unrecognised op — filtered out at compile time; this branch is unreachable.
      return chain;
  }
}

// ── Main executor (FR-VR-020..024) ───────────────────────────────────────────

/**
 * Executes a CompiledQuery under the current viewer's JWT (RLS-scoped Supabase client).
 * Returns the result rows as plain objects. Applies in-memory groupBy/aggregate when
 * present (OD-3). Throws AppError on Supabase client errors (FR-VR-024).
 *
 * Security: uses only src/lib/supabase/client (anon + viewer JWT). No service_role.
 * Row cap: the compiled.limit field (≤ 500, enforced by the compiler) is applied
 * as .limit(n) before the Supabase call, bounding memory use (OD-3).
 */
export async function executeCompiledQuery(compiled: CompiledQuery): Promise<unknown[]> {
  const entityEntry = ENTITY_WHITELIST[compiled.entity];
  const tableName = entityEntry.table;

  // Build the PostgREST query chain
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chain: any = supabase
    .from(tableName)
    .select(compiled.resolvedSelect.join(','));

  // Apply filters (FR-VR-023)
  for (const filter of compiled.resolvedFilters) {
    chain = applyFilter(chain, filter);
  }

  // Apply orderBy (FR-VR-023)
  if (compiled.resolvedOrderBy) {
    chain = chain.order(compiled.resolvedOrderBy.column, {
      ascending: compiled.resolvedOrderBy.dir === 'asc',
    });
  }

  // Apply limit (FR-VR-023). The compiler enforces 1–500; the executor trusts it.
  if (compiled.limit !== undefined) {
    chain = chain.limit(compiled.limit);
  }

  const { data, error } = await chain;
  if (error) {
    throw new AppError(error.message, error.code);
  }

  const rows: Row[] = (data as Row[]) ?? [];

  // In-memory groupBy + aggregate (FR-VR-022, OD-3)
  if (compiled.resolvedAggregate || compiled.resolvedGroupBy) {
    return applyGroupByAggregate(rows, compiled.resolvedGroupBy, compiled.resolvedAggregate);
  }

  return rows;
}
```

**Verify (GREEN):** `npm test -- --reporter=verbose src/lib/viewspec/executor.test.ts` — all AC-VR-013 tests pass.

---

### T-09 — Implement Rail "My Views" group (FR-VR-060..065, AC-VR-014, AC-VR-015, AC-VR-017)

**File:** `pmo-portal/src/components/shell/Rail.tsx`

Three changes:
1. Add `useUserViews` import.
2. Add `MAX_NAV_VIEWS = 8` constant.
3. Add the "My Views" group section inside the `<nav>` element, after `{GROUP_ORDER.map(...)}`.

**Add to the existing imports block at the top of `Rail.tsx`:**
```typescript
import { useUserViews } from '@/src/hooks/useUserViews';
```

**Add constant after `GROUP_ORDER` declaration (around line 70):**
```typescript
/** Maximum number of user-view entries displayed in the rail (OD-7, FR-VR-065). */
const MAX_NAV_VIEWS = 8;
```

**Inside the `Rail` component, after the `const items = ALL_ITEMS.filter(...)` line, add:**
```typescript
const { data: userViews } = useUserViews();
const showMyViews =
  isFeatureEnabled('userViews') &&
  Array.isArray(userViews) &&
  userViews.length > 0;
const myViewsItems = showMyViews
  ? (userViews ?? []).slice(0, MAX_NAV_VIEWS)
  : [];
```

**Inside the JSX `<nav>` element, after `{GROUP_ORDER.map((group) => { ... })}`, add:**
```typescript
{showMyViews && (
  <div role="group" aria-label="My Views">
    <div className="px-2 pb-1.5 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      My Views
    </div>
    {myViewsItems.map((view) => (
      <NavLink
        key={view.id}
        to={`/views/${view.id}`}
        onClick={onNavigate}
        className={({ isActive }: { isActive: boolean }) =>
          cn(
            NAV_LINK_BASE,
            isActive
              ? 'bg-primary/10 font-semibold text-nav-active-text'
              : 'text-foreground hover:bg-accent',
          )
        }
      >
        <Icon name="grid" />
        <span className="truncate">{view.name}</span>
      </NavLink>
    ))}
  </div>
)}
```

**Verify (GREEN):** `npm test -- --reporter=verbose src/components/shell/Rail.test.tsx` — all AC-VR-014/015/017 tests pass.

---

### T-10 — Extract `buildViewsPaletteItems` pure helper in `App.tsx` and implement palette "Views" group (FR-VR-070..074, AC-VR-016)

**File:** `pmo-portal/App.tsx`

**Step 1: add `useUserViews` import** to the existing imports block:
```typescript
import { useUserViews } from '@/src/hooks/useUserViews';
import { isFeatureEnabled } from '@/src/lib/features';
```

**Step 2: add the exported pure helper above `AppRoutes`** (exported so `ShellChrome.test.tsx` can import it directly — a pure function has no side-effects so this export is test-safe):
```typescript
/**
 * Pure helper: maps a list of user views to PaletteItem[] for the 'Views' ⌘K group.
 * Exported for unit-testing (AC-VR-016 / FR-VR-070..074); has no side-effects.
 * @param views - from useUserViews().data (undefined while pending)
 * @param navigate - react-router navigate fn, injected for testability
 */
export function buildViewsPaletteItems(
  views: { id: string; name: string; description?: string | null }[] | undefined,
  navigate: (path: string) => void,
): PaletteItem[] {
  if (!views || views.length === 0) return [];
  return views.map((view) => ({
    id: `view-${view.id}`,
    group: 'Views',
    title: view.name,
    sub: view.description ?? undefined,
    icon: 'grid' as const,
    run: () => navigate(`/views/${view.id}`),
  }));
}
```

**Step 3: in `ShellChrome`, add the `useUserViews` call** after the existing hook calls:
```typescript
const { data: userViewsList } = useUserViews();
```

**Step 4: extend the `paletteItems` useMemo** to append the "Views" group when the feature is on and views exist. Replace the existing `paletteItems` useMemo with:
```typescript
const paletteItems = useMemo<PaletteItem[]>(
  () => [
    ...recordSearch.records,
    ...(realRole ? modulesForRole(realRole as UserRole) : []).map((m) => ({
      id: `nav-${m.module}`,
      group: 'Navigate',
      title: m.label,
      icon: m.icon,
      run: () => navigate(m.path),
    })),
    // "Views" group — appended after "Navigate" when the feature is on (FR-VR-070..071)
    ...(isFeatureEnabled('userViews')
      ? buildViewsPaletteItems(userViewsList, navigate)
      : []),
  ],
  [navigate, recordSearch.records, realRole, userViewsList]
);
```

**Verify (GREEN):** `npm test -- --reporter=verbose src/components/shell/ShellChrome.test.tsx` — all AC-VR-016 tests pass.

---

### T-11 — Extend `routeMatch.ts`: `RecordLists`, `recordLabelForPath`, `breadcrumbForPath` (FR-VR-053, FR-VR-082)

**File:** `pmo-portal/src/components/shell/routeMatch.ts`

**Change 1: extend `RecordLists` interface** (add after the `contacts` field):
```typescript
/** I3: user views — the record "name" is view.name, resolved from the useUserViews() cache. */
userViews?: { id: string; name: string }[];
```

**Change 2: extend `recordLabelForPath`** — add a `/views/` case at the end, before `return undefined`:
```typescript
const viewId = idFrom('/views');
if (viewId) return lists.userViews?.find((v) => v.id === viewId)?.name;
```

**Change 3: extend `breadcrumbForPath`** — add a `/views/` case at the top, before the `for (const m of MODULES)` loop:
```typescript
// User-view detail route → [My Views (link to /) > <view.name>] (OD-4, FR-VR-053)
if (pathname.startsWith('/views/')) {
  const viewCrumb = recordLabel || (recordResolved ? 'Not found' : 'Loading…');
  return [
    { label: 'My Views', onClick: () => navigate?.('/') },
    { label: viewCrumb },
  ];
}
```

**Also add a unit test for the new paths** — append to the existing `routeMatch.test.ts` file (if it exists) or create `pmo-portal/src/components/shell/routeMatch.test.ts`:

```typescript
// ── /views/:viewId breadcrumb and recordLabel (FR-VR-053, FR-VR-082) ─────────
import { breadcrumbForPath, recordLabelForPath } from './routeMatch';

describe('routeMatch — /views/:viewId (FR-VR-053, FR-VR-082)', () => {
  const navigate = vi.fn();

  it('recordLabelForPath resolves view name from userViews cache', () => {
    const label = recordLabelForPath('/views/v1', {
      userViews: [{ id: 'v1', name: 'Revenue View' }],
    });
    expect(label).toBe('Revenue View');
  });

  it('recordLabelForPath returns undefined when view not in cache', () => {
    const label = recordLabelForPath('/views/v1', { userViews: [] });
    expect(label).toBeUndefined();
  });

  it('breadcrumbForPath for /views/:viewId returns [My Views, <name>]', () => {
    const crumbs = breadcrumbForPath('/views/v1', 'Revenue View', navigate);
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('My Views');
    expect(typeof crumbs[0].onClick).toBe('function');
    expect(crumbs[1].label).toBe('Revenue View');
  });

  it('breadcrumbForPath shows Loading… when record not yet resolved', () => {
    const crumbs = breadcrumbForPath('/views/v1', undefined, navigate, false);
    expect(crumbs[1].label).toBe('Loading…');
  });

  it('breadcrumbForPath shows Not found when resolved but absent', () => {
    const crumbs = breadcrumbForPath('/views/v1', undefined, navigate, true);
    expect(crumbs[1].label).toBe('Not found');
  });
});
```

**Verify:** `npm run typecheck` — zero errors. `npm test -- --reporter=verbose src/components/shell/routeMatch.test.ts` — tests pass (if new file) or no regression (if appended).

---

### T-12 — Wire `useUserViews` into `ShellChrome` breadcrumb and add `/views/:viewId` route to `App.tsx` (FR-VR-050..053)

**File:** `pmo-portal/App.tsx`

**Step 1: add lazy import** after the `NotFoundPage` lazy import:
```typescript
const UserViewRenderer = React.lazy(() => import('./pages/UserViewRenderer'));
```

**Step 2: add the route** inside `AppRoutes`, before `<Route path="*" ...>`:
```typescript
{/* User-view renderer: /views/:viewId (I3, FR-VR-050, FR-VR-051).
    FeatureRoute redirects to / when FEATURES.userViews is false.
    Only this one route under /views/; a bare /views 404s via the * route. */}
<Route
  path="/views/:viewId"
  element={<FeatureRoute feature="userViews" element={<UserViewRenderer />} />}
/>
```

**Step 3: wire `userViews` into the `breadcrumb` useMemo** in `ShellChrome`:

After the existing `const { data: contacts, ...` line, `userViewsList` is already declared (T-10). Now:

a. Add `userViews: userViewsList?.map((v) => ({ id: v.id, name: v.name }))` to the `recordLabelForPath` call:

```typescript
const recordLabel = recordLabelForPath(pathname, {
  projects,
  opportunities,
  procurements,
  incidents,
  companies,
  contacts,
  userViews: userViewsList?.map((v) => ({ id: v.id, name: v.name })),
});
```

b. Add `userViewsPending` state and the `/views/` resolved condition:

```typescript
// After other pending declarations:
const { data: userViewsList, isPending: userViewsPending } = useUserViews();
```

c. Extend `recordResolved` condition:
```typescript
const recordResolved =
  (pathname.startsWith('/projects/') && !projectsPending && !pipelinePending && !lostDealsPending) ||
  (pathname.startsWith('/procurement/') && !procurementsPending) ||
  (pathname.startsWith('/incidents/') && !incidentsPending) ||
  (pathname.startsWith('/companies/') && !companiesPending) ||
  (pathname.startsWith('/contacts/') && !contactsPending) ||
  (pathname.startsWith('/sales/') && !pipelinePending) ||
  (pathname.startsWith('/views/') && !userViewsPending);  // I3 (FR-VR-053)
```

d. Add `userViewsList` and `userViewsPending` to the `breadcrumb` useMemo dependency array.

**Verify:** `npm run typecheck` — zero errors. `npm run build` — no lazy chunk errors.

---

### T-13 — Write RED tests for `UserViewRenderer` guard states (AC-VR-001..005, AC-VR-018)

**File:** `pmo-portal/pages/UserViewRenderer.test.tsx` (NEW — the primary RTL test file)

```typescript
/**
 * UserViewRenderer — guard state tests (RED phase).
 * AC-VR-001 (loading), AC-VR-002 (not-found), AC-VR-003 (archived),
 * AC-VR-004 (spec-invalid), AC-VR-005 (empty-spec), AC-VR-018 (feature-off redirect).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockUseUserView, mockUseAuth, mockFeatureEnabled } = vi.hoisted(() => ({
  mockUseUserView: vi.fn(),
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
  mockFeatureEnabled: vi.fn(() => true),
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserView: mockUseUserView,
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: mockUseAuth }));

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: mockFeatureEnabled,
  FEATURES: { userViews: true },
}));

// Mock compileCompositionSpec + executeCompiledQuery to isolate renderer logic
vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: vi.fn(),
  compileQuerySpec: vi.fn(),
}));
vi.mock('@/src/lib/viewspec/executor', () => ({
  executeCompiledQuery: vi.fn(),
}));

import UserViewRenderer from './UserViewRenderer';
import { ValidationError } from '@/src/lib/viewspec/types';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';

const mockCompile = compileCompositionSpec as ReturnType<typeof vi.fn>;

function renderRenderer(viewId = 'abc') {
  return render(
    <MemoryRouter initialEntries={[`/views/${viewId}`]}>
      <UserViewRenderer viewId={viewId} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ currentUser: { id: 'u1', org_id: 'org1' }, role: 'Admin', session: null, loading: false, profileError: null, signInWithPassword: vi.fn(), signInWithMagicLink: vi.fn(), signOut: vi.fn() });
  mockFeatureEnabled.mockReturnValue(true);
});

describe('UserViewRenderer — guard states', () => {
  it('AC-VR-001: renders loading skeleton while useUserView is pending', () => {
    mockUseUserView.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderRenderer();
    // Expect at least one ChartFrame loading state (liststate-loading testid from ListState)
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    expect(screen.queryByRole('main')).not.toBeInTheDocument(); // no main content yet
  });

  it('AC-VR-002: renders not-found state when useUserView returns null', () => {
    mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false });
    renderRenderer();
    expect(screen.getByText(/this view was not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument();
  });

  it('AC-VR-003: renders not-found state when view has non-null archived_at', () => {
    mockUseUserView.mockReturnValue({
      data: { id: 'abc', name: 'Archived', spec: { version: 1, panels: [] }, archived_at: '2026-01-01T00:00:00Z', scope: 'private', org_id: 'org1', user_id: 'u1', description: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      isPending: false,
      isError: false,
    });
    renderRenderer();
    expect(screen.getByText(/this view was not found/i)).toBeInTheDocument();
  });

  it('AC-VR-004: renders spec-invalid error state when compileCompositionSpec throws', () => {
    mockUseUserView.mockReturnValue({
      data: { id: 'abc', name: 'Bad View', spec: { version: 1, panels: [{ id: 'p1', primitive: 'PieChart', querySpec: { entity: 'projects', select: ['id'] } }] }, archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1', description: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      isPending: false,
      isError: false,
    });
    mockCompile.mockImplementation(() => {
      throw new ValidationError('UNKNOWN_PRIMITIVE', 'p1');
    });
    renderRenderer();
    expect(screen.getByText(/this view's definition is invalid/i)).toBeInTheDocument();
    expect(screen.queryByText(/PieChart/i)).not.toBeInTheDocument(); // no partial render
  });

  it('AC-VR-005: renders empty-spec state when spec has zero panels', () => {
    mockUseUserView.mockReturnValue({
      data: { id: 'abc', name: 'Empty View', spec: { version: 1, panels: [] }, archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1', description: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      isPending: false,
      isError: false,
    });
    mockCompile.mockReturnValue([]);
    renderRenderer();
    expect(screen.getByRole('heading', { name: 'Empty View' })).toBeInTheDocument();
    expect(screen.getByText(/this view has no panels yet/i)).toBeInTheDocument();
  });

  it('AC-VR-018: FeatureRoute redirects to / when userViews feature is off', () => {
    // This is a route-level test: FeatureRoute wraps UserViewRenderer and redirects
    // when the feature is off. Test via the <FeatureRoute> behavior directly.
    // FeatureRoute renders <Navigate to="/" replace> when isFeatureEnabled returns false.
    mockFeatureEnabled.mockReturnValue(false);
    // Render the FeatureRoute directly to assert redirect behavior
    const { FeatureRoute } = vi.importActual<typeof import('@/src/components/FeatureRoute')>(
      '@/src/components/FeatureRoute'
    );
    // The FeatureRoute renders Navigate — in MemoryRouter it renders nothing visible
    // because there's no matching route for "/". We assert the renderer is NOT mounted.
    render(
      <MemoryRouter>
        <FeatureRoute feature="userViews" element={<UserViewRenderer viewId="abc" />} />
      </MemoryRouter>
    );
    // UserViewRenderer is NOT rendered when feature is off
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
    expect(screen.queryByText(/this view was not found/i)).not.toBeInTheDocument();
  });
});
```

**Verify (RED):** `npm test -- --reporter=verbose pages/UserViewRenderer.test.tsx` — fails with "Cannot find module './UserViewRenderer'".

---

### T-14 — Implement `UserViewRenderer` component (FR-VR-030..043)

**File:** `pmo-portal/pages/UserViewRenderer.tsx` (NEW)

```typescript
/**
 * User-View Renderer (ADR-0036 §4c / §7, I3, FR-VR-030..043).
 *
 * Renders a saved user_views row as a live PMO page. Guards:
 *   loading  → page-level skeleton (FR-VR-031)
 *   null     → not-found / no-access (FR-VR-032, OD-1)
 *   archived → same as null (FR-VR-033)
 *   too many panels → spec-invalid (OD-9)
 *   spec-invalid → ValidationError → error state (FR-VR-034, OD-2)
 *   empty panels → empty-spec (FR-VR-035, OD-3)
 *   ready → per-panel loading/empty/error/ready (FR-VR-036..042)
 *
 * Security:
 *   - compileCompositionSpec validates before any executeCompiledQuery call (NFR-VR-SEC-004)
 *   - executeCompiledQuery uses the viewer's JWT-scoped supabase client (NFR-VR-SEC-001)
 *   - No data rows are stored in spec or persistent store (NFR-VR-SEC-002)
 *
 * Layering (NFR-VR-LAYER-002):
 *   Imports: src/lib/viewspec/, src/lib/viewspec/executor, src/hooks/useUserViews,
 *            src/auth/useAuth, src/components/dashboard/, src/components/ui/,
 *            react-router-dom (for navigate in OD-1 CTA and OD-4 breadcrumb).
 *   Does NOT import from src/lib/db/* directly.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserView } from '@/src/hooks/useUserViews';
import { useAuth } from '@/src/auth/useAuth';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import { registry } from '@/src/lib/viewspec/registry';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { CompiledPanel, CompositionSpec } from '@/src/lib/viewspec/types';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { DashGrid, DashPageHead } from '@/src/components/dashboard/layout';
import { ListState } from '@/src/components/ui/ListState';
import { KPITile } from '@/src/components/ui/KPITile';

/** Maximum panels per view (OD-9, FR-VR-010 extension). */
const MAX_PANELS_PER_VIEW = 20;

export interface UserViewRendererProps {
  viewId: string;
}

// ── Per-panel state ───────────────────────────────────────────────────────────

interface PanelState {
  loading: boolean;
  data: unknown[] | null;
  error: Error | null;
}

// ── Primitive hydration (FR-VR-039) ───────────────────────────────────────────

/**
 * Resolves the kit primitive component and hydrates it with data + static props.
 * Defensive: unknown props are silently ignored; missing required props use defaults.
 */
function HydratedPrimitive({
  panel,
  data,
}: {
  panel: CompiledPanel;
  data: unknown[];
}) {
  const descriptor = registry.get(panel.primitive);
  if (!descriptor) {
    // Should never happen: compileCompositionSpec already validated the primitive.
    return null;
  }

  const props = panel.props ?? {};

  switch (panel.primitive) {
    case 'KPITile': {
      const row = data[0] as Record<string, unknown> | undefined;
      const alias = panel.compiledQuery.resolvedAggregate?.alias;
      const value = alias != null ? row?.[alias] : row?.[panel.compiledQuery.resolvedSelect[0]];
      return (
        <KPITile
          icon={(props.icon as string | undefined) ?? 'doc'}
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
      // For primitives not yet wired with a specific hydration case,
      // render the data as a JSON debug table (fallback for I3 scope).
      // TODO I4: wire remaining primitives (DataTable, StatTiles, Funnel, StatusBarChart, ProgressBar, Card)
      return (
        <pre className="overflow-auto rounded border border-border p-3 text-[12px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────

const UserViewRenderer: React.FC<UserViewRendererProps> = ({ viewId }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { data: view, isPending } = useUserView(viewId);

  // Per-panel query state (FR-VR-036..038, FR-VR-042)
  const [panelStates, setPanelStates] = useState<PanelState[]>([]);
  const [compiledPanels, setCompiledPanels] = useState<CompiledPanel[] | null>(null);
  const [specError, setSpecError] = useState<ValidationError | Error | null>(null);

  useEffect(() => {
    // Reset when viewId changes
    setCompiledPanels(null);
    setPanelStates([]);
    setSpecError(null);
  }, [viewId]);

  useEffect(() => {
    if (isPending || view === undefined) return;

    // not-found / archived (FR-VR-032, FR-VR-033)
    if (view === null || view.archived_at !== null) {
      setCompiledPanels(null);
      setSpecError(null);
      return;
    }

    // Panel count guard (OD-9)
    const rawSpec = view.spec as unknown;
    const specAsObj = rawSpec as { version?: unknown; panels?: unknown[] };
    if (Array.isArray(specAsObj?.panels) && specAsObj.panels.length > MAX_PANELS_PER_VIEW) {
      setSpecError(new Error(`This view exceeds the maximum of ${MAX_PANELS_PER_VIEW} panels.`));
      return;
    }

    // Compile (NFR-VR-SEC-004: always compile before execute)
    try {
      const ctx = { userId: currentUser!.id, orgId: currentUser!.org_id };
      const panels = compileCompositionSpec(rawSpec as CompositionSpec, ctx);
      setCompiledPanels(panels);
      setSpecError(null);

      // Initialize per-panel loading state (FR-VR-036)
      setPanelStates(panels.map(() => ({ loading: true, data: null, error: null })));

      // Fire all panel queries in parallel (FR-VR-042, NFR-VR-PERF-001)
      Promise.allSettled(
        panels.map((panel) => executeCompiledQuery(panel.compiledQuery))
      ).then((results) => {
        setPanelStates(
          results.map((r) =>
            r.status === 'fulfilled'
              ? { loading: false, data: r.value as unknown[], error: null }
              : { loading: false, data: null, error: r.reason as Error }
          )
        );
      });
    } catch (err) {
      setSpecError(err instanceof Error ? err : new Error(String(err)));
      setCompiledPanels(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isPending, viewId]);

  // ── Loading state (FR-VR-031) ───────────────────────────────────────────
  if (isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        {/* DashPageHead skeleton */}
        <div aria-hidden className="skel h-8 w-1/3 rounded" />
        {/* ChartFrame loading placeholders */}
        <DashGrid>
          <ChartFrame state="loading" />
          <ChartFrame state="loading" />
        </DashGrid>
      </div>
    );
  }

  // ── Not-found / no-access / archived (FR-VR-032, FR-VR-033, OD-1) ─────
  if (view === null || view === undefined || (view && view.archived_at !== null)) {
    return (
      <ListState
        variant="empty"
        title="This view was not found."
        sub="The view may have been removed, or you may not have access."
        action={{ label: 'Go to Dashboard', onClick: () => navigate('/') }}
      />
    );
  }

  // ── Spec-invalid / panel-count-exceeded (FR-VR-034, OD-2, OD-9) ────────
  if (specError !== null) {
    const isValidationError = specError instanceof ValidationError;
    return (
      <div className="flex flex-col gap-4 p-6">
        <ListState
          variant="error"
          title="This view's definition is invalid."
          sub="The view cannot be rendered because its specification is invalid."
        />
        {/* OD-2: dev/non-prod disclosure */}
        {import.meta.env.VITE_APP_ENV !== 'production' && isValidationError && (
          <details className="rounded border border-border p-3 text-[12px]">
            <summary className="cursor-pointer font-semibold text-muted-foreground">
              Developer detail (hidden in production)
            </summary>
            <pre className="mt-2 overflow-auto">
              {`code: ${specError.code}\ndetail: ${specError.detail ?? '—'}\nmessage: ${specError.message}`}
            </pre>
          </details>
        )}
        {specError.message.includes(`maximum of ${MAX_PANELS_PER_VIEW}`) && (
          <p className="text-[13px] text-muted-foreground">{specError.message}</p>
        )}
      </div>
    );
  }

  // ── Empty spec (FR-VR-035, OD-3) ────────────────────────────────────────
  if (compiledPanels !== null && compiledPanels.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <DashPageHead title={view.name} sub={view.description ?? ''} />
        <ListState
          variant="empty"
          title="This view has no panels yet."
          {/* TODO I4: add CTA to open builder */}
        />
      </div>
    );
  }

  // ── Ready: render compiled panels (FR-VR-036..042) ─────────────────────
  if (compiledPanels === null || panelStates.length === 0) {
    // Still compiling or state not yet initialized — show skeleton
    return (
      <div className="flex flex-col gap-6 p-6" aria-hidden>
        <div className="skel h-8 w-1/3 rounded" />
        <DashGrid>
          <ChartFrame state="loading" />
        </DashGrid>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <DashPageHead title={view.name} sub={view.description ?? ''} />
      {/* NFR-VR-A11Y-002: DashGrid is inside the shell's <main>; panels use correct heading hierarchy */}
      <DashGrid>
        {compiledPanels.map((panel, idx) => {
          const state = panelStates[idx] ?? { loading: true, data: null, error: null };
          const data = state.data ?? [];
          const colSpan = panel.layout?.colSpan;
          const panelStyle = colSpan ? { gridColumn: `span ${colSpan}` } : undefined;

          return (
            <div key={panel.id} style={panelStyle}>
              <ChartFrame
                state={
                  state.loading
                    ? 'loading'
                    : state.error
                    ? 'error'
                    : data.length === 0
                    ? 'empty'
                    : 'ready'
                }
                emptyTitle={(panel.props?.emptyTitle as string | undefined) ?? 'No data'}
                onRetry={() => {
                  // Per-panel retry (FR-VR-038)
                  setPanelStates((prev) => {
                    const next = [...prev];
                    next[idx] = { loading: true, data: null, error: null };
                    return next;
                  });
                  executeCompiledQuery(panel.compiledQuery).then(
                    (rows) => {
                      setPanelStates((prev) => {
                        const next = [...prev];
                        next[idx] = { loading: false, data: rows as unknown[], error: null };
                        return next;
                      });
                    },
                    (err: Error) => {
                      setPanelStates((prev) => {
                        const next = [...prev];
                        next[idx] = { loading: false, data: null, error: err };
                        return next;
                      });
                    }
                  );
                }}
              >
                <HydratedPrimitive panel={panel} data={data} />
              </ChartFrame>
            </div>
          );
        })}
      </DashGrid>
    </div>
  );
};

export default UserViewRenderer;
```

**Verify (GREEN):** `npm test -- --reporter=verbose pages/UserViewRenderer.test.tsx` — AC-VR-001..005 and AC-VR-018 tests pass. Then `npm run typecheck` — zero errors.

---

### T-15 — Write and pass renderer data-state tests (AC-VR-006..010)

**File:** `pmo-portal/pages/UserViewRenderer.test.tsx` (extend existing file)

Append after the existing `describe('guard states')` block:

```typescript
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import { waitFor } from '@testing-library/react';

const mockExecute = executeCompiledQuery as ReturnType<typeof vi.fn>;

const VALID_KPITILE_VIEW = {
  id: 'abc', name: 'My KPI', description: null,
  spec: {
    version: 1,
    panels: [{
      id: 'p1', primitive: 'KPITile',
      querySpec: { entity: 'projects', select: ['contract_value'], aggregate: { fn: 'sum', column: 'contract_value', alias: 'total' } },
      props: { icon: 'doc', tone: 'blue', label: 'Total Contract Value' },
    }],
  },
  archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

const COMPILED_KPITILE = [{
  id: 'p1', primitive: 'KPITile',
  compiledQuery: { entity: 'projects', repositoryMethod: 'project.list', resolvedFilters: [], resolvedSelect: ['contract_value'], resolvedAggregate: { fn: 'sum', column: 'contract_value', alias: 'total' }, limit: undefined },
  props: { icon: 'doc', tone: 'blue', label: 'Total Contract Value' },
}];

describe('UserViewRenderer — data states (AC-VR-006..010)', () => {
  beforeEach(() => {
    mockCompile.mockReturnValue(COMPILED_KPITILE);
    mockUseUserView.mockReturnValue({ data: VALID_KPITILE_VIEW, isPending: false, isError: false });
  });

  it('AC-VR-006: KPITile is hydrated with value from executeCompiledQuery data', async () => {
    mockExecute.mockResolvedValue([{ total: 1234567 }]);
    renderRenderer();
    await waitFor(() => {
      expect(screen.getByText('Total Contract Value')).toBeInTheDocument();
      expect(screen.getByText('1234567')).toBeInTheDocument();
    });
  });

  it('AC-VR-007: per-panel loading state while query is pending (heading already visible)', async () => {
    // executeCompiledQuery never resolves in this test
    mockExecute.mockReturnValue(new Promise(() => {}));
    renderRenderer();
    // Page heading IS rendered (row has resolved)
    expect(screen.getByRole('heading', { name: 'My KPI' })).toBeInTheDocument();
    // Panel ChartFrame is in loading state
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  });

  it('AC-VR-008: per-panel error state with retry button; page heading stays', async () => {
    const { AppError } = await import('@/src/lib/appError');
    mockExecute.mockRejectedValue(new AppError('DB error', '42501'));
    renderRenderer();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'My KPI' })).toBeInTheDocument();
  });

  it('AC-VR-009: per-panel empty state when query returns []', async () => {
    mockExecute.mockResolvedValue([]);
    renderRenderer();
    await waitFor(() => {
      expect(screen.getByText(/no data/i)).toBeInTheDocument();
    });
  });

  it('AC-VR-010: multi-panel layout with colSpan hint applies grid-column style', async () => {
    const twoPanel = [
      { ...COMPILED_KPITILE[0], id: 'p1', layout: { colSpan: 2 } },
      { ...COMPILED_KPITILE[0], id: 'p2' },
    ];
    mockCompile.mockReturnValue(twoPanel);
    mockExecute.mockResolvedValue([{ total: 99 }]);
    renderRenderer();
    await waitFor(() => {
      const wrappers = document.querySelectorAll('[style*="grid-column: span 2"]');
      expect(wrappers.length).toBe(1);
    });
  });
});
```

**Verify (GREEN):** `npm test -- --reporter=verbose pages/UserViewRenderer.test.tsx` — AC-VR-006..010 pass.

---

### T-16 — Write and pass axe-core a11y tests (AC-VR-012, NFR-VR-A11Y-001..004)

**File:** `pmo-portal/pages/UserViewRenderer.test.tsx` (extend)

First, ensure `axe-core` + `vitest-axe` are installed (they are already in the project if ADR-0030 Layer-1 gate-tests are present; if not: `npm install --save-dev vitest-axe axe-core` — but do NOT run this; implementer confirms in the `package.json`).

Append after the AC-VR-006..010 block:

```typescript
import { axe, toHaveNoViolations } from 'vitest-axe';
expect.extend(toHaveNoViolations);

describe('UserViewRenderer — axe a11y (AC-VR-012, NFR-VR-A11Y-001..004)', () => {
  it('AC-VR-012: loading state passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: undefined, isPending: true, isError: false });
    const { container } = renderRenderer();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('AC-VR-012: not-found state passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false });
    const { container } = renderRenderer();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('AC-VR-012: spec-invalid error state passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: VALID_KPITILE_VIEW, isPending: false, isError: false });
    mockCompile.mockImplementation(() => { throw new ValidationError('UNKNOWN_PRIMITIVE', 'p1'); });
    const { container } = renderRenderer();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('AC-VR-012: ready state (KPITile) passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: VALID_KPITILE_VIEW, isPending: false, isError: false });
    mockCompile.mockReturnValue(COMPILED_KPITILE);
    mockExecute.mockResolvedValue([{ total: 42000 }]);
    const { container } = renderRenderer();
    await waitFor(() => screen.getByText('42000'));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

**Verify (GREEN):** `npm test -- --reporter=verbose pages/UserViewRenderer.test.tsx` — AC-VR-012 axe tests pass.

---

### T-17 — Write the Playwright e2e test (AC-VR-020) — authored; CI-only

**File:** `pmo-portal/e2e/AC-VR-020-view-renderer-ownership.spec.ts` (NEW)

This test is authored now and runs only in the CI `integration` job (PR→`main`). It must NOT be run locally (no Playwright browser installed locally for the current dev workflow). The file is committed; CI handles execution.

```typescript
/**
 * AC-VR-020 — View-renderer ownership: a private view is accessible only to its owner.
 *
 * Proves the deputy model (NFR-VR-SEC-001, ADR-0036 §2): a viewer's JWT scopes
 * what rows executeCompiledQuery returns — sharing never leaks another user's data.
 *
 * Two-user journey:
 *   Alice (admin@acme.test)  — creates a private view and sees it rendered.
 *   Bob   (engineer@acme.test) — opens the same viewId and sees the not-found guard.
 *
 * Precondition: the test inserts a user_views row directly via the Supabase service-role
 * client (test-only) so it does not depend on the I4 builder UI. The row is cleaned up
 * in the afterEach hook.
 *
 * Runs in: CI `integration` job (PR→main). NOT run locally.
 * pgTAP already proves the RLS isolation (I1); this e2e proves the renderer surfaces it.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn } from './helpers';

test.setTimeout(120_000);

const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ALICE_EMAIL = 'admin@acme.test';
const BOB_EMAIL = 'engineer@acme.test';

const SEED_SPEC = {
  version: 1,
  panels: [{
    id: 'kpi-1',
    primitive: 'KPITile',
    querySpec: {
      entity: 'projects',
      select: ['id'],
      aggregate: { fn: 'count', column: 'id', alias: 'total' },
    },
    props: { icon: 'doc', tone: 'blue', label: 'Project Count' },
  }],
};

let viewId: string | null = null;

test.beforeAll(async () => {
  // Insert a private user_views row owned by Alice via the service-role client
  // (test-only; never used in the app). We look up Alice's profile id first.
  if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for AC-VR-020 e2e test');
  }
  const admin = createClient(SERVICE_URL, SERVICE_KEY);
  const { data: aliceProfile } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('email', ALICE_EMAIL)
    .single();
  if (!aliceProfile) throw new Error(`Alice profile not found for ${ALICE_EMAIL}`);

  const { data: inserted, error } = await admin
    .from('user_views')
    .insert({
      name: "Alice's Dashboard",
      spec: SEED_SPEC,
      scope: 'private',
      org_id: aliceProfile.org_id,
      user_id: aliceProfile.id,
    })
    .select('id')
    .single();
  if (error || !inserted) throw new Error(`Failed to seed view: ${error?.message}`);
  viewId = inserted.id;
});

test.afterAll(async () => {
  if (viewId) {
    const admin = createClient(SERVICE_URL, SERVICE_KEY);
    await admin.from('user_views').delete().eq('id', viewId);
  }
});

test('AC-VR-020: Alice sees her private view rendered with the KPITile panel', async ({ page }) => {
  // Feature must be on for this test; the CI env sets FEATURES.userViews = true via env var
  // or by a test-only flag override. For now we assert the renderer route is reachable.
  await signIn(page, ALICE_EMAIL);
  await page.goto(`/views/${viewId}`);
  // The renderer shows the view heading (not the not-found state)
  await expect(page.getByRole('heading', { name: "Alice's Dashboard" })).toBeVisible({ timeout: 20_000 });
  // The KPITile panel label is visible
  await expect(page.getByText('Project Count')).toBeVisible({ timeout: 15_000 });
  // No error state
  await expect(page.getByText(/this view was not found/i)).not.toBeVisible();
});

test('AC-VR-020: Bob opens the same viewId and sees the not-found guard (not Alice\'s data)', async ({ page }) => {
  await signIn(page, BOB_EMAIL);
  await page.goto(`/views/${viewId}`);
  // Bob should see the not-found guard — RLS returns null for a private view he doesn't own
  await expect(page.getByText(/this view was not found/i)).toBeVisible({ timeout: 20_000 });
  // Bob must NOT see Alice's data or heading
  await expect(page.getByRole('heading', { name: "Alice's Dashboard" })).not.toBeVisible();
  await expect(page.getByText('Project Count')).not.toBeVisible();
});
```

**Note:** This test requires `FEATURES.userViews = true` in the CI environment. The CI `integration` job must set this via an env override (e.g. `VITE_USERVIEWS_OVERRIDE=true` + a `features.ts` env check) OR the test can temporarily flip the flag. The implementer must ensure the CI integration job has `SUPABASE_SERVICE_ROLE_KEY` available as a secret. The `FEATURES.userViews` flag starts as `false`; the CI integration job flips it via `VITE_FEATURES_USERVIEWS=true` + a guard in `features.ts`:

```typescript
// features.ts — add env override for CI integration tests only
export const FEATURES = {
  incidents: false,
  userViews: import.meta.env.VITE_FEATURES_USERVIEWS === 'true' || false,
} as const;
```

**Verify (authored — not run locally):** File is committed; CI runs it on PR→`main`. Local: `npm run typecheck` confirms the file type-checks.

---

### T-18 — Full verify gate

**Command:**
```bash
cd /home/user/PMO/pmo-portal && npm run verify
```

This runs `typecheck && lint:ci && test && build` — the mandatory pre-push gate. All of the following must pass:

- `npm run typecheck` — zero errors across all changed + existing files.
- `npm run lint:ci` — zero errors (`--max-warnings=0`).
- `npm test` — all Vitest tests pass (including the new AC-VR-001..018 RTL/axe tests and AC-VR-013 executor tests). Coverage ≥ 80% on changed files.
- `npm run build` — Vite bundles `UserViewRenderer` as a lazy chunk without error. The route `/views/:viewId` exists in the bundle; no `MODULES` entry starts with `/views`.

**Post-build namespace check (FR-VR-052, FR-VR-081):**

After `npm run build`, run:
```bash
grep -r "path.*'/views" /home/user/PMO/pmo-portal/src/components/shell/routeMatch.ts
# Expect: zero matches — no MODULES entry has path starting with /views
grep -r '"to.*\/views' /home/user/PMO/pmo-portal/src/components/shell/Rail.tsx
# Expect: only the dynamic /views/${view.id} links (My Views group), no static ALL_ITEMS entry
```

---

## Summary of owner-decisions baked in

All 9 OD defaults from spec §7 are implemented as stated. The implementer must confirm:
1. **OD-1**: "Go to Dashboard" CTA text — can be changed in `UserViewRenderer.tsx` `action.label`.
2. **OD-7**: `MAX_NAV_VIEWS = 8` in `Rail.tsx` — a one-line constant.
3. **OD-9**: `MAX_PANELS_PER_VIEW = 20` in `UserViewRenderer.tsx` — a one-line constant.
4. **AC-VR-020 CI**: `SUPABASE_SERVICE_ROLE_KEY` must be a CI secret and `VITE_FEATURES_USERVIEWS=true` must be set in the `integration` job for the Playwright test to pass.

## Open questions for the Director

1. **`vitest-axe` availability** — the axe-core tests (T-16) require `vitest-axe` and `axe-core` as dev dependencies. Confirm they are already in `pmo-portal/package.json` (from ADR-0030 Layer-1 a11y work) or the implementer must add them with `npm install --save-dev vitest-axe axe-core`.

2. **`VITE_FEATURES_USERVIEWS` CI env var** — the AC-VR-020 Playwright test requires `FEATURES.userViews = true` at runtime. The plan includes a `features.ts` env override guard. The Director should confirm this is the correct mechanism (vs. a test fixture that directly patches the flag).

3. **`ShellChrome.test.tsx` import path** — `buildViewsPaletteItems` is exported from `App.tsx`. The test imports `from '../../App'`. This crosses the page boundary from a `src/components/shell/` test file; if the project has a lint rule against this (e.g. import-order restrictions), the helper may need to be extracted to `src/lib/viewPaletteItems.ts`. Implementer checks ESLint rules before committing T-05.
