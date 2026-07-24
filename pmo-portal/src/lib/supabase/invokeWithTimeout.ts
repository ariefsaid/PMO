/**
 * invokeWithTimeout — a bounded race around a `supabase.functions.invoke(...)` call so a hanging or
 * unreachable edge function (typically because the external system it fronts — ERPNext / ClickUp /
 * Microsoft Graph — is slow or down) fails FAST instead of freezing the UI forever.
 *
 * ⚑ THE BUG THIS FIXES (money path): activating a budget version `await`s a synchronous ERP push
 * through `adapter-dispatch`. `supabase.functions.invoke` has no built-in timeout, so when the served
 * fn is reachable but the ERPNext bench behind it is not, the invoke NEVER settles — the confirm
 * dialog's mutation stays pending forever and both buttons sit `[disabled]` (the CI-only AC-732 hang).
 *
 * WHY A `Promise.race` (not an AbortSignal): `supabase.functions.invoke` does not reliably forward an
 * AbortSignal to the underlying fetch across supabase-js versions, so we bound it with a timer that
 * resolves with a synthetic failure. The in-flight invoke is left to settle in the background (its late
 * result is ignored) — we deliberately do NOT report a timeout as a success.
 *
 * ⚑ MONEY-SAFETY: a timeout is treated as "the request FAILED / outcome UNKNOWN", never a false success.
 * The synthetic error is shaped like a `FunctionsFetchError` (a network failure: NO HTTP `Response` on
 * `.context`), so every existing classifier (`classifyDispatchError`, `classifyM365InvokeError`, the
 * repository `wrap`/`toAppError`) already maps it to `external-unreachable`. The caller therefore treats
 * a timeout exactly like an unreachable-external push failure — and the durable outbox / sweep backstop
 * still owns eventual consistency. Happy-path behavior is unchanged: a fast success (or a fast returned
 * error) resolves before the timer and passes straight through.
 */

/** A sane default: long enough for a real ERPNext round-trip, short enough to never freeze the UI. */
export const DEFAULT_INVOKE_TIMEOUT_MS = 20_000;

/** The `{ data, error }` envelope every `supabase.functions.invoke` call resolves with. */
export interface InvokeLike<T> {
  data: T | null;
  error: unknown;
}

/**
 * The synthetic error produced on timeout. Deliberately mimics a `FunctionsFetchError`:
 *   - `context: undefined` — no HTTP `Response`, so `hasHttpResponse(error)` is false in every
 *     classifier → the failure is classified as `external-unreachable` (a network failure), NOT a
 *     structured commit-rejection and NEVER a success;
 *   - `code: 'external-unreachable'` — so the repository seam's `toAppError` (which reads a string
 *     `.code`) also yields a classifiable AppError;
 *   - a GENERIC, user-safe `message` — no host / URL / raw fetch string is ever surfaced.
 */
export function makeTimeoutInvokeError(): {
  name: string;
  message: string;
  code: string;
  context: undefined;
} {
  return {
    name: 'FunctionsFetchError',
    message: 'The request timed out',
    code: 'external-unreachable',
    context: undefined,
  };
}

/**
 * Race `invocation` (a `supabase.functions.invoke(...)` promise) against a `timeoutMs` timer.
 *
 * - Resolves/rejects with the invoke's own outcome when it settles before the deadline (unchanged
 *   happy path — including an early rejection, which propagates as before).
 * - On timeout, resolves with `{ data: null, error: makeTimeoutInvokeError() }`. The in-flight invoke
 *   is left running; a LATE rejection is swallowed so it never becomes an unhandled rejection.
 */
export async function invokeWithTimeout<T>(
  invocation: Promise<InvokeLike<T>>,
  timeoutMs: number = DEFAULT_INVOKE_TIMEOUT_MS,
): Promise<InvokeLike<T>> {
  // Swallow a late rejection/resolution once the timer may have already won the race, so a hung-then-
  // failed invoke never surfaces as an unhandled rejection after we've moved on.
  invocation.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<InvokeLike<T>>((resolve) => {
    timer = setTimeout(() => resolve({ data: null, error: makeTimeoutInvokeError() }), timeoutMs);
  });

  try {
    return await Promise.race([invocation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
