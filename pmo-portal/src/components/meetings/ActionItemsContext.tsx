import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { NoteBlock } from '@/src/lib/meetingNotes';

/**
 * #2106 AC-PERF-2106-3 — every action item on one minutes page, in ONE task read.
 *
 * An `actionItem` block stores only `props.taskId` (DD-MTG-2), so each block rendered its own `task.get(taskId)`:
 * 10-20 requests per minutes open, each with its own spinner. The minutes document knows every id up front, so it
 * can ask once. The provider:
 *   • collects the ids from the document (nested blocks included, blanks skipped, de-duplicated);
 *   • reads them with the single `.in('id', ids)` repository call;
 *   • seeds each task's own `['tasks', org, 'one', id]` entry, so a block inserted later (or another screen reading
 *     that key) starts from the same facts instead of an empty cache;
 *   • hands the blocks a map of resolved tasks, so a block in the batch performs no request of its own.
 *
 * A block whose id is NOT in the batch (one inserted since the minutes were loaded) keeps its own single read — that
 * is a genuinely new task, not an N+1. Data layer only: no markup or style is added here.
 */

/** The task ids an `actionItem` block references, in document order, de-duplicated. Blank ids (copied templates) skipped. */
// eslint-disable-next-line react-refresh/only-export-components -- pure id collector co-located with its provider; HMR-only lint concern
export function actionItemTaskIds(blocks: readonly NoteBlock[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly NoteBlock[]): void => {
    for (const block of list) {
      if (block.type === 'actionItem') {
        const taskId = block.props?.taskId;
        if (typeof taskId === 'string' && taskId !== '' && !seen.has(taskId)) {
          seen.add(taskId);
          ids.push(taskId);
        }
      }
      if (Array.isArray(block.children) && block.children.length > 0) walk(block.children);
    }
  };
  walk(blocks);
  return ids;
}

export interface ActionItemsBatch {
  /** The ids this batch covers — the only ones that must not read on their own. */
  ids: ReadonlySet<string>;
  status: 'loading' | 'ready' | 'error';
  /** id → the live task, or null when it no longer resolves (a tombstone, FR-MTG-019). Filled only when ready. */
  byId: ReadonlyMap<string, TaskWithRefs | null>;
}

const ActionItemsContext = createContext<ActionItemsBatch | null>(null);

/** The minutes page's action-item batch, or null outside it (a standalone block keeps its own read). */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider; HMR-only lint concern
export function useActionItemsBatch(): ActionItemsBatch | null {
  return useContext(ActionItemsContext);
}

export const ActionItemsProvider: React.FC<{ blocks: readonly NoteBlock[]; children: React.ReactNode }> = ({ blocks, children }) => {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  const ids = useMemo(() => actionItemTaskIds(blocks), [blocks]);
  const query = useQuery({
    // Under the `tasks` root, so every shipped task invalidation (invalidateTaskProjections) refreshes it too.
    queryKey: ['tasks', orgId, 'batch', ids],
    queryFn: () => repositories.task.listByIds(ids),
    enabled: Boolean(orgId) && ids.length > 0,
  });
  const tasks = query.data;
  useEffect(() => {
    for (const task of tasks ?? []) qc.setQueryData(['tasks', orgId, 'one', task.id], task);
  }, [tasks, orgId, qc]);
  const value = useMemo<ActionItemsBatch>(() => {
    const requested = new Set(ids);
    if (requested.size === 0) return { ids: requested, status: 'ready', byId: new Map() };
    if (query.isError) return { ids: requested, status: 'error', byId: new Map() };
    if (!query.isSuccess) return { ids: requested, status: 'loading', byId: new Map() };
    const byId = new Map<string, TaskWithRefs | null>(ids.map((id) => [id, null] as const));
    for (const task of tasks ?? []) byId.set(task.id, task);
    return { ids: requested, status: 'ready', byId };
  }, [ids, query.isError, query.isSuccess, tasks]);
  return <ActionItemsContext.Provider value={value}>{children}</ActionItemsContext.Provider>;
};
