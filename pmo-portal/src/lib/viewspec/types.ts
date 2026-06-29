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
  // Scalar string values may be a TokenValue ($current_user etc.) resolved at compile time.
  // Array values are validated element-wise (not by tuple length) — compiler.ts resolveValue().
  // [string,string] / [number,number] tuple members are omitted: the compiler makes no
  // tuple-length distinction; use string[] / number[] for 'between' and 'date-range' values.
  value: string | number | boolean | string[] | number[];
}

// ── TimeRangeSpec (FR-VC-013) ──────────────────────────────────────────────────

export interface TimeRangeSpec {
  column: string;
  // from/to are ISO date strings or $-token strings (TokenValue ⊆ string; no separate union needed).
  from: string;
  to: string;
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
  // Tokens have been resolved; no TokenValue appears here. Arrays are element-wise resolved
  // (not tuple-length checked) — string[] covers 'in'/'date-range', number[] covers numeric 'between'.
  value: string | number | boolean | string[] | number[];
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
   * When set, a filter on this column (eq or in) is required by the compiler.
   * Used for 'tasks' (project_id mandatory — OD-2).
   */
  requiredFilter?: string;
}

/**
 * The trust boundary (FR-VC-020). All column sets are derived verbatim from
 * src/lib/supabase/database.types.ts. No column appears here that is not in the DB schema
 * for that table's Row type (audited 2026-06-29). (FR-VC-021 / NFR-VC-SEC-002)
 *
 * Schema-audit notes:
 *  - `projects` has no `updated_at` column (it uses `last_update`); `updated_at` is therefore
 *    NOT whitelisted for projects even though FR-VC-021 listed it. budget/spent/contract_value
 *    are all `number` → whitelisted as numericColumns (OD-1).
 *  - `companies` has no `updated_at`.
 *  - `contacts` uses `full_name` (not `name`) and `title` (not `role`) — whitelisted verbatim
 *    from the DB Row type.
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
      numericColumns: new Set<string>(),
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
      numericColumns: new Set<string>(),
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
      numericColumns: new Set<string>(),
      dateColumns: new Set(['incident_date', 'created_at']),
      groupableColumns: new Set(['type', 'severity', 'status', 'project_id']),
    },
    contacts: {
      table: 'contacts',
      repositoryMethod: 'contact.list',
      allowedColumns: new Set([
        'id', 'full_name', 'email', 'title', 'company_id', 'created_at',
      ]),
      numericColumns: new Set<string>(),
      dateColumns: new Set(['created_at']),
      groupableColumns: new Set(['company_id']),
    },
    user_views: {
      table: 'user_views',
      repositoryMethod: 'userView.list',
      allowedColumns: new Set(['id', 'name', 'scope', 'created_at', 'updated_at']),
      numericColumns: new Set<string>(),
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
  | 'UNRESOLVABLE_TOKEN'
  | 'NOT_GROUPABLE_COLUMN'
  | 'UNKNOWN_PRIMITIVE'     // compileCompositionSpec: panel.primitive not in PrimitiveRegistry
  | 'UNSUPPORTED_VERSION';  // compileCompositionSpec: spec.version !== 1

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
