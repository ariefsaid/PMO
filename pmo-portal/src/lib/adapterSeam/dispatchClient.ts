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

/** A network failure (FunctionsFetchError) exposes NO HTTP Response on `.context` — the fetch was
 *  rejected (DNS / connection / refused), so the request never reached the edge fn. Distinguish from
 *  a FunctionsHttpError, which carries a `.context: Response` (a non-2xx status with a body). */
function hasHttpResponse(error: unknown): boolean {
  const ctx = (error as { context?: Response } | null | undefined)?.context;
  return !!ctx && typeof (ctx as Response).clone === 'function';
}

/**
 * Pure classification of a dispatch error into `{ code, message }` (review fix #5). The precedence:
 *   1. a KNOWN structured code from the body (`commit-rejected` | `external-unreachable`) wins;
 *   2. a NETWORK failure (no HTTP response on `.context`) → `external-unreachable` with a GENERIC
 *      message — the raw fetch string ('name resolution failed', 'Failed to send a request…') is
 *      NEVER surfaced to the user;
 *   3. otherwise (an HTTP failure with no/unknown structured code) → `undefined` code + the body's
 *      message (a controlled edge-fn message) or a generic fallback.
 * Pure + tested so the network path is pinned independently of the supabase singleton.
 */
export function classifyDispatchError(
  error: unknown,
  body: DispatchErrorBody | undefined,
): { code: string | undefined; message: string } {
  if (body?.error && KNOWN_CODES.has(body.error)) {
    return { code: body.error, message: body.message ?? 'The dispatch request failed' };
  }
  if (!hasHttpResponse(error)) {
    return { code: 'external-unreachable', message: 'The external system could not be reached' };
  }
  return { code: undefined, message: body?.message ?? 'The dispatch request failed' };
}

/** Options for a multi-domain dispatch (task 1.11, ADR-0057). `idempotencyKey` is minted by the
 *  caller (repository seam, task 1.10) for a non-read-only `erpnext`-tier money command — the served
 *  dispatch enforces its presence for that tier/operation combination (rejects a missing key as
 *  `commit-rejected`/`missing-idempotency-key`). P0 (reference) and P1 (ClickUp tasks) never pass it. */
export interface DispatchDomainCommandOptions {
  idempotencyKey?: string;
}

/** Shared transport: POST `functions/v1/adapter-dispatch` with `{ domain, operation, record[, idempotencyKey] }`.
 *  `idempotencyKey` is included in the body ONLY when supplied — an omitted options arg produces the
 *  exact pre-1.11 body shape (byte-for-byte for every existing caller). */
async function invokeDispatch(
  domain: string,
  operation: AdapterOperation,
  record: PmoRecord,
  options?: DispatchDomainCommandOptions,
): Promise<CommandResult> {
  const body: { domain: string; operation: AdapterOperation; record: PmoRecord; idempotencyKey?: string } = {
    domain,
    operation,
    record,
  };
  if (options?.idempotencyKey) body.idempotencyKey = options.idempotencyKey;
  const { data, error } = await supabase.functions.invoke<CommandResult>('adapter-dispatch', { body });
  if (error) {
    const errorBody = await readErrorBody(error);
    const { code, message } = classifyDispatchError(error, errorBody);
    throw new AppError(message, code);
  }
  if (!data) throw new AppError('The dispatch request returned no result');
  return data;
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
  return invokeDispatch('tasks', operation, record);
}

/**
 * Dispatch a command for ANY externally-owned domain (task 1.11, generalizes `dispatchTaskCommand`
 * for P2's `procurement`/`companies` — ADR-0055/ADR-0057). Same transport + error classification;
 * threads an optional `idempotencyKey` for the erpnext money path.
 */
export async function dispatchDomainCommand(
  domain: string,
  operation: AdapterOperation,
  record: PmoRecord,
  options?: DispatchDomainCommandOptions,
): Promise<CommandResult> {
  return invokeDispatch(domain, operation, record, options);
}
