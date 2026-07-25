import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, REQUEST_TIMEOUT_CODE } from './withTimeout';
import { classifyMutationError } from './classifyMutationError';
import { AppError } from './appError';

describe('withTimeout (UI-freeze hardening)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves-before-deadline: a promise that settles before ms passes through unchanged', async () => {
    const inner = Promise.resolve('ok');
    await expect(withTimeout(inner, 1000)).resolves.toBe('ok');
  });

  it('rejects-before-deadline: the original rejection passes through unchanged (no reclassification)', async () => {
    const boom = Object.assign(new Error('nope'), { code: '42501' });
    const inner = Promise.reject(boom);
    inner.catch(() => {}); // pre-attach so vitest doesn't flag the source promise as unhandled
    await expect(withTimeout(inner, 1000)).rejects.toBe(boom);
  });

  it('never-resolving promise rejects with the classified timeout error after ms', async () => {
    const never = new Promise<string>(() => {});
    const result = withTimeout(never, 5000);
    // Prevent an unhandled-rejection warning while the timer hasn't fired yet.
    result.catch(() => {});

    // ⚑ Use a real settlement LATCH, not `Promise.race([result.then(…), Promise.resolve('pending')])`.
    // That race is vacuous: the derived `.then()` promise needs one extra microtask, so the
    // already-resolved literal ALWAYS wins and 'pending' is returned even when `result` has settled.
    // Mutating `setTimeout(…, ms)` → `setTimeout(…, 0)` left the whole suite green — i.e. the one
    // behavior this wrapper exists for (firing at the deadline, and NOT before) was untested.
    let state: 'pending' | 'resolved' | 'rejected' = 'pending';
    result.then(
      () => { state = 'resolved'; },
      () => { state = 'rejected'; },
    );

    await vi.advanceTimersByTimeAsync(4999);
    await Promise.resolve(); // flush microtasks so a premature settlement would be visible
    expect(state).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(state).toBe('rejected');
    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ code: REQUEST_TIMEOUT_CODE });
  });

  it('the timeout AppError classifies via classifyMutationError as a recoverable "Request timed out" failure', async () => {
    const never = new Promise<string>(() => {});
    const result = withTimeout(never, 1000);
    result.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).rejects.toBeInstanceOf(Error);

    let caught: unknown;
    try {
      await result;
    } catch (err) {
      caught = err;
    }
    expect(classifyMutationError(caught)).toEqual({
      headline: "Request timed out — we couldn't confirm whether it saved.",
      detail: 'The request timed out',
    });
  });

  it('accepts a custom message for the default AppError timeout path', async () => {
    const never = new Promise<string>(() => {});
    const result = withTimeout(never, 500, 'Custom timeout message');
    result.catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).rejects.toMatchObject({ message: 'Custom timeout message', code: REQUEST_TIMEOUT_CODE });
  });

  it('accepts a factory returning a custom Error for callers that want their own shape', async () => {
    const never = new Promise<string>(() => {});
    class CustomTimeoutError extends Error {
      code = 'CUSTOM_TIMEOUT';
    }
    const result = withTimeout(never, 500, () => new CustomTimeoutError('custom'));
    result.catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).rejects.toBeInstanceOf(CustomTimeoutError);
  });

  it('clears the deadline timer once the promise settles (no dangling timer after resolve)', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const inner = Promise.resolve('done');
    await withTimeout(inner, 10_000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
