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
import {
  OpenRouterModelClient,
  providerPolicyFromEnv,
  DEFAULT_PROVIDER_POLICY,
} from '../../../../supabase/functions/_shared/openRouterModelClient';

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
  // Default routing policy: privacy-first no-train pin (DeepInfra → DigitalOcean).
  expect(body.provider).toEqual(DEFAULT_PROVIDER_POLICY);
  expect(body.usage).toEqual({ include: true });
});

it('emits a caller-supplied provider policy verbatim in the request body', async () => {
  const fetchMock = mockFetchOnce({
    model: 'm',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }],
  });
  const provider = { order: ['deepinfra'], data_collection: 'deny' as const, allow_fallbacks: false };
  await new OpenRouterModelClient({ apiKey: 'k', provider }).create({
    model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.provider).toEqual(provider);
});

const TIER = ['deepinfra', 'digitalocean', 'gmicloud', 'baidu', 'streamlake', 'alibaba', 'deepseek'];

it('providerPolicyFromEnv defaults to the no-train fallback tier, only-restricted', () => {
  expect(providerPolicyFromEnv({})).toEqual({
    allow_fallbacks: true,
    order: TIER,
    only: TIER,
  });
});

it('providerPolicyFromEnv honors explicit order/only/ignore/sort/fallbacks/data_collection', () => {
  // Explicit order pin (single provider), fallbacks off — the safety allow-list still defaults ON.
  expect(
    providerPolicyFromEnv({ AGENT_PROVIDER_ORDER: 'deepinfra', AGENT_PROVIDER_ALLOW_FALLBACKS: 'false' }),
  ).toEqual({ allow_fallbacks: false, order: ['deepinfra'], only: TIER });

  // Sort mode drops the default order pin, but the safety allow-list stays ON.
  expect(providerPolicyFromEnv({ AGENT_PROVIDER_SORT: 'throughput' })).toEqual({
    allow_fallbacks: true,
    only: TIER,
    sort: 'throughput',
  });

  // Explicit only + ignore.
  expect(
    providerPolicyFromEnv({ AGENT_PROVIDER_ONLY: 'deepinfra,gmicloud', AGENT_PROVIDER_IGNORE: 'deepseek' }),
  ).toEqual({ allow_fallbacks: true, order: TIER, only: ['deepinfra', 'gmicloud'], ignore: ['deepseek'] });

  // Empty AGENT_PROVIDER_ONLY explicitly DISABLES the allow-list restriction.
  expect(providerPolicyFromEnv({ AGENT_PROVIDER_ONLY: '' })).toEqual({
    allow_fallbacks: true,
    order: TIER,
  });

  // Opt into the stricter green-only (no-retention) filter.
  expect(providerPolicyFromEnv({ AGENT_PROVIDER_DATA_COLLECTION: 'deny' })).toEqual({
    allow_fallbacks: true,
    data_collection: 'deny',
    order: TIER,
    only: TIER,
  });

  // Empty AGENT_PROVIDER_ORDER drops the preference order (allow-list still applies).
  expect(providerPolicyFromEnv({ AGENT_PROVIDER_ORDER: '' })).toEqual({
    allow_fallbacks: true,
    only: TIER,
  });

  // An unrecognized sort value is ignored (falls back to the default order).
  expect(providerPolicyFromEnv({ AGENT_PROVIDER_SORT: 'bogus' })).toEqual({
    allow_fallbacks: true,
    order: TIER,
    only: TIER,
  });
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

it('captures cached_tokens + reasoning_tokens from usage detail objects, omits them when absent', async () => {
  // Telemetry hardening: OpenRouter returns prompt_tokens_details.cached_tokens (prefix-cache
  // hits) + completion_tokens_details.reasoning_tokens; both must flow into ModelUsage.
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      cost: 0.01,
      prompt_tokens_details: { cached_tokens: 768 },
      completion_tokens_details: { reasoning_tokens: 64 },
    },
  });
  const withDetails = await new OpenRouterModelClient({ apiKey: 'k' }).create({
    model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(withDetails.usage?.cached_tokens).toBe(768);
  expect(withDetails.usage?.reasoning_tokens).toBe(64);

  // Absent detail objects ⇒ fields omitted (not 0) so downstream defaulting owns the 0.
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const withoutDetails = await new OpenRouterModelClient({ apiKey: 'k' }).create({
    model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(withoutDetails.usage?.cached_tokens).toBeUndefined();
  expect(withoutDetails.usage?.reasoning_tokens).toBeUndefined();
});

it('AC-MC-005 throws a scrubbed Error on non-2xx and never logs the raw body', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockFetchOnce({ error: 'sk-secret-looking-value-should-never-be-logged' }, 500);

  // retryBaseDelayMs: 0 — a 500 is transient (AUDIT-C1) so it retries; zero the backoff for speed.
  const client = new OpenRouterModelClient({ apiKey: 'k', retryBaseDelayMs: 0 });
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

// ── Malformed-body hardening (remediation, cross-family review of PR #211) ────

const RAW_SECRET_MARKER = 'sk-secret-looking-value-should-never-be-logged';

/** Mocks fetch with a response whose .json() rejects (invalid JSON body) or whose
 * .text() carries a raw-secret-looking marker, to prove the marker never leaks
 * into the thrown Error's message. */
function mockFetchWithBadJson(rawText: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError(`Unexpected token in JSON: ${rawText}`)),
    text: () => Promise.resolve(rawText),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

it('throws a scrubbed error when response.json() fails to parse (invalid JSON body)', async () => {
  mockFetchWithBadJson(`not json at all ${RAW_SECRET_MARKER}`);

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow('OpenRouter response malformed');

  try {
    await client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  } catch (err) {
    expect((err as Error).message).not.toContain(RAW_SECRET_MARKER);
    expect((err as Error).message).not.toContain('Unexpected token');
  }
});

it('throws a scrubbed error when the body is missing choices', async () => {
  mockFetchOnce({ model: 'deepseek/deepseek-v4-flash' });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow('OpenRouter response malformed');
});

it('throws a scrubbed error when choices is an empty array', async () => {
  mockFetchOnce({ model: 'deepseek/deepseek-v4-flash', choices: [] });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow('OpenRouter response malformed');
});

it('throws a scrubbed error when choices[0].message is missing/not an object', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: null }],
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow('OpenRouter response malformed');
});

it('throws a scrubbed error when finish_reason is missing', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ message: { role: 'assistant', content: 'hi' } }],
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow('OpenRouter response malformed');
});

it('throws a scrubbed error when tool_calls is malformed (non-array)', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: `not-an-array ${RAW_SECRET_MARKER}`,
        },
      },
    ],
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  let caught: Error | undefined;
  try {
    await client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  } catch (err) {
    caught = err as Error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught?.message).toBe('OpenRouter response malformed');
  expect(caught?.message).not.toContain(RAW_SECRET_MARKER);
});

it('never leaks the raw body text into the thrown error message for any malformed-shape case', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  mockFetchOnce({ model: 'x', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: RAW_SECRET_MARKER } }] });
  // Sanity: well-formed body with the marker as legitimate content is fine —
  // now assert the malformed cases scrub it.
  mockFetchOnce({ model: 'x', choices: null });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow('OpenRouter response malformed');

  expect(consoleSpy).not.toHaveBeenCalled();
  consoleSpy.mockRestore();
});

// ── AUDIT-C1 (2026-07-04 audit, Reliability C-1): bounded retry on transient upstream failures ──

const OK_BODY = {
  model: 'm',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
};

/** Mock fetch resolving/rejecting a fixed sequence, one entry per attempt. */
function mockFetchSequence(seq: Array<{ status: number; body?: unknown } | 'network-error'>) {
  const fn = vi.fn();
  for (const entry of seq) {
    if (entry === 'network-error') {
      fn.mockRejectedValueOnce(new TypeError('fetch failed'));
    } else {
      fn.mockResolvedValueOnce({
        ok: entry.status >= 200 && entry.status < 300,
        status: entry.status,
        json: () => Promise.resolve(entry.body),
        text: () => Promise.resolve(JSON.stringify(entry.body)),
      });
    }
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

const PARAMS = { model: 'x', max_tokens: 10, messages: [{ role: 'user' as const, content: 'hi' }] };

it('AUDIT-C1 retries a 500 and succeeds on the second attempt', async () => {
  const fn = mockFetchSequence([{ status: 500, body: {} }, { status: 200, body: OK_BODY }]);
  const client = new OpenRouterModelClient({ apiKey: 'k', retryBaseDelayMs: 0 });
  const res = await client.create(PARAMS);
  expect(res.message.content).toBe('ok');
  expect(fn).toHaveBeenCalledTimes(2);
});

it('AUDIT-C1 retries 429s and succeeds on the third attempt', async () => {
  const fn = mockFetchSequence([{ status: 429, body: {} }, { status: 429, body: {} }, { status: 200, body: OK_BODY }]);
  const client = new OpenRouterModelClient({ apiKey: 'k', retryBaseDelayMs: 0 });
  const res = await client.create(PARAMS);
  expect(res.message.content).toBe('ok');
  expect(fn).toHaveBeenCalledTimes(3);
});

it('AUDIT-C1 retries a network-level fetch failure', async () => {
  const fn = mockFetchSequence(['network-error', { status: 200, body: OK_BODY }]);
  const client = new OpenRouterModelClient({ apiKey: 'k', retryBaseDelayMs: 0 });
  const res = await client.create(PARAMS);
  expect(res.message.content).toBe('ok');
  expect(fn).toHaveBeenCalledTimes(2);
});

it('AUDIT-C1 gives up after 3 attempts and surfaces the scrubbed error', async () => {
  const fn = mockFetchSequence([{ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }]);
  const client = new OpenRouterModelClient({ apiKey: 'k', retryBaseDelayMs: 0 });
  await expect(client.create(PARAMS)).rejects.toThrow('OpenRouter request failed: 503');
  expect(fn).toHaveBeenCalledTimes(3);
});

it('AUDIT-C1 does NOT retry a terminal 4xx (caller error)', async () => {
  const fn = mockFetchSequence([{ status: 400, body: {} }, { status: 200, body: OK_BODY }]);
  const client = new OpenRouterModelClient({ apiKey: 'k', retryBaseDelayMs: 0 });
  await expect(client.create(PARAMS)).rejects.toThrow('OpenRouter request failed: 400');
  expect(fn).toHaveBeenCalledTimes(1);
});

it('AUDIT-C1 does NOT retry a timeout (single attempt only)', async () => {
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
  const client = new OpenRouterModelClient({ apiKey: 'k', retryBaseDelayMs: 0 });
  const promise = client.create(PARAMS);
  const assertion = expect(promise).rejects.toThrow('OpenRouter request timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  expect(fn).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
