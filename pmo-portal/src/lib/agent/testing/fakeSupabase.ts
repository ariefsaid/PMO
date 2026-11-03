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

/** Deterministic, org-scoped switch snapshot: every key ON, the shape `resolved_org_features()` returns.
 *  A suite that needs a key off (or the resolver to fail) overrides `client.rpc`. */
export const FEATURES_ALL_ON = [
  'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full', 'sales_invoices', 'revenue',
  'budget_projection', 'imprest', 'user_views', 'm365_integration', 'clickup_sync', 'erp_sync',
  'erp_purchases', 'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
  'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant',
].map((feature_key) => ({ feature_key, enabled: true, display_enabled: true, source: 'plan' }));

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
      for (const op of ['eq', 'in', 'neq', 'lt', 'lte', 'gt', 'gte', 'is', 'ilike', 'order', 'limit', 'range']) {
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
  // S4: the caller's own client can resolve its org's switches; the handler reads it once per request.
  const rpc = vi.fn(async (fn: string) =>
    fn === 'resolved_org_features' ? { data: FEATURES_ALL_ON, error: null } : { data: null, error: null });
  const client = { from, rpc, functions: { invoke: invokeSpy } };
  return { client, calls, rpc, invoke: invokeSpy };
}

/**
 * Queue answers for the BUSINESS rpcs only, in order: the S4 switch resolver (`resolved_org_features`)
 * keeps answering from `FEATURES_ALL_ON`, so a suite that overrides `rpc` wholesale does not silently
 * deny the plan. Use with `rpcNames()` for call assertions.
 */
export function queueRpcAnswers(
  client: { rpc: ReturnType<typeof vi.fn> },
  answers: Array<{ data: unknown; error: unknown }>,
): void {
  const queue = [...answers];
  client.rpc.mockImplementation(async (fn: string) =>
    fn === 'resolved_org_features' ? { data: FEATURES_ALL_ON, error: null } : (queue.shift() ?? { data: null, error: null }));
}

/** The business rpc names called (the S4 switch resolver is filtered out — it is not what a suite asserts). */
export const rpcNames = (client: { rpc: ReturnType<typeof vi.fn> }): string[] =>
  (client.rpc.mock.calls as unknown[][]).map((c) => String(c[0])).filter((n) => n !== 'resolved_org_features');

/** The recorded filter ops of every call on `table`, in call order. */
export const opsOf = (calls: FakeCall[], table: string) => calls.filter((c) => c.table === table).map((c) => c.ops);
