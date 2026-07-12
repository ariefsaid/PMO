/**
 * Per-org ERPNext credential resolution (Slice 6 pre-task, NFR-ENA-SEC-002). The
 * `external_org_bindings.secret_ref` NAMES a per-org pair of function secrets — it NEVER stores a
 * secret value in the DB (OQ-6). This module turns a `secret_ref` into the concrete `{apiKey,
 * apiSecret}` by reading `<PREFIX>_KEY` / `<PREFIX>_SECRET` from an INJECTED env accessor (the edge fn
 * passes `Deno.env.get`), so the resolution is pure + unit-testable and this module never touches a
 * real environment itself.
 *
 * This replaces the flagged single global `ERPNEXT_API_KEY`/`ERPNEXT_API_SECRET` placeholder in
 * `adapter-dispatch/index.ts` (each org's binding resolves its OWN pair). The env key is derived by
 * normalizing the `secret_ref` to an env-safe UPPER_SNAKE prefix (so a ref like `local-bench` or
 * `vault/AS/erpnext-org-1` maps to a valid, `--env-file`-loadable variable name). Resolution FAILS
 * CLOSED — a missing/blank ref, or an unset KEY/SECRET, throws `config-rejected` before any ERP call.
 */
import { AppError } from '../../appError.ts';

/** Normalizes a `secret_ref` to an env-safe UPPER_SNAKE prefix: non-alphanumeric runs collapse to a
 *  single `_`, leading/trailing `_` are trimmed. `local-bench` -> `LOCAL_BENCH`;
 *  `vault/AS/erpnext-org-1` -> `VAULT_AS_ERPNEXT_ORG_1`. */
export function secretRefEnvPrefix(secretRef: string): string {
  return secretRef
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolve `{apiKey, apiSecret}` for a binding's `secret_ref` from the injected env accessor. Fails
 * closed (`config-rejected`) when the ref is blank or either secret is unset — a flipped org whose
 * function secrets are not configured can never reach ERP with an empty/global credential.
 */
export function resolveErpCredentials(
  secretRef: string,
  getEnv: (key: string) => string | undefined,
): { apiKey: string; apiSecret: string } {
  const prefix = secretRefEnvPrefix(secretRef);
  if (!prefix) {
    throw new AppError('erpnext binding secret_ref is blank — cannot resolve credentials', 'config-rejected');
  }
  const apiKey = getEnv(`${prefix}_KEY`);
  const apiSecret = getEnv(`${prefix}_SECRET`);
  if (!apiKey || !apiSecret) {
    throw new AppError(
      `erpnext credentials for secret_ref "${secretRef}" are not configured (${prefix}_KEY/${prefix}_SECRET unset)`,
      'config-rejected',
    );
  }
  return { apiKey, apiSecret };
}
