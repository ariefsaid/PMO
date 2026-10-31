/** Odoo repository (#1504 S5): the directory mirror read and the connection read. The browser never talks to Odoo; setup verbs go through `external-set-company`. */
import { supabase } from '@/src/lib/supabase/client';
import { wrap } from './repositoryErrors';
import { erpSetupRequest } from './integrations';
import type { ConnectionRecord } from '@/src/lib/adapterSeam/odoo/connectionState';

export interface MasterRecord { id: string; external_id: string; code: string | null; name: string; parent_external_id: string | null; active: boolean; tombstoned_at: string | null; attrs: Record<string, unknown>; as_of: string }
export type DirectoryKind = 'product' | 'uom' | 'warehouse' | 'location' | 'account' | 'tax' | 'analytic_account';
export interface ListMasterInput { kind: DirectoryKind; search?: string; page: number; pageSize: number; purpose?: 'purchase' | 'sale'; includeInactive?: boolean }
export interface OdooConnectionRead {
  status: string;
  activated: boolean;
  connection: ConnectionRecord | null;
  capabilities: { missing?: string[]; version_major?: number } | null;
  config: Record<string, unknown>;
}

const escapeFilter = (s: string) => s.replace(/[%_,()\\]/g, (ch) => `\\${ch}`);

export const odooRepository = {
  listMasterRecords: (input: ListMasterInput) => wrap(async () => {
    let q = supabase.from('external_master_records').select('id,external_id,code,name,parent_external_id,active,tombstoned_at,attrs,as_of', { count: 'exact' })
      .eq('external_tier', 'odoo').eq('kind', input.kind);
    if (input.search) q = q.or(`name.ilike.%${escapeFilter(input.search)}%,code.ilike.%${escapeFilter(input.search)}%`);
    if (input.purpose) q = q.eq(input.purpose === 'purchase' ? 'attrs->>purchasable' : 'attrs->>sellable', 'true');
    if (!input.includeInactive) q = q.eq('active', true).is('tombstoned_at', null);
    const from = (input.page - 1) * input.pageSize;
    const { data, error, count } = await q.order('name').range(from, from + input.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as MasterRecord[], total: count ?? 0 };
  }),
  getConnection: () => wrap(async (): Promise<OdooConnectionRead> => {
    const { data, error } = await supabase.from('external_org_bindings').select('status,activated_at,config').eq('external_tier', 'odoo').maybeSingle();
    if (error) throw error;
    const config = (data?.config ?? {}) as Record<string, unknown>;
    return {
      status: data?.status ?? 'disconnected',
      activated: !!data?.activated_at,
      connection: (config.connection ?? null) as ConnectionRecord | null,
      capabilities: (config.capabilities ?? null) as OdooConnectionRead['capabilities'],
      config,
    };
  }),
  setup: <T>(setupAction: string, input: Record<string, unknown> = {}) => erpSetupRequest<T>(setupAction, input, 'odoo'),
};
export type OdooRepository = typeof odooRepository;
