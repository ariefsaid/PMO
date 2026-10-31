import { describe, expect, it, vi } from 'vitest';
import { OdooError } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { fetchOdooVersionMajor, validateOdooConnection } from './connect.ts';

const VERSION_INFO = { jsonrpc: '2.0', id: null, result: { server_version: '20.0', server_version_info: [20, 0, 0, 'final', 0, ''], server_serie: '20.0' } };

/** The fake Odoo for /json/2, plus a canned version_info (bed report T17). */
function bed(key = 'K') {
  const fake = createFakeOdoo({ key });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', partner_id: [1, 'Main Co'] }, { id: 2, name: 'Second Co', partner_id: [2, 'Second Co'] }]);
  const fetchImpl = vi.fn((async (url: string | URL | Request, init?: RequestInit) =>
    String(url).endsWith('/web/webclient/version_info') ? Response.json(VERSION_INFO) : fake.fetch(url, init)) as typeof fetch);
  return { fake, fetchImpl };
}

describe('odoo/connect — validateOdooConnection (S2-T1)', () => {
  it.each(['http://odoo.example.test', 'not a url', 'ftp://odoo.example.test'])('refuses %s with destination-refused and no fetch', async (siteUrl) => {
    const { fetchImpl } = bed();
    await expect(validateOdooConnection({ siteUrl, database: 'db', apiKey: 'K', fetchImpl })).rejects.toMatchObject({ errorClass: 'destination-refused' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows http only when allowHttp is set (local bench)', async () => {
    const { fetchImpl } = bed();
    await expect(validateOdooConnection({ siteUrl: 'http://127.0.0.1:8069', database: 'db', apiKey: 'K', fetchImpl, allowHttp: true }))
      .resolves.toMatchObject({ versionMajor: 20 });
  });

  it('returns the companies the key can see and the major version, reading through one JSON-2 call', async () => {
    const { fake, fetchImpl } = bed();
    const out = await validateOdooConnection({ siteUrl: 'https://odoo.example.test/odoo', database: 'db', apiKey: 'K', fetchImpl });
    expect(out).toEqual({ companies: [{ id: 1, name: 'Main Co' }, { id: 2, name: 'Second Co' }], versionMajor: 20 });
    expect(fake.calls).toEqual([{ model: 'res.company', method: 'search_read' }]);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://odoo.example.test/json/2/res.company/search_read');
  });

  it('rethrows key-rejected for a wrong key', async () => {
    const { fetchImpl } = bed('OTHER');
    await expect(validateOdooConnection({ siteUrl: 'https://odoo.example.test', database: 'db', apiKey: 'K', fetchImpl }))
      .rejects.toMatchObject({ errorClass: 'key-rejected' });
  });

  it('reads an HTML 404 from an Odoo that reports JSON-2 (major >= 19) as database-not-found (bed: a pinned single-db host)', async () => {
    const fetchImpl = (async (url: string) => String(url).endsWith('/web/webclient/version_info')
      ? Response.json(VERSION_INFO) : new Response('<html>404</html>', { status: 404 })) as typeof fetch;
    await expect(validateOdooConnection({ siteUrl: 'https://odoo.example.test', database: 'other', apiKey: 'K', fetchImpl }))
      .rejects.toMatchObject({ errorClass: 'database-not-found' });
  });

  it('rethrows no-json2 when the endpoint is a plain 404 and the version is unknown or below 19', async () => {
    const old = (async (url: string) => String(url).endsWith('/web/webclient/version_info')
      ? Response.json({ result: { server_version_info: [17, 0] } }) : new Response('<html>404</html>', { status: 404 })) as typeof fetch;
    await expect(validateOdooConnection({ siteUrl: 'https://odoo.example.test', database: 'db', apiKey: 'K', fetchImpl: old }))
      .rejects.toMatchObject({ errorClass: 'no-json2' });
    const fetchImpl = (async () => new Response('<html>404</html>', { status: 404 })) as typeof fetch;
    const err = await validateOdooConnection({ siteUrl: 'https://odoo.example.test', database: 'db', apiKey: 'K', fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(OdooError);
    expect(err.errorClass).toBe('no-json2');
  });

  it.each([
    ['an Odoo 19', async (url: string) => Response.json(String(url).endsWith('/web/webclient/version_info') ? { result: { server_version_info: [19, 0] } } : [])],
    ['an unknown version', async (url: string) => (String(url).endsWith('/web/webclient/version_info') ? new Response('<html>blocked</html>', { status: 403 }) : Response.json([]))],
  ])('FR-ODC-022 refuses %s with unsupported-version, so connect never stores a key activation would refuse', async (_label, impl) => {
    await expect(validateOdooConnection({ siteUrl: 'https://odoo.example.test', database: 'db', apiKey: 'K', fetchImpl: impl as unknown as typeof fetch }))
      .rejects.toMatchObject({ errorClass: 'unsupported-version' });
  });

  it('returns every company the key can see, not only the first 50', async () => {
    const { fake, fetchImpl } = bed();
    fake.seed('res.company', Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Co ${i + 1}` })));
    const out = await validateOdooConnection({ siteUrl: 'https://odoo.example.test', database: 'db', apiKey: 'K', fetchImpl });
    expect(out.companies).toHaveLength(60);
  });
});

describe('odoo/connect — fetchOdooVersionMajor (V17)', () => {
  it('reads server_version_info[0] without auth', async () => {
    const fetchImpl = vi.fn(async () => Response.json(VERSION_INFO));
    expect(await fetchOdooVersionMajor({ baseUrl: 'https://o.test/', fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(20);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://o.test/web/webclient/version_info');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(JSON.stringify(init.headers)).not.toMatch(/Authorization/i);
  });

  it.each([
    ['a transport error', async () => { throw new TypeError('reset'); }],
    ['a non-JSON body', async () => new Response('<html>')],
    ['a missing version', async () => Response.json({ result: {} })],
  ])('returns null on %s', async (_label, impl) => {
    expect(await fetchOdooVersionMajor({ baseUrl: 'https://o.test', fetchImpl: impl as unknown as typeof fetch })).toBeNull();
  });
});
