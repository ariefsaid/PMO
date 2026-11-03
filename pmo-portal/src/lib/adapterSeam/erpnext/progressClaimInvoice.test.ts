import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { siFromDoc, siToBody } from './bodies/salesInvoice.ts';
import type { AdapterCommand } from '../contract.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';
const CLAIM: Row = {
  id: 'claim-1', org_id: ORG, kind: 'progress', currency: 'IDR', project_id: 'proj-1', work_order_id: null,
  gross_amount: '260000.00', down_payment_amount: null, dp_recovery_amount: '40000.00', dp_item_code: 'DP-ITEM', withdrawn_at: null,
};
const TM_CLAIM: Row = {
  ...CLAIM, kind: 'time_materials', gross_amount: '6000000.02', dp_recovery_amount: '0.00', dp_item_code: null,
};
const TM_STATE: Row = {
  id: 'claim-1', org_id: ORG, status: 'SignedOff', confirmed_by: 'confirmer-1', gross_amount: '6000000.02',
};
const TM_LINES: Row[] = [
  // Product is 0.0165; the frozen claim-line amount is rounded once to 0.02.
  { org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-2', rate_version: 1, kind: 'labour', label: 'Rounding case', unit: 'hour', units: '0.33', rate: '0.05', amount: '0.02' },
  // Deliberately after rate-line-2 in the fixture to pin the reader's stable line_key ordering.
  { org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-1', rate_version: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: '120.00', rate: '50000.00', amount: '6000000.00' },
];
// Deliberately out of BoQ order: the resolver must sort by boq_item_id so every resolution is identical.
const LINES: Row[] = [
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-b', item_code: 'STATION', description: 'Station build', unit: 'unit', quantity: '1.000', rate: '100000.00', amount: '100000.00' },
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-a', item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: '4.000', rate: '50000.00', amount: '200000.00' },
];
const EVIDENCE: Row[] = [{ id: 'ev-1', org_id: ORG, claim_id: 'claim-1' }];

/** PostgREST boundary fake: enforces filters and selected columns (a missing column throws). */
function serviceClient(claim: Row | null, evidence: Row[] = EVIDENCE, workOrderTax: Row = {}, projectTax: Row = {},
  timeMaterials: { claims?: Row[]; lines?: Row[] } = {}): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-09-01', config: { company: 'Synthetic Co', project_map: { 'proj-1': 'ERP-PROJ-001', 'proj-2': 'ERP-PROJ-002' }, item_map: { 'Site engineer': 'SERVICE-LABOUR', 'Rounding case': 'SERVICE-LABOUR' } } }],
    companies: [{ id: 'cust-1', org_id: ORG }, { id: 'cust-2', org_id: ORG }, { id: 'cust-org2', org_id: 'org-2' }],
    external_refs: [
      { org_id: ORG, domain: 'companies', pmo_record_id: 'cust-1', external_record_id: 'Customer:Synthetic Customer' },
      { org_id: ORG, domain: 'companies', pmo_record_id: 'cust-2', external_record_id: 'Customer:Other Customer' },
    ],
    projects: [
      { id: 'proj-1', org_id: ORG, client_id: 'cust-1', currency: 'IDR', customer_contract_ref: null, contract_date: null, subject_to_vat: true, tax_base_numerator: 1, tax_base_denominator: 1, ...projectTax },
      { id: 'proj-org2', org_id: 'org-2', client_id: 'cust-1', currency: 'IDR', customer_contract_ref: null, contract_date: null, subject_to_vat: true, tax_base_numerator: 1, tax_base_denominator: 1 },
      { id: 'proj-3', org_id: ORG, client_id: 'cust-1', currency: 'IDR', customer_contract_ref: null, contract_date: null, subject_to_vat: true, tax_base_numerator: 1, tax_base_denominator: 1 },
      { id: 'proj-2', org_id: ORG, client_id: 'cust-1', currency: 'IDR', customer_contract_ref: null, contract_date: null, subject_to_vat: true, tax_base_numerator: 1, tax_base_denominator: 1 },
    ],
    work_orders: [{ id: 'wo-1', org_id: ORG, client_po_number: 'WO-PO-001', order_date: '2026-09-01', tax_base_numerator: 1, tax_base_denominator: 1, ...workOrderTax }],
    sales_invoices: [],
    progress_claims: claim ? [claim] : [],
    progress_claim_lines: LINES,
    progress_claim_evidence: evidence,
    tm_claims: timeMaterials.claims ?? [],
    tm_claim_lines: timeMaterials.lines ?? [],
  };
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, string> = {};
          const orderBy: string[] = [];
          const matches = () => {
            // uuid columns compare case-insensitively in Postgres; model that for `id` so a case-variant id finds its row.
            const found = (rows[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) =>
              key === 'id' ? String(row[key]).toLowerCase() === String(value).toLowerCase() : row[key] === value));
            return orderBy.length === 0 ? found : [...found].sort((a, b) => {
              for (const column of orderBy) {
                const comparison = String(a[column]).localeCompare(String(b[column]));
                if (comparison !== 0) return comparison;
              }
              return 0;
            });
          };
          const pick = (row: Row): Row => Object.fromEntries(columns.split(',').map((col) => col.trim()).map((col) => {
            if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
            return [col, row[col]];
          }));
          const chain = {
            eq(col: string, val: string) { filters[col] = val; return chain; },
            order(col: string) { orderBy.push(col); return chain; },
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

function command(record: Row, operation: AdapterCommand['operation'] = 'create', idempotencyKey = 'pb-test-key'): AdapterCommand {
  return {
    domain: 'revenue', operation, idempotencyKey,
    record: { id: 'claim-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', ...record },
  };
}

const TAX_TEMPLATE = { name: 'Synthetic Sales Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT - SC', rate: 10, description: 'VAT' }] };

function erpFetch(opts: { negativeRates?: boolean; template?: unknown; settingsDenied?: boolean; customerCurrency?: string | null; companyCurrency?: string } = {}) {
  const { negativeRates = true, template = TAX_TEMPLATE, settingsDenied = false, customerCurrency = 'IDR', companyCurrency = 'IDR' } = opts;
  const sent: { body: Row; bodyText: string } = { body: {}, bodyText: '' };
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path === '/api/resource/Item' && init?.method === 'GET') {
      return Response.json({ data: ['SURVEY', 'STATION', 'DP-ITEM', 'OWN-ITEM', 'SERVICE-LABOUR'].map((name) => ({ name, item_name: name, disabled: 0, is_sales_item: 1, is_purchase_item: 0 })) });
    }
    if (path === '/api/resource/Customer/Synthetic Customer') return Response.json({ data: { name: 'Synthetic Customer', default_currency: customerCurrency } });
    if (path === '/api/resource/Company/Synthetic Co') return Response.json({ data: { name: 'Synthetic Co', default_currency: companyCurrency } });
    if (path === '/api/resource/Selling Settings/Selling Settings' && settingsDenied) return Response.json({ exc_type: 'PermissionError' }, { status: 403 });
    if (path === '/api/resource/Selling Settings/Selling Settings') return Response.json({ data: { allow_negative_rates_for_items: negativeRates ? 1 : 0 } });
    if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: template ? [{ name: 'Synthetic Sales Tax' }] : [] });
    if (path === '/api/resource/Sales Taxes and Charges Template/Synthetic Sales Tax') return Response.json({ data: template });
    sent.bodyText = String(init?.body);
    sent.body = JSON.parse(sent.bodyText) as Row;
    return new Response(JSON.stringify({ data: { name: 'SYNTHETIC-SI-766', ...sent.body, docstatus: 0 } }), { status: 200 });
  });
  return { sent, fetchImpl };
}

async function push(record: Row, claim: Row | null = CLAIM, erp: Parameters<typeof erpFetch>[0] = {}, workOrderTax: Row = {},
  projectTax: Row = {}, timeMaterials: { claims?: Row[]; lines?: Row[] } = {}, idempotencyKey = 'pb-test-key') {
  const cmd = command(record, 'create', idempotencyKey);
  const { sent, fetchImpl } = erpFetch(erp);
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient(claim, EVIDENCE, workOrderTax, projectTax, timeMaterials), orgId: ORG, command: cmd,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  await adapter.commit(cmd);
  return { body: sent.body, bodyText: sent.bodyText, command: cmd };
}

/** Synchronous on purpose: the caller attaches `.rejects` in the same tick, so no rejection goes unhandled. */
function refused(cmd: AdapterCommand, claim: Row | null = CLAIM, evidence: Row[] = EVIDENCE, erp: Parameters<typeof erpFetch>[0] = {},
  projectTax: Row = {}, timeMaterials: { claims?: Row[]; lines?: Row[] } = {}) {
  const { fetchImpl } = erpFetch(erp);
  const attempt = resolveErpDispatchAdapter({
    serviceClient: serviceClient(claim, evidence, {}, projectTax, timeMaterials), orgId: ORG, command: cmd,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  return { attempt, fetchImpl };
}

const digest = (cmd: AdapterCommand) => canonicalCommandDigest({ domain: cmd.domain, operation: cmd.operation, record: cmd.record });

describe('billing claim invoice (AC-PB-006)', () => {
  it('AC-PB-006 builds a progress invoice from the claim lines in BoQ order plus the recovery line', async () => {
    const { body, bodyText } = await push({});
    expect(body.items).toEqual([
      { item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Route survey (km)' },
      { item_code: 'STATION', qty: 1, rate: 100000, description: 'Station build (unit)' },
      { item_code: 'DP-ITEM', qty: 1, rate: -40000 },
    ]);
    expect(bodyText).toBe('{"customer":"Synthetic Customer","items":[{"item_code":"SURVEY","qty":4,"rate":50000,"description":"Route survey (km)"},{"item_code":"STATION","qty":1,"rate":100000,"description":"Station build (unit)"},{"item_code":"DP-ITEM","qty":1,"rate":-40000}],"project":"ERP-PROJ-001","currency":"IDR","taxes":[{"charge_type":"On Net Total","account_head":"VAT - SC","description":"VAT","rate":10}],"remarks":"pb-test-key"}');
  });

  it('AC-TM-014 carries signed T&M claim lines and their frozen amounts into the canonical invoice lines', async () => {
    const timeMaterials = { claims: [TM_STATE], lines: TM_LINES };
    const { body, command: cmd } = await push({}, TM_CLAIM, {}, {}, {}, timeMaterials, 'claim-1');
    const lines = cmd.record.items as Array<Row>;
    expect(lines.map(({ label, unit, quantity, rate, amount, item }) => ({ label, unit, quantity, rate, amount, item }))).toEqual([
      { label: 'Site engineer', unit: 'hour', quantity: 120, rate: 50000, amount: '6000000.00', item: 'SERVICE-LABOUR' },
      { label: 'Rounding case', unit: 'hour', quantity: 0.33, rate: 0.05, amount: '0.02', item: 'SERVICE-LABOUR' },
    ]);
    expect(lines.every(({ quantity, rate }) => typeof quantity === 'number' && typeof rate === 'number')).toBe(true);
    expect(body.items).toEqual([
      { item_code: 'SERVICE-LABOUR', qty: 120, rate: 50000, description: 'Site engineer (hour)' },
      { item_code: 'SERVICE-LABOUR', qty: 0.33, rate: 0.05, description: 'Rounding case (hour)' },
    ]);
    expect(lines.reduce((sum, line) => sum + Number(line.amount), 0)).toBe(Number(TM_STATE.gross_amount));
    const roundingLine = TM_LINES.find((line) => line.label === 'Rounding case');
    expect(roundingLine).toBeDefined();
    expect(Number(roundingLine?.amount)).not.toBe(Number(roundingLine?.units) * Number(roundingLine?.rate));
    expect(cmd.idempotencyKey).toBe('claim-1');
  });

  it('AC-TM-014 sends a half-cent tie as its frozen amount so ERPNext books the signed cents', async () => {
    const halfCentTie = [{
      org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-1', rate_version: 1, kind: 'labour',
      label: 'Site engineer', unit: 'hour', units: '0.25', rate: '1000.02', amount: '250.01',
    }];
    const claim = { ...TM_CLAIM, gross_amount: '250.01' };
    const tmClaim = { ...TM_STATE, gross_amount: '250.01' };
    const { body, command: cmd } = await push({}, claim, {}, {}, {}, { claims: [tmClaim], lines: halfCentTie });
    expect(body.items).toEqual([
      { item_code: 'SERVICE-LABOUR', qty: 1, rate: 250.01, description: 'Site engineer (hour): 0.25 x 1000.02, rounded to 250.01' },
    ]);
    const [line] = cmd.record.items as Array<Row>;
    expect(line).toMatchObject({ quantity: 0.25, signed_rate: 1000.02, rate: 250.01, amount: '250.01' });
    expect(Number(line.quantity) * Number(line.signed_rate)).toBe(250.005);
  });

  it('AC-TM-014 keeps every matching line quantity and rate, shaping only lines ERPNext would round away from frozen cents', async () => {
    const lines = [
      { org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-1', rate_version: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: '0.25', rate: '1000.02', amount: '250.01' },
      { org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-2', rate_version: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: '120.00', rate: '50000.00', amount: '6000000.00' },
      { org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-3', rate_version: 1, kind: 'labour', label: 'Rounding case', unit: 'hour', units: '0.33', rate: '0.05', amount: '0.02' },
      { org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-4', rate_version: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: '0.5', rate: '0.03', amount: '0.02' },
      { org_id: ORG, claim_id: 'claim-1', line_key: 'rate-line-5', rate_version: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: '99999999.5', rate: '0.01', amount: '1000000.00' },
    ];
    const gross = '7000250.05';
    const { body, command: cmd } = await push({}, { ...TM_CLAIM, gross_amount: gross }, {}, {}, {}, {
      claims: [{ ...TM_STATE, gross_amount: gross }], lines,
    });
    const signedLines = cmd.record.items as Array<Row>;
    expect(body.items).toEqual([
      { item_code: 'SERVICE-LABOUR', qty: 1, rate: 250.01, description: 'Site engineer (hour): 0.25 x 1000.02, rounded to 250.01' },
      { item_code: 'SERVICE-LABOUR', qty: 120, rate: 50000, description: 'Site engineer (hour)' },
      { item_code: 'SERVICE-LABOUR', qty: 0.33, rate: 0.05, description: 'Rounding case (hour)' },
      { item_code: 'SERVICE-LABOUR', qty: 0.5, rate: 0.03, description: 'Site engineer (hour)' },
      { item_code: 'SERVICE-LABOUR', qty: 99999999.5, rate: 0.01, description: 'Site engineer (hour)' },
    ]);
    const bodyItems = body.items as Array<Row>;
    expect(bodyItems.map((item) => Math.round(Number(item.qty) * Number(item.rate) * 100) / 100))
      .toEqual(signedLines.map((line) => Number(line.amount)));
    expect(signedLines[0]).toMatchObject({ quantity: 0.25, signed_rate: 1000.02, amount: '250.01' });
    expect(signedLines.slice(1).map(({ quantity, rate, amount }) => ({ quantity, rate, amount }))).toEqual([
      { quantity: 120, rate: 50000, amount: '6000000.00' },
      { quantity: 0.33, rate: 0.05, amount: '0.02' },
      { quantity: 0.5, rate: 0.03, amount: '0.02' },
      { quantity: 99999999.5, rate: 0.01, amount: '1000000.00' },
    ]);
  });

  it('AC-TM-014 refuses unsigned T&M claim lines before they can reach an invoice body', async () => {
    const unsigned = { claims: [{ ...TM_STATE, status: 'Draft', confirmed_by: null }], lines: TM_LINES };
    const { attempt, fetchImpl } = refused(command({}), TM_CLAIM, EVIDENCE, {}, {}, unsigned);
    await expect(attempt).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['the progress-claim row', { ...TM_CLAIM, withdrawn_at: '2026-10-06T00:00:00Z' }, TM_STATE],
    ['the T&M claim row', TM_CLAIM, { ...TM_STATE, status: 'Withdrawn' }],
  ])('AC-TM-014 refuses a T&M claim withdrawn in %s with its claim type in the message', async (_label, claim, tmState) => {
    const withdrawn = { claims: [tmState], lines: TM_LINES };
    const { attempt, fetchImpl } = refused(command({}), claim, EVIDENCE, {}, {}, withdrawn);
    await expect(attempt).rejects.toThrow('This time-and-materials claim was withdrawn, so no invoice can be raised for it');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['progress-claim header', { ...TM_CLAIM, gross_amount: '6000000.03' }, TM_STATE],
    ['T&M claim header', TM_CLAIM, { ...TM_STATE, gross_amount: '6000000.03' }],
  ])('AC-TM-014 refuses T&M lines that do not match the %s before any ERP call', async (_label, claim, tmState) => {
    const mismatched = { claims: [tmState], lines: TM_LINES };
    const { attempt, fetchImpl } = refused(command({}), claim, EVIDENCE, {}, {}, mismatched);
    await expect(attempt).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TM-014 scopes signed T&M lines to the dispatching org', async () => {
    const otherOrgLine = {
      ...TM_LINES[0], org_id: 'org-2', line_key: 'rate-line-3', label: 'Foreign org line',
      units: '1.00', rate: '1.00', amount: '1.00',
    };
    const { body } = await push({}, TM_CLAIM, {}, {}, {}, { claims: [TM_STATE], lines: [...TM_LINES, otherOrgLine] });
    expect(body.items).toEqual([
      { item_code: 'SERVICE-LABOUR', qty: 120, rate: 50000, description: 'Site engineer (hour)' },
      { item_code: 'SERVICE-LABOUR', qty: 0.33, rate: 0.05, description: 'Rounding case (hour)' },
    ]);
  });

  it('AC-TM-014 refuses an unmapped T&M label before the ERP write', async () => {
    const lines = TM_LINES.map((line) => line.line_key === 'rate-line-1' ? { ...line, label: 'Unmapped rate label' } : line);
    const cmd = command({});
    const { fetchImpl } = erpFetch();
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClient(TM_CLAIM, EVIDENCE, {}, {}, { claims: [TM_STATE], lines }), orgId: ORG, command: cmd,
      fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    });
    const attempt = adapter.commit(cmd);
    await expect(attempt).rejects.toMatchObject({
      code: 'commit-rejected', message: expect.stringContaining('Unmapped rate label'),
    });
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
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

  it('AC-856-6 AC-PPNC-018 a VAT-off progress or down-payment claim create follows the authoritative flag and sends no rows', async () => {
    const { body } = await push({ taxes: [{ charge_type: 'On Net Total', account_head: 'EVIL', rate: 99 }] }, CLAIM, {}, {}, { subject_to_vat: false });
    expect(body.taxes).toBeUndefined();
    const down = await push({}, { ...CLAIM, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00' }, {}, {}, { subject_to_vat: false });
    expect(down.body.taxes).toBeUndefined();
  });

  it('AC-PPNC-015 a claim create stamps the authoritative project flag over any caller value, and fails closed on a non-boolean source', async () => {
    // The caller forges FALSE; the project says TRUE — the claim stamp is the project's.
    const on = await push({ vat_flag_at_resolution: false });
    expect(on.command.record.vat_flag_at_resolution).toBe(true);
    // ...and the false direction: a VAT-off project stamps false (never the caller's true).
    const off = await push({ vat_flag_at_resolution: true }, CLAIM, {}, {}, { subject_to_vat: false });
    expect(off.command.record.vat_flag_at_resolution).toBe(false);

    // A non-boolean project flag refuses the resolution before any ERP call (fails closed).
    const { attempt, fetchImpl } = refused(command({ vat_flag_at_resolution: true }), CLAIM, EVIDENCE, {}, { subject_to_vat: 'true' });
    await expect(attempt).rejects.toMatchObject({ code: 'config-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-020 AC-PPNC-018 a VAT-on progress claim create sends server-resolved tax rows on claim-derived net total', async () => {
    const { body } = await push({});
    expect(body.taxes).toEqual([{ charge_type: 'On Net Total', account_head: 'VAT - SC', description: 'VAT', rate: 10 }]);
    // ERP taxes the net total: 4×50,000 + 1×100,000 − 40,000 recovery = 260,000 (the recovery line is in the items).
    const items = body.items as Array<{ qty: number; rate: number }>;
    expect(items.reduce((sum, item) => sum + item.qty * item.rate, 0)).toBe(260000);
  });

  it('AC-PB-020 AC-PPNC-018 a VAT-on down-payment create uses its authoritative flag and server-resolved tax rows', async () => {
    const { body } = await push({}, { ...CLAIM, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00' });
    expect(body.taxes).toEqual([{ charge_type: 'On Net Total', account_head: 'VAT - SC', description: 'VAT', rate: 10 }]);
  });

  it('AC-PB-020 scales the rate by the work order\'s reduced tax base (11/12 of 12% is 11%)', async () => {
    const { body } = await push({}, { ...CLAIM, work_order_id: 'wo-1' },
      { template: { name: 'Synthetic Sales Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT - SC', rate: 12 }] } },
      { tax_base_numerator: 11, tax_base_denominator: 12 });
    expect((body.taxes as Row[])[0].rate).toBe(11);
  });

  it.each([
    ['a progress claim', CLAIM],
    ['a down payment claim', { ...CLAIM, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00' }],
  ])('AC-856-10 %s on a VAT-on project is refused (config-rejected) when ERPNext has no default tax template', async (_label, claim) => {
    const { attempt, fetchImpl } = refused(command({}), claim, EVIDENCE, { template: null });
    await expect(attempt).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('default Sales Taxes and Charges template') });
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('AC-PB-020 refuses a template row that is not On Net Total', async () => {
    const { attempt } = refused(command({}), CLAIM, EVIDENCE, { template: { name: 'Synthetic Sales Tax', taxes: [{ charge_type: 'Actual', account_head: 'VAT - SC', rate: 0 }] } });
    await expect(attempt).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-PB-020 never lets a caller smuggle tax rows into any invoice', async () => {
    const forged = [{ charge_type: 'On Net Total', account_head: 'EVIL', rate: 99 }];
    expect((await push({ taxes: forged })).body.taxes).toEqual([{ charge_type: 'On Net Total', account_head: 'VAT - SC', description: 'VAT', rate: 10 }]);
    // An ordinary invoice's rows are built server-side too (#856): the template row, never the caller's.
    expect((await push({ taxes: forged, items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] }, null)).body.taxes).toEqual([{ charge_type: 'On Net Total', account_head: 'VAT - SC', description: 'VAT', rate: 10 }]);
  });

  // OD-BILL-1 / DD-BWO-8 deliberately reverses the 0250-era rule this test used to pin ("an ordinary invoice never
  // takes a caller-supplied work order"). The protection moved rather than disappeared: the link pre-flight checks the
  // work order's org, and the outbox fence (0262, AC-BWO-002) checks its project, status and what is left BEFORE any
  // ERP write — so the stranded-mirror risk the old rule avoided cannot occur.
  it('AC-BWO-003 an ordinary invoice create keeps the work order it names and takes the client PO from it', async () => {
    const { body, command: cmd } = await push({ workOrderId: 'wo-1', items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] }, null);
    expect(cmd.record.workOrderId).toBe('wo-1');
    expect(body.po_no).toBe('WO-PO-001');
  });

  it('AC-BWO-003 an edit never moves an ordinary invoice onto a caller-named work order', async () => {
    const cmd = command({ id: 'si-9', workOrderId: 'wo-1', externalRecordId: 'SYNTHETIC-SI-9', items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] }, 'update');
    const { attempt } = refused(cmd, null);
    await attempt.catch(() => undefined);
    expect(cmd.record.workOrderId).toBeUndefined();
  });

  it('AC-PB-007 refuses a case-variant claim id before any ERP call (one claim, one invoice)', async () => {
    const { attempt, fetchImpl } = refused(command({ id: 'CLAIM-1' }));
    await expect(attempt).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-021 refuses a claim with a recovery line, before any ERP write, when negative rates are off', async () => {
    const { attempt, fetchImpl } = refused(command({}), CLAIM, EVIDENCE, { negativeRates: false });
    await expect(attempt).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('Allow Negative rates for Items') });
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('AC-PB-021 does not need the setting for a claim without a recovery line', async () => {
    const { body } = await push({}, { ...CLAIM, dp_recovery_amount: '0.00' }, { negativeRates: false });
    expect((body.items as Row[]).every((item) => (item.rate as number) > 0)).toBe(true);
  });

  it('AC-PB-006 ignores a caller-supplied reference_number and received_date on a claim invoice', async () => {
    const { body, command: cmd } = await push({ reference_number: 'FORGED-PO', po_date: '2020-01-01', received_date: '2020-02-02' });
    expect(body.po_no).toBeUndefined();
    expect(body.po_date).toBeUndefined();
    expect(body.custom_received_date).toBeUndefined();
    expect(cmd.record.reference_number).toBeNull();
  });

  it('AC-858-1 a replayed claim create uses the persisted items and taxes: no ERPNext read, same digest after the template, VAT flag and negative-rates setting change', async () => {
    const first = await push({});
    const persisted = structuredClone(first.command.record) as Row;
    const { fetchImpl } = erpFetch({ negativeRates: false, template: { ...TAX_TEMPLATE, taxes: [{ ...TAX_TEMPLATE.taxes[0], rate: 99 }] } });
    const replay = command({});
    replay.record = structuredClone(persisted) as AdapterCommand['record'];
    await resolveErpDispatchAdapter({
      serviceClient: serviceClient(CLAIM, EVIDENCE, {}, { subject_to_vat: false }), orgId: ORG, command: replay, replay: true,
      fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await digest(replay)).toBe(await digest(first.command));
  });

  /** A recovery replays a persisted record, but the org link and project gates are not derivations: they must still run. */
  async function replayOf(patch: Row) {
    const first = await push({});
    const replay = command({});
    replay.record = { ...structuredClone(first.command.record), ...patch } as AdapterCommand['record'];
    const { fetchImpl } = erpFetch();
    const attempt = resolveErpDispatchAdapter({
      serviceClient: serviceClient(CLAIM), orgId: ORG, command: replay, replay: true,
      fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    });
    return { attempt, fetchImpl };
  }

  it('AC-858-1 a replay whose persisted customer or project belongs to another org is refused before any ERPNext fetch', async () => {
    for (const patch of [{ customerId: 'cust-org2' }, { projectId: 'proj-org2' }]) {
      const { attempt, fetchImpl } = await replayOf(patch);
      await expect(attempt).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('AC-858-1 a replay with an unmapped project is refused while require_project_on_si is on', async () => {
    const { attempt, fetchImpl } = await replayOf({ projectId: 'proj-3' });
    await expect(attempt).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringContaining('no ERP project mapping') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-858-2 a claim invoice body carries the claim currency, and a replay sends the same', async () => {
    const first = await push({});
    expect(first.body.currency).toBe('IDR');
    expect(first.command.record.currency).toBe('IDR');
    const usd = await push({}, { ...CLAIM, currency: 'USD' }, { customerCurrency: 'USD', companyCurrency: 'USD' });
    expect(usd.body.currency).toBe('USD');
  });

  it('AC-858-2 a caller-supplied currency on a non-claim invoice is dropped (#866: the project currency is sent instead)', async () => {
    const { body } = await push({ id: 'not-a-claim', currency: 'USD', items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] }, null);
    expect(body.currency).toBe('IDR');
  });

  it('AC-858-3 an unreadable Selling Settings gives the action-required message, not a raw permission error, before any ERP write', async () => {
    const { attempt, fetchImpl } = refused(command({}), CLAIM, EVIDENCE, { settingsDenied: true });
    await expect(attempt).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('read Selling Settings') });
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('AC-858-2 refuses a claim whose currency differs from the customer billing currency, before any ERP write', async () => {
    const { attempt, fetchImpl } = refused(command({}), { ...CLAIM, currency: 'USD' });
    await expect(attempt).rejects.toMatchObject({ code: 'config-rejected', message: expect.stringContaining('USD') });
    await expect(attempt).rejects.toMatchObject({ message: expect.stringContaining('IDR') });
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('AC-858-2 falls back to the ERPNext company currency when the customer states none', async () => {
    const { attempt } = refused(command({}), { ...CLAIM, currency: 'USD' }, EVIDENCE, { customerCurrency: null, companyCurrency: 'USD' });
    await expect(attempt).resolves.toBeDefined();
  });

  it('AC-858-2 accepts a claim in the customer billing currency', async () => {
    const { body } = await push({});
    expect(body.items).toBeDefined();
  });
});
