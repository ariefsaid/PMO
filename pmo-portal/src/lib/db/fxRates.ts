import { supabase } from '@/src/lib/supabase/client';
import type {
  FxCommitCounts,
  FxRateInput,
  FxRateMatch,
  FxRatePage,
  FxRateRow,
} from '@/src/lib/repositories/types';

/**
 * #2096: validates the three-integer upsert reply without zod — this was the only non-assistant
 * zod import, so dropping it keeps zod out of the first-load chunk entirely. Same contract the
 * previous z.strictObject enforced: exactly `new`/`changed`/`unchanged`, each an integer >= 0.
 */
function assertCommitCounts(data: unknown): asserts data is FxCommitCounts {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Unexpected upsert_fx_rates reply: expected an object.');
  }
  const counts = data as Record<string, unknown>;
  const extra = Object.keys(counts).filter((k) => k !== 'new' && k !== 'changed' && k !== 'unchanged');
  const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (extra.length > 0 || !isCount(counts.new) || !isCount(counts.changed) || !isCount(counts.unchanged)) {
    throw new Error('Unexpected upsert_fx_rates reply: expected { new, changed, unchanged } integer counts.');
  }
}

export async function listFxRates(before?: string): Promise<FxRatePage> {
  let query = supabase
    .from('fx_rates')
    .select('*')
    .order('rate_date', { ascending: false })
    .limit(51);
  if (before) query = query.lt('rate_date', before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).slice(0, 50) as FxRateRow[];
  return { rows, nextCursor: data && data.length > 50 ? (rows.at(-1)?.rate_date ?? null) : null };
}

export async function existingFxRates(
  dates: string[],
): Promise<Pick<FxRateRow, 'rate_date' | 'rate'>[]> {
  if (dates.length === 0) return [];
  const { data, error } = await supabase
    .from('fx_rates')
    .select('rate_date,rate')
    .in('rate_date', dates);
  if (error) throw error;
  return data ?? [];
}

export async function fxRateOn(
  base: string,
  quote: string,
  onDate: string,
): Promise<FxRateMatch | null> {
  const { data, error } = await supabase.rpc('fx_rate_on', { base, quote, on_date: onDate });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function upsertFxRates(rows: FxRateInput[]): Promise<FxCommitCounts> {
  const { data, error } = await supabase.rpc('upsert_fx_rates', {
    p_rows: rows.map(({ rate_date, rate }) => ({ rate_date, rate })),
  });
  if (error) throw error;
  assertCommitCounts(data);
  return data;
}

export async function fxContext(): Promise<{ currency: string; timezone: string }> {
  const { data, error } = await supabase
    .from('organizations')
    .select('default_currency,default_timezone')
    .single();
  if (error) throw error;
  return toFxContext(data.default_currency, data.default_timezone);
}

/** Shared by the per-endpoint read and the Overview read-model. */
export function toFxContext(currency: string | null, timezone: string | null): { currency: string; timezone: string } {
  if (!currency) throw new Error('Organization currency could not be resolved.');
  return { currency, timezone: timezone ?? 'UTC' };
}
