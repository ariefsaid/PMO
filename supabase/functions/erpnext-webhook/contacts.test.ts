import { assert, assertEquals } from 'jsr:@std/assert';
import { contactDb } from '../_shared/erpnextContacts.fixtures.ts';
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => {
  handler = h;
  return { finished: Promise.resolve() };
};
await import('./index.ts');
const ORG = '00000000-0000-4000-8000-000000000073';
const SECRET = 'synthetic-webhook-secret';
async function run(state?: string, mapped = false) {
  const db = contactDb({
    companies: [{ id: 'company-1', org_id: ORG }],
    contacts: mapped ? [{ id: 'contact-1', org_id: ORG, company_id: 'company-1', full_name: 'Earlier Contact', erp_modified: '2026-01-01' }] : [],
    external_refs: [
      { org_id: ORG, domain: 'companies', pmo_record_id: 'company-1', external_record_id: 'Customer:CUST-1' },
      ...(mapped ? [{ org_id: ORG, domain: 'companies', pmo_record_id: 'contact-1', external_record_id: 'Contact:CON-1' }] : []),
    ],
    external_command_outbox: state ? [{ org_id: ORG, domain: 'companies', operation: 'create', state, payload: { erp_doc_kind: 'contact' } }] : [],
    profiles: [{ id: 'admin-1', org_id: ORG, status: 'active', role: 'Admin' }],
    notifications: [],
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', activated_at: '2026-01-01', webhook_secret_ref: 'synthetic-webhook', config: {} }],
    external_domain_ownership: [{ org_id: ORG, external_tier: 'erpnext', domain: 'companies' }],
  });
  const oldFetch = globalThis.fetch, oldGet = Deno.env.get, oldInterval = globalThis.setInterval;
  const intervals: ReturnType<typeof setInterval>[] = [];
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = oldInterval(...args); intervals.push(id); return id;
  }) as typeof setInterval;
  (Deno.env as unknown as { get: typeof Deno.env.get }).get = (k: string) => ({
    SUPABASE_URL: 'https://supabase.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', EXTERNAL_CONNECT_ENABLED: 'true',
  } as Record<string, string>)[k];
  globalThis.fetch = (async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url), table = url.pathname.split('/').at(-1)!;
    if (url.pathname === '/rest/v1/rpc/read_vault_secret') return new Response(JSON.stringify(SECRET), { headers: { 'content-type': 'application/json' } });
    if (!url.pathname.startsWith('/rest/v1/')) throw new Error('unexpected fetch');
    let q = req.method === 'PATCH' ? db.client.from(table).update(await req.json()) : db.client.from(table).select('*');
    for (const [key, value] of url.searchParams) {
      if (value.startsWith('eq.')) q = q.eq(key, value.slice(3));
      if (value.startsWith('in.(')) q = q.in(key, value.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, '')));
    }
    if (req.method === 'POST') await db.client.from(table).insert(await req.json());
    else if (req.method === 'PATCH') await q;
    const { data } = await q;
    const out = req.headers.get('accept')?.includes('vnd.pgrst.object') ? data?.[0] ?? null : data;
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const body = JSON.stringify({ doctype: 'Contact', name: 'CON-1', modified: '2026-10-05 10:00:00', docstatus: 0,
      doc: { name: 'CON-1', first_name: 'Example Contact', links: [{ link_doctype: 'Customer', link_name: 'CUST-1' }] } });
    const bytes = new TextEncoder(), key = await crypto.subtle.importKey('raw', bytes.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes.encode(body)));
    const signature = btoa(String.fromCharCode(...sig));
    const response = await handler(new Request('https://edge.example.test', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-frappe-webhook-signature': signature }, body,
    }));
    return { db, status: response.status, body: await response.json() };
  } finally {
    intervals.forEach(clearInterval);
    globalThis.setInterval = oldInterval;
    globalThis.fetch = oldFetch;
    (Deno.env as unknown as { get: typeof Deno.env.get }).get = oldGet;
  }
}
Deno.test('AC-CON-001 signed Contact webhook defers competing adoption for every unresolved outbound state', async () => {
  for (const state of ['pending', 'committing', 'committed', 'quarantined', 'held']) {
    const result = await run(state);
    assertEquals(result.status, 500, JSON.stringify(result.body));
    assertEquals(result.db.rows.notifications.length, 0);
    assertEquals(result.db.rows.contacts.length, 0);
    assert(!result.db.rows.external_refs.some(r => r.external_record_id === 'Contact:CON-1'));
  }
});
Deno.test('AC-CON-001 signed Contact webhook adopts normally without unresolved outbound create', async () => {
  const result = await run();
  assertEquals(result.status, 200, JSON.stringify(result.body));
  assertEquals(result.db.rows.contacts.length, 1);
});
Deno.test('AC-CON-001 signed Contact webhook continues mapped updates beside an unresolved create', async () => {
  const result = await run('held', true);
  assertEquals(result.status, 200, JSON.stringify(result.body));
  assertEquals(result.db.rows.contacts.length, 1);
  assertEquals(result.db.rows.contacts[0].full_name, 'Example Contact');
});
