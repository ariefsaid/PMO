import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { CalendarTask, TaskPatch } from '@/src/lib/db/tasks';
import { useAuth } from '@/src/auth/useAuth';
import { invalidateTaskProjections } from './taskQueryKeys';

/**
 * Dated tasks in a visible `[from, to)` window: org-wide, or one project. ONE read per window
 * (never per project). Held disabled until the calendar reports its first window.
 */
export function useCalendarTasks(window: { from: string; to: string } | null, projectId?: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CalendarTask[]>({
    queryKey: ['calendar-tasks', orgId, projectId ?? 'all', window?.from, window?.to],
    queryFn: () => repositories.task.listCalendar({ ...window!, projectId }),
    enabled: Boolean(orgId) && window !== null,
    placeholderData: (previous) => previous, // keep the grid painted while the next window loads
  });
}

/** Save a calendar drop through the task repository (the same `update` an edit uses). */
export function useMoveCalendarTask() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useMutation({
    mutationFn: ({ task, patch }: { task: CalendarTask; patch: Pick<TaskPatch, 'start_date' | 'end_date'> }) =>
      repositories.task.update(task.id, patch, task.project_id ?? undefined),
    onSuccess: (_data, { task }) => invalidateTaskProjections(qc, orgId, task.project_id),
  });
}
