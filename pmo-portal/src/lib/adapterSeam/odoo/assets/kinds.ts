/**
 * The Odoo fleet and maintenance kinds the sweep mirrors for an org that employs `equipment` (FR-OFM-010, AC-OFM-010).
 * Stock field names, per the bed claims V-OFM-1..8 (plan 2026-11-09-odoo-fleet-maintenance §4). They live apart from
 * `KIND_SPECS` because discovery checks these models in its own `assets` block, which never degrades the connection of
 * an org that has no fleet app.
 */
import { base, m2o, m2oName, str, withAttrs, type KindSpec } from '../kinds.ts';

/** Sweep order: pickers before the rows that reference them. */
export const ASSET_KINDS = ['vehicle_model', 'vehicle', 'equipment', 'maintenance_stage', 'maintenance_request', 'service_type', 'vehicle_service'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** The PMO domain the register and its maintenance write through (D5). */
export const EQUIPMENT_DOMAIN = 'equipment';

/**
 * The command kinds a register or maintenance write names (`record.erp_doc_kind`) and the domain each belongs to — the dispatch's
 * kind→domain check reads this beside `KIND_DOMAIN` (D5/D7). Register kinds are narrowed to Admin and Project Manager in
 * `adapter-dispatch/odooEquipment.ts`; the role map is the maintenance one (D7).
 */
export const EQUIPMENT_KIND_DOMAIN = {
  'register-vehicle': EQUIPMENT_DOMAIN,
  'register-equipment': EQUIPMENT_DOMAIN,
  'maintenance-request': EQUIPMENT_DOMAIN,
  'vehicle-service': EQUIPMENT_DOMAIN,
} as const;
export type EquipmentCommandKind = keyof typeof EQUIPMENT_KIND_DOMAIN;

/** The mirror kind a command's Odoo record lands under (`external_master_records.kind`). */
export const EQUIPMENT_MIRROR_KIND: Record<EquipmentCommandKind, AssetKind> = {
  'register-vehicle': 'vehicle',
  'register-equipment': 'equipment',
  'maintenance-request': 'maintenance_request',
  'vehicle-service': 'vehicle_service',
};

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Odoo's editor html to plain text. `ponytail:` five entities only; the editor emits no others. */
export function htmlToText(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  const text = v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
  return text === '' ? null : text;
}

export const ASSET_KIND_SPECS: Record<AssetKind, KindSpec> = {
  vehicle_model: { model: 'fleet.vehicle.model', fields: ['name', 'brand_id', 'write_date'], company: null,
    parse: (r) => withAttrs(base(r, r.name, null, false), { brand: m2oName(r.brand_id) }) },
  vehicle: { model: 'fleet.vehicle', fields: ['name', 'license_plate', 'vin_sn', 'model_id', 'driver_id', 'odometer', 'odometer_unit', 'acquisition_date', 'active', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, r.name, r.license_plate, false), { model_id: m2o(r.model_id), model_name: m2oName(r.model_id), vin: str(r.vin_sn), driver_name: m2oName(r.driver_id), odometer: num(r.odometer), odometer_unit: str(r.odometer_unit), acquisition_date: str(r.acquisition_date) }) },
  equipment: { model: 'maintenance.equipment', fields: ['name', 'serial_no', 'category_id', 'model', 'location', 'active', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, r.name, r.serial_no, false), { category: m2oName(r.category_id), model: str(r.model), location: str(r.location) }) },
  maintenance_stage: { model: 'maintenance.stage', fields: ['name', 'sequence', 'done', 'write_date'], company: null,
    parse: (r) => (typeof r.sequence !== 'number' ? null : withAttrs(base(r, r.name, null, false), { sequence: r.sequence, done: r.done === true })) },
  // A request has no `active`; Odoo archives it with `archive`, which reads back as inactive.
  maintenance_request: { model: 'maintenance.request', fields: ['name', 'equipment_id', 'maintenance_type', 'stage_id', 'request_date', 'schedule_date', 'close_date', 'duration', 'priority', 'description', 'archive', 'write_date'], company: 'company_id',
    parse: (r) => {
      const row = withAttrs(base(r, r.name, null, r.equipment_id), { type: str(r.maintenance_type), stage_id: m2o(r.stage_id), stage_name: m2oName(r.stage_id), request_date: str(r.request_date), schedule_date: str(r.schedule_date), close_date: str(r.close_date), duration: num(r.duration), priority: str(r.priority), notes: htmlToText(r.description) });
      return row && { ...row, active: r.archive !== true };
    } },
  service_type: { model: 'fleet.service.type', fields: ['name', 'category', 'write_date'], company: null,
    parse: (r) => withAttrs(base(r, r.name, null, false), { category: str(r.category) }) },
  // The row's name is its service type, so a log with no type is rejected whole by `base`.
  vehicle_service: { model: 'fleet.vehicle.log.services', fields: ['vehicle_id', 'service_type_id', 'date', 'state', 'amount', 'odometer', 'vendor_id', 'description', 'notes', 'active', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, m2oName(r.service_type_id), null, r.vehicle_id), { service_type_id: m2o(r.service_type_id), date: str(r.date), state: str(r.state), amount: num(r.amount), odometer: num(r.odometer), vendor_name: m2oName(r.vendor_id), description: str(r.description), notes: str(r.notes) }) },
};
