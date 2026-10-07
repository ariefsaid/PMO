/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-13/22) — a vendor bill on an ERP-connected org carries the VAT and PPh the user
 * ENTERED; the dispatch turns them into fixed ERPNext `Actual` rows on the org's tax accounts. Drives the shipped
 * dispatch factory + adapter commit with PostgREST and ERPNext fakes (the #520 harness shape).
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { piToBody, piFromDoc } from './bodies/purchaseInvoice.ts';
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
const SETTINGS: Row = {
  input_vat_account: 'Input VAT - SC', pph23_payable_account: 'PPh 23 Payable - SC', pph4_2_payable_account: 'PPh 4(2) Payable - SC',
};
const ERP_ACCOUNTS: Record<string, Row> = {
  'Input VAT - SC': { company: COMPANY, is_group: 0, root_type: 'Asset' },
  'PPh 23 Payable - SC': { company: COMPANY, is_group: 0, root_type: 'Liability' },
  'PPh 4(2) Payable - SC': { company: COMPANY, is_group: 0, root_type: 'Liability' },
  'Foreign PPh - OC': { company: 'Other Co', is_group: 0, root_type: 'Liability' },
  'Duties and Taxes - SC': { company: COMPANY, is_group: 1, root_type: 'Liability' },
  'Discount - SC': { company: COMPANY, is_group: 0, root_type: 'Income' },
};

/** PostgREST boundary fake: honours eq filters and the selected columns (a missing column throws). */
function serviceClient(settings: Row = SETTINGS): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [BINDING],
    organizations: [{ id: ORG, ...settings }],
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

function erpFetch() {
  const writes: Row[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path === '/api/resource/Item') {
      return Response.json({ data: [{ name: 'SYNTHETIC-ITEM', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] });
    }
    if (path.startsWith('/api/resource/Account/')) {
      const name = path.slice('/api/resource/Account/'.length);
      return name in ERP_ACCOUNTS
        ? Response.json({ data: { name, ...ERP_ACCOUNTS[name] } })
        : new Response('{"exc_type":"DoesNotExistError"}', { status: 404 });
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Row;
      writes.push(body);
      return Response.json({ data: { ...body, name: 'SYNTHETIC-PI-876', docstatus: 0, grand_total: 222, outstanding_amount: 222 } });
    }
    return Response.json({ data: { name: 'SYNTHETIC-PI-876', docstatus: 1, grand_total: 222, outstanding_amount: 222 } });
  });
  return { writes, fetchImpl };
}

function command(record: Row = {}, operation: AdapterCommand['operation'] = 'create'): AdapterCommand {
  return {
    domain: 'procurement', operation, idempotencyKey: 'pi-tax-876-key',
    record: { id: 'vi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice', items: ITEMS, ...record },
  };
}

async function resolve(cmd: AdapterCommand, erp: ReturnType<typeof erpFetch>, settings: Row = SETTINGS, replay = false) {
  return resolveErpDispatchAdapter({
    serviceClient: serviceClient(settings), orgId: ORG, command: cmd, replay,
    fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc } },
  });
}

async function push(record: Row, settings: Row = SETTINGS) {
  const cmd = command(record);
  const erp = erpFetch();
  await (await resolve(cmd, erp, settings)).commit(cmd);
  return { body: erp.writes[0] ?? {}, command: cmd, ...erp };
}

const VAT_ROW = { charge_type: 'Actual', account_head: 'Input VAT - SC', description: 'VAT', tax_amount: 22, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0 };
const PPH23_ROW = { charge_type: 'Actual', account_head: 'PPh 23 Payable - SC', description: 'PPh 23', tax_amount: 4, category: 'Total', add_deduct_tax: 'Deduct', included_in_print_rate: 0 };
const BAD = (label: string, liability: boolean) =>
  `The ${label} in Administration → Accounting is not a usable ${liability ? 'tax-payable (liability) ' : ''}account of this organization's ERPNext company. Correct it, then record the invoice again.`;

describe('vendor invoice tax entered as amounts (#876 slice 2)', () => {
  it('AC-VWH-033 entered VAT and PPh 23 become two Actual rows on the org accounts, with an empty template', async () => {
    const { body, command: cmd } = await push({ vatAmount: 22, withheldAmount: 4, pphType: 'pph23' });
    expect(body.taxes_and_charges).toBe('');
    expect(body.taxes).toEqual([VAT_ROW, PPH23_ROW]);
    expect(cmd.record.taxesFromAmounts).toBe(true);
  });

  it('AC-VWH-033 PPh 4(2) posts to the PPh 4(2) payable account', async () => {
    const { body } = await push({ vatAmount: 0, withheldAmount: 4, pphType: 'pph4_2' });
    expect(body.taxes).toEqual([{ ...PPH23_ROW, account_head: 'PPh 4(2) Payable - SC', description: 'PPh 4(2)' }]);
  });

  it('AC-VWH-033 a zero VAT and no withholding sends an explicit empty tax table (no ERPNext default applies)', async () => {
    const { body } = await push({ vatAmount: 0, withheldAmount: 0, pphType: null });
    expect(body.taxes_and_charges).toBe('');
    expect(body.taxes).toEqual([]);
  });

  it('AC-VWH-033 caller-supplied rows and the server-only marker are dropped, with or without amounts', async () => {
    const forged = [{ charge_type: 'Actual', account_head: 'EVIL - SC', tax_amount: 999, add_deduct_tax: 'Deduct', category: 'Total' }];
    expect((await push({ taxes: forged, taxesFromAmounts: true, vatAmount: 22, withheldAmount: 0, pphType: null })).body.taxes).toEqual([VAT_ROW]);
    const plain = await push({ taxes: forged, taxesFromAmounts: true });
    expect(plain.body).not.toHaveProperty('taxes');
    expect(plain.body).not.toHaveProperty('taxes_and_charges');
    // The command snapshotted into the outbox (and replayed from it) carries neither the forged rows nor the marker.
    expect(plain.command.record).not.toHaveProperty('taxes');
    expect(plain.command.record).not.toHaveProperty('taxesFromAmounts');
  });

  it('AC-VWH-033 a template and amounts together are refused before any ERPNext read', async () => {
    const erp = erpFetch();
    await expect(resolve(command({ taxTemplate: 'Synthetic Input VAT', vatAmount: 22 }), erp))
      .rejects.toMatchObject({ code: 'commit-rejected', message: 'Choose an ERPNext tax template or enter the tax amounts — not both.' });
    expect(erp.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a negative VAT', { vatAmount: -1, withheldAmount: 0, pphType: null }, "The vendor invoice's VAT amount must be zero or a positive amount with at most two decimals."],
    ['a VAT with three decimals', { vatAmount: 1.005, withheldAmount: 0, pphType: null }, "The vendor invoice's VAT amount must be zero or a positive amount with at most two decimals."],
    ['a withholding given as text', { vatAmount: 0, withheldAmount: '4', pphType: 'pph23' }, "The vendor invoice's tax withheld must be zero or a positive amount with at most two decimals."],
    ['a withholding without its type', { vatAmount: 0, withheldAmount: 4, pphType: null }, 'Say whether the tax withheld is PPh 23 or PPh 4(2).'],
    ['an unknown withholding type', { vatAmount: 0, withheldAmount: 4, pphType: 'pph21' }, 'The withholding type must be PPh 23 or PPh 4(2).'],
    ['a withholding above the items total', { vatAmount: 0, withheldAmount: 200.01, pphType: 'pph23' }, "The tax withheld is larger than the invoice's items total before tax. Check the PPh amount on the vendor's invoice."],
  ] as Array<[string, Row, string]>)('AC-VWH-033 %s is refused (commit-rejected) before any ERPNext read or write', async (_label, record, message) => {
    const erp = erpFetch();
    await expect(resolve(command(record), erp)).rejects.toMatchObject({ code: 'commit-rejected', message });
    expect(erp.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['the PPh 23 setting is empty', { ...SETTINGS, pph23_payable_account: null }, 'Set the PPh 23 payable account in Administration → Accounting before recording this tax on a vendor invoice.'],
    ['the input VAT setting is empty', { ...SETTINGS, input_vat_account: null }, 'Set the Input VAT account in Administration → Accounting before recording this tax on a vendor invoice.'],
    ['ERPNext has no such account', { ...SETTINGS, pph23_payable_account: 'Missing - SC' }, BAD('PPh 23 payable account', true)],
    ['the account belongs to another company', { ...SETTINGS, pph23_payable_account: 'Foreign PPh - OC' }, BAD('PPh 23 payable account', true)],
    ['the account is a group', { ...SETTINGS, pph23_payable_account: 'Duties and Taxes - SC' }, BAD('PPh 23 payable account', true)],
    ['the PPh account is not a liability', { ...SETTINGS, pph23_payable_account: 'Discount - SC' }, BAD('PPh 23 payable account', true)],
    ['the VAT account belongs to another company', { ...SETTINGS, input_vat_account: 'Foreign PPh - OC' }, BAD('Input VAT account', false)],
  ] as Array<[string, Row, string]>)('AC-VWH-033 %s is refused (config-rejected) naming the setting, before any ERPNext write', async (_label, settings, message) => {
    const erp = erpFetch();
    const err = await resolve(command({ vatAmount: 22, withheldAmount: 4, pphType: 'pph23' }), erp, settings)
      .then(() => null, (e: Error & { code?: string }) => e);
    expect(err).toMatchObject({ code: 'config-rejected', message });
    // ADR-0072: the refusal names the setting, never the account or the ERP company.
    expect(err!.message).not.toMatch(/ - (SC|OC)/);
    expect(err!.message).not.toContain(COMPANY);
    expect(erp.writes).toEqual([]);
  });

  it('AC-VWH-033 a replayed create keeps its persisted rows: no ERPNext read, same digest after the settings changed', async () => {
    const first = await push({ vatAmount: 22, withheldAmount: 4, pphType: 'pph23' });
    const replay = command();
    replay.record = structuredClone(first.command.record) as AdapterCommand['record'];
    const erp = erpFetch();
    await resolve(replay, erp, { ...SETTINGS, input_vat_account: 'Changed VAT - SC' }, true);
    expect(erp.fetchImpl).not.toHaveBeenCalled();
    expect(await canonicalCommandDigest({ domain: replay.domain, operation: replay.operation, record: replay.record }))
      .toBe(await canonicalCommandDigest({ domain: first.command.domain, operation: first.command.operation, record: first.command.record }));
  });
});
