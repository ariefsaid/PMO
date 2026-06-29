# ADR-0038 — View-Renderer Executor: direct Supabase PostgREST chaining over repository method dispatch

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Director, eng-planner
- **Related:** ADR-0036 (deputy model, build sequence), ADR-0037 (compiler DSL, ENTITY_WHITELIST), ADR-0017 (repository seam), ADR-0010 (test pyramid)
- **Implements:** ADR-0036 §4c (spec renderer), I3 executor (`src/lib/viewspec/executor.ts`)

---

## Context

`FR-VR-020` calls for `executeCompiledQuery` to dispatch to `repositories.*` methods based on
`compiled.repositoryMethod`. The existing repository methods have **typed, bounded signatures**
that do not accept arbitrary filter chains:

| Entity | Repository method | Existing signature |
|---|---|---|
| `projects` | `project.list` | `list(params?: { status?: string; pmId?: string })` |
| `companies` | `company.list` | `list(params?: { ... })` |
| `tasks` | `task.list` | `list(projectId: string)` |
| `incidents` | `incident.list` | `list(params?: { ... })` |
| `contacts` | `contact.list` | `list()` |
| `user_views` | `userView.list` | `list()` |

None of these accept a `ResolvedFilter[]` array, an arbitrary `.select()` string, or a
`.order()` / `.limit()` chain. Dispatching through them would require adding an `executeQuery`
method to every repository interface — a broad, pre-emptive change to the seam for I4/I5 requirements
that are not yet scoped.

## Decision

`executeCompiledQuery` dispatches **directly to the Supabase PostgREST client**
(`src/lib/supabase/client`) using the `entity → table` mapping from `ENTITY_WHITELIST`. It calls
`supabase.from(entityEntry.table).select(...)` and chains `.eq()`, `.in()`, `.gt()`, `.gte()`,
`.lt()`, `.lte()`, `.between()`, `.order()`, `.limit()` using ONLY the operators in `VALID_FILTER_OPS`.

### Why this does NOT violate ADR-0017 (repository seam)

ADR-0017's seam contract is: **the FE does not import DAL functions directly for CRUD pages**.
The executor is not a CRUD page — it is a query-only path for the renderer, consuming the same
`supabase` singleton client that every DAL function uses. It enforces the same RLS contract
(the anon-key + viewer JWT means RLS scopes every row) because it uses the same authenticated
client. It introduces no new Supabase client; it does not bypass RLS.

The `ENTITY_WHITELIST.table` field is the Postgres table name, used only as the argument to
`supabase.from(table)`. The executor never interpolates the table name into a SQL string; it only
passes it to the PostgREST client library's type-safe `.from()` method — the same call every
existing DAL function starts with.

### Why not extend repository interfaces now

1. I4 (builder UI) and I5 (agent spec-author) are not yet scoped; their exact query-dispatch needs
   may differ from the renderer's (e.g. they may need `count`, `explain`, or streaming).
2. Adding an `executeQuery(compiled)` method to all 12 repository interfaces + their Supabase
   implementations + their mock implementations in tests is a broad change with no current consumer
   other than the renderer.
3. The renderer is the only place that calls `executeCompiledQuery`; isolating it in `executor.ts`
   keeps the blast radius of the PostgREST-chain approach to one module.

### Consequences

- `executor.ts` imports `supabase` from `src/lib/supabase/client` and `ENTITY_WHITELIST` from
  `src/lib/viewspec/types.ts`. It does NOT import from `repositories/index.ts`.
- `NFR-VR-LAYER-001` must be updated in the spec (or annotated in the plan) to note that the executor
  imports `ENTITY_WHITELIST` (for the `table` name) from `types.ts`, not from a repository.
- In-memory groupBy/aggregate (OD-3 from ADR-0037) is still applied in `executor.ts` after the
  Supabase call returns; the row cap (≤ 500) is enforced at the `.limit()` call, not after.
- `between` and `date-range` ops both map to `.gte(column, values[0]).lte(column, values[1])` chains
  (PostgREST does not have a native `between` verb; the compiler produces a `date-range` filter
  which the executor expands to two half-open inequalities).
- Future I4/I5: if a smarter dispatch through repository methods proves needed, the `ENTITY_WHITELIST`
  `repositoryMethod` field (already present) is the hook — the executor can be refactored to use it
  at that time without changing the compiler or the renderer.
