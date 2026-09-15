/**
 * THE ERPNext auth-pair resolver (#651, FR-ENA-015..019, ADR-0072).
 *
 * ONE resolver for BOTH directions. Before this, the inbound poll resolved Vault-first while every
 * outbound write resolved from the environment only, so an org connected through the shipped connect
 * flow (credential in Vault) could read and could not push.
 *
 * Order: kill-switch → Vault (via the shared `resolvePerOrgSecret`) → env pair → refuse.
 *
 * ⚑ THE FAIL-CLOSED RULE (FR-ENA-018). `resolvePerOrgSecret`'s seams report BOTH "no such secret" and
 * "the store errored" as `null`, and only the FIRST may license the env fallback: an unreadable store is
 * not evidence that this org has no Vault credential, and the env pair is selected by a string, not by an
 * authenticated tenancy check. The failure is recorded in a flag HERE and checked AFTER the call — not
 * thrown from inside the seam — so the refusal does not depend on whether `perOrgSecret.ts` propagates a
 * thrown seam error.
 *
 * ⚑ NO MODULE-LEVEL CACHE. The cache is an explicit object created per request / per sweep tick and
 * passed in: a long-lived isolate must not hold one tenant's credential across requests, and a rotated
 * credential must not outlive a request.
 *
 * NFR-ENA-SEC-005: no credential value is logged, returned in an error body, or persisted. A store
 * failure is logged by its error CODE only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { resolveErpCredentials } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts';
import { resolvePerOrgSecret } from './perOrgSecret.ts';
import { externalConnectEnabled } from './externalConnectEnabled.ts';

export interface ErpAuthPair {
  apiKey: string;
  apiSecret: string;
}

/** Per-request / per-tick memo, keyed by org id. Create one, pass it to every call in that unit of work. */
export type ErpAuthPairCache = Map<string, Promise<ErpAuthPair>>;
export function createErpAuthPairCache(): ErpAuthPairCache {
  return new Map();
}

export interface ErpAuthPairOrg {
  orgId: string;
  /** The binding's `secret_ref` — names the env pair for the local/dev fallback (FR-ENA-017). */
  secretRef: string;
}

export async function resolveErpAuthPair(
  serviceClient: SupabaseClient,
  org: ErpAuthPairOrg,
  cache?: ErpAuthPairCache,
): Promise<ErpAuthPair> {
  if (!cache) return await resolveUncached(serviceClient, org);
  const hit = cache.get(org.orgId);
  if (hit) return await hit;
  const pending = resolveUncached(serviceClient, org);
  cache.set(org.orgId, pending);
  try {
    return await pending;
  } catch (err) {
    // Never cache a refusal: a store hiccup must not disable this org for the rest of the tick.
    cache.delete(org.orgId);
    throw err;
  }
}

async function resolveUncached(serviceClient: SupabaseClient, org: ErpAuthPairOrg): Promise<ErpAuthPair> {
  if (!externalConnectEnabled()) {
    throw new AppError('external integrations are disabled by the operator', 'config-rejected');
  }
  if (!org.orgId) {
    throw new AppError('ERPNext credentials unresolved: no org in scope', 'config-rejected');
  }

  let storeUnavailable = false;

  const result = await resolvePerOrgSecret({
    connectEnabled: true,
    orgId: org.orgId,
    tier: 'erpnext',
    lookupBinding: async (orgId: string, tier: string) => {
      const { data, error } = await serviceClient
        .from('external_org_bindings')
        .select('secret_ref')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .maybeSingle();
      if (error) {
        storeUnavailable = true;
        console.error('external_org_bindings lookup failed', error.code ?? 'unknown');
        return null;
      }
      return data as { secret_ref?: string | null } | null;
    },
    readVaultSecret: async (ref: string) => {
      const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
      if (error) {
        storeUnavailable = true;
        console.error('read_vault_secret failed', error.code ?? 'unknown');
        return null;
      }
      return (data as string | null) ?? null;
    },
  });

  if (storeUnavailable) {
    throw new AppError(
      "could not determine this org's ERPNext credentials (secret store unavailable)",
      'config-rejected',
    );
  }

  if (result.kind === 'resolved') return splitAuthPair(result.secret);

  if (result.kind === 'no-binding' || result.kind === 'binding-vault-miss') {
    // The store ANSWERED, and it holds no Vault secret for this binding. This — and only this — is the
    // local/dev fallback (FR-ENA-017): the `<PREFIX>_KEY`/`<PREFIX>_SECRET` pair named by the org's OWN
    // secret_ref. `local-bench` (supabase/seed.sql) and the serial money e2e lane live here.
    return resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
  }

  // An unrecognised result kind is a store we do not understand — refuse, never guess.
  throw new AppError("could not determine this org's ERPNext credentials", 'config-rejected');
}

function splitAuthPair(secret: string): ErpAuthPair {
  const idx = secret.indexOf(':');
  if (idx <= 0 || idx >= secret.length - 1) {
    throw new AppError('ERPNext credential format invalid (expected apiKey:apiSecret)', 'config-rejected');
  }
  return { apiKey: secret.slice(0, idx), apiSecret: secret.slice(idx + 1) };
}