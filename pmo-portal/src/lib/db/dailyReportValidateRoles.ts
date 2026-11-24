import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';

/**
 * Read the signed-in caller's organisation's `daily_report_validate_roles` array.
 * `org_id` is never sent; `organizations_select` scopes to the caller's organisation.
 */
export async function getDailyReportValidateRoles(): Promise<string[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('daily_report_validate_roles')
    .limit(2);
  if (error) throw new AppError(error.message, error.code);
  return data?.[0]?.daily_report_validate_roles ?? [];
}

/**
 * Save the built-in job role keys whose active holders may validate daily site reports.
 * Enforced in the database by `set_daily_report_validate_roles` (Admin-only, non-field built-in roles).
 */
export async function setDailyReportValidateRoles(roles: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('set_daily_report_validate_roles', { p_roles: roles });
  if (error) throw new AppError(error.message, error.code);
  return data ?? [];
}
