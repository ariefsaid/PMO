import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/**
 * Crew loans (#2704, migrations 1245 to 1249): a worker lent from a home crew to a host crew for an inclusive date
 * range. The database owns every rule (one loan per worker per day, a live home placement, approved hours never
 * move, who may lend); this module only carries the request. A refusal keeps its Postgres code (`23P01` overlap,
 * `23514` rule with a stable `LOAN_*` prefix, `42501` not allowed). org_id is never sent.
 */

export interface CrewLoanRow {
  id: string;
  worker_id: string;
  home_crew_id: string;
  host_crew_id: string;
  valid_from: string;
  valid_to: string;
  version: number;
}

export interface CrewLoanInput {
  worker_id: string;
  home_crew_id: string;
  host_crew_id: string;
  valid_from: string;
  valid_to: string;
}

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new AppError(error.message, error.code);
}

/** Every loan of the organisation, newest first (the Crews page card). */
export async function listAllCrewLoans(): Promise<CrewLoanRow[]> {
  const rows = await fetchAllRowsByKeyset<CrewLoanRow>(async (afterId, limit) => {
    let q = supabase
      .from('crew_loans')
      .select('id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to, version')
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => b.valid_from.localeCompare(a.valid_from) || a.id.localeCompare(b.id));
}

export async function createCrewLoan(input: CrewLoanInput): Promise<void> {
  const { error } = await supabase.from('crew_loans').insert(input);
  fail(error);
}

/** Change a loan's dates. The write names the version it read; a stale one writes nothing and throws `PMO_STALE`. */
export async function correctCrewLoan(id: string, version: number, patch: Pick<CrewLoanInput, 'valid_from' | 'valid_to'>): Promise<void> {
  const { data, error } = await supabase.from('crew_loans').update(patch).eq('id', id).eq('version', version).select('id');
  fail(error);
  if (!data || data.length === 0) throw new AppError('This loan changed since you opened it.', 'PMO_STALE');
}

/** Whether the organisation shows crew loans on the Crews page (default off). */
export async function getCrewLoansEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('organizations').select('crew_loans_enabled').limit(1);
  fail(error);
  return data?.[0]?.crew_loans_enabled === true;
}

/** Admin only; the server enforces it and audits the change. */
export async function setCrewLoansEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_org_crew_loans_enabled', { p_enabled: enabled });
  fail(error);
}
