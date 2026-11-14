/**
 * Odoo stock project issue execution (AC-OSP-003, FR-OSP-004, Task 10 of #1508).
 *
 * Dispatches a project issue stock movement to Odoo using the single-call `stock.picking/load`
 * entry point carrying `project_id` on the picking. The caller cannot supply an issue cost;
 * Odoo valuation creates the native project analytic cost line automatically on validation.
 *
 * PMO retains the work item association (`pmoWorkItemId`) and returns it alongside ERP
 * completion facts without sending it to Odoo.
 *
 * Never creates or writes to `account.move` or `account.analytic.line`.
 */
import type { OdooCall } from '../client.ts';
import { checkStockCapability, type StockCapabilityRefusalReason, type StockCapabilityResult } from './capability.ts';
import { runStockPicking } from './picking.ts';

export interface StockIssueParams {
  stockDocumentId: string;
  pmoWorkItemId: string;
  companyId: number;
  pickingTypeId: number;
  projectId: number;
  productId: number;
  quantity: number;
  sourceLocationId: number;
  destinationLocationId: number;
  origin?: string;
  capability?: StockCapabilityResult;
}

export type StockIssueOutcome = 'success' | 'refused' | 'unknown' | 'held' | 'failed';

export type StockIssueResult =
  | {
      ok: true;
      outcome: 'success';
      pickingId: number;
      externalRecordId: string;
      pmoWorkItemId: string;
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
      pmoWorkItemId?: string;
    }
  | {
      /** Odoo holds the anchored picking and refused a step; a person checks it before anything is retried. */
      ok: false;
      outcome: 'held';
      reason: 'picking-held';
      message: string;
      pickingId: number;
      externalRecordId: string;
      pmoWorkItemId: string;
    }
  | {
      /** Odoo refused the load: nothing was written. */
      ok: false;
      outcome: 'failed';
      reason: 'load-failed';
      message: string;
    };

function hasValidIssueMappings(params: StockIssueParams): boolean {
  return (
    typeof params.stockDocumentId === 'string' &&
    params.stockDocumentId.trim() !== '' &&
    typeof params.pmoWorkItemId === 'string' &&
    params.pmoWorkItemId.trim() !== '' &&
    Number.isInteger(params.companyId) &&
    params.companyId > 0 &&
    Number.isInteger(params.pickingTypeId) &&
    params.pickingTypeId > 0 &&
    Number.isInteger(params.projectId) &&
    params.projectId > 0 &&
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

export async function executeStockIssue(
  call: OdooCall,
  params: StockIssueParams,
): Promise<StockIssueResult> {
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
  if (!hasValidIssueMappings(params)) {
    return {
      ok: false,
      outcome: 'refused',
      reason: 'missing-mapping',
      message: 'Stock issue parameters lack required mapped company, picking type, project, product, location, or quantity.',
    };
  }

  // 3. Send, complete and read back through the one picking writer, carrying project_id on the picking.
  const run = await runStockPicking(call, {
    anchorKey: params.stockDocumentId,
    companyId: params.companyId,
    pickingTypeId: params.pickingTypeId,
    projectId: params.projectId,
    lines: [{ productId: params.productId, quantity: params.quantity }],
    src: params.sourceLocationId,
    dest: params.destinationLocationId,
    origin: params.origin ?? params.stockDocumentId,
  });
  const pmoWorkItemId = params.pmoWorkItemId;
  switch (run.outcome) {
    case 'success':
      return { ok: true, outcome: 'success', pickingId: run.pickingId, externalRecordId: run.externalRecordId, pmoWorkItemId, state: run.state, completedQuantity: run.completedQuantity };
    case 'rejected':
      return { ok: false, outcome: 'failed', reason: 'load-failed', message: run.message };
    case 'unknown':
      return { ok: false, outcome: 'unknown', reason: 'unknown-outcome', message: run.message, pickingId: run.pickingId, externalRecordId: run.externalRecordId, pmoWorkItemId };
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
      return { ok: false, outcome: 'held', reason: 'picking-held', message: run.message, pickingId: run.pickingId, externalRecordId: run.externalRecordId, pmoWorkItemId };
  }
}
