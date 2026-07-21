/**
 * inFlightAnchorProbe — the SHARED "does an unresolved outbox row own this ERP document?" barrier.
 *
 * Extracted from `erpnext-sweep/index.ts` (round-7 B5) so BOTH inbound-adopt paths raise the IDENTICAL
 * barrier: the modified-poll sweep (its original home) AND the webhook (round-9 FIX 1). A document whose
 * anchor field carries the idempotency key of an UNRESOLVED outbox row for this org is NOT an
 * inbound-adopt candidate — it belongs to a PMO-originated command still inside the ADR-0058 recovery
 * algorithm, and the outbox finalization maps that ERP name to the ORIGINAL PMO record id. Adopting it
 * mints a SECOND PMO row for the ONE ERP document (revenue double-counted) AND wedges the dispatch's own
 * fenced `record_outbox_ref` on the `unique (org_id, domain, external_record_id)` constraint (0093).
 *
 * EDGE-FN WIRING (needs the real supabase-js client), not pure logic — lives in `_shared/`, carries no
 * Frappe doctype/field vocabulary (the caller supplies the already-read anchor VALUE). Deno-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

/**
 * The outbox states whose row may correspond to an ERP document that EXISTS but is NOT yet mapped to
 * its PMO record — the ONLY rows the pull-adopt guard has to know about (round-6 re-audit, finding 1).
 *
 * Why `failed` is excluded and that is SAFE: `dispatch.ts` marks a row `failed` ONLY on a
 * NON-retryable adapter error — i.e. ERP explicitly REFUSED the write, so no ERP document carries that
 * idempotency key. An ambiguous/lost outcome is retryable and deliberately marks NOTHING (the row
 * stays `committing`), and a human "try again" re-claims a `failed` row back to `committing` before
 * any POST. So every state in which an ERP doc can exist un-mapped is guarded here.
 *
 * `confirmed` stays out for the original reason: its `external_refs` mapping exists, so the poll
 * resolves rather than adopts (and must keep applying that doc's updates). The webhook's own guard
 * relies on this too — a legitimately-later webhook for an already-confirmed dispatch is NOT blocked.
 */
export const IN_FLIGHT_OUTBOX_STATES = ['pending', 'committing', 'committed', 'quarantined', 'held'] as const;

/**
 * Every UUID appearing in an anchor value. The idempotency key of an ERPNext money command is ALWAYS a
 * UUID — `adapter-dispatch/index.ts` rejects a non-UUID key (`isOpaqueIdempotencyKey`) before any ERP
 * write, precisely so a short key cannot substring-match an unrelated document. So extracting the UUIDs
 * from a document's anchor field yields the complete set of keys that document could possibly carry,
 * and the guard can ask the outbox about exactly those instead of scanning the whole table.
 */
export const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Answers, for ONE candidate document's anchor value, "does an unresolved outbox row own this?" */
export type InFlightAnchorProbe = (anchorValue: string) => Promise<boolean>;

/**
 * BLOCK 1 (the double-adoption fix), rebuilt as a real barrier — round-7 cross-family audit, B5.
 *
 * No snapshot and no cap. Each candidate is checked WHEN IT IS SEEN, with an existence query keyed on
 * the UUIDs in that document's OWN anchor value — a bounded `in (…)` of at most a handful of keys, which
 * PostgREST's `max_rows` cannot truncate and staleness cannot affect. Correctness rests on ADR-0058
 * §2's ordering: the outbox row is INSERTED BEFORE the ERP POST, so a visible ERP document always has
 * its row already present.
 *
 * The per-tick memo is safe in both directions: a key it caches as in-flight only makes the guard more
 * conservative for the rest of the tick (the document is adopted on a later tick), and a key it caches
 * as unknown was proven to have no outbox row at a moment the document already existed — which, by the
 * insert-before-POST ordering, means the document is native.
 *
 * Fails CLOSED on a read error: sweeping/adopting with a blind guard is what duplicated money rows.
 */
export function createInFlightAnchorProbe(serviceClient: SupabaseClient, orgId: string): InFlightAnchorProbe {
  const memo = new Map<string, boolean>();
  return async (anchorValue: string): Promise<boolean> => {
    const keys = Array.from(new Set(anchorValue.match(UUID_IN_TEXT) ?? [])).map((k) => k.toLowerCase());
    if (keys.length === 0) return false; // a native ERP document carries no stamped key — nothing to ask.
    const unknown = keys.filter((k) => !memo.has(k));
    if (unknown.length > 0) {
      const { data, error } = await serviceClient.from('external_command_outbox')
        .select('idempotency_key')
        .eq('org_id', orgId)
        .in('state', IN_FLIGHT_OUTBOX_STATES as unknown as string[])
        .in('idempotency_key', unknown);
      if (error) throw new AppError(error.message, error.code);
      const found = new Set(((data as Array<{ idempotency_key: string }> | null) ?? []).map((r) => r.idempotency_key));
      for (const key of unknown) memo.set(key, found.has(key));
    }
    return keys.some((k) => memo.get(k) === true);
  };
}
