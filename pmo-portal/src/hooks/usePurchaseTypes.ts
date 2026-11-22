import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchaseTypeRepository as repo } from '@/src/lib/repositories/purchaseTypes';
import type { PurchaseTypeInput, RentalExtensionInput } from '@/src/lib/repositories/purchaseTypes';
import { useOrgId } from '@/src/hooks/useOrgId';
import { offWhenModuleOff } from '@/src/hooks/moduleGate';

/** Purchase types (#2697) over the repository seam. Keys carry org_id (tenant scope); every write refreshes the whole root. */
export const PURCHASE_TYPE_QUERY_ROOT = 'purchase-types';

/** FR-PTR-002: whether the organisation turned purchase types on. While loading or off, no type affordance is shown. */
export function usePurchaseTypesEnabled() {
  const orgId = useOrgId();
  return offWhenModuleOff('modulePurchasingExtras', useQuery({ queryKey: [PURCHASE_TYPE_QUERY_ROOT, orgId, 'enabled'], queryFn: () => repo.enabled(), enabled: Boolean(orgId) }));
}

export function usePurchaseTypes() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [PURCHASE_TYPE_QUERY_ROOT, orgId, 'list'], queryFn: () => repo.list(), enabled: Boolean(orgId) });
}

/** FR-PTR-013: the rental this purchase extends and the purchases that extend it. */
export function useRentalLinks(procurementId: string | undefined, extendsId: string | null | undefined, enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: [PURCHASE_TYPE_QUERY_ROOT, orgId, 'links', procurementId, extendsId ?? null],
    queryFn: () => repo.links(procurementId as string, extendsId ?? null),
    enabled: Boolean(orgId) && Boolean(procurementId) && enabled,
  });
}

export function usePurchaseTypeMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = () => qc.invalidateQueries({ queryKey: [PURCHASE_TYPE_QUERY_ROOT, orgId] });
  return {
    setEnabled: useMutation({ mutationFn: (on: boolean) => repo.setEnabled(on), onSuccess: refresh }),
    upsert: useMutation({ mutationFn: (i: PurchaseTypeInput) => repo.upsert(i), onSuccess: refresh }),
    setActive: useMutation({ mutationFn: (a: { id: string; active: boolean }) => repo.setActive(a.id, a.active), onSuccess: refresh }),
  };
}

/** FR-PTR-010: extending a rental creates a new purchase, so the purchase lists and the links refresh. */
export function useExtendRental() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation<string, Error, RentalExtensionInput>({
    mutationFn: (i) => repo.extendRental(i),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['procurements'] }),
      qc.invalidateQueries({ queryKey: [PURCHASE_TYPE_QUERY_ROOT, orgId] }),
    ]),
  });
}
