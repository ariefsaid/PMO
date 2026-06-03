import type { User } from '@/types';
import { users } from '@/data/mockData';
import type { Role } from './AuthContext';

/**
 * Bridge for the still-mocked business pages (Issue #4 replaces mockData).
 * Identity/role now comes from the real Supabase session, but pages keep filtering
 * mockData by a numeric mock-user id. This maps the real role to a representative
 * mock user so "My Projects"/"My Requests" and the role-branched dashboards keep
 * working against mockData. Remove when the data-access layer lands.
 */
export function mockUserForRole(role: Role | null): User | null {
  if (!role) return null;
  // No fallback: unmatched role (e.g. Admin) returns null so "My *" filters show
  // empty rows rather than leaking another user's data. Remove with Issue #4.
  return users.find((u) => u.role === role) ?? null;
}
