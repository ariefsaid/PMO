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
import { AppError } from '../../../appError.ts';
import { toAdapterError } from '../connectAdapter.ts';
import type { OdooCall } from '../client.ts';
import { externalIdentifier, odooExternalRef } from '../purchase/anchors.ts';
import { evaluateStockEvidence, type StockEvidenceVerdict } from './evidence.ts';
import { completeStockPicking } from './picking.ts';
import { readStockEvidence } from './readBack.ts';
import type { StockIntent } from './stockAdapter.ts';

export interface StockHit {
  externalRecordId: string;
  canonical: PmoRecord;
}

/** The record the mirror writer reads: the document id and company beside Odoo's own verdict. */
export const canonicalOfVerdict = (intent: StockIntent, verdict: StockEvidenceVerdict): PmoRecord =>
  ({ id: intent.documentId, kind: intent.kind, companyId: intent.companyId, ...verdict });

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** Read what Odoo holds for the picking and judge it against the document; a read that fails is a retry, not a verdict. */
export async function judgePicking(call: OdooCall, intent: StockIntent, pickingId: number): Promise<{ picking: boolean; verdict: StockEvidenceVerdict }> {
  const read = await readStockEvidence(call, pickingId, intent.kind === 'issue' ? { analyticAccountId: intent.analyticAccountId } : {});
  if (!read.ok) throw new AdapterError('external-unreachable', read.message);
  return { picking: read.read.picking !== null, verdict: evaluateStockEvidence(intent, read.read) };
}

/** The document to recover: its intent, or its id with a loader that runs only once an anchor is found (absence needs no Odoo reads of the document). */
export type StockRecoverySource = StockIntent | { documentId: string; load: () => Promise<StockIntent> };

export async function recoverStockPicking(call: OdooCall, source: StockRecoverySource, deadlineAtMs?: number): Promise<StockHit | null> {
  const guarded: OdooCall = async (model, method, body) => {
    try { return await call(model, method, body); } catch (err) { return toAdapterError(err); }
  };
  const { name } = externalIdentifier(`stock:${source.documentId}`);
  const rows = await guarded<Array<{ model: string; res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', 'pmo'], ['name', '=', name]], fields: ['model', 'res_id'], limit: 2,
  });
  if (rows.length === 0) return null;
  if (rows.length > 1 || rows[0].model !== 'stock.picking') refuse('ambiguous-anchor');
  const pickingId = rows[0].res_id;
  const intent = 'load' in source ? await source.load() : source;

  const first = await judgePicking(call, intent, pickingId);
  let verdict = first.verdict;
  if (!first.picking) refuse('anchor-target-missing');
  if (verdict.state === 'held') refuse(verdict.exception ?? 'held-picking');
  if (verdict.state === 'pending') {
    const done = await completeStockPicking(call, pickingId, intent.lines, deadlineAtMs);
    if (done.outcome === 'held') refuse(done.message);
    if (done.outcome === 'unknown') throw new AdapterError('external-unreachable', done.message);
    verdict = (await judgePicking(call, intent, pickingId)).verdict;
    if (verdict.state === 'held') refuse(verdict.exception ?? 'held-picking');
    if (verdict.state !== 'confirmed') throw new AdapterError('external-unreachable', 'The stock picking is not done after validation.');
  }
  return { externalRecordId: odooExternalRef('stock.picking', pickingId), canonical: canonicalOfVerdict(intent, verdict) };
}

/** The command-held error a post-anchor refusal raises (the dispatcher holds the row and records the reason). */
export const heldError = (message: string, transferReference?: string | null): AppError =>
  Object.assign(new AppError(message, 'command-held'), { transferReference: transferReference ?? null });

/** The transfer's own reference (e.g. WH/INT/00012) for a person to find it in Odoo; a failed read just leaves it out. */
export async function transferReferenceOf(call: OdooCall, pickingId: number): Promise<string | null> {
  try {
    const rows = await call<Array<{ name?: unknown }>>('stock.picking', 'read', { ids: [pickingId], fields: ['name'] });
    return typeof rows?.[0]?.name === 'string' ? rows[0].name : null;
  } catch { return null; }
}
