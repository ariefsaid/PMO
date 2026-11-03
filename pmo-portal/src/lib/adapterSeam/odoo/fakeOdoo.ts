/**
 * Test-only in-memory Odoo speaking JSON-2 over a `fetch` mock (bed report §1, §3): per-model row maps, the
 * domain subset the adapter uses, `write_date` stamping, 401 on a wrong key, and one-shot transport faults.
 */
import { createBill, isModelledBill, postBill, Rejected } from './purchase/fakeBill.ts';
import { createPayment, isModelledPayment, postPayment, reconcileLines, RejectedPayment } from './purchase/fakePayment.ts';

type Row = Record<string, unknown> & { id: number };
type Domain = unknown[];

/** The fields `fields_get` reports per model (the adapter only asks which exist). Any other model answers 404. */
const FIELDS: Record<string, string[]> = {
  'res.partner': ['name', 'vat', 'ref', 'email', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'company_id', 'write_date'],
  'res.company': ['name', 'currency_id', 'partner_id', 'write_date'],
  'product.product': ['default_code', 'name', 'uom_id', 'supplier_taxes_id', 'purchase_ok', 'sale_ok', 'is_storable', 'company_id', 'active', 'write_date'],
  'uom.uom': ['name', 'relative_factor', 'relative_uom_id', 'active', 'write_date'],
  'stock.warehouse': ['name', 'code', 'lot_stock_id', 'view_location_id', 'company_id', 'active', 'write_date'],
  'stock.location': ['complete_name', 'usage', 'location_id', 'warehouse_id', 'company_id', 'active', 'write_date'],
  'account.account': ['code', 'name', 'account_type', 'company_ids', 'active', 'write_date'],
  'account.tax': ['name', 'amount', 'type_tax_use', 'tax_group_id', 'company_id', 'active', 'write_date'],
  'account.analytic.plan': ['name', 'write_date'],
  'account.analytic.account': ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'],
  'purchase.order': ['name', 'state', 'partner_id', 'partner_ref', 'origin', 'order_line', 'amount_untaxed', 'amount_total', 'company_id', 'create_date', 'write_date'],
  'purchase.order.line': ['name', 'order_id', 'product_id', 'product_qty', 'price_unit', 'uom_id', 'qty_received', 'qty_invoiced', 'analytic_distribution', 'write_date'],
  'ir.model.data': ['module', 'name', 'model', 'res_id', 'write_date'],
  'account.payment': ['state', 'memo', 'amount', 'partner_id', 'payment_type', 'partner_type', 'journal_id', 'move_id', 'reconciled_bill_ids', 'write_date'],
  'account.journal': ['name', 'code', 'type', 'company_id', 'active', 'write_date'],
  'account.move': ['name', 'move_type', 'state', 'partner_id', 'ref', 'invoice_date', 'invoice_date_due', 'invoice_line_ids', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'payment_state', 'currency_id', 'company_id', 'invoice_origin', 'create_date', 'write_date'],
  'account.move.line': ['move_id', 'display_type', 'product_id', 'quantity', 'price_unit', 'tax_ids', 'tax_line_id', 'tax_base_amount', 'analytic_distribution', 'purchase_line_id', 'balance', 'amount_residual', 'write_date'],
  'account.tax.repartition.line': ['tax_id', 'document_type', 'repartition_type', 'account_id', 'write_date'],
  'stock.picking': ['name', 'state', 'move_ids', 'backorder_id', 'backorder_ids', 'purchase_id', 'picking_type_code', 'write_date'],
  'stock.move': ['name', 'state', 'picking_id', 'product_id', 'purchase_line_id', 'quantity', 'product_uom_qty', 'write_date'],
  'stock.quant': ['product_id', 'quantity', 'write_date'],
  'account.analytic.line': ['name', 'write_date'],
  'fleet.vehicle': ['name', 'write_date'],
  'maintenance.equipment': ['name', 'write_date'],
};

const fmt = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString().slice(0, 19).replace('T', ' ');
const scalar = (v: unknown) => (Array.isArray(v) ? v[0] : v ?? false);

function matchLeaf(row: Row, [field, op, value]: [string, string, unknown]): boolean {
  const v = scalar(row[field]);
  switch (op) {
    case '=': return v === value;
    case '!=': return v !== value;
    case 'in': return (value as unknown[]).includes(v);
    case '>': return (v as never) > (value as never);
    case '>=': return (v as never) >= (value as never);
    case '<': return (v as never) < (value as never);
    case '<=': return (v as never) <= (value as never);
    case 'ilike': return typeof v === 'string' && v.toLowerCase().includes(String(value).toLowerCase());
    default: throw new Error(`fakeOdoo: operator ${op} not modelled`);
  }
}

/** Odoo's prefix-notation domain: `&`/`|` take the next two terms, `!` one; top-level terms are and-ed. */
function matches(row: Row, domain: Domain): boolean {
  let i = 0;
  const term = (): boolean => {
    const t = domain[i++];
    if (t === '&') { const a = term(); const b = term(); return a && b; }
    if (t === '|') { const a = term(); const b = term(); return a || b; }
    if (t === '!') return !term();
    return matchLeaf(row, t as [string, string, unknown]);
  };
  let ok = true;
  while (i < domain.length) ok = term() && ok;
  return ok;
}

function sorter(order = 'id asc') {
  const keys = order.split(',').map((s) => s.trim().split(/\s+/) as [string, string?]);
  return (a: Row, b: Row) => {
    for (const [f, dir] of keys) {
      const x = scalar(a[f]) as never, y = scalar(b[f]) as never;
      if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  };
}

export interface FakeOdoo {
  fetch: typeof fetch;
  seed(model: string, rows: Array<Record<string, unknown>>): void;
  rows(model: string): Row[];
  failNext(kind: 'transport' | 'lost-response'): void;
  /** One-shot named fault: the step completes in Odoo, then its response is lost (`lost-response` = whichever call is next). */
  failAt(step: 'after-create' | 'after-post' | 'after-reconcile' | 'lost-response'): void;
  /** Capability faults for discovery: a model that 404s, a field `fields_get` omits, an operation `has_access` denies. */
  dropModel(model: string): void;
  dropField(model: string, field: string): void;
  denyAccess(model: string, operation: string): void;
  /** Every call that reached the fake, in order. */
  readonly calls: Array<{ model: string; method: string }>;
}

/** An Odoo exception: the fake answers it with the six-key failure body (bed report §10, V-OCI15). */
class OdooFailure extends Error {
  constructor(readonly status: number, readonly exception: string, message: string) { super(message); }
}
const userError = (message: string) => new OdooFailure(422, 'odoo.exceptions.UserError', message);
/** A validation failure the way the bed answers one (422 with an Odoo error body). */
const rejected = (message: string) => new OdooFailure(422, 'odoo.exceptions.ValidationError', message);

/** `doubleValidation`: Odoo's purchase approval setting; a confirmed order then waits in `to approve` (bed V-OPP1). */
export function createFakeOdoo({ key, doubleValidation = false }: { key: string; doubleValidation?: boolean }): FakeOdoo {
  const store = new Map<string, Map<number, Row>>();
  const table = (m: string) => store.get(m) ?? store.set(m, new Map()).get(m)!;
  let clock = 0;
  // Odoo numbers ids per model (purchase.order 1 and stock.picking 1 coexist); one shared sequence hid every cross-model id collision.
  const seq = new Map<string, number>();
  const newId = (m: string) => { const id = Math.max(seq.get(m) ?? 0, ...table(m).keys()) + 1; seq.set(m, id); return id; };
  let fault: 'transport' | 'lost-response' | null = null;
  let stepFault: 'after-create' | 'after-post' | 'after-reconcile' | null = null;
  let invoiceSeq = 0;
  let paymentSeq = 0;
  const calls: FakeOdoo['calls'] = [];
  const fields = Object.fromEntries(Object.entries(FIELDS).map(([m, f]) => [m, [...f]]));
  const denied = new Set<string>();
  const dropped = new Set<string>();

  const select = (model: string, body: Record<string, unknown>) => {
    const ctx = (body.context ?? {}) as { active_test?: boolean };
    const domain = (body.domain ?? []) as Domain;
    const found = [...table(model).values()]
      .filter((r) => ctx.active_test === false || r.active !== false)
      .filter((r) => matches(r, domain))
      .sort(sorter(body.order as string | undefined));
    const offset = Number(body.offset ?? 0);
    return found.slice(offset, body.limit ? offset + Number(body.limit) : undefined);
  };
  const pick = (r: Row, fields?: string[]) => (fields?.length ? Object.fromEntries([['id', r.id], ...fields.map((f) => [f, r[f] ?? false])]) : { ...r });

  /** What validating a picking books per move: the entered quantity once anything is entered (a move left at zero stays open), else the whole demand. */
  const splitPicking = (picking: Row) => {
    const moves = ((Array.isArray(picking.move_ids) ? picking.move_ids as number[] : []).map((id) => table('stock.move').get(id)).filter(Boolean)) as Row[];
    const anyEntered = moves.some((m) => Number(m.quantity ?? 0) > 0);
    return moves.map((move) => {
      const planned = Number(move.product_uom_qty ?? move.quantity ?? 0);
      const done = anyEntered ? Number(move.quantity ?? 0) : planned;
      return { move, planned, done, remaining: Math.max(0, planned - done) };
    });
  };

  const pickingIdsFromContext = (context: Record<string, unknown>) => {
    const ids = context.button_validate_picking_ids;
    if (Array.isArray(ids)) return ids.map(Number);
    const defaults = context.default_pick_ids;
    return Array.isArray(defaults)
      ? defaults.flatMap((command) => Array.isArray(command) && command[0] === 4 ? [Number(command[1])] : [])
      : [];
  };

  const receive = (product: unknown, quantity: number) => {
    if (quantity <= 0) return;
    const productId = scalar(product);
    let quant = [...table('stock.quant').values()].find((q) => scalar(q.product_id) === productId);
    if (!quant) {
      const quantId = newId('stock.quant');
      quant = { id: quantId, product_id: productId, quantity: 0 };
      table('stock.quant').set(quantId, quant);
    }
    quant.quantity = Number(quant.quantity) + quantity;
    quant.write_date = fmt(++clock);
  };

  const completePicking = (picking: Row) => {
    const completedMoveIds: number[] = [];
    const remaining: Array<{ move: Row; quantity: number }> = [];

    for (const { move, done, remaining: left } of splitPicking(picking)) {
      if (done > 0) {
        Object.assign(move, { quantity: done, product_uom_qty: done, state: 'done', write_date: fmt(++clock) });
        receive(move.product_id, done);
        const line = table('purchase.order.line').get(Number(scalar(move.purchase_line_id)));
        if (line) Object.assign(line, { qty_received: Number(line.qty_received ?? 0) + done, write_date: fmt(++clock) });
        completedMoveIds.push(move.id);
      } else table('stock.move').delete(move.id);   // untouched: the whole demand moves to the backorder
      if (left > 0) remaining.push({ move, quantity: left });
    }

    Object.assign(picking, { state: 'done', move_ids: completedMoveIds, write_date: fmt(++clock) });
    if (!remaining.length) return;

    const backorderId = newId('stock.picking');
    const backorderMoveIds = remaining.map(({ move, quantity }) => {
      const id = newId('stock.move');
      table('stock.move').set(id, {
        ...move,
        id,
        picking_id: backorderId,
        quantity: quantity,
        product_uom_qty: quantity,
        state: 'assigned',
        write_date: fmt(++clock),
      });
      return id;
    });
    table('stock.picking').set(backorderId, {
      ...picking,
      id: backorderId,
      name: `${String(picking.name ?? 'WH/IN')}-BO`,
      state: 'assigned',
      move_ids: backorderMoveIds,
      backorder_id: picking.id,
      backorder_ids: [],
      write_date: fmt(++clock),
    });
    picking.backorder_ids = [...(Array.isArray(picking.backorder_ids) ? picking.backorder_ids as number[] : []), backorderId];
    picking.write_date = fmt(++clock);
  };

  /** Confirming an order with lines opens its incoming transfer: one move per line, the demand pre-filled as the done quantity (bed V-OPP3/4). */
  const openReceipt = (orderId: number) => {
    const order = table('purchase.order').get(orderId);
    const lineIds = (order?.order_line as number[] | undefined) ?? [];
    if (!order || !lineIds.length) return;
    const pickingId = newId('stock.picking');
    const moveIds = lineIds.map((lineId) => {
      const line = table('purchase.order.line').get(lineId)!;
      const id = newId('stock.move');
      table('stock.move').set(id, { id, active: true, picking_id: pickingId, product_id: line.product_id, purchase_line_id: lineId, product_uom_qty: Number(line.product_qty), quantity: Number(line.product_qty), state: 'assigned', write_date: fmt(++clock) });
      return id;
    });
    table('stock.picking').set(pickingId, { id: pickingId, active: true, name: `WH/IN/${String(pickingId).padStart(5, '0')}`, state: 'assigned', purchase_id: orderId, picking_type_code: 'incoming', move_ids: moveIds, backorder_ids: [], create_date: fmt(++clock), write_date: fmt(clock) });
  };

  /** One2many commands on a purchase order: create (0), update (1) and, as on the bed, a refused remove (2) once confirmed (V-OPP9). */
  const applyLines = (orderId: number, commands: unknown[][]) => {
    const order = table('purchase.order').get(orderId)!;
    for (const [op, lineId, vals] of commands) {
      const line = typeof lineId === 'number' ? table('purchase.order.line').get(lineId) : undefined;
      if (op === 0) {
        const id = newId('purchase.order.line');
        table('purchase.order.line').set(id, { qty_received: 0, qty_invoiced: 0, ...(vals as object), id, order_id: orderId, write_date: fmt(++clock) });
        order.order_line = [...((order.order_line as number[] | undefined) ?? []), id];
      } else if (op === 1 && line) Object.assign(line, vals as object, { write_date: fmt(++clock) });
      else if (op === 2) throw rejected('Cannot delete a purchase order line which is not in draft or cancelled state');
    }
    // no tax model: the untaxed and the total figure coincide
    order.amount_untaxed = order.amount_total = ((order.order_line as number[] | undefined) ?? []).reduce((sum, id) => {
      const l = table('purchase.order.line').get(id)!;
      return sum + Number(l.product_qty) * Number(l.price_unit);
    }, 0);
  };

  const transition = (model: string, body: Record<string, unknown>, state: string) => {
    for (const id of body.ids as number[]) { const row = table(model).get(id); if (row) Object.assign(row, { state, write_date: fmt(++clock) }); }
    return true;
  };

  // --- customer invoices, inbound payments and the register wizard (bed report §10). Purchase documents never take this path. ---
  const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  const units = (c: number) => c / 100;
  const isCustomerMove = (r: Row | undefined) => r?.move_type === 'out_invoice' || r?.move_type === 'out_refund';
  const tupleIds = (v: unknown): number[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    let ids: number[] = [];
    for (const cmd of v as unknown[][]) {
      if (cmd[0] === 6) ids = [...(cmd[2] as number[])];
      else if (cmd[0] === 5) ids = [];
      else if (cmd[0] === 4) ids.push(Number(cmd[1]));
    }
    return ids;
  };
  const moveLines = (moveId: number, display: string) => [...table('account.move.line').values()].filter((l) => l.move_id === moveId && l.display_type === display);
  /** Odoo's own money for a move: per-line tax in cents, summed (an approximation of Odoo's per-tax rounding). */
  const totals = (moveId: number) => {
    let untaxed = 0;
    const byTax = new Map<number, number>();
    for (const l of moveLines(moveId, 'product')) {
      const lineCents = Math.round(Number(l.quantity ?? 1) * Number(l.price_unit ?? 0) * 100);
      untaxed += lineCents;
      for (const t of l.tax_ids as number[]) byTax.set(t, (byTax.get(t) ?? 0) + Math.round(lineCents * Number(table('account.tax').get(t)?.amount ?? 0) / 100));
    }
    const tax = [...byTax.values()].reduce((a, b) => a + b, 0);
    return { untaxed, tax, byTax, total: untaxed + tax };
  };
  const createInvoice = (vals: Record<string, unknown>) => {
    const id = newId('account.move');
    const { invoice_line_ids: tuples, ...rest } = vals;
    table('account.move').set(id, { active: true, state: 'draft', name: false, payment_state: 'not_paid', ...rest, id, write_date: fmt(++clock) });
    for (const tuple of (tuples as unknown[][] | undefined) ?? []) {
      const l = tuple[2] as Record<string, unknown>;
      const product = table('product.product').get(Number(l.product_id));
      const lineId = newId('account.move.line');
      table('account.move.line').set(lineId, {
        id: lineId, move_id: id, display_type: 'product', name: l.name ?? false, product_id: l.product_id ?? false, quantity: l.quantity ?? 1, price_unit: l.price_unit ?? 0,
        tax_ids: tupleIds(l.tax_ids) ?? (product?.taxes_id as number[] | undefined) ?? [], account_id: l.account_id ?? product?.income_account_id ?? false,
        analytic_distribution: l.analytic_distribution ?? false, balance: -units(Math.round(Number(l.quantity ?? 1) * Number(l.price_unit ?? 0) * 100)), write_date: fmt(clock),
      });
    }
    const t = totals(id);
    Object.assign(table('account.move').get(id)!, { amount_untaxed: units(t.untaxed), amount_tax: units(t.tax), amount_total: units(t.total), amount_residual: units(t.total) });
    return id;
  };
  const postInvoice = (row: Row) => {
    if (row.state !== 'draft') throw userError('The entry must be in draft state to be posted.');
    if (!row.partner_id) throw userError('The field Customer is required.');
    const t = totals(row.id);
    if (t.total < 0) throw userError('An invoice with a negative total cannot be posted.');
    const prefix = row.move_type === 'out_refund' ? 'RINV' : 'INV';
    Object.assign(row, { state: 'posted', name: `${prefix}/2026/${String(++invoiceSeq).padStart(5, '0')}`, write_date: fmt(++clock) });
    for (const [taxId, c] of t.byTax) {
      const id = newId('account.move.line');
      table('account.move.line').set(id, { id, move_id: row.id, display_type: 'tax', tax_line_id: taxId, account_id: 122, balance: -units(c), write_date: fmt(clock) });
    }
    const id = newId('account.move.line');
    table('account.move.line').set(id, { id, move_id: row.id, display_type: 'payment_term', account_type: 'asset_receivable', partner_id: row.partner_id, balance: units(t.total), amount_residual: units(t.total), write_date: fmt(clock) });
    if (t.total === 0) Object.assign(row, { amount_residual: 0, payment_state: 'paid' });
  };
  const postInboundPayment = (row: Row) => {
    const moveId = newId('account.move');
    const name = `PBNK1/2026/${String(++paymentSeq).padStart(5, '0')}`;
    table('account.move').set(moveId, { id: moveId, move_type: 'entry', state: 'posted', name, write_date: fmt(++clock) });
    const lineId = newId('account.move.line');
    table('account.move.line').set(lineId, { id: lineId, move_id: moveId, display_type: 'payment_term', account_type: 'asset_receivable', partner_id: row.partner_id, balance: -units(cents(row.amount)), amount_residual: -units(cents(row.amount)), write_date: fmt(clock) });
    Object.assign(row, { state: 'paid', is_reconciled: false, is_matched: false, move_id: [moveId, name], write_date: fmt(++clock) });
  };
  const settleInvoice = (invoice: Row, residualCents: number) => {
    Object.assign(invoice, { amount_residual: units(residualCents), payment_state: residualCents === 0 ? 'paid' : 'partial', write_date: fmt(++clock) });
  };
  const createPayments = (b: Record<string, unknown>) => {
    const wizard = table('account.payment.register').get((b.ids as number[])[0]);
    const invoice = wizard ? table('account.move').get(Number(wizard.invoice_id)) : undefined;
    if (!wizard || !invoice) throw new OdooFailure(404, 'odoo.exceptions.MissingError', 'Record does not exist or has been deleted.');
    const residual = cents(invoice.amount_residual);
    const amount = wizard.amount === undefined ? residual : cents(wizard.amount);
    const difference = wizard.payment_difference_handling === 'reconcile' && amount < residual ? residual - amount : 0;
    const moveId = newId('account.move');
    const name = `PBNK1/2026/${String(++paymentSeq).padStart(5, '0')}`;
    table('account.move').set(moveId, { id: moveId, move_type: 'entry', state: 'posted', name, write_date: fmt(++clock) });
    if (difference > 0) {
      const lineId = newId('account.move.line');
      table('account.move.line').set(lineId, { id: lineId, move_id: moveId, display_type: 'product', account_id: wizard.writeoff_account_id ?? false, name: wizard.writeoff_label ?? false, balance: units(difference), write_date: fmt(clock) });
    }
    const paymentId = newId('account.payment');
    table('account.payment').set(paymentId, {
      id: paymentId, payment_type: 'inbound', partner_type: 'customer', partner_id: invoice.partner_id, amount: units(amount), state: 'paid', memo: wizard.communication ?? false,
      journal_id: wizard.journal_id ?? false, date: wizard.payment_date ?? false, is_reconciled: true, is_matched: false, move_id: [moveId, name], write_date: fmt(++clock),
    });
    settleInvoice(invoice, Math.max(0, residual - amount - difference));
    return { name: 'Payments', type: 'ir.actions.act_window', res_model: 'account.payment', context: { create: false }, view_mode: 'form', res_id: paymentId };
  };

  const methods: Record<string, (model: string, body: Record<string, unknown>) => unknown> = {
    search_read: (m, b) => select(m, b).map((r) => pick(r, b.fields as string[] | undefined)),
    search: (m, b) => select(m, b).map((r) => r.id),
    search_count: (m, b) => select(m, { ...b, limit: undefined, offset: undefined }).length,
    read: (m, b) => (b.ids as number[]).flatMap((id) => { const r = table(m).get(id); return r ? [pick(r, b.fields as string[])] : []; }),
    create: (m, b) => (b.vals_list as Array<Record<string, unknown>>).map((vals) => {
      if (m === 'account.move' && (vals.move_type === 'out_invoice' || vals.move_type === 'out_refund')) return createInvoice(vals);
      if (m === 'account.move' && isModelledBill(vals)) return createBill({ table, nextId: newId, stamp: () => fmt(++clock) }, vals);
      if (m === 'account.payment' && isModelledPayment(vals)) return createPayment({ table, nextId: newId, stamp: () => fmt(++clock) }, vals);
      if (m === 'account.payment.register') {
        const invoice = table('account.move').get(Number(((b.context ?? {}) as { active_ids?: number[] }).active_ids?.[0]));
        if (!invoice || invoice.state !== 'posted' || cents(invoice.amount_residual) <= 0) throw userError('You can only register payments for open invoices.');
        const id = newId(m);
        table(m).set(id, { ...vals, id, invoice_id: invoice.id, write_date: fmt(++clock) });
        return id;
      }
      const id = newId(m);
      const { order_line: lines, ...rest } = vals;
      const stamp = fmt(++clock);
      table(m).set(id, { active: true, ...(m === 'purchase.order' ? { name: `P${String(id).padStart(5, '0')}`, state: 'draft' } : {}), ...(m === 'purchase.order' && Array.isArray(lines) ? rest : vals), id, create_date: stamp, write_date: stamp });
      if (m === 'purchase.order' && Array.isArray(lines)) { applyLines(id, lines as unknown[][]); }
      return id;
    }),
    write: (m, b) => {
      for (const id of b.ids as number[]) {
        const r = table(m).get(id);
        if (!r) continue;
        const { order_line: lines, ...rest } = b.vals as Record<string, unknown>;
        table(m).set(id, { ...r, ...(m === 'purchase.order' && lines ? rest : (b.vals as object)), id, write_date: fmt(++clock) });
        if (m === 'purchase.order' && Array.isArray(lines)) applyLines(id, lines as unknown[][]);
      }
      return true;
    },
    unlink: (m, b) => { for (const id of b.ids as number[]) table(m).delete(id); return true; },
    fields_get: (m) => Object.fromEntries(fields[m].map((f) => [f, { type: 'char' }])),
    has_access: (m, b) => !denied.has(`${m}:${b.operation}`),
    button_confirm: (m, b) => {
      transition(m, b, m === 'purchase.order' && doubleValidation ? 'to approve' : 'purchase');
      if (m === 'purchase.order' && !doubleValidation) for (const id of b.ids as number[]) openReceipt(id);
      return true;
    },
    button_approve: (m, b) => {
      transition(m, b, 'purchase');
      if (m === 'purchase.order') for (const id of b.ids as number[]) openReceipt(id);
      return true;
    },
    button_validate: (m, b) => {
      const ids = b.ids as number[];
      const hasPartialMove = ids.some((id) => {
        const picking = table(m).get(id);
        if (!picking || picking.state === 'done') return false;
        return splitPicking(picking).some((x) => x.remaining > 0);
      });
      if (hasPartialMove) {
        return {
          type: 'ir.actions.act_window',
          res_model: 'stock.backorder.confirmation',
          context: {
            button_validate_picking_ids: ids,
            default_pick_ids: ids.map((id) => [4, id]),
          },
        };
      }
      for (const id of ids) {
        const picking = table(m).get(id);
        if (picking && picking.state !== 'done') completePicking(picking);
      }
      return true;
    },
    process: (_m, b) => {
      const context = (b.context ?? {}) as Record<string, unknown>;
      for (const id of pickingIdsFromContext(context)) {
        const picking = table('stock.picking').get(id);
        if (picking && picking.state !== 'done') completePicking(picking);
      }
      return true;
    },
    action_post: (m, b) => {
      for (const id of b.ids as number[]) {
        const row = table(m).get(id);
        if (m === 'account.move' && row?.move_type === 'in_invoice') postBill({ table, nextId: newId, stamp: () => fmt(++clock) }, row);
        else if (m === 'account.move' && isCustomerMove(row)) postInvoice(row!);
        else if (m === 'account.payment' && row?.payment_type === 'inbound' && row.partner_type === 'customer') postInboundPayment(row);
        else if (m === 'account.payment' && row && 'move_id' in row) postPayment({ table, nextId: newId, stamp: () => fmt(++clock) }, row);
        else transition(m, { ids: [id] }, m === 'account.payment' ? 'paid' : 'posted');
      }
      return true;
    },
    action_create_payments: (_m, b) => createPayments(b),
    reconcile: (m, b) => {
      const rows = (b.ids as number[]).flatMap((id) => { const row = table(m).get(id); return row ? [row] : []; });
      if (!rows.some((r) => r.account_type === 'asset_receivable')) { reconcileLines({ table, nextId: newId, stamp: () => fmt(++clock) }, rows); return true; }
      const debits = rows.filter((r) => Number(r.amount_residual ?? r.balance) > 0);
      const credits = rows.filter((r) => Number(r.amount_residual ?? r.balance) < 0);
      for (const debit of debits) for (const credit of credits) {
        const d = Math.round(Number(debit.amount_residual ?? debit.balance) * 100);
        const c = Math.round(Number(credit.amount_residual ?? credit.balance) * 100);
        const applied = Math.min(d, -c);
        debit.amount_residual = (d - applied) / 100;
        credit.amount_residual = (c + applied) / 100;
      }
      // Customer documents follow their receivable line: the invoice's residual and the payment's reconciled flag.
      for (const moveId of new Set(rows.map((r) => r.move_id).filter((v) => v !== undefined))) {
        const receivable = [...table('account.move.line').values()].find((l) => l.move_id === moveId && l.account_type === 'asset_receivable');
        if (!receivable) continue;
        const residual = cents(receivable.amount_residual);
        const move = table('account.move').get(Number(moveId));
        if (isCustomerMove(move)) settleInvoice(move!, residual);
        for (const p of table('account.payment').values()) if (Array.isArray(p.move_id) && p.move_id[0] === moveId) Object.assign(p, { is_reconciled: residual === 0, is_matched: residual === 0 });
      }
      return true;
    },
  };

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const [, model, method] = /\/json\/2\/([^/]+)\/([^/]+)$/.exec(String(url)) ?? [];
    calls.push({ model, method });
    const f = fault;
    fault = null;
    if (f === 'transport') throw new TypeError('error sending request: connection reset');
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== `bearer ${key}`) return Response.json({ name: 'odoo.exceptions.AccessDenied', message: 'Access Denied' }, { status: 401 });
    const handler = methods[method];
    const capability = method === 'fields_get' || method === 'has_access';
    if (!handler || dropped.has(model) || (capability && !fields[model])) return Response.json({ name: 'werkzeug.exceptions.NotFound', message: '404 Not Found', arguments: [], context: {}, debug: '' }, { status: 404 });
    let result: unknown;
    try {
      result = handler(model, JSON.parse(String(init?.body ?? '{}')));
    } catch (e) {
      if (e instanceof Rejected) return Response.json({ name: 'odoo.exceptions.ValidationError', message: e.message, arguments: [e.message], context: {}, debug: '' }, { status: 422 });
      if (e instanceof RejectedPayment) return Response.json({ name: 'odoo.exceptions.ValidationError', message: e.message, arguments: [e.message], context: {}, debug: '' }, { status: 422 });
      if (!(e instanceof OdooFailure)) throw e;
      return Response.json({ name: e.exception, message: e.message, arguments: [e.message], timestamp: 0, context: {}, debug: 'synthetic' }, { status: e.status });
    }
    const atStep = (stepFault === 'after-create' && method === 'create' && (model === 'account.move' || model === 'account.payment'))
      || (stepFault === 'after-post' && method === 'action_post')
      || (stepFault === 'after-reconcile' && (method === 'reconcile' || method === 'action_create_payments'));
    if (atStep) stepFault = null;
    if (f === 'lost-response' || atStep) throw new TypeError('error sending request: connection reset');
    return Response.json(result);
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    calls,
    seed(model, rows) {
      for (const r of rows) {
        const id = Number(r.id ?? newId(model));
        table(model).set(id, { active: true, write_date: fmt(clock), ...r, id });
      }
    },
    rows: (model) => [...table(model).values()],
    failNext(kind) { fault = kind; },
    failAt(step) { if (step === 'lost-response') fault = step; else stepFault = step; },
    dropModel(model) { delete fields[model]; dropped.add(model); },
    dropField(model, field) { fields[model] = fields[model].filter((f) => f !== field); },
    denyAccess(model, operation) { denied.add(`${model}:${operation}`); },
  };
}
