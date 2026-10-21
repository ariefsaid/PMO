import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { RecordFolderOutcome, RecordFolderTarget } from '@/src/lib/m365/recordFolders';
import { recordFolderErrorCopy, recordFolderOutcomeCopy } from '@/src/lib/m365/recordFolderCopy';
import { invalidateRecordFolderRegister, recordFolderKey, writeRecordFolderState, type RecordFolderState } from './recordFolderState';

/**
 * The register's view of one record's folder step (AC-M365DOC-071): the shared cache state the
 * create-success coordinator writes, plus the ONE explicit `ensure` action (also the retry). It
 * never runs on mount, refetch or reconnect, never retries on its own, and is a no-op while a
 * start (from either path) is already pending.
 */
export function useRecordFolder(target: RecordFolderTarget) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id ?? null;
  const userId = currentUser?.id ?? null;
  const key = recordFolderKey(orgId, userId, target);

  // Read-only subscription to the cache entry; it is only ever written with setQueryData.
  const { data } = useQuery<RecordFolderState | null>({
    queryKey: key,
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  const state = data ?? null;

  const mutation = useMutation<RecordFolderOutcome, unknown, void>({
    retry: false,
    mutationFn: () => repositories.m365RecordFolders.ensure(target),
    onSuccess: (outcome) => {
      const copy = recordFolderOutcomeCopy(outcome);
      writeRecordFolderState(qc, key, { status: 'settled', copy });
      if (copy.ok) invalidateRecordFolderRegister(qc, orgId, target);
    },
    onError: (error) => {
      writeRecordFolderState(qc, key, { status: 'settled', copy: recordFolderErrorCopy(error) });
    },
  });

  const pending = state?.status === 'pending' || mutation.isPending;
  const ensure = useCallback(() => {
    if (!orgId || !userId) return;
    if ((qc.getQueryData(key) as RecordFolderState | undefined)?.status === 'pending') return;
    // Mark pending synchronously so a double activation cannot start two ensures.
    writeRecordFolderState(qc, key, { status: 'pending' });
    mutation.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `mutation.mutate` is stable; key is derived from the listed values
  }, [qc, orgId, userId, target.kind, target.id, mutation.mutate]);

  return {
    state,
    pending,
    settledCopy: state?.status === 'settled' ? state.copy : null,
    ensure,
  };
}
