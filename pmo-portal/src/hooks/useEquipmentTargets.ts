import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { DEFAULT_EQUIPMENT_TARGETS, type EquipmentTargets } from '@/src/lib/db/equipmentAvailability';

/** Equipment targets and escalation limit (#2701) over the repository seam (ADR-0017). Key carries org_id (tenant scope). */
const KEY = 'equipment-availability';

export function useEquipmentTargets() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: [KEY, orgId, 'targets'], queryFn: () => repositories.equipmentAvailability.getTargets(), enabled: Boolean(orgId) });
}
export function useSetEquipmentTargets() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: repositories.equipmentAvailability.setTargets, onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) });
}

/** The loaded settings for the screen below; the defaults (limit 2, no target) until loaded or when there is no provider. */
export const EquipmentTargetsContext = createContext<EquipmentTargets>(DEFAULT_EQUIPMENT_TARGETS);
export const useEquipmentTargetValues = (): EquipmentTargets => useContext(EquipmentTargetsContext);
