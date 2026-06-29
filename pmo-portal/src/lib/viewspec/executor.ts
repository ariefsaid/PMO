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

  // Build the PostgREST query chain.
  // Cast to bypass the typed table-name union: tableName is validated against
  // ENTITY_WHITELIST at compile time (compileCompositionSpec), so the cast is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as unknown as { from: (t: string) => any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chain: any = db
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
