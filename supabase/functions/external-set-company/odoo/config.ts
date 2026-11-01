/**
 * The map-once verbs (#1504 S7, FR-ODC-061/090/091, AC-ODC-096): `propose-config` reads this org's mirror and proposes the account
 * defaults, the unit map and the default warehouse in one pass; `save-defaults` writes whatever the admin accepted, one
 * `set_odoo_org_config` call per key with the whole merged object. Admin and Finance only; Odoo is never called.
 */
import { DEFAULT_TYPES, proposeOdooConfig, type ConfigMaster } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/configProposal.ts';
import { odooError, type OdooCtx } from './router.ts';

const ODOO_ID = /^[0-9]{1,9}$/;
/** ponytail: one bounded read per kind; a chart of accounts past this is read in part and the screen says nothing is missing. Page it when a real org nears it. */
const MIRROR_LIMIT = 5000;
const ACCOUNT_TYPES = [...new Set(Object.values(DEFAULT_TYPES).flat())];
const MAP_KEYS = ['account_defaults', 'unit_map'] as const;

type Row = ConfigMaster & { code: string | null };
const liveRows = async (c: OdooCtx, kind: string): Promise<Row[]> => {
  let q = c.sc.from('external_master_records').select('external_id, code, name, attrs, active, tombstoned_at')
    .eq('org_id', c.orgId).eq('external_tier', 'odoo').eq('kind', kind).eq('active', true).is('tombstoned_at', null);
  if (kind === 'account') q = q.in('attrs->>account_type', ACCOUNT_TYPES);
  const { data, error } = await q.order('name').limit(MIRROR_LIMIT);
  if (error) throw error;
  return (data ?? []) as Row[];
};
const asMap = (v: unknown): Record<string, string> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {});

async function readConfig(c: OdooCtx): Promise<Record<string, unknown>> {
  const { data, error } = await c.sc.from('external_org_bindings').select('config').eq('org_id', c.orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error) throw error;
  return (data?.config ?? {}) as Record<string, unknown>;
}

export async function proposeConfig(c: OdooCtx): Promise<Response> {
  try {
    const [config, accounts, uoms, warehouses, units] = await Promise.all([
      readConfig(c), liveRows(c, 'account'), liveRows(c, 'uom'), liveRows(c, 'warehouse'), c.sc.rpc('odoo_pmo_units', { p_org_id: c.orgId }),
    ]);
    if (units.error) throw units.error;
    const pmoUnits = (units.data ?? []) as string[];
    const current = {
      account_defaults: asMap(config.account_defaults), unit_map: asMap(config.unit_map),
      default_warehouse_id: typeof config.default_warehouse_id === 'string' ? config.default_warehouse_id : null,
    };
    // A saved value that is no longer a live record of its kind needs a person's attention (FR-ODC-080, AC-ODC-070).
    const ids = (rows: Row[]) => new Set(rows.map((r) => r.external_id));
    const [liveAccounts, liveUoms, liveWarehouses] = [ids(accounts), ids(uoms), ids(warehouses)];
    const attention = [
      ...Object.entries(current.account_defaults).filter(([, id]) => !liveAccounts.has(id)).map(([k]) => `account_defaults.${k}`),
      ...Object.entries(current.unit_map).filter(([, id]) => !liveUoms.has(id)).map(([k]) => `unit_map.${k}`),
      ...(current.default_warehouse_id && !liveWarehouses.has(current.default_warehouse_id) ? ['default_warehouse_id'] : []),
    ];
    return c.respond({
      proposals: proposeOdooConfig({ accounts, uoms, warehouses, pmoUnits }),
      accounts: accounts.map((a) => ({ id: a.external_id, code: a.code, name: a.name, type: a.attrs.account_type })),
      uoms: uoms.map((u) => ({ id: u.external_id, name: u.name })),
      warehouses: warehouses.map((w) => ({ id: w.external_id, code: w.code, name: w.name })),
      units: pmoUnits.map((unit) => ({ unit, mapped: Boolean(current.unit_map[unit]) })),
      current, attention,
    });
  } catch {
    return odooError(c, 'The proposal could not be read', 'STORE_FAILED', 500);
  }
}

const isIdMap = (v: unknown): v is Record<string, string> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.entries(v as object).every(([k, id]) => k.length > 0 && typeof id === 'string' && ODOO_ID.test(id));

export async function saveDefaults(c: OdooCtx): Promise<Response> {
  const writes: Array<[string, unknown]> = [];
  for (const key of MAP_KEYS) if (key in c.body) {
    if (!isIdMap(c.body[key])) return odooError(c, `${key} must map names to Odoo ids`, 'BAD_REQUEST', 400);
    writes.push([key, c.body[key]]);
  }
  if ('default_warehouse_id' in c.body) {
    const id = c.body.default_warehouse_id;
    if (typeof id !== 'string' || !ODOO_ID.test(id)) return odooError(c, 'default_warehouse_id must be an Odoo id', 'BAD_REQUEST', 400);
    writes.push(['default_warehouse_id', id]);
  }
  if (writes.length === 0) return odooError(c, 'Nothing to save', 'BAD_REQUEST', 400);
  let config: Record<string, unknown>;
  try { config = await readConfig(c); } catch { return odooError(c, 'The current settings could not be read', 'STORE_FAILED', 500); }
  const saved: string[] = [];
  for (const [key, value] of writes) {
    // The merge lives here, not in SQL: the RPC writes exactly what it is given, after checking every id.
    const whole = (MAP_KEYS as readonly string[]).includes(key) ? { ...asMap(config[key]), ...(value as Record<string, string>) } : value;
    const { error } = await c.sc.rpc('set_odoo_org_config', { p_org_id: c.orgId, p_actor_id: c.userId, p_key: key, p_value: whole });
    if (error) {
      const [status, code, message] = error.code === '42501' ? [403, 'FORBIDDEN', 'Not allowed for your role']
        : error.code === 'P0001' ? [409, 'REFUSED', error.message ?? 'The request was refused']
        : error.code === '22023' ? [400, 'BAD_REQUEST', error.message ?? 'The request was not valid']
        : [500, 'STORE_FAILED', 'The settings could not be saved'] as const;
      return c.respond({ error: code, message, saved }, status as number);
    }
    saved.push(key);
  }
  return c.respond({ saved });
}
