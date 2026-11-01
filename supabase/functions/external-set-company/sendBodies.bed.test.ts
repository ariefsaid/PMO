/**
 * I5 (ECA-3): does a real ERPNext accept the create bodies a send ships? The shared suite proves them only against the in-memory fake,
 * which accepts any body. This creates one Supplier, Customer, Item and Project through the SHIPPED `sendMaster`, looks each up again
 * (the second send must find it, not create it) and deletes them. Gated on the dependency, never on CI: ERPNEXT_BENCH_URL, the bench
 * key pair (ERPNEXT_BENCH_API_KEY / ERPNEXT_BENCH_API_SECRET) and ERPNEXT_BENCH_COMPANY, sourced from the environment, never printed.
 *
 * Run: scripts/with-erpnext-lock.sh bash -c 'cd supabase/functions/external-set-company && deno test sendBodies.bed.test.ts --config deno.json --allow-env --allow-net --allow-read'
 */
import { assert, assertEquals } from '@std/assert';
import { createErpnextConnectAdapter } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/connectAdapter.ts';
import { erpnextRequest } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { MasterKind, PmoMaster } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';

const BENCH = Deno.env.get('ERPNEXT_BENCH_URL');
const KEY = Deno.env.get('ERPNEXT_BENCH_API_KEY') ?? '';
const SECRET = Deno.env.get('ERPNEXT_BENCH_API_SECRET') ?? '';
const COMPANY = Deno.env.get('ERPNEXT_BENCH_COMPANY') ?? '';

Deno.test({
  name: 'I5 a real ERPNext accepts the Supplier, Customer, Item and Project a send creates, and finds them again',
  ignore: !BENCH || !KEY || !SECRET || !COMPANY,
  fn: async () => {
    const client = { fetchImpl: fetch, baseUrl: BENCH!, apiKey: KEY, apiSecret: SECRET };
    const adapter = createErpnextConnectAdapter(client, COMPANY);
    const stamp = `PMO BED ${Date.now()}`;
    const cases: Array<[MasterKind, PmoMaster, string]> = [
      ['party', { id: 'bed-v', name: `${stamp} Vendor`, role: 'vendor', taxId: null }, 'Supplier'],
      ['party', { id: 'bed-c', name: `${stamp} Client`, role: 'client', taxId: null }, 'Customer'],
      ['item', { id: `${stamp} Item`, name: `${stamp} Item`, code: `${stamp} Item` }, 'Item'],
      ['project', { id: 'bed-p', name: `${stamp} Project`, code: null }, 'Project'],
    ];
    const made: Array<[string, string]> = [];
    try {
      for (const [kind, record, doctype] of cases) {
        const first = await adapter.sendMaster(kind, record, `seed:${kind}:${record.id}`);
        made.push([doctype, first.externalId.replace(/^(Supplier|Customer):/, '')]);
        const again = await adapter.sendMaster(kind, record, `seed:${kind}:${record.id}`);
        assertEquals(again.externalId, first.externalId, `${doctype}: the second send finds the first`);
      }
      assert(made.length === 4);
    } finally {
      for (const [doctype, name] of made.reverse()) {
        await erpnextRequest(client, { method: 'DELETE', path: `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}` }).catch(() => undefined);
      }
    }
  },
});
