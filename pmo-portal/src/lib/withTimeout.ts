/**
 * Generic promise-vs-deadline race for FE mutation hooks (UI-freeze hardening).
 *
 * A `useMutation`'s `isPending`/`loading` state gates a dialog's Cancel/Esc/scrim-close
 * (see `ConfirmDialog`) and disables its confirm button for as long as `mutationFn`'s
 * awaited promise is pending. If the underlying call (a Supabase RPC, `.from(...).select()`,
 * an edge-function `invoke`, …) never settles — a stalled connection, a hung server, a
 * dropped response — the promise never resolves or rejects, so the dialog freezes forever
 * with no recovery path. `uploadTransport.ts`'s XHR `timeoutMs` (harden #5) fixed this for
 * uploads; `withTimeout` is the same fix generalized to any awaited promise.
 *
 * On timeout it rejects with an `AppError` carrying `REQUEST_TIMEOUT_CODE` — the same
 * `{ message, code }` shape every other repository-seam failure uses (`appError.ts`), so
 * `classifyMutationError` recognizes it (headline "Request timed out — try again.") and
 * `ConfirmDialog`/toast render it as an ordinary recoverable failure, never a crash or an
 * indefinitely-disabled button.
 *
 * Deliberately NOT an abort mechanism: the underlying promise (e.g. a Supabase client call)
 * keeps running in the background — `withTimeout` only stops the CALLER from waiting on it
 * forever. That is sufficient to unfreeze the UI; it does not cancel the network request.
 *
 * ⚑ NEVER wrap a `supabase.functions.invoke(...)` chain in this. That lane has its own
 * deadline — `src/lib/supabase/invokeWithTimeout.ts` — whose synthetic FunctionsFetchError
 * shape is load-bearing for classifyDispatchError / classifyM365InvokeError / the repository
 * `wrap`. Wrapping it again makes this (shorter) deadline pre-empt the inner one, so that
 * classification can never be reached.
 */
import { AppError } from './appError';

/** The `AppError.code` a timed-out `withTimeout` rejection carries — read by
 *  `classifyMutationError` to render a dedicated "Request timed out" headline. */
export const REQUEST_TIMEOUT_CODE = 'REQUEST_TIMEOUT';

/** Shared deadline for app promises that must not leave the UI waiting indefinitely. */
const DEFAULT_MUTATION_TIMEOUT_MS = 15_000;

/**
 * Races `promise` against the shared deadline.
 *
 * - If `promise` settles first, `withTimeout` resolves/rejects with exactly that outcome
 *   (the original error is passed through unchanged — no reclassification).
 * - If the deadline elapses first, `withTimeout` rejects with an `AppError` carrying
 *   `REQUEST_TIMEOUT_CODE` and a generic message.
 *
 * The deadline timer is always cleared once either promise settles, so a fast call leaves
 * no dangling timer.
 */
export function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('The request timed out', REQUEST_TIMEOUT_CODE));
    }, DEFAULT_MUTATION_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
