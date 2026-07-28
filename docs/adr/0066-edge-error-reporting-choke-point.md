# ADR-0066 — One error-reporting choke point for every edge function

- **Status:** Proposed (2026-07-25)
- **Spec:** `docs/specs/observability-analytics.spec.md` §3 (FR-OBS-001/002/003/010/011)
- **Supersedes nothing.** Extends ADR-0071-era observability floor (`0071_error_events.sql`).

## Context

22 edge functions are deployed. Only 4 of them produce `error_events` rows, and the
`EdgeFunctionName` union in `supabase/functions/_shared/errorLog.ts:22-27` enumerates only 5 —
so the other 17 *cannot* call `logStructuredError` without a type error. Every ERP/ClickUp/external
integration function — the ones that now perform money write-through — is in the unwired set.

Two failure modes compound:

1. **Nothing is recorded.** An `erpnext-sweep` or `adapter-dispatch` failure produces at most a
   free-text `console.error` in a function log nobody reads. 79 non-test `console.error` calls exist
   across the 22 directories.
2. **A quiet dashboard is indistinguishable from a broken recorder.** `recordErrorEvent`
   (`_shared/errorEvent.ts:39-50`) logs `ERROR_EVENT_INSERT_FAILED` to `console.error` and returns
   `void` regardless; 3 of the 4 producers call it un-awaited. Nothing counts or alerts on it.

The obvious fix — hand-edit every `catch` in 22 functions — is high-effort, unverifiable, and rots:
the 23rd function ships unwired and nobody notices, which is exactly how we got here.

## Decision

**1. `EdgeFunctionName` becomes a derived union over a single exported const array**, and a Vitest
test reads `supabase/functions/*/index.ts` from disk and asserts set equality with that array. Drift
between "deployed functions" and "functions that can log" becomes a test failure, not a silent gap.

**2. A single entry-point wrapper replaces every bare `Deno.serve` call.**

```ts
serveWithErrorReporting('erpnext-sweep', handler)   // instead of Deno.serve(handler)
```

The wrapper catches anything the handler throws, calls `reportEdgeError({ fn, errorCode })`, and
returns a 500 with a stable body. This covers **unhandled** throws, not just the catches somebody
remembered to write — which is what FR-OBS-001 actually asks for.

**3. A CI gate (`scripts/check-edge-fn-error-reporting.mjs`, wired into `npm run verify`) asserts
every `supabase/functions/*/index.ts` uses the wrapper and contains no bare `Deno.serve(`.** This is
the part that stops the 23rd function shipping unwired. It mirrors the existing
`scripts/check-edge-fn-test-binding.mjs` pattern.

**4. The `error_events` sink is reachable without a caller-supplied client.** `reportEdgeError`
accepts an optional injected `ErrorEventSupabaseLike` (existing producers keep passing their
service-role client, preserving the deputy invariant). When none is supplied it falls back to
`createServiceRoleErrorEventSink()` — a ~20-line `fetch`-based PostgREST writer over
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, implementing the *same structural interface*
`recordErrorEvent` already takes.

Chosen over constructing a `supabase-js` client in `_shared` because:

- it adds no dependency to functions that do not already import `supabase-js` (e.g. `health`);
- `recordErrorEvent` is reused verbatim — the structural interface is the seam that makes this free;
- it is trivially testable in Vitest by stubbing `globalThis.fetch`.

When the service key is absent, the sink is unavailable and `reportEdgeError` emits
`ERROR_EVENT_SINK_UNAVAILABLE` through `logStructuredError` — a *visible* degradation, never a
silent one.

**5. `recordErrorEvent` returns a result instead of `void`** (`{ ok: true } | { ok: false; code }`),
and `reportEdgeError` awaits it. On `ok: false` it forwards a distinct `ERROR_EVENT_INSERT_FAILED`
`$exception` to PostHog via the existing `capturePosthogException`. A broken error pipeline now
produces a countable signal on a surface outside the pipeline it is reporting on.

## Consequences

**Good**

- Coverage goes from 4/22 to 22/22 producers with a one-line change per function.
- Unhandled throws are captured, not only remembered catches.
- The gap cannot silently reopen: two CI gates (name-set equality, wrapper usage) hold it closed.
- `error_events` (Postgres, tenant-joinable, RLS-locked, retained on our terms) stays the system of
  record; PostHog stays the triage surface (spec §1.3). Neither replaces the other.

**Costs / risks**

- `_shared` now knows how to construct a service-role writer. Scope is deliberately one table
  (`error_events`), which `0071` already documents as service-role-only ops bookkeeping — not tenant
  business data. The deputy invariant (NFR-AAN-SEC-001) is about business data under a minted owner
  client and is unaffected.
- The wrapper's catch-all 500 changes the response body for previously-uncaught throws (they were
  already 500s from the runtime, with a different body). Existing per-function catches run first and
  are unchanged, so this only affects paths that were already crashing.
- `serveWithErrorReporting` runs at module scope for the 16 functions whose `Deno.serve` is
  top-level. That is exactly today's behaviour; the 6 `import.meta.main`-guarded functions keep
  their guard, so `scripts/check-edge-fn-test-binding.mjs` stays satisfiable.

**Non-coverage (review round 2026-07-28 — a net whose blind spots are undocumented gets trusted
beyond its reach, which is worse than no net, because it stops people looking):**

- **Post-response / streaming failures are NOT covered.** The wrapper only sees what the handler
  RETURNS; a streaming handler (`new Response(stream, ...)`) has already returned by the time the
  stream's `start()` runs, so a throw inside `start()` happens after the wrapper's catch has
  already exited and can never be seen. **Rule: a streaming handler must report inside its own
  stream.** `agent-chat/sseStream.ts`'s `drainSseStream(events, controller, onStreamError)` is the
  one shipped example — its own `catch` around the generator drain calls `reportEdgeError` with
  `UNHANDLED_STREAM_ERROR` directly, because `wrapWithErrorReporting` structurally cannot.
- **Module top-level init is NOT covered** — a throw during import (the exact TDZ class that
  crashed a deployed worker, `049d1e2`, cited in Context above) happens before
  `serveWithErrorReporting` is even called. Covered instead by
  `scripts/deno-boot-smoke-edge-fns.sh` (imports every entrypoint with `Deno.serve` stubbed, fails
  the build on any import-time throw) — a *different* gate, not this wrapper.
- **`Deno` absent at call time used to be silently uncovered** (`deno?.serve(...)` — no server, no
  thrown error, no log line: the exact green-by-absence class this whole ADR exists to kill).
  Closed 2026-07-28: `serveWithErrorReporting` now throws when `Deno` is absent, converting a
  silent no-op into a loud crash.

**Explicitly not decided here**

- Replacing the 79 free-text `console.error` calls with enum codes (FR-OBS-003) is a follow-on
  sweep. The wrapper gives coverage; the sweep gives aggregation quality.
- An operator UI over `error_events` — spec §3.4 declines it, and `0075_explicit_api_grants.sql:103-106`
  grants that would become live must be revoked first if that ever changes.
