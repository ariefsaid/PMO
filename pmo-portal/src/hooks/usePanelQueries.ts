/**
 * usePanelQueries — runs each compiled panel's query independently and exposes results keyed by
 * panel id. A panel settles as soon as its own query does (a slow panel never holds the others
 * in skeleton). Query identity includes the org and compiled query, so identical panels share one
 * request and a result from a replaced view cannot be shown under its new query.
 */
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import type { CompiledPanel } from '@/src/lib/viewspec/types';

export interface PanelQueryState {
  loading: boolean;
  data: unknown[] | null;
  error: Error | null;
}

export const PANEL_LOADING: PanelQueryState = { loading: true, data: null, error: null };

export function usePanelQueries(panels: CompiledPanel[] | null) {
  const orgId = useAuth().currentUser?.org_id;
  const uniqueQueries = [...new Map((panels ?? []).map((panel) => [JSON.stringify(panel.compiledQuery), panel])).values()];
  const queryResults = useQueries({
    queries: uniqueQueries.map((panel) => ({
      queryKey: ['view-panel-query', orgId, panel.compiledQuery] as const,
      queryFn: () => executeCompiledQuery(panel.compiledQuery),
      enabled: Boolean(orgId),
    })),
  });
  const queryIndexByKey = new Map(uniqueQueries.map((panel, index) => [JSON.stringify(panel.compiledQuery), index]));
  const states = Object.fromEntries((panels ?? []).map((panel) => {
    const query = queryResults[queryIndexByKey.get(JSON.stringify(panel.compiledQuery)) ?? -1];
    return [panel.id, query
      ? { loading: query.isPending || query.isFetching, data: query.isPending || query.isFetching ? null : query.data ?? null, error: query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null }
      : PANEL_LOADING];
  }));
  const retry = (panel: CompiledPanel) => {
    const index = queryIndexByKey.get(JSON.stringify(panel.compiledQuery)) ?? -1;
    if (index >= 0) void queryResults[index]?.refetch();
  };
  return { states, retry };
}
