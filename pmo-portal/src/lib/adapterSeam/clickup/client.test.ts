import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clickUpRequest, ClickUpHttpError } from './client.ts';

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
