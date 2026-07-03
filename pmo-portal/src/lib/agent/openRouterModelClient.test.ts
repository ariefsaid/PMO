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

it('AC-MC-002 maps a text-only completion to ModelResponse', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'answer text' },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const resp = await client.create({
    model: 'deepseek/deepseek-v4-flash',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(resp.finish_reason).toBe('stop');
  expect(resp.message.content).toBe('answer text');
  expect(resp.message.tool_calls).toBeUndefined();
  expect(resp.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
});

it('AC-MC-003 tool_calls arguments stay a JSON-encoded string, not pre-parsed', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'query_entity', arguments: '{"entity":"projects"}' },
            },
          ],
        },
      },
    ],
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const resp = await client.create({
    model: 'deepseek/deepseek-v4-flash',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(resp.finish_reason).toBe('tool_calls');
  expect(resp.message.tool_calls?.[0].function.arguments).toBe('{"entity":"projects"}');
  expect(typeof resp.message.tool_calls?.[0].function.arguments).toBe('string');
});

it('AC-MC-004 surfaces total_cost when the provider reports it, omits it when absent', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.0004 },
  });
  const withCost = await new OpenRouterModelClient({ apiKey: 'k' }).create({
    model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(withCost.usage?.total_cost).toBe(0.0004);

  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const withoutCost = await new OpenRouterModelClient({ apiKey: 'k' }).create({
    model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(withoutCost.usage?.total_cost).toBeUndefined();
});

it('AC-MC-005 throws a scrubbed Error on non-2xx and never logs the raw body', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockFetchOnce({ error: 'sk-secret-looking-value-should-never-be-logged' }, 500);

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow(Error);

  for (const spy of [consoleSpy, consoleWarnSpy, consoleLogSpy]) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sk-secret-looking-value-should-never-be-logged');
    }
  }
  consoleSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

it('AC-MC-006 rejects within the timeout window when fetch never resolves', async () => {
  vi.useFakeTimers();
  const fn = vi.fn((_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  });
  vi.stubGlobal('fetch', fn);

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const promise = client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  const assertion = expect(promise).rejects.toThrow('OpenRouter request timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  vi.useRealTimers();
});

it('AC-MC-007 echoes the server-reported model, not the requested model', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const resp = await client.create({
    model: 'some/other-requested-model',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(resp.model).toBe('deepseek/deepseek-v4-flash');
});
