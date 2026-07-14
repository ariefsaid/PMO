/**
 * Shared per-org Vault secret resolution (flag gate + binding lookup + fallback).
 * Pure, dependency-injected — no Supabase/Deno imports — unit-testable without a server.
 *
 * AC-EAC-009, AC-EAC-011: flag/binding/vault matrix.
 */
export type PerOrgSecretResult =
  | { kind: 'no-binding' }
  | { kind: 'resolved'; secret: string }
  | { kind: 'binding-vault-miss' };

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
 * - flag OFF → { kind: 'no-binding' } (caller uses legacy fallback)
 * - flag ON + no binding → { kind: 'no-binding' }
 * - flag ON + binding[column] null → { kind: 'binding-vault-miss' }
 * - flag ON + binding[column] + vault returns value → { kind: 'resolved', secret: value }
 * - flag ON + binding[column] + vault returns null → { kind: 'binding-vault-miss' }
 *
 * Never throws — returns a discriminated result so callers can distinguish states.
 */
export async function resolvePerOrgSecret(deps: PerOrgSecretDeps): Promise<PerOrgSecretResult> {
  const { connectEnabled, orgId, tier, column = 'secret_ref', lookupBinding, readVaultSecret } = deps;

  if (!connectEnabled) {
    return { kind: 'no-binding' };
  }

  const binding = await lookupBinding(orgId, tier);
  if (!binding) {
    return { kind: 'no-binding' };
  }

  const secretRef = binding[column];
  if (!secretRef) {
    return { kind: 'binding-vault-miss' };
  }

  const secret = await readVaultSecret(secretRef);
  if (secret === null) {
    return { kind: 'binding-vault-miss' };
  }

  return { kind: 'resolved', secret };
}