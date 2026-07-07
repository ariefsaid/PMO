/**
 * watermark.ts — read/advance the dispatcher's per-source poll watermark (ADR-0044 §2, ADR-0046,
 * FR-AAN-012/013). Both functions take the injected service_role client — the
 * agent_dispatch_watermarks table has no RLS policy (default-deny), so only the service_role client
 * (which bypasses RLS) can reach it. Pure, importable in Vitest (REC-1).
 */

import { logStructuredError } from '../_shared/errorLog.ts';

export interface Watermark {
  lastSeenId: string | null;
  lastSeenAt: string | null;
}

export interface ServiceClientLike {
  from: (table: string) => unknown;
}

/** readWatermark — the last-seen event id/created_at recorded for `source`, or null if none yet. */
export async function readWatermark(sb: ServiceClientLike, source: string): Promise<Watermark | null> {
  const builder = sb.from('agent_dispatch_watermarks') as {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => PromiseLike<{
          data: { last_seen_id: string | null; last_seen_at: string | null } | null;
          error: unknown;
        }>;
      };
    };
  };
  const { data, error } = await builder.select('*').eq('source', source).maybeSingle();
  if (error || !data) return null;
  return { lastSeenId: data.last_seen_id, lastSeenAt: data.last_seen_at };
}

/**
 * advanceWatermark — upserts the watermark row for `source` to the given last-seen event. Called
 * AFTER a tick's batch succeeds (FR-AAN-013 monotonic-after-success — a failed tick must not skip
 * events).
 */
export async function advanceWatermark(
  sb: ServiceClientLike,
  source: string,
  seen: { id: string; at: string },
): Promise<void> {
  const builder = sb.from('agent_dispatch_watermarks') as {
    upsert: (row: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  const { error } = await builder.upsert({
    source,
    last_seen_id: seen.id,
    last_seen_at: seen.at,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'WATERMARK_ADVANCE_FAILED', contextId: source });
  }
}
