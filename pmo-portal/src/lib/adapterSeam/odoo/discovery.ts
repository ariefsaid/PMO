/**
 * Capability discovery and the version policy (FR-ODC-020..023, AC-ODC-010..012). Stock JSON-2 only: `fields_get` and
 * `has_access` per model (bed T3: `check_access_rights` is gone in 20), never the installed-modules model (FR-ODC-020).
 */
import { OdooError, type OdooCall } from './client.ts';
import { ODOO_WORKFLOWS } from './workflowDeclarations.ts';

/** DD-ODC-8. Keep in step with MIN_ODOO_MAJOR (connect.ts) and activate_odoo_binding (0420). */
export const ODOO_TESTED_MAJORS: readonly number[] = [20];

export type VersionVerdict = { ok: true; untested: boolean } | { ok: false; reason: 'no-json2' | 'below-tested' };

export function versionPolicy(major: number | null, hasJson2: boolean): VersionVerdict {
  if (!hasJson2) return { ok: false, reason: 'no-json2' };
  if (major === null || major < Math.min(...ODOO_TESTED_MAJORS)) return { ok: false, reason: 'below-tested' };
  return { ok: true, untested: !ODOO_TESTED_MAJORS.includes(major) };
}

/** Every field O1 reads, per model (bed §4 and T3..T10). */
export const O1_MODELS: Record<string, readonly string[]> = {
  'res.company': ['name', 'currency_id', 'write_date'],
  'res.partner': ['name', 'vat', 'ref', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'company_id', 'write_date'],
  'product.product': ['default_code', 'name', 'uom_id', 'property_account_income_id', 'purchase_ok', 'sale_ok', 'is_storable', 'company_id', 'active', 'write_date'],
  'uom.uom': ['name', 'relative_factor', 'relative_uom_id', 'active', 'write_date'],
  'stock.warehouse': ['name', 'code', 'lot_stock_id', 'view_location_id', 'company_id', 'active', 'write_date'],
  'stock.location': ['complete_name', 'usage', 'location_id', 'warehouse_id', 'company_id', 'active', 'write_date'],
  'account.account': ['code', 'name', 'account_type', 'company_ids', 'active', 'write_date'],
  'account.tax': ['name', 'amount', 'type_tax_use', 'tax_group_id', 'price_include', 'company_id', 'active', 'write_date'],
  'account.analytic.plan': ['name', 'write_date'],
  'account.analytic.account': ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'],
  'account.journal': ['name', 'code', 'type', 'company_id', 'active', 'write_date'],
};

/** Present and readable by the key, so O2..O8 read the snapshot instead of probing again. */
export const LATER_MODELS = ['purchase.order', 'purchase.order.line', 'account.move', 'account.move.line', 'account.payment', 'stock.picking', 'stock.move', 'account.analytic.line', 'fleet.vehicle', 'maintenance.equipment'] as const;

/**
 * The fleet and maintenance models (assets/kinds.ts, bed claims V-OFM-1..8) plus the anchor model. Probed apart from
 * O1_MODELS so an org with no fleet app is recorded as absent, never degraded (FR-OFM-011). Keep the first key
 * `fleet.vehicle`: `equipmentCapabilityGap` walks this order and fails closed on it.
 */
export const ASSET_MODELS: Record<string, readonly string[]> = {
  'fleet.vehicle': ['name', 'license_plate', 'vin_sn', 'model_id', 'driver_id', 'odometer', 'odometer_unit', 'acquisition_date', 'company_id', 'active', 'write_date'],
  'fleet.vehicle.model': ['name', 'brand_id', 'write_date'],
  'maintenance.equipment': ['name', 'serial_no', 'category_id', 'model', 'location', 'company_id', 'active', 'write_date'],
  'maintenance.request': ['name', 'equipment_id', 'maintenance_type', 'stage_id', 'request_date', 'schedule_date', 'close_date', 'duration', 'priority', 'description', 'company_id', 'archive', 'write_date'],
  'maintenance.stage': ['name', 'sequence', 'done', 'write_date'],
  'fleet.vehicle.log.services': ['vehicle_id', 'service_type_id', 'date', 'state', 'amount', 'odometer', 'vendor_id', 'description', 'notes', 'company_id', 'active', 'write_date'],
  'fleet.service.type': ['name', 'category', 'write_date'],
  'ir.model.data': ['module', 'name', 'model', 'res_id'],
};

/** A send declared supported needs `create` on its model; without it the connection is degraded with the reason. */
const SEND_MODELS = { 'party.send': 'res.partner', 'project.send': 'account.analytic.account', 'item.send': 'product.product' } as const;

/**
 * The labour models (labour/bodies.ts, labour/anchors.ts, V-OLH-1..13) plus the anchor model. Probed apart from O1_MODELS
 * so an Odoo without `hr_timesheet` is recorded as absent, never degraded (FR-OLH-001): a timesheet-less Odoo must not
 * degrade an org's connection. Keep the first key `hr.employee`: `labourCapabilityGap` walks this order and fails closed on it.
 */
export const LABOUR_MODELS: Record<string, readonly string[]> = {
  'hr.employee': ['name', 'work_email', 'active', 'write_date'],
  'account.analytic.line': ['name', 'date', 'unit_amount', 'amount', 'project_id', 'employee_id', 'account_id', 'company_id', 'write_date'],
  'account.move': ['name', 'move_type', 'state', 'journal_id', 'date', 'write_date'],
  'account.move.line': ['account_id', 'debit', 'credit', 'analytic_distribution', 'move_id', 'display_type', 'write_date'],
  'ir.model.data': ['module', 'name', 'model', 'res_id'],
};

const OPERATIONS = ['read', 'create', 'write', 'unlink'] as const;

export interface ModelProbe { exists: boolean; read: boolean; create: boolean; write: boolean; unlink: boolean; fields_missing: string[] }
export interface CapabilitySnapshot {
  observed_at: string;
  version_major: number | null;
  untested_version: boolean;
  companies: { id: number; name: string }[];
  models: Record<string, ModelProbe>;
  later: Record<string, boolean>;
  /** The fleet and maintenance models; absent on a snapshot taken before #1511. Never part of `missing`. */
  assets?: Record<string, ModelProbe>;
  /** The labour models (#1510); absent on a snapshot taken before it. Recorded, never part of `missing`. */
  labour?: Record<string, ModelProbe>;
  missing: string[];
}

const isMissingModel = (err: unknown) => err instanceof OdooError && err.errorClass === 'missing-model';

async function probeModel(call: OdooCall, model: string, fields: readonly string[], withAccess: boolean): Promise<ModelProbe> {
  let got: Record<string, unknown>;
  try {
    got = await call<Record<string, unknown>>(model, 'fields_get', { attributes: ['type'] });
  } catch (err) {
    if (isMissingModel(err)) return { exists: false, read: false, create: false, write: false, unlink: false, fields_missing: [...fields] };
    throw err; // transport and key failures feed the connection state, never "missing"
  }
  const access = { read: false, create: false, write: false, unlink: false };
  // An access-check failure other than a refusal is a connection failure too, so it is not swallowed.
  if (withAccess) for (const op of OPERATIONS) access[op] = (await call<boolean>(model, 'has_access', { operation: op })) === true;
  return { exists: true, ...access, fields_missing: fields.filter((f) => !(f in got)) };
}

/** Discovery's whole-run budget: well inside the edge function's 150 s limit, so a slow Odoo is a `timeout`, not a 504. */
export const DISCOVERY_BUDGET_MS = 110_000;

export async function discoverCapabilities(
  rawCall: OdooCall,
  ctx: { versionMajor: number | null; now: Date; deadlineAt?: number },
): Promise<CapabilitySnapshot> {
  const call: OdooCall = (model, method, body) => {
    if (ctx.deadlineAt !== undefined && Date.now() > ctx.deadlineAt) throw new OdooError('timeout');
    return rawCall(model, method, body);
  };
  const models: Record<string, ModelProbe> = {};
  for (const [model, fields] of Object.entries(O1_MODELS)) models[model] = await probeModel(call, model, fields, true);
  const later: Record<string, boolean> = {};
  for (const model of LATER_MODELS) {
    const p = await probeModel(call, model, [], false);
    later[model] = p.exists && (await call<boolean>(model, 'has_access', { operation: 'read' })) === true;
  }
  const assets: Record<string, ModelProbe> = {};
  for (const [model, fields] of Object.entries(ASSET_MODELS)) assets[model] = await probeModel(call, model, fields, true);
  const labour: Record<string, ModelProbe> = {};
  for (const [model, fields] of Object.entries(LABOUR_MODELS)) labour[model] = await probeModel(call, model, fields, true);

  const missing = Object.entries(models).flatMap(([m, p]) => (!p.exists ? [m] : !p.read ? [`${m}:read`] : p.fields_missing.map((f) => `${m}:${f}`)));
  for (const [workflow, model] of Object.entries(SEND_MODELS)) {
    const p = models[model];
    if (ODOO_WORKFLOWS[workflow as keyof typeof SEND_MODELS].status === 'supported' && p.exists && p.read && !p.create) missing.push(`${model}:create`);
  }
  // FR-ODC-090 / bed T10: PPN is rate 12 (and 11 for non-luxury goods); archived rows do not count.
  if (models['account.tax'].read && !models['account.tax'].fields_missing.length) {
    const ppn = await call<number>('account.tax', 'search_count', { domain: [['amount', 'in', [11, 12]], ['type_tax_use', 'in', ['purchase', 'sale']]] });
    if (!ppn) missing.push('l10n_id:ppn');
  }
  const companies = models['res.company'].read
    ? (await call<{ id: number; name: string }[]>('res.company', 'search_read', { domain: [], fields: ['id', 'name'] })).map(({ id, name }) => ({ id, name }))
    : [];
  const v = versionPolicy(ctx.versionMajor, true);
  return { observed_at: ctx.now.toISOString(), version_major: ctx.versionMajor, untested_version: v.ok && v.untested, companies, models, later, assets, labour, missing };
}
