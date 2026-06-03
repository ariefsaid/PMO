import type { User } from '@/types';
import { users } from '@/data/mockData';
import type { Role } from './AuthContext';

/**
 * Bridge for pages that still read mockData (Dashboard, Procurement).
 * Projects has migrated to the real data layer (ProjectWithRefs / useProjects)
 * and no longer uses this helper.
 *
 * Identity/role comes from the real Supabase session; this maps the effective
 * role to a representative mock user so role-branched dashboards and
 * "My Requests" keep working against mockData until those pages migrate.
 * Remove when every page has a real data-access layer.
 */
export function mockUserForRole(role: Role | null): User | null {
  if (!role) return null;
  // No fallback: unmatched role (e.g. Admin) returns null so "My *" filters show
  // empty rows rather than leaking another user's data. Remove with Issue #4.
  return users.find((u) => u.role === role) ?? null;
}
