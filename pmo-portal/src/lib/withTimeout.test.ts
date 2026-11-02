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

  it('resolves-before-deadline: a promise that settles before the deadline passes through unchanged', async () => {
    const inner = Promise.resolve('ok');
    await expect(withTimeout(inner)).resolves.toBe('ok');
  });

  it('rejects-before-deadline: the original rejection passes through unchanged (no reclassification)', async () => {
    const boom = Object.assign(new Error('nope'), { code: '42501' });
    const inner = Promise.reject(boom);
    inner.catch(() => {}); // pre-attach so vitest doesn't flag the source promise as unhandled
    await expect(withTimeout(inner)).rejects.toBe(boom);
  });

  it('never-resolving promise remains pending until the shared deadline, then rejects as timed out', async () => {
    const never = new Promise<string>(() => {});
    const result = withTimeout(never);
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

    await vi.advanceTimersByTimeAsync(14_999);
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
    const result = withTimeout(never);
    result.catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).rejects.toBeInstanceOf(Error);

    let caught: unknown;
    try {
      await result;
    } catch (err) {
      caught = err;
    }
    expect(classifyMutationError(caught)).toEqual({
      headline: "Request timed out — we couldn't confirm whether it saved.",
      // App-authored message (AC-ERR-002): already human copy, so it passes through as-is.
      detail: 'The request timed out',
      rawDetail: 'The request timed out',
      classification: 'timeout',
    });
  });

  it('clears the deadline timer once the promise settles (no dangling timer after resolve)', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const inner = Promise.resolve('done');
    await withTimeout(inner);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  /**
   * #561, found by a mutation run — not by reading the file, and not by coverage, which was
   * already 100% on this line.
   *
   * ⛔ The test ABOVE says "once the promise settles" but only exercises RESOLVE. Deleting
   * `clearTimeout(timer)` from the REJECT branch left all 7 tests green: a promise that rejects
   * before its deadline left the deadline timer armed, and with fake timers off that is a real
   * dangling handle per failed call — in a wrapper whose entire job is not leaving work behind.
   *
   * ⚑ The timer count is asserted, not just the spy. `toHaveBeenCalled()` cannot tell WHICH branch
   * cleared it, so a spy-only assertion on the reject path would have been killed by the resolve
   * path's call and proved nothing — the same shape as the oracle it is fixing.
   */
  it('AC-TMO-004: clears the deadline timer when the promise REJECTS before it, leaving no armed timer', async () => {
    const before = vi.getTimerCount();
    await expect(withTimeout(Promise.reject(new Error('inner failed')))).rejects.toThrow(
      'inner failed',
    );
    expect(vi.getTimerCount()).toBe(before);
  });
});
