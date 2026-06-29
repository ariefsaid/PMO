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
  CompositionSpec,
  CompiledPanel,
  FilterClause,
  ResolvedFilter,
  ResolvedAggregate,
  ResolvedTimeRange,
  TokenValue,
} from './types';
import { validatePrimitive } from './registry';

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
 * Returns the concrete value, or throws ValidationError if:
 *  - the string starts with '$' but is not a known token (UNKNOWN_TOKEN)
 *  - the token resolves to null/undefined (UNRESOLVABLE_TOKEN)
 * Non-token strings (and non-string values) are returned unchanged.
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

  // Arrays (for 'in', 'between', 'date-range'): scan each string element for
  // $ tokens. A '$...' element in an array position is rejected as UNKNOWN_TOKEN
  // (if unrecognized) or resolved element-wise. This ensures NFR-VC-SEC-005
  // ("no $ token literal appears anywhere in the compiled output") holds for
  // array values as well as scalar values (FR-VC-035).
  if (Array.isArray(raw)) {
    const resolved = raw.map((item) => {
      if (typeof item === 'string' && item.startsWith('$')) {
        // Recursively resolve string token elements; non-string elements pass through.
        return resolveValue(item, ctx) as string;
      }
      return item;
    });
    return resolved as ResolvedFilter['value'];
  }

  // Non-string scalar values or non-$ strings — pass through as-is.
  // TokenValue has been narrowed out of the type by the branch above, so this
  // cast is type-only and safe (it adds nothing the runtime didn't already guarantee).
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
  // Use own-property check to prevent prototype-chain fall-through on inherited
  // keys like '__proto__', 'constructor', 'toString' (NFR-VC-SEC-004).
  if (!Object.prototype.hasOwnProperty.call(ENTITY_WHITELIST, spec.entity)) {
    throw new ValidationError('UNKNOWN_ENTITY', String(spec.entity));
  }
  const entityEntry = ENTITY_WHITELIST[spec.entity];

  const { allowedColumns, numericColumns, groupableColumns, requiredFilter } = entityEntry;

  // ── 2. Validate limit (FR-VC-039) ──────────────────────────────────────────
  if (spec.limit !== undefined) {
    if (spec.limit < 1 || spec.limit > 500) {
      throw new ValidationError('INVALID_LIMIT', String(spec.limit));
    }
  }
  // Default limit for aggregate / groupBy queries (OD-3, FR-VR-022).
  // If the spec has an aggregate or groupBy but no explicit limit we cap at 500
  // so the executor never issues an unbounded scan for in-memory aggregation.
  // This mirrors the executor-side fallback in executeCompiledQuery; keeping the
  // invariant here (in the compiler) ensures the CompiledQuery always carries a
  // limit when one is needed.
  const effectiveLimit: number | undefined =
    spec.limit !== undefined
      ? spec.limit
      : spec.aggregate !== undefined || spec.groupBy !== undefined
        ? 500
        : undefined;

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
  if (spec.groupBy !== undefined) {
    if (!allowedColumns.has(spec.groupBy)) {
      throw new ValidationError('UNKNOWN_COLUMN', spec.groupBy);
    }
    if (!groupableColumns.has(spec.groupBy)) {
      // Column exists in the whitelist but is not in the groupable subset.
      // Use NOT_GROUPABLE_COLUMN (not UNKNOWN_COLUMN) so I3/I4 can surface an
      // actionable "this column cannot be grouped on" message (ADR-0037 §5).
      throw new ValidationError('NOT_GROUPABLE_COLUMN', spec.groupBy);
    }
  }

  // ── 6. Validate orderBy (FR-VC-032) ────────────────────────────────────────
  if (spec.orderBy !== undefined && !allowedColumns.has(spec.orderBy.column)) {
    throw new ValidationError('UNKNOWN_COLUMN', spec.orderBy.column);
  }

  // ── 7. Validate aggregate (FR-VC-034) ──────────────────────────────────────
  let resolvedAggregate: ResolvedAggregate | undefined;
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

  // ── 8. Validate timeRange (FR-VC-032 / FR-VC-035 / OQ-3) ───────────────────
  let resolvedTimeRange: ResolvedTimeRange | undefined;
  if (spec.timeRange !== undefined) {
    const { column, from, to } = spec.timeRange;
    if (!allowedColumns.has(column)) {
      throw new ValidationError('UNKNOWN_COLUMN', column);
    }
    // timeRange.column must also be in dateColumns (FR-VC-020 — only date/timestamptz
    // columns are permitted in timeRange). UNKNOWN_COLUMN is the appropriate code
    // because from the spec-author's perspective the column is not valid in this position.
    if (!entityEntry.dateColumns.has(column)) {
      throw new ValidationError('UNKNOWN_COLUMN', column);
    }
    const resolvedFrom = resolveValue(from, ctx) as string;
    const resolvedTo = resolveValue(to, ctx) as string;
    // Normalize to a date-range filter clause (OQ-3 — timeRange is syntactic sugar).
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
    ...(effectiveLimit !== undefined && { limit: effectiveLimit }),
  };

  return compiled;
}

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
