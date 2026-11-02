import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import type { ProjectStatus } from './projectTransitions';

/** #1638 — one stage a deal entered (supabase/migrations/0448_pipeline_stage_history.sql). */
export interface StageEntry {
  id: string;
  project_id: string;
  stage: ProjectStatus;
  entered_on: string;
  position: number;
  source: 'origination' | 'transition' | 'added' | 'import' | 'backfill';
  recorded_at: string;
  redated_at: string | null;
  recorder: { full_name: string } | null;
}
export type ImportStageDate = { stage: ProjectStatus; entered_on: string };

/** Journey newest-first. org_id is never sent — RLS scopes rows. */
export async function listStageEntries(projectId: string): Promise<StageEntry[]> {
  const { data, error } = await supabase
    .from('project_stage_entries')
    .select('id, project_id, stage, entered_on, position, source, recorded_at, redated_at, recorder:profiles!project_stage_entries_recorded_by_fkey(full_name)')
    .eq('project_id', projectId)
    .order('position', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as StageEntry[];
}

export async function redateStageEntry(entryId: string, enteredOn: string): Promise<void> {
  const { error } = await supabase.rpc('redate_stage_entry', { p_entry_id: entryId, p_entered_on: enteredOn });
  if (error) throw toAppError(error);
}

export async function addSkippedStageEntry(beforeEntryId: string, stage: ProjectStatus, enteredOn: string): Promise<void> {
  const { error } = await supabase.rpc('add_skipped_stage_entry', {
    p_before_entry_id: beforeEntryId, p_stage: stage, p_entered_on: enteredOn,
  });
  if (error) throw toAppError(error);
}

export async function importProjectStageHistory(projectId: string, entries: ImportStageDate[]): Promise<void> {
  const { error } = await supabase.rpc('import_project_stage_history', { p_project_id: projectId, p_entries: entries });
  if (error) throw toAppError(error);
}
