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
      filters: [{ column: 'status', op: 'eq', value: '$current_manager' }],
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect((e as ValidationError).code).toBe('UNKNOWN_TOKEN');
    }
  });
});

// ── Structural no-raw-SQL property ────────────────────────────────────────────

describe('compileQuerySpec — structural no-raw-SQL property', () => {
  it('AC-VC-006: compiled DATA contains no SQL keyword sequences and the shape is the fixed call descriptor', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['name', 'status'],
      filters: [{ column: 'status', op: 'eq', value: 'Active' }],
    };
    const compiled = compileQuerySpec(spec, CTX);

    // The goal-oracle (NFR-VC-SEC-001): the compiler emits a structured call descriptor,
    // never a raw SQL string. The descriptor's KEY names are fixed by the CompiledQuery
    // contract (FR-VC-037) — `resolvedSelect` is a structural field, not user-controlled
    // SQL — so the no-SQL property is asserted over the descriptor's *values* (the only
    // surface a spec-author can influence). We scan every emitted value, not the key names.
    const values: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') values.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(compiled);
    const valueBlob = values.join('\u0000').toUpperCase();

    const sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'EXECUTE', 'GRANT', 'REVOKE'];
    for (const kw of sqlKeywords) {
      expect(valueBlob).not.toContain(kw);
    }

    // (b) The shape is exactly the whitelisted CompiledQuery descriptor — no free-form
    //     SQL fragment field, no `query`/`sql` string smuggled in.
    expect(Object.keys(compiled).sort()).toEqual(
      ['entity', 'resolvedFilters', 'resolvedSelect'].sort(),
    );

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

// ── Entity trust boundary: prototype-chain injection rejection ─────────────────

describe('compileQuerySpec — entity trust boundary (prototype-chain)', () => {
  it('AC-VC-001 (extends): entity "__proto__" throws ValidationError UNKNOWN_ENTITY, not a fall-through', () => {
    const spec = { entity: '__proto__', select: ['id'] } as unknown as QuerySpec;
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_ENTITY');
      expect((e as ValidationError).detail).toContain('__proto__');
    }
  });

  it('AC-VC-001 (extends): entity "constructor" throws ValidationError UNKNOWN_ENTITY', () => {
    const spec = { entity: 'constructor', select: ['id'] } as unknown as QuerySpec;
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_ENTITY');
    }
  });

  it('AC-VC-001 (extends): entity "toString" throws ValidationError UNKNOWN_ENTITY', () => {
    const spec = { entity: 'toString', select: ['id'] } as unknown as QuerySpec;
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_ENTITY');
    }
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

  it('AC-VC-010 (extends): aggregate on nonexistent column throws UNKNOWN_COLUMN before NON_NUMERIC_AGGREGATE', () => {
    // Ensures allowedColumns is checked BEFORE numericColumns (FR-VC-034 ordering).
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['status'],
      aggregate: { fn: 'sum', column: 'nonexistent', alias: 'x' },
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
      expect((e as ValidationError).detail).toContain('nonexistent');
    }
  });
});

// ── groupBy validation ─────────────────────────────────────────────────────────

describe('compileQuerySpec — groupBy validation', () => {
  it('AC-VC-014: groupBy on a column in allowedColumns but NOT groupableColumns throws NOT_GROUPABLE_COLUMN', () => {
    // 'name' is in projects.allowedColumns but NOT in projects.groupableColumns.
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['name'],
      groupBy: 'name',
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('NOT_GROUPABLE_COLUMN');
      expect((e as ValidationError).detail).toContain('name');
    }
  });

  it('AC-VC-002 (extends): groupBy on a column NOT in allowedColumns at all throws UNKNOWN_COLUMN', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      groupBy: 'totally_unknown',
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
    }
  });
});

// ── orderBy validation ─────────────────────────────────────────────────────────

describe('compileQuerySpec — orderBy validation', () => {
  it('AC-VC-002 (extends): orderBy on a column not in allowedColumns throws UNKNOWN_COLUMN', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      orderBy: { column: 'not_a_real_column', dir: 'asc' },
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
      expect((e as ValidationError).detail).toContain('not_a_real_column');
    }
  });

  it('AC-VC-002 (extends): orderBy on a valid column compiles successfully', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id', 'name'],
      orderBy: { column: 'name', dir: 'desc' },
    };
    const compiled = compileQuerySpec(spec, CTX);
    expect(compiled.resolvedOrderBy).toEqual({ column: 'name', dir: 'desc' });
  });
});

// ── timeRange validation and compilation ───────────────────────────────────────

describe('compileQuerySpec — timeRange validation and compilation', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-VC-015: valid timeRange compiles to a date-range filter', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id', 'name'],
      timeRange: { column: 'start_date', from: '2026-01-01', to: '2026-12-31' },
    };
    const compiled = compileQuerySpec(spec, CTX);

    // OQ-3: timeRange is normalized to the executor's resolved filter contract.
    expect(compiled.resolvedFilters).toContainEqual({
      column: 'start_date',
      op: 'date-range',
      value: ['2026-01-01', '2026-12-31'],
    });
  });

  it('AC-VC-015: timeRange with token values resolves tokens into dates', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      timeRange: { column: 'start_date', from: '$start_of_month', to: '$end_of_month' },
    };
    const compiled = compileQuerySpec(spec, CTX);
    expect(compiled.resolvedFilters).toContainEqual({
      column: 'start_date',
      op: 'date-range',
      value: ['2026-06-01', '2026-06-30'],
    });
  });

  it('AC-VC-015: timeRange column not in allowedColumns throws UNKNOWN_COLUMN', () => {
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      timeRange: { column: 'totally_unknown', from: '2026-01-01', to: '2026-12-31' },
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
    }
  });

  it('AC-VC-015: timeRange column in allowedColumns but NOT dateColumns throws UNKNOWN_COLUMN (FR-VC-020)', () => {
    // 'name' is in projects.allowedColumns but NOT in projects.dateColumns.
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      timeRange: { column: 'name', from: '2026-01-01', to: '2026-12-31' },
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_COLUMN');
    }
  });
});

// ── MISSING_REQUIRED_FILTER (OD-2 — tasks entity) ─────────────────────────────

describe('compileQuerySpec — MISSING_REQUIRED_FILTER', () => {
  it('AC-VC-016: tasks entity without a project_id filter throws MISSING_REQUIRED_FILTER', () => {
    const spec: QuerySpec = {
      entity: 'tasks',
      select: ['id', 'name'],
      // No project_id filter — should throw.
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('MISSING_REQUIRED_FILTER');
      expect((e as ValidationError).detail).toContain('project_id');
    }
  });

  it('AC-VC-016: tasks entity with project_id eq filter compiles successfully', () => {
    const spec: QuerySpec = {
      entity: 'tasks',
      select: ['id', 'name', 'status'],
      filters: [{ column: 'project_id', op: 'eq', value: 'p-123' }],
    };
    const compiled = compileQuerySpec(spec, CTX);
    expect(compiled.entity).toBe('tasks');
    expect(compiled.resolvedFilters[0].column).toBe('project_id');
  });

  it('AC-VC-016: tasks entity with project_id in filter also compiles successfully', () => {
    const spec: QuerySpec = {
      entity: 'tasks',
      select: ['id'],
      filters: [{ column: 'project_id', op: 'in', value: ['p-1', 'p-2'] }],
    };
    const compiled = compileQuerySpec(spec, CTX);
    expect(compiled.entity).toBe('tasks');
  });
});

// ── UNRESOLVABLE_TOKEN paths ───────────────────────────────────────────────────

describe('compileQuerySpec — UNRESOLVABLE_TOKEN', () => {
  it('AC-VC-017: $current_team with no ctx.teamId throws UNRESOLVABLE_TOKEN', () => {
    const ctx: CompilerContext = { userId: 'u1', orgId: 'org1' }; // teamId absent
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      filters: [{ column: 'project_manager_id', op: 'eq', value: '$current_team' }],
    };
    expect(() => compileQuerySpec(spec, ctx)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNRESOLVABLE_TOKEN');
      expect((e as ValidationError).detail).toContain('$current_team');
    }
  });

  it('AC-VC-017: $current_project with no ctx.projectId throws UNRESOLVABLE_TOKEN', () => {
    const ctx: CompilerContext = { userId: 'u1', orgId: 'org1' }; // projectId absent
    const spec: QuerySpec = {
      entity: 'tasks',
      select: ['id'],
      filters: [{ column: 'project_id', op: 'eq', value: '$current_project' }],
    };
    expect(() => compileQuerySpec(spec, ctx)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNRESOLVABLE_TOKEN');
      expect((e as ValidationError).detail).toContain('$current_project');
    }
  });

  it('AC-VC-017: $current_project with ctx.projectId present resolves correctly', () => {
    const ctx: CompilerContext = { userId: 'u1', orgId: 'org1', projectId: 'proj-42' };
    const spec: QuerySpec = {
      entity: 'tasks',
      select: ['id', 'name'],
      filters: [{ column: 'project_id', op: 'eq', value: '$current_project' }],
    };
    const compiled = compileQuerySpec(spec, ctx);
    expect(compiled.resolvedFilters[0].value).toBe('proj-42');
  });

  it('AC-VC-017: $current_org resolves to ctx.orgId', () => {
    const ctx: CompilerContext = { userId: 'u1', orgId: 'my-org-id' };
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      filters: [{ column: 'client_id', op: 'eq', value: '$current_org' }],
    };
    const compiled = compileQuerySpec(spec, ctx);
    expect(compiled.resolvedFilters[0].value).toBe('my-org-id');
    expect(JSON.stringify(compiled)).not.toContain('$current_org');
  });

  it('AC-VC-017: $current_team with ctx.teamId present resolves correctly', () => {
    const ctx: CompilerContext = { userId: 'u1', orgId: 'org1', teamId: 'team-99' };
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      filters: [{ column: 'project_manager_id', op: 'eq', value: '$current_team' }],
    };
    const compiled = compileQuerySpec(spec, ctx);
    expect(compiled.resolvedFilters[0].value).toBe('team-99');
    expect(JSON.stringify(compiled)).not.toContain('$current_team');
  });
});

// ── Date token resolution paths ────────────────────────────────────────────────

describe('compileQuerySpec — date token resolution ($today, $end_of_month)', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-VC-009 (extends): $today resolves to 2026-06-15 (UTC) under pinned clock', () => {
    const ctx: CompilerContext = { userId: 'u1', orgId: 'org1' };
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      filters: [{ column: 'start_date', op: 'gte', value: '$today' }],
    };
    const compiled = compileQuerySpec(spec, ctx);
    expect(compiled.resolvedFilters[0].value).toBe('2026-06-15');
    // No raw token literal in output.
    expect(JSON.stringify(compiled)).not.toContain('$today');
  });

  it('AC-VC-009 (extends): $end_of_month resolves to 2026-06-30 under pinned clock', () => {
    const ctx: CompilerContext = { userId: 'u1', orgId: 'org1' };
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      filters: [{ column: 'end_date', op: 'lte', value: '$end_of_month' }],
    };
    const compiled = compileQuerySpec(spec, ctx);
    expect(compiled.resolvedFilters[0].value).toBe('2026-06-30');
    expect(JSON.stringify(compiled)).not.toContain('$end_of_month');
  });
});

// ── Array value token scanning (NFR-VC-SEC-005) ────────────────────────────────

describe('compileQuerySpec — array filter value token scanning', () => {
  it('AC-VC-012 (extends): op:in with $current_user in array throws UNKNOWN_TOKEN for unrecognized tokens', () => {
    // '$current_manager' is not a valid token → UNKNOWN_TOKEN
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      filters: [{ column: 'project_manager_id', op: 'in', value: ['$current_manager', 'u2'] }],
    };
    expect(() => compileQuerySpec(spec, CTX)).toThrow(ValidationError);
    try {
      compileQuerySpec(spec, CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('UNKNOWN_TOKEN');
    }
  });

  it('AC-VC-009 (extends): op:in with $current_user in array resolves the token (NFR-VC-SEC-005)', () => {
    // $current_user is a valid token; it should resolve, not pass through as a literal.
    const ctx: CompilerContext = { userId: 'resolved-user-id', orgId: 'org1' };
    const spec: QuerySpec = {
      entity: 'projects',
      select: ['id'],
      filters: [{ column: 'project_manager_id', op: 'in', value: ['$current_user', 'other-uuid'] }],
    };
    const compiled = compileQuerySpec(spec, ctx);
    const filterValue = compiled.resolvedFilters[0].value as string[];
    expect(filterValue[0]).toBe('resolved-user-id');
    expect(filterValue[1]).toBe('other-uuid');
    // No raw token literal in output.
    expect(JSON.stringify(compiled)).not.toContain('$current_user');
  });
});

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
