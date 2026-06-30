# Spec: View-Composition Trusted Core (Issue I2 — ADR-0036 §4a/b/c)

> **Status:** Draft.
>
> Second build slice of **ADR-0036 §10.2** (the renderer-first build sequence). Conforms to house
> conventions (EARS + `FR-VC-`/`NFR-VC-`/`AC-VC-` ids; Given/When/Then; ADR-0010 test-pyramid
> traceability). Grounds: ADR-0036 §4a (primitive registry), §4b (query-spec DSL), §4c (compiler),
> §5 (declarative-artifact rule); ADR-0001 (`org_id` seam), ADR-0010 (test pyramid), ADR-0016
> (real-JWT deputy model), ADR-0017 (repository seam), ADR-0030 (deterministic Layer-1 gate-tests).
>
> **Scope (locked, Director):** pure TypeScript. NO database migration, NO new UI, NO new route.
> This layer sits on top of the existing `user_views` entity (I1, `src/lib/db/userViews.ts`,
> `src/lib/repositories`) and the existing RLS-scoped supabase client (`src/lib/supabase/client`).
> Deliverables: `pmo-portal/src/lib/viewspec/registry.ts`, `types.ts`, `compiler.ts` plus co-located
> `*.test.ts` files. Everything is unit-testable locally via Vitest (no Docker, no live DB).
>
> **Out of scope (later ADR-0036 issues — do NOT build here):** the `<UserViewRenderer>` component
> + `/views/:viewId` route + dynamic "My Views" nav (I3); the manual builder UI (I4); the agent
> spec-author (I5); `shared_roles` row-level enforcement (I6). No UI, no routes, no migrations, no e2e
> this issue.

---

## 1. Context (AS-IS) and Scope

ADR-0036 §4 describes the **trusted core** as the security-sensitive layer that sits between a
spec-author (agent or human builder) and PMO's existing primitive kit. It has three sub-components:

- **(a) Primitive registry** — a machine-readable manifest of the existing kit primitives the renderer
  (I3) will hydrate.
- **(b) Query-spec DSL** — a declarative, whitelisted description of a read-only data query that a
  primitive consumes.
- **(c) Compiler** — validates a query-spec against the whitelist and compiles it to a call that
  executes *through* the existing RLS-scoped supabase client. Never raw SQL, never a non-whitelisted
  surface.

The **deputy authorization model** (ADR-0036 §2) is the load-bearing security invariant: the compiler
adds NO privileged path. Every compiled query flows through the same `supabase` client (JWT = the
caller's real authenticated role + `org_id`) that the existing DAL uses. RLS is the ceiling; the
compiler is RLS-neutral.

### What the spec does NOT own

The compiler does **not** execute queries itself at spec-validation time; it returns a structured,
compiled form that the renderer (I3) will execute at render time (under the current viewer's JWT —
ADR-0036 §5 rule 2). The compiler's job is to validate and translate, not to fetch.

### Primitive kit (existing, ground-truth — read verbatim from source)

The registry is grounded in these real files:

| Primitive | Source file |
|---|---|
| `DataTable` | `src/components/ui/DataTable.tsx` |
| `KPITile` | `src/components/ui/KPITile.tsx` |
| `StatTiles` | `src/components/ui/StatTiles.tsx` |
| `Funnel` | `src/components/ui/Funnel.tsx` |
| `StatusBarChart` | `src/components/dashboard/StatusBarChart.tsx` |
| `ProgressBar` | `src/components/ui/ProgressBar.tsx` |
| `Card` | `src/components/ui/Card.tsx` |

### Whitelisted entities (existing, ground-truth — derived from `src/lib/repositories/`)

The compiler's whitelist maps to the existing repository read methods only (no writes):

| Entity key | DB table | Repository read method(s) |
|---|---|---|
| `projects` | `projects` | `repositories.project.list()` |
| `companies` | `companies` | `repositories.company.list()` |
| `tasks` | `tasks` | `repositories.task.list(projectId)` |
| `incidents` | `incident_reports` | `repositories.incident.list()` |
| `contacts` | `contacts` | `repositories.contact.list()` |
| `user_views` | `user_views` | `repositories.userView.list()` |

---

## 2. Goals

- **G-1** A machine-readable **primitive registry** (`registry.ts`) describing the kit primitives the
  renderer will hydrate, grounded in real component prop types — not hand-invented.
- **G-2** A **query-spec DSL** (`types.ts`) that is declarative, self-describing, and strictly bounded:
  only whitelisted entities, columns, filter operators, and aggregations are expressible; `$current_*`
  tokens resolve at compile time under the caller's context.
- **G-3** A **compiler** (`compiler.ts`) that validates a query-spec against the whitelist and
  compiles it to a typed call descriptor targeting the existing repository read methods; it MUST
  NEVER build or interpolate raw SQL strings, call `.rpc()` with a non-whitelisted name, or call
  `.from()` with a non-whitelisted table/column.
- **G-4** A typed `ValidationError` (thrown by the compiler on any unknown entity/column/op/
  aggregation) that is the only error path for whitelist violations — the compiler never silently
  passes through unknown inputs.
- **G-5** Deterministic Layer-1 Vitest gate-tests (ADR-0030 §C) covering: whitelist enforcement
  (reject/accept); no-raw-SQL property; `$current_*` resolution; aggregate correctness for any
  derived value the compiler computes.

---

## 3. Functional requirements (EARS)

### 3.1 Primitive registry (ADR-0036 §4a)

- **FR-VC-001** (ubiquitous) The system shall provide a `PrimitiveRegistry` object in
  `src/lib/viewspec/registry.ts` that maps each supported primitive name to a descriptor containing:
  its `propSchema` (a typed descriptor or zod schema for the props the renderer will supply),
  its `dataShape` (the TypeScript shape of the data array / object the primitive accepts), and
  its `description` (a human-readable string for the spec-author / agent catalog).
- **FR-VC-002** (ubiquitous) The registry shall include at minimum the following primitives derived
  verbatim from the existing component source (no invented props):
  - `DataTable` — `rows: Row[]`, `columns: Column<Row>[]`, `rowKey`, optional `sort`, `state`,
    `emptyTitle`, `errorTitle` (from `DataTableProps<Row>` in `DataTable.tsx`); data shape:
    `{ rows: Record<string, unknown>[] }`.
  - `KPITile` — `icon: IconName`, `tone: KPITone` (`'blue'|'violet'|'amber'|'red'|'green'`),
    `label: string`, `value: string | number`, optional `delta?: { dir: 'up'|'down'|'neutral';
    text: string }`, `vs?: string`, `help?: string`, `negative?: boolean` (from `KPITileProps` in
    `KPITile.tsx`); data shape: `{ value: string | number; delta?: KPIDelta; vs?: string }`.
  - `StatTiles` — `tiles: Array<{ label: string; value: string | number; tone?: 'pos'|'neg';
    sub?: string }>`, `columns?: number` (from `StatTilesProps` / `StatTile` in `StatTiles.tsx`);
    data shape: `{ tiles: Array<{ label: string; value: string | number; tone?: 'pos'|'neg';
    sub?: string }> }`.
  - `Funnel` — `stages: Array<{ name: string; value: string | number; barPct?: number;
    dotColor?: string; prob?: string; weighted?: string; barColor?: string }>` (from `FunnelProps` /
    `FunnelStage` in `Funnel.tsx`); data shape: `{ stages: FunnelStage[] }`.
  - `StatusBarChart` — `data: Array<{ status: string; count: number }>`, `label: string`,
    `noun: string`, `height?: number` (from `StatusBarChartProps` / `StatusDatum` in
    `StatusBarChart.tsx`); data shape: `{ data: Array<{ status: string; count: number }> }`.
  - `ProgressBar` — `value: number` (0–100), optional `tone?: 'success'|'warning'|'destructive'|
    'primary'`, `showValue?: boolean`, `compact?: boolean`, `widthless?: boolean`,
    `aria-label?: string` (from `ProgressBarProps` in `ProgressBar.tsx`); data shape:
    `{ value: number; tone?: ProgressTone }`.
  - `Card` — `title?: string`, `children: string` (rendered as text/content by the renderer),
    `interactive?: boolean`, `clip?: boolean`, `seam?: boolean` (from `CardProps` in `Card.tsx`);
    data shape: `{ title?: string; body: string }`.
- **FR-VC-003** (ubiquitous) The registry shall be the **single source of truth** for primitive
  names: the compiler and renderer both import from it; no primitive name is hardcoded outside
  `registry.ts`.
- **FR-VC-004** (event-driven) When the renderer (I3) calls `registry.get(name)`, it shall receive
  the full descriptor if the name is known, or `undefined` if unknown; it shall not throw.

### 3.2 Query-spec DSL (ADR-0036 §4b)

- **FR-VC-010** (ubiquitous) The system shall provide a `QuerySpec` type in
  `src/lib/viewspec/types.ts` with the following shape (all fields are serialisation-safe — no
  function values):
  ```
  QuerySpec {
    entity:     WhitelistedEntity              // one of the keys in the entity whitelist
    select:     string[]                       // column names from the entity's allowed columns
    filters?:   FilterClause[]                 // zero or more filter clauses
    groupBy?:   string                         // whitelisted groupable column
    aggregate?: AggregateSpec                  // at most one aggregate per spec
    timeRange?: TimeRangeSpec                  // shorthand for date-column window filter
    limit?:     number                         // row cap (min 1, max 500)
    orderBy?:   { column: string; dir: 'asc' | 'desc' }
  }
  ```
- **FR-VC-011** (ubiquitous) `FilterClause` shall be:
  ```
  FilterClause {
    column: string
    op:     'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'date-range'
    value:  string | number | boolean | string[] | [string, string] | TokenValue
  }
  ```
  where `TokenValue` is one of `'$current_user'` | `'$current_team'` | `'$current_org'`
  | `'$today'` | `'$start_of_month'` | `'$end_of_month'`.
- **FR-VC-012** (ubiquitous) `AggregateSpec` shall be:
  ```
  AggregateSpec {
    fn:     'count' | 'sum' | 'avg' | 'min' | 'max'
    column: string    // must be a whitelisted numeric column for sum/avg/min/max; any column for count
    alias:  string    // the output field name in the compiled result
  }
  ```
- **FR-VC-013** (ubiquitous) `TimeRangeSpec` shall be:
  ```
  TimeRangeSpec {
    column: string                              // a whitelisted date/timestamptz column
    from:   string | TokenValue                 // ISO date string or token
    to:     string | TokenValue
  }
  ```
- **FR-VC-014** (ubiquitous) `WhitelistedEntity` shall be a string union type whose members are
  exactly the entity keys declared in the whitelist: `'projects' | 'companies' | 'tasks' |
  'incidents' | 'contacts' | 'user_views'`.
- **FR-VC-015** (ubiquitous) A `CompositionSpec` type shall represent a complete saved view: an
  ordered array of `PanelSpec` entries, each binding a primitive name to a query-spec and optional
  layout metadata:
  ```
  PanelSpec {
    id:        string             // stable identifier for the panel (uuid or slug)
    primitive: string             // must be a key in the PrimitiveRegistry
    querySpec: QuerySpec          // the data query for this panel
    layout?:   LayoutHint         // optional renderer hint (col-span, row-span)
    props?:    Record<string, unknown>  // static primitive props not driven by data (e.g. label, tone)
  }
  CompositionSpec {
    version:  1
    panels:   PanelSpec[]
  }
  ```

### 3.3 Entity whitelist (ADR-0036 §4b — the trust boundary)

- **FR-VC-020** (ubiquitous) The system shall provide a `ENTITY_WHITELIST` constant in
  `src/lib/viewspec/types.ts` (or a co-located `whitelist.ts`) mapping each whitelisted entity to:
  - `table`: the Postgres table name (for documentation; the compiler never string-interpolates it).
  - `repositoryMethod`: the repository read method the compiler calls (one of the existing
    `repositories.*` methods listed in §1 above).
  - `allowedColumns`: the set of column names permitted in `select`, `filters`, `groupBy`,
    `orderBy.column` for that entity.
  - `numericColumns`: the subset of `allowedColumns` that are numeric (permitted for `sum/avg/min/max`
    aggregations).
  - `dateColumns`: the subset of `allowedColumns` that are date or timestamptz (permitted in
    `timeRange.column` and `date-range` filter ops).
  - `groupableColumns`: the subset permitted in `groupBy`.
- **FR-VC-021** (ubiquitous) The `allowedColumns` for each entity shall be derived from the REAL
  DAL types (not invented). Minimum per entity (implementer to verify against the actual Supabase
  generated types in `src/lib/supabase/database.types.ts`):
  - `projects`: `id`, `name`, `status`, `start_date`, `end_date`, `contract_value`, `created_at`,
    `updated_at`, `client_id`, `project_manager_id`, `code`.
  - `companies`: `id`, `name`, `type`, `created_at`, `updated_at`.
  - `tasks`: `id`, `name`, `status`, `start_date`, `end_date`, `project_id`, `assignee_id`,
    `created_at`, `updated_at`.
  - `incidents`: `id`, `type`, `severity`, `status`, `incident_date`, `location`, `project_id`,
    `created_at`.
  - `contacts`: `id`, `name`, `email`, `role`, `company_id`, `created_at`, `updated_at`.
  - `user_views`: `id`, `name`, `scope`, `created_at`, `updated_at`.
- **FR-VC-022** (ubiquitous) The `numericColumns` whitelist shall include at minimum: `projects`:
  `contract_value`; `tasks`: none initially (implementer to verify); `incidents`: none initially.
  **Owner decision: see OD-1** — the implementer audits `database.types.ts` to confirm numeric
  columns and updates the whitelist; this spec records the minimum baseline.

### 3.4 Compiler (ADR-0036 §4c)

- **FR-VC-030** (ubiquitous) The system shall provide a `compileQuerySpec(spec: QuerySpec, ctx:
  CompilerContext): CompiledQuery` function in `src/lib/viewspec/compiler.ts`, where
  `CompilerContext` is `{ userId: string; orgId: string; teamId?: string }` (the caller's
  resolved identity, used to expand `$current_*` tokens).
- **FR-VC-031** (event-driven) When `compileQuerySpec` is called with a `QuerySpec` whose `entity`
  is NOT in the whitelist, it shall throw a `ValidationError` with `code: 'UNKNOWN_ENTITY'` and the
  unknown entity name. It shall NEVER fall through or coerce.
- **FR-VC-032** (event-driven) When any column name in `select`, `filters[].column`, `groupBy`,
  `orderBy.column`, `aggregate.column`, or `timeRange.column` is NOT in the entity's
  `allowedColumns`, the compiler shall throw a `ValidationError` with `code: 'UNKNOWN_COLUMN'`
  and the offending column name.
- **FR-VC-033** (event-driven) When `filters[].op` is NOT one of
  `eq | neq | in | gt | gte | lt | lte | between | date-range`, the compiler shall throw a
  `ValidationError` with `code: 'UNKNOWN_OP'` and the offending operator.
- **FR-VC-034** (event-driven) When `aggregate.fn` is `sum | avg | min | max` and `aggregate.column`
  is NOT in the entity's `numericColumns`, the compiler shall throw a `ValidationError` with
  `code: 'NON_NUMERIC_AGGREGATE'`.
- **FR-VC-035** (ubiquitous) `$current_user` tokens shall resolve to `ctx.userId`; `$current_org`
  to `ctx.orgId`; `$current_team` to `ctx.teamId ?? null`; `$today` to today's ISO date string
  (YYYY-MM-DD); `$start_of_month` / `$end_of_month` to the first and last day of the current month
  in YYYY-MM-DD. Resolution is deterministic given a fixed clock (testable with a mocked date).
- **FR-VC-036** (ubiquitous) The compiled output `CompiledQuery` shall be a plain TypeScript
  object that describes which repository method to call and with what parameters — it MUST NOT be a
  raw SQL string, a string fragment, a template literal with user-controlled data, or a call to
  `supabase.rpc()` with a non-whitelisted name. The compiler is a **translator**, not an executor.
- **FR-VC-037** (ubiquitous) The `CompiledQuery` shape shall be:
  ```
  CompiledQuery {
    entity:            WhitelistedEntity
    repositoryMethod:  string         // e.g. 'project.list', 'company.list' — matches whitelist entry
    resolvedFilters:   ResolvedFilter[]   // token-expanded, validated filter clauses
    resolvedSelect:    string[]           // validated column names
    resolvedGroupBy?:  string
    resolvedAggregate?: ResolvedAggregate
    resolvedTimeRange?: ResolvedTimeRange
    resolvedOrderBy?:  { column: string; dir: 'asc' | 'desc' }
    limit?:            number
  }
  ```
  where all `$current_*` tokens have been replaced by their concrete values from `ctx`.
- **FR-VC-038** (ubiquitous) The `ValidationError` class (exported from `types.ts` or `compiler.ts`)
  shall extend `Error`, carry a `code: string` property (one of `UNKNOWN_ENTITY | UNKNOWN_COLUMN |
  UNKNOWN_OP | NON_NUMERIC_AGGREGATE | INVALID_LIMIT | UNKNOWN_TOKEN`), and optionally a `detail:
  string` (the offending value). All compiler rejection paths shall use `ValidationError` — never
  a plain `Error` or a silent return.
- **FR-VC-039** (ubiquitous) When `limit` is present, the compiler shall reject values less than 1
  or greater than 500 with `ValidationError` (`code: 'INVALID_LIMIT'`).
- **FR-VC-040** (ubiquitous) The compiler shall be a **pure function** (no side effects, no I/O, no
  network calls): given the same `(spec, ctx)` inputs it always produces the same output (or throws
  the same error). This is the pre-condition for deterministic Layer-1 Vitest testing.

### 3.5 Registry lookup

- **FR-VC-050** (ubiquitous) The system shall export a `validatePrimitive(name: string): boolean`
  helper that returns `true` if `name` is a known registry key and `false` otherwise, so the spec
  validator (I3 — which compiles the full `CompositionSpec`) can check primitive names without
  throwing.
- **FR-VC-051** (event-driven) When the compiler is used in a future `compileCompositionSpec`
  wrapper (I3), each panel's `primitive` name shall be validated against the `PrimitiveRegistry`
  before `compileQuerySpec` is called; an unknown primitive name shall throw
  `ValidationError({ code: 'UNKNOWN_PRIMITIVE' })`. **Note:** `compileCompositionSpec` is NOT built
  in I2 (it belongs to I3/I4); this FR documents the contract I2 must make satisfiable.

---

## 4. Non-functional requirements

### Security invariants (ADR-0036 §4c / §2 — binding and testable)

- **NFR-VC-SEC-001** (no-raw-SQL) The compiler shall NEVER construct, concatenate, or
  string-interpolate a raw SQL string for execution. The compiled output is a **call descriptor**,
  not a SQL string. This property shall be asserted by a structural unit test (AC-VC-006).
- **NFR-VC-SEC-002** (whitelist is the trust boundary) The compiler shall NEVER call or reference
  `supabase.from()` with a table name that is not in the `ENTITY_WHITELIST`, and shall NEVER call
  `supabase.rpc()` with a function name that is not in an explicit RPC allowlist (currently empty —
  no RPC calls in the compiler). This property shall be asserted by inspecting the compiled output
  (AC-VC-006).
- **NFR-VC-SEC-003** (deputy model — no privileged path) The compiler shall NEVER reference or
  import the Supabase service-role key, `SUPABASE_SERVICE_ROLE_KEY`, a `bypassRls` flag, or any
  connection other than `src/lib/supabase/client` (the RLS-scoped authenticated client). Verified
  by static import analysis (the import chain from `compiler.ts` must not reach `service_role`).
- **NFR-VC-SEC-004** (no silent coercion) The compiler shall NEVER silently coerce an unknown
  entity, column, op, or aggregation to a known one; every violation throws a typed
  `ValidationError`. Verified by AC-VC-001..005.
- **NFR-VC-SEC-005** (token resolution is bounded) `$current_*` tokens shall resolve exclusively
  to values drawn from the supplied `CompilerContext` object (caller-supplied at compile time,
  populated from the authenticated session). The compiler shall reject any token string not in the
  explicit token set with `ValidationError({ code: 'UNKNOWN_TOKEN' })`.

### Test and correctness

- **NFR-VC-TEST-001** All AC-VC-### Vitest tests shall be runnable with `npm test` in
  `pmo-portal/` with no Docker, no live Supabase connection, and no network access. The compiler
  is a pure function; all tests use in-process inputs only.
- **NFR-VC-TEST-002** Each AC is owned by exactly one test at the lowest sufficient layer. All
  tests for this issue are **Vitest** (compiler is pure TypeScript; no database call occurs during
  compilation). No pgTAP or Playwright tests belong to this issue.
- **NFR-VC-CORRECTNESS-001** Aggregate computations the compiler produces (e.g. resolving
  `$today`, `$start_of_month`, `$end_of_month`) shall be deterministic given a fixed clock, and
  their correctness shall be asserted with date-pinned tests (AC-VC-009).
- **NFR-VC-CORRECTNESS-002** Money columns (`contract_value`) shall only appear in
  `sum/avg/min/max` aggregations when whitelisted as numeric. An attempt to aggregate a
  non-numeric column (`name`, `status`, etc.) shall throw `ValidationError`, never produce a
  numeric result. Asserted by AC-VC-005.

### Locality and layering

- **NFR-VC-LAYER-001** The registry, types, and compiler shall live in `pmo-portal/src/lib/viewspec/`
  and shall import ONLY from: `src/lib/supabase/client` (referenced in descriptors, not called),
  `src/lib/repositories/types` (for type imports), and `src/components/ui/*` / `src/components/
  dashboard/*` (for prop type imports). They shall NOT import from any page, hook, or route module.
- **NFR-VC-LAYER-002** The compiler module shall not import from `src/lib/db/*` directly. The
  whitelist maps to *repository method names* (strings); the renderer (I3) resolves those strings
  to actual repository calls at render time. The compiler never calls a repository itself.

---

## 5. Acceptance criteria (Given/When/Then)

> All AC-VC-### are **Vitest** unit tests in `pmo-portal/src/lib/viewspec/*.test.ts`.
> No pgTAP (no DB), no Playwright (no UI). Every test is runnable offline (`npm test`).
> AC-VC-001..005 cover rejection paths; AC-VC-006 covers the structural no-raw-SQL / no-bad-surface
> property; AC-VC-007..008 cover accept paths; AC-VC-009 covers `$current_*` token resolution;
> AC-VC-010 covers aggregate correctness for money/numeric columns.

---

- **AC-VC-001** — Unknown entity is rejected.
  **Given** a `QuerySpec` with `entity: 'widgets'` (not in the whitelist),
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws a `ValidationError` with `code === 'UNKNOWN_ENTITY'` and the detail includes
  `'widgets'`; it does NOT return a compiled object. (FR-VC-031, NFR-VC-SEC-004)

- **AC-VC-002** — Unknown column in `select` is rejected.
  **Given** a valid entity `'projects'` but `select: ['name', 'secret_column']` where
  `'secret_column'` is NOT in `projects.allowedColumns`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws a `ValidationError` with `code === 'UNKNOWN_COLUMN'` and detail includes
  `'secret_column'`; the valid column `'name'` does NOT appear in a partial compiled output.
  (FR-VC-032, NFR-VC-SEC-004)

- **AC-VC-003** — Unknown filter operator is rejected.
  **Given** a valid entity `'companies'` with `filters: [{ column: 'name', op: 'like',
  value: 'Acme' }]` where `'like'` is NOT a whitelisted operator,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws a `ValidationError` with `code === 'UNKNOWN_OP'` and detail includes `'like'`.
  (FR-VC-033, NFR-VC-SEC-004)

- **AC-VC-004** — Unknown column in filter is rejected.
  **Given** entity `'tasks'` with `filters: [{ column: 'internal_notes', op: 'eq', value: 'x' }]`
  where `'internal_notes'` is NOT in `tasks.allowedColumns`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws a `ValidationError` with `code === 'UNKNOWN_COLUMN'`. (FR-VC-032)

- **AC-VC-005** — Non-numeric column in `sum/avg/min/max` aggregate is rejected.
  **Given** entity `'projects'` with `aggregate: { fn: 'sum', column: 'name', alias: 'total' }`
  where `'name'` is NOT in `projects.numericColumns`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws a `ValidationError` with `code === 'NON_NUMERIC_AGGREGATE'` and detail
  includes `'name'`. (FR-VC-034, NFR-VC-CORRECTNESS-002)

- **AC-VC-006** — Compiler output never contains raw SQL or non-whitelisted surface references.
  **Given** a valid `QuerySpec` for entity `'projects'`, `select: ['name', 'status']`,
  `filters: [{ column: 'status', op: 'eq', value: 'Active' }]`,
  **When** `compileQuerySpec(spec, ctx)` returns a `CompiledQuery`,
  **Then** (a) scanning only the **values** of the compiled output (not field names — field names
  such as `resolvedSelect` are fixed by the `CompiledQuery` contract, not spec-author-controlled)
  finds no SQL keyword sequence `SELECT`, `FROM`, `WHERE`, `INSERT`, `UPDATE`, `DELETE`, `DROP`,
  `TRUNCATE`, `EXECUTE`, `GRANT`, `REVOKE` (case-insensitive) — asserting the compiler produces
  a call descriptor, not SQL. The value scan recurses into nested objects and arrays; key names are
  excluded because they are structural constants of the call descriptor, not user-controlled SQL.
  (b) `compiled.repositoryMethod` is one of the whitelisted method names (e.g. `'project.list'`),
  NOT a free-form string;
  (c) `compiled.entity` equals `'projects'`;
  (d) `Object.keys(compiled)` contains exactly the whitelisted `CompiledQuery` field names —
  no free-form `query` or `sql` field is present.
  **Rationale for (a) amendment:** `JSON.stringify(compiled)` always includes the string
  `'resolvedSelect'` (a key name), whose uppercase contains `'SELECT'`. Since key names are
  fixed by the CompiledQuery type (FR-VC-037) and cannot be influenced by a spec-author, the
  no-SQL property must be asserted over values only. The test implementation scans values via
  object traversal; this oracle matches that correct implementation.
  (FR-VC-036, FR-VC-037, NFR-VC-SEC-001, NFR-VC-SEC-002)

- **AC-VC-007** — Valid `QuerySpec` compiles successfully and produces the expected descriptor.
  **Given** a valid `QuerySpec`:
  ```json
  { "entity": "companies", "select": ["id", "name", "type"],
    "filters": [{ "column": "type", "op": "eq", "value": "Client" }],
    "limit": 50 }
  ```
  and a `ctx = { userId: 'u1', orgId: 'org1' }`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it returns a `CompiledQuery` with `entity === 'companies'`,
  `repositoryMethod === 'company.list'`, `resolvedSelect` containing `['id', 'name', 'type']`,
  `resolvedFilters` containing `[{ column: 'type', op: 'eq', value: 'Client' }]`,
  and `limit === 50`; it does NOT throw. (FR-VC-030, FR-VC-037)

- **AC-VC-008** — Registry lookup returns the correct descriptor for known and unknown names.
  **Given** the `PrimitiveRegistry`,
  **When** `registry.get('KPITile')` is called, **then** it returns a descriptor with at minimum
  `{ name: 'KPITile', propSchema: { ... }, dataShape: { ... }, description: '...' }` where
  `propSchema` includes `tone` (one of `'blue'|'violet'|'amber'|'red'|'green'`) and `label`;
  **and when** `registry.get('NonExistentWidget')` is called, **then** it returns `undefined`
  (not throws). (FR-VC-001, FR-VC-004)

- **AC-VC-009** — `$current_*` and date tokens resolve correctly.
  **Given** a `QuerySpec` for entity `'projects'`:
  ```json
  {
    "entity": "projects",
    "select": ["id", "name"],
    "filters": [
      { "column": "project_manager_id", "op": "eq", "value": "$current_user" },
      { "column": "start_date", "op": "gte", "value": "$start_of_month" }
    ]
  }
  ```
  and `ctx = { userId: 'user-abc', orgId: 'org-xyz' }`, with the test clock pinned to
  2026-06-15 (via `vi.setSystemTime`),
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** `resolvedFilters[0].value === 'user-abc'` (the `$current_user` token is replaced),
  `resolvedFilters[1].value === '2026-06-01'` (the first day of June 2026),
  and no `$` token literal appears anywhere in the compiled output. (FR-VC-035, NFR-VC-SEC-005)

- **AC-VC-010** — Aggregate on a whitelisted numeric column compiles correctly; money is preserved.
  **Given** a `QuerySpec`:
  ```json
  {
    "entity": "projects",
    "select": ["status"],
    "aggregate": { "fn": "sum", "column": "contract_value", "alias": "total_cv" },
    "groupBy": "status"
  }
  ```
  and `ctx = { userId: 'u1', orgId: 'org1' }`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it returns a `CompiledQuery` with `resolvedAggregate.fn === 'sum'`,
  `resolvedAggregate.column === 'contract_value'`, `resolvedAggregate.alias === 'total_cv'`,
  and `resolvedGroupBy === 'status'`; it does NOT throw (contract_value is in `numericColumns`).
  A second call with `aggregate: { fn: 'avg', column: 'contract_value', alias: 'avg_cv' }` also
  succeeds. A third call with `fn: 'sum', column: 'name'` throws `ValidationError` with
  `code: 'NON_NUMERIC_AGGREGATE'`. (FR-VC-034, NFR-VC-CORRECTNESS-001, NFR-VC-CORRECTNESS-002)

- **AC-VC-011** — `limit` out of range is rejected.
  **Given** a valid entity spec with `limit: 0`,
  **When** `compileQuerySpec` is called,
  **Then** it throws `ValidationError` with `code: 'INVALID_LIMIT'`;
  **and when** called with `limit: 501`, it also throws `ValidationError({ code: 'INVALID_LIMIT' })`.
  (FR-VC-039)

- **AC-VC-012** — Unknown `$` token in filter value is rejected.
  **Given** a valid entity spec with `filters: [{ column: 'status', op: 'eq', value: '$current_manager' }]`
  where `'$current_manager'` is NOT a whitelisted token,
  **When** `compileQuerySpec` is called,
  **Then** it throws `ValidationError` with `code: 'UNKNOWN_TOKEN'`. (FR-VC-035, NFR-VC-SEC-005)

- **AC-VC-013** — `validatePrimitive` returns the correct boolean for known and unknown names.
  **Given** the `validatePrimitive` helper,
  **When** called with `'DataTable'`, **then** it returns `true`;
  **when** called with `'PieChart'` (not registered), **then** it returns `false`;
  **when** called with `''` (empty string), **then** it returns `false`. (FR-VC-050)

- **AC-VC-014** — `groupBy` on a column that is in `allowedColumns` but NOT in `groupableColumns` is rejected with `NOT_GROUPABLE_COLUMN`.
  **Given** entity `'projects'` with `groupBy: 'name'` where `'name'` is in `projects.allowedColumns`
  but NOT in `projects.groupableColumns`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws a `ValidationError` with `code === 'NOT_GROUPABLE_COLUMN'` and `detail` contains
  `'name'`; it does NOT throw `UNKNOWN_COLUMN`. (FR-VC-032, FR-VC-020)

- **AC-VC-015** — `timeRange` validates the column and resolves token `from`/`to` values; the result
  appears in both `resolvedTimeRange` and `resolvedFilters` as a `date-range` clause (OQ-3).
  **Given** entity `'projects'` with `timeRange: { column: 'start_date', from: '2026-01-01', to: '2026-12-31' }`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** `compiled.resolvedTimeRange` equals `{ column: 'start_date', from: '2026-01-01', to: '2026-12-31' }`
  and `compiled.resolvedFilters` contains `{ column: 'start_date', op: 'date-range', value: ['2026-01-01', '2026-12-31'] }`.
  **And** when `from`/`to` are tokens (e.g. `'$start_of_month'`/`'$end_of_month'`), they are resolved to
  their concrete date strings before appearing in output.
  **And** when `timeRange.column` is not in `allowedColumns`, it throws `ValidationError({ code: 'UNKNOWN_COLUMN' })`.
  **And** when `timeRange.column` is in `allowedColumns` but NOT in `dateColumns`, it throws
  `ValidationError({ code: 'UNKNOWN_COLUMN' })` (only date/timestamptz columns may appear in `timeRange`).
  (FR-VC-013, FR-VC-020, FR-VC-032, FR-VC-035, OQ-3)

- **AC-VC-016** — Entity `'tasks'` requires a `project_id` filter (`eq` or `in`); omitting it throws
  `MISSING_REQUIRED_FILTER`.
  **Given** entity `'tasks'` with no `project_id` filter in `filters`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws `ValidationError` with `code === 'MISSING_REQUIRED_FILTER'` and `detail` contains
  `'project_id'`.
  **And** when a `project_id` `eq` filter is present, compilation succeeds.
  **And** when a `project_id` `in` filter is present, compilation also succeeds. (FR-VC-020, OD-2)

- **AC-VC-017** — A `$current_*` token that is recognized but whose required context field is absent
  throws `UNRESOLVABLE_TOKEN` (distinct from `UNKNOWN_TOKEN` for unrecognized tokens).
  **Given** a `QuerySpec` using `'$current_team'` and `ctx` has no `teamId`,
  **When** `compileQuerySpec(spec, ctx)` is called,
  **Then** it throws `ValidationError` with `code === 'UNRESOLVABLE_TOKEN'` and `detail` contains
  `'$current_team'`.
  **And** the same applies to `'$current_project'` when `ctx.projectId` is absent.
  **And** when `ctx.teamId` / `ctx.projectId` are present, the tokens resolve correctly and no raw token
  literal appears in the compiled output. (FR-VC-035, NFR-VC-SEC-005, OD-4)

---

## 6. Traceability

| AC | Requirement(s) | Owning layer | Planned test file |
|---|---|---|---|
| AC-VC-001 | FR-VC-031, NFR-VC-SEC-004 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-002 | FR-VC-032, NFR-VC-SEC-004 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-003 | FR-VC-033, NFR-VC-SEC-004 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-004 | FR-VC-032 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-005 | FR-VC-034, NFR-VC-CORRECTNESS-002 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-006 | FR-VC-036, FR-VC-037, NFR-VC-SEC-001, NFR-VC-SEC-002 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-007 | FR-VC-030, FR-VC-037 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-008 | FR-VC-001, FR-VC-004 | Vitest | `pmo-portal/src/lib/viewspec/registry.test.ts` |
| AC-VC-009 | FR-VC-035, NFR-VC-SEC-005 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-010 | FR-VC-034, NFR-VC-CORRECTNESS-001, NFR-VC-CORRECTNESS-002 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-011 | FR-VC-039 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-012 | FR-VC-035, NFR-VC-SEC-005 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-013 | FR-VC-050 | Vitest | `pmo-portal/src/lib/viewspec/registry.test.ts` |
| AC-VC-014 | FR-VC-032, FR-VC-020 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-015 | FR-VC-013, FR-VC-020, FR-VC-032, FR-VC-035, OQ-3 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-016 | FR-VC-020, OD-2 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |
| AC-VC-017 | FR-VC-035, NFR-VC-SEC-005, OD-4 | Vitest | `pmo-portal/src/lib/viewspec/compiler.test.ts` |

> FR-VC-001..004 (registry shape/API) are proven by AC-VC-008 and AC-VC-013. FR-VC-010..015
> (DSL type structure) are proven transitively: the types constrain what the compiler can accept,
> so every compiler test exercises the DSL contract. FR-VC-020..022 (whitelist structure) are
> proven by the reject-path tests AC-VC-001..005 (which assert the whitelist catches violations)
> and the accept-path tests AC-VC-007/010 (which confirm whitelisted inputs pass). NFR-VC-LAYER-001
> and NFR-VC-LAYER-002 are verified by static import inspection (`tsc --noEmit` + manual review
> in code review). NFR-VC-SEC-003 is verified by static import chain review (code-quality reviewer
> gate).

---

## 7. Open questions / owner-decision flags

- **[OWNER-DECISION] OD-1 — Numeric column whitelist completeness.** The spec lists `contract_value`
  for `projects` as the confirmed numeric column. The implementer must audit `src/lib/supabase/
  database.types.ts` to confirm whether tasks, incidents, contacts, or companies expose any numeric
  columns worth whitelisting (e.g. task duration, incident count fields). **Defaulting to: only
  `contract_value` on `projects` in the initial whitelist; implementer expands after type audit with
  Director approval.** Owner to confirm whether budget-related aggregations (e.g. `budgeted_amount`,
  `actual_amount` from `budget_line_items`) should be whitelisted in this issue or deferred to I4
  (the manual builder) when the entities for views are better understood.

- **[OWNER-DECISION] OD-2 — `tasks` repository method requires `projectId` parameter.** The
  existing `repositories.task.list(projectId)` method requires a project ID (it is a per-project
  read, not an org-wide list). A `QuerySpec` for entity `'tasks'` must therefore supply a filter
  `{ column: 'project_id', op: 'eq', value: '<uuid>' }` (or `$current_project` token) that the
  compiler can use to extract the required parameter. **Two options:**
  (a) Add a `$current_project` context token and require it be present in the query-spec's filters
  when entity is `'tasks'` (compiler enforces this — throw `ValidationError` if absent);
  (b) Expand the whitelist with a new `repositories.task.listAll()` DAL method that returns all
  org tasks (org-scoped by RLS, no `projectId`), analogous to `repositories.incident.list()`.
  **Defaulting to: (a) — require `project_id` filter when entity is `'tasks'`; add `$current_project`
  as a valid token.** Owner to confirm. If (b), the DAL extension is in scope for I2.

- **[OWNER-DECISION] OD-3 — `groupBy` + aggregate result shape.** When a `QuerySpec` specifies
  both `groupBy` and `aggregate`, the compiled query targets the repository method but the existing
  repository methods do not natively support GROUP BY (they return full rows). Two options:
  (a) The compiler emits a `resolvedGroupBy` + `resolvedAggregate` descriptor, and the renderer (I3)
  applies the group-by/aggregation in-memory over the full result set returned by the repository
  method (simple but loads all rows);
  (b) The compiler emits a call to a specific Supabase PostgREST aggregation pattern (`.select(
  'status, contract_value.sum()' )`), which is available in PostgREST v12+ and avoids loading all
  rows (but requires the supabase-js client to support it, and the compiler would need to build a
  select string — a form of SQL-string construction that requires care).
  **Defaulting to: (a) — in-memory aggregation by the renderer (I3) for now, with a row cap
  (`limit ≤ 500`) to bound memory use.** (b) is viable for I4+ if performance is a concern; it
  does NOT violate the no-raw-SQL property because PostgREST aggregation syntax is column-whitelisted
  and structured, not open SQL. Owner to confirm.

- **[OWNER-DECISION] OD-4 — `$current_team` token.** No `team_id` concept currently exists in
  the PMO schema (there are projects and profiles, but no first-class "team" entity). The
  `$current_team` token is included in the DSL for forward-compatibility (ADR-0036 §4b mentions it)
  but will resolve to `null` / be unused until a team model is introduced. **Defaulting to: include
  the token in the type; compiler resolves it to `ctx.teamId ?? null`; a filter with
  `$current_team` and a null-resolved value at compile time should produce a `ValidationError`
  (`UNRESOLVABLE_TOKEN`) rather than a null filter.** Owner to confirm.

- **OQ-1 — `count` aggregate on a non-numeric column.** The spec allows `count` on any column
  (including text columns like `status`), consistent with SQL semantics. Should `count` on a text
  column be permitted (e.g. `count(status)` to count non-null status rows) or only
  `count(*)` / `count(id)` to avoid confusion? No owner decision needed; implementer defaults to
  permitting `count` on any `allowedColumn`, but only `sum/avg/min/max` on `numericColumns`.

- **OQ-2 — `between` operator value shape.** The `between` op takes a 2-tuple `[string, string]`
  or `[number, number]`. Whether mixed types (string/number) should be rejected by the compiler is
  an implementation detail; this spec requires only that `between` is whitelisted as an op.

- **OQ-3 — `date-range` vs `timeRange` overlap.** The DSL exposes both a `filters[].op: 'date-range'`
  and a top-level `timeRange?: TimeRangeSpec`. The implementer should define clear semantics:
  `timeRange` is syntactic sugar that the compiler normalizes to a pair of `date-range` filter clauses
  on compilation. Confirm in the plan.
