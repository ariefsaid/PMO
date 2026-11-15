/**
 * Odoo stock evidence read-back (AC-OSP-007, #1508). One bounded pass: the picking, every move, the issue's
 * `picking_entry` analytic lines and the company currency. Reads only. A read that fails is `unknown`: it says
 * nothing about what Odoo holds, so it is neither held nor confirmed. `stock.move.is_valued` is not read until
 * the bed confirms the field (Round 7.0).
 */
import type { OdooCall } from '../client.ts';
import type { OdooAnalyticLineEvidence, OdooMoveEvidence, OdooPickingEvidence, OdooStockEvidenceRead } from './evidence.ts';

export type ReadStockEvidenceResult =
  | { ok: true; read: OdooStockEvidenceRead }
  | { ok: false; outcome: 'unknown'; message: string };

export interface ReadStockEvidenceOptions {
  /** The project's analytic account: set for an issue, which reads its cost lines. */
  analyticAccountId?: number;
}

const idOf = (v: unknown): number | null => (Array.isArray(v) ? idOf(v[0]) : typeof v === 'number' ? v : null);

export async function readStockEvidence(
  call: OdooCall,
  pickingId: number,
  options: ReadStockEvidenceOptions = {},
): Promise<ReadStockEvidenceResult> {
  try {
    const [picking] = await call<Array<OdooPickingEvidence & { name?: string }>>('stock.picking', 'read', {
      ids: [pickingId],
      fields: ['id', 'state', 'company_id', 'location_id', 'location_dest_id', 'write_date', 'date_done', 'name', 'move_ids'],
    });
    if (!picking) return { ok: true, read: { picking: null, moves: [] } };

    const moveIds = Array.isArray(picking.move_ids) ? picking.move_ids : [];
    const moves = moveIds.length === 0 ? [] : await call<OdooMoveEvidence[]>('stock.move', 'read', {
      ids: moveIds,
      fields: ['id', 'product_id', 'quantity', 'product_uom_qty', 'state', 'value'],
    });

    const analyticLines = options.analyticAccountId === undefined ? undefined : await call<OdooAnalyticLineEvidence[]>('account.analytic.line', 'search_read', {
      domain: [['category', '=', 'picking_entry'], ['name', '=', picking.name ?? ''], ['account_id', '=', options.analyticAccountId]],
      fields: ['id', 'name', 'amount', 'unit_amount', 'category', 'product_id', 'account_id', 'write_date'],
      order: 'id asc',
    });

    const companyId = idOf(picking.company_id);
    let currency: string | null = null;
    if (companyId !== null) {
      const [company] = await call<Array<{ currency_id?: unknown }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
      const c = company?.currency_id;
      currency = Array.isArray(c) && typeof c[1] === 'string' ? c[1] : null;
    }

    return { ok: true, read: { picking, moves, ...(analyticLines ? { analyticLines } : {}), currency } };
  } catch (err) {
    return { ok: false, outcome: 'unknown', message: `Failed to read stock evidence for picking ${pickingId} from Odoo: ${err instanceof Error ? err.message : String(err)}` };
  }
}
