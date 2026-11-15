/**
 * Sequential and parallel capability discovery agree on the real Odoo bed (#2118). Gated on the dependency, never on CI:
 * ODOO_BED_URL, ODOO_BED_DB and ODOO_BED_MIN_KEY (falls back to ODOO_BED_KEY), as in discovery.bed.test.ts. Calls the
 * shipped discoverCapabilities twice, serial then parallel, and compares the snapshots ignoring the timestamp field.
 */
import { assertEquals } from '@std/assert';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { discoverCapabilities, type CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_MIN_KEY') ?? Deno.env.get('ODOO_BED_KEY') ?? '';

/** Timestamp fields stripped before comparing: `observed_at` is the only one the snapshot carries. */
const withoutTimestamps = (s: CapabilitySnapshot): Omit<CapabilitySnapshot, 'observed_at'> => {
  const { observed_at: _observedAt, ...rest } = s;
  return rest;
};

Deno.test({
  name: 'discovery on the bed: parallel:true gives the same snapshot as parallel:false (ignoring observed_at)',
  ignore: !BED,
  fn: async () => {
    const bed = new URL(BED!);
    const call = bindCall({ baseUrl: bed.origin, apiKey: KEY, database: DB, fetchImpl: fetch });
    const ctx = { versionMajor: 20, now: new Date('2026-11-15T00:00:00Z') };
    const serial = await discoverCapabilities(call, { ...ctx, parallel: false });
    const parallel = await discoverCapabilities(call, { ...ctx, parallel: true });
    assertEquals(withoutTimestamps(parallel), withoutTimestamps(serial));
  },
});
