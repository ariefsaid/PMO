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
import { runStockPicking } from './picking.ts';

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

export type StockTransferOutcome = 'success' | 'refused' | 'unknown' | 'held' | 'failed';

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
      /** Odoo holds the anchored picking and refused a step; a person checks it before anything is retried. */
      ok: false;
      outcome: 'held';
      reason: 'picking-held';
      message: string;
      pickingId: number;
      externalRecordId: string;
    }
  | {
      /** Odoo refused the load: nothing was written. */
      ok: false;
      outcome: 'failed';
      reason: 'load-failed';
      message: string;
    };

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

  // 3. Send, complete and read back through the one picking writer.
  const run = await runStockPicking(call, {
    anchorKey: params.stockDocumentId,
    companyId: params.companyId,
    pickingTypeId: params.pickingTypeId,
    lines: [{ productId: params.productId, quantity: params.quantity }],
    src: params.sourceLocationId,
    dest: params.destinationLocationId,
    origin: params.origin ?? params.stockDocumentId,
  });
  switch (run.outcome) {
    case 'success':
      return { ok: true, outcome: 'success', pickingId: run.pickingId, externalRecordId: run.externalRecordId, state: run.state, completedQuantity: run.completedQuantity };
    case 'rejected':
      return { ok: false, outcome: 'failed', reason: 'load-failed', message: run.message };
    case 'unknown':
      return { ok: false, outcome: 'unknown', reason: 'unknown-outcome', message: run.message, pickingId: run.pickingId, externalRecordId: run.externalRecordId };
    case 'held':
      if (run.wizard) {
        return {
          ok: false,
          outcome: 'refused',
          reason: 'unhandled-wizard',
          wizard: run.wizard,
          message: `Validation requires unhandled wizard "${run.wizard}". Manual intervention required in Odoo.`,
        };
      }
      return { ok: false, outcome: 'held', reason: 'picking-held', message: run.message, pickingId: run.pickingId, externalRecordId: run.externalRecordId };
  }
}
