/**
 * Capability discovery and the version policy (FR-ODC-020..023, AC-ODC-010..012). Stock JSON-2 only: the model and field
 * directories (`ir.model`, `ir.model.fields`) in one read each, then `has_access` per model and operation (bed T3:
 * `check_access_rights` is gone in 20); never the installed-modules model (FR-ODC-020).
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
 * The fleet and maintenance models (assets/kinds.ts, bed claims V-OFM-1..10) plus the anchor model — field names as
 * Odoo 20 has them (#2174). Probed apart from O1_MODELS so an org with no fleet app is recorded as absent, never degraded
 * (FR-OFM-011). Keep the first key `fleet.vehicle`: `equipmentCapabilityGap` walks this order and fails closed on it.
 */
export const ASSET_MODELS: Record<string, readonly string[]> = {
  'fleet.vehicle': ['name', 'license_plate', 'vin_sn', 'model_id', 'driver_id', 'odometer', 'odometer_unit', 'acquisition_date', 'company_id', 'active', 'write_date'],
  'fleet.vehicle.model': ['name', 'brand_id', 'company_id', 'write_date'],
  // `location_id` is a stock.location reference (stock_maintenance, auto-installed beside stock + maintenance); Odoo 20 has no
  // free-text `location` (#2174).
  'maintenance.equipment': ['name', 'serial_no', 'category_id', 'model', 'location_id', 'company_id', 'active', 'write_date'],
  // Odoo 20's request has no `request_date` and no archive flag: the raise date is `create_date`, "finished" is `state` (#2174).
  'maintenance.request': ['name', 'equipment_id', 'maintenance_type', 'stage_id', 'create_date', 'schedule_date', 'schedule_end', 'close_date', 'state', 'duration', 'priority', 'description', 'company_id', 'write_date'],
  // A stage carries no `done` flag in Odoo 20 (#2174).
  'maintenance.stage': ['name', 'sequence', 'write_date'],
  // The service day is `date_from` in Odoo 20 (`date_to` ends a multi-day job) (#2174).
  'fleet.vehicle.log.services': ['vehicle_id', 'service_type_id', 'date_from', 'state', 'amount', 'odometer', 'vendor_id', 'description', 'notes', 'company_id', 'active', 'write_date'],
  'fleet.service.type': ['name', 'category', 'write_date'],
  'ir.model.data': ['module', 'name', 'model', 'res_id'],
};

/** A send declared supported needs `create` on its model; without it the connection is degraded with the reason. */
const SEND_MODELS = { 'party.send': 'res.partner', 'project.send': 'account.analytic.account', 'item.send': 'product.product' } as const;

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
  missing: string[];
}

/** Which of `models` exist and which of their fields: two directory reads, whatever the model count (#2118). */
async function readDirectory(call: OdooCall, models: readonly string[], fieldsOf: Record<string, readonly string[]>): Promise<Map<string, Set<string>>> {
  const present = await call<Array<{ model: string }>>('ir.model', 'search_read', { domain: [['model', 'in', [...models]]], fields: ['model'] });
  const found = new Map(present.map(({ model }) => [model, new Set<string>()]));
  const wanted = [...found.keys()].filter((m) => fieldsOf[m]?.length);
  if (wanted.length) {
    const names = [...new Set(wanted.flatMap((m) => fieldsOf[m]))];
    const rows = await call<Array<{ model: string; name: string }>>('ir.model.fields', 'search_read', { domain: [['model', 'in', wanted], ['name', 'in', names]], fields: ['model', 'name'] });
    for (const { model, name } of rows) found.get(model)?.add(name);
  }
  return found;
}

/**
 * Run the access checks one at a time, or together when the caller says the host takes parallel requests. Odoo Online
 * never does (#1767): serial is the default, and a caller sets `parallel` only for a self-hosted deployment.
 */
const runAll = async <T>(tasks: Array<() => Promise<T>>, parallel: boolean): Promise<T[]> => {
  if (parallel) return Promise.all(tasks.map((t) => t()));
  const out: T[] = [];
  for (const t of tasks) out.push(await t());
  return out;
};

/** Discovery's whole-run budget: well inside the edge function's 150 s limit, so a slow Odoo is a `timeout`, not a 504. */
export const DISCOVERY_BUDGET_MS = 110_000;

export async function discoverCapabilities(
  rawCall: OdooCall,
  ctx: { versionMajor: number | null; now: Date; deadlineAt?: number; parallel?: boolean },
): Promise<CapabilitySnapshot> {
  const call: OdooCall = (model, method, body) => {
    if (ctx.deadlineAt !== undefined && Date.now() > ctx.deadlineAt) throw new OdooError('timeout');
    return rawCall(model, method, body);
  };
  // A directory read the key cannot make is a connection failure (it throws), never "every model missing".
  const fieldsOf: Record<string, readonly string[]> = { ...O1_MODELS, ...ASSET_MODELS };
  const directory = await readDirectory(call, [...Object.keys(O1_MODELS), ...LATER_MODELS, ...Object.keys(ASSET_MODELS)], fieldsOf);
  // An access-check failure other than a refusal is a connection failure too, so it is not swallowed.
  const access = (model: string, op: (typeof OPERATIONS)[number]) => async () => (await call<boolean>(model, 'has_access', { operation: op })) === true;
  const probe = async (group: Record<string, readonly string[]>): Promise<Record<string, ModelProbe>> => {
    const entries = Object.entries(group);
    const checks = entries.flatMap(([model]) => (directory.has(model) ? OPERATIONS.map((op) => access(model, op)) : []));
    const results = await runAll(checks, ctx.parallel === true);
    let i = 0;
    return Object.fromEntries(entries.map(([model, fields]): [string, ModelProbe] => {
      const got = directory.get(model);
      if (!got) return [model, { exists: false, read: false, create: false, write: false, unlink: false, fields_missing: [...fields] }];
      const [read, create, write, unlink] = results.slice(i, (i += OPERATIONS.length));
      return [model, { exists: true, read, create, write, unlink, fields_missing: fields.filter((f) => !got.has(f)) }];
    }));
  };
  const models = await probe(O1_MODELS);
  const laterPresent = LATER_MODELS.filter((m) => directory.has(m));
  const laterRead = await runAll(laterPresent.map((m) => access(m, 'read')), ctx.parallel === true);
  const later: Record<string, boolean> = Object.fromEntries(LATER_MODELS.map((m) => [m, laterRead[laterPresent.indexOf(m)] === true]));
  const assets = await probe(ASSET_MODELS);

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
  return { observed_at: ctx.now.toISOString(), version_major: ctx.versionMajor, untested_version: v.ok && v.untested, companies, models, later, assets, missing };
}
