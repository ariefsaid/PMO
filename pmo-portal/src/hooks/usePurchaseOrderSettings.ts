import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';

export const PO_SETTINGS_QUERY_KEY = 'purchase-order-settings';

/**
 * Hook to read organisation-wide purchase order print settings (#2688).
 */
export function usePurchaseOrderSettings() {
  return useOrgQuery([PO_SETTINGS_QUERY_KEY], () => repositories.procurement.purchaseOrderSettings());
}

/**
 * Hook to mutate organisation-wide purchase order print settings (#2688).
 */
export function usePurchaseOrderSettingsMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
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
