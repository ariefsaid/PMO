import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables, TablesUpdate } from '@/src/lib/supabase/database.types';

export type MilestoneRow = Tables<'project_milestones'>;

/**
 * A milestone row enriched with the server-derived %s (from get_project_milestones RPC, D-3).
 * calculated_pct is null when the milestone has no tasks (nullif on the denominator).
 * effective_pct = coalesce(input_pct, calculated_pct, 0).
 */
export interface MilestoneWithProgress {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  target_date: string | null;
  weight: number;
  input_pct: number | null;
  task_count: number;
  calculated_pct: number | null;
  effective_pct: number;
}

export interface ProjectDeliverySummary {
  deliveryPct: number | null;
  committedSpend: number;
  budget: number;
}

/** Create form fields. org_id is NEVER among them — RLS stamps it. */
export interface MilestoneInput {
  name: string;
  sort_order: number;
  target_date: string | null;
  weight: number;
}

/** Edit patch — any subset, incl. input_pct: null to clear it (FR-DEL-009). */
export interface MilestonePatch {
  name?: string;
  sort_order?: number;
  target_date?: string | null;
  weight?: number;
  input_pct?: number | null;
}

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List milestones for a project with server-derived calculated %, effective %, and task_count
 * (AC-DEL-008..010 consume this shape). Uses the get_project_milestones security-invoker RPC
 * (D-3; FR-DEL-004/005/012). Ordered by sort_order, then created_at.
 */
export async function listMilestones(projectId: string): Promise<MilestoneWithProgress[]> {
  const { data, error } = await supabase.rpc('get_project_milestones', {
    p_project_id: projectId,
  });
  if (error) throwWrite(error);
  const rows = (data ?? []) as Array<{
    id: string;
    project_id: string;
    name: string;
    sort_order: number;
    target_date: string | null;
    weight: number;
    input_pct: number | null;
    task_count: number;
    calculated_pct: number | null;
    effective_pct: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    sort_order: r.sort_order,
    target_date: r.target_date ?? null,
    weight: r.weight,
    input_pct: r.input_pct ?? null,
    task_count: r.task_count,
    calculated_pct: r.calculated_pct ?? null,
    effective_pct: r.effective_pct,
  }));
}

export async function getProjectsDeliverySummary(
  ids: string[],
): Promise<Record<string, ProjectDeliverySummary>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('get_projects_delivery', { p_ids: ids });
  if (error) throwWrite(error);
  const map: Record<string, ProjectDeliverySummary> = {};
  for (const row of data ?? []) {
    if (row.project_id != null) {
      map[row.project_id] = {
        deliveryPct: row.delivery_pct ?? null,
        committedSpend: row.committed_spend,
        budget: row.budget,
      };
    }
  }
  return map;
}

/**
 * Get the weight-weighted project delivery % for a batch of project ids (FR-DEL-017, D-2).
 * Returns a { [project_id]: delivery_pct } map. An absent key means the project has no milestones.
 * Skips the RPC call (returns {}) when ids is empty (NFR-DEL-PERF-001).
 */
export async function getProjectsDelivery(ids: string[]): Promise<Record<string, number>> {
  const summary = await getProjectsDeliverySummary(ids);
  return Object.fromEntries(
    Object.entries(summary)
      .filter(([, row]) => row.deliveryPct != null)
      .map(([id, row]) => [id, row.deliveryPct as number]),
  );
}

/**
 * A dated milestone for the read-only Project Calendar view (FR-CAL-002). Only
 * milestones with a non-null target_date are returned (the RPC filters server-side).
 */
export interface MilestoneDate {
  id: string;
  projectId: string;
  name: string;
  targetDate: string; // YYYY-MM-DD
}

/**
 * Batch read of dated milestones across a set of projects for the calendar view
 * (NFR-CAL-PERF-001 — one call, no per-project N+1). security-invoker RPC; RLS on
 * project_milestones (migration 0023, org_id = auth_org_id()) scopes rows — org_id is
 * NEVER sent from the client. Empty ids short-circuit to [] (no round-trip). Milestones
 * with a null target_date are excluded server-side (OBS-CAL-001).
 */
export async function getProjectsMilestoneDates(ids: string[]): Promise<MilestoneDate[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('get_projects_milestone_dates', { p_ids: ids });
  if (error) throwWrite(error);
  const rows = (data ?? []) as Array<{
    id: string;
    project_id: string;
    name: string;
    target_date: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    targetDate: r.target_date,
  }));
}

/**
 * Create a milestone (FR-DEL-008). org_id is NEVER sent — the column default + RLS stamps it.
 * input_pct defaults to null. Throws AppError (code preserved) on failure.
 */
export async function createMilestone(
  input: MilestoneInput,
  projectId: string,
): Promise<MilestoneRow> {
  const { data, error } = await supabase
    .from('project_milestones')
    .insert({
      project_id: projectId,
      name: input.name,
      sort_order: input.sort_order,
      target_date: input.target_date || null,
      weight: input.weight,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as MilestoneRow;
}

/**
 * Update a milestone (FR-DEL-009). Only the keys present in `patch` are sent.
 * `input_pct` present-and-null explicitly clears it (distinguished from absent/undefined).
 * Throws AppError (code preserved) on failure.
 */
export async function updateMilestone(id: string, patch: MilestonePatch): Promise<void> {
  const next: TablesUpdate<'project_milestones'> = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.sort_order !== undefined) next.sort_order = patch.sort_order;
  if (patch.target_date !== undefined) next.target_date = patch.target_date || null;
  if (patch.weight !== undefined) next.weight = patch.weight;
  if (patch.input_pct !== undefined) next.input_pct = patch.input_pct; // null clears it
  const { error } = await supabase.from('project_milestones').update(next).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete a milestone (FR-DEL-010, D-1). The FK ON DELETE SET NULL un-groups dependent tasks
 * automatically. Admin + PM only (RLS is the authority; the FE gates via can()).
 * Throws AppError (code preserved) on failure.
 */
export async function deleteMilestone(id: string): Promise<void> {
  const { error } = await supabase.from('project_milestones').delete().eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Assign or unassign a task's milestone_id (FR-DEL-011). Passing null ungroups the task.
 * org_id is NEVER sent — RLS scopes the update. Throws AppError (code preserved) on failure.
 */
export async function updateTaskMilestone(
  taskId: string,
  milestoneId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ milestone_id: milestoneId })
    .eq('id', taskId);
  if (error) throwWrite(error);
}
