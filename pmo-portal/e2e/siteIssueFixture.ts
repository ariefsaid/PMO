import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

function localAdmin() {
  const env = loadEnv('development', process.cwd(), 'VITE_');
  const url = requireMatchingLocalSupabaseUrls(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL,
  );
  const key = requireServiceRoleKey();
  if (!key) throw new Error('Site issue journeys require a local service-role key');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * An issue's type is picked from the organisation's kept list (migration 1820), so a journey that raises an issue of its own
 * uniquely named type puts that type on the list first, before the page opens. `cleanSiteIssue` removes it again.
 */
export async function addIssueType(label: string, orgId = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001'): Promise<void> {
  const { error } = await localAdmin().from('incident_types').insert({ org_id: orgId, label });
  if (error) throw error;
}

/** Remove only this journey's issue, its storage objects and its notifications. */
export async function cleanSiteIssue(type: string): Promise<void> {
  if (!type) return;
  const env = loadEnv('development', process.cwd(), 'VITE_');
  const url = requireMatchingLocalSupabaseUrls(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL,
  );
  const key = requireServiceRoleKey();
  if (!key) throw new Error('Site issue journeys require a local service-role key for cleanup');
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const issues = await admin.from('incident_reports').select('id').eq('type', type);
  if (issues.error) throw issues.error;
  for (const issue of issues.data ?? []) {
    const files = await admin.from('incident_files').select('file_path').eq('incident_id', issue.id);
    if (files.error) throw files.error;
    const paths = (files.data ?? []).map((file) => file.file_path);
    const notifications = await admin.from('notifications').delete().eq('metadata->entity->>id', issue.id);
    if (notifications.error) throw notifications.error;
    const deleted = await admin.from('incident_reports').delete().eq('id', issue.id);
    if (deleted.error) throw deleted.error;
    if (paths.length) {
      const removed = await admin.storage.from('incident-files').remove(paths);
      if (removed.error) throw removed.error;
    }
  }
  const listed = await admin.from('incident_types').delete().eq('label', type);
  if (listed.error) throw listed.error;
}
