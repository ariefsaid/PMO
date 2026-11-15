/**
 * #2118: discovery reads which models and fields exist in two directory calls instead of one `fields_get` per model, and
 * runs `has_access` concurrently only when the caller says the host allows it (never on Odoo Online, #1767).
 * The oracle for "the capability result is identical" is the per-model algorithm discovery used before (`perModelOracle`),
 * run on the same fake for every capability fault the fake can raise.
 */
import { describe, expect, it } from 'vitest';
import { bindCall, OdooError, type OdooCall } from './client.ts';
import { createFakeOdoo, type FakeOdoo } from './fakeOdoo.ts';
import { ASSET_MODELS, discoverCapabilities, LATER_MODELS, O1_MODELS, versionPolicy, type CapabilitySnapshot, type ModelProbe } from './discovery.ts';
import { ODOO_WORKFLOWS } from './workflowDeclarations.ts';

const NOW = new Date('2026-11-01T00:00:00Z');
const OPS = ['read', 'create', 'write', 'unlink'] as const;

/** Discovery as it ran before #2118: `fields_get` per model, then `has_access` per operation, all serial. */
async function perModelOracle(call: OdooCall, versionMajor: number | null): Promise<CapabilitySnapshot> {
  const probe = async (model: string, fields: readonly string[], withAccess: boolean): Promise<ModelProbe> => {
    let got: Record<string, unknown>;
    try { got = await call<Record<string, unknown>>(model, 'fields_get', { attributes: ['type'] }); } catch (err) {
      if (err instanceof OdooError && err.errorClass === 'missing-model') return { exists: false, read: false, create: false, write: false, unlink: false, fields_missing: [...fields] };
      throw err;
    }
    const access = { read: false, create: false, write: false, unlink: false };
    if (withAccess) for (const op of OPS) access[op] = (await call<boolean>(model, 'has_access', { operation: op })) === true;
    return { exists: true, ...access, fields_missing: fields.filter((f) => !(f in got)) };
  };
  const models: Record<string, ModelProbe> = {};
  for (const [m, f] of Object.entries(O1_MODELS)) models[m] = await probe(m, f, true);
  const later: Record<string, boolean> = {};
  for (const m of LATER_MODELS) { const p = await probe(m, [], false); later[m] = p.exists && (await call<boolean>(m, 'has_access', { operation: 'read' })) === true; }
  const assets: Record<string, ModelProbe> = {};
  for (const [m, f] of Object.entries(ASSET_MODELS)) assets[m] = await probe(m, f, true);
  const missing = Object.entries(models).flatMap(([m, p]) => (!p.exists ? [m] : !p.read ? [`${m}:read`] : p.fields_missing.map((f) => `${m}:${f}`)));
  for (const [wf, m] of Object.entries({ 'party.send': 'res.partner', 'project.send': 'account.analytic.account', 'item.send': 'product.product' })) {
    const p = models[m];
    if (ODOO_WORKFLOWS[wf as 'party.send'].status === 'supported' && p.exists && p.read && !p.create) missing.push(`${m}:create`);
  }
  if (models['account.tax'].read && !models['account.tax'].fields_missing.length) {
    const ppn = await call<number>('account.tax', 'search_count', { domain: [['amount', 'in', [11, 12]], ['type_tax_use', 'in', ['purchase', 'sale']]] });
    if (!ppn) missing.push('l10n_id:ppn');
  }
  const companies = models['res.company'].read
    ? (await call<{ id: number; name: string }[]>('res.company', 'search_read', { domain: [], fields: ['id', 'name'] })).map(({ id, name }) => ({ id, name }))
    : [];
  const v = versionPolicy(versionMajor, true);
  return { observed_at: NOW.toISOString(), version_major: versionMajor, untested_version: v.ok && v.untested, companies, models, later, assets, missing };
}

type Fault = (fake: FakeOdoo) => void;
const SCENARIOS: Array<[string, Fault, number?]> = [
  ['the full fixture', () => {}],
  ['a dropped O1 model', (f) => f.dropModel('stock.location')],
  ['no fleet app', (f) => f.dropModel('fleet.vehicle')],
  ['a dropped later model', (f) => f.dropModel('account.analytic.line')],
  ['a dropped O1 field', (f) => f.dropField('account.tax', 'type_tax_use')],
  ['a dropped asset field', (f) => f.dropField('maintenance.request', 'schedule_end')],
  ['two fields gone from one model', (f) => { f.dropField('res.partner', 'vat'); f.dropField('res.partner', 'ref'); }],
  ['no read on an O1 model', (f) => f.denyAccess('account.account', 'read')],
  ['no create on a send model', (f) => f.denyAccess('res.partner', 'create')],
  ['no unlink on an asset model', (f) => f.denyAccess('fleet.vehicle', 'unlink')],
  ['no read on a later model', (f) => f.denyAccess('account.payment', 'read')],
  ['no read on res.company', (f) => f.denyAccess('res.company', 'read')],
  ['an untested version', () => {}, 21],
];

function rig(fault: Fault) {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('res.company', [{ id: 1, name: 'Main Co' }, { id: 2, name: 'Branch' }]);
  fake.seed('account.tax', [{ id: 1, name: '12%', amount: 12, type_tax_use: 'sale' }]);
  fault(fake);
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = (async (...a: Parameters<typeof fetch>) => {
    inFlight++; peak = Math.max(peak, inFlight);
    try { await new Promise((r) => setTimeout(r, 0)); return await fake.fetch(...a); } finally { inFlight--; }
  }) as typeof fetch;
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl });
  return { fake, call, peak: () => peak };
}

describe('#2118 discovery: identical capability result in fewer calls', () => {
  it.each(SCENARIOS)('AC-2118-1 %s: the snapshot equals the per-model result, key for key', async (_name, fault, major = 20) => {
    const before = rig(fault);
    const expected = await perModelOracle(before.call, major);
    for (const parallel of [false, true]) {
      const after = rig(fault);
      const got = await discoverCapabilities(after.call, { versionMajor: major, now: NOW, parallel });
      expect(got).toEqual(expected);
      expect(JSON.stringify(got)).toBe(JSON.stringify(expected));   // same keys in the same order, not only equal values
    }
  });

  it('AC-2118-1 on the full fixture: two directory reads replace every fields_get, and the call count stays under a ceiling of 90', async () => {
    const before = rig(() => {});
    await perModelOracle(before.call, 20);
    expect(before.fake.calls).toHaveLength(117);
    const after = rig(() => {});
    await discoverCapabilities(after.call, { versionMajor: 20, now: NOW });
    expect(after.fake.calls.filter((c) => c.method === 'fields_get')).toEqual([]);
    expect(after.fake.calls.filter((c) => c.method !== 'has_access')).toEqual([
      { model: 'ir.model', method: 'search_read' }, { model: 'ir.model.fields', method: 'search_read' },
      { model: 'account.tax', method: 'search_count' }, { model: 'res.company', method: 'search_read' },
    ]);
    // one has_access per operation the snapshot records: 4 per O1 and asset model, 1 per later model
    const models = Object.keys(O1_MODELS).length + Object.keys(ASSET_MODELS).length;
    expect(after.fake.calls.filter((c) => c.method === 'has_access')).toHaveLength(models * 4 + LATER_MODELS.length);
    // A CEILING, not an equality: the count may fall, never rise. The ticket's baseline was <= 56; it is 90 now because
    // fe90127e (#1511 F1) added 8 probed models (each costs 4 has_access calls): fleet.vehicle, fleet.vehicle.model,
    // maintenance.equipment, maintenance.request, maintenance.stage, fleet.vehicle.log.services, fleet.service.type, ir.model.data.
    expect(after.fake.calls.length).toBeLessThanOrEqual(90);
  });

  it('AC-2118-1 an absent model costs no access call', async () => {
    const r = rig((f) => f.dropModel('fleet.vehicle'));
    await discoverCapabilities(r.call, { versionMajor: 20, now: NOW });
    expect(r.fake.calls.filter((c) => c.model === 'fleet.vehicle')).toEqual([]);
  });

  it('#1767 discovery is serial unless the caller allows parallel calls: one request in flight at a time', async () => {
    const r = rig(() => {});
    await discoverCapabilities(r.call, { versionMajor: 20, now: NOW });
    expect(r.peak()).toBe(1);
    const p = rig(() => {});
    await discoverCapabilities(p.call, { versionMajor: 20, now: NOW, parallel: true });
    expect(p.peak()).toBeGreaterThan(1);
  });

  it('a key that cannot read the model directory is a connection failure, never "everything missing"', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    fake.dropModel('ir.model');
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
    await expect(discoverCapabilities(call, { versionMajor: 20, now: NOW })).rejects.toBeInstanceOf(OdooError);
  });
});
