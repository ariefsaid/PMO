import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { IntegrationBinding } from '@/src/lib/repositories/types';
import { useAuth } from '@/src/auth/useAuth';

/**
 * The caller's own-org ERPNext binding (or null when the org has none).
 *
 * ⚑ This is the spec-faithful "does this org employ ERPNext" signal (FR-BUD-010): employment is asserted
 * by the ACTIVE binding, NOT by a `domain_externally_owned('budget')` flip (which the spec forbids,
 * FR-BUD-006(a)). It mirrors the server-side `orgEmploysErpnext` predicate (an active erpnext binding)
 * and the way `IntegrationsView` learns a tier is connected (`getBinding(tier)?.status === 'active'`).
 */
export function useErpnextBinding() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IntegrationBinding | null>({
    queryKey: ['integrations', 'binding', orgId, 'erpnext'],
    queryFn: () => repositories.integrations.getBinding(orgId!, 'erpnext'),
    enabled: Boolean(orgId),
  });
}
