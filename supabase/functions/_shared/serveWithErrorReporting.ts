/**
 * serveWithErrorReporting — the single entry point every edge function uses instead of Deno.serve
 * (ADR-0066 §2). It catches whatever the handler throws, reports it through reportEdgeError, and
 * returns a stable 500 -- so an UNHANDLED failure is recorded, not just the catches somebody
 * remembered to write (FR-OBS-001).
 *
 * A function's own inner try/catch still runs first and is unchanged; this is the outermost net —
 * but NOT A TOTAL ONE (review round 2026-07-28; also documented in ADR-0066's Consequences). Three
 * classes of failure are explicitly OUT OF this net's coverage:
 *
 *   1. Post-response / streaming failures. This wrapper only sees what the HANDLER RETURNS. A
 *      streaming handler that returns `new Response(stream, ...)` has already returned by the time
 *      `stream`'s `start()` runs — a throw inside `start()` (or any code that keeps running after
 *      the Response object was constructed) happens AFTER this catch has already exited and can
 *      never be seen here. RULE: a streaming handler must report inside its own stream (see
 *      agent-chat/sseStream.ts's `onStreamError`, the one shipped example).
 *   2. Module top-level init (the TDZ class that crashed a deployed worker, `049d1e2`, cited by
 *      ADR-0066 itself) — happens before `serveWithErrorReporting` is even called. Covered instead
 *      by `scripts/deno-boot-smoke-edge-fns.sh` (imports every entrypoint with `Deno.serve` stubbed
 *      and fails the build on any import-time throw), never by this wrapper.
 *   3. `Deno` genuinely absent at call time — `serveWithErrorReporting` now THROWS rather than
 *      silently no-op-ing (below), so this degrades to a loud crash, not a report.
 *
 * The catch/report logic lives in `wrapWithErrorReporting`, a pure `(req) => Promise<Response>` —
 * `Deno.serve` itself has no Deno global in Vitest (nor in pmo-portal's `tsc`, which type-checks this
 * file transitively via the vitest import graph), so the wrapper is factored out to stay unit-testable
 * (mirrors the codebase's existing testable-core + thin-Deno.serve-wiring pattern) and the `Deno`
 * reference is read off `globalThis` (mirrors errorEventSink.ts / posthogError.ts) rather than the
 * bare global, so `tsc --noEmit` (no Deno lib) and `deno check` both pass this same source.
 */
import { reportEdgeError } from './reportEdgeError.ts';
import type { EdgeFunctionName } from './errorLog.ts';

type DenoServeLike = { serve: (handler: (req: Request) => Response | Promise<Response>) => unknown };

export function wrapWithErrorReporting(
  fn: EdgeFunctionName,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      try {
        // The reporter must never cost the caller its response. recordErrorEvent /
        // errorEventSink.insert / capturePosthogException all self-swallow already, but
        // reportEdgeError's OWN machinery does not (e.g. createServiceRoleErrorEventSink's
        // Deno.env.get, or console.error itself, throwing) — without this catch, THAT throw
        // would reject this promise and the caller would lose its stable 500 (review round
        // 2026-07-28).
        await reportEdgeError({
          fn,
          errorCode: 'UNHANDLED_EDGE_ERROR',
          contextId: err instanceof Error ? err.name : 'unknown',
        });
      } catch {
        // Deliberately swallowed — see the comment above. There is no further surface to report
        // a reporter-failure-while-already-reporting-a-failure to; the 500 below is what matters.
      }
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
  const deno = (globalThis as { Deno?: DenoServeLike }).Deno;
  if (!deno) {
    // NOT A SILENT NO-OP (review round 2026-07-28): `deno?.serve(...)` used to swallow this —
    // no server, no thrown error, no log line. That is the exact green-by-absence class this PR
    // exists to kill. Safe to throw: every shipped edge fn calls this only inside a real Deno
    // runtime, and no Vitest suite calls `serveWithErrorReporting` (only the extracted
    // `wrapWithErrorReporting`), so this can only fire on a genuine misconfiguration.
    throw new Error(`serveWithErrorReporting('${fn}', …) called with no Deno runtime present`);
  }
  deno.serve(wrapWithErrorReporting(fn, handler));
}
