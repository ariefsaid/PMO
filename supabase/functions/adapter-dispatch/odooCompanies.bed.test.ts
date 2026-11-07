/**
 * AC-ODC-034 (layer B, #1504 S8-B) on the stock Odoo bed: the shipped Odoo companies adapter and its lookup probe against the real JSON-2
 * API. A vendor made in PMO becomes exactly one partner carrying the PMO anchor; the same create again finds it; a create whose answer was
 * lost is found by the anchor and not made twice; a partner whose anchor a clerk edited is NOT found (the miss that makes the dispatch hold
 * the command for a person rather than create again); and a value Odoo refuses reaches the caller as the fixed `validation` verdict.
 * The adapter is driven directly, not through the served handler: the handler's host guard refuses a local address, which is all a bed has.
 * Gated on the dependency, never on CI: URL, database and key come from the bed's untracked env file, sourced and never printed. Everything
 * is synthetic and stamped; the partners this makes are archived at the end.
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooCompanies.bed.test.ts'
 */
import { assert, assertEquals } from '@std/assert';
import { AdapterError, type AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { createOdooAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/adapter.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { odooSendProbe } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-ODC-034 on the bed: one partner per PMO company, a lost answer is found not repeated, an edited anchor is a miss, a refused value is the validation verdict',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const stamp = `S8-${Date.now()}`;
    let lose = false;
    const faultyFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const response = await fetch(url, init);
      if (lose && String(url).endsWith('/res.partner/create')) { lose = false; throw new TypeError('connection reset after the server answered'); }
      return response;
    }) as typeof fetch;
    const call = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: faultyFetch });
    const [company] = await call<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const ctx = { companyId: company.id, analyticPlanId: null, unitMap: {} };
    const adapter = createOdooAdapter(call, ctx);
    const created: number[] = [];
    const partnersOf = (id: string) => call<Array<{ id: number; ref: string | false; name: string }>>('res.partner', 'search_read', { domain: [['name', '=like', `${stamp}%`], ['ref', 'in', [`pmo:${id}`, 'edited by hand']]], fields: ['ref', 'name'], context: { active_test: false } });
    const command = (id: string, over: Record<string, unknown> = {}): AdapterCommand => ({
      domain: 'companies', operation: 'create', idempotencyKey: `odoo:companies:${id}`,
      record: { id, name: `${stamp} vendor ${id.slice(0, 4)}`, type: 'Vendor', erp_tax_id: null, ...over },
    } as unknown as AdapterCommand);
    try {
      // 1. one partner, anchored, with the vendor rank
      const id1 = crypto.randomUUID();
      const first = await adapter.commit(command(id1));
      const found = await partnersOf(id1);
      assertEquals(found.length, 1);
      created.push(found[0].id);
      assertEquals(found[0].ref, `pmo:${id1}`);
      assertEquals(first.externalRecordId, `Vendor:${found[0].id}`);
      // the same create again finds it
      assertEquals((await adapter.commit(command(id1))).externalRecordId, first.externalRecordId);
      assertEquals((await partnersOf(id1)).length, 1);

      // 2. a create whose answer was lost: the anchor finds the partner Odoo kept, and a repeat adds none
      const id2 = crypto.randomUUID();
      lose = true;
      let lost: unknown;
      try { await adapter.commit(command(id2)); } catch (err) { lost = err; }
      assert(lost instanceof AdapterError && lost.code === 'external-unreachable', `the lost answer is unreachable, got ${String(lost)}`);
      const afterLoss = await partnersOf(id2);
      assertEquals(afterLoss.length, 1, 'Odoo kept the partner');
      created.push(afterLoss[0].id);
      assertEquals(await odooSendProbe(call, ctx, 'party', { id: id2, name: 'x', role: 'vendor' }), { externalRecordId: `Vendor:${afterLoss[0].id}` });
      await adapter.commit(command(id2));
      assertEquals((await partnersOf(id2)).length, 1, 'the retry created nothing more');

      // 3. a clerk edits the anchor: the lookup misses, which is why the dispatch holds (never reissues) such a command
      await call('res.partner', 'write', { ids: [afterLoss[0].id], vals: { ref: 'edited by hand' } });
      assertEquals(await odooSendProbe(call, ctx, 'party', { id: id2, name: 'x', role: 'vendor' }), null);

      // 4. a value Odoo refuses reaches the caller as the fixed verdict; where this bed accepts the value, nothing is asserted
      const id4 = crypto.randomUUID();
      try {
        await adapter.commit(command(id4, { erp_tax_id: '!!not a tax number!!' }));
        const accepted = await partnersOf(id4);
        created.push(...accepted.map((p) => p.id));
        console.log('bed note: this bed accepts any tax number, so the validation verdict is covered by the unit suite only');
      } catch (err) {
        assert(err instanceof AdapterError && err.code === 'commit-rejected' && err.message === 'validation', String(err));
      }
    } finally {
      if (created.length) await call('res.partner', 'write', { ids: created, vals: { active: false } });
    }
  },
});
