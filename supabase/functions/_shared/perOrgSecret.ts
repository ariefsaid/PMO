/**
 * Shared per-org Vault secret resolution (flag gate + binding lookup + fallback).
 * Pure, dependency-injected — no Supabase/Deno imports — unit-testable without a server.
 *
 * AC-EAC-009, AC-EAC-011: flag/binding/vault matrix.
 */
export interface PerOrgSecretDeps {
  /** EXTERNAL_CONNECT_ENABLED === 'true' */
  connectEnabled: boolean;
  /** The caller's org_id */
  orgId: string;
  /** 'clickup' | 'erpnext' */
  tier: string;
  /** Column to read from the binding row. Default: 'secret_ref'. Use 'webhook_secret_ref' for ClickUp webhooks. */
  column?: 'secret_ref' | 'webhook_secret_ref';
  /** Looks up the binding row for (orgId, tier). Returns the row or null if not found. */
  lookupBinding: (orgId: string, tier: string) => Promise<{ secret_ref?: string | null; webhook_secret_ref?: string | null } | null>;
  /** Reads a secret from Vault by ref. Returns the secret string or null if not found. */
  readVaultSecret: (ref: string) => Promise<string | null>;
}

/**
 * Resolves a per-org secret from Vault when the feature flag is ON and a binding exists.
 *
 * Semantics (flag/binding/vault matrix):
 * - flag OFF → null (caller uses legacy fallback)
 * - flag ON + no binding / binding[column] null → null
 * - flag ON + binding[column] + vault returns value → the value
 * - flag ON + binding[column] + vault returns null → null (caller falls back)
 *
 * Never throws for "use fallback" cases — returns null so the caller's existing legacy path runs.
 */
export async function resolvePerOrgSecret(deps: PerOrgSecretDeps): Promise<string | null> {
  const { connectEnabled, orgId, tier, column = 'secret_ref', lookupBinding, readVaultSecret } = deps;

  if (!connectEnabled) {
    return null;
  }

  const binding = await lookupBinding(orgId, tier);
  if (!binding) {
    return null;
  }

  const secretRef = binding[column];
  if (!secretRef) {
    return null;
  }

  const secret = await readVaultSecret(secretRef);
  return secret;
}