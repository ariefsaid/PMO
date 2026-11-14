import { z } from 'zod';
import { supabase } from '@/src/lib/supabase/client';
import type {
  FxCommitCounts,
  FxRateInput,
  FxRateMatch,
  FxRatePage,
  FxRateRow,
} from '@/src/lib/repositories/types';

const commitCountsSchema: z.ZodType<FxCommitCounts> = z.strictObject({
  new: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});

/** Rates per page; the reader takes one extra row as the "there is more" sentinel. */
export const FX_RATE_PAGE_SIZE = 50;

export async function listFxRates(before?: string): Promise<FxRatePage> {
  let query = supabase
    .from('fx_rates')
    .select('*')
    .order('rate_date', { ascending: false })
    .limit(FX_RATE_PAGE_SIZE + 1);
  if (before) query = query.lt('rate_date', before);
  const [page, total] = await Promise.all([query, countFxRates()]);
  const { data, error } = page;
  if (error) throw error;
  const rows = (data ?? []).slice(0, FX_RATE_PAGE_SIZE) as FxRateRow[];
  return {
    rows,
    nextCursor: data && data.length > FX_RATE_PAGE_SIZE ? (rows.at(-1)?.rate_date ?? null) : null,
    total,
  };
}

/**
 * Whole-history size for the pager's "1–50 of N" (C18): a keyset page carries only a cursor, so a
 * reader cannot tell where they are. The bound belongs to the page, never the history, so the count
 * is read WITHOUT the cursor predicate. A failed count is not a failed page — the list still renders
 * and the pager omits the total rather than inventing one.
 */
async function countFxRates(): Promise<number | null> {
  const { count, error } = await supabase
    .from('fx_rates')
    .select('rate_date', { count: 'exact', head: true });
  if (error) return null;
  return count ?? null;
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
  return toFxContext(data.default_currency, data.default_timezone);
}

/** Shared by the per-endpoint read and the Overview read-model. */
export function toFxContext(currency: string | null, timezone: string | null): { currency: string; timezone: string } {
  if (!currency) throw new Error('Organization currency could not be resolved.');
  return { currency, timezone: timezone ?? 'UTC' };
}
