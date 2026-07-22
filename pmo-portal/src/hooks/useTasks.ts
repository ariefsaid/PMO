import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { TaskWithRefs, TaskInput, TaskPatch, TaskStatus } from '@/src/lib/db/tasks';
import type { ProfileRow } from '@/src/lib/db/profiles';
import { useAuth } from '@/src/auth/useAuth';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  pendingPushAfterWrite,
  type PendingPushState,
} from '@/src/lib/adapterSeam/pendingPush';

/**
 * Org-scoped, per-project Tasks list over the repository seam (ADR-0017). queryKey includes
 * org_id (tenant scope) + project_id (the parent). Disabled until both org + project are known.
 */
export function useTasks(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<TaskWithRefs[]>({
    queryKey: ['tasks', orgId, projectId],
    queryFn: () => repositories.task.list(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/**
 * The assignee-picker source: all profiles in the org. Org-scoped query key; lightly cached
 * (people change rarely). Consumed by the Tasks assignee `<Combobox>`.
 */
export function useAssignableProfiles() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProfileRow[]>({
    queryKey: ['org-profiles', orgId],
    queryFn: () => repositories.profile.listOrgProfiles(),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });
}

export interface UpdateTaskArgs {
  id: string;
  patch: TaskPatch;
}
export interface UpdateTaskStatusArgs {
  id: string;
  status: TaskStatus;
}
export interface DependencyArgs {
  taskId: string;
  dependsOnId: string;
}

/**
 * Task create / update-structure / update-status / delete + dependency add/remove mutations over
 * the repository seam, scoped to one project. Each invalidates the exact `['tasks', org, project]`
 * query on success so the list/board refetches. Errors propagate as `AppError` (code preserved)
 * for the caller to classify via `classifyMutationError`.
 */
export function useTaskMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
    // Milestone calculated_pct + project delivery_pct re-derive from task Done counts —
    // invalidate both so the MilestoneStrip and DeliveryPctChip update immediately.
    void qc.invalidateQueries({ queryKey: ['milestones', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['projects-delivery'] });
  };

  // ADR-0056 / AC-CUA-060 — the per-task pending-push state for externally-owned writes. Keyed by
  // task id; only ever populated when `routeTaskWrite(projectId) === 'external'` (PMO-owned writes stay idle
  // → no badge — AC-CUA-061). `pushed` is a transient confirmation that auto-clears; `push-failed`
  // persists until the next write to that task so the failure stays visible.
  const [pendingPushByTask, setPendingPushByTask] = useState<Record<string, PendingPushState>>({});
  const pushTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const clearPushTimer = (id: string) => {
    const t = pushTimers.current[id];
    if (t) {
      clearTimeout(t);
      delete pushTimers.current[id];
    }
  };
  const setPush = (id: string, next: PendingPushState) =>
    setPendingPushByTask((prev) => ({ ...prev, [id]: next }));
  const clearPush = (id: string) =>
    setPendingPushByTask((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const create = useMutation({
    mutationFn: (input: TaskInput) => repositories.task.create(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: UpdateTaskArgs) => repositories.task.update(id, patch, projectId),
    onMutate: ({ id }) => {
      // FR-CUA-070 breadth (review fix #4): the edit-modal save is ALSO an external write origin —
      // surface its push state on the row + the edit modal, not just status writes.
      if (routeTaskWrite(projectId) === 'external') {
        clearPushTimer(id);
        setPush(id, beginPush(IDLE_PENDING_PUSH));
      }
    },
    onSuccess: (_data, { id }) => {
      invalidate();
      if (routeTaskWrite(projectId) === 'external') {
        setPush(id, pendingPushAfterWrite('external', { ok: true }));
        clearPushTimer(id);
        pushTimers.current[id] = setTimeout(() => {
          clearPush(id);
          delete pushTimers.current[id];
        }, 1500);
      }
    },
    onError: (err, { id }) => {
      if (routeTaskWrite(projectId) === 'external') {
        clearPushTimer(id);
        setPush(id, pendingPushAfterWrite('external', { ok: false, err }));
      }
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: UpdateTaskStatusArgs) => repositories.task.updateStatus(id, status, projectId),
    onMutate: ({ id }) => {
      if (routeTaskWrite(projectId) === 'external') {
        clearPushTimer(id);
        setPush(id, beginPush(IDLE_PENDING_PUSH));
      }
    },
    onSuccess: (_data, { id }) => {
      invalidate();
      if (routeTaskWrite(projectId) === 'external') {
        setPush(id, pendingPushAfterWrite('external', { ok: true }));
        clearPushTimer(id);
        // Transient success confirmation — fades so a card never carries a stale "Pushed".
        pushTimers.current[id] = setTimeout(() => {
          clearPush(id);
          delete pushTimers.current[id];
        }, 1500);
      }
    },
    onError: (err, { id }) => {
      if (routeTaskWrite(projectId) === 'external') {
        clearPushTimer(id);
        setPush(id, pendingPushAfterWrite('external', { ok: false, err }));
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.task.delete(id, projectId),
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      archived
        ? repositories.task.archive(id, projectId)
        : repositories.task.unarchive(id, projectId),
    onSuccess: invalidate,
  });

  const addDependency = useMutation({
    mutationFn: ({ taskId, dependsOnId }: DependencyArgs) =>
      repositories.task.addDependency(taskId, dependsOnId),
    onSuccess: invalidate,
  });

  const removeDependency = useMutation({
    mutationFn: ({ taskId, dependsOnId }: DependencyArgs) =>
      repositories.task.removeDependency(taskId, dependsOnId),
    onSuccess: invalidate,
  });

  // Clear any in-flight auto-clear timers on unmount so a session change never fires a stale update.
  useEffect(
    () => () => {
      for (const t of Object.values(pushTimers.current)) clearTimeout(t);
      pushTimers.current = {};
    },
    [],
  );

  return { create, update, updateStatus, remove, archive, addDependency, removeDependency, pendingPushByTask };
}
