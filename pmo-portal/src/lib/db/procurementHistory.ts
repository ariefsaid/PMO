/**
 * Procurement progression timeline shapes (Slice 5.6, [PD-4], FR-PR-025).
 *
 * The timeline itself is read from the server; these are the view types the Overview
 * and its timeline component render.
 */

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
