/**
 * Stock picking recovery (AC-OSP-004, #1508): what Odoo holds for a stock document, found by its anchor alone and never by a
 * second `load`. The outbox calls it as the recovery probe of a command whose answer was lost:
 *
 *   - no anchor row  -> null (the dispatcher sends on a first claim and holds a quarantined row: absence is not proof);
 *   - two rows, another model, a missing target, another company, other locations, other moves, a cancelled or mismatched done
 *     picking -> a deterministic refusal, so the row is held for a person;
 *   - a done picking -> read back and judged against the document;
 *   - a draft, confirmed or assigned picking that matches the document -> validated here, then read back (a lost answer between
 *     `load` and the validate must not end in a hold with no way out);
 *   - a transport failure -> external-unreachable (retry later), never a hold.
 */
import { AdapterError, type PmoRecord } from '../../contract.ts';
import { toAdapterError } from '../connectAdapter.ts';
import type { OdooCall } from '../client.ts';
import { odooExternalRef, stockExternalIdentifier } from './anchors.ts';
import { completeStockPicking } from './picking.ts';
import { canonicalOfVerdict, judgePicking, probeHold, transferReferenceOf, type StockHold, type StockIntent } from './verdict.ts';

export interface StockHit {
  externalRecordId: string;
  canonical: PmoRecord;
}

/** The document to recover: its intent, or its id with a loader that runs only once an anchor is found (absence needs no Odoo reads of the document). */
export type StockRecoverySource = StockIntent | { documentId: string; load: () => Promise<StockIntent> };

export async function recoverStockPicking(call: OdooCall, source: StockRecoverySource, deadlineAtMs?: number): Promise<StockHit | null> {
  const guarded: OdooCall = async (model, method, body) => {
    try { return await call(model, method, body); } catch (err) { return toAdapterError(err); }
  };
  const { name } = stockExternalIdentifier(source.documentId);
  const rows = await guarded<Array<{ model: string; res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', 'pmo'], ['name', '=', name]], fields: ['model', 'res_id'], limit: 2,
  });
  if (rows.length === 0) return null;
  if (rows.length > 1 || rows[0].model !== 'stock.picking') throw probeHold('ambiguous-anchor', { cause: 'anchor-ambiguous' });
  const pickingId = rows[0].res_id;
  const heldOn = async (message: string, cause: StockHold['cause'], reference?: string | null) =>
    probeHold(message, { cause, pickingId, reference: reference ?? await transferReferenceOf(call, pickingId) });
  const intent = 'load' in source ? await source.load() : source;

  const first = await judgePicking(call, intent, pickingId);
  let verdict = first.verdict;
  if (!first.picking) throw probeHold('anchor-target-missing', { cause: 'anchor-missing', pickingId });
  if (verdict.state === 'held') throw await heldOn(verdict.exception ?? 'held-picking', verdict.holdCause ?? 'not-checked', verdict.externalReference);
  if (verdict.state === 'pending') {
    const done = await completeStockPicking(call, pickingId, intent.lines, deadlineAtMs);
    if (done.outcome === 'held') throw await heldOn(done.message, done.cause);
    if (done.outcome === 'unknown') throw new AdapterError('external-unreachable', done.message);
    verdict = (await judgePicking(call, intent, pickingId)).verdict;
    if (verdict.state === 'held') throw await heldOn(verdict.exception ?? 'held-picking', verdict.holdCause ?? 'not-checked', verdict.externalReference);
    if (verdict.state !== 'confirmed') throw new AdapterError('external-unreachable', 'The stock picking is not done after validation.');
  }
  return { externalRecordId: odooExternalRef('stock.picking', pickingId), canonical: canonicalOfVerdict(intent, verdict) };
}
