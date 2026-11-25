import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { StageNameRow } from '@/src/lib/status/orgStageNames';

/**
 * #2906: the organisation's stage names, on pipeline_stage_config (one row per stage key). `org_id` is never
 * sent: RLS scopes the read to the caller's organisation and lets only an active Admin write.
 */
const STAGE_COUNT = 12;

export async function listStageNames(): Promise<StageNameRow[]> {
  const { data, error } = await supabase
    .from('pipeline_stage_config')
    .select('status, label_en, label_id')
    .limit(STAGE_COUNT); // bounded: one row per stage key
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as StageNameRow[];
}

/** `others` = the names the OTHER stages show in the same language. ponytail: compares against saved names
 *  and English shipped words only; a clash with a shipped Bahasa word is not caught (cosmetic, fixable by renaming). */
export function validateStageName(name: string, others: readonly string[]): 'tooLong' | 'duplicate' | null {
  const n = name.trim();
  if (!n) return null;
  if (n.length > 40) return 'tooLong';
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase())) return 'duplicate';
  return null;
}

export async function saveStageName(status: string, names: { en: string; id: string }): Promise<void> {
  const { data, error } = await supabase
    .from('pipeline_stage_config')
    .update({ label_en: names.en.trim() || null, label_id: names.id.trim() || null })
    .eq('status', status as never)
    .select('status');
  if (error) throw new AppError(error.message, error.code);
  if (!data?.length) throw new AppError('not authorized', '42501');
}
