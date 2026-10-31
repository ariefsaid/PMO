/**
 * Shared error normalization for the repository seam (ADR-0017). Every repository
 * wrapper funnels DAL/edge failures through `wrap` / `throwInvokeError` so consumers
 * catch a single, code-bearing `AppError` regardless of backend.
 */
import { toAppError, AppError } from '@/src/lib/appError';

/** Runs a DAL call and rethrows any failure as a normalized `AppError` (code preserved). */
export async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toAppError(err);
  }
}

/** `FunctionsHttpError` carries the edge fn's JSON body on `.context: Response` but never parses it —
 *  the same pattern as `m365/connectClient.ts`, `db/adminUsers.ts` and `adapterSeam/dispatchClient.ts`.
 *  Without this the admin sees "Edge Function returned a non-2xx status code" instead of the reason.
 *  (#650 AC-EAC-115: the Company-selection refusal reasons must reach the Company dialog.) */
export async function throwInvokeError(
  error: unknown,
  decorate?: (appError: AppError, body: unknown) => void,
): Promise<never> {
  const context = (error as { context?: Response } | null | undefined)?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string };
      if (typeof body.message === 'string' && body.message.trim() !== '') {
        const appError = new AppError(body.message, body.error);
        decorate?.(appError, body);
        throw appError;
      }
    } catch (parsed) {
      if (parsed instanceof AppError) throw parsed;
    }
  }
  throw toAppError(error);
}
