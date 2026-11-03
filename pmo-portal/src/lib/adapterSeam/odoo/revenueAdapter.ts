/**
 * The Odoo `Adapter` (contract.ts) for domain `revenue` (PD-2, DD-OCI-1..4). C3 pushes the ordinary customer invoice (`sales-invoice`); the claim
 * lines (C4) ride the same command, and the receipt (C5) is its own. A command is a state machine over Odoo's state, not a script (PD-3,
 * DD-OCI-3): find the document by its anchor, let `nextStep` pick the one missing call, perform it, read it back.
 *
 * The invoice is created, anchored (a stock external identifier written right after the create) and posted: three calls and not one transaction.
 * A crash between any two leaves a document the next attempt finds by identifier and finishes (a draft is posted, a posted one adopted, never
 * created again, NFR-OCI-005). When the identifier was never written the document is unanchored, and an unanchored look-alike is DOUBT: the
 * recovery holds the row, never adopts and never creates a second (OQ-OCI-14, #1505 P5). `recoverInvoice` is that finder-and-finisher;
 * adapter-dispatch runs it as the outbox recovery probe on every claim, so the adapter itself only creates when nothing exists.
 */
import { AdapterError, type Adapter, type AdapterCommand, type CommandResult, type PmoRecord } from '../contract.ts';
import type { OdooCall } from './client.ts';
import { ODOO_TIER, toAdapterError } from './connectAdapter.ts';
import { odooExternalRef, parseOdooExternalRef } from './purchase/anchors.ts';
import { externalIdentifier } from './revenue/anchors.ts';
import { buildInvoiceBody, type InvoiceMaps, type PmoInvoice } from './revenue/invoiceBody.ts';
import { readBackInvoice, type InvoiceExpect } from './revenue/invoiceReadBack.ts';
import { nextStep, type Observed } from './revenue/nextStep.ts';
import { probeInvoiceByAnchor, type InvoiceComposite } from './revenue/recoveryProbe.ts';

export const REVENUE_DOMAIN = 'revenue';
const MOVE = 'account.move';

export interface OdooRevenueDeps {
  call: OdooCall;
  /** The command's PMO-side facts (client, lines, project's cost account, explicit taxes) and the figure it expects Odoo to answer, resolved before any write. */
  resolveInvoice(command: AdapterCommand): Promise<{ input: PmoInvoice; maps: InvoiceMaps; expect: InvoiceExpect }>;
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** Odoo failures become contract errors (transient vs rejected); the message is the class, never Odoo's text. */
const guarded = (call: OdooCall): OdooCall => async (model, method, body) => {
  try { return await call(model, method, body); } catch (err) { return toAdapterError(err); }
};

/** PD-4: the anchor key follows the PMO invoice, the same whether the invoice is ordinary or a claim. */
export const invoiceKey = (record: PmoRecord): string => `si:${record.id}`;

interface MoveRow {
  name: unknown; state: string; move_type: string; amount_untaxed?: number | string; amount_tax?: number | string; amount_total?: number | string; amount_residual?: number | string;
  ref?: unknown; invoice_date?: unknown; currency_id?: unknown; write_date: string;
}
const MOVE_FIELDS = ['name', 'state', 'move_type', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'ref', 'invoice_date', 'currency_id', 'write_date'];

const readMove = async (call: OdooCall, id: number): Promise<MoveRow> =>
  (await call<MoveRow[]>(MOVE, 'read', { ids: [id], fields: MOVE_FIELDS }))[0] ?? refuse('invoice-missing');

const observe = (state: string): Observed => (state === 'draft' ? 'draft-with-anchor' : state === 'posted' ? 'posted-with-anchor' : refuse(`invoice-${state}`));

/** Write the stock external identifier that anchors the invoice; one already there for this document is left alone. */
async function anchorInvoice(call: OdooCall, key: string, id: number): Promise<void> {
  const hit = await probeInvoiceByAnchor(call, key);
  if (hit) { if (hit.externalRecordId !== odooExternalRef(MOVE, id)) refuse('ambiguous-anchor'); return; }
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: MOVE, res_id: id }] });
}

/** Post a draft, adopt a posted one, reject anything else; then read the invoice's money and lines back (FR-OCI-012/014/022a/024). */
async function settleInvoice(call: OdooCall, id: number, record: PmoRecord, expect: InvoiceExpect): Promise<CommandResult> {
  let move = await readMove(call, id);
  if (move.move_type !== 'out_invoice') return refuse('invoice-not-a-customer-invoice');
  let step = nextStep('sales-invoice', observe(move.state), 'none');
  if (step === 'post') {
    await call(MOVE, 'action_post', { ids: [id] });
    move = await readMove(call, id);
    step = nextStep('sales-invoice', observe(move.state), 'none');
  }
  if (step !== 'adopt') return refuse(`invoice-${move.state}`);
  const productLines = await call<Array<{ id: number; display_type?: string; analytic_distribution?: Record<string, number> | false | null }>>('account.move.line', 'search_read', {
    domain: [['move_id', '=', id], ['display_type', '=', 'product']], fields: ['display_type', 'analytic_distribution'],
  });
  return { externalRecordId: odooExternalRef(MOVE, id), canonical: readBackInvoice(String(record.id), { move, productLines, readAt: new Date().toISOString() }, expect) };
}

/**
 * The recovery probe for an invoice (FR-OCI-012/072, OQ-OCI-14): the invoice this command already created, anchored if need be and posted if
 * still a draft, or null when nothing was created. Throws (the row is held) when the composite finds doubt. An invoice is never reissued on doubt:
 * the outbox holds it (`reissueOnInconclusiveAbsence` is false for revenue).
 */
export async function recoverInvoice(rawCall: OdooCall, record: PmoRecord, composite: InvoiceComposite | undefined, expect: InvoiceExpect): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const key = invoiceKey(record);
  const hit = await probeInvoiceByAnchor(call, key, composite);
  if (!hit) return null;
  const id = parseOdooExternalRef(MOVE, hit.externalRecordId) ?? refuse('ambiguous-anchor');
  await anchorInvoice(call, key, id);
  return settleInvoice(call, id, record, expect);
}

/** Create, anchor, post. Reached only when dispatch ruled the absence acceptable (a first attempt, or a definite failure), so this never mints on doubt. */
async function pushInvoice(deps: OdooRevenueDeps, command: AdapterCommand): Promise<CommandResult> {
  const call = guarded(deps.call);
  const { input, maps, expect } = await deps.resolveInvoice(command);
  const built = buildInvoiceBody(input, maps);   // refuses before the first Odoo call, naming the thing
  if (built.outcome === 'refused') return refuse(`${built.code}: ${built.thing}: ${built.name}`);
  const found = await recoverInvoice(call, command.record, undefined, expect);
  if (found) return found;
  if (nextStep('sales-invoice', 'absent', 'none') !== 'create') return refuse('invoice-held');
  const [id] = await call<number[]>(MOVE, 'create', { vals_list: [built.body] });
  await anchorInvoice(call, invoiceKey(command.record), id);
  return settleInvoice(call, id, command.record, expect);
}

/** The one revenue step C3 pushes: an ordinary sales invoice. */
export const isInvoicePush = (command: Pick<AdapterCommand, 'operation' | 'record'>): boolean =>
  command.record.erp_doc_kind === 'sales-invoice' && command.operation === 'create';

export function createOdooRevenueAdapter(deps: OdooRevenueDeps): Adapter {
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set([REVENUE_DOMAIN]),

    async commit(command) {
      if (command.domain !== REVENUE_DOMAIN) return refuse('unsupported domain');
      if (isInvoicePush(command)) return pushInvoice(deps, command);
      return refuse(`odoo revenue ${String(command.record.erp_doc_kind)} ${String(command.operation)} is not available yet`);
    },

    // The inbound feed for revenue arrives with C6.
    getByExternalId: () => Promise.reject(new AdapterError('commit-rejected', 'odoo revenue reads are not available yet')),
    listChangesSinceWatermark: () => Promise.reject(new AdapterError('commit-rejected', 'odoo revenue reads are not available yet')),
  };
}
