/**
 * watermark.ts — read/advance the dispatcher's poll watermark, one cursor per (event source,
 * organization) (ADR-0046 §2 as extended for the shared multi-tenant project, ADR-0101; FR-AAN-012/013).
 * Both functions take the injected service_role client — the
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

/** The result of reading one organization's cursor: the row's value (null = the organization has no
 * row yet for this source) plus whether the query itself failed. A failed read means the cursor
 * position is UNKNOWN — the caller must NOT treat that as "no row yet" and select from the
 * organization's start point, which would replay its whole backlog. */
export interface WatermarkReadResult {
  wm: Watermark | null;
  readFailed: boolean;
}

/** readWatermarkStatus — read the cursor for (`source`, `orgId`), distinguishing a real query error
 * from the legitimate "no row yet" first-tick case. With several organizations on one project
 * (ADR-0101), each organization keeps its own cursor per source: one organization's progress never
 * walks over another organization's event window (issue 2255), so an organization whose assistant
 * feature is briefly unreadable resumes exactly where it left off once it is readable again. */
export async function readWatermarkStatus(sb: ServiceClientLike, source: string, orgId: string): Promise<WatermarkReadResult> {
  const builder = sb.from('agent_dispatch_watermarks') as {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => PromiseLike<{
            data: { last_seen_id: string | null; last_seen_at: string | null } | null;
            error: unknown;
          }>;
        };
      };
    };
  };
  // Trimmed from '*' to match the declared return type {last_seen_id, last_seen_at} — type-honesty.
  const { data, error } = await builder.select('last_seen_id,last_seen_at').eq('source', source).eq('org_id', orgId).maybeSingle();
  // I-COLPROJ (2026-07-28 review): a real query error must be DISTINGUISHABLE from "no watermark row
  // yet" (the ordinary first-tick-for-this-source case) — they were previously coalesced (`error ||
  // !data`). Silently returning null on a REAL error is indistinguishable from "start from scratch",
  // so the next successful read passes a null cursor to select_trigger_events, which then re-selects
  // the ENTIRE event history — mass duplicate automation fires. Fail-safe is unchanged (still
  // returns null so the caller degrades to "no cursor" rather than throwing mid-tick); only the
  // visibility changes.
  if (error) {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'WATERMARK_READ_FAILED', contextId: `${source}:${orgId}` });
    return { wm: null, readFailed: true };
  }
  if (!data) return { wm: null, readFailed: false };
  return { wm: { lastSeenId: data.last_seen_id, lastSeenAt: data.last_seen_at }, readFailed: false };
}

/** readWatermark — the cursor for (`source`, `orgId`), or null if none yet (a failed read also
 * returns null: fail-safe, but the failure is visible in the logs and `readWatermarkStatus`
 * reports it explicitly to callers that must skip the organization instead of guessing). */
export async function readWatermark(sb: ServiceClientLike, source: string, orgId: string): Promise<Watermark | null> {
  return (await readWatermarkStatus(sb, source, orgId)).wm;
}

/**
 * advanceWatermark — upserts the watermark row for (`source`, `orgId`) to the given last-seen event.
 * Called AFTER a tick's batch succeeds (FR-AAN-013 monotonic-after-success — a failed tick must not skip
 * events). The row key is the table's (source, org_id) primary key, so each organization's cursor
 * moves only over its own attempted events (issue 2255).
 */
export async function advanceWatermark(
  sb: ServiceClientLike,
  source: string,
  orgId: string,
  seen: { id: string; at: string },
): Promise<void> {
  const builder = sb.from('agent_dispatch_watermarks') as {
    upsert: (row: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  const { error } = await builder.upsert({
    source,
    org_id: orgId,
    last_seen_id: seen.id,
    last_seen_at: seen.at,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'WATERMARK_ADVANCE_FAILED', contextId: `${source}:${orgId}` });
  }
}
