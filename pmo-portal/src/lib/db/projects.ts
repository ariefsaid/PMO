import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProjectRow = Tables<'projects'>;

/** A project row with client + PM names resolved in SQL (kills render-time .find(), F-7). */
export type ProjectWithRefs = ProjectRow & {
  client: { name: string } | null;
  pm: { full_name: string } | null;
};

const SELECT = '*, client:companies(name), pm:profiles(full_name)';

/**
 * List projects for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-004). Optional params support later server-side filtering (OD-3); the
 * Projects page filters the cached list client-side for this issue.
 */
export async function listProjects(
  params?: { status?: ProjectRow['status']; pmId?: string },
): Promise<ProjectWithRefs[]> {
  // `any` is a localized escape hatch: PostgREST's TypeScript builder types
  // make it difficult to accumulate `.eq()` chains conditionally without
  // widening the type here. The pattern is intentional and contained — do not
  // propagate `any` beyond this function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase.from('projects').select(SELECT);
  if (params?.status) q = q.eq('status', params.status);
  if (params?.pmId) q = q.eq('project_manager_id', params.pmId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProjectWithRefs[];
}
