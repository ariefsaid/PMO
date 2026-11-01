/** Odoo repository (#1504 S5): the directory mirror read and the connection read. The browser never talks to Odoo; setup verbs go through `external-set-company`. */
import { supabase } from '@/src/lib/supabase/client';
import { wrap } from './repositoryErrors';
import { erpSetupRequest } from './integrations';
import { SENDS_FINISHED_KEY, type ConnectionRecord } from '@/src/lib/adapterSeam/odoo/connectionState';
import type { ConfigProposal } from '@/src/lib/adapterSeam/odoo/configProposal';

export interface MasterRecord { id: string; external_id: string; code: string | null; name: string; parent_external_id: string | null; active: boolean; tombstoned_at: string | null; attrs: Record<string, unknown>; as_of: string }
export type DirectoryKind = 'product' | 'uom' | 'warehouse' | 'location' | 'account' | 'tax' | 'analytic_account';
export interface ListMasterInput { kind: DirectoryKind; search?: string; page: number; pageSize: number; purpose?: 'purchase' | 'sale'; includeInactive?: boolean;
  /** Only these records (units for the visible rows). */ externalIds?: string[];
  /** Only locations of these warehouses. */ warehouseIds?: string[] }
export interface OdooConnectionRead {
  status: string;
  activated: boolean;
  connection: ConnectionRecord | null;
  capabilities: { missing?: string[]; version_major?: number } | null;
  config: Record<string, unknown>;
}

/** What `propose-config` returns (FR-ODC-061/090): proposals over this org's mirror, the records to choose from, and what is saved now. */
export interface OdooConfigProposalRead {
  proposals: ConfigProposal[];
  accounts: Array<{ id: string; code: string | null; name: string; type: string | null }>;
  uoms: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; code: string | null; name: string }>;
  units: Array<{ unit: string; mapped: boolean }>;
  current: { account_defaults: Record<string, string>; unit_map: Record<string, string>; default_warehouse_id: string | null };
  /** Saved settings (`account_defaults.bank`, `unit_map.m`, `default_warehouse_id`) whose Odoo record is no longer active. */
  attention: string[];
}
/** What `list-projects` returns for tier odoo. With no plan chosen it offers the plans and no accounts. */
export interface OdooProjectLinksRead {
  planId: number | null;
  plans?: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; code: string | null; name: string }>;
  truncated?: boolean;
  linked: Array<{ projectId: string; accountId: string; attention: string | null }>;
}
export interface SaveDefaultsInput { account_defaults?: Record<string, string>; unit_map?: Record<string, string>; default_warehouse_id?: string }

// ilike pattern inside a double-quoted PostgREST value: commas and parens are then literal. LIKE wildcards get a `\` escape, then `\` and `"` are escaped for the quoting.
const likeAny = (s: string) => `"%${s.replace(/[\\%_]/g, '\\$&').replace(/[\\"]/g, '\\$&')}%"`;

const CONFIG_KEYS = ['database', 'odoo_company_name', 'key_expires_on', 'account_defaults', 'unit_map', 'default_warehouse_id', SENDS_FINISHED_KEY];

export const odooRepository = {
  listMasterRecords: (input: ListMasterInput) => wrap(async () => {
    let q = supabase.from('external_master_records').select('id,external_id,code,name,parent_external_id,active,tombstoned_at,attrs,as_of', { count: 'exact' })
      .eq('external_tier', 'odoo').eq('kind', input.kind);
    if (input.search) q = q.or(`name.ilike.${likeAny(input.search)},code.ilike.${likeAny(input.search)}`);
    if (input.externalIds) q = q.in('external_id', input.externalIds);
    if (input.warehouseIds) q = q.in('attrs->>warehouse_id', input.warehouseIds);
    if (input.purpose) q = q.eq(input.purpose === 'purchase' ? 'attrs->>purchasable' : 'attrs->>sellable', 'true');
    if (!input.includeInactive) q = q.eq('active', true).is('tombstoned_at', null);
    const from = (input.page - 1) * input.pageSize;
    const { data, error, count } = await q.order('name').range(from, from + input.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as MasterRecord[], total: count ?? 0 };
  }),
  /** The counts and freshness the directory header shows: rows hidden by default (inactive, deleted in Odoo) and the newest sync time. */
  masterSummary: (kind: DirectoryKind) => wrap(async () => {
    const base = () => supabase.from('external_master_records').select('as_of', { count: 'exact', head: true }).eq('external_tier', 'odoo').eq('kind', kind);
    const [inactive, tombstoned, newest] = await Promise.all([
      base().eq('active', false),
      base().not('tombstoned_at', 'is', null),
      supabase.from('external_master_records').select('as_of').eq('external_tier', 'odoo').eq('kind', kind).order('as_of', { ascending: false }).limit(1),
    ]);
    for (const r of [inactive, tombstoned, newest]) if (r.error) throw r.error;
    return { inactive: inactive.count ?? 0, tombstoned: tombstoned.count ?? 0, asOf: (newest.data?.[0]?.as_of ?? null) as string | null };
  }),
  getConnection: () => wrap(async (): Promise<OdooConnectionRead> => {
    const { data, error } = await supabase.from('external_org_bindings').select('status,activated_at,config').eq('external_tier', 'odoo').maybeSingle();
    if (error) throw error;
    const raw = (data?.config ?? {}) as Record<string, unknown>;
    // Only what the UI reads; the rest of `config` (e.g. a previous key's vault name during rotation) stays out of the client cache.
    const config = Object.fromEntries(CONFIG_KEYS.filter((k) => k in raw).map((k) => [k, raw[k]]));
    return {
      status: data?.status ?? 'disconnected',
      activated: !!data?.activated_at,
      connection: (raw.connection ?? null) as ConnectionRecord | null,
      capabilities: (raw.capabilities ?? null) as OdooConnectionRead['capabilities'],
      config,
    };
  }),
  setup: <T>(setupAction: string, input: Record<string, unknown> = {}) => erpSetupRequest<T>(setupAction, input, 'odoo'),
};
export type OdooRepository = typeof odooRepository;
