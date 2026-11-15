import { describe, expect, it } from 'vitest';
import { bindCall, type OdooCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import type { ExternalRefsBatchBuilder, ExternalRefsBatchClient } from '../../refs.ts';
import {
  resolveStockMappings,
  type StockMappingParams,
  type StockMappingDeps,
  type ResolveStockMappingsResult,
} from './mappings.ts';

interface FakeRefEntry {
  org_id: string;
  domain: string;
  pmo_record_id: string;
  external_tier: string;
  external_record_id: string | null;
}

/** A client over `rows` that serves the one batched read the resolver makes; `reads` counts the queries it saw. */
function createFakeRefsClient(initialRows: FakeRefEntry[] = []) {
  const rows: FakeRefEntry[] = [...initialRows];
  const reads: string[][] = [];

  const client: ExternalRefsBatchClient = {
    from(table: string) {
      if (table !== 'external_refs') throw new Error(`Unexpected table ${table}`);
      return {
        select(_columns: string) {
          const eqs: Record<string, string> = {};
          const ins: Record<string, string[]> = {};
          const builder: ExternalRefsBatchBuilder = {
            eq(col: string, val: string) { eqs[col] = val; return builder; },
            in(col: string, vals: string[]) { ins[col] = vals; return builder; },
            then(onfulfilled, onrejected) {
              reads.push(ins.pmo_record_id ?? []);
              const data = rows.filter((r) => {
                const row = r as unknown as Record<string, string>;
                return Object.entries(eqs).every(([k, v]) => row[k] === v) && Object.entries(ins).every(([k, vs]) => vs.includes(row[k]));
              });
              return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
            },
          };
          return builder;
        },
      };
    },
  };

  return { client, rows, reads };
}

/** A client that answers every link read with `link(domain, pmoId)`: a string is the Odoo id, null is "no link", a throw is a failed read. */
function refsBy(link: (domain: string, pmoId: string) => string | null): ExternalRefsBatchClient {
  return {
    from() {
      return {
        select() {
          const eqs: Record<string, string> = {};
          const ins: Record<string, string[]> = {};
          const builder: ExternalRefsBatchBuilder = {
            eq(col: string, val: string) { eqs[col] = val; return builder; },
            in(col: string, vals: string[]) { ins[col] = vals; return builder; },
            then(onfulfilled, onrejected) {
              try {
                const data = (ins.domain ?? []).flatMap((domain) => (ins.pmo_record_id ?? []).flatMap((id) => {
                  const external = link(domain, id);
                  return external === null ? [] : [{ domain, pmo_record_id: id, external_record_id: external }];
                }));
                return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
              } catch (err) {
                return Promise.resolve({ data: null, error: { message: err instanceof Error ? err.message : String(err) } }).then(onfulfilled, onrejected);
              }
            },
          };
          return builder;
        },
      };
    },
  };
}

function setupHarness(initialRefs: FakeRefEntry[] = []) {
  const fake = createFakeOdoo({ key: 'test-key' });

  const rawCall = bindCall({
    baseUrl: 'https://odoo.example.test',
    apiKey: 'test-key',
    database: 'db1',
    companyId: 1,
    fetchImpl: fake.fetch,
  });

  const calls: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  const call: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}): Promise<T> => {
    calls.push({ model, method, body });
    return rawCall<T>(model, method, body);
  };

  const { client, rows: refRows, reads: refReads } = createFakeRefsClient(initialRefs);

  return { fake, call, calls, client, refRows, refReads };
}

describe('Stock Mapping Resolver (AC-OSP-001, AC-OSP-006)', () => {
  const ORG_A = '00000000-0000-0000-0000-000000000001';
  const ORG_B = '00000000-0000-0000-0000-000000000002';
  const COMPANY_1 = 1;

  it('AC-OSP-001: all mapped transfer resolves valid bundle (company, lines, source & dest locations)', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-2', external_tier: 'odoo', external_record_id: '102' },
    ]);

    fake.seed('stock.location', [
      { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
      { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
      { id: 102, name: 'Copper Wire', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-transfer-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }, { stockItemId: 'item-2' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result).toEqual<ResolveStockMappingsResult>({
      ok: true,
      companyId: COMPANY_1,
      lines: [
        { stockItemId: 'item-1', productId: 101 },
        { stockItemId: 'item-2', productId: 102 },
      ],
      sourceLocationId: 10,
      destinationLocationId: 20,
    });

    // Zero Odoo write/mutation calls
    expect(calls.every((c) => c.method === 'search_read' || c.method === 'read')).toBe(true);
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: all mapped issue resolves bundle with project.project id, analytic account, and and no work item echoed', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.picking.type', [{ id: 77, name: 'Delivery', code: 'outgoing', company_id: 1, active: true, default_location_dest_id: [5, 'Customers'] }]);
    fake.seed('stock.location', [
      { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
      { id: 5, complete_name: 'Partner Locations/Customers', usage: 'customer', company_id: [COMPANY_1, 'Main Co'], active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
    ]);

    fake.seed('project.project', [
      { id: 77, name: 'Bridge Project', company_id: [COMPANY_1, 'Main Co'], account_id: [501, 'Bridge AA'], active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-issue-1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      operationTypeId: 77,
      projectId: 'proj-bridge',
    };

    const deps: StockMappingDeps = {
      call,
      client,
      resolveCostAccount: async (projectId: string) => {
        expect(projectId).toBe('proj-bridge');
        return { status: 'resolved', accountId: '501' };
      },
    };

    const result = await resolveStockMappings(params, deps);

    expect(result).toEqual<ResolveStockMappingsResult>({
      ok: true,
      companyId: COMPANY_1,
      lines: [{ stockItemId: 'item-1', productId: 101 }],
      sourceLocationId: 10,
      destinationLocationId: 5,
      projectId: 77,
      analyticAccountId: 501,
    });

    // Zero Odoo write/mutation calls
    expect(calls.every((c) => c.method === 'search_read' || c.method === 'read')).toBe(true);
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: unmapped stock item refuses with item-unmapped and names the stock item', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
    ]);

    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 20, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'unmapped-item-id' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('item-unmapped');
      expect(result.subjectId).toBe('unmapped-item-id');
      expect(result.message).toMatch(/Integration setup/i);
    }

    // Zero Odoo writes
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: mapped stock item with inactive Odoo product refuses with product-unavailable', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-inactive', external_tier: 'odoo', external_record_id: '105' },
    ]);

    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 20, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 105, name: 'Archived Bolt', is_storable: true, company_id: COMPANY_1, active: false },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-inactive' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('product-unavailable');
      expect(result.subjectId).toBe('item-inactive');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: mapped stock item with non-storable Odoo product refuses with product-unavailable', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-service', external_tier: 'odoo', external_record_id: '106' },
    ]);

    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 20, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 106, name: 'Consulting Service', is_storable: false, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-service' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('product-unavailable');
      expect(result.subjectId).toBe('item-service');
      expect(result.message).toMatch(/not storable/i);
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-006: mapped stock item with Odoo product of another company refuses with foreign-company', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-foreign-co', external_tier: 'odoo', external_record_id: '107' },
    ]);

    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 20, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 107, name: 'Foreign Co Product', is_storable: true, company_id: [2, 'Other Co'], active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-foreign-co' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('foreign-company');
      expect(result.subjectId).toBe('item-foreign-co');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-006: mapped stock item with shared (no-company) Odoo product refuses with foreign-company', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-shared', external_tier: 'odoo', external_record_id: '108' },
    ]);

    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 20, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 108, name: 'Shared Product', is_storable: true, company_id: false, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-shared' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('foreign-company');
      expect(result.subjectId).toBe('item-shared');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: unmapped warehouse refuses with warehouse-unmapped and names the warehouse', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-unmapped',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('warehouse-unmapped');
      expect(result.subjectId).toBe('wh-unmapped');
      expect(result.message).toMatch(/Integration setup/i);
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: mapped location with usage other than internal refuses with location-unavailable', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-view', external_tier: 'odoo', external_record_id: '15' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.location', [
      { id: 15, complete_name: 'WH/View', usage: 'view', company_id: COMPANY_1, active: true },
      { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-view',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('location-unavailable');
      expect(result.subjectId).toBe('wh-view');
      expect(result.message).toMatch(/usage.*view.*expected.*internal/i);
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-006: mapped location belonging to another company refuses with foreign-company', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-foreign', external_tier: 'odoo', external_record_id: '16' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.location', [
      { id: 16, complete_name: 'OtherCo/Stock', usage: 'internal', company_id: [2, 'Other Co'], active: true },
      { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-foreign',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('foreign-company');
      expect(result.subjectId).toBe('wh-foreign');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-006: mapped location with shared (no-company) location refuses with foreign-company', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-shared', external_tier: 'odoo', external_record_id: '17' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.location', [
      { id: 17, complete_name: 'Shared/Stock', usage: 'internal', company_id: false, active: true },
      { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-shared',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('foreign-company');
      expect(result.subjectId).toBe('wh-shared');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: mapped location that is inactive in Odoo refuses with location-unavailable', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-inactive', external_tier: 'odoo', external_record_id: '18' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.location', [
      { id: 18, complete_name: 'Archived/Stock', usage: 'internal', company_id: COMPANY_1, active: false },
      { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-inactive',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('location-unavailable');
      expect(result.subjectId).toBe('wh-inactive');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: transfer checks destination warehouse (refuses when destination is unmapped or invalid)', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.location', [
      { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest-missing',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('warehouse-unmapped');
      expect(result.subjectId).toBe('wh-dest-missing');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: issue without PMO project refuses with project-unlinked', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.picking.type', [{ id: 77, name: 'Delivery', code: 'outgoing', company_id: 1, active: true, default_location_dest_id: [5, 'Customers'] }]);
    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 5, usage: 'customer', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      operationTypeId: 77,
      // No projectId provided
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('project-unlinked');
      expect(result.message).toMatch(/project/i);
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: issue project with unlinked analytic account refuses with project-unlinked', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.picking.type', [{ id: 77, name: 'Delivery', code: 'outgoing', company_id: 1, active: true, default_location_dest_id: [5, 'Customers'] }]);
    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 5, usage: 'customer', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      operationTypeId: 77,
      projectId: 'proj-unlinked',
    };

    const deps: StockMappingDeps = {
      call,
      client,
      resolveCostAccount: async () => ({ status: 'unlinked' }),
    };

    const result = await resolveStockMappings(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('project-unlinked');
      expect(result.subjectId).toBe('proj-unlinked');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: issue project with unavailable analytic account refuses with project-unavailable', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.picking.type', [{ id: 77, name: 'Delivery', code: 'outgoing', company_id: 1, active: true, default_location_dest_id: [5, 'Customers'] }]);
    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 5, usage: 'customer', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      operationTypeId: 77,
      projectId: 'proj-archived-aa',
    };

    const deps: StockMappingDeps = {
      call,
      client,
      resolveCostAccount: async () => ({ status: 'needs-attention', reason: 'cost-account-unavailable' }),
    };

    const result = await resolveStockMappings(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('project-unavailable');
      expect(result.subjectId).toBe('proj-archived-aa');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: issue project with no active Odoo project matching analytic account refuses with project-unlinked', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.picking.type', [{ id: 77, name: 'Delivery', code: 'outgoing', company_id: 1, active: true, default_location_dest_id: [5, 'Customers'] }]);
    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 5, usage: 'customer', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    // 0 projects in Odoo matching account_id 501
    fake.seed('project.project', []);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      operationTypeId: 77,
      projectId: 'proj-1',
    };

    const deps: StockMappingDeps = {
      call,
      client,
      resolveCostAccount: async () => ({ status: 'resolved', accountId: '501' }),
    };

    const result = await resolveStockMappings(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('project-unlinked');
      expect(result.subjectId).toBe('proj-1');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: refuses when multiple active projects share analytic account (project-ambiguous)', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.picking.type', [{ id: 77, name: 'Delivery', code: 'outgoing', company_id: 1, active: true, default_location_dest_id: [5, 'Customers'] }]);
    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 5, usage: 'customer', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    fake.seed('project.project', [
      { id: 71, name: 'Project A', company_id: COMPANY_1, account_id: 501, active: true },
      { id: 72, name: 'Project B', company_id: COMPANY_1, account_id: 501, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      operationTypeId: 77,
      projectId: 'proj-1',
    };

    const deps: StockMappingDeps = {
      call,
      client,
      resolveCostAccount: async () => ({ status: 'resolved', accountId: '501' }),
    };

    const result = await resolveStockMappings(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('project-ambiguous');
      expect(result.subjectId).toBe('proj-1');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: refuses when all matching projects are archived (project-unavailable)', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    fake.seed('stock.picking.type', [{ id: 77, name: 'Delivery', code: 'outgoing', company_id: 1, active: true, default_location_dest_id: [5, 'Customers'] }]);
    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 5, usage: 'customer', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Steel Pipe', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    fake.seed('project.project', [
      { id: 71, name: 'Project Archived', company_id: COMPANY_1, account_id: 501, active: false },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      operationTypeId: 77,
      projectId: 'proj-1',
    };

    const deps: StockMappingDeps = {
      call,
      client,
      resolveCostAccount: async () => ({ status: 'resolved', accountId: '501' }),
    };

    const result = await resolveStockMappings(params, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('project-unavailable');
      expect(result.subjectId).toBe('proj-1');
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: any read failing on Odoo call returns read-failed', async () => {
    const { client } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    const rejectingCall: OdooCall = async () => {
      throw new Error('Odoo RPC connection reset by peer');
    };

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call: rejectingCall, client });

    expect(result).toEqual<ResolveStockMappingsResult>({
      ok: false,
      reason: 'read-failed',
      message: 'Odoo RPC connection reset by peer',
    });
  });

  it('AC-OSP-001: every line of a multi-line document checked (one bad line refuses the whole document and names it)', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-good-1', external_tier: 'odoo', external_record_id: '101' },
      // item-bad-2 is unmapped!
      { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-good-3', external_tier: 'odoo', external_record_id: '103' },
    ]);

    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 20, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    fake.seed('product.product', [
      { id: 101, name: 'Good Item 1', is_storable: true, company_id: COMPANY_1, active: true },
      { id: 103, name: 'Good Item 3', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-multi-1',
      kind: 'transfer',
      lines: [
        { stockItemId: 'item-good-1' },
        { stockItemId: 'item-bad-2' },
        { stockItemId: 'item-good-3' },
      ],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('item-unmapped');
      expect(result.subjectId).toBe('item-bad-2');
      expect(result.message).toMatch(/item-bad-2/i);
    }
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-006: a mapping row of another organization is never returned (cross-org isolation in external_refs)', async () => {
    // Seed mappings for Org B only
    const { fake, call, client } = setupHarness([
      { org_id: ORG_B, domain: 'stock_warehouses', pmo_record_id: 'wh-shared-name', external_tier: 'odoo', external_record_id: '99' },
      { org_id: ORG_B, domain: 'stock_items', pmo_record_id: 'item-shared-name', external_tier: 'odoo', external_record_id: '999' },
    ]);

    fake.seed('stock.location', [
      { id: 99, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);
    fake.seed('product.product', [
      { id: 999, name: 'Org B Product', is_storable: true, company_id: COMPANY_1, active: true },
    ]);

    // Org A attempts to resolve using IDs that only exist in Org B's mapping
    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-org-a',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-shared-name' }],
      sourceWarehouseId: 'wh-shared-name',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });

    // Org A cannot see Org B's warehouse mapping -> warehouse-unmapped
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('warehouse-unmapped');
      expect(result.subjectId).toBe('wh-shared-name');
    }
  });

  it('AC-OSP-006: another organization\'s links are never read, so its warehouse reads as unmapped', async () => {
    const { call, client } = setupHarness([
      { org_id: ORG_B, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_B, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
    ]);

    const result = await resolveStockMappings({
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-foreign-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    }, { call, client });

    expect(result).toMatchObject({ ok: false, reason: 'warehouse-unmapped', subjectId: 'wh-main' });
  });

  it('AC-OSP-001: zero Odoo write/mutation calls on any refusal', async () => {
    const { fake, call, client, calls } = setupHarness([
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
      { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_tier: 'odoo', external_record_id: '20' },
    ]);

    fake.seed('stock.location', [
      { id: 10, usage: 'internal', company_id: COMPANY_1, active: true },
      { id: 20, usage: 'internal', company_id: COMPANY_1, active: true },
    ]);

    const params: StockMappingParams = {
      orgId: ORG_A,
      companyId: COMPANY_1,
      documentId: 'doc-refused-1',
      kind: 'transfer',
      lines: [{ stockItemId: 'unmapped-line' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await resolveStockMappings(params, { call, client });
    expect(result.ok).toBe(false);

    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  describe('AC-OSP-001: issue destination resolution from operation type', () => {
    it('AC-OSP-001: issue with no destination passed in reads verified operation type default_location_dest_id and accepts active customer location with no company (shared)', async () => {
      const { fake, call, client } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery Orders', company_id: COMPANY_1, default_location_dest_id: [2, 'Customers'] },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        // Shared location: company_id is false / none, usage is customer, active is true (as verified on bed)
        { id: 2, complete_name: 'Customers', usage: 'customer', company_id: false, active: true },
      ]);

      fake.seed('product.product', [
        { id: 101, name: 'Steel Pipe', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);

      fake.seed('project.project', [
        { id: 77, name: 'Bridge Project', company_id: [COMPANY_1, 'Main Co'], account_id: [501, 'Bridge AA'], active: true },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-1',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const deps: StockMappingDeps = {
        call,
        client,
        resolveCostAccount: async () => ({ status: 'resolved', accountId: '501' }),
      };

      const result = await resolveStockMappings(params, deps);

      expect(result).toEqual<ResolveStockMappingsResult>({
        ok: true,
        companyId: COMPANY_1,
        lines: [{ stockItemId: 'item-1', productId: 101 }],
        sourceLocationId: 10,
        destinationLocationId: 2,
        projectId: 77,
        analyticAccountId: 501,
      });
    });

    it('AC-OSP-001: issue with no destination passed in accepts active customer location with connected company', async () => {
      const { fake, call, client } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery Orders', company_id: COMPANY_1, default_location_dest_id: [25, 'Company Customers'] },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 25, complete_name: 'Company Customers', usage: 'customer', company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);

      fake.seed('product.product', [
        { id: 101, name: 'Steel Pipe', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);

      fake.seed('project.project', [
        { id: 77, name: 'Bridge Project', company_id: [COMPANY_1, 'Main Co'], account_id: [501, 'Bridge AA'], active: true },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-2',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const deps: StockMappingDeps = {
        call,
        client,
        resolveCostAccount: async () => ({ status: 'resolved', accountId: '501' }),
      };

      const result = await resolveStockMappings(params, deps);

      expect(result).toEqual<ResolveStockMappingsResult>({
        ok: true,
        companyId: COMPANY_1,
        lines: [{ stockItemId: 'item-1', productId: 101 }],
        sourceLocationId: 10,
        destinationLocationId: 25,
        projectId: 77,
        analyticAccountId: 501,
      });
    });

    it('AC-OSP-001: issue with no destination passed in refuses with location-unavailable when operation type has no default destination location and tells Admin which operation type to fix', async () => {
      const { fake, call, client, calls } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery Orders', company_id: COMPANY_1, default_location_dest_id: false },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-3',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const result = await resolveStockMappings(params, { call, client });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('location-unavailable');
        expect(result.message).toMatch(/operation type/i);
        expect(result.message).toMatch(/2/);
      }
      expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
    });

    it('AC-OSP-001: issue with no destination passed in refuses with location-unavailable when destination location has usage other than customer', async () => {
      const { fake, call, client, calls } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery Orders', company_id: COMPANY_1, default_location_dest_id: [30, 'Production'] },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 30, complete_name: 'Production', usage: 'production', company_id: false, active: true },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-4',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const result = await resolveStockMappings(params, { call, client });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('location-unavailable');
        expect(result.message).toMatch(/operation type/i);
        expect(result.message).toMatch(/2/);
      }
      expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
    });

    it('AC-OSP-001: issue with no destination passed in refuses with location-unavailable when destination location belongs to foreign company', async () => {
      const { fake, call, client, calls } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery Orders', company_id: COMPANY_1, default_location_dest_id: [40, 'Foreign Customers'] },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 40, complete_name: 'Foreign Customers', usage: 'customer', company_id: [99, 'Foreign Co'], active: true },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-5',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const result = await resolveStockMappings(params, { call, client });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('location-unavailable');
        expect(result.message).toMatch(/operation type/i);
        expect(result.message).toMatch(/2/);
      }
      expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
    });

    it('AC-OSP-001: issue with no destination passed in refuses with location-unavailable when destination location is inactive', async () => {
      const { fake, call, client, calls } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery Orders', company_id: COMPANY_1, default_location_dest_id: [50, 'Archived Customers'] },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 50, complete_name: 'Archived Customers', usage: 'customer', company_id: false, active: false },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-6',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const result = await resolveStockMappings(params, { call, client });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('location-unavailable');
        expect(result.message).toMatch(/operation type/i);
        expect(result.message).toMatch(/2/);
      }
      expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
    });

    it('AC-OSP-001: issue with no destination passed in refuses with location-unavailable when operation type is not found', async () => {
      const { fake, call, client, calls } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-7',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 999, // Non-existent operation type
        projectId: 'proj-bridge',
      };

      const result = await resolveStockMappings(params, { call, client });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('location-unavailable');
        expect(result.message).toMatch(/operation type/i);
        expect(result.message).toMatch(/999/);
      }
      expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
    });

    it('AC-OSP-001: issue with no destination passed in refuses with read-failed when operation type read fails', async () => {
      const { fake, call, client } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);

      fake.dropModel('stock.picking.type');

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-8',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const result = await resolveStockMappings(params, { call, client });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('read-failed');
      }
    });

    it('AC-OSP-001: PMO warehouse is never used as an issue destination even if destinationWarehouseId is present', async () => {
      const { fake, call, client } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_tier: 'odoo', external_record_id: '10' },
        // A warehouse ref is mapped for wh-pmo-dest pointing to location 88 (internal)
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-pmo-dest', external_tier: 'odoo', external_record_id: '88' },
        { org_id: ORG_A, domain: 'stock_items', pmo_record_id: 'item-1', external_tier: 'odoo', external_record_id: '101' },
      ]);

      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery Orders', company_id: COMPANY_1, default_location_dest_id: [2, 'Customers'] },
      ]);

      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 88, complete_name: 'WH2/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 2, complete_name: 'Customers', usage: 'customer', company_id: false, active: true },
      ]);

      fake.seed('product.product', [
        { id: 101, name: 'Steel Pipe', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);

      fake.seed('project.project', [
        { id: 77, name: 'Bridge Project', company_id: [COMPANY_1, 'Main Co'], account_id: [501, 'Bridge AA'], active: true },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-optype-9',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-main',
        destinationWarehouseId: 'wh-pmo-dest', // Should NEVER be used as issue destination!
        operationTypeId: 2,
        projectId: 'proj-bridge',
      };

      const deps: StockMappingDeps = {
        call,
        client,
        resolveCostAccount: async () => ({ status: 'resolved', accountId: '501' }),
      };

      const result = await resolveStockMappings(params, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Destination MUST be the operation type's destination (2), NEVER the PMO warehouse (88)
        expect(result.destinationLocationId).toBe(2);
        expect(result.destinationLocationId).not.toBe(88);
      }
    });
  });

  describe('Edge case error handling and branch coverage (AC-OSP-001, AC-OSP-006)', () => {
    it('refuses invalid company ID or missing org ID or empty lines or missing source warehouse', async () => {
      const { call, client } = setupHarness();
      const deps: StockMappingDeps = { call, client };

      const r1 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: 0,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, deps);
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe('binding-unavailable');

      const r2 = await resolveStockMappings({
        orgId: '   ',
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, deps);
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.reason).toBe('binding-unavailable');

      const r3 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, deps);
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.reason).toBe('read-failed');

      const r4 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: '',
        destinationWarehouseId: 'wh-2',
      }, deps);
      expect(r4.ok).toBe(false);
      if (!r4.ok) expect(r4.reason).toBe('warehouse-unmapped');
    });

    it('refuses transfer missing destination warehouse or issue missing project', async () => {
      const { call, client } = setupHarness();
      const deps: StockMappingDeps = { call, client };

      const r1 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
      }, deps);
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe('warehouse-unmapped');

      const r2 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
      }, deps);
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.reason).toBe('project-unlinked');
    });

    it('reads every link of a document in one query, however many lines it has', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => ({ stockItemId: `item-${i}` }));
      const { call, client, refReads } = setupHarness([
        { org_id: ORG_A, domain: 'stock_warehouses', pmo_record_id: 'wh-1', external_tier: 'odoo', external_record_id: '10' },
      ]);
      const r = await resolveStockMappings({
        orgId: ORG_A, companyId: COMPANY_1, documentId: 'doc-many', kind: 'transfer', lines,
        sourceWarehouseId: 'wh-1', destinationWarehouseId: 'wh-2',
      }, { call, client });
      expect(r.ok).toBe(false);
      expect(refReads).toHaveLength(1);
      expect(refReads[0]).toEqual(expect.arrayContaining(['wh-1', 'wh-2', 'item-0', 'item-49']));
    });

    it('handles ref resolution and search_read errors for warehouse locations', async () => {
      const { call } = setupHarness();

      const r1 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, {
        call,
        client: refsBy(() => { throw new Error('Ref query timeout'); }),
      });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe('read-failed');

      const failingCall: OdooCall = async () => { throw new Error('Location query fail'); };
      const r2 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, {
        call: failingCall,
        client: refsBy(() => '10'),
      });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.reason).toBe('read-failed');
    });

    it('refuses inactive destination location or errors during dest resolution', async () => {
      const { fake, call } = setupHarness();
      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: false },
      ]);

      const r1 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, {
        call,
        client: refsBy((_domain, id) => (id === 'wh-1' ? '10' : '20')),
      });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe('location-unavailable');

      const r2 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, {
        call,
        client: refsBy((_domain, id) => {
          if (id === 'wh-1') return '10';
          throw new Error('Dest lookup fail');
        }),
      });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.reason).toBe('read-failed');
    });

    it('refuses inactive product or product from different company or product search error', async () => {
      const { fake, call } = setupHarness();
      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);
      fake.seed('product.product', [
        { id: 101, name: 'Inactive Item', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: false },
        { id: 102, name: 'Foreign Item', is_storable: true, company_id: [2, 'Other Co'], active: true },
      ]);

      const r1 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-inactive' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, {
        call,
        client: refsBy((_domain, id) => {
          if (id === 'wh-1') return '10';
          if (id === 'wh-2') return '20';
          return '101';
        }),
      });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe('product-unavailable');

      const r2 = await resolveStockMappings({
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-1',
        kind: 'transfer',
        lines: [{ stockItemId: 'item-foreign' }],
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
      }, {
        call,
        client: refsBy((_domain, id) => {
          if (id === 'wh-1') return '10';
          if (id === 'wh-2') return '20';
          return '102';
        }),
      });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.reason).toBe('foreign-company');
    });

    it('covers issue project resolution errors (cost resolver error, unlinked, invalid accountId)', async () => {
      const { fake, call } = setupHarness();
      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 2, complete_name: 'Customers', usage: 'customer', company_id: false, active: true },
      ]);
      fake.seed('product.product', [
        { id: 101, name: 'Item', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);
      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery', code: 'outgoing', company_id: COMPANY_1, active: true, default_location_dest_id: [2, 'Customers'] },
      ]);

      const baseParams: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-err',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        operationTypeId: 2,
        projectId: 'proj-1',
      };
      const baseDeps: StockMappingDeps = {
        call,
        client: refsBy((_domain, id) => {
          if (id === 'wh-1') return '10';
          return '101';
        }),
      };

      // 1. Cost resolver throws error
      const r1 = await resolveStockMappings(baseParams, {
        ...baseDeps,
        resolveCostAccount: async () => { throw new Error('Cost resolution network error'); },
      });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe('read-failed');

      // 2. Cost resolver returns invalid account ID
      const r2 = await resolveStockMappings(baseParams, {
        ...baseDeps,
        resolveCostAccount: async () => ({ status: 'resolved', accountId: 'not-a-number' }),
      });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.reason).toBe('project-unavailable');

      // 3. No analytic account and no cost resolver
      const r3 = await resolveStockMappings(baseParams, baseDeps);
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.reason).toBe('project-unlinked');
    });

    it('refuses inactive analytic account or project ref error during issue resolution', async () => {
      const { fake, call } = setupHarness();
      fake.seed('stock.location', [
        { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: [COMPANY_1, 'Main Co'], active: true },
        { id: 2, complete_name: 'Customers', usage: 'customer', company_id: false, active: true },
      ]);
      fake.seed('product.product', [
        { id: 101, name: 'Item', is_storable: true, company_id: [COMPANY_1, 'Main Co'], active: true },
      ]);
      fake.seed('stock.picking.type', [
        { id: 2, name: 'Delivery', code: 'outgoing', company_id: COMPANY_1, active: true, default_location_dest_id: [2, 'Customers'] },
      ]);
      fake.seed('project.project', [
        { id: 77, name: 'Project Bridge', company_id: [COMPANY_1, 'Main Co'], account_id: [501, 'Bridge AA'], active: false },
      ]);
      fake.seed('account.analytic.account', [
        { id: 501, name: 'Bridge AA', active: false },
      ]);

      const params: StockMappingParams = {
        orgId: ORG_A,
        companyId: COMPANY_1,
        documentId: 'doc-issue-inactive-aa',
        kind: 'issue',
        lines: [{ stockItemId: 'item-1' }],
        sourceWarehouseId: 'wh-1',
        operationTypeId: 2,
        projectId: 'proj-1',
      };

      const deps: StockMappingDeps = {
        call,
        client: refsBy((_domain, id) => {
          if (id === 'wh-1') return '10';
          return '101';
        }),
        resolveCostAccount: async () => ({ status: 'resolved', accountId: '501' }),
      };

      const r1 = await resolveStockMappings(params, deps);
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe('project-unavailable');
    });
  });
});
