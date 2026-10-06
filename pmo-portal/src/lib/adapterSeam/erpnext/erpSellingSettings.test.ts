import { describe, expect, it, vi } from 'vitest';
import { ensureErpSellingSettings } from './erpSellingSettings.ts';
import type { ErpClientDeps } from './client.ts';

type Call = { method: string; path: string; body: Record<string, unknown> | null };
function deps(respond: (call: Call) => Response): { deps: ErpClientDeps; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', path: decodeURIComponent(new URL(String(url)).pathname), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    calls.push(call);
    return respond(call);
  });
  return { deps: { fetchImpl: fetchImpl as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', sleep: async () => {} }, calls };
}
const NAME = 'Selling Settings.allow_negative_rates_for_items';

describe('ensureErpSellingSettings (#766 AC-PB-021: the recovery line needs negative rates)', () => {
  it('turns the setting on when the site has it off', async () => {
    const { deps: d, calls } = deps((c) => Response.json({ data: { allow_negative_rates_for_items: c.method === 'PUT' ? 1 : 0 } }));
    expect(await ensureErpSellingSettings(d)).toEqual([{ name: NAME, outcome: 'enabled' }]);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe('/api/resource/Selling Settings/Selling Settings');
    expect(put?.body).toEqual({ allow_negative_rates_for_items: 1 });
  });

  it('is idempotent: a site that already allows it is left alone', async () => {
    const { deps: d, calls } = deps(() => Response.json({ data: { allow_negative_rates_for_items: 1 } }));
    expect(await ensureErpSellingSettings(d)).toEqual([{ name: NAME, outcome: 'exists' }]);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('reports a refusal instead of throwing', async () => {
    const { deps: d } = deps((c) => (c.method === 'GET' ? Response.json({ data: { allow_negative_rates_for_items: 0 } }) : Response.json({ exc_type: 'PermissionError' }, { status: 403 })));
    const [outcome] = await ensureErpSellingSettings(d);
    expect(outcome).toMatchObject({ name: NAME, outcome: 'failed' });
  });
});
