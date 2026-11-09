import { useCallback, useContext, useRef } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { queryClient as fallbackQueryClient } from '@/src/lib/queryClient';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import type { Role } from '@/src/auth/AuthContext';
import { projectRepository } from '@/src/lib/repositories/projects';
import { projectKeys } from './projectQueryKeys';

/**
 * Prefetches the project record on hover, focus, or click before navigation.
 * Uses the exact org-scoped query key, avoids cross-user/org cache bleed,
 * dedupes rapid triggers within 10s, and preserves permissions.
 */
export function usePrefetchProject() {
  const contextClient = useContext(QueryClientContext);
  const qc = contextClient ?? fallbackQueryClient;
  const auth = useAuth();
  const orgId = auth.currentUser?.org_id;
  const role = (auth.role ?? auth.currentUser?.role) as Role | undefined;
  const prefetchedRef = useRef<Map<string, number>>(new Map());

  return useCallback(
    (id: string | undefined) => {
      if (!id || !orgId) return;
      if (!can('view', 'project', { realRole: role ?? null })) return;
      const now = Date.now();
      const last = prefetchedRef.current.get(id) ?? 0;
      if (now - last < 10_000) return;
      prefetchedRef.current.set(id, now);

      void qc.prefetchQuery({
        queryKey: projectKeys.detail(orgId, id),
        queryFn: () => projectRepository.getWithRefs(id),
        staleTime: 30_000,
      });
    },
    [qc, orgId, role],
  );
}
