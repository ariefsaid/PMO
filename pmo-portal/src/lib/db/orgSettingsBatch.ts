import { supabase } from '@/src/lib/supabase/client';

/**
 * Setting readers that fire in the same moment (a screen asking for five switches, the shell asking for the
 * leave and module settings) share ONE `organizations` request: each asks for its columns, the union is selected
 * once, and every reader takes its own columns from the row. Nothing is kept after the batch resolves, so
 * freshness is unchanged; the same table grant and row policy apply, so each caller reads what it read before.
 *
 * Readers get `{ data, error }` exactly as the single query returned, so each caller keeps its own error handling.
 */
type Row = Record<string, unknown>;
export interface OrgRead<T = Row> { data: T | null; error: { message: string; code?: string } | null }
interface Batch { columns: Set<string>; rows: Promise<{ rows: Row[]; error: OrgRead['error'] }> }

let open: Batch | null = null;

// The column list is chosen at run time, so the client cannot type the row; each reader states the columns it takes.
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null;

function join(columns: readonly string[]): Promise<{ rows: Row[]; error: OrgRead['error'] }> {
  if (!open) {
    const columnSet = new Set<string>();
    const batch: Batch = {
      columns: columnSet,
      rows: new Promise((resolve) => {
        setTimeout(async () => {
          if (open === batch) open = null; // later readers start a new batch
          // `.limit(2)` lets the strict reader see a second visible organisation, as `.maybeSingle()` did.
          const { data, error } = await supabase.from('organizations').select([...columnSet].join(',')).limit(2);
          const rows: Row[] = [];
          if (!error) for (const row of data ?? []) if (isRow(row)) rows.push(row);
          resolve({ rows, error: error ?? null });
        }, 0);
      }),
    };
    open = batch;
  }
  for (const column of columns) open.columns.add(column);
  return open.rows;
}

/** The first visible organisation's row with the given columns (the `.limit(1)` read); `data` is null when none is visible. */
export async function readOrgColumns<T = Row>(columns: readonly string[]): Promise<OrgRead<T>> {
  const { rows, error } = await join(columns);
  return { data: (rows[0] as T | undefined) ?? null, error };
}

/** As `readOrgColumns`, but two visible organisations is an error, as `.maybeSingle()` returned. */
export async function readOrgColumnsStrict<T = Row>(columns: readonly string[]): Promise<OrgRead<T>> {
  const { rows, error } = await join(columns);
  if (!error && rows.length > 1) {
    return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
  }
  return { data: (rows[0] as T | undefined) ?? null, error };
}
