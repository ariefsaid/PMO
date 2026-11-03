/**
 * featureResolution.ts — reads the caller org's resolved plan switches ONCE per request (S4,
 * FR-PLN-008), under the CALLER'S OWN JWT.
 *
 * Source of truth is the S1 resolver's caller projection, `resolved_org_features()`
 * (migration 0533:180-202): own org only (`auth_org_id()`), active member required, stable security
 * definer, granted to `authenticated`. It is called on `deps.supabase` — the deputy client built from
 * the caller's JWT — NEVER on a service-role client (NFR-AR-SEC-002 / FR-PLN-005: one resolver, read
 * at the caller's level).
 *
 * Failure semantics: `null`, meaning "nothing is known to be off". The offering filter is UX/entitlement
 * honesty, not the enforcement authority — S2's `assert_feature_on` and RLS refuse the writes/reads
 * themselves — so an unreachable resolver must not blank the assistant. Only an explicit `false` from
 * the resolver hides a feature.
 */
import { asRpc, withTimeout } from './looseClient.ts';
import type { FeatureSwitches } from './featureSwitches.ts';

/** Wall-clock cap on the resolution read (mirrors the other coarse-tool reads). */
export const SWITCH_READ_TIMEOUT_MS = 5000;

/** The caller-scoped resolver RPC (0533). Named once so a rename is one edit. */
export const RESOLVED_ORG_FEATURES_RPC = 'resolved_org_features';

interface ResolvedRow {
  feature_key?: unknown;
  enabled?: unknown;
}

/**
 * Resolve the caller's switches to a `key → enabled` snapshot, or `null` when unavailable.
 * Never throws, never logs row content — this module only ever sees keys and booleans.
 */
export async function loadOrgFeatureSwitches(
  client: unknown,
  timeoutMs: number = SWITCH_READ_TIMEOUT_MS,
): Promise<FeatureSwitches | null> {
  const rpc = asRpc(client);
  if (!rpc) return null; // a client without .rpc (older test fake) → unavailable, not "all off"
  try {
    const res = await withTimeout(rpc.rpc(RESOLVED_ORG_FEATURES_RPC, {}), timeoutMs);
    if (res.error || !Array.isArray(res.data)) return null;
    const out: Record<string, boolean> = {};
    for (const row of res.data as ResolvedRow[]) {
      if (row && typeof row.feature_key === 'string' && typeof row.enabled === 'boolean') {
        out[row.feature_key] = row.enabled;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null; // timeout / transport error → availability over a speculative denial
  }
}
