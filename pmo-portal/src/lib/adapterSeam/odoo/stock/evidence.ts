/**
 * Pure stock evidence evaluation (AC-OSP-007, FR-OSP-005, FR-OSP-009, Task 12 of #1508).
 *
 * Compares PMO document intent against authoritative records read back from Odoo
 * (stock.picking, stock.move, and for an issue native account.analytic.line).
 *
 * Verdict rules:
 * - 'confirmed': picking state is 'done', company matches, locations match, every line's completed
 *   quantity equals PMO intent, and for an issue native project cost is present exactly once for
 *   the mapped project with a readable value. Quantity and value are Odoo's numbers, never PMO inputs.
 * - 'pending': picking is not yet done (or absent), leaving unknown values null (never inventing zero).
 * - 'held': mismatched company, mismatched locations, missing/mismatched lines, partial quantity,
 *   cancelled picking, missing/duplicate native project cost, or unreadable valuation.
 * - 'stale': reserved for part 2 (the research doc gives no last read rule for stock documents).
 */

export interface PmoStockIntentLine {
  productId: number;
  quantity: number;
}

export interface PmoStockIntent {
  documentId: string;
  kind: 'transfer' | 'issue';
  companyId: number;
  lines: PmoStockIntentLine[];
  sourceLocationId: number;
  destinationLocationId: number;
  projectId?: number;
}

export interface OdooPickingEvidence {
  id: number;
  state: string;
  company_id: number | [number, string];
  location_id: number | [number, string];
  location_dest_id: number | [number, string];
  write_date?: string | null;
  date_done?: string | null;
  move_ids?: number[];
}

export interface OdooMoveEvidence {
  id?: number;
  product_id: number | [number, string];
  quantity?: number | null;
  product_uom_qty?: number | null;
  state?: string;
  location_id?: number | [number, string];
  location_dest_id?: number | [number, string];
  value?: number | null;
  /** Odoo's own flag: an internal transfer is not valued (bed 7.0: value 0, `is_valued` false); an issue is. */
  is_valued?: boolean | null;
  write_date?: string | null;
}

export interface OdooAnalyticLineEvidence {
  id: number;
  name?: string;
  amount: number;
  unit_amount?: number;
  category?: string;
  product_id?: number | [number, string];
  account_id?: number | [number, string];
  project_id?: number | [number, string];
  write_date?: string | null;
}

export interface OdooStockEvidenceRead {
  picking: OdooPickingEvidence | null;
  moves: OdooMoveEvidence[];
  analyticLines?: OdooAnalyticLineEvidence[];
  currency?: string | null;
}

export type StockEvidenceState = 'confirmed' | 'pending' | 'held' | 'stale';

export interface StockEvidenceVerdict {
  state: StockEvidenceState;
  externalModel: string | null;
  externalId: string | null;
  completedQuantity: number | null;
  completedValue: number | null;
  currency: string | null;
  sourceWrittenAt: string | null;
  exception: string | null;
}

function extractId(val: unknown): number | null {
  if (typeof val === 'number' && Number.isInteger(val)) return val;
  if (Array.isArray(val) && typeof val[0] === 'number') return val[0];
  return null;
}

/**
 * Pure evaluation of Odoo ERP evidence against PMO stock movement intent.
 */
export function evaluateStockEvidence(
  intent: PmoStockIntent,
  read: OdooStockEvidenceRead,
): StockEvidenceVerdict {
  const picking = read.picking;

  // 1. Missing picking: movement not found or not yet created
  if (!picking) {
    return {
      state: 'pending',
      externalModel: null,
      externalId: null,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: null,
      exception: null,
    };
  }

  const externalModel = 'stock.picking';
  const externalId = String(picking.id);
  const sourceWrittenAt = picking.write_date ?? picking.date_done ?? null;

  // 2. Company check: foreign company holds immediately
  const pickingCompanyId = extractId(picking.company_id);
  if (pickingCompanyId !== intent.companyId) {
    return {
      state: 'held',
      externalModel,
      externalId,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt,
      exception: `STK_EVIDENCE_COMPANY: company mismatch (ERP company ${pickingCompanyId} != intent ${intent.companyId})`,
    };
  }

  // 3. Location check: locations must match intent
  const pickingSrcLoc = extractId(picking.location_id);
  const pickingDestLoc = extractId(picking.location_dest_id);
  if (
    pickingSrcLoc !== intent.sourceLocationId ||
    pickingDestLoc !== intent.destinationLocationId
  ) {
    return {
      state: 'held',
      externalModel,
      externalId,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt,
      exception: `STK_EVIDENCE_LOCATION: locations do not match document intent (ERP [${pickingSrcLoc}->${pickingDestLoc}] != intent [${intent.sourceLocationId}->${intent.destinationLocationId}])`,
    };
  }

  // 4. Cancelled picking holds
  if (picking.state === 'cancel') {
    return {
      state: 'held',
      externalModel,
      externalId,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt,
      exception: 'STK_EVIDENCE_CANCELLED: picking was cancelled in ERP',
    };
  }

  // 5. Picking not done yet: remains pending; never invent zero or premature values
  if (picking.state !== 'done') {
    return {
      state: 'pending',
      externalModel,
      externalId,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt,
      exception: null,
    };
  }

  // Picking is 'done': evaluate lines, quantities, project costs, and valuation
  // 6. Check lines and completed quantities
  const moves = read.moves ?? [];
  if (moves.length === 0 && intent.lines.length > 0) {
    return {
      state: 'held',
      externalModel,
      externalId,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt,
      exception: 'STK_EVIDENCE_LINES: picking has no move lines',
    };
  }

  // Map Odoo moves by product ID
  const odooQtyByProduct = new Map<number, number>();
  let totalOdooQty = 0;
  let odooMovesValueTotal = 0;
  let hasValidMoveValue = true;

  for (const move of moves) {
    const pid = extractId(move.product_id);
    if (pid === null) {
      return {
        state: 'held',
        externalModel,
        externalId,
        completedQuantity: null,
        completedValue: null,
        currency: null,
        sourceWrittenAt,
        exception: 'STK_EVIDENCE_LINES: move line has invalid product reference',
      };
    }

    const qty = move.quantity;
    if (typeof qty !== 'number' || !Number.isFinite(qty)) {
      return {
        state: 'held',
        externalModel,
        externalId,
        completedQuantity: null,
        completedValue: null,
        currency: null,
        sourceWrittenAt,
        exception: `STK_EVIDENCE_QUANTITY: move line for product ${pid} has unreadable quantity`,
      };
    }

    odooQtyByProduct.set(pid, (odooQtyByProduct.get(pid) ?? 0) + qty);
    totalOdooQty += qty;

    if (move.is_valued === false) {
      // Not valued: Odoo books no value for it, so there is none to read (and none to hold for).
    } else if (typeof move.value === 'number' && Number.isFinite(move.value)) {
      odooMovesValueTotal += move.value;
    } else {
      hasValidMoveValue = false;
    }
  }

  // A document may carry one item on two lines (bed 7.0: two moves, and for an issue two cost lines): compare per product.
  const intentQtyByProduct = new Map<number, number>();
  for (const line of intent.lines) intentQtyByProduct.set(line.productId, (intentQtyByProduct.get(line.productId) ?? 0) + line.quantity);
  const movesPerProduct = new Map<number, number>();
  for (const move of moves) { const pid = extractId(move.product_id)!; movesPerProduct.set(pid, (movesPerProduct.get(pid) ?? 0) + 1); }

  // Check each intent product against Odoo move quantities
  for (const [productId, intentQty] of intentQtyByProduct) {
    const line = { productId, quantity: intentQty };
    const odooQty = odooQtyByProduct.get(line.productId);
    if (odooQty === undefined) {
      return {
        state: 'held',
        externalModel,
        externalId,
        completedQuantity: totalOdooQty > 0 ? totalOdooQty : null,
        completedValue: hasValidMoveValue ? odooMovesValueTotal : null,
        currency: read.currency ?? null,
        sourceWrittenAt,
        exception: `STK_EVIDENCE_LINES: product ${line.productId} is missing from ERP moves`,
      };
    }

    if (odooQty !== line.quantity) {
      return {
        state: 'held',
        externalModel,
        externalId,
        completedQuantity: totalOdooQty,
        completedValue: hasValidMoveValue ? odooMovesValueTotal : null,
        currency: read.currency ?? null,
        sourceWrittenAt,
        exception: `STK_EVIDENCE_QUANTITY: completed quantity ${odooQty} does not match intent ${line.quantity} for product ${line.productId}`,
      };
    }
  }

  // Check for unexpected extra products in moves
  for (const [pid] of odooQtyByProduct) {
    if (!intent.lines.some((l) => l.productId === pid)) {
      return {
        state: 'held',
        externalModel,
        externalId,
        completedQuantity: totalOdooQty,
        completedValue: hasValidMoveValue ? odooMovesValueTotal : null,
        currency: read.currency ?? null,
        sourceWrittenAt,
        exception: `STK_EVIDENCE_LINES: unexpected product ${pid} in ERP moves`,
      };
    }
  }

  // 7. Check issue native project cost or transfer valuation
  let completedValue: number;

  if (intent.kind === 'issue') {
    const analyticLines = read.analyticLines ?? [];
    if (analyticLines.length === 0) {
      return {
        state: 'held',
        externalModel,
        externalId,
        completedQuantity: totalOdooQty,
        completedValue: null,
        currency: read.currency ?? null,
        sourceWrittenAt,
        exception: 'STK_EVIDENCE_PROJECT_COST: missing native project cost line in ERP',
      };
    }

    // Odoo books one picking_entry line per move, linked by picking name and product (bed 7.0): the lines must match the moves.
    const held = (message: string): StockEvidenceVerdict => ({
      state: 'held',
      externalModel,
      externalId,
      completedQuantity: totalOdooQty,
      completedValue: null,
      currency: read.currency ?? null,
      sourceWrittenAt,
      exception: message,
    });
    if (analyticLines.length > moves.length) {
      return held(`STK_EVIDENCE_PROJECT_COST: duplicate native project cost lines found (${analyticLines.length} lines for ${moves.length} moves)`);
    }
    const linesPerProduct = new Map<number, number>();
    for (const l of analyticLines) {
      const pid = extractId(l.product_id);
      if (pid === null) continue;
      linesPerProduct.set(pid, (linesPerProduct.get(pid) ?? 0) + 1);
      if (!odooQtyByProduct.has(pid)) return held(`STK_EVIDENCE_PROJECT_COST: native project cost line for product ${pid}, which is on no move`);
      if (linesPerProduct.get(pid)! > (movesPerProduct.get(pid) ?? 0)) return held(`STK_EVIDENCE_PROJECT_COST: duplicate native project cost lines found for product ${pid}`);
    }
    if (analyticLines.length < moves.length) {
      return held(`STK_EVIDENCE_PROJECT_COST: missing native project cost lines (${analyticLines.length} lines for ${moves.length} moves)`);
    }
    for (const l of analyticLines) {
      if (typeof l.amount !== 'number' || !Number.isFinite(l.amount)) {
        return held('STK_EVIDENCE_VALUATION: unreadable valuation on native project cost line');
      }
    }

    completedValue = analyticLines.reduce((sum, l) => sum + l.amount, 0);
  } else {
    // Transfer valuation
    if (!hasValidMoveValue) {
      return {
        state: 'held',
        externalModel,
        externalId,
        completedQuantity: totalOdooQty,
        completedValue: null,
        currency: read.currency ?? null,
        sourceWrittenAt,
        exception: 'STK_EVIDENCE_VALUATION: unreadable valuation on transfer moves',
      };
    }

    completedValue = odooMovesValueTotal;
  }

  // 8. Timestamps required for confirmed
  if (!sourceWrittenAt) {
    return {
      state: 'held',
      externalModel,
      externalId,
      completedQuantity: totalOdooQty,
      completedValue,
      currency: read.currency ?? null,
      sourceWrittenAt: null,
      exception: 'STK_EVIDENCE_TIMESTAMP: missing source write timestamp from ERP',
    };
  }

  // 9. All evidence verified: confirmed verdict with Odoo's authoritative numbers
  return {
    state: 'confirmed',
    externalModel,
    externalId,
    completedQuantity: totalOdooQty,
    completedValue,
    currency: read.currency ?? null,
    sourceWrittenAt,
    exception: null,
  };
}
