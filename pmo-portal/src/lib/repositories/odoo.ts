/** Odoo repository (#1504 S5): the directory mirror read and the connection read. The browser never talks to Odoo; setup verbs go through `external-set-company`. */
import { supabase } from '@/src/lib/supabase/client';
import { wrap } from './repositoryErrors';
import { erpSetupRequest } from './integrations';
import { odooPaymentRef } from '@/src/lib/adapterSeam/odoo/purchase/anchors';
import { SENDS_FINISHED_KEY, type ConnectionRecord } from '@/src/lib/adapterSeam/odoo/connectionState';
import type { MirrorKind, ListMasterInput, MasterRecord, OdooConnectionRead, OdooRepository, PurchaseCommand, PurchaseCommandKind } from './contracts/odoo';

// ilike pattern inside a double-quoted PostgREST value: commas and parens are then literal. LIKE wildcards get a `\` escape, then `\` and `"` are escaped for the quoting.
const likeAny = (s: string) => `"%${s.replace(/[\\%_]/g, '\\$&').replace(/[\\"]/g, '\\$&')}%"`;

const COMMAND_KINDS: ReadonlySet<string> = new Set<PurchaseCommandKind>(['purchase-order', 'goods-receipt', 'purchase-invoice', 'payment']);
const DAY_MS = 86_400_000;

const CONFIG_KEYS = ['database', 'odoo_company_name', 'key_expires_on', 'account_defaults', 'unit_map', 'default_warehouse_id', 'default_payment_journal_id', SENDS_FINISHED_KEY];

export const odooRepository: OdooRepository = {
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
  masterSummary: (kind: MirrorKind) => wrap(async () => {
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
  listPurchaseCommands: (procurementId, now = new Date()) => wrap(async (): Promise<PurchaseCommand[]> => {
    const { data, error } = await supabase.from('external_command_outbox').select('id,state,last_error,updated_at,actor_user_id,payload')
      .eq('external_tier', 'odoo').eq('domain', 'procurement').eq('payload->>procurementId', procurementId).neq('state', 'confirmed').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).flatMap((r) => {
      const kind = (r.payload as { erp_doc_kind?: unknown } | null)?.erp_doc_kind;
      if (typeof kind !== 'string' || !COMMAND_KINDS.has(kind)) return [];
      // A rejected attempt that a person has since redone is history after a day; held and in-flight ones stay until settled.
      if (r.state === 'failed' && now.getTime() - Date.parse(r.updated_at) > DAY_MS) return [];
      return [{ id: r.id, kind: kind as PurchaseCommandKind, state: r.state, lastError: r.last_error, updatedAt: r.updated_at, actorUserId: r.actor_user_id }];
    });
  }),
  resolveHeldPayment: ({ outboxId, resolution, paymentNumber, reason }) => wrap(async () => {
    if (resolution === 'adopt' && !/^[1-9][0-9]*$/.test(paymentNumber?.trim() ?? '')) throw new Error('Enter the Odoo payment number');
    const { error } = await supabase.rpc('resolve_held_outbox_command', {
      p_outbox_id: outboxId, p_resolution: resolution,
      p_external_record_id: resolution === 'adopt' ? odooPaymentRef(paymentNumber!.trim()) : undefined, p_reason: reason,
    });
    if (error) throw error;
  }),
  setup: <T>(setupAction: string, input: Record<string, unknown> = {}) => erpSetupRequest<T>(setupAction, input, 'odoo'),
};
