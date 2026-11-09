/** Odoo repository (#1504 S5): the directory mirror read and the connection read. The browser never talks to Odoo; setup verbs go through `external-set-company`. */
import { supabase } from '@/src/lib/supabase/client';
import { wrap } from './repositoryErrors';
import { erpSetupRequest } from './integrations';
import { odooPaymentRef, odooRevenueDocumentRef } from '@/src/lib/adapterSeam/odoo/purchase/anchors';
import type { ConnectionRecord } from '@/src/lib/adapterSeam/odoo/connectionState';
import type { MirrorKind, ListMasterInput, MasterRecord, OdooConnectionRead, OdooRepository, PurchaseCommand, PurchaseCommandKind, RevenueCommand, RevenueCommandKind, OdooCreditNote } from './contracts/odoo';

// ilike pattern inside a double-quoted PostgREST value: commas and parens are then literal. LIKE wildcards get a `\` escape, then `\` and `"` are escaped for the quoting.
const likeAny = (s: string) => `"%${s.replace(/[\\%_]/g, '\\$&').replace(/[\\"]/g, '\\$&')}%"`;

const COMMAND_KINDS: ReadonlySet<string> = new Set<PurchaseCommandKind>(['purchase-order', 'goods-receipt', 'purchase-invoice', 'payment']);
const DAY_MS = 86_400_000;

type RevenueMirrorCreditNoteRow = {
  id: string;
  erp_name: string;
  doc_date: string | null;
  currency: string | null;
  grand_total: number | string | null;
  erp_status: string | null;
  erp_read_at: string;
};

type RevenueMirrorCreditNoteQuery = PromiseLike<{
  data: RevenueMirrorCreditNoteRow[] | null;
  error: { message: string; code?: string } | null;
}> & {
  eq: (column: 'erp_doctype' | 'sales_invoice_id', value: string) => RevenueMirrorCreditNoteQuery;
  neq: (column: 'erp_docstatus', value: number) => RevenueMirrorCreditNoteQuery;
  order: (column: 'doc_date', options: { ascending: boolean }) => RevenueMirrorCreditNoteQuery;
};

function revenueMirrorCreditNoteQuery() {
  // database.types.ts predates the C6 side mirror, so narrow the missing table at this read seam.
  // Keep the receiver: a detached `supabase.from` loses `this` and throws before any request.
  const client = supabase as unknown as {
    from: (table: 'revenue_erp_mirror') => { select: (columns: string) => RevenueMirrorCreditNoteQuery };
  };
  return client.from('revenue_erp_mirror')
    .select('id,erp_name,doc_date,currency,grand_total,erp_status,erp_read_at');
}

function revenueCommands(rows: Array<Record<string, unknown>>, now: Date): RevenueCommand[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const kind = (row.payload as { erp_doc_kind?: unknown } | null)?.erp_doc_kind;
    const id = typeof row.id === 'string' ? row.id : null;
    const recordId = typeof row.pmo_record_id === 'string' ? row.pmo_record_id : null;
    const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
    if (!id || !recordId || seen.has(id) || (kind !== 'sales-invoice' && kind !== 'incoming-payment')) return [];
    if (row.state === 'failed' && now.getTime() - Date.parse(updatedAt) > DAY_MS) return [];
    seen.add(id);
    return [{
      id, recordId, kind: kind as RevenueCommandKind, state: String(row.state ?? ''),
      lastError: typeof row.last_error === 'string' ? row.last_error : null,
      updatedAt, actorUserId: typeof row.actor_user_id === 'string' ? row.actor_user_id : null,
    }];
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const CONFIG_KEYS = ['database', 'odoo_company_name', 'key_expires_on', 'account_defaults', 'unit_map', 'default_warehouse_id', 'default_payment_journal_id'];

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
  listRevenueCommands: (invoiceId, now = new Date()) => wrap(async (): Promise<RevenueCommand[]> => {
    const read = () => supabase.from('external_command_outbox').select('id,pmo_record_id,state,last_error,updated_at,actor_user_id,payload')
      .eq('external_tier', 'odoo').eq('domain', 'revenue').neq('state', 'confirmed').order('updated_at', { ascending: false });
    const [invoice, receipts] = await Promise.all([
      read().eq('pmo_record_id', invoiceId),
      read().eq('payload->>salesInvoiceId', invoiceId),
    ]);
    if (invoice.error) throw invoice.error;
    if (receipts.error) throw receipts.error;
    return revenueCommands([...(invoice.data ?? []), ...(receipts.data ?? [])] as Array<Record<string, unknown>>, now);
  }),
  listRevenueCommandsForInvoices: (invoiceIds, now = new Date()) => wrap(async (): Promise<RevenueCommand[]> => {
    if (invoiceIds.length === 0) return [];
    const read = () => supabase.from('external_command_outbox').select('id,pmo_record_id,state,last_error,updated_at,actor_user_id,payload')
      .eq('external_tier', 'odoo').eq('domain', 'revenue').neq('state', 'confirmed').order('updated_at', { ascending: false });
    const [invoices, receipts] = await Promise.all([
      read().in('pmo_record_id', invoiceIds),
      read().in('payload->>salesInvoiceId', invoiceIds),
    ]);
    if (invoices.error) throw invoices.error;
    if (receipts.error) throw receipts.error;
    return revenueCommands([...(invoices.data ?? []), ...(receipts.data ?? [])] as Array<Record<string, unknown>>, now);
  }),
  listRevenueCreditNotes: (invoiceId) => wrap(async (): Promise<OdooCreditNote[]> => {
    const { data, error } = await revenueMirrorCreditNoteQuery()
      .eq('erp_doctype', 'Credit Note').eq('sales_invoice_id', invoiceId).neq('erp_docstatus', 2)
      .order('doc_date', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: String(row.id), number: String(row.erp_name), date: (row.doc_date as string | null) ?? null,
      currency: (row.currency as string | null) ?? null,
      amount: row.grand_total == null ? null : Number(row.grand_total),
      status: String(row.erp_status ?? ''), readAt: String(row.erp_read_at ?? ''),
    }));
  }),
  resolveHeldPayment: ({ outboxId, resolution, paymentNumber, reason }) => wrap(async () => {
    if (resolution === 'adopt' && !/^[1-9][0-9]*$/.test(paymentNumber?.trim() ?? '')) throw new Error('Enter the Odoo payment number');
    const { error } = await supabase.rpc('resolve_held_outbox_command', {
      p_outbox_id: outboxId, p_resolution: resolution,
      p_external_record_id: resolution === 'adopt' ? odooPaymentRef(paymentNumber!.trim()) : undefined, p_reason: reason,
    });
    if (error) throw error;
  }),
  resolveHeldRevenueCommand: ({ outboxId, kind, resolution, documentNumber, reason }) => wrap(async () => {
    const number = documentNumber?.trim();
    if (resolution === 'adopt' && !/^[1-9][0-9]*$/.test(number ?? '')) throw new Error('Enter the Odoo document number');
    const { error } = await supabase.rpc('resolve_held_outbox_command', {
      p_outbox_id: outboxId, p_resolution: resolution,
      p_external_record_id: resolution === 'adopt' ? odooRevenueDocumentRef(kind, number!) : undefined,
      p_reason: reason,
    });
    if (error) throw error;
  }),
  setup: <T>(setupAction: string, input: Record<string, unknown> = {}) => erpSetupRequest<T>(setupAction, input, 'odoo'),
};
