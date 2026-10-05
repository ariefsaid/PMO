import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { poToBody, poFromDoc } from './bodies/purchaseOrder.ts';
import { piToBody, piFromDoc, PI_FROM_DOC_FIELDS } from './bodies/purchaseInvoice.ts';
import type { AdapterCommand } from '../contract.ts';

type Row = Record<string, unknown>;
type Kind = 'purchase-order' | 'purchase-invoice';
const ORG = 'org-1';
const ITEM = { item_code: 'SYNTHETIC-ITEM', qty: 2, rate: 100, schedule_date: '2026-10-12' };
const CASE = { id: 'proc-1', org_id: ORG, vendor_id: 'vendor-1', project_id: 'proj-1' };
const BINDING = {
  org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test',
  version_major: 15, activated_at: '2026-10-01',
  config: { project_map: { 'proj-1': 'ERP-PROJ-001' } },
};

/** Realistic PostgREST boundary: selected columns and org/id predicates are honored. */
function client(caseRow: Row = CASE, binding: Row = BINDING, projectOrg = ORG, failingTable?: string): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [binding],
    procurements: [caseRow],
    projects: [{ id: 'proj-1', org_id: projectOrg }],
    companies: [{ id: 'vendor-1', org_id: ORG }],
    external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'vendor-1', external_record_id: 'Supplier:Synthetic Supplier' }],
    procurement_items: [{ procurement_id: 'proc-1', name: 'SYNTHETIC-ITEM', quantity: 2, rate: 100 }],
  };
  return { from(table: string) {
    return { select(columns: string) {
      const filters: Record<string, string> = {};
      const matches = () => (rows[table] ?? []).filter((row) => Object.entries(filters).every(([col, value]) => row[col] === value));
      const project = (row: Row) => {
        const data: Row = {};
        for (const col of columns.split(',').map((key) => key.trim())) {
          if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
          data[col] = row[col];
        }
        return data;
      };
      const chain = {
        eq(col: string, value: string) { filters[col] = value; return chain; },
        order() { return chain; },
        limit() { return chain; },
        async maybeSingle() {
          if (table === failingTable && columns === 'project_id') return { data: null, error: { message: 'Synthetic read failure', code: 'SYNTHETIC_READ_ERROR' } };
          const row = matches()[0];
          return { data: row ? project(row) : null, error: null };
        },
        then(resolve: (value: { data: Row[]; error: null }) => void) { resolve({ data: matches().map(project), error: null }); },
      };
      return chain;
    } };
  } } as unknown as DispatchServiceClient;
}

async function push(kind: Kind, extra: Row = {}, caseRow: Row = CASE, binding: Row = BINDING, projectOrg = ORG) {
  const command: AdapterCommand = {
    domain: 'procurement', operation: 'create', idempotencyKey: 'purchase-reference-test-key',
    record: { id: 'pmo-1', procurementId: 'proc-1', erp_doc_kind: kind, items: [ITEM], ...extra },
  };
  let body: Row = {};
  let doc: Row = {};
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      body = JSON.parse(String(init.body)) as Row;
      doc = { ...body, name: 'SYNTHETIC-ERP-DOC', docstatus: 0, posting_date: '2026-10-05', grand_total: 200, outstanding_amount: 200 };
    }
    if (init?.method === 'PUT') doc = { ...doc, docstatus: 1 };
    return new Response(JSON.stringify({ data: doc }), { status: 200 });
  });
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: client(caseRow, binding, projectOrg), orgId: ORG, command,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: {
      'purchase-order': { toBody: poToBody, fromDoc: poFromDoc },
      'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc },
    },
  });
  const result = await adapter.commit(command);
  return { body, doc, command, result, fetchImpl };
}

describe('purchase project dimensions and vendor references', () => {
  it.each<Kind>(['purchase-order', 'purchase-invoice'])('AC-PRJ-001 %s carries the resolved project on its header and every line', async (kind) => {
    const secondItem = { item_code: 'SYNTHETIC-ITEM-2', qty: 1, rate: 50, schedule_date: '2026-10-14' };
    const { body } = await push(kind, { items: [ITEM, secondItem] });
    expect(body.project).toBe('ERP-PROJ-001');
    expect(body.supplier).toBe('Synthetic Supplier');
    expect(body.items).toEqual([{
      item_code: 'SYNTHETIC-ITEM', qty: 2, rate: 100, project: 'ERP-PROJ-001',
      ...(kind === 'purchase-order' ? { schedule_date: '2026-10-12' } : {}),
    }, {
      item_code: 'SYNTHETIC-ITEM-2', qty: 1, rate: 50, project: 'ERP-PROJ-001',
      ...(kind === 'purchase-order' ? { schedule_date: '2026-10-14' } : {}),
    }]);
  });

  it.each<Kind>(['purchase-order', 'purchase-invoice'])('%s refuses an unmapped project before ERP is called', async (kind) => {
    const fetchImpl = vi.fn();
    await expect(resolveErpDispatchAdapter({
      serviceClient: client(CASE, { ...BINDING, config: { project_map: {} } }), orgId: ORG,
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', procurementId: 'proc-1', erp_doc_kind: kind, items: [ITEM] } },
      fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    })).rejects.toMatchObject({ code: 'project-unmapped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each<Kind>(['purchase-order', 'purchase-invoice'])('%s rejects a project belonging to another org', async (kind) => {
    await expect(push(kind, {}, CASE, BINDING, 'org-2')).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
  });

  it.each<Kind>(['purchase-order', 'purchase-invoice'])('%s keeps project-less legacy bodies free of empty project fields', async (kind) => {
    const { body } = await push(kind, {}, { ...CASE, project_id: null });
    expect(body).not.toHaveProperty('project');
    expect(body.items).toEqual([{
      item_code: 'SYNTHETIC-ITEM', qty: 2, rate: 100,
      ...(kind === 'purchase-order' ? { schedule_date: '2026-10-12' } : {}),
    }]);
  });

  it('resolves PI supplier and items from the procurement case when the command has no items', async () => {
    const { body } = await push('purchase-invoice', { items: undefined });
    expect(body.supplier).toBe('Synthetic Supplier');
    expect(body.items).toEqual([{ item_code: 'SYNTHETIC-ITEM', qty: 2, rate: 100, project: 'ERP-PROJ-001' }]);
  });

  it('rejects a procurement project lookup failure before any ERP request', async () => {
    const fetchImpl = vi.fn();
    await expect(resolveErpDispatchAdapter({
      serviceClient: client(CASE, BINDING, ORG, 'procurements'), orgId: ORG,
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-order', items: [ITEM] } },
      fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    })).rejects.toMatchObject({ code: 'SYNTHETIC_READ_ERROR' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not let a caller override the procurement case project dimension', async () => {
    const { body } = await push('purchase-order', { projectId: 'caller-project' });
    expect(body.project).toBe('ERP-PROJ-001');
    expect((body.items as Row[])[0].project).toBe('ERP-PROJ-001');
  });

  it('AC-PRJ-002 sends the vendor invoice reference and date independently when set', () => {
    const ctx = { refs: { supplier: 'Synthetic Supplier' }, config: {} };
    const invoice = { id: 'pmo-1', items: [ITEM] };
    expect(piToBody({ ...invoice, referenceNumber: 'VENDOR-INV-001', invoiceDate: '2026-09-20' }, ctx))
      .toMatchObject({ bill_no: 'VENDOR-INV-001', bill_date: '2026-09-20' });
    const numberOnly = piToBody({ ...invoice, referenceNumber: 'VENDOR-INV-001' }, ctx);
    expect(numberOnly).toHaveProperty('bill_no', 'VENDOR-INV-001');
    expect(numberOnly).not.toHaveProperty('bill_date');
    const dateOnly = piToBody({ ...invoice, invoiceDate: '2026-09-20' }, ctx);
    expect(dateOnly).toHaveProperty('bill_date', '2026-09-20');
    expect(dateOnly).not.toHaveProperty('bill_no');
  });

  it('omits blank or absent vendor reference fields, never sending empty strings', () => {
    const ctx = { refs: { supplier: 'Synthetic Supplier' }, config: {} };
    for (const extra of [{}, { referenceNumber: null, invoiceDate: null }, { referenceNumber: '  ', invoiceDate: '' }]) {
      const body = piToBody({ id: 'pmo-1', items: [ITEM], ...extra }, ctx);
      expect(body).not.toHaveProperty('bill_no');
      expect(body).not.toHaveProperty('bill_date');
    }
  });

  it('AC-PRJ-003 sweep readback preserves the vendor date even when the posting date differs', async () => {
    const first = await push('purchase-invoice', { referenceNumber: 'VENDOR-INV-001', invoiceDate: '2026-09-20' });
    expect(PI_FROM_DOC_FIELDS).toContain('bill_date');
    const canonical = piFromDoc(first.doc);
    expect(canonical).toMatchObject({ reference_number: 'VENDOR-INV-001', invoice_date: '2026-09-20', amount: '200.00' });
    const ctx = { refs: { supplier: 'Synthetic Supplier', project: 'ERP-PROJ-001' }, config: {} };
    const before = piToBody(first.command.record, ctx);
    const after = piToBody({ ...first.command.record, referenceNumber: canonical.reference_number, invoiceDate: canonical.invoice_date }, ctx);
    expect(after).toEqual(before);
  });

  it('keeps the PO project body stable after canonical readback', async () => {
    const first = await push('purchase-order');
    const canonical = poFromDoc(first.doc);
    const ctx = { refs: { supplier: 'Synthetic Supplier', project: 'ERP-PROJ-001' }, config: {} };
    expect(poToBody({ ...first.command.record, ...canonical }, ctx)).toEqual(poToBody(first.command.record, ctx));
  });

  it('keeps the legacy posting date when ERP has no vendor bill date', () => {
    expect(piFromDoc({ name: 'SYNTHETIC-PI', posting_date: '2026-10-05' }).invoice_date).toBe('2026-10-05');
  });
});
