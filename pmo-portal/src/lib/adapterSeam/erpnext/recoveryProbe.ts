/**
 * ADR-0057 §3 recovery probe (task 6.4) — "did ERP already commit this idempotency key?". Confined to
 * erpnext/** because it speaks Frappe REST vocabulary (`remarks`, `/api/resource`, doctype names). The
 * money dispatch above the contract (dispatch.ts `probeByRemarksKey`) calls an INJECTED probe closure;
 * this module is that closure's ERPNext body. Deterministic + stock-REST-only (no ERPNext idempotency
 * feature required): list doc `name`s whose stock `remarks` carries the key, adopt the first (at most
 * one exists), re-fetch it and map to the PMO canonical via the kind's `fromDoc`, stamping the PMO
 * record id so the adopted mirror keys correctly.
 */
import type { PmoRecord } from '../contract.ts';
import { getDoc, listDocNamesByRemarksKey, type ErpClientDeps } from './client.ts';

export interface ErpProbeDeps {
  client: ErpClientDeps;
  doctype: string;
  /** The kind's `DOCTYPE_BODIES.fromDoc` — maps the re-fetched ERP doc to the PMO canonical. */
  fromDoc: (doc: unknown) => PmoRecord;
  /** The PMO record id this command owns — stamped onto the adopted canonical so the read-model keys
   *  on the PMO id (never the ERP name), matching the create path (`adapter.ts` commitCreate). */
  pmoRecordId: string;
}

/**
 * Probe ERP for an orphaned commit stamped with `idempotencyKey`. Returns the adopted
 * `{ externalRecordId, canonical }` (canonical carries the ERP-derived fields via `fromDoc`, id
 * re-stamped to the PMO record id) or `null` when ERP holds no such doc — the signal for the dispatch
 * to POST a fresh create under the same outbox row.
 */
export async function probeErpByRemarksKey(
  deps: ErpProbeDeps,
  idempotencyKey: string,
): Promise<{ externalRecordId: string; canonical: PmoRecord } | null> {
  const names = await listDocNamesByRemarksKey(deps.client, deps.doctype, idempotencyKey, 1);
  if (names.length === 0) return null;
  const name = names[0];
  const doc = await getDoc(deps.client, deps.doctype, name);
  return { externalRecordId: name, canonical: { ...deps.fromDoc(doc), id: deps.pmoRecordId } };
}
