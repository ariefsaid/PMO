/** A fake ERPNext for the connect-time reads (list + count): shared by the adapter test and the contract harness. */
import type { ErpClientDeps } from './client.ts';

type Row = Record<string, unknown>;
type Filter = [string, string, unknown];

/** An in-memory ERPNext answering the list and count paths the adapter reads; records every request. */
export function fakeErp(tables: Record<string, Row[]>) {
  const seen: Array<{ method: string; path: string; filters: Filter[] }> = [];
  const apply = (rows: Row[], filters: Filter[]) => rows.filter((r) => filters.every(([f, op, v]) =>
    op === '=' ? r[f] === v : op === '>' ? String(r[f]) > String(v) : false));
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const filters = JSON.parse(u.searchParams.get('filters') ?? '[]') as Filter[];
    seen.push({ method: init?.method ?? 'GET', path: u.pathname + u.search, filters });
    if (u.pathname === '/api/method/frappe.client.get_count') {
      return new Response(JSON.stringify({ message: apply(tables[u.searchParams.get('doctype')!] ?? [], filters).length }), { status: 200 });
    }
    const doctype = decodeURIComponent(u.pathname.split('/').pop()!);
    const rows = apply(tables[doctype] ?? [], filters).sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .slice(0, Number(u.searchParams.get('limit_page_length')));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }) as typeof fetch;
  const client: ErpClientDeps = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.test', maxRetries: 0 };
  return { client, seen };
}
