import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

/** Shared setup for the contractor job journeys: a service-role client and a project each journey owns. */
export const ORG_ID = '00000000-0000-0000-0000-000000000001';

export function serviceClient(): SupabaseClient {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('job journeys seed through the service-role key supplied by scripts/e2e-local.sh or CI.');
  const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL);
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function profileId(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.from('profiles').select('id').eq('email', email).single();
  if (error || !data) throw new Error(`profile ${email}: ${error?.message}`);
  return data.id as string;
}

/** A project no other journey reads; delete it (and its children) in afterEach. */
export async function ownProject(admin: SupabaseClient, name: string): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('projects').insert({
    id, org_id: ORG_ID, name, status: 'Ongoing Project', currency: 'USD', contract_value: 0, tax_treatment: 'exclusive', tax_amount: 0,
  });
  if (error) throw new Error(`project: ${error.message}`);
  return id;
}

export async function dropProject(admin: SupabaseClient, projectId: string, tables: string[] = ['tasks']): Promise<void> {
  for (const t of tables) await admin.from(t).delete().eq('project_id', projectId);
  await admin.from('record_changes').delete().eq('entity_id', projectId);
  await admin.from('projects').delete().eq('id', projectId);
}

export const uniq = () => randomUUID().slice(0, 8);
