import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import {
  withFetchMock,
  supabaseSelect,
  jsonResponse,
  type FetchCall,
  type MockRoute,
} from './testing/edgeTestKit.ts';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { resolveOdooStockMappings } from './odooStockMappings.ts';
import type { StockMappingParams } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/mappings.ts';

const SUPABASE_URL = 'https://supabase.example.test';
const SUPABASE_KEY = 'test-key';
const sc = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const ORG = '00000000-0000-0000-0000-000000000001';
const PROJECT = '00000000-0000-0000-0000-000000000042';
const COMPANY_ID = 1;

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const param = (c: FetchCall, k: string) => {
  const v = c.url.searchParams.get(k);
  return v?.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : v;
};

interface World {
  refs?: Array<{ org_id: string; domain: string; pmo_record_id: string; external_record_id: string }>;
  link?: string | null;
  account?: { active: boolean; tombstoned_at: string | null } | null;
}

function routes(w: World): MockRoute[] {
  return [
    supabaseSelect('external_refs', (c) => {
      const orgId = param(c, 'org_id');
      const domain = param(c, 'domain');
      const pmoId = param(c, 'pmo_record_id');
      const match = (w.refs ?? []).find(
        (r) => r.org_id === orgId && r.domain === domain && r.pmo_record_id === pmoId,
      );
      return match ? one({ external_record_id: match.external_record_id }) : none();
    }),
    supabaseSelect('external_project_bindings', (c) => {
      const orgId = param(c, 'org_id');
      const projId = param(c, 'project_id');
      if (orgId === ORG && projId === PROJECT && w.link) {
        return one({ external_container_id: w.link });
      }
      return none();
    }),
    supabaseSelect('external_master_records', () => {
      if (w.account === null) return none();
      return one(w.account ?? { active: true, tombstoned_at: null });
    }),
  ];
}

describe('odooStockMappings (server adapter, AC-OSP-001, AC-OSP-006)', () => {
  it('AC-OSP-001: wires Supabase external_refs reader to pure resolver for transfer', async () => {
    const world: World = {
      refs: [
        { org_id: ORG, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_record_id: '10' },
        { org_id: ORG, domain: 'stock_warehouses', pmo_record_id: 'wh-dest', external_record_id: '20' },
        { org_id: ORG, domain: 'stock_items', pmo_record_id: 'item-1', external_record_id: '101' },
      ],
    };

    const mockCall: OdooCall = <T>(model: string, _method: string, _body: Record<string, unknown> = {}): Promise<T> => {
      if (model === 'stock.location') {
        return Promise.resolve([
          { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: COMPANY_ID, active: true },
          { id: 20, complete_name: 'WH2/Stock', usage: 'internal', company_id: COMPANY_ID, active: true },
        ] as unknown as T);
      }
      if (model === 'product.product') {
        return Promise.resolve([
          { id: 101, name: 'Rebar', is_storable: true, company_id: COMPANY_ID, active: true },
        ] as unknown as T);
      }
      return Promise.reject(new Error(`Unexpected model ${model}`));
    };

    const params: StockMappingParams = {
      orgId: ORG,
      companyId: COMPANY_ID,
      documentId: 'doc-t1',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await withFetchMock(routes(world), () =>
      resolveOdooStockMappings(sc(), mockCall, params),
    );

    assertEquals(result, {
      ok: true,
      companyId: COMPANY_ID,
      lines: [{ stockItemId: 'item-1', productId: 101 }],
      sourceLocationId: 10,
      destinationLocationId: 20,
    });
  });

  it('AC-OSP-001: wires resolveOdooCostAccount to resolve project for issue', async () => {
    const world: World = {
      link: '501',
      account: { active: true, tombstoned_at: null },
      refs: [
        { org_id: ORG, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_record_id: '10' },
        { org_id: ORG, domain: 'stock_items', pmo_record_id: 'item-1', external_record_id: '101' },
      ],
    };

    const mockCall: OdooCall = <T>(model: string, _method: string, _body: Record<string, unknown> = {}): Promise<T> => {
      if (model === 'stock.location') {
        return Promise.resolve([
          { id: 10, complete_name: 'WH1/Stock', usage: 'internal', company_id: COMPANY_ID, active: true },
          { id: 5, complete_name: 'Partner/Customer', usage: 'customer', company_id: COMPANY_ID, active: true },
        ] as unknown as T);
      }
      if (model === 'product.product') {
        return Promise.resolve([
          { id: 101, name: 'Rebar', is_storable: true, company_id: COMPANY_ID, active: true },
        ] as unknown as T);
      }
      if (model === 'project.project') {
        return Promise.resolve([
          { id: 88, name: 'Metro Line', company_id: COMPANY_ID, account_id: 501, active: true },
        ] as unknown as T);
      }
      return Promise.reject(new Error(`Unexpected model ${model}`));
    };

    const params: StockMappingParams = {
      orgId: ORG,
      companyId: COMPANY_ID,
      documentId: 'doc-i1',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      destinationLocationId: 5,
      projectId: PROJECT,
      workItemId: 'task-pile-driver',
    };

    const result = await withFetchMock(routes(world), () =>
      resolveOdooStockMappings(sc(), mockCall, params),
    );

    assertEquals(result, {
      ok: true,
      companyId: COMPANY_ID,
      lines: [{ stockItemId: 'item-1', productId: 101 }],
      sourceLocationId: 10,
      destinationLocationId: 5,
      projectId: 88,
      analyticAccountId: 501,
      workItemId: 'task-pile-driver',
    });
  });

  it('AC-OSP-001: issue destination refuses when destinationLocationId is missing because bed research doc does not record operation type destination location field', async () => {
    const world: World = {
      link: '501',
      account: { active: true, tombstoned_at: null },
      refs: [
        { org_id: ORG, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_record_id: '10' },
        { org_id: ORG, domain: 'stock_items', pmo_record_id: 'item-1', external_record_id: '101' },
      ],
    };

    const mockCall: OdooCall = <T>(_m: string): Promise<T> => {
      return Promise.reject(new Error('Should not make Odoo calls'));
    };

    const params: StockMappingParams = {
      orgId: ORG,
      companyId: COMPANY_ID,
      documentId: 'doc-i2',
      kind: 'issue',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      projectId: PROJECT,
      // destinationLocationId is missing!
    };

    const result = await withFetchMock(routes(world), () =>
      resolveOdooStockMappings(sc(), mockCall, params, { operationTypeId: 2 }),
    );

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.reason, 'location-unavailable');
      assertEquals(result.message.includes('bed research doc'), true);
    }
  });

  it('AC-OSP-006: foreign-organization external_refs row is never returned', async () => {
    const foreignOrg = '00000000-0000-0000-0000-000000000099';
    const world: World = {
      refs: [
        { org_id: foreignOrg, domain: 'stock_warehouses', pmo_record_id: 'wh-main', external_record_id: '10' },
        { org_id: foreignOrg, domain: 'stock_items', pmo_record_id: 'item-1', external_record_id: '101' },
      ],
    };

    const mockCall: OdooCall = <T>(_m: string): Promise<T> => {
      return Promise.reject(new Error('Should not call Odoo when refs unmapped'));
    };

    const params: StockMappingParams = {
      orgId: ORG, // Org A
      companyId: COMPANY_ID,
      documentId: 'doc-t2',
      kind: 'transfer',
      lines: [{ stockItemId: 'item-1' }],
      sourceWarehouseId: 'wh-main',
      destinationWarehouseId: 'wh-dest',
    };

    const result = await withFetchMock(routes(world), () =>
      resolveOdooStockMappings(sc(), mockCall, params),
    );

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.reason, 'warehouse-unmapped');
      assertEquals(result.subjectId, 'wh-main');
    }
  });
});
