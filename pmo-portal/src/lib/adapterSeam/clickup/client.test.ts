import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clickUpRequest, ClickUpHttpError, CLICKUP_REQUEST_TIMEOUT_MS } from './client.ts';

describe('AC-CUA-081 clickUpRequest surfaces X-RateLimit-Remaining so callers can throttle early', () => {
  it('invokes onRateLimitInfo with the parsed X-RateLimit-* headers on a successful response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': '7', 'X-RateLimit-Reset': '1700000000' },
        }),
    );
    const onRateLimitInfo = vi.fn();
    await clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't', onRateLimitInfo }, {
      method: 'GET',
      path: '/task/t1',
    });
    expect(onRateLimitInfo).toHaveBeenCalledWith({ limit: 100, remaining: 7, reset: 1700000000 });
  });

  it('still invokes onRateLimitInfo on a 429 (remaining=0) before the exhausted-retry error throws', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1' } }),
    );
    const onRateLimitInfo = vi.fn();
    await expect(
      clickUpRequest(
        { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't', onRateLimitInfo },
        { method: 'GET', path: '/task/t1' },
      ),
    ).rejects.toThrow(ClickUpHttpError);
    expect(onRateLimitInfo).toHaveBeenCalledWith(expect.objectContaining({ remaining: 0 }));
  });
});

describe('SEC-MEDIUM-5 a non-JSON error body must not crash status-based classification', () => {
  it('a 404 with an HTML error body still throws ClickUpHttpError(status=404) — never a SyntaxError', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html><body>Not Found</body></html>', { status: 404 }),
    );
    let thrown: unknown;
    try {
      await clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' }, { method: 'GET', path: '/list/gone/task' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ClickUpHttpError);
    expect((thrown as ClickUpHttpError).status).toBe(404);
  });

  it('a 404 with an empty (non-JSON) body still throws ClickUpHttpError(status=404)', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json at all', { status: 404 }));
    let thrown: unknown;
    try {
      await clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' }, { method: 'GET', path: '/list/gone/task' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ClickUpHttpError);
    expect((thrown as ClickUpHttpError).status).toBe(404);
  });
});

describe('AC-CUA-081 an exhausted 429 retry budget fails cleanly through the AdapterError vocabulary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a 429 that never clears (bounded attempts exhausted) throws ClickUpHttpError(external-unreachable), never hangs', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }));
    const resultPromise = clickUpRequest(
      { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' },
      { method: 'GET', path: '/task/t1' },
    );
    let thrown: unknown;
    const settled = resultPromise.catch((err) => {
      thrown = err;
    });
    // No Retry-After/X-RateLimit-Reset header on any attempt -> the linear fallback (500ms * attempt);
    // three retries max out at 500+1000+1500 = 3000ms of total backoff.
    await vi.advanceTimersByTimeAsync(3000);
    await settled;
    expect(thrown).toBeInstanceOf(ClickUpHttpError);
    expect((thrown as ClickUpHttpError).status).toBe(429);
    expect((thrown as ClickUpHttpError).code).toBe('external-unreachable');
    // 1 initial + 3 default retries = 4 calls, then it gives up (bounded, not infinite).
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('sync-integrity a non-idempotent create (POST) is never auto-retried on an ambiguous failure', () => {
  it('a 5xx on a POST create is attempted ONCE (no backoff retry) and surfaces as unconfirmed', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 502 }));
    let thrown: unknown;
    try {
      await clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' }, {
        method: 'POST',
        path: '/list/list-1/task',
        body: { name: 'New task' },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ClickUpHttpError);
    expect((thrown as ClickUpHttpError).code).toBe('external-unreachable');
    expect((thrown as ClickUpHttpError).status).toBe(502);
    expect((thrown as ClickUpHttpError).message).toMatch(/unconfirmed/);
    // The server may have recorded the create — re-sending it would mint a duplicate task.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a timed-out POST create is attempted once and surfaces as unconfirmed', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const settled = clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' }, {
      method: 'POST',
      path: '/list/list-1/task',
      body: { name: 'New task' },
    }).then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CLICKUP_REQUEST_TIMEOUT_MS);
    const err = await settled;
    expect(err).toBeInstanceOf(ClickUpHttpError);
    expect((err as ClickUpHttpError).code).toBe('external-unreachable');
    expect((err as ClickUpHttpError).message).toMatch(/unconfirmed/);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // one create attempt — never a blind resend
    vi.useRealTimers();
  });

  it('idempotent methods keep their bounded retry: a PUT 5xx is retried and succeeds', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const settled = clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' }, {
      method: 'PUT',
      path: '/task/cu-1',
      body: { name: 'Renamed' },
    }).then(() => null, (e: unknown) => e);
    // 5xx with no rate-limit headers -> the linear fallback (500ms) before attempt 2.
    await vi.advanceTimersByTimeAsync(500);
    const err = await settled;
    expect(err).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // reads/updates stay retryable
    vi.useRealTimers();
  });

  it('a 429 on a POST create is attempted once too (retries are for idempotent methods only)', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }));
    await expect(
      clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' }, {
        method: 'POST',
        path: '/list/list-1/task',
      }),
    ).rejects.toThrow(ClickUpHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('AC-OUT-841 clickUpRequest is deadline-bounded', () => {
  afterEach(() => vi.useRealTimers());

  it('AC-OUT-841: a hung ClickUp host rejects at the deadline as external-unreachable (never a hang)', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const settled = clickUpRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' }, { method: 'GET', path: '/task/t1' })
      .then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CLICKUP_REQUEST_TIMEOUT_MS);
    const err = await settled;
    expect(err).toBeInstanceOf(ClickUpHttpError);
    expect((err as ClickUpHttpError).code).toBe('external-unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // a timeout is not retried as a 429/5xx
  });
});
