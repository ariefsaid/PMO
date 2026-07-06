import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Operator DAL (ops-admin-surface S4, ADR-0049). `isOperator()` is a CLARITY PROJECTION
 * ONLY — a UI convenience that mirrors the `is_operator()` RLS/RPC predicate so the
 * Administration surface can show Operator-only affordances. Every Operator power is
 * re-asserted server-side by its own RPC (`admin_set_user_status`, `operator_grant_credits`,
 * `operator_toggle_feature`, …) — this hook/DAL call is never itself an authorization gate.
 */
export async function isOperator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_operator');
  if (error) throw new AppError(error.message, error.code);
  return data === true;
}
