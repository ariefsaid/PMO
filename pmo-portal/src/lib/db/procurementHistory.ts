/**
 * Procurement history-union model (Slice 5.6, [PD-4], FR-PR-025).
 *
 * Pure function over the already-loaded `ProcurementDetail` bundle — no fetch, no N+1
 * (NFR-PR-PERF-002). Unions two event streams:
 *
 * 1. **Transition events** — from `detail.statusEvents` (the `procurement_status_events`
 *    log appended by `transition_procurement` in Slice 4, [PD-7]). Each row carries
 *    `from_status → to_status`, `actor_id`, and `created_at`. These are real persisted
 *    events; NOT synthesized from terminal status stamps.
 *
 * 2. **Record events** — one event per child record (purchase_request, rfq, purchase_order,
 *    payment, quotation, receipt, invoice), keyed on `created_at` + the minted number.
 *    The actor field on record events is null (records carry no created_by column).
 *
 * Result is sorted ascending by `at` (stable sort — ties preserve stream order:
 * transitions first, then records within the same millisecond).
 *
 * `buildProgressionTimeline` (new) — transition-centric merge: the status-transition
 * events are the spine; each matching record is folded in as a `docRef`/`docHref`
 * annotation rather than a separate row. Produces ~one row per lifecycle event.
 */

import type { ProcurementDetail } from './procurementLifecycle';

/** A single event in the procurement progression history. */
export interface HistoryEvent {
  /** Discriminant: 'transition' = a status-machine step; 'record' = a new record created. */
  kind: 'transition' | 'record';
  /** Human-readable description of the event. */
  label: string;
  /** User id of the actor (transition events); null for record events. */
  actor: string | null;
  /** ISO 8601 timestamp the event occurred at. */
  at: string;
}

/**
 * A progression event — a `HistoryEvent` extended with optional document annotation.
 * Used by `buildProgressionTimeline` which folds records into their matching transitions.
 */
export interface ProgressionEvent extends HistoryEvent {
  /** System number of the associated document (e.g. "PO-2026-0077"), or null. */
  docRef: string | null;
  /**
   * Deep-link URL for the document. Falls back to `/procurement/:id/documents` when
   * the record has no `file_path` (none of the core record tables carry one directly).
   */
  docHref: string | null;
  /**
   * Resolved display name of the actor from the joined profiles row.
   * Null when there is no actor (record events or anonymous transitions).
   * NEVER the raw UUID — consumers must display this field, not `actor`.
   */
  actorName: string | null;
}

/**
 * Builds the ordered progression-history array from the already-loaded `ProcurementDetail`
 * bundle. Pure function — no side effects, no async. Safe to call in a React render.
 *
 * AC-PR-021: result length = (transition events) + (record-creation events), sorted by `at`.
 */
export function buildProcurementHistory(detail: ProcurementDetail): HistoryEvent[] {
  const events: HistoryEvent[] = [];

  // ── 1. Transition events from the persisted log ([PD-7]) ──────────────────
  for (const ev of detail.statusEvents ?? []) {
    const fromPart = ev.from_status ?? 'Created';
    const label = `${fromPart} → ${ev.to_status}`;
    events.push({
      kind: 'transition',
      label,
      actor: ev.actor_id ?? null,
      at: ev.created_at,
    });
  }

  // ── 2. Record-creation events ─────────────────────────────────────────────
  // New record types (Slice 1)
  for (const row of detail.purchase_requests ?? []) {
    events.push({
      kind: 'record',
      label: `Purchase Request ${row.pr_number ?? row.id}`,
      actor: null,
      at: row.created_at,
    });
  }

  for (const row of detail.rfqs ?? []) {
    events.push({
      kind: 'record',
      label: `RFQ ${row.rfq_number ?? row.id}`,
      actor: null,
      at: row.created_at,
    });
  }

  for (const row of detail.purchase_orders ?? []) {
    events.push({
      kind: 'record',
      label: `Purchase Order ${row.po_number ?? row.id}`,
      actor: null,
      at: row.created_at,
    });
  }

  for (const row of detail.payments ?? []) {
    events.push({
      kind: 'record',
      label: `Payment ${row.pay_number ?? row.id}`,
      actor: null,
      at: row.created_at,
    });
  }

  // Legacy record types (quotations / receipts / invoices).
  // Note: procurement_quotations has no created_at column; use received_date as the proxy
  // timestamp (or fall back to the case's created_at for stable sort when date is null).
  for (const row of detail.quotations ?? []) {
    events.push({
      kind: 'record',
      label: `Quotation ${row.vq_number ?? row.id}`,
      actor: null,
      at: row.received_date ?? detail.created_at,
    });
  }

  for (const row of detail.receipts ?? []) {
    events.push({
      kind: 'record',
      label: `Receipt ${row.gr_number ?? row.id}`,
      actor: null,
      at: row.created_at,
    });
  }

  for (const row of detail.invoices ?? []) {
    events.push({
      kind: 'record',
      label: `Invoice ${row.vi_number ?? row.id}`,
      actor: null,
      at: row.created_at,
    });
  }

  // ── 3. Sort ascending by timestamp (stable) ────────────────────────────────
  events.sort((a, b) => {
    if (a.at < b.at) return -1;
    if (a.at > b.at) return 1;
    return 0;
  });

  return events;
}

// ---------------------------------------------------------------------------
// Transition → record mapping (to_status → which record type carries the doc ref)
// ---------------------------------------------------------------------------

/** Maps a procurement `to_status` value to the record type that documents it. */
const STATUS_TO_RECORD_KIND = {
  Requested: 'purchase_request',
  'Vendor Quoted': 'rfq',
  'Quote Selected': 'quotation',
  Ordered: 'purchase_order',
  Received: 'receipt',
  'Vendor Invoiced': 'invoice',
  Paid: 'payment',
} as const;

type MappedStatus = keyof typeof STATUS_TO_RECORD_KIND;

function isMappedStatus(status: string): status is MappedStatus {
  return status in STATUS_TO_RECORD_KIND;
}

/** Picks the docRef (system#) from the record that matches a given to_status. */
function pickDocRef(
  toStatus: string,
  detail: ProcurementDetail,
  consumed: Set<string>,
): { docRef: string | null; consumedId: string | null } {
  if (!isMappedStatus(toStatus)) return { docRef: null, consumedId: null };

  const kind = STATUS_TO_RECORD_KIND[toStatus];

  switch (kind) {
    case 'purchase_request': {
      const row = (detail.purchase_requests ?? []).find((r) => !consumed.has(r.id));
      if (!row) return { docRef: null, consumedId: null };
      return { docRef: row.pr_number ?? null, consumedId: row.id };
    }
    case 'rfq': {
      const row = (detail.rfqs ?? []).find((r) => !consumed.has(r.id));
      if (!row) return { docRef: null, consumedId: null };
      return { docRef: row.rfq_number ?? null, consumedId: row.id };
    }
    case 'quotation': {
      const row = (detail.quotations ?? []).find((r) => !consumed.has(r.id));
      if (!row) return { docRef: null, consumedId: null };
      return { docRef: row.vq_number ?? null, consumedId: row.id };
    }
    case 'purchase_order': {
      const row = (detail.purchase_orders ?? []).find((r) => !consumed.has(r.id));
      if (!row) return { docRef: null, consumedId: null };
      return { docRef: row.po_number ?? null, consumedId: row.id };
    }
    case 'receipt': {
      const row = (detail.receipts ?? []).find((r) => !consumed.has(r.id));
      if (!row) return { docRef: null, consumedId: null };
      return { docRef: row.gr_number ?? null, consumedId: row.id };
    }
    case 'invoice': {
      const row = (detail.invoices ?? []).find((r) => !consumed.has(r.id));
      if (!row) return { docRef: null, consumedId: null };
      return { docRef: row.vi_number ?? null, consumedId: row.id };
    }
    case 'payment': {
      const row = (detail.payments ?? []).find((r) => !consumed.has(r.id));
      if (!row) return { docRef: null, consumedId: null };
      return { docRef: row.pay_number ?? null, consumedId: row.id };
    }
    default:
      return { docRef: null, consumedId: null };
  }
}

/**
 * Shape of a status event as returned by PostgREST when the actor profile is
 * embedded via `statusEvents:procurement_status_events(*, actor:profiles!procurement_status_events_actor_id_fkey(full_name))`.
 * PostgREST places the joined row under the alias key (`actor`), typed here so we can
 * read `full_name` without a cast.  We intersect with the base Tables row rather than
 * extending it so the rest of `ProcurementDetail.statusEvents` stays assignable.
 */
type StatusEventWithActor = {
  actor_id: string | null;
  created_at: string;
  to_status: string;
  /** Joined profile row — null when actor_id is null or profile not found. */
  actor?: { full_name: string } | null;
};

/** Extracts the resolved actor display name from a joined status-event row. */
function resolveActorName(ev: StatusEventWithActor): string | null {
  // If the profile join was embedded and full_name is present, use it.
  if (ev.actor && ev.actor.full_name) return ev.actor.full_name;
  // No actor at all.
  return null;
}

/**
 * Builds the de-noised progression timeline for the Overview bento.
 *
 * The primary spine is the `statusEvents` log (one row per lifecycle transition).
 * Each transition that has a matching record folds the record's system number in as
 * a `docRef` annotation — instead of creating a separate "record created" row.
 * Orphan records (no matching transition consumed them) are appended as their own rows.
 *
 * Sorting: transition events sort by their `created_at` (that IS the business moment);
 * orphan record events sort by the record's business `date` field (the document date),
 * falling back to `created_at` only when `date` is null. This prevents seed-inserted
 * records (whose `created_at` = "today") from floating above earlier real transitions.
 *
 * Output is sorted ASCENDING by `at` (the component reverses to newest-first for display).
 * The component then caps at 6 and offers an expander for earlier events.
 *
 * AC-PR-PROG-001..006, AC-PR-PROG-012..015.
 */
export function buildProgressionTimeline(
  detail: ProcurementDetail,
  procurementId: string,
): ProgressionEvent[] {
  const events: ProgressionEvent[] = [];
  const docsBase = `/procurement/${procurementId}/documents`;
  // Track which record IDs have been folded into a transition (consumed)
  const consumed = new Set<string>();

  // ── 1. Transition events (the spine) — fold in the matching record ─────────
  for (const ev of detail.statusEvents ?? []) {
    const evTyped = ev as unknown as StatusEventWithActor;
    const { docRef, consumedId } = pickDocRef(ev.to_status, detail, consumed);
    if (consumedId) consumed.add(consumedId);

    events.push({
      kind: 'transition',
      label: ev.to_status,
      actor: ev.actor_id ?? null,
      actorName: resolveActorName(evTyped),
      at: ev.created_at,
      docRef: docRef,
      docHref: docRef ? docsBase : null,
    });
  }

  // ── 2. Orphan records — not consumed by any transition above ───────────────
  // Business-date sort: use the record's `date` column (the document date) as
  // the sort key so records with old business dates sort chronologically even
  // when their `created_at` (seed insert time) is recent.

  for (const row of detail.purchase_requests ?? []) {
    if (consumed.has(row.id)) continue;
    events.push({
      kind: 'record',
      label: 'PR',
      actor: null,
      actorName: null,
      at: row.date ?? row.created_at,
      docRef: row.pr_number ?? null,
      docHref: docsBase,
    });
  }

  for (const row of detail.rfqs ?? []) {
    if (consumed.has(row.id)) continue;
    events.push({
      kind: 'record',
      label: 'RFQ',
      actor: null,
      actorName: null,
      at: row.date ?? row.created_at,
      docRef: row.rfq_number ?? null,
      docHref: docsBase,
    });
  }

  for (const row of detail.quotations ?? []) {
    if (consumed.has(row.id)) continue;
    events.push({
      kind: 'record',
      label: 'Quote',
      actor: null,
      actorName: null,
      at: row.received_date ?? detail.created_at,
      docRef: row.vq_number ?? null,
      docHref: docsBase,
    });
  }

  for (const row of detail.purchase_orders ?? []) {
    if (consumed.has(row.id)) continue;
    events.push({
      kind: 'record',
      label: 'PO',
      actor: null,
      actorName: null,
      at: row.date ?? row.created_at,
      docRef: row.po_number ?? null,
      docHref: docsBase,
    });
  }

  for (const row of detail.receipts ?? []) {
    if (consumed.has(row.id)) continue;
    // procurement_receipts uses receipt_date as the business date
    events.push({
      kind: 'record',
      label: 'GR',
      actor: null,
      actorName: null,
      at: row.receipt_date ?? row.created_at,
      docRef: row.gr_number ?? null,
      docHref: docsBase,
    });
  }

  for (const row of detail.invoices ?? []) {
    if (consumed.has(row.id)) continue;
    // procurement_invoices uses invoice_date as the business date
    events.push({
      kind: 'record',
      label: 'Invoice',
      actor: null,
      actorName: null,
      at: row.invoice_date ?? row.created_at,
      docRef: row.vi_number ?? null,
      docHref: docsBase,
    });
  }

  for (const row of detail.payments ?? []) {
    if (consumed.has(row.id)) continue;
    events.push({
      kind: 'record',
      label: 'Payment',
      actor: null,
      actorName: null,
      at: row.date ?? row.created_at,
      docRef: row.pay_number ?? null,
      docHref: docsBase,
    });
  }

  // ── 3. Sort ascending by timestamp (stable) ────────────────────────────────
  events.sort((a, b) => {
    if (a.at < b.at) return -1;
    if (a.at > b.at) return 1;
    return 0;
  });

  return events;
}
