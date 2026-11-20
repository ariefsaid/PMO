import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

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
}
