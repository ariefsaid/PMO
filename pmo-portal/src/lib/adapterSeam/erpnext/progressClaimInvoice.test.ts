import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { siFromDoc, siToBody } from './bodies/salesInvoice.ts';
import type { AdapterCommand } from '../contract.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';
const CLAIM: Row = {
  id: 'claim-1', org_id: ORG, kind: 'progress', project_id: 'proj-1', work_order_id: null,
  down_payment_amount: null, dp_recovery_amount: '40000.00', dp_item_code: 'DP-ITEM', withdrawn_at: null,
};
// Deliberately out of BoQ order: the resolver must sort by boq_item_id so every resolution is identical.
const LINES: Row[] = [
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-b', item_code: 'STATION', description: 'Station build', unit: 'unit', quantity: '1.000', rate: '100000.00' },
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-a', item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: '4.000', rate: '50000.00' },
];
const EVIDENCE: Row[] = [{ id: 'ev-1', org_id: ORG, claim_id: 'claim-1' }];

/** PostgREST boundary fake: enforces filters and selected columns (a missing column throws). */
function serviceClient(claim: Row | null, evidence: Row[] = EVIDENCE): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-09-01', config: { project_map: { 'proj-1': 'ERP-PROJ-001', 'proj-2': 'ERP-PROJ-002' } } }],
    companies: [{ id: 'cust-1', org_id: ORG }, { id: 'cust-2', org_id: ORG }],
    external_refs: [
      { org_id: ORG, domain: 'companies', pmo_record_id: 'cust-1', external_record_id: 'Customer:Synthetic Customer' },
      { org_id: ORG, domain: 'companies', pmo_record_id: 'cust-2', external_record_id: 'Customer:Other Customer' },
    ],
    projects: [
      { id: 'proj-1', org_id: ORG, client_id: 'cust-1', customer_contract_ref: null, contract_date: null },
      { id: 'proj-2', org_id: ORG, client_id: 'cust-1', customer_contract_ref: null, contract_date: null },
    ],
    work_orders: [{ id: 'wo-1', org_id: ORG, client_po_number: 'WO-PO-001', order_date: '2026-09-01' }],
    sales_invoices: [],
    progress_claims: claim ? [claim] : [],
    progress_claim_lines: LINES,
    progress_claim_evidence: evidence,
  };
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, string> = {};
          let orderBy: string | null = null;
          const matches = () => {
            const found = (rows[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
            return orderBy === null ? found : [...found].sort((a, b) => String(a[orderBy as string]).localeCompare(String(b[orderBy as string])));
          };
          const pick = (row: Row): Row => Object.fromEntries(columns.split(',').map((col) => col.trim()).map((col) => {
            if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
            return [col, row[col]];
          }));
          const chain = {
            eq(col: string, val: string) { filters[col] = val; return chain; },
            order(col: string) { orderBy = col; return chain; },
            limit() { return chain; },
            gt() { return chain; },
            async maybeSingle() { const row = matches()[0]; return { data: row ? pick(row) : null, error: null }; },
            then(resolve: (value: { data: Row[]; error: null }) => void) { resolve({ data: matches().map(pick), error: null }); },
          };
          return chain;
        },
      };
    },
  } as unknown as DispatchServiceClient;
}

function command(record: Row, operation: AdapterCommand['operation'] = 'create'): AdapterCommand {
  return {
    domain: 'revenue', operation, idempotencyKey: 'pb-test-key',
    record: { id: 'claim-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', ...record },
  };
}

function erpFetch() {
  const sent: { body: Row } = { body: {} };
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(url)).pathname === '/api/resource/Item' && init?.method === 'GET') {
      return Response.json({ data: ['SURVEY', 'STATION', 'DP-ITEM', 'OWN-ITEM'].map((name) => ({ name, item_name: name, disabled: 0, is_sales_item: 1, is_purchase_item: 0 })) });
    }
    sent.body = JSON.parse(String(init?.body)) as Row;
    return new Response(JSON.stringify({ data: { name: 'SYNTHETIC-SI-766', ...sent.body, docstatus: 0 } }), { status: 200 });
  });
  return { sent, fetchImpl };
}

async function push(record: Row, claim: Row | null = CLAIM) {
  const cmd = command(record);
  const { sent, fetchImpl } = erpFetch();
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient(claim), orgId: ORG, command: cmd,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  await adapter.commit(cmd);
  return { body: sent.body, command: cmd };
}

/** Synchronous on purpose: the caller attaches `.rejects` in the same tick, so no rejection goes unhandled. */
function refused(cmd: AdapterCommand, claim: Row | null = CLAIM, evidence: Row[] = EVIDENCE) {
  const { fetchImpl } = erpFetch();
  const attempt = resolveErpDispatchAdapter({
    serviceClient: serviceClient(claim, evidence), orgId: ORG, command: cmd,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  return { attempt, fetchImpl };
}

const digest = (cmd: AdapterCommand) => canonicalCommandDigest({ domain: cmd.domain, operation: cmd.operation, record: cmd.record });

describe('billing claim invoice (AC-PB-006)', () => {
  it('AC-PB-006 builds a progress invoice from the claim lines in BoQ order plus the recovery line', async () => {
    const { body } = await push({});
    expect(body.items).toEqual([
      { item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Route survey (km)' },
      { item_code: 'STATION', qty: 1, rate: 100000, description: 'Station build (unit)' },
      { item_code: 'DP-ITEM', qty: 1, rate: -40000 },
    ]);
  });

  it('AC-PB-006 builds a down payment invoice as one line on the claim item', async () => {
    const { body } = await push({}, { ...CLAIM, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00' });
    expect(body.items).toEqual([{ item_code: 'DP-ITEM', qty: 1, rate: 200000 }]);
  });

  it('AC-PB-006 replaces caller-supplied lines with the claim lines', async () => {
    const { body } = await push({ items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] });
    expect((body.items as Row[]).map((item) => item.item_code)).toEqual(['SURVEY', 'STATION', 'DP-ITEM']);
  });

  it.each([
    ['another project', { projectId: 'proj-2' }, 'The invoice project must be the progress claim project'],
    ['another customer', { customerId: 'cust-2' }, 'The invoice customer must be the project client'],
  ])('AC-PB-006 refuses %s before any ERP call', async (_label, record, message) => {
    const { attempt, fetchImpl } = refused(command(record));
    await expect(attempt).rejects.toMatchObject({ code: 'commit-rejected', message });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 refuses a claim without evidence before any ERP call', async () => {
    const { attempt, fetchImpl } = refused(command({}), CLAIM, []);
    await expect(attempt).rejects.toMatchObject({
      code: 'commit-rejected',
      message: "Attach the billing evidence (for example the progress report or the client's acceptance) before raising this invoice",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 refuses to rebuild a claim invoice body on update', async () => {
    const { attempt, fetchImpl } = refused(command({ externalRecordId: 'SYNTHETIC-SI-766' }, 'update'));
    await expect(attempt).rejects.toMatchObject({
      code: 'commit-rejected',
      message: 'A progress claim invoice cannot be edited or amended from PMO — cancel the invoice and raise a new claim',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 refuses a withdrawn claim before any ERP call', async () => {
    const { attempt, fetchImpl } = refused(command({}), { ...CLAIM, withdrawn_at: '2026-10-06T00:00:00Z' });
    await expect(attempt).rejects.toThrow('This progress claim was withdrawn, so no invoice can be raised for it');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 derives the identical outbox digest on every resolution', async () => {
    const first = await push({});
    const second = await push({ items: [{ item_code: 'OWN-ITEM', qty: 9, rate: 9 }] });
    expect(await digest(second.command)).toBe(await digest(first.command));
  });

  it('AC-PB-006 takes the client PO from the claim work order', async () => {
    const { body } = await push({}, { ...CLAIM, work_order_id: 'wo-1' });
    expect(body.po_no).toBe('WO-PO-001');
    expect(body.po_date).toBe('2026-09-01');
  });

  it('AC-PB-006 leaves an invoice that is not a claim on the caller lines', async () => {
    const { body } = await push({ items: [{ item_code: 'OWN-ITEM', qty: 2, rate: 10 }] }, null);
    expect(body.items).toEqual([{ item_code: 'OWN-ITEM', qty: 2, rate: 10 }]);
  });
});
