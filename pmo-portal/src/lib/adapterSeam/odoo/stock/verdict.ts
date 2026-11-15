/**
 * What the stock adapter and its recovery probe share: the intent they act on, the record Odoo's verdict becomes, how a picking is
 * judged against the document, and the hold they raise when a person has to look (#1508).
 */
import { AdapterError, type PmoRecord } from '../../contract.ts';
import { AppError } from '../../../appError.ts';
import type { OdooCall } from '../client.ts';
import { evaluateStockEvidence, type PmoStockIntent, type StockEvidenceVerdict } from './evidence.ts';
import type { HoldCause } from './holdReason.ts';
import { readStockEvidence } from './readBack.ts';

/** What the posting needs, resolved server-side from the document, the binding and Odoo. */
export interface StockIntent extends PmoStockIntent {
  pickingTypeId: number;
  /** The project's analytic account: the issue's cost lines are read against it. */
  analyticAccountId?: number;
  origin?: string;
}

/** The record the mirror writer reads: the document id and company beside Odoo's own verdict. */
export const canonicalOfVerdict = (intent: StockIntent, verdict: StockEvidenceVerdict): PmoRecord =>
  ({ id: intent.documentId, kind: intent.kind, companyId: intent.companyId, ...verdict });

/** Read what Odoo holds for the picking and judge it against the document; a read that fails is a retry, not a verdict. */
export async function judgePicking(call: OdooCall, intent: StockIntent, pickingId: number): Promise<{ picking: boolean; verdict: StockEvidenceVerdict }> {
  const read = await readStockEvidence(call, pickingId, intent.kind === 'issue' ? { analyticAccountId: intent.analyticAccountId } : {});
  if (!read.ok) throw new AdapterError('external-unreachable', read.message);
  return { picking: read.read.picking !== null, verdict: evaluateStockEvidence(intent, read.read) };
}

/** Why a command is held and which Odoo transfer it concerns (when one is known): carried on the error to the document's evidence. */
export interface StockHold {
  cause: HoldCause;
  /** The transfer's name in Odoo (e.g. WH/INT/00012). */
  reference?: string | null;
  pickingId?: number | null;
}

const holdFields = (hold: StockHold) => ({ heldCause: hold.cause, heldReference: hold.reference ?? null, heldPickingId: hold.pickingId ?? null });

/** The command-held error a post-anchor refusal raises (the dispatcher holds the row and records the reason). */
export const heldError = (message: string, hold: StockHold): AppError => Object.assign(new AppError(message, 'command-held'), holdFields(hold));

/** A deterministic refusal by the recovery probe: the dispatcher holds the row and carries the cause and transfer to the evidence. */
export const probeHold = (message: string, hold: StockHold): AdapterError => Object.assign(new AdapterError('commit-rejected', message), holdFields(hold));

/** The transfer's own reference (e.g. WH/INT/00012) for a person to find it in Odoo; a failed read just leaves it out. */
export async function transferReferenceOf(call: OdooCall, pickingId: number): Promise<string | null> {
  try {
    const rows = await call<Array<{ name?: unknown }>>('stock.picking', 'read', { ids: [pickingId], fields: ['name'] });
    return typeof rows?.[0]?.name === 'string' ? rows[0].name : null;
  } catch { return null; }
}
