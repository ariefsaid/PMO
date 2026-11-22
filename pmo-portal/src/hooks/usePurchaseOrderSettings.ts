import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { enabledOffWhenModuleOff } from '@/src/hooks/moduleGate';

export const PO_SETTINGS_QUERY_KEY = 'purchase-order-settings';

/**
 * Hook to read organisation-wide purchase order print settings (#2688).
 */
export function usePurchaseOrderSettings() {
  const orgId = useAuth().currentUser?.org_id;
  return enabledOffWhenModuleOff('modulePurchasingExtras', useQuery({
    queryKey: [PO_SETTINGS_QUERY_KEY, orgId],
    queryFn: () => repositories.procurement.purchaseOrderSettings(),
    enabled: Boolean(orgId),
  }));
}

/**
 * Hook to mutate organisation-wide purchase order print settings (#2688).
 */
export function usePurchaseOrderSettingsMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const refresh = () => qc.invalidateQueries({ queryKey: [PO_SETTINGS_QUERY_KEY, orgId] });

  return {
    setSettings: useMutation({
      mutationFn: (a: {
        enabled: boolean;
        signatureBlocks: string[];
        authorisedCollectors: string[];
      }) =>
        repositories.procurement.setPurchaseOrderSettings(
          a.enabled,
          a.signatureBlocks,
          a.authorisedCollectors,
        ),
      onSuccess: refresh,
    }),
  };
}
