/**
 * #1692 (FR-ECA-014, FR-ODC-072): the PMO side of the project matcher reads the `projects` column the ERP's connect
 * adapter declares — ERPNext matches its project name against PMO's client project code, an Odoo cost account carries
 * the PMO project number. The declaration lives on the adapter, so nothing above it keeps a per-tier table.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseSelect, withFetchMock } from './testing/edgeTestKit.ts';
import { pmoMasters } from './connectPmoMasters.ts';

const env = installEdgeEnv();
afterAll(() => env.restore());

const ORG = '0d000000-0000-4000-8000-0000000000a1';
// Both columns on one row: the declared field alone decides which value the matcher sees.
const PROJECT = { id: 'p1', name: 'Jembatan', code: 'CLIENT-1', pmo_project_number: 'PRJ-26-0001' };

async function projectMasters(field?: 'code' | 'pmo_project_number') {
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return await withFetchMock([supabaseSelect('projects', () => jsonResponse([PROJECT]))], async ({ calls }) => {
    const rows = field === undefined ? await pmoMasters(sc, ORG, 'project') : await pmoMasters(sc, ORG, 'project', field);
    const read = calls.find((c) => c.url.pathname === '/rest/v1/projects')!;
    return {
      rows,
      select: (read.url.searchParams.get('select') ?? '').replace(/\s+/g, ''),
      org: read.url.searchParams.get('org_id'),
      archived: read.url.searchParams.get('archived_at'),
    };
  });
}

/** AC-OSP-001 (#1508): the PMO side of the stock matcher — the org's own active `stock_items`/`stock_warehouses`, keyed by
 *  their uuid, carrying the `code` and `name` columns both tables have. */
async function stockMasters(table: 'stock_items' | 'stock_warehouses', rows: Array<Record<string, unknown>>) {
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return await withFetchMock([supabaseSelect(table, () => jsonResponse(rows))], async ({ calls }) => {
    const kind = table === 'stock_items' ? 'stock_item' : 'stock_warehouse';
    const out = await pmoMasters(sc, ORG, kind);
    const read = calls.find((c) => c.url.pathname === `/rest/v1/${table}`)!;
    return {
      rows: out,
      select: (read.url.searchParams.get('select') ?? '').replace(/\s+/g, ''),
      org: read.url.searchParams.get('org_id'),
      archived: read.url.searchParams.get('archived_at'),
    };
  });
}

describe('AC-OSP-001 stock proposals include organization-owned active masters', () => {
  it('stock items are read by uuid with their code and name, active and org-scoped', async () => {
    const r = await stockMasters('stock_items', [{ id: '3f000000-0000-4000-8000-000000000001', code: 'SMN-50', name: 'Semen 50 kg' }]);
    assertEquals(r.rows, [{ id: '3f000000-0000-4000-8000-000000000001', code: 'SMN-50', name: 'Semen 50 kg' }]);
    assertEquals(r.select, 'id,code,name');
    assertEquals([r.org, r.archived], [`eq.${ORG}`, 'is.null']);
  });

  it('stock warehouses are read the same way, from their own table', async () => {
    const r = await stockMasters('stock_warehouses', [{ id: '5a000000-0000-4000-8000-000000000002', code: 'GU', name: 'Gudang Utama' }]);
    assertEquals(r.rows, [{ id: '5a000000-0000-4000-8000-000000000002', code: 'GU', name: 'Gudang Utama' }]);
    assertEquals(r.select, 'id,code,name');
    assertEquals([r.org, r.archived], [`eq.${ORG}`, 'is.null']);
  });
});

describe('#1692 the project matcher reads the column the adapter declares', () => {
  it('a declared client project code reads `code`', async () => {
    const r = await projectMasters('code');
    assertEquals(r.select, 'id,name,code');
    assertEquals(r.rows, [{ id: 'p1', name: 'Jembatan', code: 'CLIENT-1' }]);
  });

  it('a declared PMO project number reads `pmo_project_number`, and the matcher sees it as the code', async () => {
    const r = await projectMasters('pmo_project_number');
    assertEquals(r.select, 'id,name,pmo_project_number');
    assertEquals(r.rows, [{ id: 'p1', name: 'Jembatan', code: 'PRJ-26-0001' }]);
  });

  it('an adapter that declares nothing matches on the client project code (the PMO default)', async () => {
    const r = await projectMasters();
    assertEquals(r.select, 'id,name,code');
    assertEquals(r.rows, [{ id: 'p1', name: 'Jembatan', code: 'CLIENT-1' }]);
  });

  it('the read stays this org\'s unarchived projects, whatever the declared field', async () => {
    const r = await projectMasters('pmo_project_number');
    assertEquals([r.org, r.archived], [`eq.${ORG}`, 'is.null']);
  });
});
