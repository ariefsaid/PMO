import { fetchAllPages } from '@/src/lib/pagedRead';
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

/** Active office members who can be named, by name. A foreman or field user is not offered: they cannot open the work order. */
export async function listResponsibleCandidates(): Promise<Array<{ id: string; name: string }>> {
  const rows = await fetchAllPages((from, to) => supabase.from('profiles').select('id, full_name, built_in_role').eq('status', 'active').order('full_name').order('id').range(from, to));
  return rows.filter((p) => p.built_in_role !== 'foreman' && p.built_in_role !== 'field_user').map((p) => ({ id: p.id, name: p.full_name }));
}
