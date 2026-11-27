import { supabase } from '@/src/lib/supabase/client';

/**
 * Setting readers that fire in the same moment (a screen asking for five switches, the shell asking for the
 * leave and module settings) share ONE `organizations` request: each asks for its columns, the union is selected
 * once, and every reader takes its own columns from the row. Nothing is kept after the batch resolves, so
 * freshness is unchanged; the same table grant and row policy apply, so each caller reads what it read before.
 *
 * The shared read uses only `.select(columns)`. If it fails in any way (an error, a thrown exception, an
 * unexpected response), each reader runs its own single read exactly as it did before, so one failure cannot
 * take every setting down. Readers get `{ data, error }` as the single query returned.
 */
type Row = Record<string, unknown>;
type Failure = { message: string; code?: string };
export interface OrgRead<T = Row> { data: T | null; error: Failure | null }
interface Shared { rows: Row[] | null; error: Failure | null; readers: number }

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null;
interface Batch { columns: Set<string>; readers: number; strict: boolean; result: Promise<Shared> }
let open: Batch | null = null;

function join(columns: readonly string[], strict: boolean): Promise<Shared> {
  if (!open) {
    const batch: Batch = {
      columns: new Set(), readers: 0, strict: false,
      result: new Promise<Shared>((resolve) => {
        setTimeout(async () => {
          if (open === batch) open = null; // later readers start a new batch
          const readers = batch.readers;
          try {
            // Two rows only when a reader must see a second visible organisation (the `.maybeSingle()` readers).
            const res = await supabase.from('organizations').select([...batch.columns].join(',')).limit(batch.strict ? 2 : 1);
            if (!res || !('data' in res)) { resolve({ rows: null, error: null, readers }); return; }
            if (res.error) { resolve({ rows: null, error: res.error, readers }); return; }
            const rows: Row[] = [];
            const list: unknown[] = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
            for (const row of list) if (isRow(row)) rows.push(row);
            resolve({ rows, error: null, readers });
          } catch {
            resolve({ rows: null, error: null, readers });
          }
        }, 0);
      }),
    };
    open = batch;
  }
  for (const column of columns) open.columns.add(column);
  open.readers += 1;
  if (strict) open.strict = true;
  return open.result;
}

/**
 * A throw or an unusable response always sends the reader to its own read. A returned database error does so only when
 * other readers shared the batch (one bad column must not fail them all); a lone reader just gets its own error back.
 */
const needsOwnRead = (shared: Shared): boolean => shared.rows === null && (shared.error === null || shared.readers > 1);

/** The reader's own single read, as it was before batching. */
async function single(columns: readonly string[], opts: { strict: boolean; limit: boolean }): Promise<OrgRead> {
  const list = columns.join(',');
  if (!opts.strict) {
    const { data, error } = await supabase.from('organizations').select(list).limit(1);
    return { data: Array.isArray(data) && isRow(data[0]) ? data[0] : null, error };
  }
  const query = supabase.from('organizations').select(list);
  const { data, error } = await (opts.limit ? query.limit(1) : query).maybeSingle();
  return { data: isRow(data) ? data : null, error };
}

/** The first visible organisation's row with the given columns (the `.limit(1)` read); `data` is null when none is visible. */
export async function readOrgColumns<T = Row>(columns: readonly string[]): Promise<OrgRead<T>> {
  const shared = await join(columns, false);
  if (needsOwnRead(shared)) return (await single(columns, { strict: false, limit: true })) as OrgRead<T>;
  if (shared.error) return { data: null, error: shared.error };
  return { data: (shared.rows?.[0] as T | undefined) ?? null, error: null };
}

/**
 * As `readOrgColumns`, but two visible organisations is an error, as `.maybeSingle()` returned.
 * `limit` says whether the reader's own single read also used `.limit(1)` (it only matters on the fallback).
 */
export async function readOrgColumnsStrict<T = Row>(columns: readonly string[], opts: { limit?: boolean } = {}): Promise<OrgRead<T>> {
  const shared = await join(columns, true);
  if (needsOwnRead(shared)) return (await single(columns, { strict: true, limit: opts.limit ?? false })) as OrgRead<T>;
  if (shared.error) return { data: null, error: shared.error };
  if (shared.rows && shared.rows.length > 1) {
    return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
  }
  return { data: (shared.rows?.[0] as T | undefined) ?? null, error: null };
}
