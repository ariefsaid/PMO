import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * external_domain_ownership READ-ONLY DAL (ADR-0055 P0, FR-EAS-007, AC-EAS-015). Reads the
 * caller's own-org employed external tiers + externally-owned domains (RLS-scoped;
 * `org_id` is NEVER sent). There is NO write path here by design — writes are Operator-only
 * via `operator_set_domain_ownership` (a future ops-admin-surface task), never a client-side
 * DAL writer for this table.
 */

/** DB row shape (snake_case). */
export type ExternalDomainOwnershipDbRow = Tables<'external_domain_ownership'>;

/** FE-facing row shape (camelCase) — the Integrations view source. */
export interface ExternalDomainOwnershipRow {
  id: string;
  orgId: string;
  externalTier: string;
  domain: string;
}

function toRow(db: Pick<ExternalDomainOwnershipDbRow, 'id' | 'org_id' | 'external_tier' | 'domain'>): ExternalDomainOwnershipRow {
  return { id: db.id, orgId: db.org_id, externalTier: db.external_tier, domain: db.domain };
}

/**
 * List the caller's own-org `external_domain_ownership` rows, ordered by tier. RLS
 * (`org_id = auth_org_id()`) scopes the read — no `org_id` filter is sent by the client.
 */
export async function listOwnExternalDomainOwnership(): Promise<ExternalDomainOwnershipRow[]> {
  const { data, error } = await supabase
    .from('external_domain_ownership')
    .select('id, org_id, external_tier, domain')
    .order('external_tier');
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map(toRow);
}
