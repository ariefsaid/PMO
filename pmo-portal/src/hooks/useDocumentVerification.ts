import { useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { checkMicrosoftDocuments } from '@/src/lib/m365/graphClient';

const DAY_MS = 86_400_000;

export interface VerifiableDocument {
  id: string;
  source?: string | null;
  status: string;
  ms_item_kind?: string | null;
  ms_last_verified_at?: string | null;
}

/**
 * Controlled project files whose last SUCCESSFUL check is missing or at least a day old. Drafts and
 * folders are never checked; the claim/attempt time is not a verification time and is never read.
 */
export function staleControlledFileIds(rows: readonly VerifiableDocument[], now: number = Date.now()): string[] {
  return rows
    .filter((d) => d.source === 'onedrive' && d.ms_item_kind === 'file' && d.status !== 'Draft'
      && (!d.ms_last_verified_at || !(now - Date.parse(d.ms_last_verified_at) < DAY_MS)))
    .map((d) => d.id)
    .sort();
}

/**
 * Display-triggered content check (AC-M365DOC-064): when stale controlled files are on screen, ask
 * the server to check them once per stable sorted batch, then refresh the register. No timer, no
 * focus/reconnect refetch. The query key is caller-scoped, so the table and Drawer (or two mounts)
 * share one in-flight check, an account switch never reuses another caller's result, and a failed
 * check is not retried by the same display - `retry()` or a new display (remount) runs it again.
 */
export function useDocumentVerification(projectId: string, rows: readonly VerifiableDocument[] | undefined, enabled = true) {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const retryAttempt = useRef<{ identity: string; ids: string[] | undefined } | undefined>(undefined);
  const orgId = currentUser?.org_id ?? null;
  const userId = currentUser?.id ?? null;
  const ids = useMemo(() => staleControlledFileIds(rows ?? []), [rows]);
  // Membership stays stable when a successful chunk updates verification timestamps.
  const displayKey = (rows ?? []).filter((d) => d.source === 'onedrive' && d.ms_item_kind === 'file' && d.status !== 'Draft')
    .map((d) => d.id).sort().join(',');
  const queryKey = ['m365-document-check', orgId, userId, projectId, displayKey] as const;
  const identity = JSON.stringify(queryKey);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        await checkMicrosoftDocuments(retryAttempt.current?.identity === identity ? retryAttempt.current.ids ?? ids : ids);
      } finally {
        // A not_verified outcome is persisted too, so refresh on failure as well as success.
        await queryClient.invalidateQueries({ queryKey: ['project-documents', orgId, projectId] });
      }
      return ids.length;
    },
    enabled: Boolean(enabled && orgId && userId && projectId && ids.length > 0),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    documentIds: ids, checking: query.isFetching, error: query.error,
    retry: (visibleRows?: readonly VerifiableDocument[]) => {
      const attempt = { identity, ids: visibleRows ? staleControlledFileIds(visibleRows) : undefined };
      retryAttempt.current = attempt;
      void query.refetch().finally(() => { if (retryAttempt.current === attempt) retryAttempt.current = undefined; });
    },
  };
}
