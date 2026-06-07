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
 * present and the verbatim message when the value is an `Error`. An already-`AppError`
 * value is returned as-is (idempotent). Used by every repository wrapper so callers
 * always catch a single, code-bearing error type.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return new AppError(err.message, readCode(err));
  return new AppError('An unexpected error occurred');
}
