import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

/** `people` (migration 0970) is not in the generated types yet, so reads and writes go through a narrow local shape. */
export interface PersonRow { id: string; code: string; name: string; archived_at: string | null }
export interface PersonInput { code: string; name: string }

type Table = {
  select: (c: string) => { is: (c: string, v: null) => { order: (c: string) => { limit: (n: number) => Promise<{ data: PersonRow[] | null; error: { message: string; code?: string } | null }> } } };
  insert: (v: PersonInput) => { select: (c: string) => { single: () => Promise<{ data: PersonRow | null; error: { message: string; code?: string } | null }> } };
};
const people = () => (supabase as unknown as { from: (t: string) => Table }).from('people');

/** Live (not archived) people, for the import's already-there check. RLS decides what the read returns. */
export async function listPeople(): Promise<PersonRow[]> {
  const { data, error } = await people().select('id, code, name, archived_at').is('archived_at', null).order('code').limit(5000);
  if (error) throw toAppError(error);
  return data ?? [];
}

/** One person record: code and name only. The org is stamped by the database, never sent. */
export async function createPerson(i: PersonInput): Promise<PersonRow> {
  const { data, error } = await people().insert({ code: i.code.trim(), name: i.name.trim() }).select('id, code, name, archived_at').single();
  if (error || !data) throw toAppError(error ?? { message: 'The person was not saved.' });
  return data;
}
