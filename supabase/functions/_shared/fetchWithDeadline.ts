/**
 * fetchWithDeadline — a bounded `fetch` for the edge-function (Deno) side, the SERVER complement of the
 * FE `invokeWithTimeout`. It gives a raw outbound HTTP call an `AbortController` + deadline so a hanging
 * or unreachable host (typically a slow/down ERPNext bench) can never tie up the edge worker forever —
 * the resource-exhaustion twin of the client-side UI freeze.
 *
 * ⚑ WHY: the ERPNext money transport (`erpnext/client.ts` `erpnextRequest`) already bounds every attempt,
 * but a couple of raw fiscal-calendar reads (`GET /api/resource/Fiscal Year`, on the budget-push gate +
 * its sweep backstop) bypass that client and had NO deadline. Under a slow/down ERPNext the worker would
 * block on that fetch indefinitely. This helper closes that gap without pulling those reads through the
 * full retry/classification client (which would change their error type + add retries).
 *
 * ⚑ MONEY-SAFETY: a deadline is a FAILURE / UNKNOWN outcome, never a false success — the caller converts a
 * `FetchDeadlineError` into the SAME `external-unreachable` fail-closed result a non-2xx already produces,
 * so the budget gate fails closed and the sweep backstop still owns eventual consistency. The abort frees
 * the socket; the thrown error is deterministic (driven by our own timer flag, not the runtime's abort
 * reason). A settled request leaves no dangling timer (always cleared in `finally`).
 */

/** Thrown when `fetchWithDeadline` aborts a request because it exceeded `timeoutMs`. Distinct from an
 *  ordinary network rejection so a caller can tell "we gave up" from "the host refused". */
export class FetchDeadlineError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`request exceeded its ${timeoutMs}ms deadline`);
    this.name = 'FetchDeadlineError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Issue `fetchImpl(input, init)` with an `AbortController` bounded at `timeoutMs`.
 *
 * - Resolves with the `Response` when the request settles before the deadline (unchanged behavior).
 * - On deadline: aborts the in-flight request and throws `FetchDeadlineError` (deterministic — keyed off
 *   our own `timedOut` flag, independent of how the runtime surfaces the abort reason).
 * - A non-timeout rejection (DNS/connection refused) propagates unchanged.
 */
export async function fetchWithDeadline(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new FetchDeadlineError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
