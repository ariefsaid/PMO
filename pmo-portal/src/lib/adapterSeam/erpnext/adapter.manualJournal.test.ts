// #895 — the manual journal create looks itself up by its key before it inserts (AC-MJE-004): a posted Journal Entry
// carrying the key is returned as the result, and a draft carrying the key (left by a refused submit) is replaced.
import { describe, expect, it } from 'vitest';
import { createErpAdapter } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';
import type { AdapterCommand } from '../contract';

const ID = '0b7a8c2e-1111-4222-8333-444455556666';
const KEY = `journal:${ID}`;

interface Doc { name: string; docstatus: number; user_remark: string; posting_date: string; modified: string; accounts: unknown[] }

/** A Journal Entry store speaking the Frappe REST shapes the adapter uses. `refuseSubmits` refuses that many submits. */
function fakeErp(opts: { refuseSubmits?: number; seed?: Doc[] } = {}) {
  const docs = new Map<string, Doc>((opts.seed ?? []).map((d) => [d.name, d]));
  let refuse = opts.refuseSubmits ?? 0;
  let n = docs.size;
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const name = decodeURIComponent(url.pathname.split('/')[4] ?? '');
    calls.push(`${method} ${name || 'list'}`);
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      n += 1;
      const doc: Doc = { name: `ACC-JV-2026-${String(n).padStart(5, '0')}`, docstatus: 0, user_remark: String(body.user_remark),
        posting_date: String(body.posting_date), modified: `m${n}`, accounts: body.accounts as unknown[] };
      docs.set(doc.name, doc);
      return json({ data: doc });
    }
    if (method === 'PUT') {
      const doc = docs.get(name);
      if (!doc) return json({ exc_type: 'DoesNotExistError' }, 404);
      if (refuse > 0) { refuse -= 1; return json({ exc_type: 'ValidationError', message: 'Account 1110 does not exist' }, 417); }
      doc.docstatus = 1;
      return json({ data: doc });
    }
    if (method === 'DELETE') {
      const doc = docs.get(name);
      if (!doc || doc.docstatus !== 0) return json({ exc_type: 'LinkExistsError' }, 417);
      docs.delete(name);
      return json({ message: 'ok' });
    }
    if (name) {
      const doc = docs.get(name);
      return doc ? json({ data: doc }) : json({ exc_type: 'DoesNotExistError' }, 404);
    }
    const filters = JSON.parse(url.searchParams.get('filters') ?? '[]') as Array<[string, string, string | number]>;
    const rows = [...docs.values()].filter((d) => filters.every(([field, op, value]) => {
      const v = (d as unknown as Record<string, unknown>)[field];
      if (op === 'like') return String(v).includes(String(value).replace(/^%|%$/g, '').replace(/\\(.)/g, '$1'));
      if (op === '<') return Number(v) < Number(value);
      if (op === '=') return v === value;
      return false;
    }));
    return json({ data: rows.map((d) => ({ name: d.name, docstatus: d.docstatus, user_remark: d.user_remark })) });
  };
  return { docs, calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const command = (key = KEY): AdapterCommand => ({
  domain: 'accounting',
  operation: 'create',
  idempotencyKey: key,
  record: {
    id: ID,
    erp_doc_kind: 'manual-journal',
    journal: {
      key, date: '2026-11-10', memo: 'Bank fee',
      lines: [
        { account: '6100 - Bank Charges - PSC', debit: '10.00', credit: '0.00', label: 'fee' },
        { account: '1110 - Cash - PSC', debit: '0.00', credit: '10.00', label: 'fee' },
      ],
    },
  },
} as unknown as AdapterCommand);

const adapterOn = (erp: ReturnType<typeof fakeErp>) => createErpAdapter({
  client: { fetchImpl: erp.fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 },
  doctypeBodies: DOCTYPE_BODIES,
  ctx: { refs: {}, config: { company: 'PMO Smoke Co' } },
});

describe('manual journal create looks itself up by key (AC-MJE-004)', () => {
  it('AC-MJE-004 the adapter returns the posted entry for a key it has already posted and never inserts again', async () => {
    const erp = fakeErp();
    const adapter = adapterOn(erp);
    const first = await adapter.commit(command());
    const second = await adapter.commit(command());
    expect(second.externalRecordId).toBe(first.externalRecordId);
    expect([...erp.docs.values()].filter((d) => d.user_remark === KEY)).toHaveLength(1);
    expect(erp.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
    expect(second.canonical).toMatchObject({ status: 'posted', external_record_id: first.externalRecordId, posted_date: '2026-11-10' });
  });

  it('AC-MJE-004 a retry after a refused submit replaces the draft that carries the key and posts one entry', async () => {
    const erp = fakeErp({ refuseSubmits: 1 });
    const adapter = adapterOn(erp);
    await expect(adapter.commit(command())).rejects.toMatchObject({ code: 'commit-rejected' });
    const draft = [...erp.docs.values()].find((d) => d.user_remark === KEY);
    expect(draft?.docstatus).toBe(0);

    const retry = await adapter.commit(command());
    const carrying = [...erp.docs.values()].filter((d) => d.user_remark === KEY);
    expect(carrying).toHaveLength(1);
    expect(carrying[0]).toMatchObject({ docstatus: 1, name: retry.externalRecordId });
    expect(erp.docs.has(draft!.name)).toBe(false);
    expect(retry.canonical).toMatchObject({ status: 'posted' });
  });

  it('AC-MJE-004 an entry whose remark only mentions the key further along is not taken as this journal', async () => {
    const other: Doc = { name: 'ACC-JV-2026-00009', docstatus: 1, user_remark: `journal-rev:9a0e5f00-0000-4000-8000-000000000001 reverses ACC-JV-2026-00001: see ${KEY}`,
      posting_date: '2026-11-01', modified: 'm', accounts: [] };
    const erp = fakeErp({ seed: [other] });
    const result = await adapterOn(erp).commit(command());
    expect(result.externalRecordId).not.toBe(other.name);
    expect(erp.docs.get(other.name)?.docstatus).toBe(1);
    expect([...erp.docs.values()].filter((d) => d.user_remark === KEY)).toHaveLength(1);
  });
});
