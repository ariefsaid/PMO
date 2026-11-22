import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Who may raise and send purchase orders by built-in role (roles-that-decide FR-RTD-009, migrations 1842-1843).
 * The organisation names built-in roles in `purchase_order_settings.order_job_roles` (empty = today's levels only); the database
 * gate `actor_may_order_purchases()` answers for the signed-in person. Every rule is enforced in the database; org_id is never sent.
 */
const fail = (error: { message: string; code?: string }): never => {
  throw new AppError(error.message, error.code);
};

/** The built-in role keys the organisation lets order purchases. No settings row = none. */
export async function getOrderJobRoles(): Promise<string[]> {
  const { data, error } = await supabase.from('purchase_order_settings').select('order_job_roles').limit(1);
  if (error) fail(error);
  return data?.[0]?.order_job_roles ?? [];
}

/** Admin only, built-in roles on, catalogue keys that are not field roles: refused otherwise. Returns the stored list. */
export async function setOrderJobRoles(keys: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('po_set_order_job_roles', { p_keys: keys });
  if (error) fail(error);
  return data ?? [];
}

/** Whether the signed-in person fills one of the organisation's ordering roles (the database gate itself). */
export async function getMayOrderPurchases(): Promise<boolean> {
  const { data, error } = await supabase.rpc('actor_may_order_purchases');
  if (error) fail(error);
  return data === true;
}
