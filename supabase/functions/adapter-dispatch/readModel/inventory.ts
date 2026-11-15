/**
 * The stock document's read-model writer (#1508). A confirmed Odoo picking converges in two fenced steps, in this order:
 * (1) the evidence mirror (`write_stock_erp_mirror`, fenced on the outbox row's claim generation), then (2) the Draft → Posted flip
 * with the stored actor as poster (0879's document guard accepts it only when that mirror is confirmed). A replay finds the document
 * already Posted (0 rows) and converges. A `STK_*` refusal is classified, never retried: `stock-actor-refused` (403) or `stock-command-refused` (422).
 */
import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import { ODOO_TIER } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { INVENTORY_DOMAIN } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/stock/constants.ts';
import { writeOdooStockMirror, type StockMirrorClient } from '../../_shared/odooStockMirror.ts';
import type { StockEvidenceVerdict } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/stock/evidence.ts';
import type { ReadModelWriter } from './types.ts';

/** `STK_ACTOR` (not an active member) and `STK_NOT_KEEPER` (not this warehouse's keeper) are about the caller: 403. Every other `STK_*` is a rule on the document: 422. */
export function stockRefusal(message: string, code?: string): AppError {
  if (/STK_ACTOR|STK_NOT_KEEPER/.test(message)) return new AppError(message, 'stock-actor-refused');
  if (/STK_/.test(message)) return new AppError(message, 'stock-command-refused');
  return new AppError(message, code);
}

/** The verdict the adapter stored in the outbox row's canonical record (`canonicalOfVerdict`). */
export function verdictOfCanonical(canonical: Record<string, unknown>): StockEvidenceVerdict {
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    state: canonical.state as StockEvidenceVerdict['state'],
    externalModel: text(canonical.externalModel), externalId: text(canonical.externalId), externalReference: text(canonical.externalReference),
    completedQuantity: num(canonical.completedQuantity), completedValue: num(canonical.completedValue),
    currency: text(canonical.currency), sourceWrittenAt: text(canonical.sourceWrittenAt), exception: text(canonical.exception), holdCause: null,
  };
}

export const inventoryWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const documentId = String(command.record.id);
    const verdict = verdictOfCanonical(canonical);
    if (verdict.state !== 'confirmed') throw new AppError('stock-evidence-not-confirmed', 'commit-rejected');
    // A committed or confirmed row cannot be reclaimed, so its generation and actor read here are exact.
    const { data, error } = await ctx.serviceClient.from('external_command_outbox').select('claim_generation,actor_user_id,state,payload')
      .eq('org_id', ctx.orgId).eq('domain', INVENTORY_DOMAIN).eq('external_tier', ODOO_TIER).eq('pmo_record_id', documentId).maybeSingle();
    if (error) throw stockRefusal(error.message, error.code);
    const row = data as { claim_generation?: unknown; actor_user_id?: unknown; state?: unknown; payload?: { odooCompanyId?: unknown } } | null;
    if (!row || (row.state !== 'committed' && row.state !== 'confirmed') || typeof row.claim_generation !== 'number'
        || typeof row.actor_user_id !== 'string' || typeof row.payload?.odooCompanyId !== 'number') {
      throw new AppError('stock-command-not-committed', 'commit-rejected');
    }
    const mirrored = await writeOdooStockMirror(ctx.serviceClient as unknown as StockMirrorClient,
      { orgId: ctx.orgId, documentId, companyId: row.payload.odooCompanyId, generation: row.claim_generation }, verdict);
    if (!mirrored.ok) throw stockRefusal(mirrored.message, 'stock-command-refused');
    const flipped = await ctx.serviceClient.from('stock_documents')
      .update({ status: 'Posted', posted_by: row.actor_user_id, posted_at: new Date().toISOString() })
      .eq('org_id', ctx.orgId).eq('id', documentId).eq('status', 'Draft').select('id');
    if (flipped.error) throw stockRefusal(flipped.error.message, flipped.error.code);
  },
};
