import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { applyErpFeedEvent } from './applyFeed.ts';
import { siFromDoc, siToBody } from './bodies/salesInvoice.ts';
import type { AdapterCommand } from '../contract.ts';
import { createErpFeedDeps } from '../../../../../supabase/functions/_shared/erpnextFeedDeps.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';
const ITEM = { item_code: 'SYNTHETIC-ITEM', qty: 1, rate: 100 };
const INVOICE = { id: 'si-1', org_id: ORG, reference_number: null, work_order_id: 'wo-1', project_id: 'proj-1', erp_modified: null };
const WO = { id: 'wo-1', org_id: ORG, client_po_number: 'WO-PO-001', order_date: '2026-09-01' };
const PROJECT = { id: 'proj-1', org_id: ORG, customer_contract_ref: 'PROJECT-PO-001', contract_date: '2026-08-01' };

/** PostgREST boundary fake: enforce filters and requested columns, including org isolation. */
function serviceClient(invoice: Row | null, wo: Row | null, project: Row | null, failingTable?: string): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-09-01', config: { project_map: { 'proj-1': 'ERP-PROJ-001' } } }],
    companies: [{ id: 'cust-1', org_id: ORG }],
    external_refs: [
      { org_id: ORG, domain: 'companies', pmo_record_id: 'cust-1', external_record_id: 'Customer:Synthetic Customer' },
      { org_id: ORG, domain: 'revenue', pmo_record_id: 'si-1', external_record_id: 'SYNTHETIC-SI-001' },
    ],
    sales_invoices: invoice ? [{ ...invoice }] : [],
    work_orders: wo ? [wo] : [],
    projects: project ? [project] : [],
  };
  return {
    from(table: string) {
      return {
        update(patch: Row) {
          const filters: Record<string, string> = {};
          const chain = {
            eq(col: string, val: string) { filters[col] = val; return chain; },
            then(resolve: (value: { error: null }) => void) {
              const row = rows[table]?.find((candidate) => Object.entries(filters).every(([key, value]) => candidate[key] === value));
              if (row) Object.assign(row, patch);
              resolve({ error: null });
            },
          };
          return chain;
        },
        select(columns: string) {
          const filters: Record<string, string> = {};
          const matches = () => (rows[table] ?? []).filter((candidate) =>
            Object.entries(filters).every(([key, value]) => candidate[key] === value));
          const projectRow = (row: Row) => {
            const data: Row = {};
            for (const key of columns.split(',').map((col) => col.trim())) {
              if (!(key in row)) throw new Error(`fixture lacks selected column ${table}.${key}`);
              data[key] = row[key];
            }
            return data;
          };
          const chain = {
            eq(col: string, val: string) { filters[col] = val; return chain; },
            limit() { return chain; },
            async maybeSingle() {
              if (table === failingTable) return { data: null, error: { message: 'Synthetic source read failed', code: 'SYNTHETIC_READ_ERROR' } };
              const row = matches()[0];
              return { data: row ? projectRow(row) : null, error: null };
            },
            then(resolve: (value: { data: Row[]; error: null }) => void) {
              resolve({ data: matches().map(projectRow), error: null });
            },
          };
          return chain;
        },
      };
    },
  } as unknown as DispatchServiceClient;
}

async function push(invoice: Row | null = INVOICE, wo: Row | null = WO, project: Row = PROJECT, extra: Row = {}) {
  const command: AdapterCommand = {
    domain: 'revenue', operation: 'create', idempotencyKey: 'po-test-key',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [ITEM], ...extra },
  };
  let body: Row = {};
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(_url)).pathname === '/api/resource/Item' && init?.method === 'GET') {
      return Response.json({ data: [{ name: ITEM.item_code, item_name: 'Test invoice service', disabled: 0, is_sales_item: 1, is_purchase_item: 1 }] });
    }
    body = JSON.parse(String(init?.body)) as Row;
    return new Response(JSON.stringify({ data: { name: 'SYNTHETIC-SI-001', ...body, docstatus: 0 } }), { status: 200 });
  });
  const client = serviceClient(invoice, wo, project);
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: client, orgId: ORG, command,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  const result = await adapter.commit(command);
  return { body, command, result, fetchImpl, client };
}

const digest = (command: AdapterCommand) => canonicalCommandDigest({ domain: command.domain, operation: command.operation, record: command.record });

describe('sales invoice client PO', () => {
  it.each([
    [{ ...INVOICE, reference_number: 'INVOICE-PO-001' }, WO, PROJECT, 'INVOICE-PO-001', undefined],
    [INVOICE, WO, PROJECT, 'WO-PO-001', '2026-09-01'],
    [INVOICE, { ...WO, client_po_number: null }, PROJECT, 'PROJECT-PO-001', '2026-08-01'],
  ])('AC-PO-001 uses invoice → linked work order → project priority with the matching source date (%#)', async (invoice, wo, project, po, date) => {
    const { body } = await push(invoice as Row, wo as Row, project as Row);
    expect(body.po_no).toBe(po);
    expect(body.po_date).toBe(date);
    if (date === undefined) expect(body).not.toHaveProperty('po_date');
  });

  it('does not borrow the project date when the selected work order has no date', async () => {
    const { body } = await push(INVOICE, { ...WO, order_date: null });
    expect(body.po_no).toBe('WO-PO-001');
    expect(body).not.toHaveProperty('po_date');
  });

  it('uses an explicit draft reference before the stored invoice reference', async () => {
    const { body } = await push({ ...INVOICE, reference_number: 'STORED-PO' }, WO, PROJECT, { reference_number: 'EDITED-PO' });
    expect(body.po_no).toBe('EDITED-PO');
    expect(body).not.toHaveProperty('po_date');
  });

  it('does not accept a caller-supplied date for an unrelated invoice reference', async () => {
    const { body } = await push(INVOICE, WO, PROJECT, { reference_number: 'UNRELATED-PO', po_date: '2020-01-01' });
    expect(body.po_no).toBe('UNRELATED-PO');
    expect(body).not.toHaveProperty('po_date');
  });

  it('falls back to project reference for an invoice not yet stored', async () => {
    const { body } = await push(null);
    expect(body.po_no).toBe('PROJECT-PO-001');
    expect(body.po_date).toBe('2026-08-01');
  });

  it('keeps the project date after that reference has been mirrored onto the invoice', async () => {
    const { body } = await push({ ...INVOICE, reference_number: 'PROJECT-PO-001' }, { ...WO, client_po_number: null });
    expect(body.po_no).toBe('PROJECT-PO-001');
    expect(body.po_date).toBe('2026-08-01');
  });

  it('AC-PO-002 omits blank or absent references and dates while the create succeeds', async () => {
    const { body, result } = await push({ ...INVOICE, reference_number: '  ' }, { ...WO, client_po_number: '' }, { ...PROJECT, customer_contract_ref: null });
    expect(body).not.toHaveProperty('po_no');
    expect(body).not.toHaveProperty('po_date');
    expect(result.externalRecordId).toBe('SYNTHETIC-SI-001');
  });

  it('ignores a linked work order outside the invoice org', async () => {
    const { body } = await push(INVOICE, { ...WO, org_id: 'org-2' });
    expect(body.po_no).toBe('PROJECT-PO-001');
    expect(body.po_date).toBe('2026-08-01');
  });

  it('does not use another org invoice as a fallback source', async () => {
    const { body } = await push({ ...INVOICE, org_id: 'org-2', reference_number: 'OTHER-ORG-PO' });
    expect(body.po_no).toBe('PROJECT-PO-001');
    expect(body.po_date).toBe('2026-08-01');
  });

  it('omits the date when the selected project reference has no contract date', async () => {
    const { body } = await push(INVOICE, null, { ...PROJECT, contract_date: null });
    expect(body.po_no).toBe('PROJECT-PO-001');
    expect(body).not.toHaveProperty('po_date');
  });

  it('rejects a source read error before any ERP call', async () => {
    const fetchImpl = vi.fn();
    await expect(resolveErpDispatchAdapter({
      serviceClient: serviceClient(INVOICE, WO, PROJECT, 'work_orders'), orgId: ORG,
      command: { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [ITEM] } },
      fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    })).rejects.toMatchObject({ code: 'SYNTHETIC_READ_ERROR' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PO-003 keeps the reference, body and digest stable after the sweep mirror write', async () => {
    const first = await push();
    const feed = createErpFeedDeps(first.client as never, ORG, 'sales-invoice');
    const sourceModMs = Date.parse('2026-09-01T00:00:00Z');
    const ctx = { tier: 'erpnext', domain: 'revenue' };
    expect(await applyErpFeedEvent(ctx, first.result.externalRecordId, first.result.canonical, sourceModMs, feed))
      .toEqual({ kind: 'upserted', pmoRecordId: 'si-1', adopted: false });
    expect(await applyErpFeedEvent(ctx, first.result.externalRecordId, first.result.canonical, sourceModMs, feed))
      .toEqual({ kind: 'upserted', pmoRecordId: 'si-1', adopted: false });
    const { data } = await first.client.from('sales_invoices').select('reference_number,work_order_id,project_id').eq('id', 'si-1').eq('org_id', ORG).maybeSingle();
    const mirrored = data as Row;
    expect(mirrored).toEqual({ reference_number: 'WO-PO-001', work_order_id: 'wo-1', project_id: 'proj-1' });
    const second = await push({ ...INVOICE, ...mirrored });
    expect(second.body).toEqual(first.body);
    expect(await digest(second.command)).toBe(await digest(first.command));
  });

  it('AC-PO-004 binds the effective PO and matching date in the persisted command digest', async () => {
    const first = await push();
    const changedPo = await push(INVOICE, { ...WO, client_po_number: 'WO-PO-002' });
    const changedDate = await push(INVOICE, { ...WO, order_date: '2026-09-02' });
    expect(first.command.record.reference_number).toBe('WO-PO-001');
    expect(first.command.record.po_date).toBe('2026-09-01');
    expect(await digest(changedPo.command)).not.toBe(await digest(first.command));
    expect(await digest(changedDate.command)).not.toBe(await digest(first.command));
  });
});
