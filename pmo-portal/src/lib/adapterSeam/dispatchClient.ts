/**
 * The FE transport for an externally-owned task write (ADR-0056, FR-CUA-022/023/024): invokes the
 * `adapter-dispatch` edge function with a PMO-domain-language command and maps a failure onto the
 * shared `AppError` code vocabulary (`commit-rejected` | `external-unreachable`) the rest of the
 * app already classifies via `classifyMutationError`/`classifyExternalError`. Browser-only (the FE
 * `supabase` singleton) — relative imports kept for consistency with the adapterSeam directory.
 */
import { supabase } from '../supabase/client.ts';
import { AppError } from '../appError.ts';
import type { AdapterOperation, CommandResult, PmoRecord } from './contract.ts';

interface DispatchErrorBody {
  error?: string;
  message?: string;
}

const KNOWN_CODES = new Set(['commit-rejected', 'external-unreachable']);

/**
 * Reads the edge function's JSON error body off a `FunctionsHttpError`'s `.context` Response
 * (the same pattern as `admin-invite-user` in `db/adminUsers.ts` — `FunctionsHttpError` doesn't
 * parse the body itself). Returns `undefined` when there is no context or the body isn't JSON.
 */
async function readErrorBody(error: unknown): Promise<DispatchErrorBody | undefined> {
  const context = (error as { context?: Response } | null | undefined)?.context;
  if (!context || typeof context.clone !== 'function') return undefined;
  try {
    return (await context.clone().json()) as DispatchErrorBody;
  } catch {
    return undefined;
  }
}

/**
 * Dispatch a task command through `adapter-dispatch` (POST `functions/v1/adapter-dispatch`,
 * `{ domain: 'tasks', operation, record }`). Resolves with the edge function's `CommandResult`
 * (external id + canonical PMO record) on success; throws an `AppError` — code `commit-rejected`
 * or `external-unreachable` when the edge function classified it, otherwise the raw message —
 * on failure.
 */
export async function dispatchTaskCommand(
  operation: AdapterOperation,
  record: PmoRecord,
): Promise<CommandResult> {
  const { data, error } = await supabase.functions.invoke<CommandResult>('adapter-dispatch', {
    body: { domain: 'tasks', operation, record },
  });
  if (error) {
    const body = await readErrorBody(error);
    const code = body?.error && KNOWN_CODES.has(body.error) ? body.error : undefined;
    const message = body?.message ?? (error as { message?: string }).message ?? 'The dispatch request failed';
    throw new AppError(message, code);
  }
  if (!data) throw new AppError('The dispatch request returned no result');
  return data;
}
