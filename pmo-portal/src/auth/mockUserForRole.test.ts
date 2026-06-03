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

  it('falls back to the first mock user when the role has no mock match (e.g. Admin)', () => {
    // No Admin in mockData; pages must still get a usable numeric id for mock filters.
    expect(mockUserForRole('Admin')).not.toBeNull();
  });

  it('returns null for a null role', () => {
    expect(mockUserForRole(null)).toBeNull();
  });
});
