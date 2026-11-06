import { useQuery } from '@tanstack/react-query';
import { integrationHealthQueryKey } from '@/src/hooks/useIntegrations';
import type { ExternalTier, IntegrationHealth } from '@/src/lib/repositories/types';

/**
 * A per-tier, discriminated display state for a connected service's health read (AC-IRUX-003/004).
 * A success, a reject, or a still-pending read for ONE tier resolves independently, so a failed or
 * slow service never collapses a healthy sibling to a blank/negative state.
 */
export type TierHealthState =
  | { kind: 'loading' }
  | { kind: 'available'; health: IntegrationHealth }
  | { kind: 'unavailable' };

/**
 * One query per service lets a fast service render while another is still loading.
 * Uses the shared `integrationHealthQueryKey` so connect/disconnect/activation mutations can
 * invalidate the whole `['integrations', 'health', orgId]` family (AC-IRUX-009).
 */
export function useIntegrationsHealth(
  orgId: string | undefined,
  connectedTiers: ExternalTier[],
  getHealth: (tier: ExternalTier) => Promise<IntegrationHealth>,
) {
  const options = (tier: ExternalTier) => ({
    queryKey: integrationHealthQueryKey(orgId, tier),
    queryFn: () => getHealth(tier),
    enabled: Boolean(orgId) && connectedTiers.includes(tier),
    retry: false,
  });
  const clickup = useQuery(options('clickup'));
  const erpnext = useQuery(options('erpnext'));
  const state = (result: typeof clickup): TierHealthState => {
    if (result.isError) return { kind: 'unavailable' };
    if (result.isPending) return { kind: 'loading' };
    return result.data ? { kind: 'available', health: result.data } : { kind: 'unavailable' };
  };
  return {
    clickup: { state: state(clickup), refetch: clickup.refetch },
    erpnext: { state: state(erpnext), refetch: erpnext.refetch },
  };
}
