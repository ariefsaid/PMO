/**
 * F4-T1/T2 — the request bodies PMO sends for the fleet and maintenance register (FR-OFM-030/031, AC-OFM-030).
 * Field names live here and in `kinds.ts` only (NFR-OFM-001); a create adds the Odoo company, an update is a PATCH so an
 * edit never blanks a field the form did not show, and every refusal names its own reason before any write.
 */
import { describe, expect, it } from 'vitest';
import { buildEquipmentBody, toOdooDatetime } from './bodies.ts';

const COMPANY = 1;
const create = (over: Record<string, unknown> = {}) => ({ operation: 'create' as const, companyId: COMPANY, ...over });
const update = (over: Record<string, unknown> = {}) => ({ operation: 'update' as const, companyId: COMPANY, ...over });

describe('buildEquipmentBody — register-vehicle', () => {
  it('a create sends the stock fleet.vehicle fields and the company', () => {
    expect(buildEquipmentBody('register-vehicle', { license_plate: 'B 1234 XY', model_id: '3', vin: 'MR0XX', acquisition_date: '2025-02-01' }, create()))
      .toEqual({ outcome: 'ready', body: { license_plate: 'B 1234 XY', model_id: 3, vin_sn: 'MR0XX', acquisition_date: '2025-02-01', company_id: COMPANY } });
  });

  it('a create without a model is refused before any write: Odoo requires one', () => {
    expect(buildEquipmentBody('register-vehicle', { license_plate: 'B 1234 XY' }, create()))
      .toEqual({ outcome: 'refused', code: 'vehicle-model-required' });
  });

  it('an update is a PATCH: only the fields it carries, and never the company', () => {
    expect(buildEquipmentBody('register-vehicle', { active: false }, update()))
      .toEqual({ outcome: 'ready', body: { active: false } });
  });
});

describe('buildEquipmentBody — register-equipment', () => {
  // #2174: Odoo 20's maintenance.equipment has no free-text `location` (a location is a `stock.location` reference,
  // which PMO has no picker for), so the write never carries it: the typed location stays PMO-side.
  it('a create sends name, serial and model with the company, and never a location Odoo 20 does not have', () => {
    expect(buildEquipmentBody('register-equipment', { name: 'Excavator 20t', serial_no: 'EXC-001', model: 'PC200', location: 'Site A' }, create()))
      .toEqual({ outcome: 'ready', body: { name: 'Excavator 20t', serial_no: 'EXC-001', model: 'PC200', company_id: COMPANY } });
  });

  it('an empty name is refused (it is the one field Odoo requires)', () => {
    expect(buildEquipmentBody('register-equipment', { name: '  ' }, create()))
      .toEqual({ outcome: 'refused', code: 'name-required' });
  });
});

describe('buildEquipmentBody — maintenance-request', () => {
  const request = { subject: 'Hydraulic leak', type: 'corrective', stage_id: '1', schedule_date: '2026-11-10T08:00:00+07:00', duration_hours: 2.5, notes: 'Leak <b>' };

  // #2174: Odoo 20 computes `duration` from the scheduled window (`MaintenanceRequest._compute_duration`), so a `duration`
  // PMO sent was overwritten with the 1 h its own `_compute_schedule_end` implies. PMO sends the window instead.
  it('a create sends the naive-UTC schedule window, the escaped description, against the linked Odoo equipment', () => {
    expect(buildEquipmentBody('maintenance-request', request, create({ odooEquipmentId: 42 })))
      .toEqual({
        outcome: 'ready',
        body: {
          name: 'Hydraulic leak', equipment_id: 42, maintenance_type: 'corrective', stage_id: 1,
          schedule_date: '2026-11-10 01:00:00', schedule_end: '2026-11-10 03:30:00', description: '<p>Leak &lt;b&gt;</p>', company_id: COMPANY,
        },
      });
  });

  it('a create never sends Odoo 20 a duration it would recompute', () => {
    const built = buildEquipmentBody('maintenance-request', request, create({ odooEquipmentId: 42 }));
    expect(built.outcome === 'ready' && built.body).not.toHaveProperty('duration');
  });

  it('refuses a type Odoo does not know, a negative duration, notes over 2000 characters, and an invalid date', () => {
    expect(buildEquipmentBody('maintenance-request', { ...request, type: 'other' }, create({ odooEquipmentId: 42 })))
      .toEqual({ outcome: 'refused', code: 'maintenance-type-invalid' });
    expect(buildEquipmentBody('maintenance-request', { ...request, duration_hours: -1 }, create({ odooEquipmentId: 42 })))
      .toEqual({ outcome: 'refused', code: 'duration-invalid' });
    expect(buildEquipmentBody('maintenance-request', { ...request, notes: 'x'.repeat(2001) }, create({ odooEquipmentId: 42 })))
      .toEqual({ outcome: 'refused', code: 'notes-too-long' });
    expect(buildEquipmentBody('maintenance-request', { ...request, schedule_date: 'next tuesday' }, create({ odooEquipmentId: 42 })))
      .toEqual({ outcome: 'refused', code: 'date-invalid' });
  });

  it('refuses a create with no subject: Odoo requires a name on a request, and a body without one is refused before the outbox', () => {
    expect(buildEquipmentBody('maintenance-request', { type: 'corrective', stage_id: '1' }, create({ odooEquipmentId: 42 })))
      .toEqual({ outcome: 'refused', code: 'name-required' });
    expect(buildEquipmentBody('maintenance-request', { subject: '   ' }, create({ odooEquipmentId: 42 })))
      .toEqual({ outcome: 'refused', code: 'name-required' });
  });

  it('an update patches the stage and the close fields it carries, never the asset it hangs off', () => {
    expect(buildEquipmentBody('maintenance-request', { stage_id: '4' }, update()))
      .toEqual({ outcome: 'ready', body: { stage_id: 4 } });
  });

  // #2174: a duration is only expressible as the window it implies, so an edit that moves it must carry the scheduled start.
  it('an update that moves the duration sends the window it implies', () => {
    expect(buildEquipmentBody('maintenance-request', { stage_id: '4', schedule_date: '2026-11-10 01:00:00', duration_hours: 3 }, update()))
      .toEqual({ outcome: 'ready', body: { stage_id: 4, schedule_date: '2026-11-10 01:00:00', schedule_end: '2026-11-10 04:00:00' } });
  });

  it('refuses a duration with no scheduled start: Odoo 20 has nothing to derive it from', () => {
    expect(buildEquipmentBody('maintenance-request', { duration_hours: 2.5 }, update()))
      .toEqual({ outcome: 'refused', code: 'schedule-date-required' });
  });

  // #2174: Odoo 20 has no `done` stage flag and no request `archive`; it marks a request finished with `state = done`
  // (maintenance.py `MaintenanceRequest.write`), which also sets `close_date` on Odoo's side.
  it('a request marked done sends Odoo 20 state done beside its stage, and a state Odoo 20 does not know is refused', () => {
    expect(buildEquipmentBody('maintenance-request', { stage_id: '4', state: 'done' }, update()))
      .toEqual({ outcome: 'ready', body: { stage_id: 4, state: 'done' } });
    expect(buildEquipmentBody('maintenance-request', { state: 'finished' }, update()))
      .toEqual({ outcome: 'refused', code: 'request-state-invalid' });
  });
});

describe('buildEquipmentBody — vehicle-service', () => {
  const service = { service_type_id: '2', date: '2026-11-01', state: 'done', amount: 150000, odometer: 15000, notes: 'x' };

  // #2174: Odoo 20 renamed the service day to `date_from` ("Start of Service"); `date_to` is the end of a multi-day job.
  it('a create sends the log against the linked Odoo vehicle, on Odoo 20 date_from, with the company', () => {
    expect(buildEquipmentBody('vehicle-service', service, create({ odooVehicleId: 7 })))
      .toEqual({
        outcome: 'ready',
        body: { vehicle_id: 7, service_type_id: 2, date_from: '2026-11-01', state: 'done', amount: 150000, odometer: 15000, notes: 'x', company_id: COMPANY },
      });
  });

  it('refuses a state Odoo does not know and an amount that is not a number', () => {
    expect(buildEquipmentBody('vehicle-service', { ...service, state: 'open' }, create({ odooVehicleId: 7 })))
      .toEqual({ outcome: 'refused', code: 'service-state-invalid' });
    expect(buildEquipmentBody('vehicle-service', { ...service, amount: Number.NaN }, create({ odooVehicleId: 7 })))
      .toEqual({ outcome: 'refused', code: 'amount-invalid' });
    expect(buildEquipmentBody('vehicle-service', { ...service, amount: -1 }, create({ odooVehicleId: 7 })))
      .toEqual({ outcome: 'refused', code: 'amount-invalid' });
  });

  it('refuses a create with no service type: Odoo requires one', () => {
    expect(buildEquipmentBody('vehicle-service', { ...service, service_type_id: undefined }, create({ odooVehicleId: 7 })))
      .toEqual({ outcome: 'refused', code: 'service-type-required' });
  });
});

describe('toOdooDatetime', () => {
  it('stores naive UTC, whatever offset the client sent', () => {
    expect(toOdooDatetime('2026-11-10T08:00:00+07:00')).toBe('2026-11-10 01:00:00');
    expect(toOdooDatetime('2026-11-10T01:00:00Z')).toBe('2026-11-10 01:00:00');
    expect(toOdooDatetime('2026-11-10 01:00:00')).toBe('2026-11-10 01:00:00');
    expect(toOdooDatetime('not a date')).toBeNull();
    expect(toOdooDatetime(undefined)).toBeNull();
  });
});
