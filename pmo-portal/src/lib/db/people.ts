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
  /** The person's direct manager (an app user); who is warned first when their documents expire. */
  manager_id: string | null;
  /** Set when the person has left; the row is then former staff (#2703). Never written by the register. */
  archived_at: string | null;
}
/** The register's staff-status view (#2703). `active` is the default and the pre-existing read. */
export type PeopleListStatus = 'active' | 'former' | 'all';
/** The editable fields (the 0970 + 1008 grants). `code` is omitted/blank on create to have the database assign it. */
export interface PersonInput {
  name: string;
  code?: string | null;
  job_title: string | null;
  profile_id: string | null;
  manager_id: string | null;
}

const COLUMNS = 'id, code, name, job_title, profile_id, manager_id, archived_at';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (): any => supabase.from('people' as never);
function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

/** Live people by default (#2703 keeps this read unchanged); `former` reads archived people only, `all` both.
 *  Ordered by code then id so the offset scan is total. */
export async function listPeople(status: PeopleListStatus = 'active'): Promise<PersonListRow[]> {
  return fetchAllPages<PersonListRow>((from, to) => {
    const page = table().select(COLUMNS).order('code', { ascending: true }).order('id', { ascending: true });
    const scoped = status === 'former' ? page.not('archived_at', 'is', null) : status === 'all' ? page : page.is('archived_at', null);
    return scoped.range(from, to);
  });
}

/** `job_title`, `profile_id` and `manager_id` are optional on create (the people import sends code, name, job title and manager). */
export async function createPerson(input: Omit<PersonInput, 'job_title' | 'profile_id' | 'manager_id'> & Partial<Pick<PersonInput, 'job_title' | 'profile_id' | 'manager_id'>>): Promise<PersonListRow> {
  const code = input.code?.trim();
  const row = { name: input.name.trim(), job_title: input.job_title ?? null, profile_id: input.profile_id ?? null, manager_id: input.manager_id ?? null, ...(code ? { code } : {}) };
  const { data, error } = await table().insert(row).select(COLUMNS).single();
  if (error) fail(error);
  return data as PersonListRow;
}

export async function updatePerson(id: string, input: PersonInput & { code: string }): Promise<void> {
  const fields = { name: input.name.trim(), code: input.code.trim(), job_title: input.job_title, profile_id: input.profile_id, manager_id: input.manager_id };
  const { data, error } = await table().update(fields).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Person not found, or you may not change them.');
}

/** The people import's update: sends only the fields given and non-blank, so a blank never clears a stored value.
 *  Never touches `code`, `profile_id` or `archived_at`. */
export async function updatePersonFields(id: string, input: { name?: string; job_title?: string; manager_id?: string }): Promise<void> {
  const fields: Record<string, string> = {};
  if (input.manager_id) fields.manager_id = input.manager_id;
  const name = input.name?.trim();
  const jobTitle = input.job_title?.trim();
  if (name) fields.name = name;
  if (jobTitle) fields.job_title = jobTitle;
  const { data, error } = await table().update(fields).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Person not found, or you may not change them.');
}

export async function archivePerson(id: string): Promise<void> {
  const { data, error } = await table().update({ archived_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Person not found, or you may not change them.');
}
