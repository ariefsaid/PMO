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
  'account.tax': ['name', 'amount', 'type_tax_use', 'company_id', 'active', 'write_date'],
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
  /** Capability faults for discovery: a model that 404s, a field `fields_get` omits, an operation `has_access` denies. */
  dropModel(model: string): void;
  dropField(model: string, field: string): void;
  denyAccess(model: string, operation: string): void;
  /** Every call that reached the fake, in order. */
  readonly calls: Array<{ model: string; method: string }>;
}


/** `doubleValidation`: Odoo's purchase approval setting; a confirmed order then waits in `to approve` (bed V-OPP1). */
export function createFakeOdoo({ key, doubleValidation = false }: { key: string; doubleValidation?: boolean }): FakeOdoo {
  const store = new Map<string, Map<number, Row>>();
  const table = (m: string) => store.get(m) ?? store.set(m, new Map()).get(m)!;
  let clock = 0;
  // Odoo numbers ids per model (purchase.order 1 and stock.picking 1 coexist); one shared sequence hid every cross-model id collision.
  const seq = new Map<string, number>();
  const newId = (m: string) => { const id = Math.max(seq.get(m) ?? 0, ...table(m).keys()) + 1; seq.set(m, id); return id; };
  let fault: 'transport' | 'lost-response' | null = null;
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
      else if (op === 2) throw new Rejected('Cannot delete a purchase order line which is not in draft or cancelled state');
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

  const methods: Record<string, (model: string, body: Record<string, unknown>) => unknown> = {
    search_read: (m, b) => select(m, b).map((r) => pick(r, b.fields as string[] | undefined)),
    search: (m, b) => select(m, b).map((r) => r.id),
    search_count: (m, b) => select(m, { ...b, limit: undefined, offset: undefined }).length,
    read: (m, b) => (b.ids as number[]).flatMap((id) => { const r = table(m).get(id); return r ? [pick(r, b.fields as string[])] : []; }),
    create: (m, b) => (b.vals_list as Array<Record<string, unknown>>).map((vals) => {
      if (m === 'account.move' && isModelledBill(vals)) return createBill({ table, nextId: newId, stamp: () => fmt(++clock) }, vals);
      if (m === 'account.payment' && isModelledPayment(vals)) return createPayment({ table, nextId: newId, stamp: () => fmt(++clock) }, vals);
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
        else if (m === 'account.payment' && row && 'move_id' in row) postPayment({ table, nextId: newId, stamp: () => fmt(++clock) }, row);
        else transition(m, { ids: [id] }, m === 'account.payment' ? 'paid' : 'posted');
      }
      return true;
    },
    reconcile: (m, b) => {
      reconcileLines({ table, nextId: newId, stamp: () => fmt(++clock) }, (b.ids as number[]).flatMap((id) => { const row = table(m).get(id); return row ? [row] : []; }));
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
    try { result = handler(model, JSON.parse(String(init?.body ?? '{}'))); } catch (err) {
      if (!(err instanceof Rejected || err instanceof RejectedPayment)) throw err;
      return Response.json({ name: 'odoo.exceptions.ValidationError', message: err.message, arguments: [err.message], context: {}, debug: '' }, { status: 422 });
    }
    if (f === 'lost-response') throw new TypeError('error sending request: connection reset');
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
    dropModel(model) { delete fields[model]; dropped.add(model); },
    dropField(model, field) { fields[model] = fields[model].filter((f) => f !== field); },
    denyAccess(model, operation) { denied.add(`${model}:${operation}`); },
  };
}
