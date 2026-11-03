import { vi } from 'vitest';

type RpcResult = { data: unknown; error: unknown };
type RpcFallback = (name: string, args?: Record<string, unknown>) => RpcResult | Promise<RpcResult>;

/** Dispatcher handler tests assume the org is entitled unless they exercise the switch itself. */
export function makeDispatcherTestRpc(fallback: RpcFallback = () => ({ data: null, error: null })) {
  return vi.fn(async (name: string, args?: Record<string, unknown>): Promise<RpcResult> => {
    if (name === 'service_feature_enabled') return { data: true, error: null };
    return await fallback(name, args);
  });
}
