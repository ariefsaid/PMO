/**
 * F4-T3 — the Odoo `Adapter` for the register and its maintenance (FR-OFM-030/031, D5/D6): a create is keyed on the PMO record id,
 * anchored with a stock `ir.model.data` row, and read back so PMO mirrors what Odoo holds; a second create with the same record id
 * adopts the anchored record instead of making another; an update writes the fields it carries on the record the PMO link names.
 * Runs against `fakeOdoo` (the bed's stock field names, V-OFM-1..8).
 */
import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { createOdooEquipmentAdapter, equipmentKey } from './adapter.ts';

const ID = '15110000-0000-4000-8000-000000000001';
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const setup = (ctx: Record<string, unknown> = {}) => {
  const fake = createFakeOdoo({ key: 'k' });
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', companyId: 1, fetchImpl: fake.fetch });
  const adapter = createOdooEquipmentAdapter({ call, ctx: { companyId: 1, ...ctx } });
  return { fake, adapter };
};

const command = (record: Record<string, unknown>, operation: 'create' | 'update' = 'create') =>
  ({ domain: 'equipment', operation, idempotencyKey: KEY, record: { id: ID, ...record } }) as never;

const VEHICLE = { erp_doc_kind: 'register-vehicle', license_plate: 'B 1234 XY', model_id: '3', vin: 'MR0XX', acquisition_date: '2025-02-01', default_unit: 'hours' };
const EQUIPMENT = { erp_doc_kind: 'register-equipment', name: 'Excavator 20t', serial_no: 'EXC-001', model: 'PC200', location: 'Site A', default_unit: 'hours' };
const REQUEST = { erp_doc_kind: 'maintenance-request', subject: 'Hydraulic leak', type: 'corrective', stage_id: '1', schedule_date: '2026-11-10T08:00:00+07:00', duration_hours: 2.5, notes: 'Leak' };
const SERVICE = { erp_doc_kind: 'vehicle-service', service_type_id: '2', date: '2026-11-01', state: 'done', amount: 150000, odometer: 15000, notes: 'x' };

describe('createOdooEquipmentAdapter — one PMO record, one anchored Odoo record', () => {
  it('a vehicle create makes one fleet.vehicle carrying the PMO anchor, and reads it back as the mirror row', async () => {
    const { fake, adapter } = setup();
    const r = await adapter.commit(command(VEHICLE));
    const [row] = fake.rows('fleet.vehicle');
    expect(row).toMatchObject({ license_plate: 'B 1234 XY', vin_sn: 'MR0XX', model_id: 3, company_id: 1, active: true });
    expect(fake.rows('ir.model.data')).toEqual([expect.objectContaining({ module: 'pmo', name: 'equipment_15110000_0000_4000_8000_000000000001', model: 'fleet.vehicle', res_id: row.id })]);
    expect(r.externalRecordId).toBe(`fleet.vehicle:${row.id}`);
    expect(r.canonical.kind).toBe('vehicle');
    expect(r.canonical.row).toMatchObject({ external_id: String(row.id), code: 'B 1234 XY', name: 'Vehicle/B 1234 XY', active: true });
  });

  it('an equipment create makes one maintenance.equipment, anchored the same way', async () => {
    const { fake, adapter } = setup();
    const r = await adapter.commit(command(EQUIPMENT));
    const [row] = fake.rows('maintenance.equipment');
    expect(row).toMatchObject({ name: 'Excavator 20t', serial_no: 'EXC-001', model: 'PC200', location: 'Site A', company_id: 1 });
    expect(fake.rows('ir.model.data')[0]).toMatchObject({ name: 'equipment_15110000_0000_4000_8000_000000000001', model: 'maintenance.equipment', res_id: row.id });
    expect(r.canonical).toMatchObject({ kind: 'equipment', row: { external_id: String(row.id), code: 'EXC-001' } });
  });

  it('a maintenance request hangs off the linked Odoo equipment and reads back with its stage and notes', async () => {
    const { fake, adapter } = setup({ odooEquipmentId: 42 });
    const r = await adapter.commit(command(REQUEST));
    const [row] = fake.rows('maintenance.request');
    expect(row).toMatchObject({ name: 'Hydraulic leak', equipment_id: 42, maintenance_type: 'corrective', stage_id: 1, duration: 2.5, company_id: 1 });
    expect(r.canonical).toMatchObject({ kind: 'maintenance_request', row: { parent_external_id: '42', attrs: { type: 'corrective', notes: 'Leak' } } });
  });

  it('a service log hangs off the linked Odoo vehicle and reads back with its cost', async () => {
    const { fake, adapter } = setup({ odooVehicleId: 7 });
    const r = await adapter.commit(command(SERVICE));
    const [row] = fake.rows('fleet.vehicle.log.services');
    expect(row).toMatchObject({ vehicle_id: 7, service_type_id: 2, state: 'done', amount: 150000, odometer: 15000, company_id: 1 });
    expect(r.canonical).toMatchObject({ kind: 'vehicle_service', row: { parent_external_id: '7', attrs: { amount: 150000, state: 'done' } } });
  });

  it('a second create with the same record id adopts the anchored record: no second document', async () => {
    const { fake, adapter } = setup();
    const first = await adapter.commit(command(VEHICLE));
    const again = await adapter.commit(command({ ...VEHICLE, license_plate: 'B 9999 ZZ' }));
    expect(fake.rows('fleet.vehicle')).toHaveLength(1);
    expect(again.externalRecordId).toBe(first.externalRecordId);
    expect(again.canonical.row).toMatchObject({ code: 'B 1234 XY' });
  });

  it('an anchor of this key that names another model is doubt: refused, never a second identifier', async () => {
    const { fake, adapter } = setup();
    fake.seed('ir.model.data', [{ id: 1, module: 'pmo', name: 'equipment_15110000_0000_4000_8000_000000000001', model: 'maintenance.equipment', res_id: 9 }]);
    await expect(adapter.commit(command(VEHICLE))).rejects.toMatchObject({ code: 'commit-rejected', message: 'ambiguous-anchor' });
    expect(fake.rows('fleet.vehicle')).toHaveLength(0);
  });

  it('an anchored record that Odoo no longer holds is unreadable after the write, never guessed', async () => {
    const { fake, adapter } = setup();
    fake.seed('ir.model.data', [{ id: 1, module: 'pmo', name: 'equipment_15110000_0000_4000_8000_000000000001', model: 'fleet.vehicle', res_id: 99 }]);
    await expect(adapter.commit(command(VEHICLE))).rejects.toMatchObject({ code: 'commit-rejected', message: 'unreadable-after-write' });
    expect(fake.rows('fleet.vehicle')).toHaveLength(0);
  });

  it('a record id that is not a UUID is refused before any call', async () => {
    const { fake, adapter } = setup();
    expect(() => equipmentKey({ id: 'not-a-uuid' })).toThrow();
    await expect(adapter.commit(command({ ...VEHICLE, id: 'not-a-uuid' }))).rejects.toMatchObject({ code: 'commit-rejected', message: 'record-id-invalid' });
    expect(fake.rows('fleet.vehicle')).toHaveLength(0);
    expect(fake.calls).toEqual([]);
  });
});

describe('createOdooEquipmentAdapter — update and probe', () => {
  it('an update writes the fields it carries on the record the PMO link names, then reads it back', async () => {
    const { fake, adapter } = setup();
    fake.seed('fleet.vehicle', [{ id: 7, name: 'Hilux/B 1234 XY', license_plate: 'B 1234 XY', model_id: [3, 'Hilux'], active: true, company_id: 1 }]);
    const r = await adapter.commit(command({ erp_doc_kind: 'register-vehicle', external_id: 'fleet.vehicle:7', active: false }, 'update'));
    expect(fake.rows('fleet.vehicle')[0]).toMatchObject({ id: 7, active: false, license_plate: 'B 1234 XY' });
    expect(r.externalRecordId).toBe('fleet.vehicle:7');
    expect(r.canonical.row).toMatchObject({ external_id: '7', active: false });
  });

  it('an update of a record Odoo does not hold is refused, and an external id of another model too', async () => {
    const { fake, adapter } = setup();
    await expect(adapter.commit(command({ erp_doc_kind: 'register-vehicle', external_id: 'fleet.vehicle:7', active: false }, 'update')))
      .rejects.toMatchObject({ code: 'commit-rejected', message: 'unreadable-after-write' });
    await expect(adapter.commit(command({ erp_doc_kind: 'register-vehicle', external_id: 'maintenance.equipment:7', active: false }, 'update')))
      .rejects.toMatchObject({ code: 'commit-rejected', message: 'external-id-invalid' });
    expect(fake.rows('fleet.vehicle')).toHaveLength(0);
  });

  it('probe answers the anchored record (with what Odoo holds) or null', async () => {
    const { adapter } = setup();
    expect(await adapter.probe({ id: ID, erp_doc_kind: 'register-vehicle' })).toBeNull();
    await adapter.commit(command(VEHICLE));
    const hit = await adapter.probe({ id: ID, erp_doc_kind: 'register-vehicle' });
    expect(hit?.externalRecordId).toBe('fleet.vehicle:1');
    expect(hit?.canonical).toMatchObject({ kind: 'vehicle', row: { code: 'B 1234 XY' } });
  });

  it('refuses another domain, a delete, and an unwired kind', async () => {
    const { adapter } = setup();
    await expect(adapter.commit({ domain: 'procurement', operation: 'create', record: { id: ID, erp_doc_kind: 'register-vehicle' } } as never))
      .rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.commit(command(VEHICLE, 'update')))
      .rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.commit({ domain: 'equipment', operation: 'create', record: { id: ID, erp_doc_kind: 'purchase-order' } } as never))
      .rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('getByExternalId reads one register record back; the register feed is the sweep\'s, not an adapter read', async () => {
    const { adapter } = setup();
    await adapter.commit(command(EQUIPMENT));
    expect(await adapter.getByExternalId('equipment', 'maintenance.equipment:1')).toMatchObject({ kind: 'equipment', row: { code: 'EXC-001' } });
    expect(await adapter.getByExternalId('equipment', 'maintenance.equipment:99')).toBeNull();
    await expect(adapter.getByExternalId('companies', 'maintenance.equipment:1')).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.listChangesSinceWatermark('equipment', null)).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});
