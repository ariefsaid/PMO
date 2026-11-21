import { supabase } from '@/src/lib/supabase/client';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { AppError, assertWriteLanded } from '@/src/lib/appError';

/**
 * People register DAL (#2542 follow-up, migration 1008). The workforce register behind expiring documents: anyone who
 * holds a document, app user or not. org_id is NEVER sent (column default + trigger stamp it, ADR-0017); a blank code is
 * assigned by the database (P-0001, …). RLS and the column grants are the authority. The table is not in the generated
 * types until the next `supabase gen types`, so the query builder is typed here.
 */
export interface PersonListRow {
  id: string;
  code: string;
  name: string;
  job_title: string | null;
  profile_id: string | null;
}
/** The editable fields (the 0970 + 1008 grants). `code` is omitted/blank on create to have the database assign it. */
export interface PersonInput {
  name: string;
  code?: string | null;
  job_title: string | null;
  profile_id: string | null;
}

const COLUMNS = 'id, code, name, job_title, profile_id';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (): any => supabase.from('people' as never);
function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

/** Live people, ordered by code then id so the offset scan is total. */
export async function listPeople(): Promise<PersonListRow[]> {
  return fetchAllPages<PersonListRow>((from, to) =>
    table().select(COLUMNS).is('archived_at', null).order('code', { ascending: true }).order('id', { ascending: true }).range(from, to));
}

/** `job_title` and `profile_id` are optional on create (the people import sends only code and name). */
export async function createPerson(input: Omit<PersonInput, 'job_title' | 'profile_id'> & Partial<Pick<PersonInput, 'job_title' | 'profile_id'>>): Promise<PersonListRow> {
  const code = input.code?.trim();
  const row = { name: input.name.trim(), job_title: input.job_title ?? null, profile_id: input.profile_id ?? null, ...(code ? { code } : {}) };
  const { data, error } = await table().insert(row).select(COLUMNS).single();
  if (error) fail(error);
  return data as PersonListRow;
}

export async function updatePerson(id: string, input: PersonInput & { code: string }): Promise<void> {
  const fields = { name: input.name.trim(), code: input.code.trim(), job_title: input.job_title, profile_id: input.profile_id };
  const { data, error } = await table().update(fields).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Person not found, or you may not change them.');
}

export async function archivePerson(id: string): Promise<void> {
  const { data, error } = await table().update({ archived_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Person not found, or you may not change them.');
}
