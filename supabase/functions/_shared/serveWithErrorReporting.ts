/**
 * serveWithErrorReporting — the single entry point every edge function uses instead of Deno.serve
 * (ADR-0066 §2). It catches whatever the handler throws, reports it through reportEdgeError, and
 * returns a stable 500 -- so an UNHANDLED failure is recorded, not just the catches somebody
 * remembered to write (FR-OBS-001).
 *
 * A function's own inner try/catch still runs first and is unchanged; this is the outermost net.
 * `scripts/check-edge-fn-error-reporting.mjs` (wired into `npm run verify`) makes bypassing this
 * wrapper a build failure.
 *
 * The catch/report logic lives in `wrapWithErrorReporting`, a pure `(req) => Promise<Response>` —
 * `Deno.serve` itself has no Deno global in Vitest, so the wrapper is factored out to stay
 * unit-testable (mirrors the codebase's existing testable-core + thin-Deno.serve-wiring pattern).
 */
import { reportEdgeError } from './reportEdgeError.ts';
import type { EdgeFunctionName } from './errorLog.ts';

export function wrapWithErrorReporting(
  fn: EdgeFunctionName,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      await reportEdgeError({
        fn,
        errorCode: 'UNHANDLED_EDGE_ERROR',
        contextId: err instanceof Error ? err.name : 'unknown',
      });
      return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

export function serveWithErrorReporting(
  fn: EdgeFunctionName,
  handler: (req: Request) => Response | Promise<Response>,
): void {
  Deno.serve(wrapWithErrorReporting(fn, handler));
}
