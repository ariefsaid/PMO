import { describe, expect, it, vi } from 'vitest';
import { createErpAdapter } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';

const KEY = 'expj:0b7a8c2e-1111-4222-8333-444455556666:1791367200123';

describe('expense journal amend (AC-EXP-112)', () => {
  it('AC-EXP-112 the amended Journal Entry carries amended_from AND the key in user_remark (ERPNext does not copy it)', async () => {
    const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method: init?.method ?? 'GET', body });
      if (init?.method === 'PUT' && body?.docstatus === 2) return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002', docstatus: 2 }));
      if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002-1' }));
      if (init?.method === 'PUT') return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002-1', docstatus: 1 }));
      return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002-1', docstatus: 1, amended_from: 'ACC-JV-2026-00002', user_remark: KEY }));
    };
    const adapter = createErpAdapter({
      client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' },
      doctypeBodies: DOCTYPE_BODIES,
      ctx: { refs: {}, config: {} },
    });
    await adapter.commit({
      domain: 'expenses',
      operation: 'transition',
      idempotencyKey: KEY,
      record: {
        id: 'claim-1', erp_doc_kind: 'expense-journal', verb: 'amend', externalRecordId: 'ACC-JV-2026-00002',
        company: 'PMO Smoke Co', posting_date: '2026-10-08',
        journal_rows: [
          { account: 'Travel Expenses - PSC', debit: '10.00', project: null, cost_center: null },
          { account: 'Employee Payable - PSC', credit: '10.00', party: 'HR-EMP-00002' },
        ],
      },
    });
    const create = calls.find((c) => c.method === 'POST');
    expect(create?.body).toMatchObject({ amended_from: 'ACC-JV-2026-00002', user_remark: KEY, voucher_type: 'Journal Entry' });
  });
});
