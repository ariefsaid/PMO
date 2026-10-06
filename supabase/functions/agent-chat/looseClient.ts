/**
 * looseClient.ts — the minimal structural view of the caller-JWT Supabase client that the coarse agent tools
 * need (filters, ordering, maybeSingle, functions.invoke). Leaf module. The real client is a superset; tests
 * pass a recording fake. Same precedent as erpSnapshots.ts's LooseSnapshotQuery. NEVER a service_role client:
 * tools only ever receive ctx.supabase (the deputy client).
 */
export interface LooseResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}
export interface LooseQuery extends PromiseLike<LooseResult> {
  eq(column: string, value: unknown): LooseQuery;
  in(column: string, values: readonly unknown[]): LooseQuery;
  lt(column: string, value: string): LooseQuery;
  is(column: string, value: null): LooseQuery;
  ilike(column: string, pattern: string): LooseQuery;
  order(column: string, opts?: { ascending?: boolean }): LooseQuery;
  limit(n: number): LooseQuery;
  maybeSingle(): PromiseLike<LooseResult>;
}
export interface LooseClient {
  from(table: string): { select(columns: string): LooseQuery };
}
export interface FunctionsClient {
  functions: { invoke(name: string, opts: { body: unknown }): Promise<{ data: unknown; error: unknown }> };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asLoose(client: unknown): LooseClient {
  return client as LooseClient;
}

export function asFunctions(client: unknown): FunctionsClient | null {
  const fns = (client as { functions?: { invoke?: unknown } } | null)?.functions;
  return fns && typeof fns.invoke === 'function' ? (client as FunctionsClient) : null;
}

export async function readRows<T>(q: PromiseLike<LooseResult>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(`read failed${error.code ? ` (${error.code})` : ''}`);
  return (Array.isArray(data) ? data : []) as T[];
}

export async function readOne<T>(q: PromiseLike<LooseResult>): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw new Error(`read failed${error.code ? ` (${error.code})` : ''}`);
  return (data ?? null) as T | null;
}

export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

/** A user/model term made safe for PostgREST `ilike`: its wildcards (% _ *) and escape (\) are removed. */
export function toLikeTerm(raw: string): string {
  return raw.replace(/[%_*\\]/g, ' ').replace(/\s+/g, ' ').trim();
}
