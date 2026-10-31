import { describe, expect, it } from 'vitest';
import { bindCall, odooCall, OdooError } from './client.ts';
import { ERR_404_JSON } from './__fixtures__/json2.ts';

const deps = (res: () => Promise<Response>) => ({ baseUrl: 'https://odoo.example.test', apiKey: 'SENTINEL-KEY', database: 'db1', fetchImpl: (() => res()) as typeof fetch });
const classOf = async (res: () => Promise<Response>) => {
  try { await odooCall(deps(res), 'res.company', 'search_read'); } catch (e) { return (e as OdooError).errorClass; }
};

describe('odoo/client — AC-ODC-002 classified failures', () => {
  it.each([
    ['timeout', () => Promise.reject(new DOMException('t', 'TimeoutError'))],
    ['tls', () => Promise.reject(new TypeError('invalid peer certificate: UnknownIssuer'))],
    ['unreachable', () => Promise.reject(new TypeError('error sending request: connection refused'))],
    ['destination-refused', () => Promise.reject(new Error('ERPNext destination is not permitted'))],
    ['not-odoo', async () => new Response('<html>hi</html>', { status: 200 })],
    ['not-odoo', async () => new Response('', { status: 302, headers: { location: 'https://x' } })],
    ['no-json2', async () => new Response('<html>404</html>', { status: 404 })],
    ['missing-model', async () => Response.json(ERR_404_JSON, { status: 404 })],
    ['key-rejected', async () => Response.json({ name: 'odoo.exceptions.AccessDenied', message: 'SENTINEL-KEY' }, { status: 401 })],
    ['access-denied', async () => Response.json({ name: 'odoo.exceptions.AccessError', message: 'm' }, { status: 403 })],
    ['validation', async () => Response.json({ name: 'odoo.exceptions.ValidationError', message: 'm' }, { status: 422 })],
    ['server-error', async () => new Response('Traceback SENTINEL-KEY', { status: 500 })],
  ] as const)('maps %s', async (expected, res) => expect(await classOf(res)).toBe(expected));

  it('never carries the upstream body or the key', async () => {
    expect.assertions(1);
    try { await odooCall(deps(async () => new Response('Traceback SENTINEL-KEY', { status: 500 })), 'm', 'x'); }
    catch (e) { expect(String((e as Error).message)).not.toMatch(/SENTINEL|Traceback/); }
  });
});

describe('odoo/client — JSON-2 request shape (bed §1)', () => {
  it('POSTs /json/2/<model>/<method> with bearer auth, the database header and a JSON body, never following redirects', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const call = bindCall({
      baseUrl: 'https://odoo.example.test/', apiKey: 'k1', database: 'db1',
      fetchImpl: (async (url: string, init: RequestInit) => { seen.push({ url, init }); return Response.json([7]); }) as unknown as typeof fetch,
    });
    expect(await call<number[]>('res.partner', 'create', { vals_list: [{ name: 'A' }] })).toEqual([7]);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(seen[0].url).toBe('https://odoo.example.test/json/2/res.partner/create');
    expect(seen[0].init).toMatchObject({ method: 'POST', redirect: 'manual', body: JSON.stringify({ vals_list: [{ name: 'A' }] }) });
    expect(headers).toMatchObject({ Authorization: 'bearer k1', 'X-Odoo-Database': 'db1' });
  });

  it('waits on the pacer before every call', async () => {
    const order: string[] = [];
    await odooCall({ ...deps(async () => { order.push('fetch'); return Response.json(true); }), pace: async () => { order.push('pace'); } }, 'm', 'x');
    expect(order).toEqual(['pace', 'fetch']);
  });
});
