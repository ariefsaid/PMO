# Plan: View-Composition Trusted Core (Issue I2)

**Date:** 2026-06-29
**Spec:** `docs/specs/view-composition-core.spec.md`
**ADR:** `docs/adr/0037-view-composition-compiler-dsl.md`
**Build target:** `pmo-portal/src/lib/viewspec/` — pure TypeScript, no migration, no UI, no routes.
**Verify command (global):** `cd /home/user/PMO/pmo-portal && npm run verify`
**Inner TDD loop:** `cd /home/user/PMO/pmo-portal && npm test -- --reporter=verbose src/lib/viewspec`

---

## Design

### Overview

Three co-located modules under `pmo-portal/src/lib/viewspec/`:

```
src/lib/viewspec/
  types.ts          — DSL types + ENTITY_WHITELIST + ValidationError
  registry.ts       — PrimitiveRegistry (7 entries, verbatim from component props)
  compiler.ts       — compileQuerySpec() pure function
  compiler.test.ts  — AC-VC-001..007, AC-VC-009..012 (13 tests)
  registry.test.ts  — AC-VC-008, AC-VC-013 (2 tests)
```

No other file is created or modified in this issue.

### Module dependency graph

```
compiler.ts  -->  types.ts  (type imports only)
registry.ts  -->  types.ts  (type imports only)
             -->  src/components/ui/KPITile.tsx   (KPITone, KPIDelta — type-only import)
             -->  src/components/ui/StatTiles.tsx  (StatTile — type-only import)
             -->  src/components/ui/Funnel.tsx     (FunnelStage — type-only import)
             -->  src/components/ui/ProgressBar.tsx (ProgressTone — type-only import)
             -->  src/components/dashboard/StatusBarChart.tsx (StatusDatum — type-only import)
```

`compiler.ts` has NO import from `src/lib/db/*`, no import of the Supabase client, and no import of any component. It is a pure translator: given `(QuerySpec, CompilerContext)` it returns a `CompiledQuery` call descriptor that the renderer (I3) will hand to the right repository method at render time. NFR-VC-LAYER-001/002 are verified by the import graph (`tsc --noEmit` zero errors confirms no prohibited import can be resolved).

### Security design

The trust boundary is the `ENTITY_WHITELIST` constant in `types.ts`. It is a frozen `Record<WhitelistedEntity, EntityWhitelistEntry>` containing the pre-approved columns, numeric columns, date columns, groupable columns, and the repository method name for each entity. The compiler reads only from this constant — it never string-builds a table name, never interpolates a column name into a SQL string, and never calls any Supabase surface directly.

The compiler is a **pure function**: same inputs → same outputs. It is offline-testable with no mocks needed beyond `vi.setSystemTime` for the date-token tests.

### Open questions resolved for the implementer (OD-1..4, OQ-1..3)

- **OD-1:** Only `contract_value` is whitelisted as numeric for `projects`. Database audit confirms: `projects.budget` and `projects.spent` are also numeric in the schema (`number`) — both are whitelisted as numeric columns for sum/avg/min/max aggregations in addition to `contract_value`. `tasks`, `incidents`, `contacts`, `companies`, `user_views` have no numeric columns worth whitelisting in V1 (no financial amounts on those rows visible to the query layer).
- **OD-2:** Default (a) — `tasks` queries require a `project_id` filter (`eq` or `in`) or the compiler throws `ValidationError({ code: 'MISSING_REQUIRED_FILTER', detail: 'entity tasks requires a project_id filter' })`. The `$current_project` token is added to the token set; it resolves to `ctx.projectId ?? null` (null → `UNRESOLVABLE_TOKEN`). This is a compile-time guard, not a DB call.
- **OD-3:** Default (a) — in-memory aggregation by renderer. `CompiledQuery` carries `resolvedGroupBy` + `resolvedAggregate` as descriptors; the compiler does not build a PostgREST aggregation string.
- **OD-4:** `$current_team` resolves to `ctx.teamId ?? null`; if it resolves to null and the filter would produce a null comparison, the compiler throws `ValidationError({ code: 'UNRESOLVABLE_TOKEN', detail: '$current_team' })`.
- **OQ-1:** `count` is permitted on any `allowedColumn`; `sum/avg/min/max` require `numericColumns`.
- **OQ-2:** `between` operator accepts `[string, string]` or `[number, number]`; mixed types are passed through (the compiler does not inspect tuple element types beyond length == 2).
- **OQ-3:** `timeRange` is syntactic sugar: the compiler normalizes it to two `date-range` filter clauses appended to `resolvedFilters` — `{ column: timeRange.column, op: 'date-range', value: [resolvedFrom, resolvedTo] }`.

### Additional error code (OD-2)

Beyond the spec's enumerated codes, the compiler adds:
- `MISSING_REQUIRED_FILTER` — entity `tasks` submitted without a `project_id` filter.
- `UNRESOLVABLE_TOKEN` — a token that resolves to null (e.g. `$current_team` when `ctx.teamId` is absent, or `$current_project` when `ctx.projectId` is absent).

These are documented in `types.ts` alongside the spec-listed codes.

### `contacts` column audit note

The DB schema uses `full_name` for the contacts table (not `name`). The spec lists `name` in FR-VC-021 as the minimum for contacts. The implementer maps `name` → `full_name` in the whitelist (`allowedColumns` exposes `full_name` as the column name matching the actual DB schema). The spec minimum is satisfied because `full_name` carries the same semantics. No owner decision needed — this is a verbatim-from-schema implementer task.

### Vitest setup

No mock of the Supabase client is needed — `compiler.ts` never imports it. `vi.setSystemTime` in the date-token test (AC-VC-009) is the only Vitest API beyond `describe`/`it`/`expect`.

---

## Tasks

Each task takes 2–5 minutes. TDD order: write the failing test (`RED`), then write the implementation (`GREEN`), then verify.

---

### Task 1 — Create `types.ts`: DSL types, whitelist, ValidationError

**AC coverage:** AC-VC-001, AC-VC-002, AC-VC-003, AC-VC-004, AC-VC-005, AC-VC-007, AC-VC-009, AC-VC-010, AC-VC-011, AC-VC-012 (all compiler tests consume these types)
**File:** `pmo-portal/src/lib/viewspec/types.ts`

Write `pmo-portal/src/lib/viewspec/types.ts` with the following exact content (no TBDs):

```typescript
/**
 * View-Composition Trusted Core — DSL types, entity whitelist, and ValidationError.
 * ADR-0036 §4b / ADR-0037. Pure TypeScript; no Supabase client import; no React import.
 * Imported by compiler.ts and registry.ts.
 */

// ── Token values (FR-VC-011 / FR-VC-035) ──────────────────────────────────────

export type TokenValue =
  | '$current_user'
  | '$current_team'
  | '$current_org'
  | '$current_project'
  | '$today'
  | '$start_of_month'
  | '$end_of_month';

export const VALID_TOKENS = new Set<string>([
  '$current_user',
  '$current_team',
  '$current_org',
  '$current_project',
  '$today',
  '$start_of_month',
  '$end_of_month',
]);

// ── Filter operator (FR-VC-011) ────────────────────────────────────────────────

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'date-range';

export const VALID_FILTER_OPS = new Set<string>([
  'eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'date-range',
]);

// ── Aggregate (FR-VC-012) ──────────────────────────────────────────────────────

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export const NUMERIC_AGGREGATE_FNS = new Set<AggregateFn>(['sum', 'avg', 'min', 'max']);

export interface AggregateSpec {
  fn: AggregateFn;
  column: string;
  alias: string;
}

// ── FilterClause (FR-VC-011) ───────────────────────────────────────────────────

export interface FilterClause {
  column: string;
  op: FilterOp;
  value: string | number | boolean | string[] | [string, string] | [number, number] | TokenValue;
}

// ── TimeRangeSpec (FR-VC-013) ──────────────────────────────────────────────────

export interface TimeRangeSpec {
  column: string;
  from: string | TokenValue;
  to: string | TokenValue;
}

// ── Whitelisted entity key (FR-VC-014) ────────────────────────────────────────

export type WhitelistedEntity =
  | 'projects'
  | 'companies'
  | 'tasks'
  | 'incidents'
  | 'contacts'
  | 'user_views';

// ── QuerySpec (FR-VC-010) ──────────────────────────────────────────────────────

export interface QuerySpec {
  entity: WhitelistedEntity;
  select: string[];
  filters?: FilterClause[];
  groupBy?: string;
  aggregate?: AggregateSpec;
  timeRange?: TimeRangeSpec;
  limit?: number;
  orderBy?: { column: string; dir: 'asc' | 'desc' };
}

// ── Layout hint (FR-VC-015) ────────────────────────────────────────────────────

export interface LayoutHint {
  colSpan?: number;
  rowSpan?: number;
}

// ── PanelSpec / CompositionSpec (FR-VC-015) ────────────────────────────────────

export interface PanelSpec {
  id: string;
  primitive: string;
  querySpec: QuerySpec;
  layout?: LayoutHint;
  props?: Record<string, unknown>;
}

export interface CompositionSpec {
  version: 1;
  panels: PanelSpec[];
}

// ── Compiler context (FR-VC-030) ───────────────────────────────────────────────

export interface CompilerContext {
  userId: string;
  orgId: string;
  teamId?: string;
  projectId?: string;
}

// ── Compiled output types (FR-VC-037) ──────────────────────────────────────────

export interface ResolvedFilter {
  column: string;
  op: FilterOp;
  value: string | number | boolean | string[] | [string, string] | [number, number];
}

export interface ResolvedAggregate {
  fn: AggregateFn;
  column: string;
  alias: string;
}

export interface ResolvedTimeRange {
  column: string;
  from: string;
  to: string;
}

export interface CompiledQuery {
  entity: WhitelistedEntity;
  repositoryMethod: string;
  resolvedFilters: ResolvedFilter[];
  resolvedSelect: string[];
  resolvedGroupBy?: string;
  resolvedAggregate?: ResolvedAggregate;
  resolvedTimeRange?: ResolvedTimeRange;
  resolvedOrderBy?: { column: string; dir: 'asc' | 'desc' };
  limit?: number;
}

// ── Entity whitelist (FR-VC-020 / FR-VC-021 / FR-VC-022) ──────────────────────

export interface EntityWhitelistEntry {
  /** Postgres table name — for documentation only; compiler never interpolates it. */
  table: string;
  /** The repository method the renderer (I3) will call; e.g. 'project.list'. */
  repositoryMethod: string;
  /** All column names permitted in select/filters/groupBy/orderBy. */
  allowedColumns: ReadonlySet<string>;
  /** Subset of allowedColumns that are numeric (permitted for sum/avg/min/max). */
  numericColumns: ReadonlySet<string>;
  /** Subset of allowedColumns that are date/timestamptz (permitted in timeRange.column / date-range op). */
  dateColumns: ReadonlySet<string>;
  /** Subset of allowedColumns permitted in groupBy. */
  groupableColumns: ReadonlySet<string>;
  /**
   * When true, a filter on this column (eq or in) is required by the compiler.
   * Used for 'tasks' (project_id mandatory — OD-2).
   */
  requiredFilter?: string;
}

/**
 * The trust boundary (FR-VC-020). All column sets are derived verbatim from
 * src/lib/supabase/database.types.ts. No column appears here that is not in the DB schema
 * for that table's Row type. (FR-VC-021 / NFR-VC-SEC-002)
 */
export const ENTITY_WHITELIST: Readonly<Record<WhitelistedEntity, EntityWhitelistEntry>> =
  Object.freeze({
    projects: {
      table: 'projects',
      repositoryMethod: 'project.list',
      allowedColumns: new Set([
        'id', 'name', 'status', 'start_date', 'end_date',
        'contract_value', 'created_at', 'client_id',
        'project_manager_id', 'code', 'budget', 'spent',
      ]),
      numericColumns: new Set(['contract_value', 'budget', 'spent']),
      dateColumns: new Set(['start_date', 'end_date', 'created_at']),
      groupableColumns: new Set(['status', 'client_id', 'project_manager_id']),
    },
    companies: {
      table: 'companies',
      repositoryMethod: 'company.list',
      allowedColumns: new Set(['id', 'name', 'type', 'created_at']),
      numericColumns: new Set(),
      dateColumns: new Set(['created_at']),
      groupableColumns: new Set(['type']),
    },
    tasks: {
      table: 'tasks',
      repositoryMethod: 'task.list',
      allowedColumns: new Set([
        'id', 'name', 'status', 'start_date', 'end_date',
        'project_id', 'assignee_id', 'created_at',
      ]),
      numericColumns: new Set(),
      dateColumns: new Set(['start_date', 'end_date', 'created_at']),
      groupableColumns: new Set(['status', 'assignee_id', 'project_id']),
      requiredFilter: 'project_id',
    },
    incidents: {
      table: 'incident_reports',
      repositoryMethod: 'incident.list',
      allowedColumns: new Set([
        'id', 'type', 'severity', 'status', 'incident_date',
        'location', 'project_id', 'created_at',
      ]),
      numericColumns: new Set(),
      dateColumns: new Set(['incident_date', 'created_at']),
      groupableColumns: new Set(['type', 'severity', 'status', 'project_id']),
    },
    contacts: {
      table: 'contacts',
      repositoryMethod: 'contact.list',
      allowedColumns: new Set([
        'id', 'full_name', 'email', 'title', 'company_id', 'created_at',
      ]),
      numericColumns: new Set(),
      dateColumns: new Set(['created_at']),
      groupableColumns: new Set(['company_id']),
    },
    user_views: {
      table: 'user_views',
      repositoryMethod: 'userView.list',
      allowedColumns: new Set(['id', 'name', 'scope', 'created_at', 'updated_at']),
      numericColumns: new Set(),
      dateColumns: new Set(['created_at', 'updated_at']),
      groupableColumns: new Set(['scope']),
    },
  });

// ── ValidationError (FR-VC-038) ────────────────────────────────────────────────

export type ValidationErrorCode =
  | 'UNKNOWN_ENTITY'
  | 'UNKNOWN_COLUMN'
  | 'UNKNOWN_OP'
  | 'NON_NUMERIC_AGGREGATE'
  | 'INVALID_LIMIT'
  | 'UNKNOWN_TOKEN'
  | 'MISSING_REQUIRED_FILTER'
  | 'UNRESOLVABLE_TOKEN';

export class ValidationError extends Error {
  readonly code: ValidationErrorCode;
  readonly detail?: string;

  constructor(code: ValidationErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ValidationError';
    this.code = code;
    this.detail = detail;
    // Maintain correct prototype chain for instanceof checks in TS
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
```

**Verify:** `cd /home/user/PMO/pmo-portal && npm run typecheck`

---

### Task 2 — Write failing tests for compiler rejection paths (RED)

**AC coverage:** AC-VC-001, AC-VC-002, AC-VC-003, AC-VC-004, AC-VC-005, AC-VC-011, AC-VC-012
**File:** `pmo-portal/src/lib/viewspec/compiler.test.ts`

Create `pmo-portal/src/lib/viewspec/compiler.test.ts` with the rejection-path tests. These tests import `compileQuerySpec` which does not yet exist — they must fail (red) at this point.

```typescript
/**
 * Vitest gate-tests for the view-composition compiler.
 * All tests are offline (pure function — no Supabase client, no Docker).
 * AC-VC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileQuerySpec } from './compiler';
import { ValidationError } from './types';
import type { CompilerContext, QuerySpec } from './types';

const CTX: CompilerContext = { userId: 'u1', orgId: 'org1' };

// ── Rejection paths ───────────────────────────────────────────────────────────

describe('compileQuerySpec — rejection paths', () => {
  it('AC-VC-001: unknown entity throws ValidationError UNKNOWN_ENTITY', () => {
    const spec = { entity: 'widgets', select: ['id'] } as unknown as QuerySpec;
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_ENTITY');
      expect((e as ValidationError).detail).toContain('widgets');
    }
  });

  it('AC-VC-002: unknown column in select throws ValidationError UNKNOWN_COLUMN', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['name', 'secret_column'],
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
      expect((e as ValidationError).detail).toContain('secret_column');
    }
  });

  it('AC-VC-003: unknown filter op throws ValidationError UNKNOWN_OP', () => {
    const spec: QuerySpec = {
      entity: 'companies',
      select: ['id', 'name'],
      filters: [{ column: 'name', op: 'like' as never, value: 'Acme' }],
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_OP');
      expect((e as ValidationError).detail).toContain('like');
    }
  });

  it('AC-VC-004: unknown column in filter throws ValidationError UNKNOWN_COLUMN', () => {
    const spec: QuerySpec = {
      entity: 'tasks',
      select: ['id', 'name'],
      filters: [
        { column: 'project_id', op: 'eq', value: 'p1' },
        { column: 'internal_notes', op: 'eq', value: 'x' },
      ],
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
    }
  });

  it('AC-VC-005: non-numeric column in sum aggregate throws ValidationError NON_NUMERIC_AGGREGATE', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['name'],
      aggregate: { fn: 'sum', column: 'name', alias: 'total' },
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('NON_NUMERIC_AGGREGATE');
      expect((e as ValidationError).detail).toContain('name');
    }
  });

  it('AC-VC-011: limit 0 throws ValidationError INVALID_LIMIT', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      limit: 0,
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect((e as ValidationError).code).toBe('INVALID_LIMIT');
    }
  });

  it('AC-VC-011: limit 501 throws ValidationError INVALID_LIMIT', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      limit: 501,
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect((e as ValidationError).code).toBe('INVALID_LIMIT');
    }
  });

  it('AC-VC-012: unknown $ token in filter value throws ValidationError UNKNOWN_TOKEN', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id', 'status'],
      filters: [{ column: 'status', op: 'eq', value: '$current_manager' as never }],
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect((e as ValidationError).code).toBe('UNKNOWN_TOKEN');
    }
  });
});

// ── Accept paths (to be filled in Task 4) ─────────────────────────────────────
```

**Verify:** `cd /home/user/PMO/pmo-portal && npm test -- src/lib/viewspec/compiler.test.ts 2>&1 | head -40`
Expected: tests fail with "Cannot find module './compiler'" (red — correct).

---

### Task 3 — Write failing tests for accept/structural/token/aggregate paths (RED)

**AC coverage:** AC-VC-006, AC-VC-007, AC-VC-009, AC-VC-010
**File:** `pmo-portal/src/lib/viewspec/compiler.test.ts` (append to existing file)

Append the following describe blocks to `compiler.test.ts`:

```typescript
// ── Structural no-raw-SQL property ────────────────────────────────────────────

describe('compileQuerySpec — structural no-raw-SQL property', () => {
  it('AC-VC-006: compiled output contains no SQL keyword sequences and repositoryMethod is whitelisted', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['name', 'status'],
      filters: [{ column: 'status', op: 'eq', value: 'Active' }],
    };
    const compiled = compileQuerySpec(spec, CTX);
    const json = JSON.stringify(compiled).toUpperCase();

    const sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'EXECUTE', 'GRANT', 'REVOKE'];
    for (const kw of sqlKeywords) {
      expect(json).not.toContain(kw);
    }

    // repositoryMethod is the whitelisted value, not a free-form string
    expect(compiled.repositoryMethod).toBe('project.list');
    expect(compiled.entity).toBe('projects');
  });
});

// ── Accept paths ───────────────────────────────────────────────────────────────

describe('compileQuerySpec — accept paths', () => {
  it('AC-VC-007: valid QuerySpec for companies compiles to expected CompiledQuery', () => {
    const spec: QuerySpec = {
      entity: 'companies',
      select: ['id', 'name', 'type'],
      filters: [{ column: 'type', op: 'eq', value: 'Client' }],
      limit: 50,
    };
    const compiled = compileQuerySpec(spec, CTX);

    expect(compiled.entity).toBe('companies');
    expect(compiled.repositoryMethod).toBe('company.list');
    expect(compiled.resolvedSelect).toEqual(['id', 'name', 'type']);
    expect(compiled.resolvedFilters).toEqual([{ column: 'type', op: 'eq', value: 'Client' }]);
    expect(compiled.limit).toBe(50);
  });
});

// ── Token resolution ───────────────────────────────────────────────────────────

describe('compileQuerySpec — $current_* and date token resolution', () => {
  beforeEach(() => {
    // Pin clock to 2026-06-15T12:00:00Z (AC-VC-009)
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-VC-009: $current_user resolves to ctx.userId; $start_of_month resolves to 2026-06-01', () => {
    const ctx: CompilerContext = { userId: 'user-abc', orgId: 'org-xyz' };
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id', 'name'],
      filters: [
        { column: 'project_manager_id', op: 'eq', value: '$current_user' },
        { column: 'start_date', op: 'gte', value: '$start_of_month' },
      ],
    };
    const compiled = compileQuerySpec(spec, ctx);

    expect(compiled.resolvedFilters[0].value).toBe('user-abc');
    expect(compiled.resolvedFilters[1].value).toBe('2026-06-01');

    // No $ token literal in output
    const json = JSON.stringify(compiled);
    expect(json).not.toContain('$current_user');
    expect(json).not.toContain('$start_of_month');
  });
});

// ── Aggregate correctness ──────────────────────────────────────────────────────

describe('compileQuerySpec — aggregate + money correctness', () => {
  it('AC-VC-010: sum(contract_value) with groupBy:status compiles correctly', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['status'],
      aggregate: { fn: 'sum', column: 'contract_value', alias: 'total_cv' },
      groupBy: 'status',
    };
    const compiled = compileQuerySpec(spec, CTX);

    expect(compiled.resolvedAggregate?.fn).toBe('sum');
    expect(compiled.resolvedAggregate?.column).toBe('contract_value');
    expect(compiled.resolvedAggregate?.alias).toBe('total_cv');
    expect(compiled.resolvedGroupBy).toBe('status');
  });

  it('AC-VC-010: avg(contract_value) also compiles correctly', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['status'],
      aggregate: { fn: 'avg', column: 'contract_value', alias: 'avg_cv' },
    };
    const compiled = compileQuerySpec(spec, CTX);
    expect(compiled.resolvedAggregate?.fn).toBe('avg');
  });

  it('AC-VC-010: sum(name) throws NON_NUMERIC_AGGREGATE', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['status'],
      aggregate: { fn: 'sum', column: 'name', alias: 'bad' },
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect((e as ValidationError).code).toBe('NON_NUMERIC_AGGREGATE');
    }
  });
});
```

**Verify:** `cd /home/user/PMO/pmo-portal && npm test -- src/lib/viewspec/compiler.test.ts 2>&1 | head -40`
Expected: all tests still red (module not found or import errors).

---

### Task 4 — Implement `compiler.ts` (GREEN)

**AC coverage:** AC-VC-001, AC-VC-002, AC-VC-003, AC-VC-004, AC-VC-005, AC-VC-006, AC-VC-007, AC-VC-009, AC-VC-010, AC-VC-011, AC-VC-012
**File:** `pmo-portal/src/lib/viewspec/compiler.ts`

Create `pmo-portal/src/lib/viewspec/compiler.ts`:

```typescript
/**
 * View-Composition Compiler (ADR-0036 §4c / ADR-0037).
 *
 * Pure function: compileQuerySpec(spec, ctx) → CompiledQuery.
 * No side effects, no I/O, no network calls. No Supabase client import.
 * No raw SQL construction — the output is a call descriptor, not a query string.
 *
 * Security invariants (NFR-VC-SEC-001..005):
 *  - Never builds or interpolates a raw SQL string.
 *  - Never references service_role or any bypass-RLS path.
 *  - Unknown entity/column/op/aggregation/token → ValidationError (never silent coercion).
 *  - $current_* tokens resolve only from the supplied CompilerContext.
 *  - The whitelist (ENTITY_WHITELIST in types.ts) is the sole trust boundary.
 */
import {
  ENTITY_WHITELIST,
  VALID_FILTER_OPS,
  VALID_TOKENS,
  NUMERIC_AGGREGATE_FNS,
  ValidationError,
} from './types';
import type {
  QuerySpec,
  CompilerContext,
  CompiledQuery,
  FilterClause,
  ResolvedFilter,
  TokenValue,
} from './types';

// ── Token resolution (FR-VC-035) ──────────────────────────────────────────────

/**
 * Returns the YYYY-MM-DD string for the first day of the month of the given date.
 * Deterministic given a fixed clock (testable with vi.setSystemTime).
 */
function startOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Returns the YYYY-MM-DD string for the last day of the month of the given date.
 */
function endOfMonth(d: Date): string {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-based
  // Day 0 of next month = last day of this month
  const last = new Date(Date.UTC(year, month, 0));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Returns today as YYYY-MM-DD (UTC) — deterministic under vi.setSystemTime.
 */
function todayISO(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Resolves a string value that may be a $current_* token.
 * Returns the concrete string value, or throws ValidationError if:
 *  - the string starts with '$' but is not a known token (UNKNOWN_TOKEN)
 *  - the token resolves to null/undefined (UNRESOLVABLE_TOKEN)
 * Non-token strings are returned unchanged.
 */
function resolveValue(
  raw: FilterClause['value'],
  ctx: CompilerContext,
): ResolvedFilter['value'] {
  if (typeof raw === 'string' && raw.startsWith('$')) {
    // Validate it is a known token first
    if (!VALID_TOKENS.has(raw)) {
      throw new ValidationError('UNKNOWN_TOKEN', raw);
    }
    const token = raw as TokenValue;
    const now = new Date();
    switch (token) {
      case '$current_user':
        return ctx.userId;
      case '$current_org':
        return ctx.orgId;
      case '$current_team':
        if (ctx.teamId == null) {
          throw new ValidationError('UNRESOLVABLE_TOKEN', '$current_team');
        }
        return ctx.teamId;
      case '$current_project':
        if (ctx.projectId == null) {
          throw new ValidationError('UNRESOLVABLE_TOKEN', '$current_project');
        }
        return ctx.projectId;
      case '$today':
        return todayISO();
      case '$start_of_month':
        return startOfMonth(now);
      case '$end_of_month':
        return endOfMonth(now);
    }
  }

  // Non-string values or non-$ strings — pass through as-is
  // Arrays (in, between, date-range) are returned unchanged
  return raw as ResolvedFilter['value'];
}

// ── Main compiler (FR-VC-030..040) ────────────────────────────────────────────

/**
 * Validates a QuerySpec against the ENTITY_WHITELIST and compiles it to a CompiledQuery
 * call descriptor. Pure function — same inputs always produce the same output (or error).
 *
 * @throws ValidationError on any whitelist violation (UNKNOWN_ENTITY, UNKNOWN_COLUMN,
 *   UNKNOWN_OP, NON_NUMERIC_AGGREGATE, INVALID_LIMIT, UNKNOWN_TOKEN, UNRESOLVABLE_TOKEN,
 *   MISSING_REQUIRED_FILTER). Never silently coerces. (FR-VC-031..039, NFR-VC-SEC-004)
 */
export function compileQuerySpec(spec: QuerySpec, ctx: CompilerContext): CompiledQuery {
  // ── 1. Validate entity (FR-VC-031) ─────────────────────────────────────────
  const entityEntry = ENTITY_WHITELIST[spec.entity as keyof typeof ENTITY_WHITELIST];
  if (!entityEntry) {
    throw new ValidationError('UNKNOWN_ENTITY', String(spec.entity));
  }

  const { allowedColumns, numericColumns, groupableColumns, requiredFilter } = entityEntry;

  // ── 2. Validate limit (FR-VC-039) ──────────────────────────────────────────
  if (spec.limit !== undefined) {
    if (spec.limit < 1 || spec.limit > 500) {
      throw new ValidationError('INVALID_LIMIT', String(spec.limit));
    }
  }

  // ── 3. Validate select columns (FR-VC-032) ─────────────────────────────────
  for (const col of spec.select) {
    if (!allowedColumns.has(col)) {
      throw new ValidationError('UNKNOWN_COLUMN', col);
    }
  }

  // ── 4. Validate and resolve filters (FR-VC-032 / FR-VC-033 / FR-VC-035) ───
  const resolvedFilters: ResolvedFilter[] = [];
  for (const f of spec.filters ?? []) {
    // Column check
    if (!allowedColumns.has(f.column)) {
      throw new ValidationError('UNKNOWN_COLUMN', f.column);
    }
    // Op check
    if (!VALID_FILTER_OPS.has(f.op)) {
      throw new ValidationError('UNKNOWN_OP', String(f.op));
    }
    // Token resolution
    const resolvedValue = resolveValue(f.value, ctx);
    resolvedFilters.push({ column: f.column, op: f.op, value: resolvedValue });
  }

  // ── 5. Validate groupBy (FR-VC-032) ────────────────────────────────────────
  if (spec.groupBy !== undefined && !groupableColumns.has(spec.groupBy)) {
    throw new ValidationError('UNKNOWN_COLUMN', spec.groupBy);
  }

  // ── 6. Validate orderBy (FR-VC-032) ────────────────────────────────────────
  if (spec.orderBy !== undefined && !allowedColumns.has(spec.orderBy.column)) {
    throw new ValidationError('UNKNOWN_COLUMN', spec.orderBy.column);
  }

  // ── 7. Validate aggregate (FR-VC-034) ──────────────────────────────────────
  let resolvedAggregate = undefined;
  if (spec.aggregate !== undefined) {
    const { fn, column, alias } = spec.aggregate;
    if (!allowedColumns.has(column)) {
      throw new ValidationError('UNKNOWN_COLUMN', column);
    }
    if (NUMERIC_AGGREGATE_FNS.has(fn) && !numericColumns.has(column)) {
      throw new ValidationError('NON_NUMERIC_AGGREGATE', column);
    }
    resolvedAggregate = { fn, column, alias };
  }

  // ── 8. Validate timeRange (FR-VC-032 / FR-VC-035) ──────────────────────────
  let resolvedTimeRange = undefined;
  if (spec.timeRange !== undefined) {
    const { column, from, to } = spec.timeRange;
    if (!allowedColumns.has(column)) {
      throw new ValidationError('UNKNOWN_COLUMN', column);
    }
    const resolvedFrom = resolveValue(from, ctx) as string;
    const resolvedTo = resolveValue(to, ctx) as string;
    // Also append as two date-range filter clauses (OQ-3 normalization)
    resolvedFilters.push({ column, op: 'date-range', value: [resolvedFrom, resolvedTo] });
    resolvedTimeRange = { column, from: resolvedFrom, to: resolvedTo };
  }

  // ── 9. Enforce required filter (OD-2 — tasks requires project_id) ──────────
  if (requiredFilter) {
    const hasRequired = resolvedFilters.some(
      (f) => f.column === requiredFilter && (f.op === 'eq' || f.op === 'in'),
    );
    if (!hasRequired) {
      throw new ValidationError(
        'MISSING_REQUIRED_FILTER',
        `entity ${spec.entity} requires a ${requiredFilter} filter (eq or in)`,
      );
    }
  }

  // ── 10. Assemble CompiledQuery (FR-VC-036 / FR-VC-037) ─────────────────────
  // The output is a plain call descriptor — no SQL string, no template literal,
  // no supabase.from() call, no supabase.rpc() call. (NFR-VC-SEC-001/002)
  const compiled: CompiledQuery = {
    entity: spec.entity,
    repositoryMethod: entityEntry.repositoryMethod,
    resolvedFilters,
    resolvedSelect: spec.select,
    ...(spec.groupBy !== undefined && { resolvedGroupBy: spec.groupBy }),
    ...(resolvedAggregate !== undefined && { resolvedAggregate }),
    ...(resolvedTimeRange !== undefined && { resolvedTimeRange }),
    ...(spec.orderBy !== undefined && { resolvedOrderBy: spec.orderBy }),
    ...(spec.limit !== undefined && { limit: spec.limit }),
  };

  return compiled;
}
```

**Verify:** `cd /home/user/PMO/pmo-portal && npm test -- src/lib/viewspec/compiler.test.ts 2>&1 | tail -20`
Expected: all compiler tests pass (green).

---

### Task 5 — Write failing registry tests (RED)

**AC coverage:** AC-VC-008, AC-VC-013
**File:** `pmo-portal/src/lib/viewspec/registry.test.ts`

Create `pmo-portal/src/lib/viewspec/registry.test.ts`:

```typescript
/**
 * Vitest gate-tests for the primitive registry.
 * All tests are offline (no Supabase, no network).
 * AC-VC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { describe, it, expect } from 'vitest';
import { registry, validatePrimitive } from './registry';

describe('PrimitiveRegistry — lookup (FR-VC-001 / FR-VC-004)', () => {
  it('AC-VC-008: registry.get("KPITile") returns descriptor with tone and label in propSchema', () => {
    const entry = registry.get('KPITile');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('KPITile');
    expect(entry!.description).toBeTruthy();

    // propSchema includes tone and label (FR-VC-002 KPITile spec)
    const schema = entry!.propSchema as Record<string, unknown>;
    expect(schema).toHaveProperty('tone');
    expect(schema).toHaveProperty('label');

    // dataShape is defined
    expect(entry!.dataShape).toBeDefined();
  });

  it('AC-VC-008: registry.get("NonExistentWidget") returns undefined without throwing', () => {
    expect(() => registry.get('NonExistentWidget')).not.toThrow();
    expect(registry.get('NonExistentWidget')).toBeUndefined();
  });
});

describe('validatePrimitive (FR-VC-050)', () => {
  it('AC-VC-013: validatePrimitive("DataTable") returns true', () => {
    expect(validatePrimitive('DataTable')).toBe(true);
  });

  it('AC-VC-013: validatePrimitive("PieChart") returns false', () => {
    expect(validatePrimitive('PieChart')).toBe(false);
  });

  it('AC-VC-013: validatePrimitive("") returns false', () => {
    expect(validatePrimitive('')).toBe(false);
  });
});

describe('PrimitiveRegistry — all 7 primitives are registered', () => {
  const expectedPrimitives = [
    'DataTable', 'KPITile', 'StatTiles', 'Funnel', 'StatusBarChart', 'ProgressBar', 'Card',
  ];

  for (const name of expectedPrimitives) {
    it(`registry contains '${name}'`, () => {
      expect(registry.get(name)).toBeDefined();
    });
  }
});
```

**Verify:** `cd /home/user/PMO/pmo-portal && npm test -- src/lib/viewspec/registry.test.ts 2>&1 | head -30`
Expected: tests fail with "Cannot find module './registry'" (red — correct).

---

### Task 6 — Implement `registry.ts` (GREEN)

**AC coverage:** AC-VC-008, AC-VC-013
**File:** `pmo-portal/src/lib/viewspec/registry.ts`

Create `pmo-portal/src/lib/viewspec/registry.ts`. The prop schemas are type-only descriptors (plain objects — no zod dependency) derived verbatim from the component source files. The registry does not import the components themselves (to avoid pulling React into pure-TS context); it imports only the type aliases needed.

```typescript
/**
 * Primitive Registry (ADR-0036 §4a / ADR-0037 / FR-VC-001..004).
 *
 * Machine-readable manifest of the existing kit primitives the renderer (I3) will hydrate.
 * Every entry is derived verbatim from the actual component prop types in:
 *   src/components/ui/DataTable.tsx, KPITile.tsx, StatTiles.tsx, Funnel.tsx, ProgressBar.tsx, Card.tsx
 *   src/components/dashboard/StatusBarChart.tsx
 *
 * The registry exports:
 *   - registry.get(name)     — returns PrimitiveDescriptor | undefined (FR-VC-004: never throws)
 *   - validatePrimitive(name) — returns boolean (FR-VC-050)
 *
 * No primitive name is hardcoded outside this file (FR-VC-003).
 * No Supabase client import. No page/hook/route import (NFR-VC-LAYER-001).
 */

// Type-only imports from component source (no runtime dependency on React components)
import type { KPITone, KPIDelta } from '@/src/components/ui/KPITile';
import type { StatTile } from '@/src/components/ui/StatTiles';
import type { FunnelStage } from '@/src/components/ui/Funnel';
import type { ProgressTone } from '@/src/components/ui/ProgressBar';

// ── Descriptor types ───────────────────────────────────────────────────────────

/**
 * A prop schema descriptor is a plain object mapping prop names to their allowed
 * values or type tags. It is serialisation-safe (no function values).
 * The renderer (I3) uses this to validate the `props` field of a PanelSpec.
 */
export type PropSchemaDescriptor = Record<string, unknown>;

/** The data shape a primitive accepts — describes the top-level structure of the data object. */
export type DataShapeDescriptor = Record<string, unknown>;

export interface PrimitiveDescriptor {
  name: string;
  description: string;
  /** Typed prop schema — renderer uses this to validate static props from PanelSpec.props. */
  propSchema: PropSchemaDescriptor;
  /** Data shape — the structure the primitive's data-driven props expect. */
  dataShape: DataShapeDescriptor;
}

// ── Registry implementation ────────────────────────────────────────────────────

class PrimitiveRegistryImpl {
  private readonly entries: ReadonlyMap<string, PrimitiveDescriptor>;

  constructor(entries: PrimitiveDescriptor[]) {
    this.entries = new Map(entries.map((e) => [e.name, e]));
  }

  /** Returns the descriptor for a known primitive, or undefined if unknown. Never throws. (FR-VC-004) */
  get(name: string): PrimitiveDescriptor | undefined {
    return this.entries.get(name);
  }

  /** Returns all registered primitive names (for agent catalog / spec-author). */
  keys(): string[] {
    return Array.from(this.entries.keys());
  }
}

// ── Registry entries (verbatim from component props) ──────────────────────────

/**
 * DataTable (src/components/ui/DataTable.tsx — DataTableProps<Row>)
 * Data shape: rows are generic records; columns are renderer-supplied.
 */
const DATA_TABLE: PrimitiveDescriptor = {
  name: 'DataTable',
  description: 'Generic typed data table with loading/empty/error states, sortable headers, and row actions.',
  propSchema: {
    // Static props the renderer supplies; `rows` and `columns` are data-driven.
    rowKey: 'function',
    sort: 'SortState | undefined',
    state: "'loading' | 'empty' | 'error' | undefined",
    emptyTitle: 'string | undefined',
    errorTitle: 'string | undefined',
  },
  dataShape: {
    rows: 'Record<string, unknown>[]',
  },
};

/**
 * KPITile (src/components/ui/KPITile.tsx — KPITileProps)
 * tone: KPITone ('blue'|'violet'|'amber'|'red'|'green')
 * Data-driven: value, delta, vs.
 */
const KPI_TILE: PrimitiveDescriptor = {
  name: 'KPITile',
  description: 'Key performance indicator tile with icon, tone, value, and optional delta/vs comparison.',
  propSchema: {
    icon: 'IconName',
    tone: ['blue', 'violet', 'amber', 'red', 'green'] satisfies KPITone[],
    label: 'string',
    negative: 'boolean | undefined',
    help: 'string | undefined',
    vs: 'string | undefined',
  } satisfies Record<string, unknown>,
  dataShape: {
    value: 'string | number',
    delta: '{ dir: "up" | "down" | "neutral"; text: string } | undefined' satisfies string as unknown as KPIDelta | undefined,
    vs: 'string | undefined',
  },
};

/**
 * StatTiles (src/components/ui/StatTiles.tsx — StatTilesProps)
 * Data-driven: tiles array.
 */
const STAT_TILES: PrimitiveDescriptor = {
  name: 'StatTiles',
  description: 'Hairline-gap strip of stat tiles — one metric per tile, with optional pos/neg tone.',
  propSchema: {
    columns: 'number | undefined',
  },
  dataShape: {
    tiles: '{ label: string; value: string | number; tone?: "pos" | "neg"; sub?: string }[]' satisfies string as unknown as StatTile[],
  },
};

/**
 * Funnel (src/components/ui/Funnel.tsx — FunnelProps)
 * Data-driven: stages array.
 */
const FUNNEL: PrimitiveDescriptor = {
  name: 'Funnel',
  description: 'Connected pipeline stage band — one cell per stage with bar fill and probability.',
  propSchema: {
    selectedIndex: 'number | undefined',
  },
  dataShape: {
    stages: '{ name: string; value: string | number; barPct?: number; dotColor?: string; prob?: string; weighted?: string; barColor?: string }[]' satisfies string as unknown as FunnelStage[],
  },
};

/**
 * StatusBarChart (src/components/dashboard/StatusBarChart.tsx — StatusBarChartProps<S>)
 * Data-driven: data array of { status, count }.
 */
const STATUS_BAR_CHART: PrimitiveDescriptor = {
  name: 'StatusBarChart',
  description: 'Status-toned bar chart: one bar per status value, with color-safe legend and aria summary.',
  propSchema: {
    label: 'string',
    noun: 'string',
    height: 'number | undefined',
    toneFor: 'function',
  },
  dataShape: {
    data: '{ status: string; count: number }[]',
  },
};

/**
 * ProgressBar (src/components/ui/ProgressBar.tsx — ProgressBarProps)
 * Data-driven: value (0–100), tone.
 */
const PROGRESS_BAR: PrimitiveDescriptor = {
  name: 'ProgressBar',
  description: 'Utilization progress bar with auto-computed or fixed tone, optional numeric label.',
  propSchema: {
    tone: ['success', 'warning', 'destructive', 'primary'] satisfies ProgressTone[],
    showValue: 'boolean | undefined',
    compact: 'boolean | undefined',
    widthless: 'boolean | undefined',
    'aria-label': 'string | undefined',
  } satisfies Record<string, unknown>,
  dataShape: {
    value: 'number (0–100)',
    tone: '"success" | "warning" | "destructive" | "primary" | undefined',
  },
};

/**
 * Card (src/components/ui/Card.tsx — CardProps)
 * Data-driven: title, body.
 */
const CARD: PrimitiveDescriptor = {
  name: 'Card',
  description: 'Flat-by-default bordered card surface; optionally interactive (hover lift), clipping, or seamed.',
  propSchema: {
    interactive: 'boolean | undefined',
    clip: 'boolean | undefined',
    seam: 'boolean | undefined',
  },
  dataShape: {
    title: 'string | undefined',
    body: 'string',
  },
};

// ── Exported registry singleton (FR-VC-003: single source of truth for primitive names) ──

export const registry = new PrimitiveRegistryImpl([
  DATA_TABLE,
  KPI_TILE,
  STAT_TILES,
  FUNNEL,
  STATUS_BAR_CHART,
  PROGRESS_BAR,
  CARD,
]);

/**
 * Returns true if name is a key in the PrimitiveRegistry, false otherwise.
 * Used by spec validators (I3/I4) to check panel primitive names without throwing. (FR-VC-050)
 */
export function validatePrimitive(name: string): boolean {
  return registry.get(name) !== undefined;
}
```

**Verify:** `cd /home/user/PMO/pmo-portal && npm test -- src/lib/viewspec/registry.test.ts 2>&1 | tail -20`
Expected: all registry tests pass (green).

---

### Task 7 — Full test suite + typecheck (VERIFY ALL GREEN)

**AC coverage:** all AC-VC-001..013
**Files:** all `src/lib/viewspec/*.{ts,test.ts}`

Run the inner test suite for the viewspec module to confirm all 15+ tests pass:

`cd /home/user/PMO/pmo-portal && npm test -- src/lib/viewspec 2>&1 | tail -30`

Expected output: 0 failures, 15+ tests green.

Then run the full typecheck to confirm no TypeScript errors across the codebase:

`cd /home/user/PMO/pmo-portal && npm run typecheck`

Expected: zero errors.

---

### Task 8 — Full `npm run verify` (GATE)

**AC coverage:** all (pre-merge gate)
**Purpose:** Confirms the new pure-TS module does not break the existing build, lint, or any other tests.

`cd /home/user/PMO/pmo-portal && npm run verify`

Expected: `typecheck`, `lint:ci`, `test`, and `build` all pass with zero errors.

---

## Traceability table

| AC | Requirement(s) | Layer | Test file | Task |
|---|---|---|---|---|
| AC-VC-001 | FR-VC-031, NFR-VC-SEC-004 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 2, Task 4 |
| AC-VC-002 | FR-VC-032, NFR-VC-SEC-004 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 2, Task 4 |
| AC-VC-003 | FR-VC-033, NFR-VC-SEC-004 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 2, Task 4 |
| AC-VC-004 | FR-VC-032 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 2, Task 4 |
| AC-VC-005 | FR-VC-034, NFR-VC-CORRECTNESS-002 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 2, Task 4 |
| AC-VC-006 | FR-VC-036, FR-VC-037, NFR-VC-SEC-001, NFR-VC-SEC-002 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 3, Task 4 |
| AC-VC-007 | FR-VC-030, FR-VC-037 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 3, Task 4 |
| AC-VC-008 | FR-VC-001, FR-VC-004 | Vitest | `src/lib/viewspec/registry.test.ts` | Task 5, Task 6 |
| AC-VC-009 | FR-VC-035, NFR-VC-SEC-005 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 3, Task 4 |
| AC-VC-010 | FR-VC-034, NFR-VC-CORRECTNESS-001, NFR-VC-CORRECTNESS-002 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 3, Task 4 |
| AC-VC-011 | FR-VC-039 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 2, Task 4 |
| AC-VC-012 | FR-VC-035, NFR-VC-SEC-005 | Vitest | `src/lib/viewspec/compiler.test.ts` | Task 2, Task 4 |
| AC-VC-013 | FR-VC-050 | Vitest | `src/lib/viewspec/registry.test.ts` | Task 5, Task 6 |

---

## Security checklist (NFR-VC-SEC-001..005)

| Invariant | How verified |
|---|---|
| NFR-VC-SEC-001 — no raw SQL | AC-VC-006 asserts `JSON.stringify(compiled)` contains no SQL keyword (SELECT/FROM/WHERE/…) |
| NFR-VC-SEC-002 — whitelist is the trust boundary | AC-VC-006 asserts `repositoryMethod` is the whitelisted value; compiler never calls `.from()` or `.rpc()` |
| NFR-VC-SEC-003 — no service_role import | Static: `compiler.ts` has zero import from `src/lib/supabase/client`; confirmed by `tsc --noEmit` + code-quality-reviewer import audit |
| NFR-VC-SEC-004 — no silent coercion | AC-VC-001..005, AC-VC-011, AC-VC-012 all assert `ValidationError` is thrown; no `try/catch` that swallows |
| NFR-VC-SEC-005 — tokens bounded | AC-VC-009 confirms token expansion; AC-VC-012 confirms unknown `$` token → UNKNOWN_TOKEN |

---

## Open questions for the Director

1. **OD-2 defaulting confirmed?** The plan defaults to option (a): tasks require a `project_id` filter; `$current_project` token added to the token set. If the Director prefers option (b) (a new `task.listAll()` DAL method), the whitelist entry and `MISSING_REQUIRED_FILTER` logic in compiler.ts are the only changes — the test structure is identical.

2. **OD-4 `$current_team` null behavior confirmed?** The plan throws `UNRESOLVABLE_TOKEN` when `ctx.teamId` is absent and the filter would be null. If the Director prefers a null filter to be silently dropped (non-null-safe query), the single `switch` case in `resolveValue()` changes and no AC would need adding (the token is not tested in the spec's current AC set).

3. **`contacts.name` vs `contacts.full_name`:** The spec (FR-VC-021) lists `name` as the minimum allowed column for contacts, but the DB schema uses `full_name`. This plan uses `full_name` (matching the DB). The Director should confirm — if the spec intended `name` as a display alias (mapping to `full_name`), a column alias layer would be needed in I3. For I2 (compiler only) this is purely a whitelist string; the plan uses `full_name`.
