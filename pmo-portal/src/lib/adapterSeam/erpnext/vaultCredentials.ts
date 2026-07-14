import { AppError } from '../../appError.ts';

/**
 * Resolve ERPNext credentials from Vault via the security-definer reader RPC.
 * Fails closed with `config-rejected` on blank ref, null result, or invalid format.
 *
 * The stored secret is expected to be in `apiKey:apiSecret` format.
 */
export async function resolveErpCredentialsFromVault(
  secretRef: string,
  readVaultSecret: (ref: string) => Promise<string | null>,
): Promise<{ apiKey: string; apiSecret: string }> {
  if (!secretRef) {
    throw new AppError('erpnext binding secret_ref is blank', 'config-rejected');
  }

  const stored = await readVaultSecret(secretRef);
  if (!stored) {
    throw new AppError(
      'ERPNext credentials unresolved for this org — check the binding secret_ref configuration',
      'config-rejected',
    );
  }

  const idx = stored.indexOf(':');
  if (idx <= 0 || idx === stored.length - 1) {
    throw new AppError(
      'ERPNext credential format invalid (expected apiKey:apiSecret)',
      'config-rejected',
    );
  }
  const apiKey = stored.slice(0, idx);
  const apiSecret = stored.slice(idx + 1);

  return { apiKey, apiSecret };
}