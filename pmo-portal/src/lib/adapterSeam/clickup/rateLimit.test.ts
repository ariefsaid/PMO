import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClickUpRateLimiter, withBackoff } from './rateLimit.ts';

describe('AC-CUA-080 token bucket bounds ClickUp calls to the ~100/min budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-CUA-080 never grants more than capacity acquisitions within one rolling window', async () => {
    const limiter = new ClickUpRateLimiter({ capacity: 3, windowMs: 1000 });
    let granted = 0;
    void limiter.acquire('bulk').then(() => granted++);
    void limiter.acquire('bulk').then(() => granted++);
    void limiter.acquire('bulk').then(() => granted++);
    const fourth = limiter.acquire('bulk').then(() => granted++);

    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toBe(3); // the 4th is queued, not granted — budget respected

    await vi.advanceTimersByTimeAsync(500);
    expect(granted).toBe(3); // still within the window — still queued

    await vi.advanceTimersByTimeAsync(600); // the oldest grant now falls out of the window
    await fourth;
    expect(granted).toBe(4);
  });
});

describe('AC-CUA-080 a 429 triggers backoff honoring Retry-After, then resumes without dropping/duplicating work', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-CUA-080 retries exactly once after the Retry-After delay and returns the eventual 200', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '2' } });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const resultPromise = withBackoff(() => fetchImpl());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // Retry-After (2s) hasn't elapsed yet

    await vi.advanceTimersByTimeAsync(1);
    const res = await resultPromise;
    expect(fetchImpl).toHaveBeenCalledTimes(2); // resumed exactly once — no dropped/duplicated call
    expect(res.status).toBe(200);
  });

  it('AC-CUA-080 exhausts a bounded retry budget on repeated 5xx and returns the last failing response', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const resultPromise = withBackoff(() => fetchImpl(), { maxRetries: 2, sleep: async () => {} });
    const res = await resultPromise;
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 initial + 2 retries, then gives up
    expect(res.status).toBe(503);
  });
});

describe('NFR-CUA-PERF-003 an interactive command jumps ahead of remaining queued bulk work', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-CUA-080 interactive submitted mid-bulk-drain resolves before the still-queued bulk tokens (ordering)', async () => {
    const limiter = new ClickUpRateLimiter({ capacity: 1, windowMs: 1000 });
    const order: string[] = [];

    void limiter.acquire('bulk').then(() => order.push('bulk-1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['bulk-1']); // the single token is granted immediately

    void limiter.acquire('bulk').then(() => order.push('bulk-2'));
    void limiter.acquire('bulk').then(() => order.push('bulk-3'));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['bulk-1']); // both queued — no free token yet

    void limiter.acquire('interactive').then(() => order.push('interactive'));

    await vi.advanceTimersByTimeAsync(1000); // one token frees
    expect(order).toEqual(['bulk-1', 'interactive']); // interactive jumped the queued bulk work

    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['bulk-1', 'interactive', 'bulk-2']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['bulk-1', 'interactive', 'bulk-2', 'bulk-3']);
  });
});
