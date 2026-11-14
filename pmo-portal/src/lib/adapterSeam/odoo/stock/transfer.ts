/**
 * Odoo stock transfer execution (AC-OSP-002, FR-OSP-003, Task 9 of #1508).
 *
 * Dispatches an authorized and mapped warehouse stock movement to Odoo using the single-call
 * `stock.picking/load` entry point with the model-qualified external identifier and nested
 * stock moves, writes completed quantity and picked flag, and validates via `button_validate`.
 *
 * Reads back authoritative completed quantity and state directly from the ERP record.
 * Refuses unhandled validation wizards without auto-answering.
 */
import type { OdooCall } from '../client.ts';
import { checkStockCapability, type StockCapabilityRefusalReason, type StockCapabilityResult } from './capability.ts';
import { odooExternalRef, stockExternalIdentifier } from './anchors.ts';

export interface StockTransferParams {
  stockDocumentId: string;
  companyId: number;
  pickingTypeId: number;
  productId: number;
  quantity: number;
  sourceLocationId: number;
  destinationLocationId: number;
  origin?: string;
  capability?: StockCapabilityResult;
}

export type StockTransferOutcome = 'success' | 'refused' | 'unknown' | 'failed';

export type StockTransferResult =
  | {
      ok: true;
      outcome: 'success';
      pickingId: number;
      externalRecordId: string;
      state: string;
      completedQuantity: number;
    }
  | {
      ok: false;
      outcome: 'refused';
      reason: 'missing-mapping' | 'unhandled-wizard' | StockCapabilityRefusalReason;
      message: string;
      wizard?: string;
    }
  | {
      ok: false;
      outcome: 'unknown';
      reason: 'unknown-outcome';
      message: string;
      pickingId?: number;
      externalRecordId?: string;
    }
  | {
      ok: false;
      outcome: 'failed';
      reason: 'load-failed' | 'validate-failed';
      message: string;
    };

interface LoadResult {
  ids: number[] | false;
  messages: Array<{ type: string; message: string; field?: string }>;
  nextrow: number;
}

function hasValidMappings(params: StockTransferParams): boolean {
  return (
    typeof params.stockDocumentId === 'string' &&
    params.stockDocumentId.trim() !== '' &&
    Number.isInteger(params.companyId) &&
    params.companyId > 0 &&
    Number.isInteger(params.pickingTypeId) &&
    params.pickingTypeId > 0 &&
    Number.isInteger(params.productId) &&
    params.productId > 0 &&
    typeof params.quantity === 'number' &&
    Number.isFinite(params.quantity) &&
    params.quantity > 0 &&
    Number.isInteger(params.sourceLocationId) &&
    params.sourceLocationId > 0 &&
    Number.isInteger(params.destinationLocationId) &&
    params.destinationLocationId > 0
  );
}

export async function executeStockTransfer(
  call: OdooCall,
  params: StockTransferParams,
): Promise<StockTransferResult> {
  // 1. Verify capability: refused capability sends zero stock writes
  const capability = params.capability ?? (await checkStockCapability(call, params.companyId, params.pickingTypeId));
  if (!capability.ok) {
    return {
      ok: false,
      outcome: 'refused',
      reason: capability.reason,
      message: capability.message,
    };
  }

  // 2. Validate mappings: missing mapping sends zero stock writes
  if (!hasValidMappings(params)) {
    return {
      ok: false,
      outcome: 'refused',
      reason: 'missing-mapping',
      message: 'Stock transfer parameters lack required mapped company, picking type, product, location, or quantity.',
    };
  }

  // 3. Perform atomic creation via stock.picking load entry point
  const { xmlId } = stockExternalIdentifier(params.stockDocumentId);
  const fields = [
    'id',
    'picking_type_id/.id',
    'location_id/.id',
    'location_dest_id/.id',
    'company_id/.id',
    'origin',
    'move_ids/product_id/.id',
    'move_ids/product_uom_qty',
    'move_ids/location_id/.id',
    'move_ids/location_dest_id/.id',
    'move_ids/company_id/.id',
  ];
  const data = [
    [
      xmlId,
      params.pickingTypeId,
      params.sourceLocationId,
      params.destinationLocationId,
      params.companyId,
      params.origin ?? params.stockDocumentId,
      params.productId,
      params.quantity,
      params.sourceLocationId,
      params.destinationLocationId,
      params.companyId,
    ],
  ];

  let pickingId: number;
  try {
    const loadRes = await call<LoadResult>('stock.picking', 'load', { fields, data });
    if (!loadRes || loadRes.ids === false || !Array.isArray(loadRes.ids) || loadRes.ids.length === 0) {
      const msgs = Array.isArray(loadRes?.messages) ? loadRes.messages.map((m) => m.message).join('; ') : 'unknown';
      return {
        ok: false,
        outcome: 'failed',
        reason: 'load-failed',
        message: `Odoo stock.picking load failed: ${msgs}`,
      };
    }
    pickingId = loadRes.ids[0];
  } catch (err) {
    return {
      ok: false,
      outcome: 'failed',
      reason: 'load-failed',
      message: `Failed to load stock picking in Odoo: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const externalRecordId = odooExternalRef('stock.picking', pickingId);

  // 4. Locate created stock move line
  let moveId: number;
  try {
    const moves = await call<Array<{ id: number }>>('stock.move', 'search_read', {
      domain: [['picking_id', '=', pickingId]],
      fields: ['id'],
      limit: 1,
    });
    if (!Array.isArray(moves) || moves.length === 0) {
      return {
        ok: false,
        outcome: 'failed',
        reason: 'load-failed',
        message: `No stock move found under picking ${pickingId} in Odoo.`,
      };
    }
    moveId = moves[0].id;
  } catch (err) {
    return {
      ok: false,
      outcome: 'failed',
      reason: 'load-failed',
      message: `Failed to query stock moves for picking ${pickingId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 5. Record quantity done and picked flag
  try {
    await call<boolean>('stock.move', 'write', {
      ids: [moveId],
      vals: { quantity: params.quantity, picked: true },
    });
  } catch (err) {
    return {
      ok: false,
      outcome: 'failed',
      reason: 'validate-failed',
      message: `Failed to write quantity to stock move ${moveId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 6. Validate movement
  let validateRes: unknown;
  try {
    validateRes = await call<unknown>('stock.picking', 'button_validate', {
      ids: [pickingId],
    });
  } catch (err) {
    return {
      ok: false,
      outcome: 'failed',
      reason: 'validate-failed',
      message: `Failed to validate stock picking ${pickingId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Refuse unhandled validation wizards (e.g. backorder confirmation) without auto-answering
  if (typeof validateRes === 'object' && validateRes !== null && 'res_model' in validateRes) {
    const wizard = String((validateRes as { res_model: unknown }).res_model);
    return {
      ok: false,
      outcome: 'refused',
      reason: 'unhandled-wizard',
      wizard,
      message: `Validation requires unhandled wizard "${wizard}". Manual intervention required in Odoo.`,
    };
  }

  // 7. Read back verified completed state from ERP
  try {
    const [pickingRead] = await call<Array<{ id: number; state: string }>>('stock.picking', 'read', {
      ids: [pickingId],
      fields: ['id', 'state'],
    });
    const [moveRead] = await call<Array<{ id: number; state: string; quantity: number }>>('stock.move', 'read', {
      ids: [moveId],
      fields: ['id', 'state', 'quantity'],
    });

    if (!pickingRead || !moveRead || typeof moveRead.quantity !== 'number') {
      return {
        ok: false,
        outcome: 'unknown',
        reason: 'unknown-outcome',
        pickingId,
        externalRecordId,
        message: 'Failed to read back completed stock movement state from Odoo.',
      };
    }

    return {
      ok: true,
      outcome: 'success',
      pickingId,
      externalRecordId,
      state: pickingRead.state,
      completedQuantity: moveRead.quantity,
    };
  } catch (err) {
    return {
      ok: false,
      outcome: 'unknown',
      reason: 'unknown-outcome',
      pickingId,
      externalRecordId,
      message: `Failed to read back completed stock movement from Odoo: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
