import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { siFromDoc, siToBody } from './bodies/salesInvoice.ts';
import type { AdapterCommand } from '../contract.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';

/** PostgREST boundary fake: enforces filters and selected columns (a missing column throws). */
function serviceClient(project: Row | null, orgCurrency = 'IDR', currencyRowGone = false, extra: Record<string, Row[]> = {}): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-09-01', config: { company: 'Synthetic Co', project_map: { 'proj-1': 'ERP-PROJ-001' } } }],
    companies: [{ id: 'cust-1', org_id: ORG }],
    external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'cust-1', external_record_id: 'Customer:Synthetic Customer' }],
    projects: project ? [{ id: 'proj-1', org_id: ORG, currency: 'IDR', customer_contract_ref: null, contract_date: null, ...project }] : [],
    organizations: [{ id: ORG, default_currency: orgCurrency }],
    work_orders: [],
    sales_invoices: [],
    progress_claims: [],
    ...extra,
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
            async maybeSingle() { const row = currencyRowGone && table === 'projects' && columns === 'currency' ? undefined : matches()[0]; return { data: row ? pick(row) : null, error: null }; },
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
const TAXED = { subject_to_vat: true, tax_base_numerator: 1, tax_base_denominator: 1 };
const VAT_OFF = { subject_to_vat: false, tax_base_numerator: 1, tax_base_denominator: 1 };

function erpFetch(template: unknown = TEMPLATE, opts: { customerCurrency?: string | null; companyCurrency?: string } = {}) {
  const { customerCurrency = 'IDR', companyCurrency = 'IDR' } = opts;
  const writes: Row[] = [];
  const templateReads: string[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path === '/api/resource/Item' && init?.method === 'GET') {
      return Response.json({ data: [{ name: 'OWN-ITEM', item_name: 'OWN-ITEM', disabled: 0, is_sales_item: 1, is_purchase_item: 0 }] });
    }
    if (path === '/api/resource/Customer/Synthetic Customer') return Response.json({ data: { name: 'Synthetic Customer', default_currency: customerCurrency } });
    if (path === '/api/resource/Company/Synthetic Co') return Response.json({ data: { name: 'Synthetic Co', default_currency: companyCurrency } });
    if (path.startsWith('/api/resource/Sales Taxes and Charges Template')) {
      templateReads.push(path);
      return path === '/api/resource/Sales Taxes and Charges Template'
        ? Response.json({ data: template ? [{ name: 'Synthetic Sales Tax' }] : [] })
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

async function push(project: Row | null, record: Row = {}, template?: unknown, opts: Parameters<typeof erpFetch>[1] = {}) {
  const cmd = command(record);
  const erp = erpFetch(template, opts);
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

  it('AC-856-3 AC-856-7 an invoice on a project that is not subject to VAT carries no rows and makes no template read', async () => {
    const { body, templateReads } = await push(VAT_OFF);
    expect(body).not.toHaveProperty('taxes');
    expect(templateReads).toEqual([]);
  });

  it('AC-856-4 a caller-supplied taxes array is still stripped', async () => {
    const forged = [{ charge_type: 'Actual', account_head: 'EVIL', rate: 99 }];
    const { body } = await push(VAT_OFF, { taxes: forged });
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

  it('AC-856-10 an ordinary invoice on a VAT-on project is refused (config-rejected) when ERPNext has no default tax template', async () => {
    const cmd = command();
    const erp = erpFetch(null);
    await expect(resolveErpDispatchAdapter({
      serviceClient: serviceClient(TAXED), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    })).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('default Sales Taxes and Charges template') });
    expect(erp.writes).toEqual([]);
  });

  it('AC-856-10 a VAT-off project with no template still creates, untaxed', async () => {
    const { body } = await push(VAT_OFF, {}, null);
    expect(body).not.toHaveProperty('taxes');
  });

  it('AC-858-1 a replayed ordinary create keeps its persisted tax rows: no ERPNext read, same digest after the template rate or VAT flag changes', async () => {
    const first = await push(TAXED);
    const persisted = structuredClone(first.command.record) as Row;
    for (const [project, template] of [[TAXED, { ...TEMPLATE, taxes: [{ ...TEMPLATE.taxes[0], rate: 99 }] }], [VAT_OFF, TEMPLATE]] as const) {
      const erp = erpFetch(template);
      const replay = command();
      replay.record = structuredClone(persisted) as AdapterCommand['record'];
      await resolveErpDispatchAdapter({
        serviceClient: serviceClient(project), orgId: ORG, command: replay, replay: true,
        fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
        doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
      });
      expect(erp.fetchImpl).not.toHaveBeenCalled();
      expect(await canonicalCommandDigest({ domain: replay.domain, operation: replay.operation, record: replay.record }))
        .toBe(await canonicalCommandDigest({ domain: first.command.domain, operation: first.command.operation, record: first.command.record }));
    }
  });

  const posts = (erp: { fetchImpl: ReturnType<typeof vi.fn> }) =>
    erp.fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

  it('AC-866-1 an ordinary invoice in a currency other than the customer billing currency is refused before any ERPNext fetch', async () => {
    const cmd = command();
    const erp = erpFetch(TEMPLATE, { customerCurrency: 'IDR' });
    await expect(resolveErpDispatchAdapter({
      serviceClient: serviceClient({ ...TAXED, currency: 'USD' }), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    })).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringMatching(/USD.*IDR/) });
    expect(erp.writes).toEqual([]);
    expect(posts(erp)).toEqual([]);
    expect(erp.templateReads).toEqual([]);
  });

  it('AC-866-1 a customer with no billing currency falls back to the company currency, and fails closed when neither is known', async () => {
    const { body } = await push({ ...TAXED, currency: 'USD' }, {}, TEMPLATE, { customerCurrency: null, companyCurrency: 'USD' });
    expect(body.currency).toBe('USD');
    const cmd = command();
    const erp = erpFetch(TEMPLATE, { customerCurrency: null, companyCurrency: '' });
    await expect(resolveErpDispatchAdapter({
      serviceClient: serviceClient(TAXED), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    })).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('which currency ERPNext bills') });
    expect(erp.writes).toEqual([]);
  });

  it('AC-866-2 a matching invoice passes and its body and persisted record carry the currency explicitly', async () => {
    const { body, command: cmd } = await push(TAXED);
    expect(body.currency).toBe('IDR');
    expect(cmd.record.currency).toBe('IDR');
  });

  it('AC-866-2 a caller-supplied currency never overrides the project currency', async () => {
    const { body } = await push(TAXED, { currency: 'USD' });
    expect(body.currency).toBe('IDR');
  });

  it('AC-866-3 a replayed ordinary create re-sends the persisted currency and makes no ERPNext read', async () => {
    const first = await push(TAXED);
    const erp = erpFetch(TEMPLATE, { customerCurrency: 'USD' });
    const replay = command();
    replay.record = structuredClone(first.command.record) as AdapterCommand['record'];
    await resolveErpDispatchAdapter({
      serviceClient: serviceClient({ ...TAXED, currency: 'USD' }), orgId: ORG, command: replay, replay: true,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    });
    expect(erp.fetchImpl).not.toHaveBeenCalled();
    expect(replay.record.currency).toBe('IDR');
  });

  it('AC-866-4 an ordinary invoice with no project is stated in the org default currency', async () => {
    const cmd = command({ projectId: undefined });
    const erp = erpFetch(TEMPLATE, { customerCurrency: 'USD' });
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClient(TAXED, 'USD'), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    });
    await adapter.commit(cmd);
    expect(erp.writes[0].currency).toBe('USD');
    expect(cmd.record.currency).toBe('USD');
  });

  it('AC-866-4 an ordinary invoice whose project currency row is not found is refused before any ERPNext write', async () => {
    const cmd = command();
    const erp = erpFetch(TEMPLATE);
    await expect(resolveErpDispatchAdapter({
      serviceClient: serviceClient(TAXED, 'IDR', true), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    })).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('which currency this invoice is in') });
    expect(erp.writes).toEqual([]);
    expect(erp.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[42], ['   '], ['']])('AC-866-5 a sales-invoice create with id %j is refused (commit-rejected) with no ERPNext call', async (id) => {
    const cmd = command({ id });
    const erp = erpFetch(TEMPLATE);
    await expect(resolveErpDispatchAdapter({
      serviceClient: serviceClient(TAXED), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    })).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(erp.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('an ordinary invoice edit or amend is stated in its own currency (OD-BILL-1)', () => {
  const MIRROR = { sales_invoices: [{ id: 'si-1', org_id: ORG, currency: 'USD', reference_number: null, work_order_id: null, project_id: 'proj-1', received_date: null }] };
  const edit = (operation: AdapterCommand['operation'], record: Row = {}): AdapterCommand => ({
    domain: 'revenue', operation, idempotencyKey: 'edit-bwo-key',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'SYNTHETIC-SI-1', customerId: 'cust-1', projectId: 'proj-1', items: ITEMS, ...record },
  });
  const resolve = (cmd: AdapterCommand, extra: Record<string, Row[]> = MIRROR) => {
    const erp = erpFetch(TEMPLATE);
    return { erp, done: resolveErpDispatchAdapter({
      serviceClient: serviceClient(VAT_OFF, 'IDR', false, extra), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    }) };
  };

  it.each([
    ['an update', 'update' as const, {}],
    ['an amend', 'transition' as const, { verb: 'amend' }],
  ])('AC-BWO-002 %s carries the mirror row\'s currency, never the caller\'s or the project\'s', async (_label, operation, extra) => {
    const cmd = edit(operation, { ...extra, currency: 'EUR' });
    await resolve(cmd).done;
    expect(cmd.record.currency).toBe('USD');
    expect((siToBody(cmd.record, { refs: { customer: 'Synthetic Customer' } } as never) as Row).currency).toBe('USD');
  });

  it('AC-BWO-002 an edit whose invoice has no mirror row is refused before any ERPNext call', async () => {
    const cmd = edit('update');
    const { erp, done } = resolve(cmd, { sales_invoices: [] });
    await expect(done).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('which currency this invoice is in') });
    expect(erp.fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-BWO-002 a submit carries no currency (it builds no body)', async () => {
    const cmd = edit('transition', { verb: 'submit', currency: 'EUR' });
    await resolve(cmd).done;
    expect(cmd.record).not.toHaveProperty('currency');
  });
});
