import { AppError } from '../../appError.ts';

/**
 * Resolve ClickUp token from Vault.
 * The stored secret is expected to be a raw personal access token.
 */
export async function resolveClickUpCredentialsFromVault(
  secretRef: string,
  readVaultSecret: (ref: string) => Promise<string | null>,
): Promise<{ token: string }> {
  if (!secretRef) {
    throw new AppError('clickup binding secret_ref is blank', 'config-rejected');
  }

  const stored = await readVaultSecret(secretRef);
  if (!stored) {
    throw new AppError('ClickUp credentials unresolved for this org', 'config-rejected');
  }

  return { token: stored };
}