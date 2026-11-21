import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { siteCheckpointRepository as repo } from '@/src/lib/repositories/siteCheckpoints';
import type { CheckpointTemplateItem, PunctualityFilter } from '@/src/lib/repositories/siteCheckpoints';

/** #2594 timed checkpoint hooks. Keys are org-scoped (FR-QRY-002); a write refreshes the whole checkpoint family. */
const root = (orgId: string | undefined) => ['site-checkpoints', orgId] as const;
export const checkpointKeys = {
  root,
  list: (orgId: string | undefined) => [...root(orgId), 'list'] as const,
  day: (orgId: string | undefined, workOrderId: string | undefined, date: string | undefined) => [...root(orgId), 'day', workOrderId, date] as const,
  flag: (orgId: string | undefined, workOrderId: string | undefined) => [...root(orgId), 'flag', workOrderId] as const,
  punctuality: (orgId: string | undefined, f: PunctualityFilter) => [...root(orgId), 'punctuality', f] as const,
  lostTime: (orgId: string | undefined, f: PunctualityFilter) => [...root(orgId), 'lost-time', f] as const,
};

const useOrg = () => useAuth().currentUser?.org_id;

export function useCheckpointList(enabled = true) {
  const orgId = useOrg();
  return useQuery({ queryKey: checkpointKeys.list(orgId), queryFn: () => repo.getList(), enabled: Boolean(orgId) && enabled });
}

export function useSetCheckpointList() {
  const orgId = useOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: CheckpointTemplateItem[]) => repo.setList(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: root(orgId) }),
  });
}

export function useDayCheckpoints(workOrderId: string | undefined, date: string | undefined) {
  const orgId = useOrg();
  return useQuery({
    queryKey: checkpointKeys.day(orgId, workOrderId, date),
    queryFn: () => repo.day(workOrderId as string, date as string),
    enabled: Boolean(orgId && workOrderId && date),
  });
}

export function useWorkOrderCheckpointFlag(workOrderId: string | undefined) {
  const orgId = useOrg();
  return useQuery({ queryKey: checkpointKeys.flag(orgId, workOrderId), queryFn: () => repo.flag(workOrderId as string), enabled: Boolean(orgId && workOrderId) });
}

export function useRecordCheckpoint() {
  const orgId = useOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { checkpointId: string; file: File | null; note: string | null }) => {
      const refs = await repo.recordRefs(v.checkpointId);
      await repo.record({ checkpoint: refs, file: v.file, note: v.note });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: root(orgId) }),
  });
}

export function useCrewPunctuality(filter: PunctualityFilter, enabled = true) {
  const orgId = useOrg();
  return useQuery({ queryKey: checkpointKeys.punctuality(orgId, filter), queryFn: () => repo.punctuality(filter), enabled: Boolean(orgId) && enabled });
}

export function useLostTimeByCause(filter: PunctualityFilter, enabled = true) {
  const orgId = useOrg();
  return useQuery({ queryKey: checkpointKeys.lostTime(orgId, filter), queryFn: () => repo.lostTime(filter), enabled: Boolean(orgId) && enabled });
}

