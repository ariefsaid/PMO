import type { SupabaseClient } from '@supabase/supabase-js';
import { jobRoleUser } from './jobRole';

export function roleJobUser(service: SupabaseClient, key: string, run: string, baseRole?: string) {
  return jobRoleUser({ service, jobRole: key, run, role: baseRole });
}
