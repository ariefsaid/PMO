/**
 * erpnext/webhookEvent.ts (task 8.2 helper) — the confined pure decoder for the inbound ERPNext
 * webhook payload → the feed event shape. Frappe's webhook envelope (configured with `webhook_json`)
 * carries the document under `data` (and a top-level `doctype`/`name`); this module reads those fields
 * and resolves the PMO `erp_doc_kind` + `domain` via `feedKinds.kindFromDoctype`. An unmapped doctype
 * (a doctype P2 does not mirror) decodes to `kind === undefined` — the edge fn ack's-and-skips it
 * (lossy hint, FR-ENA-083). Pure + portable; Frappe vocabulary confined here + feedKinds (FR-ENA-013).
 */
import { kindFromDoctype, externalIdForKind, KIND_DOMAIN, type ErpDocKind } from './feedKinds.ts';

/** The decoded feed event — what applyErpFeedEvent + the edge fn consume. */
export interface ErpFeedEvent {
  /** The Frappe doctype name (e.g. 'Purchase Invoice') — kept for diagnostics. */
  doctype: string;
  /** The PMO `erp_doc_kind` (PMO verb) — `undefined` for a doctype P2 does not mirror (skip). */
  kind: ErpDocKind | undefined;
  /** The PMO domain (`'companies'|'procurement'`) — `undefined` when `kind` is undefined. */
  domain: 'companies' | 'procurement' | undefined;
  /** The ERP `name` (the external record id source). */
  erpName: string;
  /** The externalRecordId the feed resolves `external_refs` by (`Supplier:<name>` for parties). */
  externalRecordId: string;
  /** Frappe `modified` — the per-row source-mod cursor string. */
  modified: string;
  /** Frappe `docstatus` (0 Draft / 1 Submitted / 2 Cancelled). */
  docstatus: number | null;
  /** Frappe `amended_from` — the OLD name when this doc is an amended successor (else null). */
  amendedFrom: string | null;
  /** The raw ERP `doc` — the kind's `fromDoc` maps it to the PMO canonical at apply time. */
  doc: unknown;
}

interface FrappeWebhookPayload {
  doctype?: unknown;
  name?: unknown;
  doc?: unknown;
  data?: unknown;
  modified?: unknown;
}

/** Reads a scalar from the Frappe envelope, preferring the top-level field then the `doc`/`data` body. */
function fieldOf(payload: FrappeWebhookPayload, key: string): unknown {
  const top = (payload as Record<string, unknown>)[key];
  if (top !== undefined && top !== null) return top;
  const body = (payload.doc ?? payload.data) as Record<string, unknown> | null | undefined;
  return body?.[key];
}

function str(v: unknown): string | null {
  return v === null || v === undefined || v === '' ? null : String(v);
}

function docstatusOf(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  return typeof v === 'number' ? v : Number(v);
}

/**
 * Decode a Frappe webhook payload into a feed event. `kind`/`domain` are `undefined` for a doctype P2
 * does not mirror (the caller ack's-and-skips). Returns `null` when the payload carries no resolvable
 * `doctype` + `name` (malformed — a faithful skip, not a crash). The `doc` body is whatever Frappe
 * carried under `doc`/`data` (the kind's `fromDoc` maps it at apply time).
 */
export function decodeErpWebhookEvent(raw: unknown): ErpFeedEvent | null {
  const payload = raw as FrappeWebhookPayload;
  const doctype = str(fieldOf(payload, 'doctype'));
  const erpName = str(fieldOf(payload, 'name'));
  if (!doctype || !erpName) return null;
  const kind = kindFromDoctype(doctype);
  const domain = kind ? KIND_DOMAIN[kind] : undefined;
  const externalRecordId = kind ? externalIdForKind(kind, erpName) : erpName;
  return {
    doctype,
    kind,
    domain,
    erpName,
    externalRecordId,
    modified: str(fieldOf(payload, 'modified')) ?? new Date(0).toISOString(),
    docstatus: docstatusOf(fieldOf(payload, 'docstatus')),
    amendedFrom: str(fieldOf(payload, 'amended_from')),
    doc: payload.doc ?? payload.data ?? null,
  };
}
