/**
 * ClickUp resolves its credentials per org, from the org's own binding (the ERPNext shape).
 * An org with no binding fails closed: there is no deployment-wide credential to fall back to.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { externalConnectEnabled } from './externalConnectEnabled.ts';
import { lookupOrgBindingSecretRef, resolvePerOrgSecret } from './perOrgSecret.ts';

const readVaultSecretVia = (serviceClient: SupabaseClient) => async (ref: string): Promise<string | null> => {
  const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
  if (error) throw new AppError(error.message, error.code);
  return (data as string | null) ?? null;
};

/** The org's ClickUp API token. Throws when the org has no usable binding or the read fails. */
export async function resolveClickUpOrgToken(
  serviceClient: SupabaseClient,
  orgId: string,
  connectEnabled: boolean = externalConnectEnabled(),
): Promise<string> {
  if (!connectEnabled) throw new AppError('external integrations are disabled by the operator', 'config-rejected');
  const result = await resolvePerOrgSecret({
    connectEnabled,
    orgId,
    tier: 'clickup',
    lookupBinding: lookupOrgBindingSecretRef(serviceClient),
    readVaultSecret: readVaultSecretVia(serviceClient),
  });
  if (result.kind === 'resolved') return result.secret;
  if (result.kind === 'no-binding') {
    throw new AppError('ClickUp is not connected for this org', 'config-rejected');
  }
  if (result.kind === 'binding-vault-miss') {
    throw new AppError('ClickUp credentials unresolved for this org — check the binding secret_ref configuration', 'config-rejected');
  }
  throw new AppError('ClickUp credentials could not be read for this org — try again shortly', 'external-unreachable');
}

export interface ClickUpWebhookOrgSecret {
  orgId: string;
  secret: string;
}

/**
 * Every active ClickUp binding's resolved webhook secret. A binding with no webhook secret (or an
 * unresolvable one) contributes nothing, so its deliveries are rejected. A failed read throws (retryable).
 */
export async function resolveClickUpWebhookSecrets(serviceClient: SupabaseClient): Promise<ClickUpWebhookOrgSecret[]> {
  const connectEnabled = externalConnectEnabled();
  if (!connectEnabled) return [];
  const { data, error } = await serviceClient
    .from('external_org_bindings')
    .select('org_id, webhook_secret_ref')
    .eq('external_tier', 'clickup')
    .eq('status', 'active');
  if (error) throw new AppError(error.message, error.code);
  const out: ClickUpWebhookOrgSecret[] = [];
  for (const row of (data as Array<{ org_id: string; webhook_secret_ref: string | null }> | null) ?? []) {
    if (!row.webhook_secret_ref) continue;
    const result = await resolvePerOrgSecret({
      connectEnabled,
      orgId: row.org_id,
      tier: 'clickup',
      column: 'webhook_secret_ref',
      lookupBinding: async () => ({ webhook_secret_ref: row.webhook_secret_ref }),
      readVaultSecret: readVaultSecretVia(serviceClient),
    });
    if (result.kind === 'resolved' && result.secret !== '') out.push({ orgId: row.org_id, secret: result.secret });
    else if (result.kind !== 'binding-vault-miss' && result.kind !== 'no-binding') {
      throw new AppError('webhook secret lookup failed', 'external-unreachable');
    }
  }
  return out;
}
