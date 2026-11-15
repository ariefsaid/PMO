/**
 * #2117 — the ERPNext submit resolvers issue their independent read-only steps together, so the serial
 * round trips before an invoice create shrink. Waves are COUNTED, never timed: every ERPNext and PMO read
 * is held by a gate, and the gate releases everything pending at once each time the code under test has
 * gone quiet. One release is one wave — a read issued only after another read answered lands in a later
 * wave, reads issued together land in the same one. (A 200 ms adapter fake is this gate: the elapsed time
 * is waves × 200 ms.)
 */
import { describe, expect, it } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { siFromDoc, siToBody } from './bodies/salesInvoice.ts';
import { piFromDoc, piToBody } from './bodies/purchaseInvoice.ts';
import { buildEnteredPurchaseTaxRows } from './erpPurchaseTaxRows.ts';
import { resolvePaymentRefs, resolveProcurementOrderRefs } from './dispatchProcurement.ts';
import { resolveReceiptConfig } from './dispatchRevenue.ts';
import type { ErpDispatchFactoryDeps, ExternalOrgBindingRow } from './dispatchTypes.ts';
import type { AdapterCommand } from '../contract.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';

interface Release { wave: number; kind: 'erp' | 'db'; what: string }

/** Holds every read until `drive` releases the whole pending batch as one wave. */
function gate() {
  let pending: Array<() => void> = [];
  let wave = 0;
  const log: Release[] = [];
  const hold = <T>(kind: Release['kind'], what: string, answer: () => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending.push(() => {
        log.push({ wave, kind, what });
        try { resolve(answer()); } catch (err) { reject(err); }
      });
    });
  const quiet = async () => {
    // Body parsing and continuations settle within a few macrotask turns; wait until no new read appears.
    for (let idle = 0; idle < 5;) {
      const before = pending.length;
      await new Promise((r) => setImmediate(r));
      idle = pending.length === before ? idle + 1 : 0;
    }
  };
  async function drive<T>(work: () => Promise<T>): Promise<T> {
    let settled = false;
    const run = work().finally(() => { settled = true; });
    run.catch(() => undefined);
    for (let stalls = 0; !settled;) {
      await quiet();
      if (settled) break;
      if (pending.length === 0) {
        // Non-read async work (e.g. hashing) is still running: keep waiting, without opening a wave.
        if (++stalls > 200) throw new Error('no read pending and the work has not settled');
        await new Promise((r) => setTimeout(r, 1));
        continue;
      }
      stalls = 0;
      wave += 1;
      const batch = pending;
      pending = [];
      for (const release of batch) release();
    }
    return run;
  }
  return { hold, drive, log };
}

type Gate = ReturnType<typeof gate>;

/** PostgREST boundary fake (filters + selected columns, as the sibling suites), every read gated as `db`. */
function serviceClient(g: Gate, rows: Record<string, Row[]>): DispatchServiceClient {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, unknown> = {};
          const matches = () => (rows[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) =>
            Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
          const pick = (row: Row): Row => Object.fromEntries(columns.split(',').map((col) => col.trim()).map((col) => {
            if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
            return [col, row[col]];
          }));
          const chain = {
            eq(col: string, val: unknown) { filters[col] = val; return chain; },
            in(col: string, values: unknown[]) { filters[col] = values; return chain; },
            order() { return chain; },
            limit() { return chain; },
            gt() { return chain; },
            maybeSingle() {
              return g.hold('db', `${table}(${columns})`, () => { const row = matches()[0]; return { data: row ? pick(row) : null, error: null }; });
            },
            then(resolve: (value: unknown) => void, reject: (err: unknown) => void) {
              return g.hold('db', `${table}[](${columns})`, () => ({ data: matches().map(pick), error: null })).then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },
  } as unknown as DispatchServiceClient;
}

const TEMPLATE = { name: 'Synthetic Sales Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT - SC', rate: 12, description: 'VAT' }] };
const ITEM_NAMES = ['OWN-ITEM', 'SURVEY', 'STATION', 'DP-ITEM'];

interface ErpOpts { customerCurrency?: string | null; companyCurrency?: string; negativeRates?: boolean; template?: unknown }

/** ERPNext fake, every call gated as `erp`; the first POST is the create. */
function erpFetch(g: Gate, opts: ErpOpts = {}) {
  const { customerCurrency = 'IDR', companyCurrency = 'IDR', negativeRates = true, template = TEMPLATE } = opts;
  const writes: Row[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    const method = init?.method ?? 'GET';
    return g.hold('erp', `${method} ${path}`, () => {
      if (method === 'GET' && path === '/api/resource/Item') {
        return Response.json({ data: ITEM_NAMES.map((name) => ({ name, item_name: name, disabled: 0, is_sales_item: 1, is_purchase_item: 0 })) });
      }
      if (path === '/api/resource/Customer/Synthetic Customer') return Response.json({ data: { name: 'Synthetic Customer', default_currency: customerCurrency } });
      if (path === '/api/resource/Company/Synthetic Co') return Response.json({ data: { name: 'Synthetic Co', default_currency: companyCurrency } });
      if (path === '/api/resource/System Settings/System Settings') return Response.json({ data: { float_precision: '3', currency_precision: '2', number_format: '#,###.##' } });
      if (path === '/api/resource/Selling Settings/Selling Settings') return Response.json({ data: { allow_negative_rates_for_items: negativeRates ? 1 : 0 } });
      if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: template ? [{ name: 'Synthetic Sales Tax' }] : [] });
      if (path === '/api/resource/Sales Taxes and Charges Template/Synthetic Sales Tax') return Response.json({ data: template });
      if (method !== 'POST') throw new Error(`unexpected ERPNext read ${path}`);
      const body = JSON.parse(String(init?.body)) as Row;
      writes.push(body);
      return new Response(JSON.stringify({ data: { name: 'SYNTHETIC-SI-2117', ...body, docstatus: 0 } }), { status: 200 });
    });
  };
  return { fetchImpl: fetchImpl as typeof fetch, writes };
}

const BINDING = { org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-09-01', config: { company: 'Synthetic Co', project_map: { 'proj-1': 'ERP-PROJ-001' } } };
const PROJECT = { id: 'proj-1', org_id: ORG, client_id: 'cust-1', currency: 'IDR', customer_contract_ref: null, contract_date: null, subject_to_vat: true, tax_base_numerator: 1, tax_base_denominator: 1 };

function baseRows(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    external_org_bindings: [BINDING],
    companies: [{ id: 'cust-1', org_id: ORG }],
    external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'cust-1', external_record_id: 'Customer:Synthetic Customer' }],
    projects: [PROJECT],
    organizations: [{ id: ORG, default_currency: 'IDR' }],
    work_orders: [],
    sales_invoices: [],
    progress_claims: [],
    ...extra,
  };
}

function invoiceCommand(record: Row = {}): AdapterCommand {
  return {
    domain: 'revenue', operation: 'create', idempotencyKey: 'waves-2117-key',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [{ item_code: 'OWN-ITEM', qty: 2, rate: 500 }], ...record },
  };
}

/** Resolve the adapter and commit (the create POST), all under one gate. */
async function run(rows: Record<string, Row[]>, cmd: AdapterCommand, opts: ErpOpts = {}) {
  const g = gate();
  const erp = erpFetch(g, opts);
  let resolvedAtWave = -1;
  const outcome = g.drive(async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClient(g, rows), orgId: ORG, command: cmd,
      fetchImpl: erp.fetchImpl, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
      doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
    });
    resolvedAtWave = g.log.length ? g.log[g.log.length - 1].wave : 0;
    await adapter.commit(cmd);
  });
  return { outcome, log: g.log, writes: erp.writes, resolvedAt: () => resolvedAtWave };
}

const distinct = (entries: Release[]) => new Set(entries.map((e) => e.wave)).size;

function wavesBeforeCreate(log: Release[]): { erp: number; all: number } {
  const post = log.find((e) => e.kind === 'erp' && e.what.startsWith('POST '));
  if (!post) throw new Error('no create POST was issued');
  const before = log.filter((e) => e.wave < post.wave);
  return { erp: distinct(before.filter((e) => e.kind === 'erp')), all: distinct(before) };
}

describe('#2117 ordinary invoice create — independent reads run together', () => {
  it('AC-2117-1 the currency and VAT resolvers share one project read, issued with the customer mapping read', async () => {
    const r = await run(baseRows(), invoiceCommand());
    await r.outcome;
    expect(r.writes).toHaveLength(1);
    // resolveSalesInvoicePo reads the contract-reference columns (another resolver); currency + VAT share one read.
    const shared = r.log.filter((e) => e.kind === 'db' && e.what.startsWith('projects(') && /currency|subject_to_vat/.test(e.what));
    expect(shared).toHaveLength(1);
    const customerMapping = r.log.filter((e) => e.what.startsWith('external_refs(') && e.wave === shared[0].wave);
    expect(customerMapping).toHaveLength(1);
  });

  it('AC-2117-1 the create POST follows at most 13 serial round trips (was 15); its ERPNext reads stay at 4 serial waves', async () => {
    const r = await run(baseRows(), invoiceCommand());
    await r.outcome;
    const waves = wavesBeforeCreate(r.log);
    expect(waves.all).toBeLessThanOrEqual(13);
    // Customer currency → template list → template → item catalog: the template is never read before the currency
    // check passes (AC-866-1 pins that), and the catalog belongs to the commit, so 4 is the floor here.
    expect(waves.erp).toBe(4);
  });
});

const CLAIM: Row = {
  id: 'claim-1', org_id: ORG, kind: 'progress', currency: 'IDR', project_id: 'proj-1', work_order_id: 'wo-1',
  gross_amount: '260000.00', down_payment_amount: null, dp_recovery_amount: '40000.00', dp_item_code: 'DP-ITEM', withdrawn_at: null,
};
const LINES: Row[] = [
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-a', item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: '4.000', rate: '50000.00', amount: '200000.00' },
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-b', item_code: 'STATION', description: 'Station build', unit: 'unit', quantity: '1.000', rate: '100000.00', amount: '100000.00' },
];
const claimRows = (extra: Record<string, Row[]> = {}) => baseRows({
  progress_claims: [CLAIM],
  progress_claim_lines: LINES,
  progress_claim_evidence: [{ id: 'ev-1', org_id: ORG, claim_id: 'claim-1' }],
  work_orders: [{ id: 'wo-1', org_id: ORG, client_po_number: 'WO-PO-001', order_date: '2026-09-01', tax_base_numerator: 1, tax_base_denominator: 1 }],
  ...extra,
});
const claimCommand = (record: Row = {}) => invoiceCommand({ id: 'claim-1', items: undefined, ...record });

/** The claim resolver's span: from its claim read to the end of adapter resolution. */
function claimSpan(log: Release[], resolvedAt: number) {
  const claimRead = log.find((e) => e.what.startsWith('progress_claims('));
  if (!claimRead) throw new Error('the claim was never read');
  const firstErp = log.find((e) => e.kind === 'erp');
  const dbEnd = firstErp ? firstErp.wave : resolvedAt + 1;
  return {
    db: distinct(log.filter((e) => e.kind === 'db' && e.wave >= claimRead.wave && e.wave < dbEnd)),
    erp: distinct(log.filter((e) => e.kind === 'erp' && e.wave <= resolvedAt)),
  };
}

describe('#2117 progress-claim invoice create — independent reads run together', () => {
  it('AC-2117-2 the claim resolver reads PMO in at most 2 waves and ERPNext in at most 2 waves before the create', async () => {
    const r = await run(claimRows(), claimCommand());
    await r.outcome;
    expect(r.writes).toHaveLength(1);
    const span = claimSpan(r.log, r.resolvedAt());
    expect(span.db).toBeLessThanOrEqual(2);
    expect(span.erp).toBeLessThanOrEqual(2);
  });
});

// ── Vendor bill: the chosen template's list check + single-doc re-check, then its withholding accounts ──────────────
const PURCHASE_TEMPLATE = {
  name: 'Synthetic Input VAT', company: 'Synthetic Co', disabled: 0,
  taxes: [
    { charge_type: 'On Net Total', account_head: 'Input VAT - SC', rate: 11, description: 'Input VAT', category: 'Total', add_deduct_tax: 'Add' },
    { charge_type: 'On Net Total', account_head: 'PPh 23 - SC', rate: 2, description: 'PPh 23', category: 'Total', add_deduct_tax: 'Deduct' },
    { charge_type: 'On Net Total', account_head: 'PPh 4(2) - SC', rate: 1, description: 'PPh 4(2)', category: 'Total', add_deduct_tax: 'Deduct' },
  ],
};

function purchaseErp(g: Gate) {
  const writes: Row[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    const method = init?.method ?? 'GET';
    return g.hold('erp', `${method} ${path}`, () => {
      if (method === 'GET' && path === '/api/resource/Item') return Response.json({ data: [{ name: 'SYNTHETIC-ITEM', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] });
      if (path === '/api/resource/Purchase Taxes and Charges Template') return Response.json({ data: [{ name: PURCHASE_TEMPLATE.name }] });
      if (path === `/api/resource/Purchase Taxes and Charges Template/${PURCHASE_TEMPLATE.name}`) return Response.json({ data: PURCHASE_TEMPLATE });
      if (path.startsWith('/api/resource/Account/')) {
        return Response.json({ data: { name: path.slice('/api/resource/Account/'.length), company: 'Synthetic Co', is_group: 0, root_type: 'Liability' } });
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Row;
        writes.push(body);
        return Response.json({ data: { ...body, name: 'SYNTHETIC-PI-2117', docstatus: 0, grand_total: 222, outstanding_amount: 222 } });
      }
      // After the create (the sibling suite's fallback): the invoice as ERPNext now holds it.
      return Response.json({ data: { name: 'SYNTHETIC-PI-2117', docstatus: 1, grand_total: 222, outstanding_amount: 222 } });
    });
  };
  return { fetchImpl: fetchImpl as typeof fetch, writes };
}

describe('#2117 vendor bill create — independent reads run together', () => {
  it('AC-2117-4 a chosen template with two withholding rows reaches its create POST within 3 serial ERP waves (was 5)', async () => {
    const g = gate();
    const erp = purchaseErp(g);
    const rows: Record<string, Row[]> = {
      external_org_bindings: [{ ...BINDING, config: { company: 'Synthetic Co' } }],
      procurements: [{ id: 'proc-1', org_id: ORG, vendor_id: 'vendor-1', project_id: null }],
      companies: [{ id: 'vendor-1', org_id: ORG }],
      external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'vendor-1', external_record_id: 'Supplier:Synthetic Supplier' }],
      procurement_items: [],
    };
    const cmd: AdapterCommand = {
      domain: 'procurement', operation: 'create', idempotencyKey: 'pi-waves-2117',
      record: { id: 'vi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice', items: [{ item_code: 'SYNTHETIC-ITEM', qty: 2, rate: 100 }], taxTemplate: PURCHASE_TEMPLATE.name },
    };
    await g.drive(async () => {
      const adapter = await resolveErpDispatchAdapter({
        serviceClient: serviceClient(g, rows), orgId: ORG, command: cmd,
        fetchImpl: erp.fetchImpl, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
        doctypeBodies: { 'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc } },
      });
      await adapter.commit(cmd);
    });
    expect(erp.writes).toHaveLength(1);
    expect((erp.writes[0].taxes as Row[]).map((row) => row.account_head)).toEqual(['Input VAT - SC', 'PPh 23 - SC', 'PPh 4(2) - SC']);
    expect(wavesBeforeCreate(g.log).erp).toBeLessThanOrEqual(3);
  });

  it('AC-2117-4 entered VAT and PPh amounts check both tax accounts in one ERP wave (was 2)', async () => {
    const g = gate();
    const erp = purchaseErp(g);
    const built = await g.drive(() => buildEnteredPurchaseTaxRows(
      { fetchImpl: erp.fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' }, 'Synthetic Co',
      { vatAmount: 11, withheldAmount: 2, pphType: 'pph23' }, { inputVat: 'Input VAT - SC', pph23: 'PPh 23 - SC', pph4_2: null }, 100,
    ));
    expect(built.map((row) => row.account_head)).toEqual(['Input VAT - SC', 'PPh 23 - SC']);
    expect(distinct(g.log.filter((e) => e.kind === 'erp'))).toBe(1);
  });
});

// ── Smaller paths: vendor payment, withheld-tax receipt, procurement order refs ───────────────────────────────────────
function directDeps(g: Gate, rows: Record<string, Row[]>, record: Row, fetchImpl?: typeof fetch): ErpDispatchFactoryDeps {
  return {
    serviceClient: serviceClient(g, rows), orgId: ORG,
    command: { domain: 'procurement', operation: 'create', idempotencyKey: 'direct-2117', record: record as AdapterCommand['record'] },
    fetchImpl: fetchImpl ?? (async () => { throw new Error('no ERPNext call expected'); }) as typeof fetch,
    apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
  } as ErpDispatchFactoryDeps;
}

describe('#2117 smaller resolvers — independent reads run together', () => {
  it('AC-2117-5 a vendor payment reads its bill, the org currency and the bill mapping in one PMO wave (was 3)', async () => {
    const g = gate();
    const deps = directDeps(g, {
      procurement_invoices: [{ id: 'inv-1', org_id: ORG, procurement_id: 'proc-1', erp_outstanding_amount: 500, vi_number: 'PINV-1', currency: 'IDR' }],
      organizations: [{ id: ORG, default_currency: 'IDR' }],
      external_refs: [{ org_id: ORG, domain: 'procurement', pmo_record_id: 'inv-1', external_record_id: 'ACC-PINV-1' }],
    }, { erp_doc_kind: 'payment', procurementId: 'proc-1', invoiceId: 'inv-1', paid_amount: 100 });
    const { refs } = await g.drive(() => resolvePaymentRefs(deps));
    expect(refs.pi).toBe('ACC-PINV-1');
    expect(distinct(g.log)).toBe(1);
  });

  it('AC-2117-5 a withheld-tax receipt reads its two account currencies in one ERP wave (was 2)', async () => {
    const g = gate();
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      return g.hold('erp', `GET ${path}`, () => Response.json({ data: { name: path, account_currency: 'IDR' } }));
    }) as typeof fetch;
    const binding = { ...BINDING, config: { company: 'Synthetic Co', default_receivable_account: 'Debtors - SC', default_cash_account: 'Cash - SC' } } as unknown as ExternalOrgBindingRow;
    const deps = directDeps(g, { organizations: [{ id: ORG, tax_prepaid_account: 'Prepaid - SC', pph23_prepaid_account: null, pph4_2_prepaid_account: null }] },
      { erp_doc_kind: 'incoming-payment', withheld_amount: 10 }, fetchImpl);
    const config = await g.drive(() => resolveReceiptConfig(deps, binding));
    expect(config).toMatchObject({ paid_from_account_currency: 'IDR', paid_to_account_currency: 'IDR' });
    expect(distinct(g.log.filter((e) => e.kind === 'erp'))).toBe(1);
  });

  it('AC-2117-5 a purchase order reads its case supplier and case items together: 2 PMO waves (was 3)', async () => {
    const g = gate();
    const deps = directDeps(g, {
      procurements: [{ id: 'proc-1', org_id: ORG, vendor_id: 'vendor-1' }],
      external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'vendor-1', external_record_id: 'Supplier:Synthetic Supplier' }],
      procurement_items: [{ procurement_id: 'proc-1', name: 'SYNTHETIC-ITEM', quantity: 2, rate: 100, description: null }],
    }, { erp_doc_kind: 'purchase-order', procurementId: 'proc-1', date: '2026-11-20' });
    const { refs, resolvedItems } = await g.drive(() => resolveProcurementOrderRefs(deps, BINDING as unknown as ExternalOrgBindingRow));
    expect(refs.supplier).toBe('Synthetic Supplier');
    expect(resolvedItems).toHaveLength(1);
    expect(distinct(g.log)).toBe(2);
  });
});
