import { describe, it, expect, vi, afterEach } from 'vitest';
import { invokeWithTimeout, makeTimeoutInvokeError, DEFAULT_INVOKE_TIMEOUT_MS } from './invokeWithTimeout.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('invokeWithTimeout — bounds a hanging supabase.functions.invoke so the UI fails fast (money-path hardening)', () => {
  it('passes a fast successful { data, error } straight through (happy path unchanged)', async () => {
    const result = await invokeWithTimeout(Promise.resolve({ data: { ok: 1 }, error: null }));
    expect(result).toEqual({ data: { ok: 1 }, error: null });
  });

  it('passes a fast returned error straight through (an invoke error before timeout is untouched)', async () => {
    const invokeError = { message: 'boom', context: { clone: () => ({ json: async () => ({}) }) } };
    const result = await invokeWithTimeout(Promise.resolve({ data: null, error: invokeError }));
    expect(result.error).toBe(invokeError);
  });

  it('on timeout, resolves with a synthetic network-shaped error (context undefined) — not a hang, not a throw', async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<{ data: unknown; error: unknown }>(() => {});
    const raced = invokeWithTimeout(neverResolves, 15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await raced;
    expect(result.data).toBeNull();
    // Shaped like a FunctionsFetchError: NO HTTP Response on `.context` → every existing
    // classifier (classifyDispatchError / classifyM365InvokeError) maps it to external-unreachable.
    expect((result.error as { context?: unknown }).context).toBeUndefined();
    expect((result.error as { code?: string }).code).toBe('external-unreachable');
  });

  it('does NOT time out before the deadline (a request that resolves just under the bound succeeds)', async () => {
    vi.useFakeTimers();
    let resolveInvoke!: (v: { data: unknown; error: unknown }) => void;
    const invocation = new Promise<{ data: unknown; error: unknown }>((r) => { resolveInvoke = r; });
    const raced = invokeWithTimeout(invocation, 15_000);
    await vi.advanceTimersByTimeAsync(14_000);
    resolveInvoke({ data: { ok: true }, error: null });
    const result = await raced;
    expect(result).toEqual({ data: { ok: true }, error: null });
  });

  it('a late rejection after the timeout already won does not throw to the caller', async () => {
    vi.useFakeTimers();
    let rejectInvoke!: (e: unknown) => void;
    const invocation = new Promise<{ data: unknown; error: unknown }>((_, rej) => { rejectInvoke = rej; });
    const raced = invokeWithTimeout(invocation, 15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await raced; // timeout wins
    expect(result.data).toBeNull();
    // The underlying invoke rejects LATE — must be swallowed (no unhandled rejection / crash).
    rejectInvoke(new Error('late network failure'));
    await Promise.resolve();
  });

  it('propagates an early rejection (invoke rejects before the timeout) as before', async () => {
    await expect(invokeWithTimeout(Promise.reject(new Error('immediate')), 15_000)).rejects.toThrow('immediate');
  });

  it('exposes a sane default timeout that is bounded (enough for a real ERP, short enough to not freeze)', () => {
    expect(DEFAULT_INVOKE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(DEFAULT_INVOKE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('makeTimeoutInvokeError never leaks a host/URL/raw fetch string (generic user-safe message)', () => {
    const err = makeTimeoutInvokeError();
    expect(err.context).toBeUndefined();
    expect(err.message).not.toContain('http');
    expect(err.message.toLowerCase()).toContain('timed out');
  });
});
