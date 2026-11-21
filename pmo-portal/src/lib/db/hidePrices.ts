import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/** ships with the next release (#2699) */
export const HIDE_PRICES_SETTING_AVAILABLE = false;

/** #2699: has the organisation turned on "hide prices from requesters"? (default off; every member may read) */
export async function getHidePricesEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_hide_prices_enabled' as never);
  if (error) throw new AppError(error.message, error.code);
  return data === true;
}

/** Admin-only (server). */
export async function setHidePricesEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_hide_prices_enabled' as never, { p_enabled: enabled } as never);
  if (error) throw new AppError(error.message, error.code);
}

/** The signed-in person's own answer from the database rule `actor_may_see_prices()`. */
export async function getMaySeePrices(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_may_see_prices' as never);
  if (error) throw new AppError(error.message, error.code);
  return data === true;
}
