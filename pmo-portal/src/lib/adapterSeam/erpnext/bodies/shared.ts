/**
 * Shared body-mapping helpers (FR-ENA-042). Every submittable procurement doctype crashes ERPNext
 * with a raw, unhandled `500 TypeError` on empty/missing `items` (R9 §1 "Missing/empty items on PI
 * crashes 500 ... the client must pre-validate"); `requireItems` is the client-side pre-validation
 * guard shared by every `toBody` below, turning that crash into a clean `commit-rejected` BEFORE the
 * request is ever sent.
 */
import { AdapterError } from '../../contract.ts';
import type { PmoRecord } from '../../contract.ts';

/** A PMO-shaped procurement line item — the fields the R9-frozen bodies below read. Optional fields
 *  are doctype-specific (`schedule_date` for PO/MR, `po_item_child_name` for GR). */
export interface PmoLineItem {
  item_code: string;
  qty: number | string;
  rate?: number | string;
  schedule_date?: string;
  po_item_child_name?: string;
}

/** Reads `rec.items`, rejecting an empty/missing array as `commit-rejected` (never a blind POST that
 *  would crash ERPNext with a raw 500). */
export function requireItems(rec: PmoRecord, doctypeLabel: string): PmoLineItem[] {
  const items = rec.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new AdapterError('commit-rejected', `${doctypeLabel} requires at least one line item`);
  }
  return items as PmoLineItem[];
}
