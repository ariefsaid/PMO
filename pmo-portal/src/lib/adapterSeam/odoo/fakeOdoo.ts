/**
 * Test-only in-memory Odoo speaking JSON-2 over a `fetch` mock (bed report §1, §3): per-model row maps, the
 * domain subset the adapter uses, `write_date` stamping, 401 on a wrong key, and one-shot transport faults.
 */
type Row = Record<string, unknown> & { id: number };
type Domain = unknown[];

/** The fields `fields_get` reports per model (the adapter only asks which exist). Any other model answers 404. */
const FIELDS: Record<string, string[]> = {
  'res.partner': ['name', 'vat', 'ref', 'email', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'company_id', 'write_date'],
  'res.company': ['name', 'currency_id', 'partner_id', 'write_date'],
  'product.product': ['default_code', 'name', 'uom_id', 'purchase_ok', 'sale_ok', 'is_storable', 'company_id', 'active', 'write_date'],
  'uom.uom': ['name', 'relative_factor', 'relative_uom_id', 'active', 'write_date'],
  'stock.warehouse': ['name', 'code', 'lot_stock_id', 'view_location_id', 'company_id', 'active', 'write_date'],
  'stock.location': ['complete_name', 'usage', 'location_id', 'warehouse_id', 'company_id', 'active', 'write_date'],
  'account.account': ['code', 'name', 'account_type', 'company_ids', 'active', 'write_date'],
  'account.tax': ['name', 'amount', 'type_tax_use', 'company_id', 'active', 'write_date'],
  'account.analytic.plan': ['name', 'write_date'],
  'account.analytic.account': ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'],
  'purchase.order': ['name', 'write_date'],
  'account.move': ['name', 'write_date'],
  'stock.picking': ['name', 'write_date'],
  'stock.move': ['name', 'write_date'],
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

export function createFakeOdoo({ key }: { key: string }): FakeOdoo {
  const store = new Map<string, Map<number, Row>>();
  const table = (m: string) => store.get(m) ?? store.set(m, new Map()).get(m)!;
  let clock = 0;
  let nextId = 1000;
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

  const methods: Record<string, (model: string, body: Record<string, unknown>) => unknown> = {
    search_read: (m, b) => select(m, b).map((r) => pick(r, b.fields as string[] | undefined)),
    search: (m, b) => select(m, b).map((r) => r.id),
    search_count: (m, b) => select(m, { ...b, limit: undefined, offset: undefined }).length,
    read: (m, b) => (b.ids as number[]).flatMap((id) => { const r = table(m).get(id); return r ? [pick(r, b.fields as string[])] : []; }),
    create: (m, b) => (b.vals_list as Array<Record<string, unknown>>).map((vals) => {
      const id = nextId++;
      table(m).set(id, { active: true, ...vals, id, write_date: fmt(++clock) });
      return id;
    }),
    write: (m, b) => {
      for (const id of b.ids as number[]) { const r = table(m).get(id); if (r) table(m).set(id, { ...r, ...(b.vals as object), id, write_date: fmt(++clock) }); }
      return true;
    },
    unlink: (m, b) => { for (const id of b.ids as number[]) table(m).delete(id); return true; },
    fields_get: (m) => Object.fromEntries(fields[m].map((f) => [f, { type: 'char' }])),
    has_access: (m, b) => !denied.has(`${m}:${b.operation}`),
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
    const result = handler(model, JSON.parse(String(init?.body ?? '{}')));
    if (f === 'lost-response') throw new TypeError('error sending request: connection reset');
    return Response.json(result);
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    calls,
    seed(model, rows) {
      for (const r of rows) {
        const id = Number(r.id ?? nextId++);
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
