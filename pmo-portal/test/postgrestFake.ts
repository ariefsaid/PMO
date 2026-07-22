/**
 * A PostgREST-FAITHFUL fake service client for the adapter-seam unit suites.
 *
 * ⚑ WHY THIS EXISTS. Eight audit rounds walked past a silently-truncated money read because every
 * hand-rolled fake in this repo resolved a `select()` to `Promise.resolve({ data: [...allRows] })`
 * with `eq: () => builder`. Such a fake is PHYSICALLY UNABLE to express the two behaviours that make
 * the defect real:
 *
 *   1. **Truncation is silent.** PostgREST refuses to return more than `db-max-rows` rows in one
 *      response (`supabase/config.toml` `max_rows = 1000`; 1000 is also Supabase Cloud's default) and
 *      signals NOTHING when it caps: HTTP 200, a short body, `error === null`. A read that must see a
 *      whole set — every money sum, every "have I already stored this?" guard — is therefore WRONG,
 *      not failed, past 1000 rows.
 *   2. **Unordered reads have no row order.** Postgres guarantees no order across statements, so an
 *      unordered paged scan can return one row twice and miss another — double-counted money.
 *
 * So this fake models both: it caps every response at `maxRows`, it honours OFFSET paging
 * (`.range(from, to)`) and KEYSET paging (`.gt(col, cursor).limit(n)`), and
 * when a query applies NO `.order()` it deliberately returns the rows ROTATED by a per-request
 * counter (a stand-in for heap order). A read that pages without ordering therefore FAILS here, which
 * is exactly the property we want a regression to have.
 *
 * It is a test double for the STRUCTURAL service-client seams (`SnapshotServiceClient`,
 * `LedgerFeedServiceClient`) — the same `.from(t).select(c).eq()…` surface supabase-js exposes.
 * Callers cast `as unknown as never` at the boundary, exactly as production does.
 */

/** `supabase/config.toml` `[api] max_rows` — the cap PostgREST applies to EVERY response. */
export const DEFAULT_MAX_ROWS = 1000;

export type FakeRow = Record<string, unknown>;

interface Filter {
  column: string;
  value: unknown;
  /** `eq` (default) or `gt` — the keyset cursor's comparison. */
  op?: 'eq' | 'gt';
}

/** One recorded request, so a test can assert HOW the read was issued (paged? ordered?). */
export interface RecordedRead {
  table: string;
  columns: string;
  filters: Filter[];
  orderBy: string[];
  range: { from: number; to: number } | null;
  /** Rows actually returned — i.e. after the `maxRows` cap. */
  returned: number;
}

export interface FakePostgrestOptions {
  /** The PostgREST `db-max-rows` cap to model. Defaults to the repo's configured 1000. */
  maxRows?: number;
  /** Tables whose reads must fail, mapped to the PostgREST-shaped error to return. */
  readErrors?: Record<string, { message: string; code?: string }>;
  /**
   * Per-table UNIQUE constraint columns, so `upsert` REPLACES a conflicting row instead of appending
   * one (e.g. `erp_gl_entry_mirror` is `unique (org_id, erp_name)`, 0101 §1). A table with no entry
   * here appends, matching an unconstrained insert.
   */
  upsertKeys?: Record<string, string[]>;
}

type PgError = { message: string; code?: string } | null;

/**
 * An in-memory, PostgREST-shaped database. Construct with the seeded tables; read what the code
 * under test wrote back out of `rowsOf(table)`.
 */
export class FakePostgrest {
  readonly tablesTouched: string[] = [];
  readonly reads: RecordedRead[] = [];
  readonly inserted: Record<string, FakeRow[][]> = {};
  readonly deletedScopes: Record<string, Filter[][]> = {};
  readonly upserted: Record<string, FakeRow[][]> = {};

  private readonly data: Record<string, FakeRow[]>;
  private readonly maxRows: number;
  private readonly readErrors: Record<string, { message: string; code?: string }>;
  private readonly upsertKeys: Record<string, string[]>;
  /** Bumped per request — drives the "no ORDER BY ⇒ no stable order" rotation. */
  private requestSeq = 0;

  constructor(tables: Record<string, FakeRow[]> = {}, opts: FakePostgrestOptions = {}) {
    this.data = {};
    for (const [name, rows] of Object.entries(tables)) this.data[name] = rows.map((r) => ({ ...r }));
    this.maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
    this.readErrors = opts.readErrors ?? {};
    this.upsertKeys = opts.upsertKeys ?? {};
  }

  /** The table's current rows (post-write), for assertions. */
  rowsOf(table: string): FakeRow[] {
    return this.data[table] ?? [];
  }

  from(table: string): unknown {
    this.tablesTouched.push(table);
    return {
      select: (columns: string) => this.makeSelectBuilder(table, columns),
      insert: (rows: FakeRow[]) => {
        (this.inserted[table] ??= []).push(rows.map((r) => ({ ...r })));
        (this.data[table] ??= []).push(...rows.map((r) => ({ ...r })));
        return Promise.resolve({ error: null as PgError });
      },
      upsert: (rows: FakeRow | FakeRow[]) => {
        const list = Array.isArray(rows) ? rows : [rows];
        (this.upserted[table] ??= []).push(list.map((r) => ({ ...r })));
        const keys = this.upsertKeys[table];
        const store = (this.data[table] ??= []);
        for (const row of list) {
          const existing = keys
            ? store.findIndex((r) => keys.every((k) => r[k] === row[k]))
            : -1;
          if (existing >= 0) store[existing] = { ...store[existing], ...row };
          else store.push({ ...row });
        }
        return Promise.resolve({ error: null as PgError });
      },
      delete: () => this.makeDeleteBuilder(table),
    };
  }

  private makeDeleteBuilder(table: string) {
    const filters: Filter[] = [];
    const run = (): { error: PgError } => {
      (this.deletedScopes[table] ??= []).push([...filters]);
      this.data[table] = (this.data[table] ?? []).filter((row) => !matches(row, filters));
      return { error: null };
    };
    const builder = {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return builder;
      },
      then<T>(onOk: (v: { error: PgError }) => T) {
        return Promise.resolve(run()).then(onOk);
      },
    };
    return builder;
  }

  private makeSelectBuilder(table: string, columns: string) {
    const filters: Filter[] = [];
    const orderBy: string[] = [];
    let range: { from: number; to: number } | null = null;
    let limit: number | null = null;

    const run = (): { data: FakeRow[] | null; error: PgError } => {
      const failure = this.readErrors[table];
      if (failure) return { data: null, error: failure };

      let rows = (this.data[table] ?? []).filter((row) => matches(row, filters));

      if (orderBy.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const column of orderBy) {
            const av = a[column];
            const bv = b[column];
            if (av === bv) continue;
            // Model Postgres' collation loosely: undefined/null sort last, otherwise string compare.
            if (av === undefined || av === null) return 1;
            if (bv === undefined || bv === null) return -1;
            return String(av) < String(bv) ? -1 : 1;
          }
          return 0;
        });
      } else if (rows.length > 1) {
        // ⚑ NO `ORDER BY` ⇒ NO ROW ORDER. Postgres may return the rows in any order, and it may
        // differ between statements. Rotating by the request counter is the cheapest faithful model:
        // a paged scan that forgot to order will read one row twice and miss another, and any test
        // that sums the result will go red — which is the point.
        const shift = this.requestSeq % rows.length;
        rows = [...rows.slice(shift), ...rows.slice(0, shift)];
      }
      this.requestSeq += 1;

      if (range) rows = rows.slice(range.from, range.to + 1);
      if (limit !== null) rows = rows.slice(0, limit);

      // ⚑ THE CAP. PostgREST truncates at `db-max-rows` and says nothing: 200, short body, no error.
      const returned = rows.slice(0, this.maxRows);
      this.reads.push({ table, columns, filters: [...filters], orderBy: [...orderBy], range, returned: returned.length });
      return { data: returned.map((r) => ({ ...r })), error: null };
    };

    const builder = {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return builder;
      },
      order(column: string) {
        orderBy.push(column);
        return builder;
      },
      gt(column: string, value: unknown) {
        filters.push({ column, value, op: 'gt' });
        return builder;
      },
      range(from: number, to: number) {
        range = { from, to };
        return builder;
      },
      limit(n: number) {
        limit = n;
        return builder;
      },
      maybeSingle() {
        const res = run();
        return Promise.resolve({ data: res.data?.[0] ?? null, error: res.error });
      },
      then<T>(onOk: (v: { data: FakeRow[] | null; error: PgError }) => T) {
        return Promise.resolve(run()).then(onOk);
      },
    };
    return builder;
  }
}

function matches(row: FakeRow, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.column];
    // A column the seed row simply doesn't carry is not a mismatch (the unit seeds are partial rows);
    // a column it DOES carry must satisfy the filter, so org isolation is really modelled.
    if (v === undefined) return true;
    if (f.op === 'gt') return String(v) > String(f.value);
    return v === f.value;
  });
}
