import { describe, it, expect } from 'vitest';
import { mockUserForRole } from './mockUserForRole';
import { UserRole } from '@/types';

describe('mockUserForRole', () => {
  it('returns the representative mock user matching a role', () => {
    expect(mockUserForRole('Project Manager')?.role).toBe(UserRole.ProjectManager);
    expect(mockUserForRole('Engineer')?.role).toBe(UserRole.Engineer);
    expect(mockUserForRole('Finance')?.role).toBe(UserRole.Finance);
    expect(mockUserForRole('Executive')?.role).toBe(UserRole.Executive);
  });

  it('returns null for an unmatched role (e.g. Admin) — "My Projects"/"My Requests" must show empty, not another user\'s rows', () => {
    // Fix #2: stop falling back to users[0]; unmatched role must yield null.
    expect(mockUserForRole('Admin')).toBeNull();
  });

  it('returns null for a null role', () => {
    expect(mockUserForRole(null)).toBeNull();
  });
});
