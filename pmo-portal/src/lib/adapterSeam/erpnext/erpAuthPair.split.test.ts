// #651 — splitAuthPair: the `<key>:<secret>` vault value splits on the FIRST colon (Frappe secrets may contain ':'),
// and a malformed value is refused whole. Mirrors the Deno erpAuthPair tests so the vitest coverage report sees it.
import { describe, expect, it } from 'vitest';
import { splitAuthPair } from './credentials';
import { validateErpnextCashAccount } from './imprestCashAccount';

describe('splitAuthPair', () => {
  it('splits key and secret at the colon', () => {
    expect(splitAuthPair('k1:s1')).toEqual({ apiKey: 'k1', apiSecret: 's1' });
  });
  it('splits on the FIRST colon: a secret containing ":" stays whole', () => {
    expect(splitAuthPair('k:se:cret')).toEqual({ apiKey: 'k', apiSecret: 'se:cret' });
  });
  it.each(['no-colon-here', '', ':secret', 'key:'])('refuses malformed value %j', (v) => {
    expect(() => splitAuthPair(v)).toThrow();
  });
});

function account(extra: Record<string, unknown> = {}) {
  return { data: { account_type: 'Cash', company: 'Co', is_group: 0, disabled: 0, ...extra } };
}
function check(secret: string, body: unknown, status = 200, company: string | null = 'Co') {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, run: () => validateErpnextCashAccount({ fetchImpl, siteUrl: 'https://erp.example.test', secret, company, account: 'Cash - Co' }) };
}

describe('validateErpnextCashAccount', () => {
  it('sends the token with the whole colon-containing secret and accepts a fitting Cash account', async () => {
    const c = check('k:se:cret', account());
    await expect(c.run()).resolves.toBe(true);
    expect(new Headers(c.calls[0][1]?.headers).get('Authorization')).toBe('token k:se:cret');
  });
  it('rejects a non-Cash account', async () => {
    await expect(check('k:s', account({ account_type: 'Bank' })).run()).resolves.toBe(false);
  });
  it('returns false when the account does not exist (404)', async () => {
    await expect(check('k:s', { exc_type: 'DoesNotExistError' }, 404).run()).resolves.toBe(false);
  });
  it('maps a malformed pair to config-rejected without calling ERPNext', async () => {
    const c = check('no-colon', account());
    await expect(c.run()).rejects.toMatchObject({ code: 'config-rejected' });
    expect(c.calls).toHaveLength(0);
  });
  it('maps a missing company to config-rejected', async () => {
    await expect(check('k:s', account(), 200, null).run()).rejects.toMatchObject({ code: 'config-rejected' });
  });
});
