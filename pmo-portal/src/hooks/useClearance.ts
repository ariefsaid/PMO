import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clearanceRepository } from '@/src/lib/repositories/clearance';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import type { ClearanceItemInput, ClearanceStateInput } from '@/src/lib/repositories/clearance';

/** Cleared-for-site checklist (#2707) over the repository seam; every key carries org_id (tenant scope). */
const KEY = 'clearance';

/** The organisation switch. Undefined while loading, so callers treat "not known yet" as off. */
export function useClearanceEnabled() {
  return useOrgQuery([KEY, 'enabled'], () => clearanceRepository.enabled(), { staleness: 'session' });
}
export function useSetClearanceEnabled() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (enabled: boolean) => clearanceRepository.setEnabled(enabled), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) });
}
export function useClearanceItems() {
  return useOrgQuery([KEY, 'items'], () => clearanceRepository.items());
}
export function useClearanceSummary() {
  return useOrgQuery([KEY, 'summary'], () => clearanceRepository.summary());
}
/** `on` is the organisation switch: while it is off nothing is fetched. */
export function usePersonChecklist(personId: string, on = true) {
  return useOrgQuery([KEY, 'checklist', personId], () => clearanceRepository.checklist(personId), { enabled: Boolean(personId && on) });
}

/** Item definition changes refresh the items, every checklist and the summary. */
export function useClearanceItemMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [KEY] });
  const create = useMutation({ mutationFn: (v: ClearanceItemInput) => clearanceRepository.createItem(v), onSuccess: refresh });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Partial<ClearanceItemInput> & { archived_at?: string | null } }) => clearanceRepository.updateItem(v.id, v.patch),
    onSuccess: refresh,
  });
  return { create, update };
}
export function useClearanceStateMutations(personId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [KEY] });
  const save = useMutation({ mutationFn: (v: { itemId: string; input: ClearanceStateInput }) => clearanceRepository.saveState(personId, v.itemId, v.input), onSuccess: refresh });
  const clear = useMutation({ mutationFn: (itemId: string) => clearanceRepository.clearState(personId, itemId), onSuccess: refresh });
  return { save, clear };
}
