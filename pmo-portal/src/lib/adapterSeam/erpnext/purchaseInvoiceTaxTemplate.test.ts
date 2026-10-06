import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { piToBody, piFromDoc } from './bodies/purchaseInvoice.ts';
import { listPurchaseTaxTemplates } from './erpPurchaseTaxRows.ts';
import type { AdapterCommand } from '../contract.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';
const COMPANY = 'Synthetic Co';
const ITEMS = [{ item_code: 'SYNTHETIC-ITEM', qty: 2, rate: 100 }];
const BINDING = {
  org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15,
  activated_at: '2026-10-01', config: { company: COMPANY },
};

/** PostgREST boundary fake: honours eq filters and the selected columns (a missing column throws). */
function serviceClient(): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [BINDING],
    procurements: [{ id: 'proc-1', org_id: ORG, vendor_id: 'vendor-1', project_id: null }],
    companies: [{ id: 'vendor-1', org_id: ORG }],
    external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'vendor-1', external_record_id: 'Supplier:Synthetic Supplier' }],
    procurement_items: [],
  };
  return { from(table: string) {
    return { select(columns: string) {
      const filters: Record<string, string> = {};
      const matches = () => (rows[table] ?? []).filter((row) => Object.entries(filters).every(([col, value]) => row[col] === value));
      const pick = (row: Row): Row => Object.fromEntries(columns.split(',').map((col) => col.trim()).map((col) => {
        if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
        return [col, row[col]];
      }));
      const chain = {
        eq(col: string, value: string) { filters[col] = value; return chain; },
        order() { return chain; },
        limit() { return chain; },
        async maybeSingle() { const row = matches()[0]; return { data: row ? pick(row) : null, error: null }; },
        then(resolve: (value: { data: Row[]; error: null }) => void) { resolve({ data: matches().map(pick), error: null }); },
      };
      return chain;
    } };
  } } as unknown as DispatchServiceClient;
}

const STANDARD = {
  name: 'Synthetic Input VAT', company: COMPANY, disabled: 0,
  taxes: [{ charge_type: 'On Net Total', account_head: 'Input VAT - SC', rate: 11, description: 'Input VAT', category: 'Total', add_deduct_tax: 'Add' }],
};
const FOREIGN = { ...STANDARD, name: 'Other Company VAT', company: 'Other Co' };
const DISABLED = { ...STANDARD, name: 'Old VAT', disabled: 1 };
const TEMPLATES = [STANDARD, FOREIGN, DISABLED];
const SENT_ROWS = [{ charge_type: 'On Net Total', account_head: 'Input VAT - SC', description: 'Input VAT', rate: 11, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0 }];

/**
 * An ERPNext fake that answers the template list with real filter + paging semantics (name/company/disabled,
 * limit_start/limit_page_length). `docs` lets a test make the single-doc read disagree with the list.
 */
function erpFetch(templates: Row[] = TEMPLATES, docs: Row[] = templates) {
  const writes: Row[] = [];
  const templateReads: string[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const path = decodeURIComponent(parsed.pathname);
    if (path === '/api/resource/Item') {
      return Response.json({ data: [{ name: 'SYNTHETIC-ITEM', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] });
    }
    if (path === '/api/resource/Purchase Taxes and Charges Template') {
      templateReads.push(path);
      const filters = JSON.parse(parsed.searchParams.get('filters') ?? '[]') as Array<[string, string, unknown]>;
      const hit = templates.filter((t) => filters.every(([field, , value]) => t[field] === value));
      const start = Number(parsed.searchParams.get('limit_start') ?? 0);
      const size = Number(parsed.searchParams.get('limit_page_length') ?? 20);
      return Response.json({ data: hit.slice(start, start + size).map((t) => ({ name: t.name })) });
    }
    if (path.startsWith('/api/resource/Purchase Taxes and Charges Template/')) {
      templateReads.push(path);
      const name = path.slice('/api/resource/Purchase Taxes and Charges Template/'.length);
      const found = docs.find((t) => t.name === name);
      return found ? Response.json({ data: found }) : new Response('{"exc_type":"DoesNotExistError"}', { status: 404 });
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Row;
      writes.push(body);
      return Response.json({ data: { ...body, name: 'SYNTHETIC-PI-520', docstatus: 0, grand_total: 222, outstanding_amount: 222 } });
    }
    return Response.json({ data: { name: 'SYNTHETIC-PI-520', docstatus: 1, grand_total: 222, outstanding_amount: 222 } });
  });
  return { writes, templateReads, fetchImpl };
}

function command(record: Row = {}, operation: AdapterCommand['operation'] = 'create'): AdapterCommand {
  return {
    domain: 'procurement', operation, idempotencyKey: 'pi-tax-520-key',
    record: { id: 'vi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice', items: ITEMS, ...record },
  };
}

async function resolve(cmd: AdapterCommand, erp: ReturnType<typeof erpFetch>, replay = false) {
  return resolveErpDispatchAdapter({
    serviceClient: serviceClient(), orgId: ORG, command: cmd, replay,
    fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc } },
  });
}

async function push(record: Row = {}, templates?: Row[]) {
  const cmd = command(record);
  const erp = erpFetch(templates);
  await (await resolve(cmd, erp)).commit(cmd);
  return { body: erp.writes[0] ?? {}, command: cmd, ...erp };
}

describe('vendor invoice purchase tax template (#520)', () => {
  it('AC-520-1 a chosen template is sent by name with its explicit rows', async () => {
    const { body, command: cmd } = await push({ taxTemplate: 'Synthetic Input VAT' });
    expect(body.taxes_and_charges).toBe('Synthetic Input VAT');
    expect(body.taxes).toEqual(SENT_ROWS);
    // The rows are part of the persisted command, so the outbox payload and its digest cover them.
    expect(cmd.record.taxes).toEqual(SENT_ROWS);
    const without = await canonicalCommandDigest({ domain: cmd.domain, operation: cmd.operation, record: { ...cmd.record, taxes: undefined } });
    expect(await canonicalCommandDigest({ domain: cmd.domain, operation: cmd.operation, record: cmd.record })).not.toBe(without);
  });

  it('AC-520-2 no template chosen sends no tax rows and reads no template (ERPNext default applies)', async () => {
    const { body, templateReads } = await push();
    expect(body).not.toHaveProperty('taxes');
    expect(body).not.toHaveProperty('taxes_and_charges');
    expect(templateReads).toEqual([]);
  });

  it.each([
    ['another company', 'Other Company VAT'],
    ['a disabled template', 'Old VAT'],
    ['an unknown template', 'Nope VAT'],
  ])('AC-520-3 %s is refused (config-rejected) before any ERPNext write', async (_label, name) => {
    const cmd = command({ taxTemplate: name });
    const erp = erpFetch();
    await expect(resolve(cmd, erp)).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining(name) });
    // ADR-0072: the refusal names the template, never the ERP company.
    await expect(resolve(command({ taxTemplate: name }), erpFetch())).rejects.toSatisfy(
      (err: Error) => !err.message.includes(COMPANY));
    expect(erp.writes).toEqual([]);
  });

  it('AC-520-3 the list filter alone refuses a template the company list does not hold (single-doc read agrees)', async () => {
    const cmd = command({ taxTemplate: 'Synthetic Input VAT' });
    const erp = erpFetch([], [STANDARD]);
    await expect(resolve(cmd, erp)).rejects.toMatchObject({ code: 'config-rejected' });
    expect(erp.writes).toEqual([]);
  });

  it.each([
    ['another company', { ...STANDARD, company: 'Other Co' }],
    ['disabled', { ...STANDARD, disabled: 1 }],
  ])('AC-520-3 the single-doc re-check alone refuses a template that is now %s (list still holds it)', async (_label, doc) => {
    const cmd = command({ taxTemplate: 'Synthetic Input VAT' });
    const erp = erpFetch([STANDARD], [doc]);
    await expect(resolve(cmd, erp)).rejects.toMatchObject({ code: 'config-rejected' });
    expect(erp.writes).toEqual([]);
  });

  it('AC-520-10 an inclusive template row is sent with included_in_print_rate set, and its cost center, exactly as the template', async () => {
    const inclusive = { ...STANDARD, taxes: [{ ...STANDARD.taxes[0], included_in_print_rate: 1, cost_center: 'Main - SC' }] };
    const { body } = await push({ taxTemplate: 'Synthetic Input VAT' }, [inclusive]);
    expect(body.taxes).toEqual([{ ...SENT_ROWS[0], included_in_print_rate: 1, cost_center: 'Main - SC' }]);
  });

  it.each([
    ['a Deduct row', { add_deduct_tax: 'Deduct', rate: 2 }],
    ['a negative rate', { add_deduct_tax: 'Add', rate: -2 }],
  ])('AC-520-11 a withholding template (%s) is refused (config-rejected, action required) before any ERPNext write', async (_label, row) => {
    const withholding = { ...STANDARD, taxes: [STANDARD.taxes[0], { ...STANDARD.taxes[0], account_head: 'PPh 23 - SC', ...row }] };
    const cmd = command({ taxTemplate: 'Synthetic Input VAT' });
    const erp = erpFetch([withholding]);
    await expect(resolve(cmd, erp)).rejects.toMatchObject({
      code: 'config-rejected',
      message: 'This template withholds tax (e.g. PPh), which PMO cannot record yet — choose a template without withholding.',
    });
    expect(erp.writes).toEqual([]);
  });

  it('AC-520-12 the picker list pages past the ERPNext page limit and keeps only the company\'s enabled templates', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ ...STANDARD, name: `VAT ${String(i).padStart(3, '0')}` }));
    const erp = erpFetch([...many, FOREIGN, DISABLED]);
    const listed = await listPurchaseTaxTemplates({ fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: BINDING.site_url }, COMPANY);
    expect(listed).toEqual(many.map((t) => ({ name: t.name })));
  });

  it('AC-520-3 a template with no rows is refused rather than sending an untaxed invoice', async () => {
    const cmd = command({ taxTemplate: 'Empty VAT' });
    const erp = erpFetch([{ ...STANDARD, name: 'Empty VAT', taxes: [] }]);
    await expect(resolve(cmd, erp)).rejects.toMatchObject({ code: 'config-rejected' });
    expect(erp.writes).toEqual([]);
  });

  it('AC-520-4 caller-supplied taxes are dropped, with or without a template', async () => {
    const forged = [{ charge_type: 'Actual', account_head: 'EVIL', rate: 99 }];
    expect((await push({ taxes: forged })).body).not.toHaveProperty('taxes');
    expect((await push({ taxes: forged, taxTemplate: 'Synthetic Input VAT' })).body.taxes).toEqual(SENT_ROWS);
  });

  it('AC-520-5 a template with a non-"On Net Total" row is refused before any ERPNext write', async () => {
    const cmd = command({ taxTemplate: 'Synthetic Input VAT' });
    const erp = erpFetch([{ ...STANDARD, taxes: [{ ...STANDARD.taxes[0], charge_type: 'On Previous Row Total' }] }]);
    await expect(resolve(cmd, erp)).rejects.toThrow(/only "On Net Total" rows/);
    expect(erp.writes).toEqual([]);
  });

  it('AC-520-6 a replayed create keeps its persisted rows: no ERPNext read, same digest after the template changed', async () => {
    const first = await push({ taxTemplate: 'Synthetic Input VAT' });
    const replay = command();
    replay.record = structuredClone(first.command.record) as AdapterCommand['record'];
    const erp = erpFetch([{ ...STANDARD, taxes: [{ ...STANDARD.taxes[0], rate: 99 }] }]);
    await resolve(replay, erp, true);
    expect(erp.fetchImpl).not.toHaveBeenCalled();
    expect(await canonicalCommandDigest({ domain: replay.domain, operation: replay.operation, record: replay.record }))
      .toBe(await canonicalCommandDigest({ domain: first.command.domain, operation: first.command.operation, record: first.command.record }));
  });
});
