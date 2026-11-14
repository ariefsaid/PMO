/**
 * The Odoo request bodies for the fleet and maintenance register (FR-OFM-030/031, AC-OFM-030/031; plan 2026-11-09
 * §F4-T2). Pure: a command's PMO shape in, one `create`/`write` body out, or a named refusal — never a guess, never a
 * partial body. Odoo 20 model and field names only (NFR-OFM-001, bed claims V-OFM-1..10, #2174); they live here and in `kinds.ts`.
 *
 * A CREATE sends the whole mapped body plus the Odoo company. An UPDATE is a PATCH built from the keys the record
 * actually carries, so an edit of one field never blanks the others, and it never carries the company (an asset does not
 * move between Odoo companies through a PMO edit).
 */
import { AdapterError } from '../../contract.ts';
import type { EquipmentCommandKind } from './kinds.ts';

export type { EquipmentCommandKind };

export interface EquipmentBodyCtx {
  operation: 'create' | 'update';
  /** The Odoo company every created record belongs to (`res.company` id from the connection). */
  companyId: number;
  /** The linked Odoo `maintenance.equipment` id a request hangs off — resolved by the dispatch from the PMO link, never the client. */
  odooEquipmentId?: number;
  /** The linked Odoo `fleet.vehicle` id a service log hangs off. */
  odooVehicleId?: number;
}

export type EquipmentBodyResult =
  | { outcome: 'ready'; body: Record<string, unknown> }
  | { outcome: 'refused'; code: string };

const refuse = (code: string): EquipmentBodyResult => ({ outcome: 'refused', code });
const present = (r: Record<string, unknown>, key: string): boolean => r[key] !== undefined && r[key] !== null;

/** Odoo stores naive UTC `YYYY-MM-DD HH:MM:SS`; a value it cannot read is a refusal, never a guess. */
export function toOdooDatetime(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();
  // Odoo's own naive form is already UTC; `Date.parse` would read it as local time.
  const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  const ms = naive ? Date.parse(`${naive[1]}-${naive[2]}-${naive[3]}T${naive[4]}:${naive[5]}:${naive[6]}Z`) : Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** A naive UTC Odoo datetime moved forward by a duration in hours, in the same shape (`schedule_end`). */
function addHours(naive: string, hours: number): string {
  const start = Date.parse(`${naive.replace(' ', 'T')}Z`);
  return new Date(start + Math.round(hours * 3_600_000)).toISOString().slice(0, 19).replace('T', ' ');
}

/** A calendar date (`YYYY-MM-DD`), passed through when it already is one. */
function toOdooDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/** Odoo's editor reads html: escape the five characters that would otherwise become markup, keep the line breaks. */
function toOdooHtml(notes: string): string {
  const escaped = notes
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
  return `<p>${escaped}</p>`;
}

/** A positive Odoo id from the record's string form, or null. */
function odooId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A finite, non-negative number (a duration, a cost, an odometer reading), or null. */
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

const text = (value: unknown): string => String(value).trim();

function registerVehicle(record: Record<string, unknown>, ctx: EquipmentBodyCtx): EquipmentBodyResult {
  const body: Record<string, unknown> = {};
  if (present(record, 'license_plate')) body.license_plate = text(record.license_plate);
  if (present(record, 'model_id')) {
    const modelId = odooId(record.model_id);
    if (modelId === null) return refuse('vehicle-model-required');
    body.model_id = modelId;
  } else if (ctx.operation === 'create') return refuse('vehicle-model-required');
  if (present(record, 'vin')) body.vin_sn = text(record.vin);
  if (present(record, 'acquisition_date')) {
    const acquired = toOdooDate(record.acquisition_date);
    if (acquired === null) return refuse('date-invalid');
    body.acquisition_date = acquired;
  }
  if (present(record, 'active')) body.active = record.active === true;
  if (ctx.operation === 'create') body.company_id = ctx.companyId;
  return { outcome: 'ready', body };
}

function registerEquipment(record: Record<string, unknown>, ctx: EquipmentBodyCtx): EquipmentBodyResult {
  const body: Record<string, unknown> = {};
  if (present(record, 'name')) {
    if (text(record.name) === '') return refuse('name-required');
    body.name = text(record.name);
  } else if (ctx.operation === 'create') return refuse('name-required');
  if (present(record, 'serial_no')) body.serial_no = text(record.serial_no);
  if (present(record, 'model')) body.model = text(record.model);
  // #2174: Odoo 20 dropped the free-text `location`; the only place an equipment carries is `location_id`, a `stock.location`
  // reference PMO has no picker for — so a typed location is never sent (it stays PMO-side), rather than guessed.
  if (present(record, 'active')) body.active = record.active === true;
  if (ctx.operation === 'create') body.company_id = ctx.companyId;
  return { outcome: 'ready', body };
}

const MAINTENANCE_TYPES = ['corrective', 'preventive'] as const;
/** Odoo 20's request state and the one that marks it finished (`MaintenanceRequest.state`, #2174). */
const REQUEST_STATES = ['normal', 'changes_requested', 'approved', 'done', 'cancelled'] as const;

function maintenanceRequest(record: Record<string, unknown>, ctx: EquipmentBodyCtx): EquipmentBodyResult {
  const body: Record<string, unknown> = {};
  if (ctx.operation === 'create') {
    // Odoo requires a name on a request: a create without one is refused HERE, before any outbox row, rather than by Odoo afterwards.
    const subject = present(record, 'subject') ? text(record.subject) : '';
    if (subject === '') return refuse('name-required');
    body.name = subject;
    const equipmentId = ctx.odooEquipmentId;
    if (equipmentId === undefined) return refuse('equipment-not-linked');
    body.equipment_id = equipmentId;
  }
  if (present(record, 'type')) {
    const type = String(record.type);
    if (!(MAINTENANCE_TYPES as readonly string[]).includes(type)) return refuse('maintenance-type-invalid');
    body.maintenance_type = type;
  }
  if (present(record, 'stage_id')) {
    const stageId = odooId(record.stage_id);
    if (stageId === null) return refuse('stage-invalid');
    body.stage_id = stageId;
  }
  // #2174: Odoo 20 marks a request finished with `state = done` (its own write also sets `close_date`); no stage carries
  // that meaning any more, so PMO says "done" here when the form marks the request finished.
  if (present(record, 'state')) {
    const state = String(record.state);
    if (!(REQUEST_STATES as readonly string[]).includes(state)) return refuse('request-state-invalid');
    body.state = state;
  }
  const scheduled = present(record, 'schedule_date') ? toOdooDatetime(record.schedule_date) : null;
  if (present(record, 'schedule_date') && scheduled === null) return refuse('date-invalid');
  if (present(record, 'duration_hours')) {
    const duration = amount(record.duration_hours);
    if (duration === null) return refuse('duration-invalid');
    // #2174: Odoo 20 COMPUTES `duration` from `schedule_date`..`schedule_end` (`MaintenanceRequest._compute_duration`), and
    // derives a missing end as start + 1 h (`_compute_schedule_end`) — so a `duration` PMO sent alone landed as 1 h. Send the
    // window the duration implies instead; a duration with no start has no window to express it, so it is refused here.
    if (scheduled === null) return refuse('schedule-date-required');
    body.schedule_date = scheduled;
    body.schedule_end = addHours(scheduled, duration);
  } else if (scheduled !== null) {
    body.schedule_date = scheduled;
  }
  if (present(record, 'notes')) {
    const notes = String(record.notes);
    if (notes.length > 2000) return refuse('notes-too-long');
    body.description = toOdooHtml(notes);
  }
  if (ctx.operation === 'create') body.company_id = ctx.companyId;
  return { outcome: 'ready', body };
}

const SERVICE_STATES = ['new', 'running', 'done', 'cancelled'] as const;

function vehicleService(record: Record<string, unknown>, ctx: EquipmentBodyCtx): EquipmentBodyResult {
  const body: Record<string, unknown> = {};
  if (ctx.operation === 'create') {
    const vehicleId = ctx.odooVehicleId;
    if (vehicleId === undefined) return refuse('equipment-not-linked');
    body.vehicle_id = vehicleId;
  }
  if (present(record, 'service_type_id')) {
    const typeId = odooId(record.service_type_id);
    if (typeId === null) return refuse('service-type-required');
    body.service_type_id = typeId;
  } else if (ctx.operation === 'create') return refuse('service-type-required');
  // #2174: Odoo 20 names the service day `date_from` ("Start of Service"); the PMO form's own key stays `date`.
  if (present(record, 'date')) {
    const date = toOdooDate(record.date);
    if (date === null) return refuse('date-invalid');
    body.date_from = date;
  }
  if (present(record, 'state')) {
    const state = String(record.state);
    if (!(SERVICE_STATES as readonly string[]).includes(state)) return refuse('service-state-invalid');
    body.state = state;
  }
  if (present(record, 'amount')) {
    const cost = amount(record.amount);
    if (cost === null) return refuse('amount-invalid');
    body.amount = cost;
  }
  if (present(record, 'odometer')) {
    const odometer = amount(record.odometer);
    if (odometer === null) return refuse('odometer-invalid');
    body.odometer = odometer;
  }
  if (present(record, 'notes')) body.notes = String(record.notes);
  if (present(record, 'vendor_id')) {
    const vendorId = odooId(record.vendor_id);
    if (vendorId === null) return refuse('vendor-invalid');
    body.vendor_id = vendorId;
  }
  if (ctx.operation === 'create') body.company_id = ctx.companyId;
  return { outcome: 'ready', body };
}

/** The `create`/`write` body for one register or maintenance command, or the reason it is refused before any write. */
export function buildEquipmentBody(kind: EquipmentCommandKind, record: Record<string, unknown>, ctx: EquipmentBodyCtx): EquipmentBodyResult {
  switch (kind) {
    case 'register-vehicle': return registerVehicle(record, ctx);
    case 'register-equipment': return registerEquipment(record, ctx);
    case 'maintenance-request': return maintenanceRequest(record, ctx);
    case 'vehicle-service': return vehicleService(record, ctx);
    default: throw new AdapterError('commit-rejected', `unsupported equipment kind ${String(kind)}`);
  }
}
