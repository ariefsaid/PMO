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
  'product.product': ['default_code', 'name', 'uom_id', 'purchase_ok', 'sale_ok', 'is_storable', 'company_id', 'active', 'write_date'],
  'uom.uom': ['name', 'relative_factor', 'relative_uom_id', 'active', 'write_date'],
  'stock.warehouse': ['name', 'code', 'lot_stock_id', 'view_location_id', 'company_id', 'active', 'write_date'],
  'stock.location': ['complete_name', 'usage', 'location_id', 'warehouse_id', 'company_id', 'active', 'write_date'],
  'account.account': ['code', 'name', 'account_type', 'company_ids', 'active', 'write_date'],
  'account.tax': ['name', 'amount', 'type_tax_use', 'company_id', 'active', 'write_date'],
  'account.analytic.plan': ['name', 'write_date'],
  'account.analytic.account': ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'],
};

/** Presence only, so O2..O8 read the snapshot instead of probing again. */
export const LATER_MODELS = ['purchase.order', 'account.move', 'stock.picking', 'stock.move', 'account.analytic.line', 'fleet.vehicle', 'maintenance.equipment'] as const;

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

export async function discoverCapabilities(call: OdooCall, ctx: { versionMajor: number | null; now: Date }): Promise<CapabilitySnapshot> {
  const models: Record<string, ModelProbe> = {};
  for (const [model, fields] of Object.entries(O1_MODELS)) models[model] = await probeModel(call, model, fields, true);
  const later: Record<string, boolean> = {};
  for (const model of LATER_MODELS) later[model] = (await probeModel(call, model, [], false)).exists;

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
  return { observed_at: ctx.now.toISOString(), version_major: ctx.versionMajor, untested_version: v.ok && v.untested, companies, models, later, missing };
}
