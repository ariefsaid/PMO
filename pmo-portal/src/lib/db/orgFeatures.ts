import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { FEATURE_KEYS, type OrgFeatureKey } from '@/src/lib/features';

/**
 * org_features DAL (ops-admin-surface S6, FR-ENT-001..004). The read path selects own-org rows
 * (RLS scopes `org_id = auth_org_id()` so a member reads only their own org — no `org_id` is sent).
 * The write path is the Operator-only `operator_toggle_feature` RPC (core keys rejected with
 * errcode `P0001` `core_not_gated`; unknown org rejected with `23503`). `org_credit_balance` +
 * `operator_grant_credits` are the credits RPCs shipped in mig 0065 (FR-CRE-002/005).
 */

/** Row shape returned by the own-org features select. */
export interface OrgFeatureRow {
  feature_key: string;
  enabled: boolean;
}

/**
 * Read the caller's own-org feature rows and project them into a `Record<OrgFeatureKey, boolean>`.
 * Keys with no row are ABSENT from the map (the `useFeature` resolver falls back to the env
 * default for those — FR-ENT-004 absence = included).
 */
export async function listOwnOrgFeatures(): Promise<Record<OrgFeatureKey, boolean>> {
  const { data, error } = await supabase
    .from('org_features')
    .select('feature_key, enabled');
  if (error) throw new AppError(error.message, error.code);
  const out: Partial<Record<OrgFeatureKey, boolean>> = {};
  for (const row of (data ?? []) as OrgFeatureRow[]) {
    // Only known keys land in the map (defensive against a CHECK-list expansion lagging the FE).
    if (isValidFeatureKey(row.feature_key)) {
      out[row.feature_key] = row.enabled;
    }
  }
  return out as Record<OrgFeatureKey, boolean>;
}

// Derive the validation set from the CANONICAL FEATURE_KEYS registry (code review I1: a
// hand-maintained copy would silently drop toggled rows when the SQL CHECK + FEATURE_KEYS list
// diverged — the Operator's toggle would persist yet the FE would ignore it).
const FEATURE_KEY_SET: ReadonlySet<string> = new Set<string>(FEATURE_KEYS);
function isValidFeatureKey(key: string): key is OrgFeatureKey {
  return FEATURE_KEY_SET.has(key);
}

/** Toggle (upsert) a feature row for an org via the Operator-only RPC. */
export async function toggleOrgFeature(args: {
  orgId: string;
  key: OrgFeatureKey;
  enabled: boolean;
}): Promise<void> {
  const { data, error } = await supabase.rpc('operator_toggle_feature', {
    p_org_id: args.orgId,
    p_key: args.key,
    p_enabled: args.enabled,
  });
  if (error) throw new AppError(error.message, error.code);
  // RPC returns void; `data` is null on success. Reference it so the unused-var lint is satisfied
  // and a future non-void return is not silently dropped.
  void data;
}

/** The org's credit-pool balance (grants − usage) via the security-definer RPC (FR-CRE-002). */
export async function getOrgCreditBalance(orgId: string): Promise<number> {
  const { data, error } = await supabase.rpc('org_credit_balance', { p_org_id: orgId });
  if (error) throw new AppError(error.message, error.code);
  return typeof data === 'number' ? data : Number(data ?? 0);
}

/** Operator-only credit grant (FR-CRE-005); rejects `amount <= 0` with errcode `23514`. */
export async function grantOrgCredits(args: {
  orgId: string;
  amount: number;
  note: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc('operator_grant_credits', {
    p_org_id: args.orgId,
    p_amount: args.amount,
    p_note: args.note,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}
