import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { priceSource } from '@/src/lib/priceReadPath';

/**
 * Payment channel DAL (#2698, migrations 1355/1356, docs/specs/purchase-payment-channel.spec.md). The switch, the list and
 * the set-on-a-request rule all live in the database; this module only reads and calls the RPCs. Nothing here sends an
 * `org_id`, an actor or a stamp.
 */
type DbError = { message: string; code?: string; details?: string | null };

function fail(error: DbError): never {
  throw new AppError(error.message, error.code);
}

export interface PaymentChannel { id: string; name: string; archived: boolean }
export interface ProcurementPaymentChannel { channelId: string | null; name: string | null }

/** Whether the organisation records a payment channel. No settings row means off. */
export async function getPaymentChannelsEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('org_payment_channel_settings').select('enabled').maybeSingle();
  if (error) fail(error);
  return data?.enabled === true;
}

/** The organisation's channels, live and archived, in list order. */
export async function listPaymentChannels(): Promise<PaymentChannel[]> {
  // The list has no provable ceiling (an organisation adds channels), so it is paged rather than silently truncated.
  const rows = await fetchAllPages((f, t) => supabase.from('org_payment_channels').select('id,name,archived_at')
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(f, t));
  return rows.map((r) => ({ id: r.id, name: r.name, archived: r.archived_at !== null }));
}

/** Admin: switch the feature on or off (the first switch-on seeds the starter list). */
export async function setPaymentChannelsEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_payment_channel_settings', { p_enabled: enabled });
  if (error) fail(error);
}

/** Admin: add (no id) or rename a channel. */
export async function savePaymentChannel(id: string | null, name: string): Promise<void> {
  const { error } = await supabase.rpc('save_payment_channel', { p_id: nullableArg(id), p_name: name });
  if (error) fail(error);
}

/** Admin: archive or restore a channel. */
export async function archivePaymentChannel(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.rpc('archive_payment_channel', { p_id: id, p_archived: archived });
  if (error) fail(error);
}

/** Set or clear (null) a request's channel; the database decides who may, by the request's status. */
export async function setProcurementPaymentChannel(procurementId: string, channelId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_procurement_payment_channel', { p_id: procurementId, p_channel_id: nullableArg(channelId) });
  if (error) fail(error);
}

/** One request's channel (id and name), or nulls when none is set. */
export async function getProcurementPaymentChannel(procurementId: string): Promise<ProcurementPaymentChannel> {
  const { data, error } = await supabase.from(priceSource('procurements') as 'procurements').select('payment_channel_id,payment_channel:org_payment_channels(name)').eq('id', procurementId).maybeSingle();
  if (error) fail(error);
  return { channelId: data?.payment_channel_id ?? null, name: data?.payment_channel?.name ?? null };
}

/** The channel name per request, for a list of requests (requests with none are left out). */
export async function getPaymentChannelNames(procurementIds: readonly string[]): Promise<Record<string, string>> {
  if (procurementIds.length === 0) return {};
  const { data, error } = await supabase.from(priceSource('procurements') as 'procurements').select('id,payment_channel:org_payment_channels(name)').in('id', [...procurementIds]).not('payment_channel_id', 'is', null);
  if (error) fail(error);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.payment_channel) out[r.id] = r.payment_channel.name;
  return out;
}
