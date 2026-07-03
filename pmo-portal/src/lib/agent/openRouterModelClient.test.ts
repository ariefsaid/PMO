/**
 * Unit tests for OpenRouterModelClient — the ModelClient implementation calling
 * OpenRouter's chat-completions API. fetch is mocked; no live network calls (ADR-0039 dec 7).
 *
 * AC-MC-001..007 (docs/specs/agent-model-client.spec.md).
 *
 * Test-location convention (standing rule, established by this issue + issue-2 plan
 * docs/plans/2026-07-03-agent-persistence.md REC-1): edge-fn logic tests live under
 * pmo-portal/ (Vitest's root); the implementation stays in supabase/functions/,
 * imported here via a relative path — Vite's dev-server fs boundary (server.fs.allow)
 * blocks Vitest from discovering test files that live outside pmo-portal/ itself, even
 * though cross-boundary *imports* from a pmo-portal/-resident test file work fine.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterModelClient } from '../../../../supabase/functions/_shared/openRouterModelClient';

function mockFetchOnce(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('AC-MC-001 sends POST to the OpenRouter chat-completions endpoint with the right headers/body shape', async () => {
  const fetchMock = mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }],
  });

  const client = new OpenRouterModelClient({ apiKey: 'test-key' });
  await client.create({
    model: 'deepseek/deepseek-v4-flash',
    max_tokens: 512,
    messages: [{ role: 'user', content: 'hello' }],
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer test-key');
  expect(init.headers['Content-Type']).toBe('application/json');

  const body = JSON.parse(init.body as string);
  expect(body.model).toBe('deepseek/deepseek-v4-flash');
  expect(body.max_tokens).toBe(512);
  expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  expect(body.provider).toEqual({ order: ['DeepInfra'], allow_fallbacks: true });
  expect(body.usage).toEqual({ include: true });
});
