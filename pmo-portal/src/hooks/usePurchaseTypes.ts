import { useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseTypeRepository as repo } from '@/src/lib/repositories/purchaseTypes';
import type { PurchaseTypeInput, RentalExtensionInput } from '@/src/lib/repositories/purchaseTypes';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { useOffWhenModuleOff } from '@/src/hooks/moduleGate';

/** Purchase types (#2697) over the repository seam. Keys carry org_id (tenant scope); every write refreshes the whole root. */
export const PURCHASE_TYPE_QUERY_ROOT = 'purchase-types';

/** FR-PTR-002: whether the organisation turned purchase types on. While loading or off, no type affordance is shown. */
export function usePurchaseTypesEnabled() {
  return useOffWhenModuleOff('modulePurchasingExtras', useOrgQuery([PURCHASE_TYPE_QUERY_ROOT, 'enabled'], () => repo.enabled()));
}

export function usePurchaseTypes() {
  return useOrgQuery([PURCHASE_TYPE_QUERY_ROOT, 'list'], () => repo.list());
}

/** FR-PTR-013: the rental this purchase extends and the purchases that extend it. */
export function useRentalLinks(procurementId: string | undefined, extendsId: string | null | undefined, enabled: boolean) {
  return useOrgQuery(
    [PURCHASE_TYPE_QUERY_ROOT, 'links', procurementId, extendsId ?? null],
    () => repo.links(procurementId as string, extendsId ?? null),
    { enabled: Boolean(procurementId) && enabled },
  );
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
