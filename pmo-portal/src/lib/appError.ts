/**
 * Shared application error contract (ADR-0017, the API/repository seam).
 *
 * Generalizes the per-DAL `ProcurementError` / `TimesheetWriteError` pattern into a
 * single backend-agnostic error type the repository seam throws. It carries the
 * verbatim `message` plus an optional `code` — today a Postgres/PostgREST error
 * code (`P0001` illegal-state, `42501` not-permitted/SoD, `23505` duplicate, …) —
 * so the UI can classify a failure (see `classifyMutationError`) regardless of which
 * backend implementation produced it. A future (e.g. ERP/REST) repository adapter
 * maps its own error codes onto the same shape, so the FE never changes.
 *
 * Extends `Error`, so existing `err instanceof Error` / `.message` consumers keep
 * working unchanged.
 */
export class AppError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/**
 * ⚑ Luna FU-1a round-6 — the marker attached to a `command-held` AppError so the served handler can
 * record the mirror outcome against the EXACT outbox row + claim generation the hold was produced
 * under (a GENERATION-EXACT CAS). The hold is decided deep in the dispatch recovery
 * (`claimAndCommit` → `markOutboxHeld`) where the outbox id + fencing token are known; the mirror
 * outcome is written LATER, in the served fn's catch, in a separate transaction. Threading the exact
 * identity here is what lets `record_timesheet_command_held` fence on that precise row+generation
 * instead of an `EXISTS` heuristic — the heuristic a concurrent release or a successor approval
 * generation can defeat (the round-6 BLOCKs). Attached via a cast (like `SupersededDocumentMarker`),
 * so plain `.message`/`.code` consumers are unaffected.
 */
export interface CommandHeldOutboxMarker {
  heldOutboxId?: string;
  heldClaimGeneration?: number;
}

/**
 * Reads a structurally-present string `code` from an unknown thrown value.
 * Returns undefined when absent or non-string (e.g. a numeric HTTP status). This is
 * how the seam preserves the Postgres code carried by `ProcurementError` /
 * `TimesheetWriteError` / a raw PostgREST error object without depending on their classes.
 */
function readCode(err: unknown): string | undefined {
  const candidate = (err as { code?: unknown } | null | undefined)?.code;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Normalizes any thrown value into an `AppError`, preserving a string `.code` when
 * present and the verbatim message when the value is an `Error` or a PostgREST-shaped
 * `{ message, code }` plain object (the shape returned by Supabase client errors).
 * An already-`AppError` value is returned as-is (idempotent). Used by every repository
 * wrapper so callers always catch a single, code-bearing error type.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return new AppError(err.message, readCode(err));
  // PostgREST / Supabase client errors are plain objects { message: string, code?: string }
  // (not Error instances). Preserve message + code from that shape.
  if (err !== null && typeof err === 'object') {
    const obj = err as { message?: unknown; code?: unknown };
    const message = typeof obj.message === 'string' ? obj.message : 'An unexpected error occurred';
    const code = typeof obj.code === 'string' ? obj.code : undefined;
    return new AppError(message, code);
  }
  return new AppError('An unexpected error occurred');
}

/**
 * Guards against the silent-no-op class (#534): a `using`-denied RLS UPDATE/DELETE hides the
 * target row rather than erroring, so the statement affects 0 rows and `error` stays null — the
 * DAL would otherwise report success for a write that never happened. The call site appends
 * `.select('id')` to the mutation so PostgREST returns the rows it actually touched, then passes
 * that `data` here. An empty/null result throws a `42501` `AppError` (the same code a WITH CHECK
 * denial already surfaces), so every caller's existing `classifyMutationError` handling covers it
 * with no extra branching.
 */
export function assertWriteLanded(data: unknown[] | null | undefined, message: string): void {
  if (!data?.length) throw new AppError(message, '42501');
}
