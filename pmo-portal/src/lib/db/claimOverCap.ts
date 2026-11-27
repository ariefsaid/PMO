import { getVisibleOrganizationId } from './organizations';
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { readOrgColumnsStrict } from './orgSettingsBatch';

/** survey-cap-stop: what the database does with a claim line above the claimable quantity. `warn` (default) lets it through. */
export type ClaimOverCapMode = 'warn' | 'block';

export async function getClaimOverCap(): Promise<ClaimOverCapMode> {
  const { data, error } = await readOrgColumnsStrict(['claim_quantity_over_cap']);
  if (error) throw new AppError(error.message, error.code);
  return data?.claim_quantity_over_cap === 'block' ? 'block' : 'warn';
}

/** Admin-only (column-granted update behind an Admin policy); a silent no-op is surfaced as a refusal. */
export async function setClaimOverCap(mode: ClaimOverCapMode): Promise<void> {
  const refusal = 'Only an Admin can change the claim quantity setting.';
  const orgId = await getVisibleOrganizationId(refusal);
  const { data, error } = await supabase.from('organizations').update({ claim_quantity_over_cap: mode }).eq('id', orgId).select('id');
  if (error) throw new AppError(error.message, error.code);
  assertWriteLanded(data, refusal);
}
