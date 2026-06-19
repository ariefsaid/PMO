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
