import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import { nullableArg } from './nullableArg';

/** A work order's responsible person (the site engineer; usage-warning spec FR-UW-010). Null = none: the usage warning then goes to the project manager. */
export async function getWorkOrderResponsiblePerson(workOrderId: string): Promise<string | null> {
  const { data, error } = await supabase.from('work_orders').select('responsible_person_id').eq('id', workOrderId).maybeSingle();
  if (error) throw toAppError(error);
  return data?.responsible_person_id ?? null;
}

export async function setWorkOrderResponsiblePerson(workOrderId: string, personId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_work_order_responsible_person', { p_work_order_id: workOrderId, p_person_id: nullableArg(personId) });
  if (error) throw toAppError(error);
}

/** Active members who can be named, by name. */
export async function listResponsibleCandidates(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from('profiles').select('id, full_name').eq('status', 'active').order('full_name').order('id').limit(500);
  if (error) throw toAppError(error);
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name }));
}
