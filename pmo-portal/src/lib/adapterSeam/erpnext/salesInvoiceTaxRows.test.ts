import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { siFromDoc, siToBody } from './bodies/salesInvoice.ts';
import type { AdapterCommand } from '../contract.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';

/** PostgREST boundary fake: enforces filters and selected columns (a missing column throws). */
function serviceClient(project: Row | null): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-09-01', config: { company: 'Synthetic Co', project_map: { 'proj-1': 'ERP-PROJ-001' } } }],
    companies: [{ id: 'cust-1', org_id: ORG }],
    external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'cust-1', external_record_id: 'Customer:Synthetic Customer' }],
    projects: project ? [{ id: 'proj-1', org_id: ORG, customer_contract_ref: null, contract_date: null, ...project }] : [],
    work_orders: [],
    sales_invoices: [],
    progress_claims: [],
  };
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, string> = {};
          const matches = () => (rows[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
          const pick = (row: Row): Row => Object.fromEntries(columns.split(',').map((col) => col.trim()).map((col) => {
            if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
            return [col, row[col]];
          }));
          const chain = {
            eq(col: string, val: string) { filters[col] = val; return chain; },
            order() { return chain; },
            limit() { return chain; },
            async maybeSingle() { const row = matches()[0]; return { data: row ? pick(row) : null, error: null }; },
            then(resolve: (value: { data: Row[]; error: null }) => void) { resolve({ data: matches().map(pick), error: null }); },
          };
          return chain;
        },
      };
    },
  } as unknown as DispatchServiceClient;
}

const TEMPLATE = { name: 'Synthetic Sales Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT - SC', rate: 12, description: 'VAT' }] };
const ITEMS = [{ item_code: 'OWN-ITEM', qty: 2, rate: 500 }];
const TAXED = { contract_value: 1_000_000, tax_amount: 120_000, tax_base_numerator: 1, tax_base_denominator: 1 };

function erpFetch(template: unknown = TEMPLATE) {
  const writes: Row[] = [];
  const templateReads: string[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path === '/api/resource/Item' && init?.method === 'GET') {
      return Response.json({ data: [{ name: 'OWN-ITEM', item_name: 'OWN-ITEM', disabled: 0, is_sales_item: 1, is_purchase_item: 0 }] });
    }
    if (path.startsWith('/api/resource/Sales Taxes and Charges Template')) {
      templateReads.push(path);
      return path === '/api/resource/Sales Taxes and Charges Template'
        ? Response.json({ data: [{ name: 'Synthetic Sales Tax' }] })
        : Response.json({ data: template });
    }
    const body = JSON.parse(String(init?.body)) as Row;
    writes.push(body);
    return new Response(JSON.stringify({ data: { name: 'SYNTHETIC-SI-856', ...body, docstatus: 0 } }), { status: 200 });
  });
  return { writes, templateReads, fetchImpl };
}

function command(record: Row = {}): AdapterCommand {
  return {
    domain: 'revenue', operation: 'create', idempotencyKey: 'tax-856-key',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: ITEMS, ...record },
  };
}

async function push(project: Row | null, record: Row = {}, template?: unknown) {
  const cmd = command(record);
  const erp = erpFetch(template);
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient(project), orgId: ORG, command: cmd,
    fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  await adapter.commit(cmd);
  return { body: erp.writes[0] ?? {}, command: cmd, ...erp };
}

describe('ordinary sales invoice tax rows (#856)', () => {
  it('AC-856-1 an ordinary invoice create carries the default template tax row at its rate', async () => {
    const { body } = await push(TAXED);
    expect(body.taxes).toEqual([{ charge_type: 'On Net Total', account_head: 'VAT - SC', description: 'VAT', rate: 12 }]);
  });

  it('AC-856-1 the persisted command (outbox payload + digest) covers the built rows', async () => {
    const { command: cmd } = await push(TAXED);
    expect(cmd.record.taxes).toEqual([{ charge_type: 'On Net Total', account_head: 'VAT - SC', description: 'VAT', rate: 12 }]);
    const without = canonicalCommandDigest({ domain: cmd.domain, operation: cmd.operation, record: { ...cmd.record, taxes: undefined } });
    expect(canonicalCommandDigest({ domain: cmd.domain, operation: cmd.operation, record: cmd.record })).not.toBe(without);
  });

  it('AC-856-2 a reduced-base contract (11/12) scales the rate', async () => {
    const { body } = await push({ ...TAXED, tax_base_numerator: 11, tax_base_denominator: 12 });
    expect((body.taxes as Row[])[0].rate).toBe(11);
  });

  it('AC-856-3 a tax-exempt invoice carries no rows and makes no template read', async () => {
    const { body, templateReads } = await push({ contract_value: 1_000_000, tax_amount: 0, tax_base_numerator: 1, tax_base_denominator: 1 });
    expect(body).not.toHaveProperty('taxes');
    expect(templateReads).toEqual([]);
  });

  it('AC-856-4 a caller-supplied taxes array is still stripped', async () => {
    const forged = [{ charge_type: 'Actual', account_head: 'EVIL', rate: 99 }];
    const { body } = await push({ contract_value: 1_000_000, tax_amount: 0, tax_base_numerator: 1, tax_base_denominator: 1 }, { taxes: forged });
    expect(body).not.toHaveProperty('taxes');
    const taxed = await push(TAXED, { taxes: forged });
    expect(taxed.body.taxes).toEqual([{ charge_type: 'On Net Total', account_head: 'VAT - SC', description: 'VAT', rate: 12 }]);
  });

  it('AC-856-5 a template with a non-"On Net Total" row is refused before any ERPNext write', async () => {
    const cmd = command();
    const erp = erpFetch({ name: 'Synthetic Sales Tax', taxes: [{ charge_type: 'On Previous Row Total', account_head: 'VAT - SC', rate: 12 }] });
    await expect(resolveErpDispatchAdapter({
      serviceClient: serviceClient(TAXED), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    })).rejects.toThrow(/only "On Net Total" rows can be sent/);
    expect(erp.writes).toEqual([]);
  });
});
