import { describe, expect, it } from 'vitest';
import { bindCall, OdooError } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { discoverCapabilities, LATER_MODELS, O1_MODELS, versionPolicy } from './discovery.ts';

describe('odoo/discovery — AC-ODC-012 version policy', () => {
  it.each([
    [null, false, { ok: false, reason: 'no-json2' }],
    [20, false, { ok: false, reason: 'no-json2' }],
    [20, true, { ok: true, untested: false }],
    [21, true, { ok: true, untested: true }],
    [19, true, { ok: false, reason: 'below-tested' }],
    [null, true, { ok: false, reason: 'below-tested' }],
  ] as const)('AC-ODC-012 version %s json2=%s', (major, json2, expected) => expect(versionPolicy(major, json2)).toEqual(expected));
});

const NOW = new Date('2026-11-01T00:00:00Z');

function stockFake() {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('res.company', [{ id: 1, name: 'Main Co' }]);
  fake.seed('account.tax', [
    { id: 1, name: '12%', amount: 12, type_tax_use: 'sale' },
    { id: 2, name: '12%', amount: 12, type_tax_use: 'purchase' },
    { id: 3, name: '11%', amount: 11, type_tax_use: 'purchase', active: false },
  ]);
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  return { fake, discover: () => discoverCapabilities(call, { versionMajor: 20, now: NOW }) };
}

describe('odoo/discovery — AC-ODC-011 capability snapshot', () => {
  it('AC-ODC-011 the full fixture: nothing missing, every O1 model readable, later models flagged, no installed-modules read', async () => {
    const { fake, discover } = stockFake();
    const snap = await discover();
    expect(snap.missing).toEqual([]);
    expect(Object.keys(snap.models).sort()).toEqual(Object.keys(O1_MODELS).sort());
    for (const p of Object.values(snap.models)) expect(p).toMatchObject({ exists: true, read: true, fields_missing: [] });
    expect(Object.keys(snap.later).sort()).toEqual([...LATER_MODELS].sort());
    expect(typeof snap.later['purchase.order']).toBe('boolean');
    expect(snap).toMatchObject({ observed_at: NOW.toISOString(), version_major: 20, untested_version: false, companies: [{ id: 1, name: 'Main Co' }] });
    expect(fake.calls.some((c) => c.model === 'ir.module.module')).toBe(false);
  });

  it('AC-ODC-011 a missing field is named <model>:<field>', async () => {
    const { fake, discover } = stockFake();
    fake.dropField('account.tax', 'type_tax_use');
    expect((await discover()).missing).toContain('account.tax:type_tax_use');
  });

  it('AC-ODC-011 a model Odoo does not have (404) is named and recorded as absent', async () => {
    const { fake, discover } = stockFake();
    fake.dropModel('stock.location');
    const snap = await discover();
    expect(snap.missing).toContain('stock.location');
    expect(snap.models['stock.location']).toMatchObject({ exists: false, read: false });
  });

  it('AC-ODC-011 a later-slice model that is absent is false, not missing', async () => {
    const { fake, discover } = stockFake();
    fake.dropModel('fleet.vehicle');
    const snap = await discover();
    expect(snap.later['fleet.vehicle']).toBe(false);
    expect(snap.missing).toEqual([]);
  });

  it('AC-ODC-011 no active PPN tax (11 or 12) → l10n_id:ppn', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    fake.seed('res.company', [{ id: 1, name: 'Main Co' }]);
    fake.seed('account.tax', [{ id: 1, name: '15%', amount: 15, type_tax_use: 'sale' }, { id: 3, name: '11%', amount: 11, type_tax_use: 'purchase', active: false }]);
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
    expect((await discoverCapabilities(call, { versionMajor: 20, now: NOW })).missing).toContain('l10n_id:ppn');
  });

  it('AC-ODC-011 no read access is named <model>:read', async () => {
    const { fake, discover } = stockFake();
    fake.denyAccess('account.account', 'read');
    expect((await discover()).missing).toContain('account.account:read');
  });

  it('AC-ODC-011 a supported send without create access is named <model>:create', async () => {
    const { fake, discover } = stockFake();
    fake.denyAccess('res.partner', 'create');
    const snap = await discover();
    expect(snap.missing).toEqual(['res.partner:create']);
    expect(snap.models['res.partner']).toMatchObject({ read: true, create: false, write: true, unlink: true });
  });

  it('FR-ODC-022 a version past the tested range is recorded as untested, not refused', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    fake.seed('account.tax', [{ id: 1, name: '12%', amount: 12, type_tax_use: 'sale' }]);
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
    expect((await discoverCapabilities(call, { versionMajor: 21, now: NOW })).untested_version).toBe(true);
  });

  it('AC-ODC-013 a rejected key is a connection failure, not a missing capability', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'wrong', database: 'db1', fetchImpl: fake.fetch });
    await expect(discoverCapabilities(call, { versionMajor: 20, now: NOW })).rejects.toMatchObject({ errorClass: 'key-rejected' });
    await expect(discoverCapabilities(call, { versionMajor: 20, now: NOW })).rejects.toBeInstanceOf(OdooError);
  });
});

describe('odoo/discovery — discovery deadline', () => {
  it('a discovery past its deadline stops with a timeout, not after every model', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    let calls = 0;
    const slow = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: (...a) => { calls++; return new Promise((r) => setTimeout(r, 15)).then(() => fake.fetch(...a)); } });
    await expect(discoverCapabilities(slow, { versionMajor: 20, now: NOW, deadlineAt: Date.now() + 40 }))
      .rejects.toMatchObject({ errorClass: 'timeout' });
    expect(calls).toBeLessThan(10);
  });
});
