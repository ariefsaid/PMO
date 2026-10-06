/** Recording fake of the caller-JWT Supabase client for the #787 coarse-tool + handler tests. Every terminal
 *  (await / single / maybeSingle) records {table, columns, ops} and asks `respond` for the result. */
import { vi } from 'vitest';

export interface FakeCall {
  table: string;
  columns: string;
  ops: Array<[string, ...unknown[]]>;
  terminal: 'then' | 'single' | 'maybeSingle';
}
export type Responder = (call: FakeCall) => { data: unknown; error: unknown };
export type Invoker = (name: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;

export function fakeSupabase(respond: Responder, invoke?: Invoker) {
  const calls: FakeCall[] = [];
  const from = (table: string) => ({
    select(columns: string) {
      const ops: FakeCall['ops'] = [];
      const finish = (terminal: FakeCall['terminal']) => {
        const call: FakeCall = { table, columns, ops, terminal };
        calls.push(call);
        return Promise.resolve(respond(call));
      };
      const chain: Record<string, unknown> = {};
      for (const op of ['eq', 'in', 'lt', 'is', 'ilike', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => {
          ops.push([op, ...args]);
          return chain;
        };
      }
      chain.single = () => finish('single');
      chain.maybeSingle = () => finish('maybeSingle');
      chain.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => finish('then').then(ok, fail);
      return chain;
    },
  });
  const invokeSpy = vi.fn(invoke ?? (async () => ({ data: null, error: { message: 'no functions in this fake' } })));
  const client = { from, rpc: vi.fn(async () => ({ data: null, error: null })), functions: { invoke: invokeSpy } };
  return { client, calls, invoke: invokeSpy };
}

/** The recorded filter ops of every call on `table`, in call order. */
export const opsOf = (calls: FakeCall[], table: string) => calls.filter((c) => c.table === table).map((c) => c.ops);
