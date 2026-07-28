/**
 * drainSseStream — pipes an SSE event generator into a ReadableStreamDefaultController.
 * Extracted from index.ts's inline `ReadableStream.start()` body (review round 2026-07-28) so this
 * drain loop is unit-testable at all — mirrors this same plan's own D2 precedent (telegram-notify's
 * drain loop moved into logic.ts "so it can be unit-tested at all"). Pure/portable: no Deno globals,
 * importable from Vitest.
 *
 * Two invariants, both pre-existing and byte-for-byte unchanged by this extraction:
 *   - FR-AGP-016 client-disconnect continuation: a dropped socket (enqueue throw) stops trying to
 *     enqueue but keeps draining the generator to completion server-side, so persistence writes
 *     (journal/heartbeat/terminal-status) complete.
 *   - The stream is always closed in `finally`, tolerating an already-closed/errored controller.
 *
 * NEW invariant (review round 2026-07-28, "the net is not total"): a throw from the generator
 * itself happens AFTER the 200 response has already gone out — `ReadableStream.start()` runs
 * post-return — so `wrapWithErrorReporting`'s outer try/catch (around the Response the *handler*
 * returns) can never see it: truncated SSE, zero `error_events`, on the highest-traffic function in
 * the set. `onStreamError` is now always called on that path, even though the HTTP response itself
 * can no longer change (the 200 already shipped).
 */
import { encodeSse } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import type { AgentEvent } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';

export interface SseController {
  enqueue(chunk: Uint8Array): void;
  close(): void;
}

export async function drainSseStream(
  events: AsyncIterable<AgentEvent>,
  controller: SseController,
  onStreamError: (err: unknown) => void | Promise<void>,
): Promise<void> {
  const enc = new TextEncoder();
  let socketLive = true;
  try {
    for await (const ev of events) {
      if (!socketLive) continue; // keep draining for persistence; stop trying to enqueue
      try {
        controller.enqueue(enc.encode(encodeSse(ev)));
      } catch {
        // Dropped socket — stop enqueueing but keep the loop (and persistence) running.
        socketLive = false;
      }
    }
  } catch (err) {
    // A streaming handler must report inside its own stream — the outer serveWithErrorReporting
    // wrapper cannot see a post-response throw (docs/adr/0066 non-coverage note).
    await onStreamError(err);
  } finally {
    try {
      controller.close();
    } catch {
      // Already closed/errored (e.g. socket dropped) — nothing further to do.
    }
  }
}
