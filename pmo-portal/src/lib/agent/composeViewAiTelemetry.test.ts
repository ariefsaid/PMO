import { it, expect, vi, afterEach } from 'vitest';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps } from '../../../../supabase/functions/compose-view/handler';

afterEach(() => { delete (globalThis as { Deno?: unknown }).Deno; vi.unstubAllGlobals(); });

const SPEC = { version: 1, panels: [{ id: 'p1', primitive: 'KPITile', querySpec: { entity: 'projects', select: ['id', 'name', 'contract_value'], aggregate: { fn: 'sum', column: 'contract_value', alias: 'total' } } }] };
const supabase = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }) } as unknown as HandlerDeps['supabase'];
const ok = { create: vi.fn().mockResolvedValue({ finish_reason: 'tool_calls', model: 'm', usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, total_cost: 0.002 }, message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(SPEC) } }] } }) };

function stub() {
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === 'POSTHOG_PROJECT_KEY' ? 'phc_x' : undefined) } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostHog payloads are inspected structurally
  const sent: { event: string; properties: Record<string, any> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return { ok: true } as Response; }));
  return sent;
}
const settle = async () => { for (let n = 0; n < 10; n++) await new Promise((r) => setTimeout(r, 0)); };

it('AC-PHO-004 compose-view success emits one $ai_generation action=compose, tokens, cost, no text', async () => {
  const sent = stub();
  const r = await composeViewHandler({ prompt: 'secret prompt text', orgId: 'org-1' }, { modelClient: ok as never, model: 'm', supabase, userId: 'u-1' });
  await settle();
  expect(r.status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0].event).toBe('$ai_generation');
  expect(sent[0].properties).toMatchObject({ action: 'compose', $ai_output_tokens: 300, $ai_total_cost_usd: 0.002, $ai_is_error: false, org_id: 'org-1' });
  expect(JSON.stringify(sent)).not.toContain('secret prompt text');
  expect(sent[0].properties.$ai_input).toBeUndefined();
});

it('AC-PHO-004 compose-view upstream failure emits an errored generation with a code only', async () => {
  const sent = stub();
  const bad = { create: vi.fn().mockRejectedValue(new Error('boom with secret prompt text')) };
  const r = await composeViewHandler({ prompt: 'secret prompt text', orgId: 'org-1' }, { modelClient: bad as never, model: 'm', supabase, userId: 'u-1' });
  await settle();
  expect(r.status).toBe(502);
  expect(sent[0].properties).toMatchObject({ $ai_is_error: true, $ai_http_status: 502, error_code: 'UPSTREAM_ERROR', action: 'compose' });
  expect(JSON.stringify(sent)).not.toContain('secret');
});
