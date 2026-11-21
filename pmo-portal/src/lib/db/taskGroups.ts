import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type TaskGroupRow = Tables<'task_groups'>;

export interface TaskGroupInput {
  name: string;
  milestone_id?: string | null;
}

export interface TaskGroupPatch {
  name?: string;
  /** null unlinks the group from its phase. */
  milestone_id?: string | null;
  /** ISO time archives the group; null restores it. */
  archived_at?: string | null;
}

function throwWrite(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

/** The groups of one project, newest-last. RLS scopes the org; org_id is never sent. */
export async function listTaskGroups(projectId: string): Promise<TaskGroupRow[]> {
  const { data, error } = await supabase
    .from('task_groups')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throwWrite(error);
  return (data ?? []) as TaskGroupRow[];
}

export async function createTaskGroup(input: TaskGroupInput, projectId: string): Promise<void> {
  const { error } = await supabase.from('task_groups').insert({
    project_id: projectId,
    name: input.name.trim(),
    milestone_id: input.milestone_id ?? null,
  });
  if (error) throwWrite(error);
}

export async function updateTaskGroup(id: string, patch: TaskGroupPatch): Promise<void> {
  const next: Partial<Pick<TaskGroupRow, 'name' | 'milestone_id' | 'archived_at'>> = {};
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.milestone_id !== undefined) next.milestone_id = patch.milestone_id;
  if (patch.archived_at !== undefined) next.archived_at = patch.archived_at;
  const { data, error } = await supabase.from('task_groups').update(next).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Task group not found or you do not have permission to edit it.');
}

/** Deleting a group keeps its tasks (FK on delete set null). */
export async function deleteTaskGroup(id: string): Promise<void> {
  const { data, error } = await supabase.from('task_groups').delete().eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Task group not found or you do not have permission to delete it.');
}

/**
 * `tasks.task_group_id` as read back by the tasks select (`*`). Kept out of the generated Row so every existing
 * task fixture stays valid; absent and null both mean "no group".
 */
export interface WithTaskGroup {
  task_group_id?: string | null;
}
