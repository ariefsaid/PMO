import { describe, expect, it, vi } from 'vitest';
import { ensureErpCustomFields } from './erpCustomFields.ts';
import type { ErpClientDeps } from './client.ts';

const PATH = '/api/resource/Custom%20Field';
const ITEM_PATH = `${PATH}/Sales%20Invoice-custom_received_date`;

type Call = { method: string; path: string; body: Record<string, unknown> | null };

function deps(respond: (call: Call) => Response): { deps: ErpClientDeps; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', path: new URL(String(url)).pathname, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    calls.push(call);
    return respond(call);
  });
  return { deps: { fetchImpl: fetchImpl as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', sleep: async () => {} }, calls };
}

describe('ensureErpCustomFields (#767 AC-DUE-003: the receipt date has a field to land in)', () => {
  it('creates Sales Invoice custom_received_date, editable after submit, when the site lacks it', async () => {
    const { deps: d, calls } = deps((call) =>
      call.method === 'GET' ? Response.json({ exc_type: 'DoesNotExistError' }, { status: 404 }) : Response.json({ data: { name: 'Sales Invoice-custom_received_date' } }));
    expect(await ensureErpCustomFields(d)).toEqual([{ name: 'Sales Invoice-custom_received_date', outcome: 'created' }]);
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe(PATH);
    expect(post?.body).toMatchObject({ dt: 'Sales Invoice', fieldname: 'custom_received_date', fieldtype: 'Date', allow_on_submit: 1 });
  });

  it('is idempotent: an existing, correct field is left alone', async () => {
    const { deps: d, calls } = deps(() => Response.json({ data: { name: 'Sales Invoice-custom_received_date', allow_on_submit: 1 } }));
    expect(await ensureErpCustomFields(d)).toEqual([{ name: 'Sales Invoice-custom_received_date', outcome: 'exists' }]);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(calls[0].path).toBe(ITEM_PATH);
  });

  it('repairs an existing field that is not editable after submit', async () => {
    const { deps: d, calls } = deps((call) =>
      Response.json({ data: { name: 'Sales Invoice-custom_received_date', allow_on_submit: call.method === 'PUT' ? 1 : 0 } }));
    expect(await ensureErpCustomFields(d)).toEqual([{ name: 'Sales Invoice-custom_received_date', outcome: 'repaired' }]);
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: ITEM_PATH, body: { allow_on_submit: 1 } });
  });

  it('reports — never throws — a refusal (e.g. the integration user lacks System Manager)', async () => {
    const { deps: d } = deps((call) =>
      call.method === 'GET' ? Response.json({}, { status: 404 }) : Response.json({ exc_type: 'PermissionError', message: 'Insufficient Permission' }, { status: 403 }));
    const [outcome] = await ensureErpCustomFields(d);
    expect(outcome).toMatchObject({ name: 'Sales Invoice-custom_received_date', outcome: 'failed' });
  });
});
