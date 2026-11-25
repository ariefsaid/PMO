import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * The organisation's standard checks for a new work order (#2898). Kept in work_order_checklist_items (migration 1406)
 * and saved whole through set_work_order_check_template (Admin-only, migration 2680). Each line names a job role and a
 * number of days, never a person: at capture each new Draft copies the live list as tasks due that many days later, owned
 * by the one active holder of the job role (or left for the issuer to assign). The list ships empty. org_id is never sent.
 */
export interface CheckTemplateItem { id: string; label: string; position: number; owner_job_role: string | null; target_days: number | null }
export interface CheckTemplateInput { id?: string | null; label: string; ownerJobRole: string; targetDays: number }

const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

/** The live list, in order. Any member reads it; only an Admin saves it. */
export async function listCheckTemplate(): Promise<CheckTemplateItem[]> {
  const { data, error } = await supabase.from('work_order_checklist_items').select('id, label, position, owner_job_role, target_days')
    .is('archived_at', null).order('position', { ascending: true }).order('id', { ascending: true }).limit(50);
  if (error) fail(error);
  return data ?? [];
}

/** Save the whole ordered list (Admin). Items without an id are new; live items left out are archived. */
export async function saveCheckTemplate(items: CheckTemplateInput[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_work_order_check_template', {
    p_items: items.map((i) => ({ ...(i.id ? { id: i.id } : {}), label: i.label.trim(), owner_job_role: i.ownerJobRole, target_days: i.targetDays })),
  });
  if (error) fail(error);
  return Number(data);
}
