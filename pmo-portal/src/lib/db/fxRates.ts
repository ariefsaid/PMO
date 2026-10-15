import { z } from 'zod';
import { supabase } from '@/src/lib/supabase/client';
import type {
  FxCommitCounts,
  FxRateInput,
  FxRateMatch,
  FxRatePage,
  FxRateRow,
} from '@/src/lib/repositories/types';

const commitCountsSchema: z.ZodType<FxCommitCounts> = z
  .object({
    new: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  })
  .strict();

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
  return commitCountsSchema.parse(data);
}

export async function fxContext(): Promise<{ currency: string; timezone: string }> {
  const { data, error } = await supabase
    .from('organizations')
    .select('default_currency,default_timezone')
    .single();
  if (error) throw error;
  if (!data.default_currency) throw new Error('Organization currency could not be resolved.');
  return { currency: data.default_currency, timezone: data.default_timezone ?? 'UTC' };
}
