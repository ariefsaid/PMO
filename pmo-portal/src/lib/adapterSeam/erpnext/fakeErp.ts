/** A fake ERPNext for the connect-time reads (list + count) and master creates: shared by the adapter test and the contract harness. */
import type { ErpClientDeps } from './client.ts';

type Row = Record<string, unknown>;
type Filter = [string, string, unknown];
const PREFIX: Record<string, string> = { Supplier: 'SUP', Customer: 'CUS', Project: 'PROJ' };
/** A real ERP refuses a party or item filed under a missing or group-type group node; the fake does the same, so a hard-coded root node cannot pass. */
const GROUP_LINKS: Record<string, [field: string, groupDoctype: string]> = {
  Supplier: ['supplier_group', 'Supplier Group'], Customer: ['customer_group', 'Customer Group'], Item: ['item_group', 'Item Group'],
};
/** What a fresh ERP site holds: the root node (a group) and one leaf under it. A caller's own table of the same name wins. */
const SITE_DEFAULTS: Record<string, Row[]> = {
  'Customer Group': [{ name: 'All Customer Groups', is_group: 1 }, { name: 'Commercial', is_group: 0 }],
  'Supplier Group': [{ name: 'All Supplier Groups', is_group: 1 }, { name: 'Services', is_group: 0 }],
  'Item Group': [{ name: 'All Item Groups', is_group: 1 }, { name: 'Products', is_group: 0 }],
};

/** An in-memory ERPNext answering the list and count paths the adapter reads; records every request. */
export function fakeErp(tables: Record<string, Row[]>) {
  for (const [doctype, rows] of Object.entries(SITE_DEFAULTS)) tables[doctype] ??= rows.map((r) => ({ ...r }));
  const seen: Array<{ method: string; path: string; filters: Filter[] }> = [];
  let armed: 'transport' | 'lost-response' | 'reject' | null = null;
  const apply = (rows: Row[], filters: Filter[]) => rows.filter((r) => filters.every(([f, op, v]) =>
    op === '=' ? r[f] === v : op === '>' ? String(r[f]) > String(v) : false));
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const filters = JSON.parse(u.searchParams.get('filters') ?? '[]') as Filter[];
    seen.push({ method: init?.method ?? 'GET', path: u.pathname + u.search, filters });
    if (u.pathname === '/api/method/frappe.client.get_count') {
      return new Response(JSON.stringify({ message: apply(tables[u.searchParams.get('doctype')!] ?? [], filters).length }), { status: 200 });
    }
    const [, , , resource, single] = u.pathname.split('/').map(decodeURIComponent);
    const doctype = single ?? resource;
    if (single !== undefined && init?.method !== 'POST') {
      // a single document by name: Settings doctypes always exist on a real site, so an unset one reads as empty
      return new Response(JSON.stringify({ data: (tables[resource] ?? []).find((r) => r.name === single) ?? { name: single } }), { status: 200 });
    }
    if (init?.method === 'POST') {
      const fault = armed; armed = null;
      if (fault === 'transport') return new Response('{}', { status: 503 });
      if (fault === 'reject') return new Response(JSON.stringify({ exc_type: 'ValidationError', message: 'Value missing' }), { status: 417 });
      const body = JSON.parse(String(init.body)) as Row;
      const link = GROUP_LINKS[doctype];
      if (link) {
        const group = (tables[link[1]] ?? []).find((g) => g.name === body[link[0]]);
        const message = !group ? `Could not find ${link[1]}: ${String(body[link[0]])}`
          : group.is_group === 1 ? `Cannot select a Group type ${link[1]}. Please select a non-group ${link[1]}.` : null;
        if (message) return new Response(JSON.stringify({ exc_type: 'ValidationError', message }), { status: 417 });
      }
      // Items are named by their code; every other master takes a series name, like the ERP's own naming.
      const doc = { ...body, name: doctype === 'Item' ? String(body.item_code) : `${PREFIX[doctype] ?? doctype}-${(tables[doctype]?.length ?? 0) + 1}` };
      (tables[doctype] ??= []).push(doc);
      return fault === 'lost-response' ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ data: doc }), { status: 200 });
    }
    const rows = apply(tables[doctype] ?? [], filters).sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .slice(0, Number(u.searchParams.get('limit_page_length')));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }) as typeof fetch;
  const client: ErpClientDeps = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.test', maxRetries: 0 };
  return { client, seen, arm: (fault: 'transport' | 'lost-response' | 'reject') => { armed = fault; } };
}
