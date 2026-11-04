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
import { externalIdentifier, ODOO_REVENUE_ANCHORS } from './revenue/anchors.ts';
import { buildInvoiceBody, type InvoiceMaps, type PmoInvoice } from './revenue/invoiceBody.ts';
import { readBackInvoice, type InvoiceExpect } from './revenue/invoiceReadBack.ts';
import { nextStep, type Observed } from './revenue/nextStep.ts';
import { probeInvoiceByAnchor, type InvoiceComposite } from './revenue/recoveryProbe.ts';
import { probeReceiptByAnchor, type ReceiptComposite } from './revenue/receiptRecoveryProbe.ts';
import { buildReceiptBody, type ReceiptDefaults, type ReceiptInput, type ReceiptInvoice } from './revenue/receiptBody.ts';

export const REVENUE_DOMAIN = 'revenue';
const MOVE = 'account.move';

export interface OdooRevenueDeps {
  call: OdooCall;
  /** The command's PMO-side facts (client, lines, project's cost account, explicit taxes) and the figure it expects Odoo to answer, resolved before any write. */
  resolveInvoice(command: AdapterCommand): Promise<{ input: PmoInvoice; maps: InvoiceMaps; expect: InvoiceExpect }>;
  /** Server-resolved receipt facts and the verified JWT subject. No receipt money or actor is trusted from Odoo payloads. */
  resolveReceipt?(command: AdapterCommand): Promise<{ input: ReceiptInput; invoice: ReceiptInvoice | null; defaults: ReceiptDefaults; recordedBy: string; invoiceRef: string }>;
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** Odoo failures become contract errors (transient vs rejected); the message is the class, never Odoo's text. */
const guarded = (call: OdooCall): OdooCall => async (model, method, body) => {
  try { return await call(model, method, body); } catch (err) { return toAdapterError(err); }
};

/** PD-4: the anchor key follows the PMO invoice, the same whether the invoice is ordinary or a claim. */
export const invoiceKey = (record: PmoRecord): string => `si:${record.id}`;

interface MoveRow {
  name: unknown; state: string; move_type: string; partner_id?: unknown; amount_untaxed?: number | string; amount_tax?: number | string; amount_total?: number | string; amount_residual?: number | string;
  ref?: unknown; invoice_date?: unknown; currency_id?: unknown; write_date: string;
}
const MOVE_FIELDS = ['name', 'state', 'move_type', 'partner_id', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'ref', 'invoice_date', 'currency_id', 'write_date'];
const PAYMENT_FIELDS = ['name', 'state', 'payment_type', 'partner_type', 'partner_id', 'amount', 'date', 'memo', 'move_id', 'reconciled_invoice_ids', 'is_reconciled', 'is_matched', 'write_date'];

const readMove = async (call: OdooCall, id: number): Promise<MoveRow> =>
  (await call<MoveRow[]>(MOVE, 'read', { ids: [id], fields: MOVE_FIELDS }))[0] ?? refuse('invoice-missing');

const observe = (state: string): Observed => (state === 'draft' ? 'draft-with-anchor' : state === 'posted' ? 'posted-with-anchor' : refuse(`invoice-${state}`));

/** Write the stock external identifier that anchors the invoice; one already there for this document is left alone. */
async function anchorInvoice(call: OdooCall, key: string, id: number): Promise<void> {
  const hit = await probeInvoiceByAnchor(call, key);
  if (hit) { if (hit.externalRecordId !== odooExternalRef(MOVE, id)) refuse('ambiguous-anchor'); return; }
  const { module, name } = externalIdentifier(key);
  await call(ODOO_REVENUE_ANCHORS['sales-invoice'].model, 'create', { vals_list: [{ module, name, model: MOVE, res_id: id }] });
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
  const productLines = await call<Array<{
    id: number; display_type?: string; analytic_distribution?: Record<string, number> | false | null;
    product_id?: unknown; account_id?: unknown;
  }>>('account.move.line', 'search_read', {
    domain: [['move_id', '=', id], ['display_type', '=', 'product']], fields: ['display_type', 'analytic_distribution', 'product_id', 'account_id'],
  });
  const canonical = readBackInvoice(String(record.id), { move, productLines, readAt: new Date().toISOString() }, expect);
  const workOrderId = typeof record.workOrderId === 'string' && record.workOrderId !== '' ? record.workOrderId : null;
  return { externalRecordId: odooExternalRef(MOVE, id), canonical: { ...canonical, ...(workOrderId ? { work_order_id: workOrderId } : {}) } };
}

/**
 * The recovery probe for an invoice (FR-OCI-012/072, OQ-OCI-14): the invoice this command already created, anchored if need be and posted if
 * still a draft, or null when nothing was created. Throws (the row is held) when the composite finds doubt. An invoice is never reissued on doubt:
 * the outbox holds it (`reissueOnInconclusiveAbsence` is false for revenue).
 */
export async function recoverInvoice(
  rawCall: OdooCall,
  record: PmoRecord,
  composite: InvoiceComposite | undefined,
  expect: InvoiceExpect,
  adoptedRef?: string,
): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const key = invoiceKey(record);
  const adoptedId = adoptedRef === undefined ? null : parseOdooExternalRef(MOVE, adoptedRef);
  if (adoptedRef !== undefined && adoptedId === null) refuse('adopted-invoice-ref-invalid');
  const hit = adoptedRef === undefined
    ? await probeInvoiceByAnchor(call, key, composite)
    : { externalRecordId: odooExternalRef(MOVE, adoptedId!) };
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

const receiptKey = (record: PmoRecord) => `ip:${record.id}`;
const paymentState = (payment: PaymentRow): Observed => payment.state === 'draft' ? 'payment-created'
  : payment.state === 'reconciled' ? 'payment-reconciled'
    : payment.state === 'paid' || payment.state === 'in_process' || payment.state === 'posted'
    ? payment.is_reconciled === true ? 'payment-reconciled' : 'payment-posted'
    : 'state-unreadable';
interface PaymentRow {
  id: number; name?: unknown; state: string; payment_type?: unknown; partner_type?: unknown; partner_id?: unknown;
  amount?: number | string; date?: unknown; memo?: unknown; move_id?: unknown; is_reconciled?: boolean; is_matched?: boolean; write_date?: string;
  reconciled_invoice_ids?: unknown;
}
const numeric = (v: unknown): number | null => {
  const n = Array.isArray(v) ? Number(v[0]) : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const isReceiptMoney = (value: unknown): value is number | string | null | undefined =>
  value === undefined || value === null || typeof value === 'number' || typeof value === 'string';
function paymentMatches(payment: PaymentRow, expected: ReceiptComposite): boolean {
  const reconciledToExpectedInvoice = paymentState(payment) !== 'payment-reconciled'
    || (Array.isArray(payment.reconciled_invoice_ids) && payment.reconciled_invoice_ids.some((id) => Number(id) === expected.invoiceId));
  return payment.payment_type === 'inbound' && payment.partner_type === 'customer'
    && numeric(payment.partner_id) === expected.partnerId && Number(payment.amount) === expected.amount
    && payment.date === expected.date && reconciledToExpectedInvoice;
}
async function readPayment(call: OdooCall, id: number): Promise<PaymentRow> {
  return (await call<PaymentRow[]>('account.payment', 'read', { ids: [id], fields: PAYMENT_FIELDS }))[0] ?? refuse('receipt-missing');
}
async function anchorReceipt(call: OdooCall, key: string, id: number): Promise<void> {
  const hit = await probeReceiptByAnchor(call, key);
  const ref = odooExternalRef('account.payment', id);
  if (hit) { if (hit.externalRecordId !== ref) refuse('ambiguous-anchor'); return; }
  const { module, name } = externalIdentifier(key);
  await call(ODOO_REVENUE_ANCHORS['incoming-payment'].model, 'create', { vals_list: [{ module, name, model: 'account.payment', res_id: id }] });
}

async function settleReceipt(call: OdooCall, id: number, record: PmoRecord, facts: {
  expected: ReceiptComposite & { recordedBy?: string }; input: ReceiptInput;
}): Promise<CommandResult> {
  const invoiceId = facts.expected.invoiceId;
  let payment = await readPayment(call, id);
  if (!paymentMatches(payment, facts.expected)) return refuse('receipt-does-not-match-command');
  let observed = paymentState(payment);
  let step = nextStep('incoming-payment', observed, 'none');
  if (step === 'post') {
    await call('account.payment', 'action_post', { ids: [id] });
    payment = await readPayment(call, id);
    observed = paymentState(payment);
    step = nextStep('incoming-payment', observed, 'none');
  }
  if (step === 'reconcile') {
    const moveId = numeric(payment.move_id);
    if (moveId === null) return refuse('receipt-move-missing');
    const lines = await call<Array<{ id: number; move_id: unknown; partner_id?: unknown; amount_residual?: number | string; reconciled?: boolean }>>('account.move.line', 'search_read', {
      domain: [['move_id', 'in', [invoiceId, moveId]], ['account_type', '=', 'asset_receivable'], ['partner_id', '=', facts.expected.partnerId]],
      fields: ['move_id', 'partner_id', 'amount_residual', 'reconciled'], limit: 10,
    });
    const invoiceLine = lines.find((line) => numeric(line.move_id) === invoiceId);
    const paymentLine = lines.find((line) => numeric(line.move_id) === moveId);
    if (!invoiceLine || !paymentLine || lines.filter((line) => numeric(line.move_id) === invoiceId).length !== 1
        || lines.filter((line) => numeric(line.move_id) === moveId).length !== 1) return refuse('receipt-receivable-line-missing');
    if (Number(paymentLine.amount_residual) !== 0 && paymentLine.reconciled !== true) {
      await call('account.move.line', 'reconcile', { ids: [invoiceLine.id, paymentLine.id] });
    }
    payment = await readPayment(call, id);
    observed = paymentState(payment);
    step = nextStep('incoming-payment', observed, 'none');
  }
  if (!paymentMatches(payment, facts.expected)) return refuse('receipt-does-not-match-command');
  if (step !== 'adopt') return refuse(`receipt-${payment.state}`);
  const move = await readMove(call, invoiceId);
  if (move.move_type !== 'out_invoice' || move.state !== 'posted' || numeric(move.partner_id) !== facts.expected.partnerId) return refuse('receipt-invoice-not-posted');
  const settled = Number(facts.input.settled);
  const cash = Number(facts.input.cash ?? facts.input.settled);
  const withheld = Number(facts.input.withheld ?? 0);
  return {
    externalRecordId: odooExternalRef('account.payment', id),
    canonical: {
      id: String(record.id), ip_number: typeof payment.name === 'string' ? payment.name : null,
      reference_number: typeof facts.input.slipNumber === 'string' ? facts.input.slipNumber : null,
      date: facts.input.date, amount: settled, received_amount: cash, withheld_amount: withheld,
      withholding_slip_number: facts.input.slipNumber ?? null, erp_docstatus: 1,
      erp_modified: payment.write_date ?? move.write_date, erp_amended_from: null, erp_cancelled_at: null,
      ...(facts.expected.recordedBy ? { recorded_by_id: facts.expected.recordedBy } : {}),
    },
  };
}

/** Recover a receipt by its stock identifier, or in a bounded recovery by the exact unique receipt conjunction. */
export interface ReceiptResolution { adoptedRef?: string; absentConfirmed?: boolean }

export async function recoverReceipt(rawCall: OdooCall, record: PmoRecord, composite?: ReceiptComposite & { recordedBy?: string }, recoveryInput?: ReceiptInput, resolution?: ReceiptResolution): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const key = receiptKey(record);
  let hit: { externalRecordId: string } | null;
  if (resolution?.adoptedRef) {
    const id = parseOdooExternalRef('account.payment', resolution.adoptedRef) ?? refuse('ambiguous-anchor');
    const payment = await readPayment(call, id);
    if (!composite || !paymentMatches(payment, composite)
        || !Array.isArray(payment.reconciled_invoice_ids) || !payment.reconciled_invoice_ids.some((invoice) => Number(invoice) === composite.invoiceId)) {
      return refuse('adopted-receipt-not-reconciled');
    }
    hit = { externalRecordId: odooExternalRef('account.payment', id) };
  } else {
    // An operator's absence decision narrows the retry to the stock identifier; never let an unrelated but similar payment
    // satisfy the broader conjunction after a human has confirmed that the original was absent.
    hit = await probeReceiptByAnchor(call, key, resolution?.absentConfirmed ? undefined : composite);
  }
  if (!hit) return null;
  const id = parseOdooExternalRef('account.payment', hit.externalRecordId) ?? refuse('ambiguous-anchor');
  if (!composite) return null;
  if (!paymentMatches(await readPayment(call, id), composite)) return refuse('receipt-does-not-match-command');
  const paidAmount = record.paid_amount;
  const receivedAmount = record.received_amount;
  const withheldAmount = record.withheld_amount;
  if (!isReceiptMoney(paidAmount) || !isReceiptMoney(receivedAmount) || !isReceiptMoney(withheldAmount)) return refuse('receipt-does-not-match-command');
  await anchorReceipt(call, key, id);
  return settleReceipt(call, id, record, {
    expected: composite, input: recoveryInput ?? {
      id: String(record.id), orgId: '', date: composite.date, currency: '', settled: paidAmount ?? composite.amount,
      cash: receivedAmount ?? composite.amount, withheld: withheldAmount,
      slipNumber: typeof record.withholding_slip_number === 'string' ? record.withholding_slip_number : null,
    },
  });
}

async function pushReceipt(deps: OdooRevenueDeps, command: AdapterCommand): Promise<CommandResult> {
  if (!deps.resolveReceipt) return refuse('receipt-input-unavailable');
  const facts = await deps.resolveReceipt(command);
  const built = buildReceiptBody(facts.input, facts.invoice, facts.defaults, facts.recordedBy);
  if (built.outcome === 'refused') return refuse(`${built.code}: ${built.thing}`);
  const invoiceId = parseOdooExternalRef('account.move', facts.invoiceRef) ?? refuse('receipt-invoice-required');
  const partnerId = Number(built.body.partner_id);
  const expected: ReceiptComposite & { recordedBy: string } = {
    partnerId, amount: Number(built.body.amount), date: facts.input.date, invoiceId,
    createdAfter: new Date(Date.now() - 10 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
    createdBefore: new Date(Date.now() + 120_000).toISOString().slice(0, 19).replace('T', ' '), recordedBy: facts.recordedBy,
  };
  const key = receiptKey(command.record);
  const found = await probeReceiptByAnchor(guarded(deps.call), key);
  if (found) {
    const recovered = await recoverReceipt(deps.call, command.record, expected, facts.input);
    if (recovered) return recovered;
  }
  if (nextStep('incoming-payment', 'absent', 'none') !== 'create') return refuse('receipt-held');

  let id: number;
  if (built.writeOff) {
    const context = { active_model: 'account.move', active_ids: [invoiceId] };
    const [wizardId] = await guarded(deps.call)<number[]>('account.payment.register', 'create', { vals_list: [{
      amount: built.body.amount, journal_id: built.body.journal_id, payment_date: facts.input.date, communication: built.body.memo,
      payment_method_line_id: built.body.payment_method_line_id,
      payment_difference_handling: 'reconcile', writeoff_account_id: built.writeOff.accountId,
      writeoff_label: built.writeOff.label,
    }], context });
    const action = await guarded(deps.call)<{ res_id?: number }>('account.payment.register', 'action_create_payments', { ids: [wizardId], context });
    if (!Number.isInteger(action?.res_id) || Number(action.res_id) <= 0) return refuse('receipt-wizard-result-missing');
    id = Number(action.res_id);
  } else {
    const [createdId] = await guarded(deps.call)<number[]>('account.payment', 'create', { vals_list: [built.body] });
    id = Number(createdId);
  }
  if (!Number.isInteger(id) || id <= 0) return refuse('receipt-create-result-missing');
  await anchorReceipt(guarded(deps.call), key, id);
  return settleReceipt(guarded(deps.call), id, command.record, {
    expected, input: facts.input,
  });
}

/**
 * The one revenue step C3 pushes: the approval of a PMO invoice draft. The draft (and its lines) is PMO's until then (OQ-OCI-1: drafts never
 * exist in Odoo); the approval is the money commitment, so it is the only command that creates and posts the Odoo invoice, in one command.
 */
export const isInvoicePush = (command: Pick<AdapterCommand, 'operation' | 'record'>): boolean =>
  command.record.erp_doc_kind === 'sales-invoice' && command.operation === 'transition' && command.record.verb === 'submit';

export function createOdooRevenueAdapter(deps: OdooRevenueDeps): Adapter {
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set([REVENUE_DOMAIN]),

    async commit(command) {
      if (command.domain !== REVENUE_DOMAIN) return refuse('unsupported domain');
      if (isInvoicePush(command)) return pushInvoice(deps, command);
      if (command.record.erp_doc_kind === 'incoming-payment' && command.operation === 'create') return pushReceipt(deps, command);
      return refuse(`odoo revenue ${String(command.record.erp_doc_kind)} ${String(command.operation)} is not available yet`);
    },

    // The inbound feed for revenue arrives with C6.
    getByExternalId: () => Promise.reject(new AdapterError('commit-rejected', 'odoo revenue reads are not available yet')),
    listChangesSinceWatermark: () => Promise.reject(new AdapterError('commit-rejected', 'odoo revenue reads are not available yet')),
  };
}
