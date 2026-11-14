import { describe, expect, it } from 'vitest';
import { ASSET_KINDS, ASSET_KIND_SPECS, htmlToText, type AssetKind } from './kinds.ts';
import { ASSET_MODELS } from '../discovery.ts';
import { companyDomain } from '../kinds.ts';

const W = '2026-11-09 08:00:00';
const FIXTURES: Record<AssetKind, { raw: Record<string, unknown>; row: Record<string, unknown> }> = {
  vehicle: { raw: { id: 7, name: 'Hilux/B 1234 XY', license_plate: 'B 1234 XY', vin_sn: 'MR0XX', model_id: [3, 'Hilux'], driver_id: [9, 'Budi'], odometer: 15230.5, odometer_unit: 'kilometers', acquisition_date: '2025-02-01', active: true, write_date: W },
    row: { external_id: '7', code: 'B 1234 XY', name: 'Hilux/B 1234 XY', parent_external_id: null, active: true,
      attrs: { model_id: '3', model_name: 'Hilux', vin: 'MR0XX', driver_name: 'Budi', odometer: 15230.5, odometer_unit: 'kilometers', acquisition_date: '2025-02-01' } } },
  vehicle_model: { raw: { id: 3, name: 'Hilux', brand_id: [2, 'Toyota'], company_id: [1, 'Company'], write_date: W },
    row: { external_id: '3', code: null, name: 'Hilux', parent_external_id: null, active: true, attrs: { brand: 'Toyota' } } },
  // Odoo 20 shapes (#2174): `location` is a free `stock.location` reference on the equipment, not a text field.
  equipment: { raw: { id: 42, name: 'Excavator 20t', serial_no: 'EXC-001', category_id: [4, 'Heavy'], model: 'PC200', location_id: [9, 'Site A'], active: true, write_date: W },
    row: { external_id: '42', code: 'EXC-001', name: 'Excavator 20t', parent_external_id: null, active: true, attrs: { category: 'Heavy', model: 'PC200', location: 'Site A' } } },
  // Odoo 20 has no `request_date` and no `archive` on a request: the raise date is `create_date`, and "finished" is `state`.
  maintenance_request: { raw: { id: 11, name: 'Hydraulic leak', equipment_id: [42, 'Excavator 20t'], maintenance_type: 'corrective', stage_id: [1, 'New Request'], create_date: '2026-11-08 09:15:00', schedule_date: '2026-11-10 01:00:00', close_date: false, state: 'normal', duration: 2.5, priority: '2', description: '<p>Leak at &amp; boom</p>', write_date: W },
    row: { external_id: '11', code: null, name: 'Hydraulic leak', parent_external_id: '42', active: true,
      attrs: { type: 'corrective', stage_id: '1', stage_name: 'New Request', request_date: '2026-11-08', schedule_date: '2026-11-10 01:00:00', close_date: null, state: 'normal', done: false, duration: 2.5, priority: '2', notes: 'Leak at & boom' } } },
  // A stage is a pipe column only in Odoo 20: it has no `done` flag (`fold` marks a folded column).
  maintenance_stage: { raw: { id: 4, name: 'Repaired', sequence: 30, fold: false, write_date: W },
    row: { external_id: '4', code: null, name: 'Repaired', parent_external_id: null, active: true, attrs: { sequence: 30 } } },
  // A service log's day is `date_from` in Odoo 20 (`date_to` is the end of a multi-day service).
  vehicle_service: { raw: { id: 5, vehicle_id: [7, 'Hilux/B 1234 XY'], service_type_id: [2, 'Oil change'], date_from: '2026-11-01', date_to: false, state: 'done', amount: 150000, odometer: 15000, vendor_id: [8, 'PT Sinar Baja'], description: 'Oil + filter', notes: false, active: true, write_date: W },
    row: { external_id: '5', code: null, name: 'Oil change', parent_external_id: '7', active: true,
      attrs: { service_type_id: '2', date: '2026-11-01', state: 'done', amount: 150000, odometer: 15000, vendor_name: 'PT Sinar Baja', description: 'Oil + filter', notes: null } } },
  service_type: { raw: { id: 2, name: 'Oil change', category: 'service', write_date: W },
    row: { external_id: '2', code: null, name: 'Oil change', parent_external_id: null, active: true, attrs: { category: 'service' } } },
};

describe('odoo/assets/kinds — AC-OFM-010', () => {
  it.each(ASSET_KINDS)('AC-OFM-010 a %s fixture row parses to its directory row', (kind) => {
    expect(ASSET_KIND_SPECS[kind].parse(FIXTURES[kind].raw)).toEqual({ ...FIXTURES[kind].row, source_write_date: W });
  });
  it.each(ASSET_KINDS)('AC-OFM-010 a malformed %s row is rejected whole', (kind) => {
    const raw = FIXTURES[kind].raw;
    expect(ASSET_KIND_SPECS[kind].parse({ ...raw, id: undefined })).toBeNull();
    expect(ASSET_KIND_SPECS[kind].parse({ ...raw, write_date: '9 Nov' })).toBeNull();
  });
  it('AC-OFM-010 a request whose equipment link is malformed, or a service with no service type, is rejected', () => {
    expect(ASSET_KIND_SPECS.maintenance_request.parse({ ...FIXTURES.maintenance_request.raw, equipment_id: 'x' })).toBeNull();
    expect(ASSET_KIND_SPECS.vehicle_service.parse({ ...FIXTURES.vehicle_service.raw, service_type_id: false })).toBeNull();
  });
  // #2174: Odoo 20 has no request archive flag at all, so a mirrored request is never inactive on Odoo's word.
  it('AC-OFM-010 a request is active whatever Odoo holds: maintenance.request has no archive flag to read', () => {
    expect(ASSET_KIND_SPECS.maintenance_request.fields).not.toContain('archive');
    expect(ASSET_KIND_SPECS.maintenance_request.fields).not.toContain('active');
    expect(ASSET_KIND_SPECS.maintenance_request.parse({ ...FIXTURES.maintenance_request.raw, archive: true })?.active).toBe(true);
  });
  // #2174: Odoo 20 marks a request finished with `state = done` (maintenance.py), not a flag on its stage.
  it('AC-OFM-010 a request Odoo holds as done is recognised as done, and one in progress is not', () => {
    const done = ASSET_KIND_SPECS.maintenance_request.parse({ ...FIXTURES.maintenance_request.raw, state: 'done', close_date: '2026-11-09' });
    expect(done?.attrs).toMatchObject({ state: 'done', done: true, close_date: '2026-11-09' });
    expect(ASSET_KIND_SPECS.maintenance_request.parse(FIXTURES.maintenance_request.raw)?.attrs).toMatchObject({ state: 'normal', done: false });
  });
  // #2174: every field asked for here is one Odoo 20 really has (the bed probe `--equipment` is the live proof).
  it('AC-OFM-010 no asset kind asks Odoo 20 for a field Odoo 20 does not have', () => {
    expect(ASSET_KIND_SPECS.equipment.fields).not.toContain('location');
    expect(ASSET_KIND_SPECS.equipment.fields).toContain('location_id');
    expect(ASSET_KIND_SPECS.maintenance_stage.fields).not.toContain('done');
    expect(ASSET_KIND_SPECS.maintenance_request.fields).not.toContain('request_date');
    expect(ASSET_KIND_SPECS.vehicle_service.fields).not.toContain('date');
    expect(ASSET_KIND_SPECS.vehicle_service.fields).toContain('date_from');
  });
  it('AC-OFM-010 vehicle models stay scoped to the activated company while shared models remain visible', () => {
    expect(companyDomain(ASSET_KIND_SPECS.vehicle_model, 7)).toEqual([['company_id', 'in', [7, false]]]);
    expect(ASSET_MODELS['fleet.vehicle.model']).toContain('company_id');
  });
  it('htmlToText drops tags, decodes the five basic entities and trims', () => {
    expect(htmlToText('<p>a &lt;b&gt; &quot;c&quot; &#39;d&#39;</p><br/>')).toBe('a <b> "c" \'d\'');
    expect(htmlToText(false)).toBeNull();
  });
  it('every field an asset kind reads or scopes by is one discovery checks', () => {
    for (const spec of Object.values(ASSET_KIND_SPECS)) {
      expect(ASSET_MODELS[spec.model], spec.model).toEqual(expect.arrayContaining([...spec.fields, ...(spec.company ? [spec.company] : [])]));
    }
  });
});
