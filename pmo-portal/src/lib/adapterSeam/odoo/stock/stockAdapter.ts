/**
 * The Odoo `Adapter` for a connected stock document (AC-OSP-002, AC-OSP-003, AC-OSP-004, #1508). Pure: the document, its
 * mappings and the operation type arrive through `loadIntent` (the edge function resolves them from the database and Odoo), and
 * every Odoo call goes through `picking.ts`, the one writer.
 *
 * Outcomes, in the dispatcher's terms:
 *   - a capability or mapping refusal, a refused `load`: commit-rejected (nothing was written; the row fails and the keeper retries);
 *   - a lost `load`, quantity write, validate or read-back answer, an expired commit deadline: external-unreachable (the row stays
 *     claimed, is quarantined, and the recovery probe settles it);
 *   - a refusal after the picking exists, a validation wizard, evidence that differs from the document: command-held (a person looks).
 */
import { AppError } from '../../../appError.ts';
import { AdapterError, type Adapter, type AdapterCommand, type CommandResult } from '../../contract.ts';
import type { OdooCall } from '../client.ts';
import { ODOO_TIER } from '../connectAdapter.ts';
import { odooExternalRef } from './anchors.ts';
import { INVENTORY_DOMAIN } from './constants.ts';
import { completeStockPicking, sendStockPicking } from './picking.ts';
import { canonicalOfVerdict, heldError, judgePicking, transferReferenceOf, type StockIntent } from './verdict.ts';
export type { StockIntent } from './verdict.ts';
import type { StockCapabilityRefusalReason } from './capability.ts';
import type { StockMappingRefusalReason } from './mappings.ts';

export { INVENTORY_DOMAIN };

export type StockIntentResult =
  | { ok: true; intent: StockIntent }
  | { ok: false; reason: StockCapabilityRefusalReason | StockMappingRefusalReason | string; message: string };

export interface OdooStockDeps {
  call: OdooCall;
  loadIntent: () => Promise<StockIntentResult>;
}

/** A refusal before anything was written: the row fails and the keeper retries. `reason` is the typed setup condition the keeper is told. */
const refuse = (message: string, reason?: string): never => { throw Object.assign(new AppError(message, 'commit-rejected'), reason ? { refusalReason: reason } : {}); };

/** `call` is the raw Odoo client: `picking.ts` reads an Odoo refusal (a 4xx) apart from a lost answer, which a pre-wrapped error would hide. */
export function createOdooStockAdapter({ call, loadIntent }: OdooStockDeps): Adapter {
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set([INVENTORY_DOMAIN]),

    async commit(cmd: AdapterCommand): Promise<CommandResult> {
      if (cmd.domain !== INVENTORY_DOMAIN || cmd.operation !== 'create') refuse(`unsupported command ${cmd.domain}/${cmd.operation}`);
      const loaded = await loadIntent();
      if (!loaded.ok) return refuse(loaded.message, loaded.reason);
      const { intent } = loaded;
      if (intent.documentId !== cmd.record.id) refuse('document-mismatch');

      const sent = await sendStockPicking(call, {
        anchorKey: `stock:${intent.documentId}`,
        companyId: intent.companyId,
        pickingTypeId: intent.pickingTypeId,
        ...(intent.kind === 'issue' && intent.projectId !== undefined ? { projectId: intent.projectId } : {}),
        lines: intent.lines,
        src: intent.sourceLocationId,
        dest: intent.destinationLocationId,
        origin: intent.origin ?? intent.documentId,
        deadlineAtMs: cmd.commitDeadlineAtMs,
      });
      if (sent.outcome === 'rejected') return refuse(sent.message);
      if (sent.outcome === 'unknown') throw new AdapterError('external-unreachable', sent.message);

      const done = await completeStockPicking(call, sent.pickingId, intent.lines, cmd.commitDeadlineAtMs);
      if (done.outcome === 'held') throw heldError(done.message, { cause: done.cause, pickingId: sent.pickingId, reference: await transferReferenceOf(call, sent.pickingId) });
      if (done.outcome === 'unknown') throw new AdapterError('external-unreachable', done.message);

      const { verdict } = await judgePicking(call, intent, sent.pickingId);
      if (verdict.state === 'confirmed') {
        return { externalRecordId: odooExternalRef('stock.picking', sent.pickingId), canonical: canonicalOfVerdict(intent, verdict) };
      }
      throw heldError(verdict.exception ?? `Odoo does not report stock picking ${sent.pickingId} as done after validation.`,
        { cause: verdict.holdCause ?? 'not-checked', pickingId: sent.pickingId, reference: verdict.externalReference ?? await transferReferenceOf(call, sent.pickingId) });
    },

    // The stock ledger is Odoo's: PMO mirrors a document's evidence, never a feed of changes. A read refuses rather than answering empty.
    async listChangesSinceWatermark() { return refuse('stock-feed-is-not-an-adapter-read'); },
    async getByExternalId() { return refuse('stock-feed-is-not-an-adapter-read'); },
  };
}
